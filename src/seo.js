"use strict";

const {getVicLocations, getCityLabels} = require("./locations");
const {MAX_PASSENGERS_PER_BOOKING, CHILD_AGE_MIN, CHILD_AGE_MAX} = require("./capacity");

const SITE_NAME = "Servicio de Transporte";
const APP_NAME = "TransportApp";
const FALLBACK_BASE_URL = "https://serviciodetransportevic.com";

const PHONE_E164 = "+528344756376";
const PHONE_DISPLAY = "834 475 6376";
const WHATSAPP_URL = "https://wa.me/528344756376";

const DEFAULT_TITLE = "Transporte Victoria a Llera | Pasaje y paquetería";
const DEFAULT_DESCRIPTION =
    "Reserva pasaje y paquetería entre Ciudad Victoria y Llera de Canales, Tamaulipas. Horarios diarios y paradas en ejidos.";

const OG_IMAGE_PATH = "/assets/logo-wide.png";
const OG_IMAGE_WIDTH = 960;
const OG_IMAGE_HEIGHT = 360;
const OG_IMAGE_ALT = "Servicio de Transporte Victoria - Llera";

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

/** "6:30 a. m." */
function time12(value) {
    const [h, m] = hhmm(value).split(":").map(Number);
    if (!Number.isFinite(h)) return "";
    return `${h % 12 || 12}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
}

/** Cierra una frase con punto solo si no termina ya en uno ("a. m." no lleva otro). */
function sentence(text) {
    const t = String(text || "").trim();
    return !t || /[.!?]$/.test(t) ? t : `${t}.`;
}

/** "Ej. Sisal" pasa a "Sisal" para usarlo dentro de una frase. */
function plainStopName(label) {
    return String(label || "").replace(/^Ej\.\s*/i, "").trim();
}

/** "Sisal, Ébano y Tres Mesas" */
function joinList(items) {
    const list = (items || []).filter(Boolean);
    if (list.length <= 1) return list.join("");
    return `${list.slice(0, -1).join(", ")} y ${list[list.length - 1]}`;
}

/** Rango de tarifas de las paradas en ejidos, en ambas direcciones: "de $30 a $120 MXN". */
function stopPriceRange(locations) {
    const prices = [];
    (locations || []).forEach((loc) => {
        [loc.price_to_victoria_mxn, loc.price_to_llera_mxn].forEach((p) => {
            const n = Number(p);
            if (Number.isFinite(n) && n > 0) prices.push(n);
        });
    });
    if (!prices.length) return "";
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return min === max ? formatMxn(min) : `de $${min.toFixed(0)} a ${formatMxn(max)}`;
}

/** "3 salidas al día, de 6:30 a. m. a 4:00 p. m." (vacío si no hay horarios) */
function dailyDepartures(templates, direction) {
    const times = uniqueTimes(templates, direction).sort();
    if (!times.length) return "";
    const count = times.length === 1 ? "1 salida al día" : `${times.length} salidas al día`;
    return times.length === 1
        ? `${count}, a las ${time12(times[0])}`
        : `${count}, de ${time12(times[0])} a ${time12(times[times.length - 1])}`;
}

/**
 * Preguntas frecuentes de la portada. Todo dato que puede cambiar sale de su fuente:
 * tarifas (settings), paradas (vicLocations), ciudades (etiquetas), horarios (plantillas),
 * teléfono y límites (constantes compartidas). Si falta un dato, la respuesta lo omite en lugar de inventarlo.
 */
function homeFaqs(pricing, vicLocations, {templates, cityLabels} = {}) {
    const adult = formatMxn(pricing?.passenger_price_mxn ?? 120);
    const child = formatMxn(pricing?.child_price_mxn ?? 60);
    const pack = formatMxn(pricing?.package_price_mxn ?? 120);
    const labels = cityLabels || getCityLabels();
    const vic = labels.VIC;
    const lle = labels.LLE;
    const stops = (vicLocations || getVicLocations()).filter((loc) => loc && loc.label && Number(loc.active ?? 1) !== 0);
    const range = stopPriceRange(stops);
    const v2l = dailyDepartures(templates, "VIC_TO_LLE");
    const l2v = dailyDepartures(templates, "LLE_TO_VIC");

    const faqs = [
        {
            question: "¿Cómo reservo mi lugar?",
            answer: `Toca Reservar, elige tu ruta, la fecha y un horario con lugares disponibles, captura tus datos y paga en taquilla, por transferencia o en línea. Si prefieres, escríbenos por WhatsApp al ${PHONE_DISPLAY}.`,
        },
        {
            question: "¿Cuánto cuesta el viaje?",
            answer:
                `Entre ${vic} y ${lle} el pasaje cuesta ${adult} por adulto y ${child} por niño. ` +
                `Las paradas en ejidos tienen su propia tarifa${range ? ` (${range})` : ""}, que cambia según el ejido y la dirección del viaje. ` +
                "Puedes estimar tu total con la calculadora.",
        },
    ];

    if (v2l || l2v) {
        const parts = [];
        if (v2l) parts.push(sentence(`De ${vic} a ${lle}: ${v2l}`));
        if (l2v) parts.push(sentence(`De ${lle} a ${vic}: ${l2v}`));
        faqs.push({
            question: "¿A qué hora salen las unidades?",
            answer: `${parts.join(" ")} En la pestaña Horarios ves la lista completa y cuáles ya salieron hoy.`,
        });
    }

    faqs.push(
        {
            question: "¿Dónde abordo?",
            answer: `Hay un punto de salida en ${vic} y otro en ${lle}. En la pestaña Mapa ves la ubicación y puedes abrir la ruta en Google Maps.`,
        },
        {
            question: "¿Hacen paradas en ejidos?",
            answer: stops.length
                ? `Sí. Hacemos parada en ${joinList(stops.map((loc) => plainStopName(loc.label)))}. Al reservar elige tu ejido como origen o destino y el precio se ajusta solo.`
                : "Sí, hay paradas en ejidos del camino. Al reservar elige tu ejido como origen o destino y el precio se ajusta solo.",
        },
        {
            question: "¿Cuántas personas puedo reservar y cuánto pagan los niños?",
            answer:
                `Puedes reservar hasta ${MAX_PASSENGERS_PER_BOOKING} personas en una misma reserva. ` +
                `Los niños de ${CHILD_AGE_MIN} a ${CHILD_AGE_MAX} años pagan ${child}; a partir de los ${CHILD_AGE_MAX + 1} años se paga tarifa de adulto (${adult}).`,
        },
        {
            question: "¿Puedo enviar un paquete?",
            answer: `Sí. Un paquete cuesta ${pack} por envío. Al reservar elige la opción de paquete, el origen y el destino.`,
        },
    );

    return faqs;
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
        name: "Pasaje y paquetería Victoria - Llera",
        itemListElement: [
            {
                "@type": "Offer",
                name: "Pasaje adulto Ciudad Victoria - Llera",
                price: String(adult),
                priceCurrency: "MXN",
                availability: "https://schema.org/InStock",
                url: absoluteUrl(baseUrl, "/reserve"),
            },
            {
                "@type": "Offer",
                name: "Pasaje niño Ciudad Victoria - Llera",
                price: String(child),
                priceCurrency: "MXN",
                availability: "https://schema.org/InStock",
            },
            {
                "@type": "Offer",
                name: "Paquetería Ciudad Victoria - Llera",
                price: String(pack),
                priceCurrency: "MXN",
                availability: "https://schema.org/InStock",
            },
        ],
    };
}

function homeJsonLd({baseUrl, templates, pricing, vicLocations} = {}) {
    const site = cleanBaseUrl(baseUrl);
    const faqs = homeFaqs(pricing, vicLocations, {templates});
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
            name: "Reservar viaje Victoria - Llera",
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
                name: "Servicio de Transporte Victoria - Llera",
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
