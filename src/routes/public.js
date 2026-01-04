"use strict";

const express = require("express");
const { pool, hasDb } = require("../db");
const QRCode = require("qrcode");
const PDFDocument = require("pdfkit");

const router = express.Router();

const ALLOWED_PAYMENT_METHODS = new Set(["TAQUILLA", "TRANSFERENCIA", "ONLINE"]);
const ALLOWED_TYPES = new Set(["PASSENGER", "PACKAGE"]);

// I keep pricing on the server as the source of truth.
const PRICE_MXN = 120.0;

function requireDb(req, res, next) {
    if (hasDb) return next();
    return res.status(503).render("maintenance", {
        title: "Sitio en configuración",
        message:
            "El sitio está activo, pero la base de datos aún no está configurada. Intenta más tarde.",
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

function pad(n, width) {
    const s = String(n);
    return s.length >= width ? s : "0".repeat(width - s.length) + s;
}

function folioFromReservationId(id, dateStr) {
    const ymd = String(dateStr || "").replaceAll("-", "");
    return `RES-${ymd}-${pad(id, 6)}`;
}

function moneyMXN(n) {
    const v = Number(n || 0);
    return Math.round(v * 100) / 100;
}

function computeTotals(type, seats) {
    // I calculate server totals consistently (PACKAGE is fixed and does not consume seats).
    const unit = moneyMXN(PRICE_MXN);
    const t = String(type || "").toUpperCase();
    const s = Math.max(1, Number(seats || 1));

    const total = t === "PASSENGER" ? moneyMXN(unit * s) : moneyMXN(unit);
    return { unit_price_mxn: unit, amount_total_mxn: total };
}

async function getOrCreateTrip(conn, templateId, tripDate) {
    const [rows] = await conn.query(
        "SELECT id FROM transporte_trips WHERE template_id=? AND trip_date=?",
        [templateId, tripDate]
    );
    if (rows.length) return rows[0].id;

    try {
        const [ins] = await conn.query(
            "INSERT INTO transporte_trips(template_id, trip_date) VALUES (?, ?)",
            [templateId, tripDate]
        );
        return ins.insertId;
    } catch {
        const [again] = await conn.query(
            "SELECT id FROM transporte_trips WHERE template_id=? AND trip_date=?",
            [templateId, tripDate]
        );
        return again[0].id;
    }
}

async function computeAvailable(conn, tripId) {
    const [[row]] = await conn.query(
        `
            SELECT dt.capacity_passengers - COALESCE(SUM(r.seats), 0) AS available
            FROM transporte_trips t
                     JOIN transporte_departure_templates dt ON dt.id = t.template_id
                     LEFT JOIN transporte_reservations r
                               ON r.trip_id = t.id
                                   AND r.type = 'PASSENGER'
                                   AND r.status IN ('PENDING_PAYMENT', 'PAY_AT_BOARDING', 'PAID')
            WHERE t.id = ?
            GROUP BY dt.capacity_passengers
        `,
        [tripId]
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

        res.render("index", { templates });
    })
);

/**
 * Pantalla de reservar
 */
router.get(
    "/reserve",
    requireDb,
    safe(async (req, res) => {
        res.render("reserve", { error: null });
    })
);

/**
 * Availability por fecha/ruta
 */
router.get(
    "/availability",
    requireDb,
    safe(async (req, res) => {
        const { date, direction } = req.query;
        const seatsWanted = Math.max(0, Math.min(7, Number(req.query.seats || 1)));

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
                const tripId = await getOrCreateTrip(conn, t.id, date);
                const available = await computeAvailable(conn, tripId);
                results.push({ time: t.depart_time, available });
            }

            res.json({ date, direction, seatsWanted, results });
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

        // I normalize and validate the reservation type.
        type = String(type || "PASSENGER").trim().toUpperCase();
        if (!ALLOWED_TYPES.has(type)) {
            return res.status(400).render("reserve", { error: "Tipo de reserva no válido." });
        }

        // I normalize and validate the payment method.
        payment_method = String(payment_method || "TAQUILLA").trim().toUpperCase();
        if (!ALLOWED_PAYMENT_METHODS.has(payment_method)) {
            return res.status(400).render("reserve", { error: "Método de pago no válido." });
        }

        transfer_ref = String(transfer_ref || "").trim();
        if (!transfer_ref) transfer_ref = null;

        // I map a status that keeps seats reserved correctly.
        const status = payment_method === "TAQUILLA" ? "PAY_AT_BOARDING" : "PENDING_PAYMENT";

        let seats = 0;
        if (type === "PASSENGER") {
            const wanted = Number(req.body.seats || 1);
            seats = Math.max(1, Math.min(7, wanted));
        } else {
            // I keep PACKAGE without consuming seats.
            seats = 0;
        }

        let passengerNames = req.body.passenger_names || [];
        if (typeof passengerNames === "string") passengerNames = [passengerNames];

        passengerNames = passengerNames
            .map((s) => String(s).trim())
            .filter(Boolean);

        // I compute pricing on the server (source of truth).
        const { unit_price_mxn, amount_total_mxn } = computeTotals(type, seats);

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

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

            const tripId = await getOrCreateTrip(conn, template.id, trip_date);

            await conn.query("SELECT id FROM transporte_trips WHERE id=? FOR UPDATE", [tripId]);

            const available = await computeAvailable(conn, tripId);
            if (type === "PASSENGER" && available < seats) {
                await conn.rollback();
                return res.status(409).render("reserve", {
                    error: "Ya no hay cupo para esa salida. Elige otra hora.",
                });
            }

            if (type === "PASSENGER") {
                if (passengerNames.length !== seats) {
                    await conn.rollback();
                    return res.status(400).render("reserve", {
                        error: `Debes capturar ${seats} nombre(s) de pasajero.`,
                    });
                }
                // contacto = primer pasajero
                customer_name = passengerNames[0];
            } else {
                passengerNames = [];
            }

            const [ins] = await conn.query(
                `
                    INSERT INTO transporte_reservations(
                        trip_id, type, seats, customer_name, phone, package_details,
                        payment_method, transfer_ref, status,
                        unit_price_mxn, amount_total_mxn
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                [
                    tripId,
                    type,
                    seats,
                    customer_name,
                    phone,
                    package_details || null,
                    payment_method,
                    transfer_ref,
                    status,
                    unit_price_mxn,
                    amount_total_mxn,
                ]
            );

            const reservationId = ins.insertId;

            if (type === "PASSENGER" && passengerNames.length) {
                const placeholders = passengerNames.map(() => "(?, ?)").join(",");
                const params = passengerNames.flatMap((n) => [reservationId, n]);

                await conn.query(
                    `INSERT INTO transporte_reservation_passengers(reservation_id, passenger_name) VALUES ${placeholders}`,
                    params
                );
            }

            await conn.commit();

            // ✅ ONLINE -> checkout first, then /pay
            if (payment_method === "ONLINE") {
                return res.redirect(`/checkout/${reservationId}`);
            }

            return res.redirect(`/pay/${reservationId}`);
        } catch (e) {
            await conn.rollback();
            res.status(500).render("reserve", { error: e.message });
        } finally {
            conn.release();
        }
    })
);

/**
 * Checkout (ONLINE payment screen)
 * Replace this with Stripe/MercadoPago session creation later.
 */
router.get(
    "/checkout/:reservationId",
    requireDb,
    safe(async (req, res) => {
        const { reservationId } = req.params;

        const [[r]] = await pool.query(
            `
            SELECT r.*, t.trip_date, dt.direction, dt.depart_time
            FROM transporte_reservations r
            JOIN transporte_trips t ON t.id = r.trip_id
            JOIN transporte_departure_templates dt ON dt.id = t.template_id
            WHERE r.id = ?
            `,
            [reservationId]
        );
        if (!r) return res.status(404).send("Reserva no encontrada.");

        const pm = String(r.payment_method || "").toUpperCase();
        if (pm !== "ONLINE") {
            return res.redirect(`/pay/${reservationId}`);
        }

        const folio = folioFromReservationId(r.id, r.trip_date);

        // I trust DB totals if present.
        const total =
            r.amount_total_mxn != null && r.amount_total_mxn !== ""
                ? Number(r.amount_total_mxn)
                : computeTotals(r.type, r.seats).amount_total_mxn;

        res.render("checkout", { r, folio, total, directionLabel });
    })
);

router.post(
    "/checkout/:reservationId/complete",
    requireDb,
    safe(async (req, res) => {
        const { reservationId } = req.params;

        const [[r]] = await pool.query(
            `SELECT id, payment_method, status FROM transporte_reservations WHERE id=?`,
            [reservationId]
        );
        if (!r) return res.status(404).send("Reserva no encontrada.");

        const pm = String(r.payment_method || "").toUpperCase();
        if (pm !== "ONLINE") {
            return res.redirect(`/pay/${reservationId}`);
        }

        // I mark as PAID after a successful online payment.
        await pool.query(
            `UPDATE transporte_reservations
             SET status='PAID', paid_at=NOW()
             WHERE id=?`,
            [reservationId]
        );

        return res.redirect(`/pay/${reservationId}`);
    })
);


/**
 * Confirmación (pendiente de pago)
 */
router.get(
    "/pay/:reservationId",
    requireDb,
    safe(async (req, res) => {
        const { reservationId } = req.params;

        const [[r]] = await pool.query(
            `
                SELECT r.*, t.trip_date, dt.direction, dt.depart_time
                FROM transporte_reservations r
                         JOIN transporte_trips t ON t.id = r.trip_id
                         JOIN transporte_departure_templates dt ON dt.id = t.template_id
                WHERE r.id = ?
            `,
            [reservationId]
        );
        if (!r) return res.status(404).send("Reserva no encontrada.");

        // ✅ If ONLINE and still unpaid, I force checkout first.
        const pm = String(r.payment_method || "").toUpperCase();
        const st = String(r.status || "").toUpperCase();

        // if it's online and NOT paid yet -> go checkout
        if (pm === "ONLINE" && st !== "PAID") {
            return res.redirect(`/checkout/${reservationId}`);
        }

        const folio = folioFromReservationId(r.id, r.trip_date);
        res.render("pay", { r, folio, directionLabel });
    })
);

/**
 * Ver ticket (público)
 */
router.get(
    "/ticket/:code",
    requireDb,
    safe(async (req, res) => {
        const { code } = req.params;

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
        const { code } = req.params;

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
            `SELECT passenger_name FROM transporte_reservation_passengers WHERE reservation_id=? ORDER BY id`,
            [row.reservation_id]
        );

        let passengers = pRows
            .map((x) => String(x.passenger_name || "").trim())
            .filter(Boolean);

        if (row.type === "PASSENGER" && passengers.length === 0) {
            passengers = [row.customer_name || "Pasajero"];
        }

        const baseUrl = process.env.BASE_URL || "";
        const url = `${baseUrl}/ticket/${row.code}`;
        const qrPng = await QRCode.toBuffer(url);
        const folio = folioFromReservationId(row.reservation_id, row.trip_date);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${folio}.pdf"`);

        const doc = new PDFDocument({ size: "A6", margin: 20 });
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
            while (out.length > 0 && doc.widthOfString(out + "…") > maxWidth) {
                out = out.slice(0, -1);
            }
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
            doc.fillColor("#fff").text(badgeText, bx, by + 6, { width: bw, align: "center" });

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
            return { qrX, frameY, labelY, footerY, safeBottomY };
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
            const { qrX, frameY, labelY, footerY } = qrLayout(pageW, pageH, qrSize);

            doc.roundedRect(qrX - 10, frameY, qrSize + 20, qrSize + 20, 16)
                .lineWidth(1)
                .strokeColor(BORDER)
                .fillColor("#ffffff")
                .fillAndStroke();

            doc.image(qrPng, qrX, frameY + 10, { fit: [qrSize, qrSize] });

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
                const { safeBottomY } = qrLayout(pageW, pageH, s);
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

            const { safeBottomY } = qrLayout(pageW, pageH, qrSize);
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
                const v = String(passengerName || "-");
                const tight = ellipsize(v, pageW - 80, "Helvetica", 9.5);
                y = kvRow("Pasajero", tight, y, pageW);
            } else {
                const d = String(row.package_details || "-");
                const tight = ellipsize(d, pageW - 80, "Helvetica", 9.5);
                y = kvRow("Detalle", tight, y, pageW);
            }

            if (y > safeBottomY) {
                // I keep this as a final safety check; pickQrSize should prevent overflow.
            }
        }

        try {
            if (row.type === "PASSENGER") {
                const total = passengers.length;
                passengers.forEach((p, i) => {
                    if (i > 0) doc.addPage({ size: "A6", margin: 20 });
                    drawPage(p, i + 1, total);
                });
            } else {
                drawPage(null, 1, 1);
            }

            doc.end();
        } catch (e) {
            try { doc.end(); } catch {}
            return res.status(500).send(e.message);
        }
    })
);



module.exports = router;
