require("dotenv").config();

const express = require("express");
const path = require("path");
const session = require("express-session");

const { pool } = require("./src/db");
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
    const hasDb =
        process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME;

    if (!hasDb) {
        return res.json({ ok: true, db: false, note: "DB not configured yet" });
    }

    try {
        const [[row]] = await pool.query("SELECT 1 AS ok");
        res.json({ ok: row.ok === 1, db: true });
    } catch (e) {
        res.status(500).json({ ok: false, db: false, error: e.message });
    }
});

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Running on ${process.env.BASE_URL || `http://localhost:${PORT}`}`);
});
