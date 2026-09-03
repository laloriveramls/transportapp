"use strict";

const {getVicLocations} = require("./locations");

const SITE_NAME = "Servicio de Transporte";
const APP_NAME = "TransportApp";
const FALLBACK_BASE_URL = "https://serviciodetransportevic.com";

const PHONE_E164 = "+528344756376";
const PHONE_DISPLAY = "834 475 6376";
const WHATSAPP_URL = "https://wa.me/528344756376";

const DEFAULT_TITLE = "Transporte Victoria ↔ Llera | Pasaje y paquetería";
const DEFAULT_DESCRIPTION =
    "Reserva pasaje y paquetería entre Ciudad Victoria y Llera de Canales, Tamaulipas. Horarios diarios, 6 asientos y paradas en ejidos.";

const OG_IMAGE_PATH = "/assets/logo-wide.png";
const OG_IMAGE_WIDTH = 960;
const OG_IMAGE_HEIGHT = 360;
const OG_IMAGE_ALT = "Servicio de Transporte Victoria ↔ Llera";

const VICTORIA = {
    name: "Ciudad Victoria",
    latitude: 23.737544,
    longitude: -99.130954,
};

const LLERA = {
    name: "Llera de Canales",
    latitude: 23.317522,
    longitude: -99.023979,
};

const NOINDEX_PATH = /^(?:\/admin(?:\/|$)|\/pay(?:\/|$)|\/checkout(?:\/|$)|\/ticket(?:\/|$)|\/health(?:\/|$)|\/stripe(?:\/|$)|\/telegram(?:\/|$)|\/availability(?:\/|$)|\/pricing(?:\/|$))/i;

function cleanBaseUrl(value) {
    const raw = String(value || "").trim();
    return (raw || FALLBACK_BASE_URL).replace(/\/+$/, "");
}

function absoluteUrl(baseUrl, path = "/") {
    const base = cleanBaseUrl(baseUrl);
    if (!path || path === "/") return `${base}/`;
    const suffix = String(path).startsWith("/") ? path : `/${path}`;
    return `${base}${suffix}`;
}

function ogImageUrl(baseUrl) {
    return absoluteUrl(baseUrl, OG_IMAGE_PATH);
}

function orgId(baseUrl) {
    return `${absoluteUrl(baseUrl)}#negocio`;
}

function websiteId(baseUrl) {
    return `${absoluteUrl(baseUrl)}#sitio`;
}

function formatMxn(amount) {
    const value = Number(amount || 0);
    return `$${value.toFixed(0)} MXN`;
}

function hhmm(value) {
    return String(value || "").slice(0, 5);
}

function uniqueTimes(templates, direction) {
    return (templates || [])
        .filter((row) => row && row.direction === direction)
        .map((row) => hhmm(row.depart_time))
        .filter(Boolean);
}

function serializeJsonLd(data) {
    return JSON.stringify(data).replace(/</g, "\\u003c");
}

function homeFaqs(pricing, vicLocations) {
    const adult = formatMxn(pricing?.passenger_price_mxn ?? 120);
    const child = formatMxn(pricing?.child_price_mxn ?? 60);
    const pack = formatMxn(pricing?.package_price_mxn ?? 120);
    const stops = (vicLocations || getVicLocations())
        .map((loc) => loc.label)
        .filter(Boolean);
    const stopList = stops.length
        ? stops.join(", ")
        : "ejidos del tramo Victoria";

    return [
        {
            question: "¿Cómo reservo un viaje de Victoria a Llera?",
            answer:
                "Entra a Reservar, elige origen, destino, fecha y horario con cupo. Captura tus datos y paga en taquilla, por transferencia o en línea. También puedes escribir por WhatsApp al 834 475 6376.",
        },
        {
            question: "¿Cuánto cuesta el pasaje y la paquetería?",
            answer: `El pasaje adulto entre Ciudad Victoria y Llera es de ${adult}, niños de ${child} y paquetería de ${pack}. Las paradas en ejidos tienen tarifa distinta según vayas a Victoria o a Llera.`,
        },
        {
            question: "¿Dónde salen las unidades?",
            answer:
                "Hay punto de salida en Ciudad Victoria y en Llera de Canales. En la pestaña Mapa de la página de inicio puedes abrir la ubicación o cómo llegar.",
        },
        {
            question: "¿Hacen paradas en ejidos?",
            answer: `Sí. Hay paradas en ${stopList}. Al reservar elige origen y destino para ver el precio de ese tramo (a Victoria o a Llera).`,
        },
        {
            question: "¿Cuántos pasajeros caben y cómo se cobra el niño?",
            answer:
                "Máximo 6 personas por salida. El adulto paga tarifa completa y el niño de 6 a 10 años paga la tarifa infantil. Al reservar elige cuántos asientos de cada tipo.",
        },
    ];
}

function scheduleSummary(templates) {
    const v2l = uniqueTimes(templates, "VIC_TO_LLE");
    const l2v = uniqueTimes(templates, "LLE_TO_VIC");
    const parts = [];
    if (v2l.length) parts.push(`Victoria a Llera ${v2l.join(", ")}`);
    if (l2v.length) parts.push(`Llera a Victoria ${l2v.join(", ")}`);
    return parts.join(". ");
}

function localBusinessNode(baseUrl, {templates, pricing} = {}) {
    const site = absoluteUrl(baseUrl);
    const hours = scheduleSummary(templates);
    return {
        "@type": ["LocalBusiness", "TaxiService"],
        "@id": orgId(baseUrl),
        name: SITE_NAME,
        alternateName: APP_NAME,
        url: site,
        image: ogImageUrl(baseUrl),
        logo: absoluteUrl(baseUrl, "/assets/logo-hero.png"),
        telephone: PHONE_E164,
        priceRange: "$$",
        currenciesAccepted: "MXN",
        paymentAccepted: "Cash, Credit Card, Bank Transfer",
        description: hours
            ? `Transporte de pasaje y paquetería entre Ciudad Victoria y Llera de Canales. Horarios: ${hours}.`
            : "Transporte de pasaje y paquetería entre Ciudad Victoria y Llera de Canales, Tamaulipas.",
        areaServed: [
            {
                "@type": "City",
                name: VICTORIA.name,
                containedInPlace: {
                    "@type": "State",
                    name: "Tamaulipas",
                    containedInPlace: {"@type": "Country", name: "México"},
                },
            },
            {
                "@type": "City",
                name: LLERA.name,
                containedInPlace: {
                    "@type": "State",
                    name: "Tamaulipas",
                },
            },
        ],
        address: {
            "@type": "PostalAddress",
            addressLocality: VICTORIA.name,
            addressRegion: "Tamaulipas",
            addressCountry: "MX",
        },
        geo: {
            "@type": "GeoCoordinates",
            latitude: VICTORIA.latitude,
            longitude: VICTORIA.longitude,
        },
        hasMap: `https://www.google.com/maps?q=${VICTORIA.latitude},${VICTORIA.longitude}`,
        sameAs: [WHATSAPP_URL],
        knowsAbout: [
            "Transporte Victoria Llera",
            "Pasaje Ciudad Victoria",
            "Paquetería Llera de Canales",
        ],
        hasOfferCatalog: offerCatalog(baseUrl, pricing),
    };
}

function websiteNode(baseUrl) {
    return {
        "@type": "WebSite",
        "@id": websiteId(baseUrl),
        url: absoluteUrl(baseUrl),
        name: SITE_NAME,
        inLanguage: "es-MX",
        publisher: {"@id": orgId(baseUrl)},
    };
}

function breadcrumbNode(baseUrl, crumbs) {
    return {
        "@type": "BreadcrumbList",
        itemListElement: crumbs.map((crumb, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: crumb.name,
            item: absoluteUrl(baseUrl, crumb.path),
        })),
    };
}

function offerCatalog(baseUrl, pricing) {
    const adult = Number(pricing?.passenger_price_mxn ?? 120);
    const child = Number(pricing?.child_price_mxn ?? 60);
    const pack = Number(pricing?.package_price_mxn ?? 120);

    return {
        "@type": "OfferCatalog",
        name: "Pasaje y paquetería Victoria ↔ Llera",
        itemListElement: [
            {
                "@type": "Offer",
                name: "Pasaje adulto Ciudad Victoria ↔ Llera",
                price: String(adult),
                priceCurrency: "MXN",
                availability: "https://schema.org/InStock",
                url: absoluteUrl(baseUrl, "/reserve"),
            },
            {
                "@type": "Offer",
                name: "Pasaje niño Ciudad Victoria ↔ Llera",
                price: String(child),
                priceCurrency: "MXN",
                availability: "https://schema.org/InStock",
            },
            {
                "@type": "Offer",
                name: "Paquetería Ciudad Victoria ↔ Llera",
                price: String(pack),
                priceCurrency: "MXN",
                availability: "https://schema.org/InStock",
            },
        ],
    };
}

function homeJsonLd({baseUrl, templates, pricing, vicLocations} = {}) {
    const site = cleanBaseUrl(baseUrl);
    const faqs = homeFaqs(pricing, vicLocations);
    const graph = [
        localBusinessNode(site, {templates, pricing}),
        websiteNode(site),
        {
            "@type": "WebPage",
            "@id": `${absoluteUrl(site)}#inicio`,
            url: absoluteUrl(site),
            name: DEFAULT_TITLE,
            description: DEFAULT_DESCRIPTION,
            inLanguage: "es-MX",
            isPartOf: {"@id": websiteId(site)},
            about: {"@id": orgId(site)},
            primaryImageOfPage: ogImageUrl(site),
        },
        breadcrumbNode(site, [
            {name: "Inicio", path: "/"},
        ]),
        {
            "@type": "FAQPage",
            mainEntity: faqs.map((item) => ({
                "@type": "Question",
                name: item.question,
                acceptedAnswer: {
                    "@type": "Answer",
                    text: item.answer,
                },
            })),
        },
    ];

    return serializeJsonLd({
        "@context": "https://schema.org",
        "@graph": graph,
    });
}

function reserveJsonLd({baseUrl, pricing} = {}) {
    const site = cleanBaseUrl(baseUrl);
    const graph = [
        localBusinessNode(site, {pricing}),
        websiteNode(site),
        {
            "@type": "WebPage",
            "@id": `${absoluteUrl(site, "/reserve")}#reserva`,
            url: absoluteUrl(site, "/reserve"),
            name: "Reservar viaje Victoria ↔ Llera",
            description:
                "Reserva pasaje o paquetería entre Ciudad Victoria y Llera. Elige ruta, fecha y horario con cupo.",
            inLanguage: "es-MX",
            isPartOf: {"@id": websiteId(site)},
            about: {"@id": orgId(site)},
        },
        breadcrumbNode(site, [
            {name: "Inicio", path: "/"},
            {name: "Reservar", path: "/reserve"},
        ]),
        {
            "@type": "ReserveAction",
            name: "Reservar transporte Victoria Llera",
            target: absoluteUrl(site, "/reserve"),
            provider: {"@id": orgId(site)},
            object: {
                "@type": "TaxiService",
                name: "Servicio de Transporte Victoria ↔ Llera",
                hasOfferCatalog: offerCatalog(site, pricing),
            },
        },
    ];

    return serializeJsonLd({
        "@context": "https://schema.org",
        "@graph": graph,
    });
}

function isNoindexPath(pathname) {
    return NOINDEX_PATH.test(String(pathname || ""));
}

module.exports = {
    SITE_NAME,
    APP_NAME,
    FALLBACK_BASE_URL,
    PHONE_E164,
    PHONE_DISPLAY,
    WHATSAPP_URL,
    DEFAULT_TITLE,
    DEFAULT_DESCRIPTION,
    OG_IMAGE_PATH,
    OG_IMAGE_WIDTH,
    OG_IMAGE_HEIGHT,
    OG_IMAGE_ALT,
    VICTORIA,
    LLERA,
    cleanBaseUrl,
    absoluteUrl,
    ogImageUrl,
    formatMxn,
    homeFaqs,
    homeJsonLd,
    reserveJsonLd,
    serializeJsonLd,
    isNoindexPath,
};
