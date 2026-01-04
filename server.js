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
    // I only expose non-sensitive config. I never return passwords or secrets.
    const now = new Date();
    const uptimeSec = Math.round(process.uptime());
    const nodeVersion = process.version;

    const dbConfigured = hasDb;

    const base = {
        ok: true,
        ts: now.toISOString(),
        uptimeSec,
        node: nodeVersion,
        env: process.env.NODE_ENV || "unknown",
        baseUrl: process.env.BASE_URL || null,
        app: {
            hostname: process.env.HOSTNAME || null,
            pid: process.pid,
        },
        db: {
            configured: dbConfigured,
            host: process.env.DB_HOST || null,
            port: Number(process.env.DB_PORT || 3306),
            name: process.env.DB_NAME || null,
            user: process.env.DB_USER || null,
            pingOk: false,
            latencyMs: null,
            error: null,
        },
    };

    if (!dbConfigured) {
        return res.json({ ...base, ok: true, note: "DB not configured yet" });
    }

    const t0 = Date.now();
    try {
        // I run a simple query to confirm DB connectivity.
        const [[row]] = await pool.query("SELECT 1 AS ok");
        base.db.pingOk = row?.ok === 1;
        base.db.latencyMs = Date.now() - t0;

        return res.json(base);
    } catch (e) {
        base.ok = false;
        base.db.pingOk = false;
        base.db.latencyMs = Date.now() - t0;

        // I return only safe error details for debugging.
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
