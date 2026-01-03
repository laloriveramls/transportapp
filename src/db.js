const mysql = require("mysql2/promise");

const hasDb =
    process.env.DB_HOST &&
    process.env.DB_USER &&
    process.env.DB_NAME;

let pool = null;

if (hasDb) {
    pool = mysql.createPool({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
        connectionLimit: 10,
        dateStrings: true
    });
}

module.exports = { pool, hasDb };
