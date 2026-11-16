-- Paquetería local en Llera: tarifa editable desde el admin (Precios).
-- Es aditiva: si la columna no existe, la app usa $30 por omisión.
ALTER TABLE `transporte_settings`
    ADD COLUMN IF NOT EXISTS `local_package_price_mxn` decimal(10, 2) NOT NULL DEFAULT 30.00 AFTER `package_price_mxn`;
