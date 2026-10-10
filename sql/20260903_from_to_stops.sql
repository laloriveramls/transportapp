-- Agrega origen y destino exactos (from_stop, to_stop) a transporte_reservations
ALTER TABLE transporte_reservations
    ADD COLUMN from_stop VARCHAR(40) NULL DEFAULT NULL AFTER vic_location,
    ADD COLUMN to_stop VARCHAR(40) NULL DEFAULT NULL AFTER from_stop;

-- Backfill para reservas existentes basado en la dirección y vic_location
UPDATE transporte_reservations r
JOIN transporte_trips t ON t.id = r.trip_id
JOIN transporte_departure_templates dt ON dt.id = t.template_id
SET r.from_stop = IF(dt.direction = 'VIC_TO_LLE', IFNULL(r.vic_location, 'VIC'), 'LLE'),
    r.to_stop   = IF(dt.direction = 'VIC_TO_LLE', 'LLE', IFNULL(r.vic_location, 'VIC'))
WHERE r.from_stop IS NULL;
