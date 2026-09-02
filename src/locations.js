'use strict';

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
    VIC_LOCATIONS,
    getVicLocations,
    resolveVicLocation,
    resolveVicLocationLabel,
    pricingForVicLocation,
};
