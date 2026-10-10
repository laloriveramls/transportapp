// src/notifications/reservationMessages.js
"use strict";

const {escapeHtml} = require("./telegram");
const {formatRouteLabel} = require("../locations");
const specialEvents = require("../specialEvents");

const REGULAR_MAX_CAP = 14;

const TYPE_LABELS = {PASSENGER: "Pasaje", PACKAGE: "Paquetería"};
const PAY_LABELS = {TAQUILLA: "Taquilla", TRANSFERENCIA: "Transferencia", ONLINE: "Pago en línea"};
const STATUS_LABELS = {
    PAY_AT_BOARDING: "Paga al abordar",
    PENDING_PAYMENT: "Pendiente de pago",
    PAID: "Pagada",
    CANCELLED: "Cancelada",
    EXPIRED: "Expirada",
};
const STATUS_ICONS = {
    PAY_AT_BOARDING: "🟡",
    PENDING_PAYMENT: "⏳",
    PAID: "✅",
    CANCELLED: "⛔",
    EXPIRED: "⌛",
};

/* =========================
   Formatters
   ========================= */

function money(n) {
    return Number(n || 0).toLocaleString("es-MX", {style: "currency", currency: "MXN"});
}

function prettyDate(iso) {
    const [y, m, d] = String(iso || "").split("-").map(Number);
    if (!y || !m || !d) return String(iso || "-");
    const dt = new Date(Date.UTC(y, m - 1, d));
    const part = (opts) => dt.toLocaleDateString("es-MX", {timeZone: "UTC", ...opts}).replace(/\./g, "");
    const weekday = part({weekday: "short"});
    return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${d} ${part({month: "short"})} ${y}`;
}

function prettyPhone(raw) {
    const digits = String(raw || "").replace(/\D/g, "");
    const ten = digits.length > 10 ? digits.slice(-10) : digits;
    if (ten.length !== 10) return String(raw || "-");
    return `${ten.slice(0, 3)} ${ten.slice(3, 6)} ${ten.slice(6)}`;
}

function waUrl(raw, text) {
    const digits = String(raw || "").replace(/\D/g, "");
    const ten = digits.length > 10 ? digits.slice(-10) : digits;
    if (ten.length !== 10) return null;
    return `https://wa.me/52${ten}?text=${encodeURIComponent(text)}`;
}

function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
}

function folioOf(r) {
    const ymd = String(r.trip_date || "").replaceAll("-", "");
    const n = Number(r.daily_seq) > 0 ? Number(r.daily_seq) : Number(r.id || 0);
    return `RES-${ymd}-${String(n).padStart(3, "0")}`;
}

function isPublicHttpsUrl(u) {
    try {
        const url = new URL(u);
        if (url.protocol !== "https:") return false;
        const host = url.hostname.toLowerCase();
        return !(
            host === "localhost" ||
            /^127\./.test(host) ||
            /^10\./.test(host) ||
            /^192\.168\./.test(host) ||
            /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
        );
    } catch {
        return false;
    }
}

function baseUrl() {
    return String(process.env.BASE_URL || "").trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "");
}

/* =========================
   Data
   ========================= */

/** Reads everything a notification needs (reservation, trip occupancy and special event). */
async function loadReservationSnapshot(db, reservationId) {
    const [[r]] = await db.query(
        `
            SELECT r.id,
                   r.trip_id,
                   r.type,
                   r.seats,
                   r.child_seats,
                   r.customer_name,
                   r.phone,
                   r.package_details,
                   r.vic_location,
                   r.payment_method,
                   r.transfer_ref,
                   r.status,
                   r.unit_price_mxn,
                   r.amount_total_mxn,
                   r.public_token,
                   r.daily_seq,
                   r.created_at,
                   t.trip_date,
                   dt.direction,
                   TIME_FORMAT(dt.depart_time, '%H:%i') AS depart_hhmm,
                   dt.capacity_passengers,
                   dt.special_event_id,
                   (SELECT COUNT(*)
                    FROM transporte_reservation_passengers p
                    WHERE p.reservation_id = r.id) AS names_count
            FROM transporte_reservations r
                     JOIN transporte_trips t ON t.id = r.trip_id
                     JOIN transporte_departure_templates dt ON dt.id = t.template_id
            WHERE r.id = ?
            LIMIT 1
        `,
        [reservationId]
    );
    if (!r) return null;

    const [[occ]] = await db.query(
        `
            SELECT COALESCE(SUM(
                                    CASE
                                        WHEN r.type = 'PASSENGER'
                                            AND r.status IN ('PENDING_PAYMENT', 'PAY_AT_BOARDING', 'PAID')
                                            THEN COALESCE(rp.passenger_count, NULLIF(r.seats, 0), 1)
                                        ELSE 0
                                        END
                            ), 0) AS used
            FROM transporte_reservations r
                     LEFT JOIN (SELECT reservation_id, COUNT(*) AS passenger_count
                                FROM transporte_reservation_passengers
                                GROUP BY reservation_id) rp ON rp.reservation_id = r.id
            WHERE r.trip_id = ?
        `,
        [r.trip_id]
    );

    const isSpecial = Number(r.special_event_id || 0) > 0;
    const ev = isSpecial ? await specialEvents.getEventById(db, r.special_event_id).catch(() => null) : null;
    const capacity = isSpecial
        ? Number(r.capacity_passengers || 0)
        : Math.min(REGULAR_MAX_CAP, Number(r.capacity_passengers || 0));

    return {
        ...r,
        folio: folioOf(r),
        event: ev,
        capacity,
        used: Number(occ?.used || 0),
    };
}

/* =========================
   Message pieces
   ========================= */

function tripLines(s) {
    const lines = [];
    const route = s.event
        ? `${s.event.from_label} → ${s.event.to_label}`
        : formatRouteLabel(s.direction, s.vic_location, " → ");

    lines.push(`🗓 <b>${escapeHtml(prettyDate(s.trip_date))}</b> · ${escapeHtml(specialEvents.formatTime12(s.depart_hhmm))}`);
    lines.push(`🛣 ${escapeHtml(route)}`);
    if (s.event?.is_round_trip) {
        lines.push(`↩️ Regreso ${escapeHtml(s.event.return_label)} · viaje redondo`);
    }
    return lines;
}

function cargoLines(s) {
    if (String(s.type).toUpperCase() === "PACKAGE") {
        return [`📦 ${s.package_details ? escapeHtml(s.package_details) : "<i>Sin descripción</i>"}`];
    }
    const seats = Number(s.seats || 1);
    const kids = Number(s.child_seats || 0);
    const kidsText = kids > 0 ? ` (${plural(kids, "niño", "niños")} 6-10)` : "";
    return [`👥 <b>${plural(seats, "pasajero", "pasajeros")}</b>${kidsText}`];
}

function occupancyLine(s) {
    if (String(s.type).toUpperCase() !== "PASSENGER" || !s.capacity) return null;
    const left = Math.max(0, s.capacity - s.used);
    if (left === 0) return `🚫 Salida llena (${s.used}/${s.capacity})`;
    const warn = left <= 2 ? "⚠️" : "🪑";
    return `${warn} Ocupación ${s.used}/${s.capacity} · ${plural(left, "lugar libre", "lugares libres")}`;
}

function contactLines(s) {
    const wa = waUrl(s.phone, `Hola ${s.customer_name || ""}, te contacto por tu reserva ${s.folio}.`);
    const phone = escapeHtml(prettyPhone(s.phone));
    return [
        `👤 ${escapeHtml(s.customer_name || "-")}`,
        `📞 ${wa ? `<a href="${escapeHtml(wa)}">${phone}</a>` : `<code>${phone}</code>`}`,
    ];
}

function paymentLines(s) {
    const pm = String(s.payment_method || "").toUpperCase();
    const st = String(s.status || "").toUpperCase();
    const unit = Number(s.unit_price_mxn || 0);
    const seats = Number(s.seats || 1);
    const breakdown = String(s.type).toUpperCase() === "PASSENGER" && unit > 0 && !Number(s.child_seats || 0) && seats > 1
        ? ` <i>(${seats} × ${escapeHtml(money(unit))})</i>`
        : "";

    return [
        `💳 ${escapeHtml(PAY_LABELS[pm] || pm || "-")} · ${STATUS_ICONS[st] || "•"} ${escapeHtml(STATUS_LABELS[st] || st || "-")}`,
        pm === "TRANSFERENCIA" && s.transfer_ref ? `🔖 Ref. <code>${escapeHtml(s.transfer_ref)}</code>` : null,
        `💰 <b>${escapeHtml(money(s.amount_total_mxn))}</b>${breakdown}`,
    ];
}

function buttonsFor(s) {
    const base = baseUrl();
    const row1 = [];
    const row2 = [];

    const viewUrl = base && s.public_token ? `${base}/pay/t/${encodeURIComponent(s.public_token)}` : "";
    if (isPublicHttpsUrl(viewUrl)) row1.push({text: "🔎 Ver reserva", url: viewUrl});

    const tripUrl = base ? `${base}/admin/trip/${s.trip_id}` : "";
    if (isPublicHttpsUrl(tripUrl)) row1.push({text: "🧭 Ver salida", url: tripUrl});

    const wa = waUrl(s.phone, `Hola ${s.customer_name || ""}, te contacto por tu reserva ${s.folio}.`);
    if (wa) row2.push({text: "💬 WhatsApp al cliente", url: wa});

    return [row1, row2].filter((row) => row.length);
}

// Telegram rejects inline buttons with non-public URLs; in that case the link goes in the text.
function viewLinkLines(s) {
    const base = baseUrl();
    const viewUrl = base && s.public_token ? `${base}/pay/t/${encodeURIComponent(s.public_token)}` : "";
    if (!viewUrl || isPublicHttpsUrl(viewUrl)) return [];
    return [`🔗 ${escapeHtml(viewUrl)}`];
}

function compose(sections) {
    return sections
        .map((lines) => lines.filter(Boolean).join("\n"))
        .filter(Boolean)
        .join("\n\n");
}

/* =========================
   Messages
   ========================= */

function header(s, verb) {
    const kind = TYPE_LABELS[String(s.type).toUpperCase()] || "Reserva";
    const title = s.event
        ? `🎡 <b>${verb} · ${escapeHtml(s.event.title)}</b>`
        : `${verb === "Nueva reserva" ? "🆕" : "💵"} <b>${verb}</b> · ${escapeHtml(kind)}`;
    return [title, `<code>${escapeHtml(s.folio)}</code>`];
}

function newReservationMessage(s) {
    return {
        text: compose([
            header(s, "Nueva reserva"),
            [...tripLines(s), ...cargoLines(s), occupancyLine(s)],
            contactLines(s),
            paymentLines(s),
            viewLinkLines(s),
        ]),
        buttons: buttonsFor(s),
    };
}

function paymentConfirmedMessage(s) {
    return {
        text: compose([
            header(s, "Pago confirmado"),
            [...tripLines(s), ...cargoLines(s)],
            contactLines(s),
            [`✅ Pagado en línea · <b>${escapeHtml(money(s.amount_total_mxn))}</b>`, "🎫 Boleto emitido"],
            viewLinkLines(s),
        ]),
        buttons: buttonsFor(s),
    };
}

function lastReservationMessage(s) {
    const created = s.created_at
        ? new Date(s.created_at).toLocaleString("es-MX", {
            timeZone: "America/Monterrey",
            dateStyle: "medium",
            timeStyle: "short",
        })
        : "";
    return {
        text: compose([
            [`🧾 <b>Última reserva</b>`, `<code>${escapeHtml(s.folio)}</code> · ID ${escapeHtml(s.id)}`],
            [...tripLines(s), ...cargoLines(s), occupancyLine(s)],
            contactLines(s),
            paymentLines(s),
            viewLinkLines(s),
            created ? [`<i>Creada ${escapeHtml(created)}</i>`] : [],
        ]),
        buttons: buttonsFor(s),
    };
}

module.exports = {
    loadReservationSnapshot,
    newReservationMessage,
    paymentConfirmedMessage,
    lastReservationMessage,
};
