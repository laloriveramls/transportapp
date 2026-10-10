"use strict";

const SPECIAL_MAX_CAP = 60;
const ACTIVE_RESERVATION_STATUSES = "('PENDING_PAYMENT', 'PAY_AT_BOARDING', 'PAID')";

const DEFAULT_EVENT = {
    slug: "feria-tamaulipas-2026",
    title: "Feria Tamaulipas 2026",
    tab_label: "Feria 2026",
    description: "Viaje redondo de Llera a la Feria Tamaulipas en Ciudad Victoria. Sales a las 5:00 PM y regresas a las 11:00 PM.",
    direction: "LLE_TO_VIC",
    depart_time: "17:00",
    return_time: "23:00",
    start_date: "2026-10-15",
    end_date: "2026-10-26",
    capacity_passengers: 14,
    price_mxn: 300,
    active: 1,
};

function todayISO_MTY() {
    return new Date().toLocaleDateString("en-CA", {timeZone: "America/Monterrey"});
}

function nowHHMM_MTY() {
    return new Date().toLocaleTimeString("en-GB", {
        timeZone: "America/Monterrey",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
}

function toISODate(v) {
    if (!v) return "";
    if (typeof v === "string") return v.slice(0, 10);
    try {
        return new Date(v).toISOString().slice(0, 10);
    } catch {
        return String(v);
    }
}

function hhmm(t) {
    return String(t || "").slice(0, 5);
}

function addDaysISO(iso, days) {
    const [y, m, d] = String(iso).split("-").map(Number);
    const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
    return dt.toISOString().slice(0, 10);
}

function isValidISODate(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

function isValidHHMM(s) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ""));
}

function formatTime12(t) {
    const s = hhmm(t);
    if (!isValidHHMM(s)) return s;
    const [h, m] = s.split(":").map(Number);
    const ap = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

function formatDateParts(iso) {
    const [y, m, d] = String(iso).split("-").map(Number);
    const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    const fmt = (opts) => new Intl.DateTimeFormat("es-MX", {timeZone: "UTC", ...opts}).format(dt).replace(".", "");
    const weekday = fmt({weekday: "short"});
    const month = fmt({month: "short"});
    return {
        weekday: weekday.charAt(0).toUpperCase() + weekday.slice(1),
        day: d,
        month,
        long: (() => {
            const raw = fmt({weekday: "long", day: "numeric", month: "long"});
            return raw.charAt(0).toUpperCase() + raw.slice(1);
        })(),
    };
}

function formatRangeLabel(startISO, endISO) {
    const a = formatDateParts(startISO);
    const b = formatDateParts(endISO);
    if (a.month === b.month) return `${a.day} al ${b.day} de ${b.month}`;
    return `${a.day} de ${a.month} al ${b.day} de ${b.month}`;
}

function endpoints(direction) {
    return direction === "VIC_TO_LLE"
        ? {from: "Ciudad Victoria", to: "Llera", fromStop: "VIC", toStop: "LLE"}
        : {from: "Llera", to: "Ciudad Victoria", fromStop: "LLE", toStop: "VIC"};
}

function normalizeEvent(row) {
    if (!row) return null;
    const ep = endpoints(row.direction);
    const ev = {
        id: Number(row.id),
        slug: String(row.slug || ""),
        title: String(row.title || ""),
        tab_label: String(row.tab_label || row.title || "Especial"),
        description: String(row.description || ""),
        direction: row.direction,
        depart_time: hhmm(row.depart_time),
        return_time: row.return_time ? hhmm(row.return_time) : "",
        start_date: toISODate(row.start_date),
        end_date: toISODate(row.end_date),
        capacity_passengers: Math.max(0, Math.min(SPECIAL_MAX_CAP, Number(row.capacity_passengers || 0))),
        price_mxn: Number(row.price_mxn || 0),
        active: Number(row.active) === 1,
        template_id: row.template_id ? Number(row.template_id) : null,
        from_label: ep.from,
        to_label: ep.to,
        from_stop: ep.fromStop,
        to_stop: ep.toStop,
    };
    ev.is_round_trip = !!ev.return_time;
    ev.depart_label = formatTime12(ev.depart_time);
    ev.return_label = ev.return_time ? formatTime12(ev.return_time) : "";
    ev.range_label = ev.start_date && ev.end_date ? formatRangeLabel(ev.start_date, ev.end_date) : "";
    return ev;
}

function routeNote(ev) {
    if (!ev) return "";
    const trip = ev.is_round_trip ? `viaje redondo, regreso ${ev.return_label}` : `salida ${ev.depart_label}`;
    return `${ev.title} (${trip})`;
}

/* -----------------------------
   Queries
----------------------------- */

async function listEvents(conn) {
    const [rows] = await conn.query(
        `SELECT *
         FROM transporte_special_events
         ORDER BY start_date DESC, id DESC`
    );
    return rows.map(normalizeEvent);
}

async function listPublicEvents(conn) {
    const [rows] = await conn.query(
        `SELECT *
         FROM transporte_special_events
         WHERE active = 1
           AND end_date >= ?
         ORDER BY start_date, id`,
        [todayISO_MTY()]
    );
    return rows.map(normalizeEvent);
}

async function getEventBySlug(conn, slug) {
    const [[row]] = await conn.query(
        `SELECT * FROM transporte_special_events WHERE slug = ? LIMIT 1`,
        [String(slug || "").trim().toLowerCase()]
    );
    return normalizeEvent(row);
}

async function getEventById(conn, id) {
    const [[row]] = await conn.query(
        `SELECT * FROM transporte_special_events WHERE id = ? LIMIT 1`,
        [Number(id)]
    );
    return normalizeEvent(row);
}

async function getEventByTemplateId(conn, templateId) {
    if (!templateId) return null;
    const [[row]] = await conn.query(
        `SELECT se.*
         FROM transporte_special_events se
                  JOIN transporte_departure_templates dt ON dt.special_event_id = se.id
         WHERE dt.id = ?
         LIMIT 1`,
        [Number(templateId)]
    );
    return normalizeEvent(row);
}

// I keep one dedicated departure template per event, so trips/reservations/tickets reuse the regular flow.
async function syncEventTemplate(conn, eventId) {
    const [[ev]] = await conn.query(
        `SELECT * FROM transporte_special_events WHERE id = ? LIMIT 1`,
        [Number(eventId)]
    );
    if (!ev) return null;

    let templateId = Number(ev.template_id || 0);
    if (templateId) {
        const [[tpl]] = await conn.query(
            `SELECT id FROM transporte_departure_templates WHERE id = ? AND special_event_id = ? LIMIT 1`,
            [templateId, ev.id]
        );
        if (!tpl) templateId = 0;
    }

    const capacity = Math.max(0, Math.min(SPECIAL_MAX_CAP, Number(ev.capacity_passengers || 0)));
    const active = Number(ev.active) === 1 ? 1 : 0;

    if (templateId) {
        await conn.query(
            `UPDATE transporte_departure_templates
             SET direction=?, depart_time=?, capacity_passengers=?, active=?
             WHERE id = ? LIMIT 1`,
            [ev.direction, ev.depart_time, capacity, active, templateId]
        );
    } else {
        const [ins] = await conn.query(
            `INSERT INTO transporte_departure_templates(direction, depart_time, capacity_passengers, active, special_event_id)
             VALUES (?, ?, ?, ?, ?)`,
            [ev.direction, ev.depart_time, capacity, active, ev.id]
        );
        templateId = ins.insertId;
        await conn.query(
            `UPDATE transporte_special_events SET template_id = ? WHERE id = ?`,
            [templateId, ev.id]
        );
    }

    return templateId;
}

async function tripStatsByDate(conn, templateId, fromISO, toISO) {
    const [rows] = await conn.query(
        `
            SELECT t.id                       AS trip_id,
                   t.trip_date,
                   COALESCE(t.status, 'OPEN') AS trip_status,
                   t.notes                    AS trip_notes,
                   COALESCE(SUM(
                                    CASE
                                        WHEN r.type = 'PASSENGER'
                                            AND r.status IN ${ACTIVE_RESERVATION_STATUSES}
                                            THEN COALESCE(rp.passenger_count, NULLIF(r.seats, 0), 1)
                                        ELSE 0
                                        END
                            ), 0)             AS used_seats
            FROM transporte_trips t
                     LEFT JOIN transporte_reservations r ON r.trip_id = t.id
                     LEFT JOIN (SELECT reservation_id, COUNT(*) AS passenger_count
                                FROM transporte_reservation_passengers
                                GROUP BY reservation_id) rp ON rp.reservation_id = r.id
            WHERE t.template_id = ?
              AND t.trip_date BETWEEN ? AND ?
            GROUP BY t.id, t.trip_date, t.status, t.notes
        `,
        [Number(templateId), fromISO, toISO]
    );

    const map = new Map();
    for (const row of rows) map.set(toISODate(row.trip_date), row);
    return map;
}

// I build the day-by-day board (availability + bookable flag). includePast is for admin.
async function eventDays(conn, ev, {includePast = false} = {}) {
    if (!ev || !ev.start_date || !ev.end_date || ev.end_date < ev.start_date) return [];

    const today = todayISO_MTY();
    const nowHHMM = nowHHMM_MTY();
    const from = includePast ? ev.start_date : (ev.start_date > today ? ev.start_date : today);
    if (from > ev.end_date) return [];

    const stats = ev.template_id ? await tripStatsByDate(conn, ev.template_id, from, ev.end_date) : new Map();
    const cap = ev.capacity_passengers;

    const days = [];
    for (let d = from; d <= ev.end_date; d = addDaysISO(d, 1)) {
        const st = stats.get(d);
        const used = Number(st?.used_seats || 0);
        const available = Math.max(0, cap - used);
        const tripStatus = String(st?.trip_status || "OPEN").toUpperCase();
        const past = d < today || (d === today && ev.depart_time <= nowHHMM);
        const parts = formatDateParts(d);

        days.push({
            date: d,
            ...parts,
            trip_id: st?.trip_id || null,
            trip_status: tripStatus,
            trip_notes: st?.trip_notes || "",
            used,
            capacity: cap,
            available,
            past,
            bookable: ev.active && !past && tripStatus === "OPEN" && available > 0,
        });
    }
    return days;
}

module.exports = {
    SPECIAL_MAX_CAP,
    DEFAULT_EVENT,
    todayISO_MTY,
    nowHHMM_MTY,
    isValidISODate,
    isValidHHMM,
    formatTime12,
    formatDateParts,
    normalizeEvent,
    routeNote,
    listEvents,
    listPublicEvents,
    getEventBySlug,
    getEventById,
    getEventByTemplateId,
    syncEventTemplate,
    eventDays,
};
