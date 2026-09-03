// src/routes/seo.js
"use strict";

const express = require("express");
const router = express.Router();
const {FALLBACK_BASE_URL, absoluteUrl} = require("../seo");

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
    return `${req.protocol}://${req.get("host")}`.replace(/\/+$/, "") || FALLBACK_BASE_URL;
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

    const robots = [
        "User-agent: *",
        "Allow: /",
        "Allow: /reserve",

        "Disallow: /admin",
        "Disallow: /admin/",
        "Disallow: /pay",
        "Disallow: /pay/",
        "Disallow: /checkout",
        "Disallow: /checkout/",
        "Disallow: /ticket",
        "Disallow: /ticket/",

        "Disallow: /health",
        "Disallow: /stripe",
        "Disallow: /stripe/",
        "Disallow: /telegram",
        "Disallow: /telegram/",
        "Disallow: /availability",
        "Disallow: /pricing",

        "Disallow: /*?session_id=",
        "Disallow: /*?utm_source=pwa",

        `Sitemap: ${site}/sitemap.xml`,
        "",
    ].join("\n");

    res.setHeader("Cache-Control", "public, max-age=3600");
    res.type("text/plain; charset=utf-8").send(robots);
});

router.get("/sitemap.xml", (req, res) => {
    const site = baseUrl(req);
    const lastmod = new Date().toISOString().slice(0, 10);

    const urls = [
        {
            loc: absoluteUrl(site, "/"),
            changefreq: "daily",
            priority: "1.0",
            images: [
                {loc: absoluteUrl(site, "/assets/logo-hero.png"), title: "Servicio de Transporte Victoria Llera"},
                {loc: absoluteUrl(site, "/assets/logo-wide.png"), title: "Servicio de Transporte"},
            ],
        },
        {
            loc: absoluteUrl(site, "/reserve"),
            changefreq: "daily",
            priority: "0.9",
            images: [
                {loc: absoluteUrl(site, "/assets/logo-wide.png"), title: "Reservar viaje Victoria Llera"},
            ],
        },
    ];

    const xml =
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n` +
        urls
            .map((u) => {
                const images = (u.images || [])
                    .map((img) => {
                        return (
                            `    <image:image>\n` +
                            `      <image:loc>${xmlEscape(img.loc)}</image:loc>\n` +
                            `      <image:title>${xmlEscape(img.title)}</image:title>\n` +
                            `    </image:image>`
                        );
                    })
                    .join("\n");
                return (
                    `  <url>\n` +
                    `    <loc>${xmlEscape(u.loc)}</loc>\n` +
                    `    <lastmod>${xmlEscape(lastmod)}</lastmod>\n` +
                    `    <changefreq>${xmlEscape(u.changefreq)}</changefreq>\n` +
                    `    <priority>${xmlEscape(u.priority)}</priority>\n` +
                    (images ? `${images}\n` : "") +
                    `  </url>`
                );
            })
            .join("\n") +
        `\n</urlset>\n`;

    res.setHeader("Cache-Control", "public, max-age=3600");
    res.type("application/xml; charset=utf-8").send(xml);
});

module.exports = router;
