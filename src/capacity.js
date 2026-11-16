// src/capacity.js
"use strict";

// Sanity ceiling for the per-departure capacity set in admin (guards against typos, not an operational limit).
const MAX_TRIP_CAPACITY = 200;

// Max passengers per single booking (not the trip capacity). Shared by the booking flow and the public FAQs.
const MAX_PASSENGERS_PER_BOOKING = 14;

// Children pay the child fare between these ages (inclusive). Older passengers pay the adult fare.
const CHILD_AGE_MIN = 6;
const CHILD_AGE_MAX = 10;

module.exports = {MAX_TRIP_CAPACITY, MAX_PASSENGERS_PER_BOOKING, CHILD_AGE_MIN, CHILD_AGE_MAX};
