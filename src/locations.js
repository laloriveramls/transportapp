'use strict';

const LLERA_CODE = 'LLE';
const VIC_CENTER_CODE = 'VIC';

const VIC_LOCATIONS = [
    {code: 'SISAL', label: 'Ej. Sisal', price_mxn: 50},
    {code: 'EBANO', label: 'Ej. Ébano', price_mxn: 50},
    {code: 'SAN_FRANCISCO', label: 'Ej. San Francisco (Panadero)', price_mxn: 60},
    {code: 'ALBERCA', label: 'Ej. Alberca', price_mxn: 60},
    {code: 'TROPICO_CANCER', label: 'Trópico de Cáncer', price_mxn: 60},
    {code: 'RANCHO_NUEVO_NORTE', label: 'Ej. Rancho Nuevo Norte', price_mxn: 120},
    {code: 'TRES_MESAS', label: 'Tres Mesas (Parque Eólico)', price_mxn: 120},
    {code: 'ANGOSTURA', label: 'Ej. Angostura', price_mxn: 120},
    {code: 'GUAYALEJO', label: 'Ej. Guayalejo', price_mxn: 120},
];

const VIC_LOCATION_BY_CODE = new Map(VIC_LOCATIONS.map((loc) => [loc.code, loc]));

function isLlera(code) {
    return String(code || '').trim().toUpperCase() === LLERA_CODE;
}

function isVicCenter(code) {
    return String(code || '').trim().toUpperCase() === VIC_CENTER_CODE;
}

function isVicSide(code) {
    const key = String(code || '').trim().toUpperCase();
    return isVicCenter(key) || !!resolveVicLocation(key);
}

function isValidStop(code) {
    const key = String(code || '').trim().toUpperCase();
    return isLlera(key) || isVicSide(key);
}

function getVicLocations() {
    return VIC_LOCATIONS.map((loc) => ({...loc}));
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
    if (isLlera(from) && isVicSide(to)) return 'LLE_TO_VIC';
    if (isVicSide(from) && isLlera(to)) return 'VIC_TO_LLE';
    return null;
}

function vicLocationFromStops(fromStop, toStop) {
    const from = String(fromStop || '').trim().toUpperCase();
    const to = String(toStop || '').trim().toUpperCase();

    if (isLlera(from) && isVicSide(to)) {
        return isVicCenter(to) ? null : to;
    }
    if (isVicSide(from) && isLlera(to)) {
        return isVicCenter(from) ? null : from;
    }
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

function formatRouteLabel(direction, vicLocation, separator = ' → ') {
    if (!direction) return '-';
    return `${formatRouteEndpoint(direction, vicLocation, 'from')}${separator}${formatRouteEndpoint(direction, vicLocation, 'to')}`;
}

function formatRouteLabelFromStops(fromStop, toStop, separator = ' → ') {
    const direction = directionFromStops(fromStop, toStop);
    if (!direction) return '-';
    const vicLocation = vicLocationFromStops(fromStop, toStop);
    return formatRouteLabel(direction, vicLocation, separator);
}

function pricingForVicLocation(basePricing, locationCode) {
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

    const adult = Number(loc.price_mxn);
    return {
        passenger_price_mxn: adult,
        package_price_mxn: adult,
        child_price_mxn: adult / 2,
        vic_location: loc.code,
        vic_location_label: loc.label,
    };
}

module.exports = {
    LLERA_CODE,
    VIC_CENTER_CODE,
    VIC_LOCATIONS,
    getVicLocations,
    isLlera,
    isVicCenter,
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
    pricingForVicLocation,
};
