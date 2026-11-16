"use strict";

const express = require("express");
const {pool} = require("../db");
const {requireDb} = require("../middleware/requireDb");
const {formatRouteLabel} = require("../locations");

const router = express.Router();

/* =========================
   Mis boletos (sin cuenta)
   - Consulta de un boleto: código del boleto (aleatorio, 10 caracteres) + teléfono de la reserva.
   - Lista guardada en el dispositivo: el navegador manda los códigos que ya tiene; tener el código es el permiso.
   El folio (RES-fecha-consecutivo) NO sirve para consultar porque es predecible.
   ========================= */

const CODE_RE = /^[0-9A-Z]{6,16}$/; // los códigos existentes tienen 8, 10 o 12 caracteres
const MAX_SAVED = 12;

/* ---------- Límite de intentos (en memoria, por IP) ---------- */

const buckets = new Map();

function hit(key, {limit, windowMs}) {
    const now = Date.now();
    const entry = buckets.get(key);
    if (!entry || now > entry.resetAt) {
        buckets.set(key, {count: 1, resetAt: now + windowMs});
        return true;
    }
    entry.count += 1;
    return entry.count <= limit;
}

function isBlocked(key, {limit}) {
    const entry = buckets.get(key);
    return !!entry && Date.now() <= entry.resetAt && entry.count >= limit;
}

setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of buckets) if (now > entry.resetAt) buckets.delete(key);
}, 10 * 60 * 1000).unref();

const LOOKUP_LIMIT = {limit: 8, windowMs: 15 * 60 * 1000}; // intentos fallidos
const SAVED_LIMIT = {limit: 40, windowMs: 15 * 60 * 1000}; // consultas de la lista

/* ---------- Helpers ---------- */

function normalizeCode(raw) {
    let text = String(raw || "");
    // Si pegaron el enlace del boleto, tomo lo que va después de /ticket/
    const fromUrl = text.match(/\/ticket\/([0-9A-Za-z]+)/);
    if (fromUrl) text = fromUrl[1];
    return text.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

function lastTenDigits(raw) {
    return String(raw || "").replace(/\D/g, "").slice(-10);
}

function statusMeta(status) {
    const s = String(status || "").toUpperCase();
    if (s === "PAID") return {label: "Pagado", cls: "pill--ok"};
    if (s === "CANCELLED") return {label: "Cancelado", cls: "pill--bad"};
    if (s === "PENDING_PAYMENT") return {label: "Pendiente de pago", cls: "pill--warn"};
    if (s === "PAY_AT_BOARDING") return {label: "Paga al abordar", cls: "pill--warn"};
    if (s === "EXPIRED") return {label: "Expirado", cls: "pill--bad"};
    return {label: "Reservado", cls: ""};
}

function tripDateLabel(iso) {
    const s = String(iso || "").slice(0, 10);
    const [y, m, d] = s.split("-").map(Number);
    if (!y || !m || !d) return s;
    try {
        return new Date(Date.UTC(y, m - 1, d))
            .toLocaleDateString("es-MX", {weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC"})
            .replace(/\./g, "");
    } catch {
        return s;
    }
}

function time12(hhmm) {
    const [h, m] = String(hhmm || "").slice(0, 5).split(":").map(Number);
    if (!Number.isFinite(h)) return "";
    return `${h % 12 || 12}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
}

function todayMty() {
    return new Date().toLocaleDateString("en-CA", {timeZone: "America/Monterrey"});
}

async function loadByCodes(codes) {
    if (!codes.length) return [];
    const [rows] = await pool.query(
        `SELECT tk.code, r.status, r.type, r.seats, r.vic_location, r.from_stop, r.to_stop,
                t.trip_date, dt.direction, dt.depart_time
         FROM transporte_tickets tk
                  JOIN transporte_reservations r ON r.id = tk.reservation_id
                  JOIN transporte_trips t ON t.id = r.trip_id
                  JOIN transporte_departure_templates dt ON dt.id = t.template_id
         WHERE tk.code IN (?)`,
        [codes]
    );
    return rows;
}

function summarize(row) {
    const date = String(row.trip_date instanceof Date
        ? row.trip_date.toLocaleDateString("en-CA", {timeZone: "America/Monterrey"})
        : row.trip_date).slice(0, 10);
    const status = statusMeta(row.status);
    const hhmm = String(row.depart_time || "").slice(0, 5);
    return {
        code: row.code,
        route: formatRouteLabel(row.direction, row.vic_location, " → ", row.from_stop, row.to_stop),
        date,
        dateLabel: tripDateLabel(date),
        time: hhmm,
        timeLabel: time12(hhmm),
        kind: String(row.type || "").toUpperCase() === "PASSENGER" ? "Pasaje" : "Paquetería",
        seats: Number(row.seats || 0),
        status: status.label,
        statusClass: status.cls,
        upcoming: date >= todayMty(),
        url: `/ticket/${encodeURIComponent(row.code)}?return=${encodeURIComponent("/mis-boletos")}`,
        rebook: rebookUrl(row),
    };
}

/** Enlace para volver a reservar el mismo viaje (ruta y horario; la fecha la elige la persona). */
function rebookUrl(row) {
    const q = new URLSearchParams();
    if (row.from_stop && row.to_stop) {
        q.set("from", String(row.from_stop).toUpperCase());
        q.set("to", String(row.to_stop).toUpperCase());
    } else {
        q.set("dir", row.direction);
    }
    const hhmm = String(row.depart_time || "").slice(0, 5);
    if (hhmm) q.set("time", hhmm);
    return `/reserve?${q.toString()}`;
}

function renderPage(res, extra = {}) {
    return res.render("my_tickets", {error: null, values: {}, ...extra});
}

/* ---------- Rutas ---------- */

router.get("/mis-boletos", requireDb, (req, res) => renderPage(res));

// Buscar un boleto con código + teléfono. Cualquier fallo responde igual para no revelar qué dato existe.
router.post("/mis-boletos/buscar", requireDb, async (req, res) => {
    const key = `lookup:${req.ip}`;
    if (isBlocked(key, LOOKUP_LIMIT)) {
        return res.status(429).render("my_tickets", {
            error: "Demasiados intentos. Espera unos minutos o escríbenos por WhatsApp.",
            values: {},
        });
    }

    const code = normalizeCode(req.body?.code);
    const phone = lastTenDigits(req.body?.phone);
    const values = {code: String(req.body?.code || "").slice(0, 24), phone: String(req.body?.phone || "").slice(0, 24)};
    const generic = "No encontramos un boleto con esos datos. Revisa el código y el teléfono con el que reservaste.";

    if (!CODE_RE.test(code) || phone.length !== 10) {
        hit(key, LOOKUP_LIMIT);
        return res.status(200).render("my_tickets", {error: generic, values});
    }

    try {
        const [[row]] = await pool.query(
            `SELECT tk.code, r.phone
             FROM transporte_tickets tk
                      JOIN transporte_reservations r ON r.id = tk.reservation_id
             WHERE tk.code = ?
             LIMIT 1`,
            [code]
        );
        if (!row || lastTenDigits(row.phone) !== phone) {
            hit(key, LOOKUP_LIMIT);
            return res.status(200).render("my_tickets", {error: generic, values});
        }
        return res.redirect(`/ticket/${encodeURIComponent(row.code)}?return=${encodeURIComponent("/mis-boletos")}`);
    } catch (e) {
        console.error("Mis boletos, búsqueda:", e.message || e);
        return res.status(500).render("my_tickets", {error: "No pudimos consultar tu boleto. Intenta de nuevo.", values});
    }
});

// Resumen de los boletos guardados en este dispositivo (solo datos del viaje; sin nombre ni teléfono).
router.post("/mis-boletos/guardados", requireDb, async (req, res) => {
    if (!hit(`saved:${req.ip}`, SAVED_LIMIT)) {
        return res.status(429).json({ok: false, message: "Demasiadas consultas. Intenta más tarde."});
    }
    const raw = Array.isArray(req.body?.codes) ? req.body.codes : [];
    const codes = [...new Set(raw.map(normalizeCode).filter((c) => CODE_RE.test(c)))].slice(0, MAX_SAVED);
    try {
        const rows = await loadByCodes(codes);
        const found = new Map(rows.map((row) => [String(row.code).toUpperCase(), summarize(row)]));
        const items = codes.filter((c) => found.has(c)).map((c) => found.get(c));
        items.sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1));
        res.set("Cache-Control", "no-store");
        return res.json({ok: true, items, missing: codes.filter((c) => !found.has(c))});
    } catch (e) {
        console.error("Mis boletos, guardados:", e.message || e);
        return res.status(500).json({ok: false, message: "No pudimos cargar tus boletos."});
    }
});

module.exports = router;
