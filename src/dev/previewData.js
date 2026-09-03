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

const DEV_AGENDA_TRIPS = [
    {trip_id: 101, direction: 'VIC_TO_LLE', depart_time: '06:30:00', capacity_passengers: 6, used_seats: 6, packages: 1},
    {trip_id: 102, direction: 'LLE_TO_VIC', depart_time: '07:30:00', capacity_passengers: 6, used_seats: 3, packages: 0},
    {trip_id: 103, direction: 'VIC_TO_LLE', depart_time: '09:00:00', capacity_passengers: 6, used_seats: 4, packages: 0},
    {trip_id: 104, direction: 'LLE_TO_VIC', depart_time: '10:00:00', capacity_passengers: 6, used_seats: 5, packages: 2},
    {trip_id: 105, direction: 'VIC_TO_LLE', depart_time: '11:00:00', capacity_passengers: 6, used_seats: 1, packages: 0},
    {trip_id: 106, direction: 'LLE_TO_VIC', depart_time: '12:00:00', capacity_passengers: 6, used_seats: 0, packages: 1},
    {trip_id: 107, direction: 'VIC_TO_LLE', depart_time: '13:00:00', capacity_passengers: 6, used_seats: 0, packages: 0},
    {trip_id: 108, direction: 'LLE_TO_VIC', depart_time: '14:00:00', capacity_passengers: 6, used_seats: 2, packages: 0},
    {trip_id: 109, direction: 'VIC_TO_LLE', depart_time: '16:00:00', capacity_passengers: 6, used_seats: 5, packages: 0},
    {trip_id: 110, direction: 'LLE_TO_VIC', depart_time: '17:00:00', capacity_passengers: 6, used_seats: 0, packages: 0},
];

function previewAgenda(date) {
    const trips = DEV_AGENDA_TRIPS.map((row) => ({...row, trip_date: date}));
    return {
        date,
        trips,
        totalPassengers: trips.reduce((sum, t) => sum + Number(t.used_seats || 0), 0),
        totalPackages: trips.reduce((sum, t) => sum + Number(t.packages || 0), 0),
        cancelledPassengers: 2,
        cancelledPackages: 1,
    };
}

module.exports = {
    isPreviewMode,
    previewTemplates,
    previewPricing,
    previewAvailability,
    previewAgenda,
};
