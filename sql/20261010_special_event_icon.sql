-- Icono de Lucide por viaje especial (nombre kebab-case, ej. 'ferris-wheel', 'music', 'trophy').
-- Se aplica automáticamente al iniciar el servidor (src/db/migrations.js); este archivo es solo referencia.
ALTER TABLE transporte_special_events
    ADD COLUMN icon VARCHAR(40) NOT NULL DEFAULT 'ferris-wheel' AFTER tab_label;
