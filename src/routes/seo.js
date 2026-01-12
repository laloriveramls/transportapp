// src/routes/seo.js
"use strict";

const express = require("express");
const router = express.Router();

function readEnvClean(key) {
    // I normalize env values in case the host stores them with quotes.
    let v = String(process.env[key] || "").trim();
    if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
    ) {
        v = v.slice(1, -1).trim();
    }
    return v;
}

function baseUrl(req) {
    const env = readEnvClean("BASE_URL");
    if (env) return env.replace(/\/+$/, "");
    return `${req.protocol}://${req.get("host")}`.replace(/\/+$/, "");
}

function xmlEscape(s) {
    // I escape XML reserved characters to keep sitemap valid.
    return String(s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

router.get("/robots.txt", (req, res) => {
    const site = baseUrl(req);

    // I keep bots away from private/admin/token pages and server endpoints.
    const robots = [
        "User-agent: *",
        "Allow: /",

        // Private/admin areas
        "Disallow: /admin",
        "Disallow: /admin/",
        "Disallow: /pay",
        "Disallow: /pay/",
        "Disallow: /checkout",
        "Disallow: /checkout/",
        "Disallow: /ticket",
        "Disallow: /ticket/",

        // Internal endpoints
        "Disallow: /health",
        "Disallow: /stripe",
        "Disallow: /stripe/",

        // I avoid indexing sensitive query flows (Stripe return, etc.)
        "Disallow: /*?session_id=",

        `Sitemap: ${site}/sitemap.xml`,
        "",
    ].join("\n");

    res.setHeader("Cache-Control", "public, max-age=3600");
    res.type("text/plain; charset=utf-8").send(robots);
});

router.get("/sitemap.xml", (req, res) => {
    const site = baseUrl(req);
    const lastmod = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // I only include indexable public pages here.
    const urls = [
        {loc: `${site}/`, changefreq: "daily", priority: "1.0"},
        {loc: `${site}/reserve`, changefreq: "daily", priority: "0.9"},
    ];

    const xml =
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        urls
            .map((u) => {
                return (
                    `  <url>\n` +
                    `    <loc>${xmlEscape(u.loc)}</loc>\n` +
                    `    <lastmod>${xmlEscape(lastmod)}</lastmod>\n` +
                    `    <changefreq>${xmlEscape(u.changefreq)}</changefreq>\n` +
                    `    <priority>${xmlEscape(u.priority)}</priority>\n` +
                    `  </url>`
                );
            })
            .join("\n") +
        `\n</urlset>\n`;

    res.setHeader("Cache-Control", "public, max-age=3600");
    res.type("application/xml; charset=utf-8").send(xml);
});

module.exports = router;
