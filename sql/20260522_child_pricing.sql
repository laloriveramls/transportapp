-- Tarifa niños 6-10 años y conteo en reservas
ALTER TABLE transporte_settings
    ADD COLUMN child_price_mxn DECIMAL(10, 2) NOT NULL DEFAULT 60.00 AFTER passenger_price_mxn;

ALTER TABLE transporte_reservations
    ADD COLUMN child_seats INT NOT NULL DEFAULT 0 AFTER seats;
