'use strict';

async function ensureVicLocationColumn(pool) {
    const [[col]] = await pool.query(
        "SHOW COLUMNS FROM transporte_reservations LIKE 'vic_location'"
    );
    if (col) return {applied: false, column: 'vic_location'};

    await pool.query(`
        ALTER TABLE transporte_reservations
            ADD COLUMN vic_location VARCHAR(40) NULL DEFAULT NULL AFTER package_details
    `);
    return {applied: true, column: 'vic_location'};
}

async function ensureStopColumns(pool) {
    const [[colFrom]] = await pool.query(
        "SHOW COLUMNS FROM transporte_reservations LIKE 'from_stop'"
    );
    if (colFrom) return {applied: false, column: 'from_stop, to_stop'};

    await pool.query(`
        ALTER TABLE transporte_reservations
            ADD COLUMN from_stop VARCHAR(40) NULL DEFAULT NULL AFTER vic_location,
            ADD COLUMN to_stop VARCHAR(40) NULL DEFAULT NULL AFTER from_stop
    `);

    try {
        await pool.query(`
            UPDATE transporte_reservations r
            JOIN transporte_trips t ON t.id = r.trip_id
            JOIN transporte_departure_templates dt ON dt.id = t.template_id
            SET r.from_stop = IF(dt.direction = 'VIC_TO_LLE', IFNULL(r.vic_location, 'VIC'), 'LLE'),
                r.to_stop   = IF(dt.direction = 'VIC_TO_LLE', 'LLE', IFNULL(r.vic_location, 'VIC'))
            WHERE r.from_stop IS NULL
        `);
    } catch (e) {
        // Best-effort backfill
    }

    return {applied: true, column: 'from_stop, to_stop'};
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
    if (tbl) return {applied: false, column: 'transporte_special_events'};

    await pool.query(`
        CREATE TABLE transporte_special_events
        (
            id                  INT                              NOT NULL AUTO_INCREMENT,
            slug                VARCHAR(80)                      NOT NULL,
            title               VARCHAR(120)                     NOT NULL,
            tab_label           VARCHAR(40)                      NOT NULL,
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
    results.push(await ensureStopColumns(pool));
    results.push(await ensureTemplateSpecialColumn(pool));
    results.push(await ensureSpecialEventsTable(pool));
    return results;
}

module.exports = {
    ensureSchema,
    ensureVicLocationColumn,
    ensureStopColumns,
    ensureTemplateSpecialColumn,
    ensureSpecialEventsTable,
};
