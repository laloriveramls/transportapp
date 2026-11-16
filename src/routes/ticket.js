"use strict";

const express = require("express");
const QRCode = require("qrcode");
const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");
const { pool, hasDb } = require("../db");
const { requireDb } = require("../middleware/requireDb");
const { formatRouteLabel, routeEndpoints, isLocalLlera } = require("../locations");
const specialEvents = require("../specialEvents");

const router = express.Router();

/* -----------------------------
   Helpers
----------------------------- */

function directionLabel(direction) {
    return direction === "VIC_TO_LLE" ? "Victoria → Llera" : "Llera → Victoria";
}

function buildBaseUrl(req) {
    const env = String(process.env.BASE_URL || "").trim();
    if (env) return env.replace(/\/+$/, "");

    const proto = req.headers["x-forwarded-proto"]
        ? String(req.headers["x-forwarded-proto"]).split(",")[0].trim()
        : req.protocol;

    return `${proto}://${req.get("host")}`;
}

function mm(n) {
    // I convert millimeters to PDF points (72pt = 1 inch).
    return (Number(n) * 72) / 25.4;
}

function money(n) {
    const v = Number(n || 0);
    try {
        return v.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
    } catch {
        return "$" + (Math.round(v * 100) / 100);
    }
}

function folioFrom(tripDate, reservationId, dailySeq) {
    // Same rule as public.js: the daily sequence wins, the reservation id is only a fallback.
    const ymd = String(tripDate || "").replaceAll("-", "");
    const seqRaw = Number(dailySeq);
    const n = Number.isFinite(seqRaw) && seqRaw > 0 ? seqRaw : Number(reservationId || 0);
    return `RES-${ymd}-${n > 0 ? String(n).padStart(3, "0") : "000"}`;
}

function pickHHMM(timeStr) {
    return String(timeStr || "").slice(0, 5);
}

function formatTripDate(iso) {
    const s = String(iso || "").slice(0, 10);
    const [y, m, d] = s.split("-").map(Number);
    if (!y || !m || !d) return s || "-";
    try {
        return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-MX", {
            weekday: "short",
            day: "numeric",
            month: "short",
            year: "numeric",
            timeZone: "UTC",
        });
    } catch {
        return s;
    }
}

function statusMeta(status) {
    const s = String(status || "").toUpperCase();
    if (s === "PAID") return { label: "Pagado", cls: "pill--ok", icon: "check" };
    if (s === "CANCELLED") return { label: "Cancelado", cls: "pill--bad", icon: "ban" };
    if (s === "PENDING_PAYMENT") return { label: "Pendiente de pago", cls: "pill--warn", icon: "hourglass" };
    if (s === "PAY_AT_BOARDING") return { label: "Pago en taquilla", cls: "pill--warn", icon: "ticket" };
    return { label: "Ticket", cls: "", icon: "ticket" };
}

function paymentLabel(method) {
    const pmMap = {
        TAQUILLA: "Taquilla",
        TRANSFERENCIA: "Transferencia",
        ONLINE: "Pago en línea",
        CASH: "Efectivo",
        EFECTIVO: "Efectivo",
    };
    const raw = String(method || "").trim().toUpperCase();
    return pmMap[raw] || raw || "-";
}

function phoneHref(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (digits.length === 10) return `tel:+52${digits}`;
    if (digits.length > 10) return `tel:+${digits}`;
    return digits ? `tel:${digits}` : "";
}

function buildTicketViewModel(row, extras) {
    const isPassenger = String(row.type || "").toUpperCase() === "PASSENGER";
    const passengers = String(row.passenger_names || "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);

    const totalNum =
        row.amount_total_mxn != null && row.amount_total_mxn !== "" && !Number.isNaN(Number(row.amount_total_mxn))
            ? Number(row.amount_total_mxn)
            : null;

    const endpoints = routeEndpoints(row.direction, row.vic_location, row.from_stop, row.to_stop);

    return {
        row,
        isPassenger,
        isPackage: !isPassenger,
        typeLabel: isPassenger ? "Pasaje" : "Paquetería",
        status: statusMeta(row.status),
        paymentLabel: paymentLabel(row.payment_method),
        paymentRaw: String(row.payment_method || "").trim(),
        transferRef: String(row.transfer_ref || "").trim(),
        passengers,
        totalLabel: totalNum != null ? money(totalNum) : null,
        tripDateLabel: formatTripDate(row.trip_date),
        tripDateRaw: String(row.trip_date || "").slice(0, 10),
        departTime: pickHHMM(row.depart_time),
        fromLabel: endpoints.fromLabel,
        toLabel: endpoints.toLabel,
        routeLabel: formatRouteLabel(row.direction, row.vic_location, " → ", row.from_stop, row.to_stop),
        phoneHref: phoneHref(row.phone),
        ...extras,
    };
}

/* -----------------------------
   GET /ticket/:code  (HTML)
----------------------------- */
router.get("/ticket/:code", requireDb, async (req, res) => {
    const { code } = req.params;

    const [[row]] = await pool.query(
        `
            SELECT
                tk.code,
                r.id AS reservation_id,
                r.daily_seq,
                r.customer_name,
                r.phone,
                r.type,
                r.status,
                r.seats,
                r.package_details,
                r.vic_location,
                r.from_stop,
                r.to_stop,
                r.payment_method,
                r.transfer_ref,
                r.amount_total_mxn,
                r.created_at,

                t.trip_date,
                dt.direction,
                dt.depart_time,
                dt.special_event_id,

                GROUP_CONCAT(p.passenger_name ORDER BY p.id SEPARATOR ', ') AS passenger_names
            FROM transporte_tickets tk
                     JOIN transporte_reservations r ON r.id = tk.reservation_id
                     JOIN transporte_trips t ON t.id = r.trip_id
                     JOIN transporte_departure_templates dt ON dt.id = t.template_id
                     LEFT JOIN transporte_reservation_passengers p ON p.reservation_id = r.id
            WHERE tk.code = ?
            GROUP BY
                tk.code, r.id, r.daily_seq, r.customer_name, r.phone, r.type, r.status, r.seats, r.package_details,
                r.vic_location, r.from_stop, r.to_stop, r.payment_method, r.transfer_ref, r.amount_total_mxn, r.created_at,
                t.trip_date, dt.direction, dt.depart_time, dt.special_event_id
            LIMIT 1
        `,
        [code]
    );

    if (!row) return res.status(404).send("Ticket no encontrado.");

    let specialEvent = null;
    if (Number(row.special_event_id || 0)) {
        try {
            specialEvent = await specialEvents.getEventById(pool, row.special_event_id);
        } catch {
        }
    }

    // ✅ If passengers were not captured, I show placeholders: Pasajero 1..N
    if (String(row.type || "").toUpperCase() === "PASSENGER") {
        const hasNames = String(row.passenger_names || "").trim();
        if (!hasNames) {
            const n = Math.max(1, Number(row.seats || 1));
            row.passenger_names = Array.from({ length: n }, (_, i) => `Pasajero ${i + 1}`).join(", ");
        }
    }

    const baseUrl = buildBaseUrl(req);
    const url = `${baseUrl}/ticket/${row.code}`;
    const folio = folioFrom(row.trip_date, row.reservation_id, row.daily_seq);
    const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 420, color: { dark: "#111111", light: "#ffffff" } });
    const returnUrl = req.query.return ? String(req.query.return) : null;
    const ticketPath = `/ticket/${row.code}`;
    const returnQuery = returnUrl ? `?return=${encodeURIComponent(returnUrl)}` : "";
    const pdfReturn = encodeURIComponent(ticketPath + returnQuery);

    return res.render("ticket", buildTicketViewModel(row, {
        folio,
        url,
        qrDataUrl,
        returnUrl: returnUrl || "/",
        pdfUrl: `${ticketPath}/pdf/view?return=${pdfReturn}`,
        printUrl: `${ticketPath}/print`,
        directionLabel,
        ...(specialEvent ? {
            routeLabel: `${formatRouteLabel(row.direction, row.vic_location, " → ", row.from_stop, row.to_stop)}, ${specialEvents.routeNote(specialEvent)}`,
            specialNote: specialEvents.routeNote(specialEvent),
            specialIcon: specialEvent.icon,
        } : {}),
    }));
});

/* -----------------------------
   GET /ticket/:code/pdf
   - 48mm effective width
   - 1 page per passenger
   - dotted separators
   - NO header frame
   - bigger logo
   - smaller "TICKET PAGADO" + smaller business lines + smaller KV
   - ✅ If passengers were not captured, I print Pasajero 1..N
----------------------------- */
router.get("/ticket/:code/pdf", requireDb, async (req, res) => {
    const { code } = req.params;

    if (String(req.query.raw || "") !== "1") {
        const returnParam =
            req.query.return && String(req.query.return).startsWith("/")
                ? `?return=${encodeURIComponent(String(req.query.return))}`
                : "";

        return res.redirect(`/ticket/${encodeURIComponent(code)}/pdf/view${returnParam}`);
    }

    const [[row]] = await pool.query(
        `
            SELECT
                tk.code,
                r.id AS reservation_id,
                r.daily_seq,
                r.customer_name,
                r.phone,
                r.type,
                r.status,
                r.seats,
                r.package_details,
                r.vic_location,
                r.from_stop,
                r.to_stop,
                r.payment_method,
                r.transfer_ref,
                r.amount_total_mxn,
                r.created_at,

                t.trip_date,
                dt.direction,
                dt.depart_time
            FROM transporte_tickets tk
                     JOIN transporte_reservations r ON r.id = tk.reservation_id
                     JOIN transporte_trips t ON t.id = r.trip_id
                     JOIN transporte_departure_templates dt ON dt.id = t.template_id
            WHERE tk.code = ?
            LIMIT 1
        `,
        [code]
    );

    if (!row) return res.status(404).send("Ticket no encontrado.");

    const baseUrl = buildBaseUrl(req);
    const url = `${baseUrl}/ticket/${row.code}`;
    const folio = folioFrom(row.trip_date, row.reservation_id, row.daily_seq);

    // I generate a tight QR for crisp thermal print.
    const qrPng = await QRCode.toBuffer(url, { margin: 1, scale: 10, errorCorrectionLevel: "M" });

    // Logo path (this file is in src/routes, so I go up to project root)
    const logoPath = path.join(__dirname, "..", "..", "public", "assets", "logoticket.png");
    const hasLogo = fs.existsSync(logoPath);

    // Business lines (smaller)
    const BRAND_LINE_1 = "";
    const BRAND_LINE_2 = "Comodidad, seguridad y WiFi gratis";
    const BRAND_LINE_3 = "WhatsApp: (834) 475-63-76";

    // ===== Ticket térmico de 48 mm: solo blanco y negro, una página por pasajero =====
    const PAGE_W_MM = 48;
    const PAD_MM = 1.6;

    const mmToPt = (n) => (Number(n) * 72) / 25.4;
    const ptToMm = (pt) => (Number(pt) * 25.4) / 72;

    const PAGE_W = mmToPt(PAGE_W_MM);
    const X = mmToPt(PAD_MM);
    const W = PAGE_W - X * 2;

    const hhmm = pickHHMM(row.depart_time);
    const [hh, mi] = hhmm.split(":").map(Number);
    const hora12 = Number.isFinite(hh) ? `${hh % 12 || 12}:${String(mi || 0).padStart(2, "0")}` : hhmm;
    const horaSufijo = Number.isFinite(hh) ? (hh < 12 ? "a. m." : "p. m.") : "";

    // "lun, 9 de feb de 2026" -> semana y día/mes por un lado, año aparte
    const fechaLarga = formatTripDate(row.trip_date).replace(/,/g, "").replace(/\bde\b/g, "").replace(/\s+/g, " ").trim();
    const fechaPartes = fechaLarga.split(" ");
    const fechaCorta = fechaPartes.length >= 4 ? fechaPartes.slice(0, 3).join(" ") : fechaLarga;
    const fechaAnio = fechaPartes.length >= 4 ? fechaPartes[3] : "";

    const rawStatus = String(row.status || "").toUpperCase();
    const STATUS_VIEW = {
        PAID: { text: "PAGADO", solid: true },
        PAY_AT_BOARDING: { text: "PAGO AL ABORDAR", solid: true },
        PENDING_PAYMENT: { text: "PENDIENTE DE PAGO", solid: false },
        CANCELLED: { text: "CANCELADO", solid: false },
        EXPIRED: { text: "EXPIRADO", solid: false },
    };
    const statusView = STATUS_VIEW[rawStatus] || { text: "TICKET", solid: true };
    const isVoid = rawStatus === "CANCELLED" || rawStatus === "EXPIRED" || rawStatus === "PENDING_PAYMENT";

    const isLocal = isLocalLlera(row.from_stop, row.to_stop);
    const ends = routeEndpoints(row.direction, row.vic_location, row.from_stop, row.to_stop);
    const typeIsPassenger = String(row.type || "").toUpperCase() === "PASSENGER";

    const totalNum =
        row.amount_total_mxn != null && row.amount_total_mxn !== "" && !Number.isNaN(Number(row.amount_total_mxn))
            ? Number(row.amount_total_mxn)
            : null;

    // 1 página por pasajero
    let passengerNames = [];
    if (typeIsPassenger) {
        const [ps] = await pool.query(
            `SELECT passenger_name FROM transporte_reservation_passengers WHERE reservation_id = ? ORDER BY id`,
            [row.reservation_id]
        );
        passengerNames = (ps || []).map((p) => String(p.passenger_name || "").trim()).filter(Boolean);
        if (passengerNames.length === 0) {
            const n = Math.max(1, Number(row.seats || 1));
            passengerNames = Array.from({ length: n }, (_, i) => `Pasajero ${i + 1}`);
        }
    } else {
        passengerNames = [null];
    }

    const paxCount = typeIsPassenger ? Math.max(1, passengerNames.length) : 1;
    const totalPerPageNum = typeIsPassenger && totalNum != null ? totalNum / paxCount : totalNum;
    const totalPerPageTxt = totalPerPageNum != null ? money(totalPerPageNum) : null;
    const totalLabel = typeIsPassenger && paxCount > 1 ? "TOTAL (1 PASAJERO)" : "TOTAL";

    // Dirección para quien no puede escanear el QR
    const hostTxt = baseUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");

    /**
     * Dibuja un ticket completo en `doc` y devuelve la altura usada (mm).
     * Se usa dos veces: primero en un documento de medición para ajustar el alto de la página,
     * y luego para imprimir de verdad. Así el diseño y la medida nunca se desfasan.
     */
    const drawTicket = (doc, passengerName, idx, total) => {
        let y = mmToPt(1.2);
        const BLACK = "#000";
        const WHITE = "#fff";

        const textBlock = (txt, o = {}) => {
            const font = o.font || "Helvetica";
            const size = o.size || 7.4;
            const x0 = o.x != null ? o.x : X;
            const w0 = o.w != null ? o.w : W;
            const opts = { width: w0, align: o.align || "left", characterSpacing: o.spacing || 0 };
            const t = String(txt == null ? "" : txt);
            doc.font(font).fontSize(size).fillColor(o.color || BLACK);
            const h = doc.heightOfString(t, opts);
            doc.text(t, x0, o.y != null ? o.y : y, opts);
            if (o.y == null) y += h + mmToPt(o.gap != null ? o.gap : 0.5);
            return h;
        };

        const rule = (dashed, gapMm = 1.1) => {
            y += mmToPt(gapMm / 2);
            doc.save().strokeColor(BLACK).lineWidth(dashed ? 0.9 : 0.4);
            if (dashed) doc.lineCap("round").dash(1, { space: 2.4 });
            doc.moveTo(X, y).lineTo(X + W, y).stroke();
            if (dashed) doc.undash();
            doc.restore();
            y += mmToPt(gapMm / 2);
        };

        // --- Encabezado
        if (hasLogo) {
            const logoW = mmToPt(40);
            const logoH = logoW * (705 / 1152);
            doc.image(logoPath, X + (W - logoW) / 2, y, { fit: [logoW, logoH] });
            y += logoH + mmToPt(0.8);
        } else {
            textBlock("TransportApp", { font: "Helvetica-Bold", size: 12, align: "center", gap: 0.6 });
        }
        textBlock(BRAND_LINE_2, { size: 6.4, align: "center", gap: 0.2 });
        textBlock(BRAND_LINE_3, { font: "Helvetica-Bold", size: 7, align: "center", gap: 1.0 });

        // --- Estado del ticket (relleno si es válido, solo borde si no)
        {
            let fs = 7.6;
            doc.font("Helvetica-Bold").fontSize(fs);
            const padX = mmToPt(1.6);
            const maxTextW = W - padX * 2;
            while (fs > 6 && doc.widthOfString(statusView.text, { characterSpacing: 0.6 }) > maxTextW) { fs -= 0.2; doc.fontSize(fs); }
            const lineH = doc.currentLineHeight(true);
            const chipH = lineH + mmToPt(1.4);
            doc.save();
            if (statusView.solid) {
                doc.roundedRect(X, y, W, chipH, 2.4).fill(BLACK);
            } else {
                doc.roundedRect(X + 0.5, y + 0.5, W - 1, chipH - 1, 2.4).lineWidth(1).stroke(BLACK);
            }
            doc.restore();
            doc.font("Helvetica-Bold").fontSize(fs).fillColor(statusView.solid ? WHITE : BLACK);
            doc.text(statusView.text, X, y + (chipH - lineH) / 2 + mmToPt(0.1), { width: W, align: "center", characterSpacing: 0.6, lineBreak: false });
            y += chipH + mmToPt(0.6);
            if (isVoid) {
                textBlock(rawStatus === "PENDING_PAYMENT" ? "AUN NO ES VALIDO PARA ABORDAR" : "NO VALIDO PARA ABORDAR", {
                    font: "Helvetica-Bold", size: 5.8, align: "center", gap: 0.4,
                });
            }
        }

        // --- Folio y pasajero
        textBlock(folio, { font: "Helvetica-Bold", size: 9.2, align: "center", gap: 0.2 });
        if (typeIsPassenger && total > 1) {
            textBlock(`PASAJERO ${idx} DE ${total}`, { size: 6.2, align: "center", gap: 0.4 });
        } else {
            y += mmToPt(0.3);
        }
        rule(true);

        // --- Ruta
        if (isLocal) {
            textBlock("PAQUETERIA LOCAL", { font: "Helvetica-Bold", size: 9.6, align: "center", gap: 0.1 });
            textBlock(`en ${String(ends.fromLabel || "Llera")}`, { size: 7.4, align: "center", gap: 0.5 });
        } else {
            textBlock("ORIGEN", { size: 5.6, align: "center", spacing: 0.8, gap: 0.05 });
            textBlock(String(ends.fromLabel || "").toUpperCase(), { font: "Helvetica-Bold", size: 9.4, align: "center", gap: 0.35 });
            // flecha hacia abajo
            {
                const cx = X + W / 2;
                doc.save().fillColor(BLACK).strokeColor(BLACK).lineWidth(1);
                doc.moveTo(cx, y).lineTo(cx, y + mmToPt(2.0)).stroke();
                doc.moveTo(cx - mmToPt(1.1), y + mmToPt(1.2)).lineTo(cx + mmToPt(1.1), y + mmToPt(1.2)).lineTo(cx, y + mmToPt(2.5)).closePath().fill();
                doc.restore();
                y += mmToPt(2.9);
            }
            textBlock("DESTINO", { size: 5.6, align: "center", spacing: 0.8, gap: 0.05 });
            textBlock(String(ends.toLabel || "").toUpperCase(), { font: "Helvetica-Bold", size: 9.4, align: "center", gap: 0.7 });
        }

        // --- Fecha y hora en dos celdas
        {
            const boxH = mmToPt(11.2);
            doc.save().lineWidth(0.9).strokeColor(BLACK).roundedRect(X, y, W, boxH, 2.4).stroke();
            doc.moveTo(X + W * 0.5, y + mmToPt(1.2)).lineTo(X + W * 0.5, y + boxH - mmToPt(1.2)).lineWidth(0.5).stroke();
            doc.restore();

            const cw = W * 0.5 - mmToPt(1.4);
            textBlock("FECHA", { y: y + mmToPt(1.3), x: X + mmToPt(0.7), w: cw, size: 5.6, spacing: 0.8, align: "center" });
            textBlock(fechaCorta, { y: y + mmToPt(3.5), x: X + mmToPt(0.7), w: cw, font: "Helvetica-Bold", size: 8.6, align: "center" });
            if (fechaAnio) textBlock(fechaAnio, { y: y + mmToPt(7.2), x: X + mmToPt(0.7), w: cw, size: 6.4, align: "center" });

            const rx = X + W * 0.5 + mmToPt(0.7);
            textBlock("SALIDA", { y: y + mmToPt(1.3), x: rx, w: cw, size: 5.6, spacing: 0.8, align: "center" });
            textBlock(hora12, { y: y + mmToPt(3.0), x: rx, w: cw, font: "Helvetica-Bold", size: 13, align: "center" });
            if (horaSufijo) textBlock(horaSufijo, { y: y + mmToPt(8.0), x: rx, w: cw, size: 6.4, align: "center" });
            y += boxH + mmToPt(1.0);
        }

        // --- Detalles
        const row2 = (k, v) => {
            const leftW = W * 0.34;
            const rightW = W * 0.66;
            const val = String(v == null || v === "" ? "-" : v);
            doc.font("Helvetica-Bold").fontSize(5.8);
            const hl = doc.heightOfString(k, { width: leftW, characterSpacing: 0.4 });
            doc.font("Helvetica").fontSize(7.4);
            const hr = doc.heightOfString(val, { width: rightW, align: "right" });
            doc.font("Helvetica-Bold").fontSize(5.8).fillColor(BLACK).text(k, X, y + mmToPt(0.25), { width: leftW, characterSpacing: 0.4 });
            doc.font("Helvetica").fontSize(7.4).fillColor(BLACK).text(val, X + leftW, y, { width: rightW, align: "right" });
            y += Math.max(hl, hr) + mmToPt(0.6);
            rule(false, 0.7);
        };

        if (typeIsPassenger) {
            row2("PASAJERO", passengerName || "-");
        } else {
            textBlock("DETALLE", { font: "Helvetica-Bold", size: 5.8, spacing: 0.4, gap: 0.2 });
            textBlock(row.package_details || "-", { size: 7.4, gap: 0.6 });
            rule(false, 0.7);
        }
        row2("CONTACTO", row.customer_name || "-");
        row2("TEL.", row.phone || "-");
        row2("PAGO", paymentLabel(row.payment_method));
        if (String(row.transfer_ref || "").trim()) row2("REF.", String(row.transfer_ref).trim());

        // --- Total en barra negra
        if (totalPerPageTxt) {
            const barH = mmToPt(7.2);
            doc.save().roundedRect(X, y + mmToPt(0.4), W, barH, 2.4).fill(BLACK).restore();
            doc.font("Helvetica-Bold").fontSize(5.8).fillColor(WHITE).text(totalLabel, X + mmToPt(1.6), y + mmToPt(0.4) + (barH - 5.8) / 2, { width: W * 0.42, characterSpacing: 0.4, lineBreak: false });
            doc.font("Helvetica-Bold").fontSize(11.5).fillColor(WHITE).text(totalPerPageTxt, X + W * 0.35, y + mmToPt(0.4) + (barH - 11.5) / 2 + 0.5, { width: W * 0.65 - mmToPt(1.6), align: "right", lineBreak: false });
            y += barH + mmToPt(1.4);
        }

        // --- Corte y validación
        rule(true, 1.6);
        {
            const qrSize = mmToPt(26);
            const qx = X + (W - qrSize) / 2;
            doc.image(qrPng, qx, y, { fit: [qrSize, qrSize] });
            y += qrSize + mmToPt(1.2);
        }
        textBlock("ESCANEA PARA VALIDAR", { font: "Helvetica-Bold", size: 6.6, align: "center", spacing: 0.4, gap: 1.0 });

        // --- Código para consultar el boleto
        {
            const boxH = mmToPt(10.2);
            doc.save().lineWidth(1).strokeColor(BLACK).roundedRect(X, y, W, boxH, 2.4).stroke().restore();
            textBlock("CODIGO DEL BOLETO", { y: y + mmToPt(1.0), size: 5.4, spacing: 0.8, align: "center" });
            textBlock(row.code, { y: y + mmToPt(3.2), font: "Courier-Bold", size: 13, spacing: 1.6, align: "center" });
            y += boxH + mmToPt(1.0);
        }
        textBlock("Consulta tu boleto en", { size: 5.8, align: "center", gap: 0.1 });
        textBlock(`${hostTxt}/mis-boletos`, { font: "Helvetica-Bold", size: 6.2, align: "center", gap: 0.9 });
        textBlock("Gracias por viajar con nosotros", { size: 5.8, align: "center", gap: 0 });

        return ptToMm(y) + 2.4;
    };

    // Primera pasada: mido el alto máximo entre todas las páginas
    const measureDoc = new PDFDocument({ size: [PAGE_W, mmToPt(400)], margins: { top: 0, left: 0, right: 0, bottom: 0 } });
    const maxNeedMm = passengerNames.reduce((acc, pName, i) => {
        if (i > 0) measureDoc.addPage({ size: [PAGE_W, mmToPt(400)], margins: { top: 0, left: 0, right: 0, bottom: 0 } });
        return Math.max(acc, drawTicket(measureDoc, pName, i + 1, passengerNames.length));
    }, 0);
    measureDoc.on("data", () => {});
    measureDoc.end();

    const PAGE_H_MM = Math.max(80, Math.min(200, Math.ceil(maxNeedMm)));
    const PAGE_H = mmToPt(PAGE_H_MM);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${folio}.pdf"`);

    const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margins: { top: 0, left: 0, right: 0, bottom: 0 } });
    doc.pipe(res);

    for (let i = 0; i < passengerNames.length; i++) {
        if (i > 0) doc.addPage({ size: [PAGE_W, PAGE_H], margins: { top: 0, left: 0, right: 0, bottom: 0 } });
        drawTicket(doc, passengerNames[i], i + 1, passengerNames.length);
    }

    doc.end();
});

router.get("/ticket/:code/pdf/view", requireDb, async (req, res) => {
    const { code } = req.params;
    const pdfUrl = `/ticket/${encodeURIComponent(code)}/pdf?raw=1`;
    const fallbackReturnUrl = `/ticket/${encodeURIComponent(code)}`;
    const returnUrl =
        req.query.return && String(req.query.return).startsWith("/")
            ? String(req.query.return)
            : fallbackReturnUrl;

    res.setHeader("Content-Type", "text/html; charset=utf-8");

    return res.send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PDF del ticket</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      background: #f5f5f7;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #111827;
    }
    body {
      display: flex;
      flex-direction: column;
    }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 12px;
      background: #fff;
      border-bottom: 1px solid #e5e7eb;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .toolbar-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .toolbar-title {
      font-size: 13px;
      line-height: 1.1;
      font-weight: 600;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 32px;
      padding: 6px 10px;
      border-radius: 9px;
      border: 1px solid #d1d5db;
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
      color: #111827;
      background: #fff;
    }
    .btn-primary {
      background: #6a0f1f;
      border-color: #6a0f1f;
      color: #fff;
    }
    .viewer {
      flex: 1;
      min-height: 0;
    }
    iframe {
      width: 100%;
      height: 100%;
      border: 0;
      background: #fff;
    }
    @media (max-width: 640px) {
      .toolbar {
        padding: 6px 10px;
      }
      .btn {
        flex: 1 1 auto;
      }
    }
    @media print {
      .toolbar {
        display: none;
      }
      .viewer {
        height: 100vh;
      }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-title">Vista previa del ticket</div>
    <div class="toolbar-actions">
      <a class="btn" href="${returnUrl}">Volver</a>
    </div>
  </div>
  <div class="viewer">
    <iframe id="ticketPdfFrame" src="${pdfUrl}" title="PDF del ticket"></iframe>
  </div>
  <script>
    (function () {
      const frame = document.getElementById("ticketPdfFrame");
      if (!frame) return;
      let isDelegatingPrint = false;

      function printPdfOnly() {
        if (isDelegatingPrint) return true;
        try {
          const w = frame.contentWindow;
          if (!w) return false;
          isDelegatingPrint = true;
          w.focus();
          w.print();
          setTimeout(() => {
            isDelegatingPrint = false;
            try {
              window.focus();
              document.body && typeof document.body.focus === "function" && document.body.focus();
            } catch {}
          }, 250);
          return true;
        } catch {
          isDelegatingPrint = false;
          return false;
        }
      }

      window.addEventListener("keydown", (event) => {
        const isPrintShortcut = (event.ctrlKey || event.metaKey) && String(event.key || "").toLowerCase() === "p";
        if (!isPrintShortcut) return;
        if (!printPdfOnly()) return;
        event.preventDefault();
        event.stopPropagation();
      });

      window.addEventListener("beforeprint", () => {
        printPdfOnly();
      });
    })();
  </script>
</body>
</html>`);
});

router.get("/ticket/:code/print", requireDb, async (req, res) => {
    const code = req.params.code;

    // I'm printing the already-generated PDF by embedding it in an iframe and calling print().
    const pdfUrl = `/ticket/${encodeURIComponent(code)}/pdf?raw=1`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");

    return res.send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Imprimir ticket</title>
  <style>
    html, body { margin: 0; padding: 0; height: 100%; background: #fff; }
    iframe { width: 100%; height: 100%; border: 0; }
    .fallback {
      position: fixed; top: 10px; left: 10px;
      background: #fff; border: 1px solid #ddd; border-radius: 10px;
      padding: 10px 12px; font-family: system-ui, sans-serif; font-size: 14px;
    }
    .fallback button {
      padding: 8px 10px; border-radius: 10px; border: 1px solid #111; background: #111; color: #fff;
      font-weight: 700; cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="fallback">
    Si no se abre automáticamente:
    <button id="btn">Imprimir</button>
  </div>

  <iframe id="pdf" src="${pdfUrl}"></iframe>

  <script>
    const iframe = document.getElementById('pdf');
    const btn = document.getElementById('btn');

    function doPrint(){
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (e) {
        window.print();
      }
    }

    iframe.addEventListener('load', () => {
      setTimeout(doPrint, 250);
    });

    btn.addEventListener('click', doPrint);
  </script>
</body>
</html>`);
});

module.exports = router;
