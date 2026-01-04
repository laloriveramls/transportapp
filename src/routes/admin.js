const express = require("express");
const bcrypt = require("bcrypt");
const { pool, hasDb } = require("../db");

const router = express.Router();

function requireDb(req, res, next) {
    if (hasDb) return next();
    return res.status(503).render("maintenance", {
        title: "Sitio en configuración",
        message: "El sitio está activo, pero la base de datos aún no está configurada. Intenta más tarde.",
    });
}

function requireAdmin(req, res, next) {
    if (req.session?.admin?.role === "ADMIN") return next();
    return res.redirect("/admin/login");
}

function directionLabel(direction) {
    return direction === "VIC_TO_LLE" ? "Victoria → Llera" : "Llera → Victoria";
}

function regenSession(req) {
    return new Promise((resolve, reject) => {
        req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });
}

// LOGIN
router.get("/login", (req, res) => {
    if (req.session?.admin) return res.redirect("/admin/agenda");
    res.render("admin_login", { error: null });
});

router.post("/login", requireDb, async (req, res) => {
    const username = String(req.body.user || "").trim().toLowerCase();
    const pass = String(req.body.pass || "");

    if (!username || !pass) {
        return res.render("admin_login", { error: "Captura usuario y contraseña." });
    }

    const [[u]] = await pool.query(
        `
            SELECT id, username, pass_hash, role, active
            FROM transporte_admin_users
            WHERE LOWER(username) = ?
                LIMIT 1
        `,
        [username]
    );

    if (!u || Number(u.active) !== 1) {
        return res.render("admin_login", { error: "Usuario o contraseña incorrectos." });
    }

    const ok = await bcrypt.compare(pass, u.pass_hash);
    if (!ok) {
        return res.render("admin_login", { error: "Usuario o contraseña incorrectos." });
    }

    await regenSession(req);

    req.session.admin = { id: u.id, username: u.username, role: u.role };

    await pool.query(`UPDATE transporte_admin_users SET last_login_at = NOW() WHERE id = ?`, [u.id]);

    return res.redirect("/admin/agenda");
});

router.post("/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/admin/login"));
});

// AGENDA (por día)
router.get("/agenda", requireAdmin, requireDb, async (req, res) => {
    // I use Monterrey timezone so the "day" doesn't shift by UTC.
    const date =
        req.query.date ||
        new Date().toLocaleDateString("en-CA", { timeZone: "America/Monterrey" }); // YYYY-MM-DD

    const [trips] = await pool.query(
        `
            SELECT
                t.id AS trip_id,
                t.trip_date,
                dt.direction,
                dt.depart_time,
                dt.capacity_passengers,
                COALESCE(agg.used_seats, 0) AS used_seats,
                COALESCE(agg.packages, 0)   AS packages
            FROM transporte_trips t
                     JOIN transporte_departure_templates dt ON dt.id = t.template_id
                     LEFT JOIN (
                SELECT
                    r.trip_id,

                    -- I count active passenger seats (paid or not), excluding cancelled.
                    SUM(
                            CASE
                                WHEN r.type = 'PASSENGER' AND r.status <> 'CANCELLED'
                                    THEN COALESCE(rp.passenger_count, NULLIF(r.seats,0), 1)
                                ELSE 0
                                END
                    ) AS used_seats,

                    -- I count active packages (paid or not), excluding cancelled.
                    SUM(
                            CASE
                                WHEN r.type = 'PACKAGE' AND r.status <> 'CANCELLED'
                                    THEN COALESCE(NULLIF(r.seats,0), 1)
                                ELSE 0
                                END
                    ) AS packages

                FROM transporte_reservations r
                         LEFT JOIN (
                    SELECT reservation_id, COUNT(*) AS passenger_count
                    FROM transporte_reservation_passengers
                    GROUP BY reservation_id
                ) rp ON rp.reservation_id = r.id
                GROUP BY r.trip_id
            ) agg ON agg.trip_id = t.id
            WHERE t.trip_date = ?
            ORDER BY dt.depart_time
        `,
        [date]
    );

    res.render("admin_agenda", { date, trips, directionLabel });
});

// DETALLE SALIDA
router.get("/trip/:tripId", requireAdmin, requireDb, async (req, res) => {
    const { tripId } = req.params;
    const onlyPending = req.query.onlyPending === "1";

    const [[trip]] = await pool.query(
        `
            SELECT t.id AS trip_id, t.trip_date, dt.direction, dt.depart_time, dt.capacity_passengers
            FROM transporte_trips t
                     JOIN transporte_departure_templates dt ON dt.id = t.template_id
            WHERE t.id = ?
        `,
        [tripId]
    );
    if (!trip) return res.status(404).send("Salida no encontrada.");

    const [reservations] = await pool.query(
        `
            SELECT
                r.*,
                (SELECT tk.code FROM transporte_tickets tk WHERE tk.reservation_id = r.id LIMIT 1) AS ticket_code,
            GROUP_CONCAT(p.passenger_name ORDER BY p.id SEPARATOR ', ') AS passenger_names,
            COUNT(p.id) AS passenger_count
            FROM transporte_reservations r
                LEFT JOIN transporte_reservation_passengers p ON p.reservation_id = r.id
            WHERE r.trip_id = ?
              AND (? = 0 OR (r.status <> 'PAID' AND r.status <> 'CANCELLED'))
            GROUP BY r.id
            ORDER BY r.created_at
        `,
        [tripId, onlyPending ? 1 : 0]
    );


    res.render("admin_trip", {
        trip,
        reservations,
        directionLabel,
        onlyPending,
        baseUrl: process.env.BASE_URL,
    });
});

function randomTicketCode(len = 12) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

// MARCAR PAGADO + CREAR TICKET + REDIRECT CON RETURN
router.post("/reservation/:reservationId/mark-paid", requireAdmin, requireDb, async (req, res) => {
    const { reservationId } = req.params;
    const method = req.body.method === "TRANSFER" ? "TRANSFER" : "CASH";

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [[r]] = await conn.query(
            `
                SELECT r.id, r.status, r.trip_id
                FROM transporte_reservations r
                WHERE r.id = ? FOR UPDATE
            `,
            [reservationId]
        );
        if (!r) throw new Error("Reserva no encontrada.");

        if (r.status !== "PAID") {
            await conn.query(`UPDATE transporte_reservations SET status='PAID' WHERE id=?`, [reservationId]);

            await conn.query(
                `
                    INSERT INTO transporte_payments(reservation_id, method, status, verified_at)
                    VALUES (?, ?, 'VERIFIED', NOW())
                `,
                [reservationId, method]
            );
        }

        const [[existing]] = await conn.query(
            `SELECT code FROM transporte_tickets WHERE reservation_id=?`,
            [reservationId]
        );

        let code = existing?.code;

        if (!code) {
            for (let i = 0; i < 6; i++) {
                const candidate = randomTicketCode(12);
                try {
                    await conn.query(
                        `INSERT INTO transporte_tickets(reservation_id, code) VALUES (?, ?)`,
                        [reservationId, candidate]
                    );
                    code = candidate;
                    break;
                } catch {}
            }
            if (!code) throw new Error("No pude generar ticket. Intenta otra vez.");
        }

        await conn.commit();

        const returnTo = `/admin/trip/${r.trip_id}`;
        return res.redirect(`/ticket/${code}?return=${encodeURIComponent(returnTo)}`);
    } catch (e) {
        await conn.rollback();
        return res.status(500).send(e.message);
    } finally {
        conn.release();
    }
});

router.post("/reservation/:reservationId/cancel", requireAdmin, requireDb, async (req, res) => {
    const { reservationId } = req.params;

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [[r]] = await conn.query(
            `SELECT id, trip_id, status FROM transporte_reservations WHERE id=? FOR UPDATE`,
            [reservationId]
        );
        if (!r) throw new Error("Reserva no encontrada.");

        if (r.status !== "CANCELLED") {
            await conn.query(`UPDATE transporte_reservations SET status='CANCELLED' WHERE id=?`, [reservationId]);
        }

        await conn.query(
            `
                UPDATE transporte_payments
                SET status='REJECTED'
                WHERE reservation_id=? AND status='PENDING'
            `,
            [reservationId]
        );

        await conn.commit();
        return res.redirect(`/admin/trip/${r.trip_id}`);
    } catch (e) {
        await conn.rollback();
        return res.status(500).send(e.message);
    } finally {
        conn.release();
    }
});

module.exports = router;
