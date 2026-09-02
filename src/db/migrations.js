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

async function ensureSchema(pool) {
    const results = [];
    results.push(await ensureVicLocationColumn(pool));
    return results;
}

module.exports = {
    ensureSchema,
    ensureVicLocationColumn,
};
