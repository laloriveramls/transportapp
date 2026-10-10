// src/notifications/telegram.js
"use strict";

function envClean(key) {
    // I normalize env values in case the host stores them with quotes.
    let v = String(process.env[key] || "").trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1).trim();
    }
    return v;
}

function escapeHtml(s) {
    return String(s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function chunkText(text, maxLen = 3500) {
    // I split long messages to stay under Telegram limits safely.
    const s = String(text ?? "");
    if (s.length <= maxLen) return [s];

    const chunks = [];
    let i = 0;

    while (i < s.length) {
        let end = Math.min(i + maxLen, s.length);

        // I try to split on a newline for nicer formatting.
        const lastNl = s.lastIndexOf("\n", end);
        if (lastNl > i + 200) end = lastNl;

        chunks.push(s.slice(i, end));
        i = end;
    }

    return chunks.filter(Boolean);
}

/**
 * buttons can be a flat list (one button per row) or a list of rows:
 * [{text, url}] or [[{text, url}, {text, url}], [{text, url}]]
 */
function buildInlineKeyboard(buttons) {
    const toButton = (b) => (b && b.text && (b.url || b.callback_data)
        ? {
            text: String(b.text),
            ...(b.url ? {url: String(b.url)} : {}),
            ...(b.callback_data ? {callback_data: String(b.callback_data)} : {}),
        }
        : null);

    return buttons
        .map((row) => (Array.isArray(row) ? row : [row]).map(toButton).filter(Boolean))
        .filter((row) => row.length);
}

async function tgCall(token, method, payload, timeoutMs = 7000) {
    const url = `https://api.telegram.org/bot${token}/${method}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        // I call Telegram with JSON payload.
        const res = await fetch(url, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        const raw = await res.text();
        let data = null;
        try {
            data = JSON.parse(raw);
        } catch {
            data = null;
        }

        return {ok: res.ok && data?.ok, status: res.status, data, raw};
    } finally {
        clearTimeout(timer);
    }
}

/**
 * sendTelegram(textOrOptions)
 *
 * I support:
 * 1) sendTelegram("plain text")
 * 2) sendTelegram({
 *      text: "message",
 *      parse_mode: "HTML",
 *      buttons: [{ text: "Abrir", url: "https://..." }],
 *      reply_to_message_id: 123,
 *      disable_web_page_preview: true,
 *      disable_notification: false,
 *      message_thread_id: 12345,
 *      chat_id: "-100...." // optional override
 *    })
 */
let warnedMissingConfig = false;

function warnMissingConfig(key) {
    if (warnedMissingConfig) return;
    warnedMissingConfig = true;
    console.warn(`Telegram notifications disabled: ${key} is not set in this environment.`);
}

async function sendTelegram(textOrOptions) {
    const token = envClean("TG_BOT_TOKEN");
    const defaultChatId = envClean("TG_CHAT_ID");

    if (!token) return warnMissingConfig("TG_BOT_TOKEN");

    const opts = typeof textOrOptions === "string" ? {text: textOrOptions} : (textOrOptions || {});
    let chatId = String(opts.chat_id || defaultChatId || "").trim();
    if (!chatId) return warnMissingConfig("TG_CHAT_ID");

    const text = String(opts.text || "").trim();
    if (!text) return;

    // I default to HTML so I can format nicely.
    const parseMode = opts.parse_mode || "HTML";

    // I chunk the message to avoid Telegram size limits.
    const chunks = chunkText(text, 3500);

    for (let idx = 0; idx < chunks.length; idx++) {
        const payload = {
            chat_id: chatId,
            text: chunks[idx],
            parse_mode: parseMode,
            disable_web_page_preview: opts.disable_web_page_preview ?? true,
            disable_notification: opts.disable_notification ?? false,
        };

        // Optional: topics support (Telegram expects a number).
        if (opts.message_thread_id) payload.message_thread_id = Number(opts.message_thread_id);

        // Optional: reply support (only on first chunk)
        if (idx === 0 && opts.reply_to_message_id) payload.reply_to_message_id = opts.reply_to_message_id;

        // Optional: inline buttons (only on last chunk so they show at the end)
        if (idx === chunks.length - 1 && Array.isArray(opts.buttons) && opts.buttons.length) {
            const inlineKeyboard = buildInlineKeyboard(opts.buttons);
            if (inlineKeyboard.length) payload.reply_markup = {inline_keyboard: inlineKeyboard};
        }

        try {
            const r1 = await tgCall(token, "sendMessage", payload);

            if (r1.ok) continue;

            // If Telegram migrated the group to a supergroup, it returns the new chat id.
            const migratedTo = r1.data?.parameters?.migrate_to_chat_id;
            if (r1.status === 400 && migratedTo) {
                // I update the active chat id so next chunks use it too.
                chatId = String(migratedTo);
                payload.chat_id = chatId;

                const rMig = await tgCall(token, "sendMessage", payload);
                if (rMig.ok) continue;

                console.error("Telegram sendMessage failed (after migration retry):", {
                    status: rMig.status,
                    description: rMig.data?.description,
                    raw: rMig.raw,
                    migrated_to_chat_id: chatId,
                });
                return;
            }

            // If rate-limited, I wait and retry once.
            const retryAfter = Number(r1.data?.parameters?.retry_after || 0);
            if (r1.status === 429 && retryAfter > 0) {
                await sleep((retryAfter + 1) * 1000);
                const r2 = await tgCall(token, "sendMessage", payload);
                if (r2.ok) continue;

                // I also handle migration on the retry path (rare, but possible).
                const migratedTo2 = r2.data?.parameters?.migrate_to_chat_id;
                if (r2.status === 400 && migratedTo2) {
                    chatId = String(migratedTo2);
                    payload.chat_id = chatId;

                    const r3 = await tgCall(token, "sendMessage", payload);
                    if (r3.ok) continue;

                    console.error("Telegram sendMessage failed (after retry + migration retry):", {
                        status: r3.status,
                        description: r3.data?.description,
                        raw: r3.raw,
                        migrated_to_chat_id: chatId,
                    });
                    return;
                }

                console.error("Telegram sendMessage failed (after retry):", {
                    status: r2.status,
                    description: r2.data?.description,
                    raw: r2.raw,
                });
                return;
            }

            console.error("Telegram sendMessage failed:", {
                status: r1.status,
                description: r1.data?.description,
                raw: r1.raw,
            });
            return;
        } catch (e) {
            console.error("Telegram notify failed:", e?.name === "AbortError" ? "timeout" : (e?.message || e));
            return;
        }
    }
}

module.exports = {sendTelegram, escapeHtml, buildInlineKeyboard};
