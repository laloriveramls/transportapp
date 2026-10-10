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
    return {...DEV_PRICING};
}

function previewAvailability(direction) {
    const dir = String(direction || 'VIC_TO_LLE');
    return DEV_TEMPLATES.filter((t) => t.direction === dir).map((t) => ({
        time: t.depart_time,
        available: 6,
    }));
}

function previewSpecialEvents() {
    const {DEFAULT_EVENT, normalizeEvent, formatDateParts, todayISO_MTY} = require('../specialEvents');
    const ev = normalizeEvent({id: 1, template_id: 0, ...DEFAULT_EVENT});
    const today = todayISO_MTY();
    if (ev.end_date < today) return [];

    ev.days = [];
    const start = ev.start_date > today ? ev.start_date : today;
    for (let d = new Date(`${start}T00:00:00Z`); d.toISOString().slice(0, 10) <= ev.end_date; d.setUTCDate(d.getUTCDate() + 1)) {
        const iso = d.toISOString().slice(0, 10);
        const used = (d.getUTCDate() * 3) % (ev.capacity_passengers + 1);
        const available = ev.capacity_passengers - used;
        ev.days.push({
            date: iso,
            ...formatDateParts(iso),
            trip_id: null,
            trip_status: 'OPEN',
            trip_notes: '',
            used,
            capacity: ev.capacity_passengers,
            available,
            past: false,
            bookable: available > 0,
        });
    }
    return [ev];
}

module.exports = {
    isPreviewMode,
    previewTemplates,
    previewPricing,
    previewAvailability,
    previewSpecialEvents,
};
