-- Catálogo editable de paradas/ejidos y nombres de ciudades
CREATE TABLE IF NOT EXISTS transporte_vic_locations (
    code                   VARCHAR(40)    NOT NULL,
    label                  VARCHAR(120)   NOT NULL,
    price_to_victoria_mxn  DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    price_to_llera_mxn     DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    sort_order             INT            NOT NULL DEFAULT 0,
    active                 TINYINT(1)     NOT NULL DEFAULT 1,
    updated_at             TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (code)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

-- Ejecutar solo si aún no existen (ver también src/db/migrations.js):
-- ALTER TABLE transporte_settings ADD COLUMN vic_label VARCHAR(80) NOT NULL DEFAULT 'Ciudad Victoria' AFTER package_price_mxn;
-- ALTER TABLE transporte_settings ADD COLUMN lle_label VARCHAR(80) NOT NULL DEFAULT 'Llera' AFTER vic_label;
