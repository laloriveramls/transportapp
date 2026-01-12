// src/routes/telegramWebhook.js
"use strict";

const express = require("express");
const router = express.Router();

const ADMIN_IDS = String(process.env.TG_ADMIN_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function isAdmin(update) {
    const fromId =
        update?.message?.from?.id ??
        update?.callback_query?.from?.id;

    return fromId && ADMIN_IDS.includes(String(fromId));
}

async function tgReply(chatId, text, opts = {}) {
    const token = (process.env.TG_BOT_TOKEN || "").trim();
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

router.post("/telegram/webhook", express.json({limit: "1mb"}), async (req, res) => {
    // I ACK fast so Telegram doesn't retry.
    res.status(200).send("OK");

    const webhookSecret = (process.env.TG_WEBHOOK_SECRET || "").trim();
    if (webhookSecret) {
        const secret = req.get("x-telegram-bot-api-secret-token") || "";
        if (secret !== webhookSecret) {
            console.warn("TG webhook secret mismatch:", {got: secret ? "set" : "empty"});
            return;
        }
    }

    const update = req.body || {};
    const msg = update.message;
    if (!msg?.text) return;

    const text = String(msg.text).trim();
    if (!text.startsWith("/")) return;

    const cmd = text.split(/\s+/)[0].split("@")[0];

    const chatId = msg.chat?.id;
    const threadId = msg.message_thread_id;
    const replyTo = msg.message_id;
    if (!chatId) return;

    console.log("TG cmd:", cmd, "chat:", chatId, "thread:", threadId || null);

    const replyOpts = {
        reply_to_message_id: replyTo,
        ...(threadId ? {message_thread_id: threadId} : {}),
    };

    // Public commands
    if (cmd === "/start") {
        await tgReply(chatId, "👋 <b>TransportApp Notify</b>\n\nEste bot envía notificaciones internas.\nUsa /help para ver comandos.", replyOpts);
        return;
    }

    if (cmd === "/help") {
        await tgReply(
            chatId,
            "📌 <b>Comandos</b>\n" +
            "/status — Estado del bot\n" +
            "/privacy — Privacidad\n\n" +
            "<i>Admin</i>:\n" +
            "/ping /chatid /test /version /errors /topic",
            replyOpts
        );
        return;
    }

    if (cmd === "/status") {
        await tgReply(chatId, "✅ <b>Status</b>\nBot activo.\nNotificaciones: habilitadas.", replyOpts);
        return;
    }

    if (cmd === "/privacy") {
        await tgReply(chatId, "🔒 <b>Privacidad</b>\nEste bot solo procesa comandos y envía notificaciones.\nNo lee mensajes normales ni guarda conversaciones.", replyOpts);
        return;
    }

    // Admin commands
    const adminCmds = new Set(["/ping", "/chatid", "/test", "/version", "/errors", "/topic"]);
    if (adminCmds.has(cmd) && !isAdmin(update)) {
        await tgReply(chatId, "⛔ Solo admins.", replyOpts);
        return;
    }

    if (cmd === "/ping") {
        await tgReply(chatId, `🏓 pong\n${new Date().toISOString()}`, replyOpts);
        return;
    }

    if (cmd === "/chatid") {
        await tgReply(chatId, `🆔 <b>chat_id</b>: <code>${chatId}</code>`, replyOpts);
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
        const ver = (process.env.APP_VERSION || "").trim() || "unknown";
        await tgReply(chatId, `🏷️ <b>Version</b>: <code>${ver}</code>`, replyOpts);
        return;
    }

    if (cmd === "/errors") {
        await tgReply(chatId, "🧾 <b>Errors</b>\nSin buffer de errores configurado.", replyOpts);
        return;
    }
});

module.exports = router;
