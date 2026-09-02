'use strict';

const { hasDb, skipDbRequire } = require('../db');

function requireDb(req, res, next) {
    if (hasDb || skipDbRequire()) return next();
    return res.status(503).render('maintenance', {
        title: 'Sitio en configuración',
        message:
            'El sitio está activo, pero la base de datos aún no está configurada. Intenta más tarde.',
    });
}

module.exports = { requireDb };
