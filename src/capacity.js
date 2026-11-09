// src/capacity.js
"use strict";

// Sanity ceiling for the per-departure capacity set in admin (guards against typos, not an operational limit).
const MAX_TRIP_CAPACITY = 200;

module.exports = {MAX_TRIP_CAPACITY};
