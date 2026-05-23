require("dotenv").config();
const fs = require("fs");
const path = require("path");
const {pool, hasDb} = require("../src/db");

async function main() {
    if (!hasDb) {
        console.error("DB no configurada en .env (DB_HOST, DB_USER, DB_PASS, DB_NAME).");
        process.exit(1);
    }

    const file = path.join(__dirname, "..", "sql", "20260522_child_pricing.sql");
    const sql = fs.readFileSync(file, "utf8");
    const statements = sql
        .split(";")
        .map((s) => s.replace(/--[^\n]*/g, "").trim())
        .filter(Boolean);

    const conn = await pool.getConnection();
    try {
        for (const st of statements) {
            try {
                await conn.query(st);
                console.log("OK:", st.split("\n")[0].slice(0, 90));
            } catch (e) {
                if (e.code === "ER_DUP_FIELDNAME") {
                    console.log("SKIP (columna ya existe):", st.split("\n")[0].slice(0, 90));
                } else {
                    throw e;
                }
            }
        }

        const [[childPriceCol]] = await conn.query(
            "SHOW COLUMNS FROM transporte_settings LIKE 'child_price_mxn'"
        );
        const [[childSeatsCol]] = await conn.query(
            "SHOW COLUMNS FROM transporte_reservations LIKE 'child_seats'"
        );

        console.log("Verificación child_price_mxn:", childPriceCol ? "sí" : "no");
        console.log("Verificación child_seats:", childSeatsCol ? "sí" : "no");

        if (childPriceCol) {
            const [[row]] = await conn.query(
                "SELECT child_price_mxn FROM transporte_settings WHERE id = 1"
            );
            console.log("Precio niño actual (id=1):", row?.child_price_mxn ?? "(sin fila)");
        }
    } finally {
        conn.release();
        await pool.end();
    }

    console.log("Migración completada.");
}

main().catch((e) => {
    console.error("Error:", e.message || e);
    process.exit(1);
});
