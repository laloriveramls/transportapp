require("dotenv").config();

const express = require("express");
const path = require("path");
const session = require("express-session");

const { pool, hasDb } = require("./src/db");
const publicRoutes = require("./src/routes/public");
const adminRoutes = require("./src/routes/admin");

const app = express();

// Views
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// Static files
app.use(express.static(path.join(__dirname, "public")));

// Body parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Sessions (ANTES de /admin)
app.use(
    session({
        secret: process.env.SESSION_SECRET || "dev_secret_change_me",
        resave: false,
        saveUninitialized: false,
    })
);

// Routes
app.use("/", publicRoutes);
app.use("/admin", adminRoutes);

// Health check
app.get("/health", async (req, res) => {
    const now = new Date();
    const uptimeSec = Math.round(process.uptime());

    const envCheck = {
        DB_HOST: { present: !!process.env.DB_HOST, len: (process.env.DB_HOST || "").length },
        DB_PORT: { present: !!process.env.DB_PORT, len: (process.env.DB_PORT || "").length },
        DB_USER: { present: !!process.env.DB_USER, len: (process.env.DB_USER || "").length },
        DB_NAME: { present: !!process.env.DB_NAME, len: (process.env.DB_NAME || "").length },
        DB_PASS: { present: !!process.env.DB_PASS, len: (process.env.DB_PASS || "").length }, // solo len
    };

    const base = {
        ok: true,
        ts: now.toISOString(),
        uptimeSec,
        env: process.env.NODE_ENV || "unknown",
        baseUrl: process.env.BASE_URL || null,

        app: {
            pid: process.pid,
            node: process.version,
            hasPool: !!pool,
            envKeysDb: Object.keys(process.env).filter(k => k.startsWith("DB_")).sort(),
            envCheck,
        },

        db: {
            configured: !!hasDb,
            host: process.env.DB_HOST || null,
            port: Number(process.env.DB_PORT || 3306),
            name: process.env.DB_NAME || null,
            user: process.env.DB_USER || null,
            pingOk: false,
            latencyMs: null,
            error: null,
        },
    };

    if (!hasDb) {
        return res.json({ ...base, note: "DB not configured yet (missing env vars in runtime)" });
    }

    const t0 = Date.now();
    try {
        const [[row]] = await pool.query("SELECT 1 AS ok");
        base.db.pingOk = row?.ok === 1;
        base.db.latencyMs = Date.now() - t0;
        return res.json(base);
    } catch (e) {
        base.ok = false;
        base.db.latencyMs = Date.now() - t0;
        base.db.error = {
            code: e.code || null,
            errno: e.errno || null,
            sqlState: e.sqlState || null,
            message: e.message || String(e),
        };
        return res.status(500).json(base);
    }
});


// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Running on ${process.env.BASE_URL || `http://localhost:${PORT}`}`);
});
