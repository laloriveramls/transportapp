'use strict';

const LLERA_CODE = 'LLE';
const VIC_CENTER_CODE = 'VIC';

// Tarifas por ejido según el otro extremo del viaje (Ciudad Victoria o Llera).
const VIC_LOCATIONS = [
    {code: 'SISAL', label: 'Ej. Sisal', price_to_victoria_mxn: 50, price_to_llera_mxn: 120},
    {code: 'EBANO', label: 'Ej. Ébano', price_to_victoria_mxn: 50, price_to_llera_mxn: 120},
    {code: 'SAN_FRANCISCO', label: 'Ej. San Francisco (Panadero)', price_to_victoria_mxn: 60, price_to_llera_mxn: 60},
    {code: 'ALBERCA', label: 'Ej. Alberca', price_to_victoria_mxn: 60, price_to_llera_mxn: 60},
    {code: 'TROPICO_CANCER', label: 'Trópico de Cáncer', price_to_victoria_mxn: 60, price_to_llera_mxn: 60},
    {code: 'RANCHO_NUEVO_NORTE', label: 'Ej. Rancho Nuevo Norte', price_to_victoria_mxn: 120, price_to_llera_mxn: 50},
    {code: 'TRES_MESAS', label: 'Tres Mesas (Parque Eólico)', price_to_victoria_mxn: 120, price_to_llera_mxn: 50},
    {code: 'ANGOSTURA', label: 'Ej. Angostura', price_to_victoria_mxn: 120, price_to_llera_mxn: 50},
    {code: 'GUAYALEJO', label: 'Ej. Guayalejo', price_to_victoria_mxn: 120, price_to_llera_mxn: 30},
];

const VIC_LOCATION_BY_CODE = new Map(VIC_LOCATIONS.map((loc) => [loc.code, loc]));

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

function getVicLocations() {
    return VIC_LOCATIONS.map((loc) => ({
        ...loc,
        // Compat: price_mxn = tarifa a Victoria (histórico)
        price_mxn: Number(loc.price_to_victoria_mxn),
    }));
}

function resolveVicLocation(code) {
    const key = String(code || '').trim().toUpperCase();
    if (!key) return null;
    return VIC_LOCATION_BY_CODE.get(key) || null;
}

function resolveVicLocationLabel(code) {
    const loc = resolveVicLocation(code);
    return loc ? loc.label : null;
}

function stopLabel(code, basePricing) {
    const key = String(code || '').trim().toUpperCase();
    if (isLlera(key)) return 'Llera';
    if (isVicCenter(key)) return 'Ciudad Victoria';
    const loc = resolveVicLocation(key);
    if (loc) return loc.label;
    return key || '-';
}

function directionFromStops(fromStop, toStop) {
    const from = String(fromStop || '').trim().toUpperCase();
    const to = String(toStop || '').trim().toUpperCase();

    if (!isValidStop(from) || !isValidStop(to) || from === to) return null;
    // Al menos un extremo debe ser ciudad (VIC o LLE); no se permite ejido ↔ ejido.
    if (!isCity(from) && !isCity(to)) return null;

    // Misma lógica que el cliente: ciudad Victoria o destino Llera → sentido VIC_TO_LLE.
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

function formatRouteEndpoint(direction, vicLocation, side) {
    const vicDefault = 'Ciudad Victoria';
    const vicLabel = resolveVicLocationLabel(vicLocation) || vicDefault;
    const isV2L = direction === 'VIC_TO_LLE';

    if (side === 'from') return isV2L ? vicLabel : 'Llera';
    return isV2L ? 'Llera' : vicLabel;
}

function formatRouteLabel(direction, vicLocation, separator = ' → ', fromStop, toStop) {
    const from = String(fromStop || '').trim();
    const to = String(toStop || '').trim();
    if (from && to) {
        return `${stopLabel(from)}${separator}${stopLabel(to)}`;
    }
    if (!direction) return '-';
    return `${formatRouteEndpoint(direction, vicLocation, 'from')}${separator}${formatRouteEndpoint(direction, vicLocation, 'to')}`;
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

    // Sin contraparte clara: conservar tarifa histórica a Victoria.
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

module.exports = {
    LLERA_CODE,
    VIC_CENTER_CODE,
    VIC_LOCATIONS,
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
    priceForVicLocation,
    pricingForVicLocation,
    pricingForStops,
};
