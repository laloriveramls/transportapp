-- Ubicaciones (ejidos) de Ciudad Victoria con tarifa por zona
ALTER TABLE transporte_reservations
    ADD COLUMN vic_location VARCHAR(40) NULL DEFAULT NULL AFTER package_details;
