'use strict';

const { hasDb, skipDbRequire } = require('../db');
const { DEFAULT_VIC_LOCATIONS, getCityLabels } = require('../locations');

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

function previewTrip(tripId, date) {
    const id = Number(tripId) || 101;
    const base = DEV_AGENDA_TRIPS.find((t) => t.trip_id === id) || DEV_AGENDA_TRIPS[0];
    const tripDate = date || new Date().toLocaleDateString('en-CA', {timeZone: 'America/Monterrey'});
    const trip = {
        trip_id: base.trip_id,
        trip_date: tripDate,
        direction: base.direction,
        depart_time: base.depart_time,
        capacity_passengers: base.capacity_passengers,
    };

    const reservations = [
        {
            id: 9001,
            type: 'PASSENGER',
            status: 'PAID',
            customer_name: 'Ana Ruiz',
            phone: '8341234567',
            payment_method: 'ONLINE',
            seats: 2,
            passenger_count: 2,
            passenger_names: 'Ana Ruiz, Luis Ruiz',
            from_stop: 'VICTORIA',
            to_stop: 'LLERA',
            ticket_code: 'TKT-PREV-01',
            created_at: `${tripDate} 08:12:00`,
        },
        {
            id: 9002,
            type: 'PASSENGER',
            status: 'PENDING_PAYMENT',
            customer_name: 'Carlos Méndez',
            phone: '8347654321',
            payment_method: 'TRANSFERENCIA',
            seats: 1,
            passenger_count: 1,
            passenger_names: 'Carlos Méndez',
            from_stop: 'VICTORIA',
            to_stop: 'SISAL',
            ticket_code: 'TKT-PREV-02',
            created_at: `${tripDate} 09:05:00`,
        },
        {
            id: 9003,
            type: 'PACKAGE',
            status: 'PAY_AT_BOARDING',
            customer_name: 'María López',
            phone: '8345551212',
            payment_method: 'TAQUILLA',
            seats: 1,
            package_details: 'Caja mediana',
            ticket_code: null,
            created_at: `${tripDate} 09:40:00`,
        },
    ];

    return {trip, reservations};
}

function previewRecent(opts = {}) {
    const pageSize = Math.max(10, Math.min(200, Number(opts.pageSize || 25)));
    const page = Math.max(1, Number(opts.page || 1));
    const tripDate = opts.date || new Date().toLocaleDateString('en-CA', {timeZone: 'America/Monterrey'});
    const all = [
        {
            id: 8001,
            type: 'PASSENGER',
            status: 'PAID',
            customer_name: 'Ana Ruiz',
            phone: '8341234567',
            payment_method: 'ONLINE',
            seats: 2,
            amount_total_mxn: 240,
            created_at: `${tripDate} 08:12:00`,
            trip_id: 101,
            trip_date: tripDate,
            direction: 'VIC_TO_LLE',
            depart_time: '06:30:00',
            folio: `RES-${tripDate.replace(/-/g, '')}-001`,
            ticket_code: 'TKT-PREV-01',
            passenger_names: 'Ana Ruiz, Luis Ruiz',
            passenger_count: 2,
        },
        {
            id: 8002,
            type: 'PASSENGER',
            status: 'PENDING_PAYMENT',
            customer_name: 'Carlos Méndez',
            phone: '8347654321',
            payment_method: 'TRANSFERENCIA',
            seats: 1,
            amount_total_mxn: 120,
            transfer_ref: 'SPEI-9988',
            created_at: `${tripDate} 09:05:00`,
            trip_id: 103,
            trip_date: tripDate,
            direction: 'VIC_TO_LLE',
            depart_time: '09:00:00',
            folio: `RES-${tripDate.replace(/-/g, '')}-002`,
            ticket_code: 'TKT-PREV-02',
            passenger_names: 'Carlos Méndez',
            passenger_count: 1,
        },
        {
            id: 8003,
            type: 'PACKAGE',
            status: 'PAY_AT_BOARDING',
            customer_name: 'María López',
            phone: '8345551212',
            payment_method: 'TAQUILLA',
            seats: 1,
            package_details: 'Caja mediana',
            amount_total_mxn: 120,
            created_at: `${tripDate} 09:40:00`,
            trip_id: 104,
            trip_date: tripDate,
            direction: 'LLE_TO_VIC',
            depart_time: '10:00:00',
            folio: `RES-${tripDate.replace(/-/g, '')}-003`,
            ticket_code: null,
            passenger_names: '',
            passenger_count: 0,
        },
        {
            id: 8004,
            type: 'PASSENGER',
            status: 'CANCELLED',
            customer_name: 'Pedro Díaz',
            phone: '8341112233',
            payment_method: 'ONLINE',
            seats: 1,
            amount_total_mxn: 120,
            created_at: `${tripDate} 07:20:00`,
            trip_id: 102,
            trip_date: tripDate,
            direction: 'LLE_TO_VIC',
            depart_time: '07:30:00',
            folio: `RES-${tripDate.replace(/-/g, '')}-004`,
            ticket_code: 'TKT-PREV-04',
            passenger_names: 'Pedro Díaz',
            passenger_count: 1,
        },
    ];

    const q = String(opts.q || '').trim().toLowerCase();
    const pm = String(opts.pm || '').trim().toUpperCase();
    let rows = all;
    if (pm === 'TAQUILLA' || pm === 'TRANSFERENCIA' || pm === 'ONLINE') {
        rows = rows.filter((r) => String(r.payment_method || '').toUpperCase() === pm);
    }
    if (q) {
        rows = rows.filter((r) => {
            const hay = [r.folio, r.ticket_code, r.phone, r.customer_name, String(r.id)]
                .join(' ')
                .toLowerCase();
            return hay.includes(q);
        });
    }

    const statusCounts = {
        PAID: 0,
        PENDING_PAYMENT: 0,
        PAY_AT_BOARDING: 0,
        CANCELLED: 0,
    };
    for (const row of rows) {
        if (Object.prototype.hasOwnProperty.call(statusCounts, row.status)) {
            statusCounts[row.status] += 1;
        }
    }

    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;
    const recentRows = rows.slice(offset, offset + pageSize);
    const from = total === 0 ? 0 : offset + 1;
    const to = total === 0 ? 0 : Math.min(offset + recentRows.length, total);

    return {
        recentRows,
        page: safePage,
        pageSize,
        total,
        totalPages,
        pages: totalPages,
        from,
        to,
        statusCounts,
    };
}

function previewHorariosRows(direction) {
    const dir = String(direction || 'VIC_TO_LLE');
    return DEV_TEMPLATES.filter((t) => t.direction === dir).map((t, idx) => {
        const used = [6, 3, 4, 1, 0][idx % 5];
        const capacity = 6;
        return {
            template_id: 1000 + idx,
            direction: dir,
            depart_time: String(t.depart_time).slice(0, 5),
            capacity,
            template_active: true,
            trip_id: 2000 + idx,
            trip_status: 'OPEN',
            trip_notes: '',
            used,
            available: Math.max(0, capacity - used),
        };
    });
}

function previewTemplateRows(direction) {
    const dir = String(direction || '').trim();
    return DEV_TEMPLATES
        .filter((t) => !dir || t.direction === dir)
        .map((t, idx) => ({
            id: 1000 + idx,
            direction: t.direction,
            depart_time: String(t.depart_time).slice(0, 5),
            capacity_passengers: 6,
            active: 1,
        }));
}


function previewLocations() {
    return DEFAULT_VIC_LOCATIONS.map((loc) => ({ ...loc }));
}

function previewCityLabels() {
    return getCityLabels();
}

module.exports = {
    isPreviewMode,
    previewTemplates,
    previewPricing,
    previewAvailability,
    previewAgenda,
    previewTrip,
    previewRecent,
    previewHorariosRows,
    previewTemplateRows,
    previewLocations,
    previewCityLabels,
};
