-- Ruta libre para viajes especiales (ej. Victoria -> Monterrey).
-- Se aplica automáticamente al iniciar el servidor (src/db/migrations.js); este archivo es solo referencia.
-- NULL = evento anterior: la ruta se deduce de `direction` (Victoria <-> Llera).
ALTER TABLE transporte_special_events
    ADD COLUMN from_label VARCHAR(40) NULL DEFAULT NULL AFTER direction,
    ADD COLUMN to_label VARCHAR(40) NULL DEFAULT NULL AFTER from_label;
