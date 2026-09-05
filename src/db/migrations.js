'use strict';

const {
    DEFAULT_VIC_LOCATIONS,
    DEFAULT_CITY_LABELS,
    hydrateLocationsFromDb,
} = require('../locations');

async function columnExists(pool, table, column) {
    const [rows] = await pool.query(
        `SELECT 1 AS ok
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND COLUMN_NAME = ?
         LIMIT 1`,
        [table, column]
    );
    return rows.length > 0;
}

async function tableExists(pool, table) {
    const [rows] = await pool.query(
        `SELECT 1 AS ok
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
         LIMIT 1`,
        [table]
    );
    return rows.length > 0;
}

async function ensureChildPriceColumn(pool) {
    if (await columnExists(pool, 'transporte_settings', 'child_price_mxn')) {
        return {applied: false, column: 'child_price_mxn'};
    }
    await pool.query(`
        ALTER TABLE transporte_settings
            ADD COLUMN child_price_mxn DECIMAL(10, 2) NOT NULL DEFAULT 60.00
                AFTER package_price_mxn
    `);
    return {applied: true, column: 'child_price_mxn'};
}

async function ensureCityLabelColumns(pool) {
    const applied = [];

    if (!(await columnExists(pool, 'transporte_settings', 'vic_label'))) {
        await pool.query(`
            ALTER TABLE transporte_settings
                ADD COLUMN vic_label VARCHAR(80) NOT NULL DEFAULT 'Ciudad Victoria'
        `);
        applied.push('vic_label');
    }

    if (!(await columnExists(pool, 'transporte_settings', 'lle_label'))) {
        await pool.query(`
            ALTER TABLE transporte_settings
                ADD COLUMN lle_label VARCHAR(80) NOT NULL DEFAULT 'Llera'
        `);
        applied.push('lle_label');
    }

    if (!applied.length) {
        return {applied: false, column: 'vic_label,lle_label'};
    }
    return {applied: true, column: applied.join(',')};
}

async function ensureVicLocationsTable(pool) {
    const existed = await tableExists(pool, 'transporte_vic_locations');

    await pool.query(`
        CREATE TABLE IF NOT EXISTS transporte_vic_locations (
            code                   VARCHAR(40)    NOT NULL,
            label                  VARCHAR(120)   NOT NULL,
            price_to_victoria_mxn  DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
            price_to_llera_mxn     DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
            sort_order             INT            NOT NULL DEFAULT 0,
            active                 TINYINT(1)     NOT NULL DEFAULT 1,
            updated_at             TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                   ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (code)
        ) ENGINE = InnoDB
          DEFAULT CHARSET = utf8mb4
          COLLATE = utf8mb4_unicode_ci
    `);

    const [[{cnt}]] = await pool.query(
        'SELECT COUNT(*) AS cnt FROM transporte_vic_locations'
    );

    if (Number(cnt) === 0) {
        for (const loc of DEFAULT_VIC_LOCATIONS) {
            await pool.query(
                `INSERT INTO transporte_vic_locations
                    (code, label, price_to_victoria_mxn, price_to_llera_mxn, sort_order, active)
                 VALUES (?, ?, ?, ?, ?, 1)`,
                [
                    loc.code,
                    loc.label,
                    loc.price_to_victoria_mxn,
                    loc.price_to_llera_mxn,
                    loc.sort_order,
                ]
            );
        }
        return {applied: true, column: 'transporte_vic_locations(seed)'};
    }

    return {
        applied: !existed,
        column: existed ? 'transporte_vic_locations' : 'transporte_vic_locations(create)',
    };
}

async function ensureFromToStopColumns(pool) {
    const applied = [];

    if (!(await columnExists(pool, 'transporte_reservations', 'from_stop'))) {
        await pool.query(`
            ALTER TABLE transporte_reservations
                ADD COLUMN from_stop VARCHAR(40) NULL DEFAULT NULL AFTER vic_location
        `);
        applied.push('from_stop');
    }

    if (!(await columnExists(pool, 'transporte_reservations', 'to_stop'))) {
        await pool.query(`
            ALTER TABLE transporte_reservations
                ADD COLUMN to_stop VARCHAR(40) NULL DEFAULT NULL AFTER from_stop
        `);
        applied.push('to_stop');
    }

    if (!applied.length) {
        return {applied: false, column: 'from_stop,to_stop'};
    }

    try {
        await pool.query(`
            UPDATE transporte_reservations r
            JOIN transporte_trips t ON t.id = r.trip_id
            JOIN transporte_departure_templates dt ON dt.id = t.template_id
            SET r.from_stop = IF(dt.direction = 'VIC_TO_LLE', IFNULL(r.vic_location, 'VIC'), 'LLE'),
                r.to_stop   = IF(dt.direction = 'VIC_TO_LLE', 'LLE', IFNULL(r.vic_location, 'VIC'))
            WHERE r.from_stop IS NULL OR r.to_stop IS NULL
        `);
    } catch (e) {
        // Best-effort backfill
    }

    return {applied: true, column: applied.join(',')};
}

async function ensureVicLocationColumn(pool) {
    if (await columnExists(pool, 'transporte_reservations', 'vic_location')) {
        return {applied: false, column: 'vic_location'};
    }
    await pool.query(`
        ALTER TABLE transporte_reservations
            ADD COLUMN vic_location VARCHAR(40) NULL DEFAULT NULL AFTER package_details
    `);
    return {applied: true, column: 'vic_location'};
}

async function ensureSchema(pool) {
    const results = [];
    results.push(await ensureVicLocationColumn(pool));
    results.push(await ensureFromToStopColumns(pool));
    results.push(await ensureChildPriceColumn(pool));
    results.push(await ensureCityLabelColumns(pool));
    results.push(await ensureVicLocationsTable(pool));

    try {
        await hydrateLocationsFromDb(pool);
    } catch (e) {
        console.error('No pude hidratar catálogo de ubicaciones:', e.message || e);
    }

    return results;
}

module.exports = {
    ensureSchema,
    ensureVicLocationColumn,
    ensureFromToStopColumns,
    ensureChildPriceColumn,
    ensureCityLabelColumns,
    ensureVicLocationsTable,
    DEFAULT_CITY_LABELS,
};
