"use strict";

const express = require("express");
const {pool, hasDb} = require("../db");
const QRCode = require("qrcode");
const PDFDocument = require("pdfkit");
const Stripe = require("stripe");

const stripe = process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY)
    : null;

const router = express.Router();

const ALLOWED_PAYMENT_METHODS = new Set(["TAQUILLA", "TRANSFERENCIA", "ONLINE"]);
const ALLOWED_TYPES = new Set(["PASSENGER", "PACKAGE"]);

const crypto = require("crypto");

function makePublicToken() {
    return crypto.randomBytes(24).toString("base64url"); // Node 20 OK
}

async function ensurePublicTokenByReservationId(reservationId) {
    reservationId = Number(reservationId);

    const [[row]] = await pool.query(
        `SELECT public_token
         FROM transporte_reservations
         WHERE id = ?
         LIMIT 1`,
        [reservationId]
    );

    if (!row) return null;

    const existing = String(row.public_token || "").trim();
    if (existing) return existing;

    // If old reservation doesn't have token yet, I generate and store one.
    // I retry a few times in case of ultra-rare unique collision.
    for (let i = 0; i < 5; i++) {
        const token = makePublicToken();
        try {
            await pool.query(
                `UPDATE transporte_reservations
                 SET public_token = ?
                 WHERE id = ?
                   AND (public_token IS NULL OR public_token = '')`,
                [token, reservationId]
            );

            // Read back to be safe (in case another request won the race).
            const [[again]] = await pool.query(
                `SELECT public_token
                 FROM transporte_reservations
                 WHERE id = ?
                 LIMIT 1`,
                [reservationId]
            );
            const finalTok = String(again?.public_token || "").trim();
            if (finalTok) return finalTok;
        } catch (e) {
            // ignore and retry
        }
    }

    // If it still fails, I fall back to reading it (maybe another request set it).
    const [[finalRow]] = await pool.query(
        `SELECT public_token
         FROM transporte_reservations
         WHERE id = ?
         LIMIT 1`,
        [reservationId]
    );
    return String(finalRow?.public_token || "").trim() || null;
}


// ✅ System max cap
const MAX_CAP = 6;

function requireDb(req, res, next) {
    if (hasDb) return next();
    return res.status(503).render("maintenance", {
        title: "Sitio en configuración",
        message: "El sitio está activo, pero la base de datos aún no está configurada. Intenta más tarde.",
    });
}

function safe(handler) {
    return async (req, res, next) => {
        try {
            await handler(req, res, next);
        } catch (e) {
            console.error(e);
            if (res.headersSent) return next(e);
            return res.status(500).render("maintenance", {
                title: "Error",
                message: "Ocurrió un error temporal. Intenta más tarde.",
            });
        }
    };
}

function directionLabel(direction) {
    return direction === "VIC_TO_LLE" ? "Victoria → Llera" : "Llera → Victoria";
}

// ✅ Folio SIN ceros a la izquierda
function folioFromReservationId(id, dateStr) {
    const ymd = String(dateStr || "").replaceAll("-", "");
    return `RES-${ymd}-${String(id ?? "")}`;
}

// ✅ Get ticket code from transporte_tickets by reservation id
async function getTicketCodeByReservationId(reservationId) {
    const [[tk]] = await pool.query(
        `SELECT code
         FROM transporte_tickets
         WHERE reservation_id = ?
         ORDER BY id DESC
         LIMIT 1`,
        [Number(reservationId)]
    );
    return tk?.code ? String(tk.code) : "";
}

// ✅ Ensure a ticket exists (safe to call multiple times)
//    Requires a UNIQUE KEY on transporte_tickets.reservation_id (recommended).
async function ensureTicketForReservation(reservationId) {
    reservationId = Number(reservationId);

    // If it already exists, return it.
    const existing = await getTicketCodeByReservationId(reservationId);
    if (existing) return existing;

    // Create new code (short + unique enough)
    const code = crypto.randomBytes(5).toString("hex").toUpperCase(); // 10 chars

    try {
        await pool.query(
            `INSERT INTO transporte_tickets(reservation_id, code, issued_at)
             VALUES (?, ?, NOW())`,
            [reservationId, code]
        );
        return code;
    } catch (e) {
        // If race condition (two inserts), just read again
        return await getTicketCodeByReservationId(reservationId);
    }
}

function moneyMXN(n) {
    const v = Number(n || 0);
    return Math.round(v * 100) / 100;
}

/* -----------------------------
   Pricing (DB source of truth)
----------------------------- */

async function getPricing(conn) {
    // I read pricing from transporte_settings (id=1). If missing, I fallback to 120.
    try {
        const [[row]] = await conn.query(
            `SELECT passenger_price_mxn, package_price_mxn
             FROM transporte_settings
             WHERE id = 1`
        );
        const passenger = Number(row?.passenger_price_mxn ?? 120);
        const pkg = Number(row?.package_price_mxn ?? 120);

        return {
            passenger_price_mxn: moneyMXN(passenger),
            package_price_mxn: moneyMXN(pkg),
        };
    } catch {
        return {passenger_price_mxn: 120, package_price_mxn: 120};
    }
}

function computeTotalsWithPricing(type, seats, pricing) {
    // I compute totals based on current pricing (PASSENGER is per seat, PACKAGE is fixed).
    const t = String(type || "").toUpperCase();
    const s = Math.max(1, Number(seats || 1));

    const passengerUnit = moneyMXN(pricing.passenger_price_mxn);
    const packageUnit = moneyMXN(pricing.package_price_mxn);

    const unit = t === "PASSENGER" ? passengerUnit : packageUnit;
    const total = t === "PASSENGER" ? moneyMXN(unit * s) : moneyMXN(unit);

    return {unit_price_mxn: unit, amount_total_mxn: total};
}

/* -----------------------------
   Trips helpers
----------------------------- */

async function getOrCreateTrip(conn, templateId, tripDate) {
    const [rows] = await conn.query(
        "SELECT id, status FROM transporte_trips WHERE template_id=? AND trip_date=?",
        [templateId, tripDate]
    );
    if (rows.length) return {id: rows[0].id, status: rows[0].status || "OPEN"};

    try {
        const [ins] = await conn.query(
            "INSERT INTO transporte_trips(template_id, trip_date, status) VALUES (?, ?, 'OPEN')",
            [templateId, tripDate]
        );
        return {id: ins.insertId, status: "OPEN"};
    } catch {
        const [again] = await conn.query(
            "SELECT id, status FROM transporte_trips WHERE template_id=? AND trip_date=?",
            [templateId, tripDate]
        );
        return {id: again[0].id, status: again[0].status || "OPEN"};
    }
}

async function computeAvailable(conn, tripId) {
    // I compute remaining seats for a trip (only PASSENGER seats count) and clamp capacity to MAX_CAP.
    const [[row]] = await conn.query(
        `
            SELECT GREATEST(
                           LEAST(dt.capacity_passengers, ?) - COALESCE(
                                   SUM(
                                           CASE
                                               WHEN r.type = 'PASSENGER'
                                                   AND r.status IN ('PENDING_PAYMENT', 'PAY_AT_BOARDING', 'PAID')
                                                   THEN COALESCE(rp.passenger_count, NULLIF(r.seats, 0), 1)
                                               ELSE 0
                                               END
                                   ),
                                   0
                                                              ),
                           0
                   ) AS available
            FROM transporte_trips t
                     JOIN transporte_departure_templates dt ON dt.id = t.template_id
                     LEFT JOIN transporte_reservations r ON r.trip_id = t.id
                     LEFT JOIN (SELECT reservation_id, COUNT(*) AS passenger_count
                                FROM transporte_reservation_passengers
                                GROUP BY reservation_id) rp ON rp.reservation_id = r.id
            WHERE t.id = ?
            GROUP BY dt.capacity_passengers
        `,
        [MAX_CAP, tripId]
    );

    return Number(row?.available ?? 0);
}

/**
 * Home
 */
router.get(
    "/",
    requireDb,
    safe(async (req, res) => {
        const [templates] = await pool.query(`
            SELECT direction, depart_time
            FROM transporte_departure_templates
            WHERE active = 1
            ORDER BY depart_time
        `);

        res.render("index", {templates});
    })
);

/**
 * Pantalla de reservar
 */
router.get(
    "/reserve",
    requireDb,
    safe(async (req, res) => {
        // I pass pricing to the UI so it can show correct totals.
        const conn = await pool.getConnection();
        try {
            const pricing = await getPricing(conn);
            res.render("reserve", {error: null, pricing});
        } finally {
            conn.release();
        }
    })
);

/**
 * Availability por fecha/ruta
 */
router.get(
    "/availability",
    requireDb,
    safe(async (req, res) => {
        const {date, direction} = req.query;

        // ✅ up to 6 (and allow 0 for PACKAGE)
        const seatsWanted = Math.max(0, Math.min(MAX_CAP, Number(req.query.seats || 1)));

        const conn = await pool.getConnection();
        try {
            const [templates] = await conn.query(
                `
                    SELECT id, direction, depart_time, capacity_passengers
                    FROM transporte_departure_templates
                    WHERE active = 1
                      AND direction = ?
                    ORDER BY depart_time
                `,
                [direction]
            );

            const results = [];

            for (const t of templates) {
                const trip = await getOrCreateTrip(conn, t.id, date);

                // If the trip is CANCELLED for that date, I hide it from reservable options.
                if (String(trip.status || "OPEN").toUpperCase() !== "OPEN") continue;

                const available = await computeAvailable(conn, trip.id);
                results.push({time: t.depart_time, available});
            }

            res.json({date, direction, seatsWanted, results});
        } finally {
            conn.release();
        }
    })
);

/**
 * Crear reserva (anti-sobreventa)
 */
router.post(
    "/reserve",
    requireDb,
    safe(async (req, res) => {
        let {
            trip_date,
            direction,
            depart_time,
            customer_name,
            phone,
            type,
            package_details,
            payment_method,
            transfer_ref,
        } = req.body;

        // I require contact name for all reservation types.
        customer_name = String(customer_name || "").trim();

        // I normalize phone too (basic trim; pattern is enforced in UI).
        phone = String(phone || "").trim();

        // I normalize package details (only required for PACKAGE).
        package_details = String(package_details || "").trim();

        // I normalize and validate the reservation type.
        type = String(type || "PASSENGER").trim().toUpperCase();
        if (!ALLOWED_TYPES.has(type)) {
            return res.status(400).render("reserve", {error: "Tipo de reserva no válido."});
        }

        // I normalize and validate the payment method.
        payment_method = String(payment_method || "TAQUILLA").trim().toUpperCase();
        if (!ALLOWED_PAYMENT_METHODS.has(payment_method)) {
            return res.status(400).render("reserve", {error: "Método de pago no válido."});
        }

        transfer_ref = String(transfer_ref || "").trim();
        if (!transfer_ref) transfer_ref = null;

        // I map a status that keeps seats reserved correctly.
        const status = payment_method === "TAQUILLA" ? "PAY_AT_BOARDING" : "PENDING_PAYMENT";

        let seats = 0;
        if (type === "PASSENGER") {
            const wanted = Number(req.body.seats || 1);
            seats = Math.max(1, Math.min(MAX_CAP, wanted));
        } else {
            // PACKAGE doesn't consume seats
            seats = 0;
        }

        let passengerNames = req.body.passenger_names || [];
        if (typeof passengerNames === "string") passengerNames = [passengerNames];
        passengerNames = passengerNames.map((s) => String(s).trim()).filter(Boolean);

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            // ✅ pricing source of truth (inside TX)
            const pricing = await getPricing(conn);
            const {unit_price_mxn, amount_total_mxn} = computeTotalsWithPricing(type, seats, pricing);

            const [[template]] = await conn.query(
                `
                    SELECT id
                    FROM transporte_departure_templates
                    WHERE active = 1
                      AND direction = ?
                      AND depart_time = ?
                `,
                [direction, depart_time]
            );
            if (!template) throw new Error("Horario no válido.");

            const trip = await getOrCreateTrip(conn, template.id, trip_date);

            // I lock trip row and verify it is OPEN before reserving.
            const [[tr]] = await conn.query(
                "SELECT id, status FROM transporte_trips WHERE id=? FOR UPDATE",
                [trip.id]
            );

            const st = String(tr?.status || "OPEN").toUpperCase();
            if (st !== "OPEN") {
                await conn.rollback();
                const pricing2 = await getPricing(conn).catch(() => null);
                return res.status(400).render("reserve", {
                    error: "Ese horario está deshabilitado para esa fecha. Elige otra hora.",
                    pricing: pricing2 || undefined,
                });
            }

            const available = await computeAvailable(conn, trip.id);

            if (type === "PASSENGER" && available < seats) {
                await conn.rollback();
                const pricing2 = await getPricing(conn).catch(() => null);
                return res.status(409).render("reserve", {
                    error: "Ya no hay cupo para esa salida. Elige otra hora.",
                    pricing: pricing2 || undefined,
                });
            }

            // ✅ Contact name is always required now.
            if (!customer_name) {
                await conn.rollback();
                const pricing2 = await getPricing(conn).catch(() => null);
                return res.status(400).render("reserve", {
                    error: "Completa el nombre de contacto.",
                    pricing: pricing2 || undefined,
                });
            }

            if (type === "PACKAGE") {
                // ✅ PACKAGE requires details.
                if (!package_details) {
                    await conn.rollback();
                    const pricing2 = await getPricing(conn).catch(() => null);
                    return res.status(400).render("reserve", {
                        error: "Completa el detalle de paquetería.",
                        pricing: pricing2 || undefined,
                    });
                }

                // PACKAGE never stores passenger names.
                passengerNames = [];
            } else {
                // ✅ PASSENGER: passenger names are optional.
                // If the user provided any, I require they match the seat count.
                if (passengerNames.length > 0 && passengerNames.length !== seats) {
                    await conn.rollback();
                    const pricing2 = await getPricing(conn).catch(() => null);
                    return res.status(400).render("reserve", {
                        error: `Si capturas nombres, deben ser ${seats} (uno por asiento). O déjalo vacío para reservar rápido.`,
                        pricing: pricing2 || undefined,
                    });
                }
            }

            let reservationId = null;
            let publicToken = null;

            for (let i = 0; i < 5; i++) {
                publicToken = makePublicToken();
                try {
                    const [ins] = await conn.query(
                        `INSERT INTO transporte_reservations(trip_id, type, seats, customer_name, phone,
                                                             package_details,
                                                             payment_method, transfer_ref, status,
                                                             unit_price_mxn, amount_total_mxn,
                                                             public_token)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            trip.id, type, seats, customer_name, phone,
                            type === "PACKAGE" ? package_details : null,
                            payment_method, transfer_ref, status,
                            unit_price_mxn, amount_total_mxn,
                            publicToken,
                        ]
                    );

                    reservationId = ins.insertId;
                    break;
                } catch (e) {
                    // ER_DUP_ENTRY (por uk_public_token). Reintento.
                    if (String(e?.code) === "ER_DUP_ENTRY") continue;
                    throw e;
                }
            }

            if (!reservationId) throw new Error("No pude generar token público. Intenta de nuevo.");

            if (type === "PASSENGER" && passengerNames.length) {
                const placeholders = passengerNames.map(() => "(?, ?)").join(",");
                const params = passengerNames.flatMap((n) => [reservationId, n]);

                await conn.query(
                    `INSERT INTO transporte_reservation_passengers(reservation_id, passenger_name)
                     VALUES ${placeholders}`,
                    params
                );
            }

            await conn.commit();

            if (payment_method === "ONLINE") {
                return res.redirect(`/checkout/t/${encodeURIComponent(publicToken)}`);
            }
            return res.redirect(`/pay/t/${encodeURIComponent(publicToken)}`);
        } catch (e) {
            await conn.rollback();

            // I try to render reserve again with pricing if possible (so UI doesn't break).
            let pricing = null;
            try {
                const conn2 = await pool.getConnection();
                try {
                    pricing = await getPricing(conn2);
                } finally {
                    conn2.release();
                }
            } catch {
            }

            return res.status(500).render("reserve", {error: e.message, pricing: pricing || undefined});
        } finally {
            conn.release();
        }
    })
);

/**
 * Checkout (ONLINE payment screen)
 */
router.get(
    "/checkout/t/:token",
    requireDb,
    safe(async (req, res) => {
        const token = String(req.params.token || "").trim();

        const [[r]] = await pool.query(
            `
                SELECT r.*, t.trip_date, dt.direction, dt.depart_time
                FROM transporte_reservations r
                         JOIN transporte_trips t ON t.id = r.trip_id
                         JOIN transporte_departure_templates dt ON dt.id = t.template_id
                WHERE r.public_token = ?
                LIMIT 1
            `,
            [token]
        );
        if (!r) return res.status(404).send("Reserva no encontrada.");

        const pm = String(r.payment_method || "").toUpperCase();
        if (pm !== "ONLINE") return res.redirect(`/pay/t/${encodeURIComponent(token)}`);

        const folio = folioFromReservationId(r.id, r.trip_date);

        let total =
            r.amount_total_mxn != null && r.amount_total_mxn !== ""
                ? Number(r.amount_total_mxn)
                : null;

        if (total == null) {
            const conn = await pool.getConnection();
            try {
                const pricing = await getPricing(conn);
                total = computeTotalsWithPricing(r.type, r.seats, pricing).amount_total_mxn;
            } finally {
                conn.release();
            }
        }

        const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY || "";
        if (!stripePublishableKey) {
            return res.status(503).render("maintenance", {
                title: "Pago no disponible",
                message: "Falta STRIPE_PUBLISHABLE_KEY."
            });
        }

        return res.render("checkout", {
            r,
            folio,
            total,
            directionLabel,
            stripePublishableKey,
            // si quieres, pasa token para que JS lo use en create-session
            publicToken: token,
        });
    })
);


/**
 * Confirmación (pendiente de pago)
 */
router.get(
    "/pay/t/:token",
    requireDb,
    safe(async (req, res) => {
        const token = String(req.params.token || "").trim();

        const [[r]] = await pool.query(
            `
                SELECT r.*, t.trip_date, dt.direction, dt.depart_time
                FROM transporte_reservations r
                         JOIN transporte_trips t ON t.id = r.trip_id
                         JOIN transporte_departure_templates dt ON dt.id = t.template_id
                WHERE r.public_token = ?
                LIMIT 1
            `,
            [token]
        );
        if (!r) return res.status(404).send("Reserva no encontrada.");

        // el resto igual que tu /pay/:reservationId
        // usa r.id internamente cuando ocupes el id real
        let ticketCode = await getTicketCodeByReservationId(r.id);
        const pm = String(r.payment_method || "").toUpperCase();
        let st = String(r.status || "").toUpperCase();

        const sid = String(req.query.session_id || "").trim();
        if (pm === "ONLINE" && st !== "PAID" && sid && stripe) {
            try {
                const session = await stripe.checkout.sessions.retrieve(sid);
                if (session?.payment_status === "paid") {
                    await pool.query(
                        `UPDATE transporte_reservations
                         SET status='PAID',
                             paid_at=NOW(),
                             stripe_session_id=COALESCE(stripe_session_id, ?),
                             stripe_payment_intent_id=?
                         WHERE id = ?
                           AND status <> 'PAID'
                           AND UPPER(payment_method) = 'ONLINE'`,
                        [session.id, session.payment_intent || null, Number(r.id)]
                    );
                    st = "PAID";
                    r.status = "PAID";
                }
            } catch {
            }
        }

        // si online y sin sid:
        if (pm === "ONLINE" && st !== "PAID" && !sid) {
            if (st === "EXPIRED") {
                const folio = folioFromReservationId(r.id, r.trip_date);
                return res.render("pay", {
                    r, folio, directionLabel, ticketCode,
                    publicToken: token,
                    expired: true, // <- úsalo en pay.ejs para mostrar aviso
                });
            }
            return res.redirect(`/checkout/t/${encodeURIComponent(token)}`);
        }


        if (st === "PAID" && !ticketCode) ticketCode = await ensureTicketForReservation(r.id);

        const folio = folioFromReservationId(r.id, r.trip_date);
        return res.render("pay", {r, folio, directionLabel, ticketCode, publicToken: token});
    })
);


/**
 * Ver ticket (público)
 */
router.get(
    "/ticket/:code",
    requireDb,
    safe(async (req, res) => {
        const {code} = req.params;

        const [[row]] = await pool.query(
            `
                SELECT tk.code,
                       tk.issued_at,
                       r.id                                                        AS reservation_id,
                       r.customer_name,
                       r.phone,
                       r.type,
                       r.seats,
                       r.package_details,
                       r.payment_method,
                       r.unit_price_mxn,
                       r.amount_total_mxn,
                       t.trip_date,
                       dt.direction,
                       dt.depart_time,
                       GROUP_CONCAT(p.passenger_name ORDER BY p.id SEPARATOR ', ') AS passenger_names
                FROM transporte_tickets tk
                         JOIN transporte_reservations r ON r.id = tk.reservation_id
                         JOIN transporte_trips t ON t.id = r.trip_id
                         JOIN transporte_departure_templates dt ON dt.id = t.template_id
                         LEFT JOIN transporte_reservation_passengers p ON p.reservation_id = r.id
                WHERE tk.code = ?
                GROUP BY tk.code, tk.issued_at, r.id, r.customer_name, r.phone, r.type, r.seats, r.package_details,
                         r.payment_method, r.unit_price_mxn, r.amount_total_mxn,
                         t.trip_date, dt.direction, dt.depart_time
            `,
            [code]
        );

        if (!row) return res.status(404).send("Ticket no encontrado.");

        // ✅ If no passengers captured, I synthesize "Pasajero 1, Pasajero 2..."
        if (row.type === "PASSENGER") {
            const hasNames = String(row.passenger_names || "").trim();
            if (!hasNames) {
                const n = Math.max(1, Number(row.seats || 1));
                row.passenger_names = Array.from({length: n}, (_, i) => `Pasajero ${i + 1}`).join(", ");
            }
        }

        const baseUrl = process.env.BASE_URL || "";
        const url = `${baseUrl}/ticket/${row.code}`;
        const qrDataUrl = await QRCode.toDataURL(url);
        const folio = folioFromReservationId(row.reservation_id, row.trip_date);

        const returnUrl =
            req.query.return && String(req.query.return).startsWith("/")
                ? String(req.query.return)
                : "/";

        res.render("ticket", {
            row,
            folio,
            qrDataUrl,
            directionLabel,
            url,
            returnUrl,
        });
    })
);

/**
 * PDF del ticket
 */
router.get(
    "/ticket/:code/pdf",
    requireDb,
    safe(async (req, res) => {
        const {code} = req.params;

        const [[row]] = await pool.query(
            `
                SELECT tk.code,
                       tk.issued_at,
                       r.id AS reservation_id,
                       r.customer_name,
                       r.phone,
                       r.type,
                       r.seats,
                       r.package_details,
                       r.payment_method,
                       r.unit_price_mxn,
                       r.amount_total_mxn,
                       t.trip_date,
                       dt.direction,
                       dt.depart_time
                FROM transporte_tickets tk
                         JOIN transporte_reservations r ON r.id = tk.reservation_id
                         JOIN transporte_trips t ON t.id = r.trip_id
                         JOIN transporte_departure_templates dt ON dt.id = t.template_id
                WHERE tk.code = ?
            `,
            [code]
        );

        if (!row) return res.status(404).send("Ticket no encontrado.");

        const [pRows] = await pool.query(
            `SELECT passenger_name
             FROM transporte_reservation_passengers
             WHERE reservation_id = ?
             ORDER BY id`,
            [row.reservation_id]
        );

        let passengers = (pRows || []).map((x) => String(x.passenger_name || "").trim()).filter(Boolean);

        // ✅ If no passengers captured, use "Pasajero 1..n" based on seats
        if (row.type === "PASSENGER" && passengers.length === 0) {
            const n = Math.max(1, Number(row.seats || 1));
            passengers = Array.from({length: n}, (_, i) => `Pasajero ${i + 1}`);
        }

        const baseUrl = process.env.BASE_URL || "";
        const url = `${baseUrl}/ticket/${row.code}`;
        const qrPng = await QRCode.toBuffer(url);
        const folio = folioFromReservationId(row.reservation_id, row.trip_date);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${folio}.pdf"`);

        const doc = new PDFDocument({size: "A6", margin: 20});
        doc.pipe(res);

        const WINE = "#6a0f1f";
        const INK = "#0b0b0f";
        const MUTED = "#6b7280";
        const BORDER = "#e5e7eb";

        function dirLabelSafe(direction) {
            return direction === "VIC_TO_LLE" ? "Victoria - Llera" : "Llera - Victoria";
        }

        function ellipsize(str, maxWidth, font = "Helvetica", fontSize = 9.5) {
            const s = String(str ?? "");
            doc.font(font).fontSize(fontSize);
            if (doc.widthOfString(s) <= maxWidth) return s;

            let out = s;
            while (out.length > 0 && doc.widthOfString(out + "…") > maxWidth) out = out.slice(0, -1);
            return (out.length ? out : "") + "…";
        }

        function drawHeader(pageW) {
            const headerH = 58;

            doc.save();
            doc.rect(0, 0, pageW, headerH).fill(WINE);
            doc.restore();

            doc.fillColor("#fff").font("Helvetica-Bold").fontSize(14).text("TransportApp", 20, 16);
            doc.fillColor("#f3f4f6").font("Helvetica").fontSize(9).text("Ticket de servicio", 20, 36);

            const badgeText = "PAGADO";
            doc.font("Helvetica-Bold").fontSize(9);
            const bw = doc.widthOfString(badgeText) + 18;
            const bx = pageW - 20 - bw;
            const by = 18;

            doc.roundedRect(bx, by, bw, 22, 10).fill(INK);
            doc.fillColor("#fff").text(badgeText, bx, by + 6, {width: bw, align: "center"});

            return headerH;
        }

        function hr(y, pageW) {
            doc.moveTo(20, y).lineTo(pageW - 20, y).lineWidth(1).strokeColor(BORDER).stroke();
        }

        function qrLayout(pageW, pageH, qrSize) {
            const footerH = 14;
            const labelH = 14;
            const frameExtra = 20;

            const qrX = (pageW - qrSize) / 2;

            const footerY = pageH - 20 - footerH;
            const labelY = footerY - 6 - labelH;
            const frameY = labelY - 12 - (qrSize + frameExtra);

            const safeBottomY = frameY - 12;
            return {qrX, frameY, labelY, footerY, safeBottomY};
        }

        function kvRow(label, value, y, pageW) {
            const x = 20;
            const w = pageW - 40;
            const h = 20;

            doc.roundedRect(x, y, w, h, 8)
                .lineWidth(1)
                .strokeColor(BORDER)
                .fillColor("#fafafa")
                .fillAndStroke();

            doc.fillColor(MUTED).font("Helvetica").fontSize(8.7).text(label, x + 10, y + 5.5, {
                width: w * 0.55,
            });

            const maxValueWidth = w - 20;
            const safeValue = ellipsize(value, maxValueWidth, "Helvetica", 9.5);

            doc.fillColor(INK).font("Helvetica").fontSize(9.5).text(safeValue, x + 10, y + 5.2, {
                width: w - 20,
                align: "right",
                lineBreak: false,
            });

            return y + 25;
        }

        function drawQR(pageW, pageH, qrSize) {
            const {qrX, frameY, labelY, footerY} = qrLayout(pageW, pageH, qrSize);

            doc.roundedRect(qrX - 10, frameY, qrSize + 20, qrSize + 20, 16)
                .lineWidth(1)
                .strokeColor(BORDER)
                .fillColor("#ffffff")
                .fillAndStroke();

            doc.image(qrPng, qrX, frameY + 10, {fit: [qrSize, qrSize]});

            doc.fillColor(MUTED).font("Helvetica").fontSize(9).text("Escanea para validar", 20, labelY, {
                width: pageW - 40,
                align: "center",
            });

            doc.fillColor(MUTED).font("Helvetica").fontSize(9).text("Presenta este ticket al abordar.", 20, footerY, {
                width: pageW - 40,
                align: "center",
            });
        }

        function pickQrSize(pageW, pageH, headerH, rowsCount) {
            const topBase = headerH + 12 + 18 + 14 + 12 + 16 + rowsCount * 25;

            const candidates = [110, 105, 100, 95, 90, 85, 80, 75, 70];
            for (const s of candidates) {
                const {safeBottomY} = qrLayout(pageW, pageH, s);
                if (topBase <= safeBottomY) return s;
            }
            return 70;
        }

        function drawPage(passengerName, idx, total) {
            const pageW = doc.page.width;
            const pageH = doc.page.height;

            const headerH = drawHeader(pageW);
            const rowsCount = 6;
            const qrSize = pickQrSize(pageW, pageH, headerH, rowsCount);

            drawQR(pageW, pageH, qrSize);

            let y = headerH + 12;

            doc.fillColor(INK).font("Helvetica-Bold").fontSize(12).text(`Folio: ${folio}`, 20, y);
            y += 18;

            doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(`Código: ${row.code}`, 20, y);
            y += 14;

            if (row.type === "PASSENGER") {
                doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(`Pasajero ${idx}/${total}`, 20, y);
                y += 12;
            }

            hr(y + 6, pageW);
            y += 16;

            y = kvRow("Ruta", dirLabelSafe(row.direction), y, pageW);
            y = kvRow("Fecha", String(row.trip_date), y, pageW);
            y = kvRow("Hora", String(row.depart_time), y, pageW);
            y = kvRow("Contacto", String(row.customer_name || "-"), y, pageW);
            y = kvRow("Teléfono", String(row.phone || "-"), y, pageW);

            if (row.type === "PASSENGER") {
                const tight = ellipsize(String(passengerName || "-"), pageW - 80, "Helvetica", 9.5);
                y = kvRow("Pasajero", tight, y, pageW);
            } else {
                const tight = ellipsize(String(row.package_details || "-"), pageW - 80, "Helvetica", 9.5);
                y = kvRow("Detalle", tight, y, pageW);
            }
        }

        try {
            if (row.type === "PASSENGER") {
                const total = passengers.length;
                passengers.forEach((p, i) => {
                    if (i > 0) doc.addPage({size: "A6", margin: 20});
                    drawPage(p, i + 1, total);
                });
            } else {
                drawPage(null, 1, 1);
            }

            doc.end();
        } catch (e) {
            try {
                doc.end();
            } catch {
            }
            return res.status(500).send(e.message);
        }
    })
);

router.get(
    "/pricing",
    requireDb,
    safe(async (req, res) => {
        // I return current pricing for passenger and package from DB settings.
        const conn = await pool.getConnection();
        try {
            const pricing = await getPricing(conn);
            return res.json({ok: true, ...pricing});
        } finally {
            conn.release();
        }
    })
);

router.post(
    "/checkout/t/:token/create-session",
    requireDb,
    safe(async (req, res) => {
        if (!stripe) return res.status(503).json({error: "STRIPE_NOT_CONFIGURED"});

        const token = String(req.params.token || "").trim();
        if (!token) return res.status(400).json({error: "BAD_TOKEN"});

        const [[r]] = await pool.query(
            `
                SELECT r.*, t.trip_date, dt.direction, dt.depart_time
                FROM transporte_reservations r
                         JOIN transporte_trips t ON t.id = r.trip_id
                         JOIN transporte_departure_templates dt ON dt.id = t.template_id
                WHERE r.public_token = ?
                LIMIT 1
            `,
            [token]
        );

        if (!r) return res.status(404).json({error: "NOT_FOUND"});

        const pm = String(r.payment_method || "").toUpperCase();
        if (pm !== "ONLINE") return res.status(409).json({error: "NOT_ONLINE_PAYMENT"});

        const st = String(r.status || "").toUpperCase();
        if (st === "PAID") return res.status(409).json({error: "ALREADY_PAID"});

        // I block expired reservations to avoid overbooking (seat might have been released).
        if (st === "EXPIRED") return res.status(409).json({error: "EXPIRED"});

        // I compute the total from DB snapshot if present, otherwise I recompute with current pricing.
        let totalMxn =
            r.amount_total_mxn != null && r.amount_total_mxn !== ""
                ? Number(r.amount_total_mxn)
                : null;

        if (totalMxn == null || !isFinite(totalMxn) || totalMxn <= 0) {
            const conn = await pool.getConnection();
            try {
                const pricing = await getPricing(conn);
                totalMxn = computeTotalsWithPricing(r.type, r.seats, pricing).amount_total_mxn;
            } finally {
                conn.release();
            }
        }

        // Stripe uses integer cents.
        const amountCents = Math.round(Number(totalMxn || 0) * 100);
        if (!amountCents || amountCents < 1) return res.status(400).json({error: "INVALID_AMOUNT"});

        // I build an absolute base URL safely.
        const baseUrl =
            (process.env.BASE_URL || "").trim() ||
            `${req.protocol}://${req.get("host")}`;

        const returnUrl = `${baseUrl}/pay/t/${encodeURIComponent(token)}?session_id={CHECKOUT_SESSION_ID}`;

        // (Optional) I try to reuse an existing open session if it exists.
        const existingSid = String(r.stripe_session_id || "").trim();
        if (existingSid) {
            try {
                const ses = await stripe.checkout.sessions.retrieve(existingSid);
                const payStatus = String(ses?.payment_status || "").toLowerCase(); // "paid" | "unpaid"
                const sesStatus = String(ses?.status || "").toLowerCase();         // "open" | "complete" | "expired"

                if (payStatus === "paid") {
                    // I keep DB update to webhook/pay route, but I can short-circuit.
                    return res.status(409).json({error: "ALREADY_PAID"});
                }

                // If session is still open, I can reuse it.
                if (sesStatus === "open" && ses?.client_secret) {
                    return res.json({sessionId: ses.id, clientSecret: ses.client_secret});
                }
            } catch {
                // ignore and create a new session
            }
        }

        // I create a new embedded Checkout Session.
        const session = await stripe.checkout.sessions.create({
            ui_mode: "embedded",
            mode: "payment",
            currency: "mxn",

            // I keep it simple: single line item with total.
            line_items: [
                {
                    quantity: 1,
                    price_data: {
                        currency: "mxn",
                        unit_amount: amountCents,
                        product_data: {
                            name: "Servicio de transporte",
                            description: `Folio: RES-${String(r.trip_date || "").replaceAll("-", "")}-${r.id}`,
                        },
                    },
                },
            ],

            // I always return to /pay/t/:token with the session id.
            return_url: returnUrl,

            // I attach identifiers so webhook can update the reservation.
            client_reference_id: String(r.id),
            metadata: {
                reservationId: String(r.id),
                publicToken: token,
            },
        });

        // I persist the session id so I can reuse it if needed.
        try {
            await pool.query(
                `UPDATE transporte_reservations
                 SET stripe_session_id = ?
                 WHERE id = ?
                   AND UPPER(payment_method) = 'ONLINE'
                   AND status <> 'PAID'`,
                [session.id, Number(r.id)]
            );
        } catch {
            // ignore
        }

        return res.json({sessionId: session.id, clientSecret: session.client_secret});
    })
);


/**
 * Stripe webhook (confirmación real)
 * Usa req.rawBody (lo guarda server.js con express.json verify)
 */
router.post("/stripe/webhook", async (req, res) => {
    if (!stripe) return res.status(503).send("Stripe not configured.");

    const sig = req.headers["stripe-signature"];
    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.rawBody, // <- desde server.js
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error("⚠️ Webhook signature verification failed:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        const type = event.type;
        const session = event.data.object;

        const reservationId =
            session?.metadata?.reservationId ||
            session?.metadata?.reservation_id ||
            session?.client_reference_id ||
            null;

        // Helpers
        const paymentStatus = String(session?.payment_status || "").toLowerCase(); // "paid", "unpaid", etc.
        const isPaid = paymentStatus === "paid";

        if (!reservationId) {
            // Siempre 2xx para que Stripe no reintente eternamente
            return res.json({received: true, note: "No reservationId in metadata"});
        }

        // ✅ Pago exitoso (inmediato o async succeeded)
        if (
            type === "checkout.session.completed" ||
            type === "checkout.session.async_payment_succeeded"
        ) {
            if (isPaid) {
                await pool.query(
                    `UPDATE transporte_reservations
                     SET status='PAID',
                         paid_at=NOW(),
                         stripe_session_id=COALESCE(stripe_session_id, ?),
                         stripe_payment_intent_id=?
                     WHERE id = ?
                       AND status <> 'PAID'
                       AND UPPER(payment_method) = 'ONLINE'`,
                    [session.id, session.payment_intent || null, Number(reservationId)]
                );

                // ✅ issue ticket immediately
                await ensureTicketForReservation(reservationId);
            }

            return res.json({received: true});
        }


        // ❌ Async failed (métodos delayed)
        if (type === "checkout.session.async_payment_failed") {
            // Recomendación Stripe: avisar y permitir reintento on-session. :contentReference[oaicite:1]{index=1}
            // En tu DB: dejo la reserva en PENDING_PAYMENT pero limpio session_id para forzar nueva sesión al reintentar.
            await pool.query(
                `UPDATE transporte_reservations
                 SET status='PENDING_PAYMENT',
                     stripe_payment_intent_id=COALESCE(stripe_payment_intent_id, ?),
                     stripe_session_id=NULL
                 WHERE id = ?
                   AND UPPER(payment_method) = 'ONLINE'
                   AND status <> 'PAID'`,
                [session.payment_intent || null, Number(reservationId)]
            );

            return res.json({received: true});
        }

        // ⏳ Sesión expirada (útil para liberar cupo)
        if (type === "checkout.session.expired") {
            await pool.query(
                `UPDATE transporte_reservations
                 SET status='EXPIRED',
                     stripe_session_id=NULL
                 WHERE id = ?
                   AND UPPER(payment_method) = 'ONLINE'
                   AND status <> 'PAID'`,
                [Number(reservationId)]
            );

            return res.json({received: true});
        }

        // Otros eventos: respondemos 2xx
        return res.json({received: true});
    } catch (e) {
        console.error("Error handling Stripe webhook:", e);
        return res.status(500).send("Webhook handler failed.");
    }
});

// Legacy routes
router.get(
    "/pay/:reservationId",
    requireDb,
    safe(async (req, res) => {
        const {reservationId} = req.params;

        const token = await ensurePublicTokenByReservationId(reservationId);
        if (!token) return res.status(404).send("Reserva no encontrada.");

        const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
        return res.redirect(302, `/pay/t/${encodeURIComponent(token)}${qs}`);
    })
);

router.post(
    "/checkout/:reservationId/create-session",
    requireDb,
    safe(async (req, res) => {
        const {reservationId} = req.params;

        const token = await ensurePublicTokenByReservationId(reservationId);
        if (!token) return res.status(404).json({error: "NOT_FOUND"});

        // 307 preserves method + body
        return res.redirect(307, `/checkout/t/${encodeURIComponent(token)}/create-session`);
    })
);


module.exports = router;
