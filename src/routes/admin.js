"use strict";

const express = require("express");
const bcrypt = require("bcrypt");
const {pool, hasDb} = require("../db");
const crypto = require("crypto");

const router = express.Router();

const MAX_CAP = 6; // I keep system capacity clamped to 6.

/* -----------------------------
   Middleware
----------------------------- */
function requireDb(req, res, next) {
    if (hasDb) return next();
    return res.status(503).render("maintenance", {
        title: "Sitio en configuración",
        message:
            "El sitio está activo, pero la base de datos aún no está configurada. Intenta más tarde.",
    });
}

function requireAdmin(req, res, next) {
    if (req.session?.admin?.role === "ADMIN") return next();
    return res.redirect("/admin/login");
}

/* -----------------------------
   Helpers
----------------------------- */
function directionLabel(direction) {
    return direction === "VIC_TO_LLE" ? "Victoria → Llera" : "Llera → Victoria";
}

function regenSession(req) {
    return new Promise((resolve, reject) => {
        req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });
}

async function ensureTripsForDate(tripDate) {
    // I create missing trips for all ACTIVE templates.
    await pool.query(
        `
            INSERT
            IGNORE INTO transporte_trips (template_id, trip_date, status)
            SELECT id, ?, 'OPEN'
            FROM transporte_departure_templates
            WHERE active = 1
        `,
        [tripDate]
    );
}

/* =========================================================
   LOGIN
========================================================= */
router.get("/login", (req, res) => {
    if (req.session?.admin) return res.redirect("/admin/agenda");
    res.render("admin_login", {error: null});
});

router.post("/login", requireDb, async (req, res) => {
    const username = String(req.body.user || "").trim().toLowerCase();
    const pass = String(req.body.pass || "");

    if (!username || !pass) {
        return res.render("admin_login", {error: "Captura usuario y contraseña."});
    }

    const [[u]] = await pool.query(
        `
            SELECT id, username, pass_hash, role, active
            FROM transporte_admin_users
            WHERE LOWER(username) = ? LIMIT 1
        `,
        [username]
    );

    if (!u || Number(u.active) !== 1) {
        return res.render("admin_login", {error: "Usuario o contraseña incorrectos."});
    }

    const ok = await bcrypt.compare(pass, u.pass_hash);
    if (!ok) {
        return res.render("admin_login", {error: "Usuario o contraseña incorrectos."});
    }

    await regenSession(req);
    req.session.admin = {id: u.id, username: u.username, role: u.role};

    await pool.query(`UPDATE transporte_admin_users
                      SET last_login_at = NOW()
                      WHERE id = ?`, [u.id]);

    return res.redirect("/admin/agenda");
});

router.post("/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/admin/login"));
});

/* =========================================================
   AGENDA (por día)
========================================================= */
router.get("/agenda", requireAdmin, requireDb, async (req, res) => {
    const date =
        req.query.date ||
        new Date().toLocaleDateString("en-CA", {timeZone: "America/Monterrey"});

    const [trips] = await pool.query(
        `
            SELECT t.id                                          AS trip_id,
                   t.trip_date,
                   dt.direction,
                   dt.depart_time,

                   LEAST(COALESCE(dt.capacity_passengers, 0), ?) AS capacity_passengers,
                   LEAST(COALESCE(agg.used_seats, 0), ?)         AS used_seats,
                   COALESCE(agg.packages, 0)                     AS packages

            FROM transporte_trips t
                     JOIN transporte_departure_templates dt ON dt.id = t.template_id
                     LEFT JOIN (SELECT r.trip_id,

                                       SUM(
                                               CASE
                                                   WHEN r.type = 'PASSENGER' AND r.status <> 'CANCELLED'
                                                       THEN COALESCE(rp.passenger_count, NULLIF(r.seats, 0), 1)
                                                   ELSE 0
                                                   END
                                       ) AS used_seats,

                                       SUM(
                                               CASE
                                                   WHEN r.type = 'PACKAGE' AND r.status <> 'CANCELLED'
                                                       THEN COALESCE(NULLIF(r.seats, 0), 1)
                                                   ELSE 0
                                                   END
                                       ) AS packages

                                FROM transporte_reservations r
                                         LEFT JOIN (SELECT reservation_id, COUNT(*) AS passenger_count
                                                    FROM transporte_reservation_passengers
                                                    GROUP BY reservation_id) rp ON rp.reservation_id = r.id
                                GROUP BY r.trip_id) agg ON agg.trip_id = t.id

            WHERE t.trip_date = ?
            ORDER BY dt.depart_time
        `,
        [MAX_CAP, MAX_CAP, date]
    );

    res.render("admin_agenda", {date, trips, directionLabel});
});

/* =========================================================
   DETALLE SALIDA
========================================================= */
router.get("/trip/:tripId", requireAdmin, requireDb, async (req, res) => {
    const {tripId} = req.params;
    const onlyPending = req.query.onlyPending === "1";

    const [[trip]] = await pool.query(
        `
            SELECT t.id                                          AS trip_id,
                   t.trip_date,
                   dt.direction,
                   dt.depart_time,
                   LEAST(COALESCE(dt.capacity_passengers, 0), ?) AS capacity_passengers
            FROM transporte_trips t
                     JOIN transporte_departure_templates dt ON dt.id = t.template_id
            WHERE t.id = ?
        `,
        [MAX_CAP, tripId]
    );
    if (!trip) return res.status(404).send("Salida no encontrada.");

    const [reservations] = await pool.query(
        `
            SELECT r.*,
                   (SELECT tk.code FROM transporte_tickets tk WHERE tk.reservation_id = r.id LIMIT 1) AS ticket_code,
      GROUP_CONCAT(p.passenger_name ORDER BY p.id SEPARATOR ', ') AS passenger_names,
      COUNT(p.id) AS passenger_count
            FROM transporte_reservations r
                LEFT JOIN transporte_reservation_passengers p
            ON p.reservation_id = r.id
            WHERE r.trip_id = ?
              AND (? = 0
               OR r.status IN ('PENDING_PAYMENT'
                , 'PAY_AT_BOARDING'))
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

/* =========================================================
   ÚLTIMOS REGISTROS
========================================================= */
router.get("/recent", requireAdmin, requireDb, async (req, res) => {
    const qRaw = String(req.query.q || "").trim();
    const q = qRaw ? qRaw : null;

    const pageSize = Math.max(10, Math.min(200, Number(req.query.pageSize || 25)));
    const pageReq = Math.max(1, Number(req.query.page || 1));

    const folioExpr = `CONCAT('RES-', DATE_FORMAT(t.trip_date,'%Y%m%d'), '-', LPAD(r.id,6,'0'))`;
    const phoneDigitsExpr =
        `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(r.phone,''),' ',''),'-',''),'(',''),')',''),'+','')`;

    const where = [];
    const params = [];

    if (q) {
        const like = `%${q}%`;
        const or = [];

        or.push(`${folioExpr} LIKE ?`);
        params.push(like);

        or.push(`EXISTS (
      SELECT 1 FROM transporte_tickets tk2
      WHERE tk2.reservation_id = r.id AND tk2.code LIKE ?
    )`);
        params.push(like);

        or.push(`r.phone LIKE ?`);
        params.push(like);

        const digits = q.replace(/\D/g, "");
        if (digits.length >= 3) {
            or.push(`${phoneDigitsExpr} LIKE ?`);
            params.push(`%${digits}%`);
        }

        if (/^\d+$/.test(q)) {
            or.push(`r.id = ?`);
            params.push(Number(q));
        }

        where.push(`(${or.join(" OR ")})`);
    }

    const pmRaw = String(req.query.pm || "").trim().toUpperCase();
    // I only allow known payment method filters to keep queries safe and predictable.
    const pm = (pmRaw === "TAQUILLA" || pmRaw === "TRANSFERENCIA" || pmRaw === "ONLINE") ? pmRaw : null;

    if (pm) {
        where.push(`UPPER(COALESCE(r.payment_method,'')) = ?`);
        params.push(pm);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [[countRow]] = await pool.query(
        `
            SELECT COUNT(*) AS total
            FROM transporte_reservations r
                     JOIN transporte_trips t ON t.id = r.trip_id
                     JOIN transporte_departure_templates dt ON dt.id = t.template_id
                ${whereSql}
        `,
        params
    );

    const total = Number(countRow?.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pageReq, totalPages);
    const offset = (page - 1) * pageSize;

    const [recentRows] = await pool.query(
        `
            SELECT r.id,
                   r.type,
                   r.status,
                   r.customer_name,
                   r.phone,
                   r.payment_method,
                   r.transfer_ref,
                   r.seats,
                   r.package_details,
                   r.amount_total_mxn,
                   r.created_at,

                   t.id           AS trip_id,
                   t.trip_date,
                   dt.direction,
                   dt.depart_time,

                   (${folioExpr}) AS folio,

                   (SELECT tk.code
                    FROM transporte_tickets tk
                    WHERE tk.reservation_id = r.id
                                     LIMIT 1) AS ticket_code,

      COALESCE(rp.passenger_names, '') AS passenger_names,
      COALESCE(rp.passenger_count, 0) AS passenger_count

            FROM transporte_reservations r
                JOIN transporte_trips t
            ON t.id = r.trip_id
                JOIN transporte_departure_templates dt ON dt.id = t.template_id
                LEFT JOIN (
                SELECT
                reservation_id,
                GROUP_CONCAT(passenger_name ORDER BY id SEPARATOR ', ') AS passenger_names,
                COUNT (*) AS passenger_count
                FROM transporte_reservation_passengers
                GROUP BY reservation_id
                ) rp ON rp.reservation_id = r.id
                ${whereSql}
            ORDER BY r.created_at DESC
                LIMIT ?
            OFFSET ?
        `,
        [...params, pageSize, offset]
    );

    const from = total === 0 ? 0 : offset + 1;
    const to = total === 0 ? 0 : Math.min(offset + recentRows.length, total);

    return res.render("admin_recent", {
        q: qRaw,
        pm: pm || "",          // ✅ add this
        recentRows,
        directionLabel,
        page,
        pageSize,
        total,
        totalPages,
        pages: totalPages,
        from,
        to,
    });

});

/* =========================================================
   HORARIOS (Admin UI)
========================================================= */
router.get("/horarios", requireAdmin, requireDb, async (req, res) => {
    res.render("admin_horarios", {title: "Admin horarios"});
});

/* -----------------------------
   API: Operación por fecha
----------------------------- */
router.get("/api/horarios", requireAdmin, requireDb, async (req, res) => {
    try {
        const date = String(req.query.date || "").trim();
        const direction = String(req.query.direction || "").trim();

        if (!date || !direction) return res.json({ok: true, rows: []});

        await ensureTripsForDate(date);

        const [rows] = await pool.query(
            `
                SELECT dt.id                                         AS template_id,
                       dt.direction,
                       DATE_FORMAT(dt.depart_time, '%H:%i')          AS depart_hhmm,
                       LEAST(COALESCE(dt.capacity_passengers, 0), ?) AS capacity_cap,
                       dt.active                                     AS template_active,

                       tr.id                                         AS trip_id,
                       tr.status                                     AS trip_status,
                       tr.notes                                      AS trip_notes,

                       COALESCE(SUM(
                                        CASE
                                            WHEN r.type = 'PASSENGER'
                                                AND r.status IN ('PENDING_PAYMENT', 'PAY_AT_BOARDING', 'PAID')
                                                THEN COALESCE(rp.passenger_count, NULLIF(r.seats, 0), 1)
                                            ELSE 0
                                            END
                                ), 0)                                AS used_seats

                FROM transporte_departure_templates dt
                         LEFT JOIN transporte_trips tr
                                   ON tr.template_id = dt.id
                                       AND tr.trip_date = ?
                         LEFT JOIN transporte_reservations r
                                   ON r.trip_id = tr.id
                         LEFT JOIN (SELECT reservation_id, COUNT(*) AS passenger_count
                                    FROM transporte_reservation_passengers
                                    GROUP BY reservation_id) rp ON rp.reservation_id = r.id

                WHERE dt.direction = ?
                GROUP BY dt.id, dt.direction, dt.depart_time, dt.capacity_passengers, dt.active,
                         tr.id, tr.status, tr.notes
                ORDER BY dt.depart_time
            `,
            [MAX_CAP, date, direction]
        );

        const out = rows.map((x) => {
            const cap = Number(x.capacity_cap || 0);
            const used = Number(x.used_seats || 0);
            const available = Math.max(0, cap - used);

            return {
                template_id: x.template_id,
                direction: x.direction,
                depart_time: x.depart_hhmm,
                capacity: cap,
                template_active: Number(x.template_active) === 1,

                trip_id: x.trip_id || null,
                trip_status: x.trip_status || "OPEN",
                trip_notes: x.trip_notes || "",

                used,
                available,
            };
        });

        return res.json({ok: true, rows: out});
    } catch (e) {
        console.error(e);
        return res.status(500).json({ok: false});
    }
});

// Desactivar por día (OPEN/CANCELLED)
router.post("/api/horarios/trip", requireAdmin, requireDb, async (req, res) => {
    try {
        const trip_date = String(req.body.trip_date || "").trim();
        const template_id = Number(req.body.template_id);
        const notes = (String(req.body.notes || "").trim() || null);

        // enabled puede venir: true/false, "true"/"false", 1/0, "1"/"0"
        const enabledRaw = req.body.enabled;
        const enabledBool =
            enabledRaw === true ||
            enabledRaw === 1 ||
            enabledRaw === "1" ||
            String(enabledRaw || "").toLowerCase() === "true";

        if (!trip_date || !template_id) {
            return res.status(400).json({ok: false, message: "Faltan datos."});
        }

        const status = enabledBool ? "OPEN" : "CANCELLED";

        let cancelledReservations = 0;
        let rejectedPayments = 0;

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            // 1) Upsert del trip (requiere UNIQUE(template_id, trip_date))
            await conn.query(
                `
                    INSERT INTO transporte_trips (template_id, trip_date, status, notes)
                    VALUES (?, ?, ?, ?) ON DUPLICATE KEY
                    UPDATE
                        status =
                    VALUES (status), notes =
                    VALUES (notes)
                `,
                [template_id, trip_date, status, notes]
            );

            // 2) Obtener trip_id real para este día + template
            const [[tr]] = await conn.query(
                `
                    SELECT id
                    FROM transporte_trips
                    WHERE template_id = ?
                      AND trip_date = ? LIMIT 1
                `,
                [template_id, trip_date]
            );

            const tripId = tr?.id;
            if (!tripId) {
                throw new Error("No pude obtener trip_id tras guardar el viaje.");
            }

            // 3) Si lo deshabilito, cancelo reservas NO pagadas y rechazo pagos pendientes
            if (status === "CANCELLED") {
                const [u1] = await conn.query(
                    `
                        UPDATE transporte_reservations
                        SET status = 'CANCELLED'
                        WHERE trip_id = ?
                          AND status IN ('PENDING_PAYMENT', 'PAY_AT_BOARDING')
                    `,
                    [tripId]
                );

                const [u2] = await conn.query(
                    `
                        UPDATE transporte_payments p
                            JOIN transporte_reservations r
                        ON r.id = p.reservation_id
                            SET p.status = 'REJECTED'
                        WHERE r.trip_id = ?
                          AND p.status = 'PENDING'
                    `,
                    [tripId]
                );

                cancelledReservations = Number(u1.affectedRows || 0);
                rejectedPayments = Number(u2.affectedRows || 0);
            }

            await conn.commit();
            return res.json({ ok: true, cancelledReservations, rejectedPayments });
        } catch (e) {
            await conn.rollback();
            throw e;
        } finally {
            conn.release();
        }
    } catch (e) {
        console.error(e);
        return res.status(500).json({ok: false, message: e.message || "Error"});
    }
});

// Guardar nota (sin cambiar status)
router.post("/api/horarios/notes", requireAdmin, requireDb, async (req, res) => {
    try {
        const trip_date = String(req.body.trip_date || "").trim();
        const template_id = Number(req.body.template_id);
        const notes = String(req.body.notes || "").trim() || null;

        if (!trip_date || !template_id) return res.status(400).json({ok: false});

        await pool.query(
            `
                INSERT INTO transporte_trips (template_id, trip_date, status, notes)
                VALUES (?, ?, 'OPEN', ?) ON DUPLICATE KEY
                UPDATE
                    notes =
                VALUES (notes)
            `,
            [template_id, trip_date, notes]
        );

        return res.json({ok: true});
    } catch (e) {
        console.error(e);
        return res.status(500).json({ok: false});
    }
});

// Lista global: cancelados por día (rango)
router.get("/api/horarios/disabled-days", requireAdmin, requireDb, async (req, res) => {
    try {
        const direction = String(req.query.direction || "").trim();
        const from = String(req.query.from || "").trim();
        const to = String(req.query.to || "").trim();

        if (!direction || !from || !to) return res.json({ok: true, rows: []});

        const [rows] = await pool.query(
            `
                SELECT tr.trip_date,
                       t.id                                         AS template_id,
                       t.direction,
                       DATE_FORMAT(t.depart_time, '%H:%i')          AS depart_hhmm,
                       LEAST(COALESCE(t.capacity_passengers, 0), ?) AS capacity_cap,
                       t.active                                     AS template_active,

                       tr.status                                    AS trip_status,
                       tr.notes                                     AS trip_notes,

                       COALESCE(SUM(
                                        CASE
                                            WHEN r.status <> 'CANCELLED' AND r.type = 'PASSENGER'
                                                THEN COALESCE(rp.passenger_count, NULLIF(r.seats, 0), 1)
                                            ELSE 0
                                            END
                                ), 0)                               AS used_seats

                FROM transporte_trips tr
                         JOIN transporte_departure_templates t ON t.id = tr.template_id
                         LEFT JOIN transporte_reservations r ON r.trip_id = tr.id
                         LEFT JOIN (SELECT reservation_id, COUNT(*) AS passenger_count
                                    FROM transporte_reservation_passengers
                                    GROUP BY reservation_id) rp ON rp.reservation_id = r.id

                WHERE t.direction = ?
                  AND tr.trip_date BETWEEN ? AND ?
                  AND tr.status = 'CANCELLED'

                GROUP BY tr.trip_date, t.id, t.direction, t.depart_time, t.capacity_passengers, t.active, tr.status,
                         tr.notes
                ORDER BY tr.trip_date, t.depart_time
            `,
            [MAX_CAP, direction, from, to]
        );

        const out = rows.map((x) => {
            const cap = Number(x.capacity_cap || 0);
            const used = Number(x.used_seats || 0);
            const available = Math.max(0, cap - used);

            return {
                trip_date: x.trip_date,
                template_id: x.template_id,
                direction: x.direction,
                depart_time: x.depart_hhmm,
                capacity: cap,
                template_active: Number(x.template_active) === 1,
                trip_status: x.trip_status || "CANCELLED",
                trip_notes: x.trip_notes || "",
                used,
                available,
            };
        });

        return res.json({ok: true, rows: out});
    } catch (e) {
        console.error(e);
        return res.status(500).json({ok: false});
    }
});

/* -----------------------------
   API: Horarios base (CRUD)
----------------------------- */
router.get("/api/templates", requireAdmin, requireDb, async (req, res) => {
    try {
        const direction = String(req.query.direction || "").trim();
        const includeInactive = String(req.query.includeInactive || "1") === "1";

        const where = [];
        const params = [];

        if (direction) {
            where.push("direction=?");
            params.push(direction);
        }
        if (!includeInactive) where.push("active=1");

        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

        const [rows] = await pool.query(
            `
                SELECT id,
                       direction,
                       DATE_FORMAT(depart_time, '%H:%i')          AS depart_time,
                       LEAST(COALESCE(capacity_passengers, 0), ?) AS capacity_passengers,
                       active
                FROM transporte_departure_templates ${whereSql}
                ORDER BY direction, depart_time
            `,
            [MAX_CAP, ...params]
        );

        return res.json({ok: true, rows});
    } catch (e) {
        console.error(e);
        return res.status(500).json({ok: false});
    }
});

router.post("/api/templates/create", requireAdmin, requireDb, async (req, res) => {
    try {
        const direction = String(req.body.direction || "").trim();
        const depart_time = String(req.body.depart_time || "").trim(); // "HH:MM"
        const capacity = Math.max(0, Math.min(MAX_CAP, Number(req.body.capacity_passengers || MAX_CAP)));
        const active = Number(req.body.active) ? 1 : 0;

        if (!direction || !depart_time) {
            return res.status(400).json({ok: false, message: "Falta dirección u hora."});
        }

        await pool.query(
            `
                INSERT INTO transporte_departure_templates(direction, depart_time, capacity_passengers, active)
                VALUES (?, ?, ?, ?)
            `,
            [direction, depart_time, capacity, active]
        );

        return res.json({ok: true});
    } catch (e) {
        console.error(e);
        return res
            .status(500)
            .json({ok: false, message: "No pude crear. ¿Ya existe esa hora para esa dirección?"});
    }
});

router.post("/api/templates/update", requireAdmin, requireDb, async (req, res) => {
    try {
        const id = Number(req.body.id);
        const direction = String(req.body.direction || "").trim();
        const depart_time = String(req.body.depart_time || "").trim();
        const capacity = Math.max(0, Math.min(MAX_CAP, Number(req.body.capacity_passengers || MAX_CAP)));
        const active = Number(req.body.active) ? 1 : 0;

        if (!id || !direction || !depart_time) {
            return res.status(400).json({ok: false, message: "Datos inválidos."});
        }

        await pool.query(
            `
                UPDATE transporte_departure_templates
                SET direction=?,
                    depart_time=?,
                    capacity_passengers=?,
                    active=?
                WHERE id = ? LIMIT 1
            `,
            [direction, depart_time, capacity, active, id]
        );

        return res.json({ok: true});
    } catch (e) {
        console.error(e);
        return res
            .status(500)
            .json({ok: false, message: "No pude actualizar. ¿Conflicto de hora/dirección?"});
    }
});

// Safe delete: I only deactivate.
router.post("/api/templates/disable", requireAdmin, requireDb, async (req, res) => {
    try {
        const id = Number(req.body.id);
        if (!id) return res.status(400).json({ok: false});

        await pool.query(`UPDATE transporte_departure_templates
                          SET active=0
                          WHERE id = ? LIMIT 1`, [id]);
        return res.json({ok: true});
    } catch (e) {
        console.error(e);
        return res.status(500).json({ok: false});
    }
});

/* -----------------------------
   API: Precios
----------------------------- */
router.get("/api/pricing", requireAdmin, requireDb, async (req, res) => {
    try {
        const [[row]] = await pool.query(
            `SELECT passenger_price_mxn, package_price_mxn, updated_at
             FROM transporte_settings
             WHERE id = 1`
        );

        return res.json({
            ok: true,
            passenger_price_mxn: Number(row?.passenger_price_mxn ?? 120),
            package_price_mxn: Number(row?.package_price_mxn ?? 120),
            updated_at: row?.updated_at || null,
        });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ok: false});
    }
});

router.post("/api/pricing", requireAdmin, requireDb, async (req, res) => {
    try {
        const passenger = Math.max(0, Number(req.body.passenger_price_mxn || 0));
        const pkg = Math.max(0, Number(req.body.package_price_mxn || 0));

        await pool.query(
            `
                INSERT INTO transporte_settings (id, passenger_price_mxn, package_price_mxn, updated_at)
                VALUES (1, ?, ?, NOW()) ON DUPLICATE KEY
                UPDATE
                    passenger_price_mxn =
                VALUES (passenger_price_mxn), package_price_mxn =
                VALUES (package_price_mxn), updated_at = NOW()
            `,
            [passenger, pkg]
        );

        return res.json({ok: true});
    } catch (e) {
        console.error(e);
        return res.status(500).json({ok: false});
    }
});

function genTicketCode() {
    // I generate a short, URL-safe-ish code for tickets (uppercase for readability).
    return crypto.randomBytes(6).toString("base64url").toUpperCase();
}

/* =========================================================
   MARCAR COMO PAGADO + GENERAR TICKET
   POST /admin/reservation/:id/mark-paid  (router path = /reservation/:id/mark-paid)
========================================================= */
router.post("/reservation/:id/mark-paid", requireAdmin, requireDb, async (req, res) => {
    const id = Number(req.params.id || 0);

    const raw = String(req.body.method || "").trim().toUpperCase();
    const payment_method =
        raw === "CASH" || raw === "EFECTIVO" ? "TAQUILLA" :
            raw === "TRANSFER" || raw === "TRANSFERENCIA" ? "TRANSFERENCIA" :
                raw === "ONLINE" ? "ONLINE" :
                    null;

    if (!id || !payment_method) {
        return res.status(400).send("Datos inválidos.");
    }

    const back = req.get("Referrer") || "/admin/agenda";

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // I lock the reservation so ticket/status updates are race-safe.
        const [[r]] = await conn.query(
            `SELECT id, status FROM transporte_reservations WHERE id=? FOR UPDATE`,
            [id]
        );

        if (!r) {
            await conn.rollback();
            return res.status(404).send("Reserva no encontrada.");
        }

        if (String(r.status || "").toUpperCase() === "CANCELLED") {
            await conn.rollback();
            return res.redirect(back);
        }

        // I mark it as paid.
        await conn.query(
            `UPDATE transporte_reservations
             SET status='PAID', paid_at=NOW(), payment_method=?
             WHERE id=?`,
            [payment_method, id]
        );

        // I create the ticket if missing.
        const [[tk]] = await conn.query(
            `SELECT code FROM transporte_tickets WHERE reservation_id=? LIMIT 1`,
            [id]
        );

        if (!tk?.code) {
            let created = false;

            // I retry a few times in case the ticket code collides with a UNIQUE index.
            for (let attempt = 0; attempt < 10 && !created; attempt++) {
                const code = genTicketCode();
                try {
                    await conn.query(
                        `INSERT INTO transporte_tickets(reservation_id, code, issued_at)
                         VALUES (?, ?, NOW())`,
                        [id, code]
                    );
                    created = true;
                } catch (e) {
                    const msg = String(e?.code || e?.message || "");
                    if (msg.includes("ER_DUP") || msg.includes("DUP")) continue;
                    throw e;
                }
            }

            if (!created) throw new Error("No pude generar el ticket (colisiones).");
        }

        await conn.commit();
        return res.redirect(back);
    } catch (e) {
        try { await conn.rollback(); } catch {}
        console.error(e);
        return res.status(500).send(e.message || "Error al marcar pagado.");
    } finally {
        conn.release();
    }
});

// Cancel reservation (ADMIN)
// Flow for ONLINE+PAID: 1) cancel first, 2) go to Stripe, 3) admin confirms "refund done".
router.post("/reservation/:id/cancel", requireAdmin, requireDb, async (req, res) => {
    const id = Number(req.params.id || 0);
    const back = req.get("Referrer") || "/admin/agenda";
    if (!id) return res.status(400).send("ID inválido.");

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // I lock the reservation row so status/method checks are race-safe.
        const [[r]] = await conn.query(
            `SELECT id, status, payment_method
             FROM transporte_reservations
             WHERE id = ? FOR UPDATE`,
            [id]
        );

        if (!r) {
            await conn.rollback();
            return res.status(404).send("Reserva no encontrada.");
        }

        const st = String(r.status || "").toUpperCase();
        const pm = String(r.payment_method || "").toUpperCase();

        if (st === "CANCELLED") {
            await conn.rollback();
            return res.redirect(back);
        }

        // I do not cancel paid reservations unless they are ONLINE (manual refund flow).
        if (st === "PAID" && pm !== "ONLINE") {
            await conn.rollback();
            return res.redirect(back);
        }

        // ✅ I do cancel here (including ONLINE+PAID). I keep Stripe IDs intact.
        await conn.query(
            `UPDATE transporte_reservations
             SET status='CANCELLED'
             WHERE id = ?
               AND status <> 'CANCELLED'`,
            [id]
        );

        await conn.commit();
        return res.redirect(back);
    } catch (e) {
        try {
            await conn.rollback();
        } catch {
        }
        console.error(e);
        return res.status(500).send(e.message || "Error al cancelar.");
    } finally {
        conn.release();
    }
});

function stripeDashBase() {
    const key = String(process.env.STRIPE_SECRET_KEY || "");
    const isTest = key.startsWith("sk_test_");
    return `https://dashboard.stripe.com${isTest ? "/test" : ""}`;
}

router.get("/reservation/:id/stripe-refund", requireAdmin, requireDb, async (req, res) => {
    const id = Number(req.params.id || 0);
    const back = req.get("Referrer") || "/admin/agenda";
    if (!id) return res.redirect(back);

    const [[r]] = await pool.query(
        `SELECT id, status, payment_method, stripe_payment_intent_id, stripe_session_id
         FROM transporte_reservations
         WHERE id = ? LIMIT 1`,
        [id]
    );
    if (!r) return res.status(404).send("Reserva no encontrada.");

    const st = String(r.status || "").toUpperCase();
    const pm = String(r.payment_method || "").toUpperCase();

    // ✅ Allow if it's ONLINE and was paid (PAID) or already cancelled (because we cancel first).
    if (pm !== "ONLINE" || (st !== "PAID" && st !== "CANCELLED")) return res.redirect(back);

    const base = stripeDashBase();

    // Prefer PaymentIntent
    if (r.stripe_payment_intent_id) {
        return res.redirect(`${base}/payments/${encodeURIComponent(r.stripe_payment_intent_id)}`);
    }

    // Alternative: Checkout Session
    if (r.stripe_session_id) {
        return res.redirect(`${base}/checkout/sessions/${encodeURIComponent(r.stripe_session_id)}`);
    }

    return res.redirect(back);
});

router.post("/reservation/:id/refund-done", requireAdmin, requireDb, async (req, res) => {
    // I mark the reservation as CANCELLED after I manually refunded in Stripe.
    const id = Number(req.params.id || 0);
    const back = req.get("Referrer") || "/admin/agenda";
    if (!id) return res.status(400).send("ID inválido.");

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [[r]] = await conn.query(
            `SELECT id, status, payment_method
             FROM transporte_reservations
             WHERE id = ? FOR UPDATE`,
            [id]
        );
        if (!r) {
            await conn.rollback();
            return res.status(404).send("Reserva no encontrada.");
        }

        const st = String(r.status || "").toUpperCase();
        const pm = String(r.payment_method || "").toUpperCase();

        // I only allow this action for ONLINE + PAID.
        if (!(st === "PAID" && pm === "ONLINE")) {
            await conn.rollback();
            return res.redirect(back);
        }

        await conn.query(
            `UPDATE transporte_reservations
             SET status='CANCELLED'
             WHERE id = ?`,
            [id]
        );

        await conn.commit();
        return res.redirect(back);
    } catch (e) {
        try {
            await conn.rollback();
        } catch {
        }
        console.error(e);
        return res.status(500).send(e.message || "Error al marcar reembolso.");
    } finally {
        conn.release();
    }
});


module.exports = router;
