"use strict";

const lucide = require("lucide");

const STROKE_WIDTH = 2;
const DEFAULT_SIZE = 20;

const ALIASES = {
    "arrow-back": "arrow-left",
    "check-light": "check",
    close: "x",
    home: "house",
    "home-light": "house",
    money: "dollar-sign",
    "moon-dark": "moon",
    pdf: "file-text",
    print: "printer",
    refresh: "refresh-cw",
    schedule: "calendar-clock",
    "sun-dark": "sun",
    "sun-rise": "sunrise",
    "sun-set": "sunset",
    warning: "triangle-alert",
    whatsapp: "message-circle",
    "whatsapp-light": "message-circle",
};

function toPascalCase(name) {
    return String(name)
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("");
}

function escapeAttr(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;");
}

function resolveName(name) {
    const raw = String(name || "circle").trim().toLowerCase();
    return ALIASES[raw] || raw;
}

function getIconNode(name) {
    const official = resolveName(name);
    const pascal = toPascalCase(official);
    const node = lucide[pascal];
    if (!Array.isArray(node)) {
        console.warn(`[icons] Lucide icon not found: ${name} (${pascal})`);
        return { official: "circle", node: lucide.Circle };
    }
    return { official, node };
}

function attrsToString(attrs) {
    return Object.entries(attrs || {})
        .filter(([key, value]) => key !== "key" && value != null)
        .map(([key, value]) => `${key}="${escapeAttr(value)}"`)
        .join(" ");
}

function nodesToInner(nodes) {
    return (nodes || [])
        .map(([tag, attrs]) => {
            const attrStr = attrsToString(attrs);
            return attrStr ? `<${tag} ${attrStr}/>` : `<${tag}/>`;
        })
        .join("");
}

function renderIcon(name, opts = {}) {
    const size = Number(opts.size) > 0 ? Number(opts.size) : DEFAULT_SIZE;
    const extraClass = opts.className || opts.icoClass || "";
    const title = opts.title ? String(opts.title) : "";
    const idAttr = opts.id ? ` id="${escapeAttr(opts.id)}"` : "";
    const { official, node } = getIconNode(name);
    const className = ["ico", extraClass].filter(Boolean).join(" ").trim();
    const a11y = title
        ? ` role="img" aria-label="${escapeAttr(title)}"`
        : " aria-hidden=\"true\"";

    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"`,
        ` fill="none" stroke="currentColor" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"`,
        ` class="${escapeAttr(className)}" data-lucide="${escapeAttr(official)}"${idAttr}${a11y}>`,
        nodesToInner(node),
        "</svg>",
    ].join("");
}

const CLIENT_ICONS = [
    "arrow-left",
    "arrow-left-right",
    "arrow-right",
    "ban",
    "banknote",
    "bus",
    "calendar",
    "car",
    "check",
    "circle",
    "clock",
    "compass",
    "copy",
    "credit-card",
    "dollar-sign",
    "eye",
    "eye-off",
    "file-text",
    "globe",
    "hourglass",
    "house",
    "info",
    "landmark",
    "loader-circle",
    "lock",
    "map",
    "message-circle",
    "minus",
    "moon",
    "package",
    "phone",
    "plus",
    "printer",
    "receipt",
    "refresh-cw",
    "sun",
    "sunrise",
    "sunset",
    "ticket",
    "triangle-alert",
    "undo-2",
    "user",
    "users",
    "wrench",
    "x",
];

function getClientIconMap() {
    const map = {};
    for (const name of CLIENT_ICONS) {
        const { official, node } = getIconNode(name);
        map[official] = nodesToInner(node);
    }
    return map;
}

module.exports = {
    renderIcon,
    resolveName,
    getClientIconMap,
    ALIASES,
    CLIENT_ICONS,
    STROKE_WIDTH,
    DEFAULT_SIZE,
};
