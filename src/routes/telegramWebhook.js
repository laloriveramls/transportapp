// src/routes/telegramWebhook.js
"use strict";

const express = require("express");
const router = express.Router();

const {pool, hasDb} = require("../db");
const {buildInlineKeyboard} = require("../notifications/telegram");
const {loadReservationSnapshot, lastReservationMessage} = require("../notifications/reservationMessages");

/* =========================
   Helpers: env + auth
   ========================= */

function escapeHtml(s) {
    return String(s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function readEnvClean(key) {
    // I normalize env values in case the host stores them with quotes.
    let v = String(process.env[key] || "").trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1).trim();
    }
    return v;
}

const ADMIN_IDS = String(process.env.TG_ADMIN_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function isAdmin(update) {
    const fromId =
        update?.message?.from?.id ??
        update?.edited_message?.from?.id ??
        update?.callback_query?.from?.id;

    return fromId && ADMIN_IDS.includes(String(fromId));
}

function isProd() {
    return String(process.env.NODE_ENV || "").toLowerCase() === "production";
}

/* =========================
   Helpers: update parsing
   ========================= */

function getMessageFromUpdate(update) {
    // I support message, edited_message, and callback_query.message.
    return update?.message || update?.edited_message || update?.callback_query?.message || null;
}

function parseCommand(text) {
    // I parse "/cmd@BotName arg1 arg2".
    const t = String(text || "").trim();
    if (!t.startsWith("/")) return {cmd: null, args: []};

    const parts = t.split(/\s+/);
    const head = parts[0] || "";
    const cmd = head.split("@")[0]; // strip "@YourBot"
    const args = parts.slice(1);

    return {cmd, args};
}

function nowIsoMty() {
    // I show Monterrey time to keep ops consistent with the business timezone.
    const d = new Date();
    const date = d.toLocaleDateString("en-CA", {timeZone: "America/Monterrey"}); // YYYY-MM-DD
    const time = d.toLocaleTimeString("en-GB", {
        timeZone: "America/Monterrey",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
    return `${date} ${time} (America/Monterrey)`;
}

/* =========================
   Telegram call
   ========================= */

async function tgReply(chatId, text, opts = {}) {
    const token = readEnvClean("TG_BOT_TOKEN");
    if (!token) {
        console.error("tgReply: missing TG_BOT_TOKEN");
        return;
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const payload = {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...opts,
    };

    try {
        const r = await fetch(url, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(payload),
        });

        const raw = await r.text();
        if (!r.ok) {
            console.error("tgReply non-200:", r.status, raw);
        }
    } catch (e) {
        console.error("tgReply failed:", e?.message || e);
    }
}

async function tgGetWebhookInfo() {
    const token = readEnvClean("TG_BOT_TOKEN");
    if (!token) return null;

    const url = `https://api.telegram.org/bot${token}/getWebhookInfo`;
    try {
        const r = await fetch(url);
        const data = await r.json().catch(() => null);
        return data?.ok ? data.result : null;
    } catch {
        return null;
    }
}

/* =========================
   Middleware: JSON
   ========================= */

router.use(express.json({limit: "1mb"}));

/* =========================
   DB helpers
   ========================= */

async function getLastReservationId() {
    if (!hasDb) return null;
    const [[row]] = await pool.query("SELECT MAX(id) AS id FROM transporte_reservations");
    return row?.id || null;
}

function moneyMXN(n) {
    const v = Number(n || 0);
    return v.toLocaleString("es-MX", {style: "currency", currency: "MXN"});
}

function isIsoDate(v) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
}

function isIsoMonth(v) {
    return /^\d{4}-\d{2}$/.test(String(v || ""));
}

function mtyTodayIsoDate() {
    return new Date().toLocaleDateString("en-CA", {timeZone: "America/Monterrey"});
}

function mtyCurrentIsoMonth() {
    const d = mtyTodayIsoDate();
    return d.slice(0, 7);
}

async function getReservationStatsByDay(dayIso) {
    if (!hasDb) return null;

    const [rows] = await pool.query(
        `
            SELECT COUNT(*)                                                                                                       AS total_reservas,
                   SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END)                                                             AS paid_count,
                   SUM(CASE WHEN status = 'PENDING_PAYMENT' OR status = 'PAY_AT_BOARDING' THEN 1 ELSE 0 END)                   AS pending_count,
                   SUM(CASE WHEN status = 'CANCELLED' OR status = 'EXPIRED' THEN 1 ELSE 0 END)                                 AS cancelled_count,
                   COALESCE(SUM(CASE WHEN status = 'PAID' THEN amount_total_mxn ELSE 0 END), 0)                                AS paid_amount
            FROM transporte_reservations
            WHERE folio_date = ?
        `,
        [dayIso]
    );
    return rows?.[0] || null;
}

async function getReservationStatsByMonth(monthIso) {
    if (!hasDb) return null;

    const [rows] = await pool.query(
        `
            SELECT COUNT(*)                                                                                                       AS total_reservas,
                   SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END)                                                             AS paid_count,
                   SUM(CASE WHEN status = 'PENDING_PAYMENT' OR status = 'PAY_AT_BOARDING' THEN 1 ELSE 0 END)                   AS pending_count,
                   SUM(CASE WHEN status = 'CANCELLED' OR status = 'EXPIRED' THEN 1 ELSE 0 END)                                 AS cancelled_count,
                   COALESCE(SUM(CASE WHEN status = 'PAID' THEN amount_total_mxn ELSE 0 END), 0)                                AS paid_amount
            FROM transporte_reservations
            WHERE DATE_FORMAT(folio_date, '%Y-%m') = ?
        `,
        [monthIso]
    );
    return rows?.[0] || null;
}

/* =========================
   Webhook route
   ========================= */

router.post("/telegram/webhook", async (req, res) => {
    // I ACK fast so Telegram doesn't retry.
    res.status(200).send("OK");

    // Verify secret header (recommended if your URL is public).
    const webhookSecret = readEnvClean("TG_WEBHOOK_SECRET");
    if (webhookSecret) {
        const got = req.get("x-telegram-bot-api-secret-token") || "";
        if (got !== webhookSecret) {
            if (!isProd()) console.warn("TG webhook secret mismatch:", {got: got ? "set" : "empty"});
            return;
        }
    }

    const update = req.body || {};
    const msg = getMessageFromUpdate(update);
    if (!msg?.text) return;

    const {cmd, args} = parseCommand(msg.text);
    if (!cmd) return;

    const chatId = msg.chat?.id;
    if (!chatId) return;

    const chatType = msg.chat?.type || "unknown";
    const threadId = msg.message_thread_id;
    const replyTo = msg.message_id;

    const replyOpts = {
        reply_to_message_id: replyTo,
        ...(threadId ? {message_thread_id: threadId} : {}),
    };

    // Only allow commands in the configured group; allow DM only from admins (so I can test).
    const allowedChatId = readEnvClean("TG_CHAT_ID");
    const isPrivate = chatType === "private";

    if (allowedChatId) {
        if (String(chatId) !== allowedChatId) {
            if (!(isPrivate && isAdmin(update))) return;
        }
    }

    if (!isProd()) {
        console.log("TG cmd:", cmd, "args:", args, "chat:", chatId, "type:", chatType, "thread:", threadId || null);
    }

    /* =========================
       Public commands
       ========================= */

    if (cmd === "/start") {
        await tgReply(
            chatId,
            "👋 <b>TransportApp Notify</b>\n\nEste bot envía notificaciones internas.\nUsa /help para ver comandos.",
            replyOpts
        );
        return;
    }

    if (cmd === "/help") {
        await tgReply(
            chatId,
            "📌 <b>Comandos</b>\n" +
            "/status — Estado del bot\n" +
            "/privacy — Privacidad\n" +
            "/time — Hora del servidor (MTY)\n\n" +
            "<i>Admin</i>:\n" +
            "/ping /chatid /topic /test /version /errors /whoami /uptime /webhook /lastreserve /diario /mensual",
            replyOpts
        );
        return;
    }

    if (cmd === "/status") {
        await tgReply(chatId, "✅ <b>Status</b>\nBot activo.\nNotificaciones: habilitadas.", replyOpts);
        return;
    }

    if (cmd === "/privacy") {
        await tgReply(
            chatId,
            "🔒 <b>Privacidad</b>\nEste bot solo procesa comandos y envía notificaciones.\nNo lee mensajes normales ni guarda conversaciones.",
            replyOpts
        );
        return;
    }

    if (cmd === "/time") {
        await tgReply(chatId, `🕒 <b>Hora</b>\n<code>${nowIsoMty()}</code>`, replyOpts);
        return;
    }

    /* =========================
       Admin gate
       ========================= */

    const adminCmds = new Set([
        "/ping",
        "/chatid",
        "/topic",
        "/test",
        "/version",
        "/errors",
        "/whoami",
        "/uptime",
        "/webhook",
        "/lastreserve",
        "/diario",
        "/mensual",
    ]);

    if (adminCmds.has(cmd) && !isAdmin(update)) {
        await tgReply(chatId, "⛔ Solo admins.", replyOpts);
        return;
    }

    /* =========================
       Admin commands
       ========================= */

    if (cmd === "/ping") {
        await tgReply(chatId, `🏓 pong\n<code>${new Date().toISOString()}</code>`, replyOpts);
        return;
    }

    if (cmd === "/chatid") {
        const kind = String(chatId).startsWith("-100")
            ? "supergroup"
            : (String(chatId).startsWith("-") ? "group" : "private");

        await tgReply(
            chatId,
            `🆔 <b>chat_id</b>: <code>${chatId}</code>\n` +
            `🏷️ <b>type</b>: <code>${kind}</code>\n` +
            `🔐 <b>allowed</b>: <code>${readEnvClean("TG_CHAT_ID") || "not set"}</code>`,
            replyOpts
        );
        return;
    }

    if (cmd === "/topic") {
        await tgReply(chatId, `🧵 <b>message_thread_id</b>: <code>${threadId ?? "null"}</code>`, replyOpts);
        return;
    }

    if (cmd === "/test") {
        await tgReply(chatId, "✅ <b>Test</b>\nNotificación de prueba.", replyOpts);
        return;
    }

    if (cmd === "/version") {
        const ver = readEnvClean("APP_VERSION") || "unknown";
        await tgReply(chatId, `🏷️ <b>Version</b>: <code>${ver}</code>`, replyOpts);
        return;
    }

    if (cmd === "/errors") {
        await tgReply(chatId, "🧾 <b>Errors</b>\nSin buffer de errores configurado.", replyOpts);
        return;
    }

    if (cmd === "/whoami") {
        const from = update?.message?.from || update?.edited_message?.from || update?.callback_query?.from || {};
        const lines = [
            "👤 <b>Whoami</b>",
            `id: <code>${from.id ?? "?"}</code>`,
            from.username ? `user: <code>@${from.username}</code>` : null,
            from.first_name
                ? `name: <code>${from.first_name}${from.last_name ? " " + from.last_name : ""}</code>`
                : null,
            `admin: <code>${isAdmin(update) ? "yes" : "no"}</code>`,
        ].filter(Boolean);

        await tgReply(chatId, lines.join("\n"), replyOpts);
        return;
    }

    if (cmd === "/uptime") {
        const up = Math.round(process.uptime());
        await tgReply(
            chatId,
            `⏱️ <b>Uptime</b>\nsec: <code>${up}</code>\nnode: <code>${process.version}</code>`,
            replyOpts
        );
        return;
    }

    if (cmd === "/webhook") {
        const info = await tgGetWebhookInfo();
        if (!info) {
            await tgReply(chatId, "⚠️ No pude leer getWebhookInfo.", replyOpts);
            return;
        }

        const lines = [
            "🪝 <b>Webhook</b>",
            `url: <code>${escapeHtml(info.url || "empty")}</code>`,
            `pending: <code>${escapeHtml(info.pending_update_count ?? "?")}</code>`,
            info.last_error_message
                ? `last_error: <code>${escapeHtml(String(info.last_error_message).slice(0, 180))}</code>`
                : null,
        ].filter(Boolean);

        await tgReply(chatId, lines.join("\n"), replyOpts);
        return;
    }

    if (cmd === "/lastreserve") {
        if (!hasDb) {
            await tgReply(chatId, "⚠️ DB no configurada en runtime (missing env vars).", replyOpts);
            return;
        }

        try {
            const lastId = await getLastReservationId();
            const snapshot = lastId ? await loadReservationSnapshot(pool, lastId) : null;
            if (!snapshot) {
                await tgReply(chatId, "🟡 No hay reservas aún.", replyOpts);
                return;
            }

            const {text, buttons} = lastReservationMessage(snapshot);
            const keyboard = buildInlineKeyboard(buttons);
            await tgReply(chatId, text, {
                ...replyOpts,
                ...(keyboard.length ? {reply_markup: {inline_keyboard: keyboard}} : {}),
            });
            return;
        } catch (e) {
            await tgReply(chatId, `❌ Error leyendo DB: <code>${escapeHtml(e?.code || e?.message || String(e))}</code>`, replyOpts);
            return;
        }
    }

    if (cmd === "/diario") {
        if (!hasDb) {
            await tgReply(chatId, "⚠️ DB no configurada en runtime (missing env vars).", replyOpts);
            return;
        }

        const dayArg = String(args?.[0] || "").trim();
        const day = dayArg || mtyTodayIsoDate();

        if (!isIsoDate(day)) {
            await tgReply(chatId, "Formato inválido. Usa: <code>/diario</code> o <code>/diario YYYY-MM-DD</code>", replyOpts);
            return;
        }

        try {
            const s = await getReservationStatsByDay(day);
            const lines = [
                `📊 <b>Corte diario</b>`,
                `Fecha: <code>${escapeHtml(day)}</code>`,
                `Reservas: <b>${escapeHtml(Number(s?.total_reservas || 0))}</b>`,
                `Pagadas: <code>${escapeHtml(Number(s?.paid_count || 0))}</code>`,
                `Pendientes: <code>${escapeHtml(Number(s?.pending_count || 0))}</code>`,
                `Canceladas/expiradas: <code>${escapeHtml(Number(s?.cancelled_count || 0))}</code>`,
                `Ingreso pagado: <b>${escapeHtml(moneyMXN(s?.paid_amount || 0))}</b>`,
            ];
            await tgReply(chatId, lines.join("\n"), replyOpts);
            return;
        } catch (e) {
            await tgReply(chatId, `❌ Error leyendo DB: <code>${escapeHtml(e?.code || e?.message || String(e))}</code>`, replyOpts);
            return;
        }
    }

    if (cmd === "/mensual") {
        if (!hasDb) {
            await tgReply(chatId, "⚠️ DB no configurada en runtime (missing env vars).", replyOpts);
            return;
        }

        const monthArg = String(args?.[0] || "").trim();
        const month = monthArg || mtyCurrentIsoMonth();

        if (!isIsoMonth(month)) {
            await tgReply(chatId, "Formato inválido. Usa: <code>/mensual</code> o <code>/mensual YYYY-MM</code>", replyOpts);
            return;
        }

        try {
            const s = await getReservationStatsByMonth(month);
            const lines = [
                `📈 <b>Corte mensual</b>`,
                `Mes: <code>${escapeHtml(month)}</code>`,
                `Reservas: <b>${escapeHtml(Number(s?.total_reservas || 0))}</b>`,
                `Pagadas: <code>${escapeHtml(Number(s?.paid_count || 0))}</code>`,
                `Pendientes: <code>${escapeHtml(Number(s?.pending_count || 0))}</code>`,
                `Canceladas/expiradas: <code>${escapeHtml(Number(s?.cancelled_count || 0))}</code>`,
                `Ingreso pagado: <b>${escapeHtml(moneyMXN(s?.paid_amount || 0))}</b>`,
            ];
            await tgReply(chatId, lines.join("\n"), replyOpts);
            return;
        } catch (e) {
            await tgReply(chatId, `❌ Error leyendo DB: <code>${escapeHtml(e?.code || e?.message || String(e))}</code>`, replyOpts);
            return;
        }
    }

    // Unknown command
    await tgReply(chatId, "❓ Comando no reconocido. Usa /help.", replyOpts);
});

module.exports = router;
