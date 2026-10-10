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

async function ensureCapacity14(pool) {
    if (!(await tableExists(pool, 'transporte_departure_templates'))) {
        return {applied: false, column: 'capacity_passengers'};
    }

    const [cols] = await pool.query(
        "SHOW COLUMNS FROM transporte_departure_templates LIKE 'capacity_passengers'"
    );
    const currentDefault = cols[0] ? String(cols[0].Default) : '';

    // One-shot: once the column default is 14, do not rewrite admin-chosen capacities again.
    if (currentDefault === '14') {
        return {applied: false, column: 'capacity_passengers'};
    }

    await pool.query(`
        ALTER TABLE transporte_departure_templates
            MODIFY COLUMN capacity_passengers INT(11) NOT NULL DEFAULT 14
    `);

    const [result] = await pool.query(`
        UPDATE transporte_departure_templates
        SET capacity_passengers = 14
        WHERE capacity_passengers IN (6, 7)
    `);

    const changed = Number(result?.affectedRows || 0);
    return {
        applied: true,
        column: changed > 0
            ? `capacity_passengers(${changed})`
            : 'capacity_passengers',
    };
}

async function ensureTemplateSpecialColumn(pool) {
    let applied = false;

    const [[col]] = await pool.query(
        "SHOW COLUMNS FROM transporte_departure_templates LIKE 'special_event_id'"
    );
    if (!col) {
        await pool.query(`
            ALTER TABLE transporte_departure_templates
                ADD COLUMN special_event_id INT NOT NULL DEFAULT 0 AFTER active
        `);
        applied = true;
    }

    // Special templates may share direction + time with a regular one (e.g. LLE_TO_VIC 17:00),
    // so the unique key must include special_event_id.
    const [idxRows] = await pool.query(
        "SHOW INDEX FROM transporte_departure_templates WHERE Non_unique = 0 AND Key_name <> 'PRIMARY'"
    );
    const uniques = new Map();
    for (const row of idxRows) {
        if (!uniques.has(row.Key_name)) uniques.set(row.Key_name, []);
        uniques.get(row.Key_name)[Number(row.Seq_in_index) - 1] = row.Column_name;
    }

    const hasNewKey = [...uniques.values()].some(
        (cols) => cols.join(',') === 'direction,depart_time,special_event_id'
    );
    if (!hasNewKey) {
        await pool.query(`
            ALTER TABLE transporte_departure_templates
                ADD UNIQUE KEY uq_template_dir_time_event (direction, depart_time, special_event_id)
        `);
        applied = true;
    }

    for (const [name, cols] of uniques) {
        if (cols.join(',') === 'direction,depart_time') {
            await pool.query(`ALTER TABLE transporte_departure_templates DROP INDEX \`${name}\``);
            applied = true;
        }
    }

    return {applied, column: 'transporte_departure_templates.special_event_id'};
}

async function ensureSpecialEventsTable(pool) {
    const [[tbl]] = await pool.query("SHOW TABLES LIKE 'transporte_special_events'");
    if (tbl) {
        if (await columnExists(pool, 'transporte_special_events', 'icon')) {
            return {applied: false, column: 'transporte_special_events'};
        }
        await pool.query(`
            ALTER TABLE transporte_special_events
                ADD COLUMN icon VARCHAR(40) NOT NULL DEFAULT 'ferris-wheel' AFTER tab_label
        `);
        return {applied: true, column: 'transporte_special_events.icon'};
    }

    await pool.query(`
        CREATE TABLE transporte_special_events
        (
            id                  INT                              NOT NULL AUTO_INCREMENT,
            slug                VARCHAR(80)                      NOT NULL,
            title               VARCHAR(120)                     NOT NULL,
            tab_label           VARCHAR(40)                      NOT NULL,
            icon                VARCHAR(40)                      NOT NULL DEFAULT 'ferris-wheel',
            description         VARCHAR(255)                     NULL     DEFAULT NULL,
            direction           ENUM ('VIC_TO_LLE','LLE_TO_VIC') NOT NULL DEFAULT 'LLE_TO_VIC',
            depart_time         TIME                             NOT NULL,
            return_time         TIME                             NULL     DEFAULT NULL,
            start_date          DATE                             NOT NULL,
            end_date            DATE                             NOT NULL,
            capacity_passengers INT                              NOT NULL DEFAULT 14,
            price_mxn           DECIMAL(10, 2)                   NOT NULL DEFAULT 0.00,
            active              TINYINT(1)                       NOT NULL DEFAULT 1,
            template_id         INT                              NULL     DEFAULT NULL,
            created_at          TIMESTAMP                        NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at          TIMESTAMP                        NULL     DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_special_events_slug (slug)
        ) ENGINE = InnoDB
          DEFAULT CHARSET = utf8mb4
          COLLATE = utf8mb4_unicode_ci
    `);

    const {DEFAULT_EVENT, syncEventTemplate} = require('../specialEvents');
    const ev = DEFAULT_EVENT;
    const [ins] = await pool.query(
        `INSERT INTO transporte_special_events(slug, title, tab_label, description, direction, depart_time, return_time,
                                               start_date, end_date, capacity_passengers, price_mxn, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ev.slug, ev.title, ev.tab_label, ev.description, ev.direction, ev.depart_time, ev.return_time,
            ev.start_date, ev.end_date, ev.capacity_passengers, ev.price_mxn, ev.active]
    );
    await syncEventTemplate(pool, ins.insertId);

    return {applied: true, column: 'transporte_special_events'};
}

async function ensureSchema(pool) {
    const results = [];
    results.push(await ensureVicLocationColumn(pool));
    results.push(await ensureFromToStopColumns(pool));
    results.push(await ensureChildPriceColumn(pool));
    results.push(await ensureCityLabelColumns(pool));
    results.push(await ensureVicLocationsTable(pool));
    results.push(await ensureCapacity14(pool));
    results.push(await ensureTemplateSpecialColumn(pool));
    results.push(await ensureSpecialEventsTable(pool));

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
    ensureCapacity14,
    ensureTemplateSpecialColumn,
    ensureSpecialEventsTable,
    DEFAULT_CITY_LABELS,
};
