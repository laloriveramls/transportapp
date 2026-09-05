'use strict';

const LLERA_CODE = 'LLE';
const VIC_CENTER_CODE = 'VIC';

const DEFAULT_CITY_LABELS = Object.freeze({
    VIC: 'Ciudad Victoria',
    LLE: 'Llera',
});

// Semilla: tarifas por ejido según el otro extremo (Victoria o Llera).
const DEFAULT_VIC_LOCATIONS = Object.freeze([
    Object.freeze({code: 'SISAL', label: 'Ej. Sisal', price_to_victoria_mxn: 50, price_to_llera_mxn: 120, sort_order: 10, active: 1}),
    Object.freeze({code: 'EBANO', label: 'Ej. Ébano', price_to_victoria_mxn: 50, price_to_llera_mxn: 120, sort_order: 20, active: 1}),
    Object.freeze({code: 'SAN_FRANCISCO', label: 'Ej. San Francisco (Panadero)', price_to_victoria_mxn: 60, price_to_llera_mxn: 60, sort_order: 30, active: 1}),
    Object.freeze({code: 'ALBERCA', label: 'Ej. Alberca', price_to_victoria_mxn: 60, price_to_llera_mxn: 60, sort_order: 40, active: 1}),
    Object.freeze({code: 'TROPICO_CANCER', label: 'Trópico de Cáncer', price_to_victoria_mxn: 60, price_to_llera_mxn: 60, sort_order: 50, active: 1}),
    Object.freeze({code: 'RANCHO_NUEVO_NORTE', label: 'Ej. Rancho Nuevo Norte', price_to_victoria_mxn: 120, price_to_llera_mxn: 50, sort_order: 60, active: 1}),
    Object.freeze({code: 'TRES_MESAS', label: 'Tres Mesas (Parque Eólico)', price_to_victoria_mxn: 120, price_to_llera_mxn: 50, sort_order: 70, active: 1}),
    Object.freeze({code: 'ANGOSTURA', label: 'Ej. Angostura', price_to_victoria_mxn: 120, price_to_llera_mxn: 50, sort_order: 80, active: 1}),
    Object.freeze({code: 'GUAYALEJO', label: 'Ej. Guayalejo', price_to_victoria_mxn: 120, price_to_llera_mxn: 30, sort_order: 90, active: 1}),
]);

/** @type {{code:string,label:string,price_to_victoria_mxn:number,price_to_llera_mxn:number,sort_order:number,active:number}[]} */
let locationsCache = cloneLocations(DEFAULT_VIC_LOCATIONS);
/** @type {{VIC:string,LLE:string}} */
let cityLabelsCache = {...DEFAULT_CITY_LABELS};
/** @type {Map<string, typeof locationsCache[0]>} */
let locationByCode = buildLocationMap(locationsCache);

function cloneLocations(rows) {
    return (rows || []).map((loc) => ({
        code: String(loc.code || '').trim().toUpperCase(),
        label: String(loc.label || '').trim(),
        price_to_victoria_mxn: Number(
            loc.price_to_victoria_mxn ?? loc.price_to_victoria_mxn ?? loc.price_mxn ?? 0
        ),
        price_to_llera_mxn: Number(
            loc.price_to_llera_mxn ?? loc.price_to_llera_mxn ?? loc.price_mxn ?? 0
        ),
        sort_order: Number(loc.sort_order ?? loc.sort_order ?? 0),
        active: Number(loc.active ?? 1) === 0 ? 0 : 1,
    }));
}

function buildLocationMap(rows) {
    return new Map((rows || []).map((loc) => [loc.code, loc]));
}

function normalizeLocationCode(raw) {
    return String(raw || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '_')
        .replace(/[^A-Z0-9_]/g, '')
        .slice(0, 40);
}

function isReservedStopCode(code) {
    const key = normalizeLocationCode(code);
    return key === LLERA_CODE || key === VIC_CENTER_CODE;
}

function setCityLabels(labels) {
    cityLabelsCache = {
        VIC: String(labels?.VIC || labels?.vic_label || DEFAULT_CITY_LABELS.VIC).trim() || DEFAULT_CITY_LABELS.VIC,
        LLE: String(labels?.LLE || labels?.lle_label || DEFAULT_CITY_LABELS.LLE).trim() || DEFAULT_CITY_LABELS.LLE,
    };
    return getCityLabels();
}

function getCityLabels() {
    return {...cityLabelsCache};
}

function setVicLocationsCache(rows) {
    locationsCache = cloneLocations(rows?.length ? rows : DEFAULT_VIC_LOCATIONS);
    locationsCache.sort((a, b) => (a.sort_order - b.sort_order) || a.label.localeCompare(b.label, 'es'));
    locationByCode = buildLocationMap(locationsCache);
    return getVicLocations({includeInactive: true});
}

function resetLocationsToDefaults() {
    setCityLabels(DEFAULT_CITY_LABELS);
    return setVicLocationsCache(DEFAULT_VIC_LOCATIONS);
}

function isLlera(code) {
    return String(code || '').trim().toUpperCase() === LLERA_CODE;
}

function isVicCenter(code) {
    return String(code || '').trim().toUpperCase() === VIC_CENTER_CODE;
}

function isCity(code) {
    return isLlera(code) || isVicCenter(code);
}

function isVicSide(code) {
    const key = String(code || '').trim().toUpperCase();
    return isVicCenter(key) || !!resolveVicLocation(key);
}

function isValidStop(code) {
    const key = String(code || '').trim().toUpperCase();
    return isCity(key) || !!resolveVicLocation(key);
}

function getVicLocations(opts = {}) {
    const includeInactive = !!opts.includeInactive;
    return locationsCache
        .filter((loc) => includeInactive || loc.active === 1)
        .map((loc) => ({
            ...loc,
            // Compat histórico
            price_mxn: Number(loc.price_to_victoria_mxn),
        }));
}

function resolveVicLocation(code) {
    const key = String(code || '').trim().toUpperCase();
    if (!key) return null;
    return locationByCode.get(key) || null;
}

function resolveVicLocationLabel(code) {
    const loc = resolveVicLocation(code);
    return loc ? loc.label : null;
}

function stopLabel(code) {
    const key = String(code || '').trim().toUpperCase();
    if (isLlera(key)) return cityLabelsCache.LLE;
    if (isVicCenter(key)) return cityLabelsCache.VIC;
    const loc = resolveVicLocation(key);
    if (loc) return loc.label;
    return key || '-';
}

function directionFromStops(fromStop, toStop) {
    const from = String(fromStop || '').trim().toUpperCase();
    const to = String(toStop || '').trim().toUpperCase();

    if (!isValidStop(from) || !isValidStop(to) || from === to) return null;
    if (!isCity(from) && !isCity(to)) return null;

    if (isVicCenter(from) || isLlera(to)) return 'VIC_TO_LLE';
    if (isLlera(from) || isVicCenter(to)) return 'LLE_TO_VIC';
    return null;
}

function vicLocationFromStops(fromStop, toStop) {
    const from = String(fromStop || '').trim().toUpperCase();
    const to = String(toStop || '').trim().toUpperCase();

    if (resolveVicLocation(from)) return from;
    if (resolveVicLocation(to)) return to;
    return null;
}

function routeFromStops(fromStop, toStop) {
    return {
        direction: directionFromStops(fromStop, toStop),
        vic_location: vicLocationFromStops(fromStop, toStop),
    };
}

function formatRouteEndpoint(direction, vicLocation, side, fromStop, toStop) {
    const from = String(fromStop || '').trim();
    const to = String(toStop || '').trim();
    if (from && to) {
        return side === 'from' ? stopLabel(from) : stopLabel(to);
    }

    const vicLabel = resolveVicLocationLabel(vicLocation) || cityLabelsCache.VIC;
    const isV2L = direction === 'VIC_TO_LLE';
    if (side === 'from') return isV2L ? vicLabel : cityLabelsCache.LLE;
    return isV2L ? cityLabelsCache.LLE : vicLabel;
}

function routeEndpoints(direction, vicLocation, fromStop, toStop) {
    return {
        fromLabel: formatRouteEndpoint(direction, vicLocation, 'from', fromStop, toStop),
        toLabel: formatRouteEndpoint(direction, vicLocation, 'to', fromStop, toStop),
    };
}

function formatRouteLabel(direction, vicLocation, separator = ' → ', fromStop, toStop) {
    const {fromLabel, toLabel} = routeEndpoints(direction, vicLocation, fromStop, toStop);
    if (!direction && !(String(fromStop || '').trim() && String(toStop || '').trim())) return '-';
    return `${fromLabel}${separator}${toLabel}`;
}

function formatRouteLabelFromStops(fromStop, toStop, separator = ' → ') {
    const from = String(fromStop || '').trim();
    const to = String(toStop || '').trim();
    if (!from || !to) return '-';
    return `${stopLabel(from)}${separator}${stopLabel(to)}`;
}

function priceForVicLocation(locationCode, counterpartCode) {
    const loc = resolveVicLocation(locationCode);
    if (!loc) return null;

    const counterpart = String(counterpartCode || '').trim().toUpperCase();
    if (isLlera(counterpart)) return Number(loc.price_to_llera_mxn);
    if (isVicCenter(counterpart)) return Number(loc.price_to_victoria_mxn);
    return Number(loc.price_to_victoria_mxn);
}

function pricingForVicLocation(basePricing, locationCode, counterpartCode) {
    const base = {
        passenger_price_mxn: Number(basePricing?.passenger_price_mxn ?? 120),
        package_price_mxn: Number(basePricing?.package_price_mxn ?? 120),
        child_price_mxn:
            basePricing?.child_price_mxn != null && basePricing?.child_price_mxn !== ''
                ? Number(basePricing.child_price_mxn)
                : Number(basePricing?.passenger_price_mxn ?? 120) / 2,
    };

    const loc = resolveVicLocation(locationCode);
    if (!loc) return base;

    const adult = priceForVicLocation(locationCode, counterpartCode);
    if (adult == null || Number.isNaN(adult)) return base;

    return {
        passenger_price_mxn: adult,
        package_price_mxn: adult,
        child_price_mxn: adult / 2,
        vic_location: loc.code,
        vic_location_label: loc.label,
    };
}

function pricingForStops(basePricing, fromStop, toStop) {
    const from = String(fromStop || '').trim().toUpperCase();
    const to = String(toStop || '').trim().toUpperCase();
    const locCode = vicLocationFromStops(from, to);
    if (!locCode) return pricingForVicLocation(basePricing, null);

    const counterpart = resolveVicLocation(from) ? to : from;
    return pricingForVicLocation(basePricing, locCode, counterpart);
}

async function hydrateLocationsFromDb(pool) {
    if (!pool) {
        resetLocationsToDefaults();
        return {ok: false, reason: 'no_pool'};
    }

    try {
        const [rows] = await pool.query(`
            SELECT code,
                   label,
                   price_to_victoria_mxn,
                   price_to_llera_mxn,
                   sort_order,
                   active
            FROM transporte_vic_locations
            ORDER BY sort_order ASC, label ASC
        `);

        if (Array.isArray(rows) && rows.length) {
            setVicLocationsCache(rows);
        } else {
            setVicLocationsCache(DEFAULT_VIC_LOCATIONS);
        }
    } catch (e) {
        setVicLocationsCache(DEFAULT_VIC_LOCATIONS);
        return {ok: false, reason: e.message || String(e)};
    }

    try {
        const [[settings]] = await pool.query(`
            SELECT vic_label, lle_label
            FROM transporte_settings
            WHERE id = 1
            LIMIT 1
        `);
        if (settings) {
            setCityLabels({
                VIC: settings.vic_label,
                LLE: settings.lle_label,
            });
        }
    } catch (e) {
        // Columnas aún no creadas: conservar defaults.
    }

    return {ok: true, count: locationsCache.length, cityLabels: getCityLabels()};
}

const VIC_LOCATIONS = DEFAULT_VIC_LOCATIONS.map((loc) => ({...loc}));

module.exports = {
    LLERA_CODE,
    VIC_CENTER_CODE,
    DEFAULT_CITY_LABELS,
    DEFAULT_VIC_LOCATIONS,
    VIC_LOCATIONS,
    normalizeLocationCode,
    isReservedStopCode,
    getCityLabels,
    setCityLabels,
    setVicLocationsCache,
    resetLocationsToDefaults,
    hydrateLocationsFromDb,
    getVicLocations,
    isLlera,
    isVicCenter,
    isCity,
    isVicSide,
    isValidStop,
    resolveVicLocation,
    resolveVicLocationLabel,
    stopLabel,
    directionFromStops,
    vicLocationFromStops,
    routeFromStops,
    formatRouteLabel,
    formatRouteEndpoint,
    formatRouteLabelFromStops,
    routeEndpoints,
    priceForVicLocation,
    pricingForVicLocation,
    pricingForStops,
};
