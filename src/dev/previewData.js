'use strict';

const { hasDb, skipDbRequire } = require('../db');

const DEV_TEMPLATES = [
    { direction: 'VIC_TO_LLE', depart_time: '06:30:00' },
    { direction: 'LLE_TO_VIC', depart_time: '07:30:00' },
    { direction: 'VIC_TO_LLE', depart_time: '09:00:00' },
    { direction: 'LLE_TO_VIC', depart_time: '10:00:00' },
    { direction: 'VIC_TO_LLE', depart_time: '11:00:00' },
    { direction: 'LLE_TO_VIC', depart_time: '12:00:00' },
    { direction: 'VIC_TO_LLE', depart_time: '13:00:00' },
    { direction: 'LLE_TO_VIC', depart_time: '14:00:00' },
    { direction: 'VIC_TO_LLE', depart_time: '16:00:00' },
    { direction: 'LLE_TO_VIC', depart_time: '17:00:00' },
];

const DEV_PRICING = {
    passenger_price_mxn: 120,
    package_price_mxn: 120,
    child_price_mxn: 60,
};

function isPreviewMode() {
    return skipDbRequire() && !hasDb;
}

function previewTemplates() {
    return DEV_TEMPLATES.map((row) => ({ ...row }));
}

function previewPricing() {
    return { ...DEV_PRICING };
}

function previewAvailability(direction) {
    const dir = String(direction || 'VIC_TO_LLE');
    return DEV_TEMPLATES.filter((t) => t.direction === dir).map((t) => ({
        time: t.depart_time,
        available: 6,
    }));
}

module.exports = {
    isPreviewMode,
    previewTemplates,
    previewPricing,
    previewAvailability,
};
