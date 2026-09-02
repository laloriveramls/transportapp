require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {pool, hasDb} = require('../src/db');
const {ensureVicLocationColumn} = require('../src/db/migrations');

async function main() {
    if (!hasDb) {
        console.error('DB no configurada en .env (DB_HOST, DB_USER, DB_PASS, DB_NAME).');
        process.exit(1);
    }

    const file = path.join(__dirname, '..', 'sql', '20260902_vic_locations.sql');
    const sql = fs.readFileSync(file, 'utf8');
    const statements = sql
        .split(';')
        .map((s) => s.replace(/--[^\n]*/g, '').trim())
        .filter(Boolean);

    const conn = await pool.getConnection();
    try {
        for (const st of statements) {
            try {
                await conn.query(st);
                console.log('OK:', st.split('\n')[0].slice(0, 90));
            } catch (e) {
                if (e.code === 'ER_DUP_FIELDNAME') {
                    console.log('SKIP (columna ya existe):', st.split('\n')[0].slice(0, 90));
                } else {
                    throw e;
                }
            }
        }

        const result = await ensureVicLocationColumn(conn);
        console.log('Verificación vic_location:', result.applied ? 'aplicada ahora' : 'ya existía');

        const [[col]] = await conn.query(
            "SHOW COLUMNS FROM transporte_reservations LIKE 'vic_location'"
        );
        console.log('Columna vic_location:', col ? 'sí' : 'no');
    } finally {
        conn.release();
        await pool.end();
    }

    console.log('Migración completada.');
}

main().catch((e) => {
    console.error('Error:', e.message || e);
    process.exit(1);
});
