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

async function ensureSchema(pool) {
    const results = [];
    results.push(await ensureVicLocationColumn(pool));
    results.push(await ensureStopColumns(pool));
    return results;
}

module.exports = {
    ensureSchema,
    ensureVicLocationColumn,
    ensureStopColumns,
};
