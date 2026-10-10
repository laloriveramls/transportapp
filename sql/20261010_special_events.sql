-- Viajes especiales (ej. Feria Tamaulipas 2026).
-- Se aplica automáticamente al iniciar el servidor (src/db/migrations.js); este archivo es solo referencia.

-- 1) Las plantillas de salida pueden pertenecer a un viaje especial (0 = horario regular)
ALTER TABLE transporte_departure_templates
    ADD COLUMN special_event_id INT NOT NULL DEFAULT 0 AFTER active;

-- 2) El índice único ahora incluye special_event_id (permite LLE_TO_VIC 17:00 regular y especial)
ALTER TABLE transporte_departure_templates
    ADD UNIQUE KEY uq_template_dir_time_event (direction, depart_time, special_event_id);
ALTER TABLE transporte_departure_templates
    DROP INDEX `direction`;

-- 3) Catálogo de viajes especiales
CREATE TABLE transporte_special_events
(
    id                  INT                              NOT NULL AUTO_INCREMENT,
    slug                VARCHAR(80)                      NOT NULL,
    title               VARCHAR(120)                     NOT NULL,
    tab_label           VARCHAR(40)                      NOT NULL,
    icon                VARCHAR(40)                      NOT NULL DEFAULT 'ferris-wheel',
    description         VARCHAR(255)                     NULL     DEFAULT NULL,
    direction           ENUM ('VIC_TO_LLE','LLE_TO_VIC') NOT NULL DEFAULT 'LLE_TO_VIC',
    depart_time         TIME                             NOT NULL,
    return_time         TIME                             NULL     DEFAULT NULL,
    start_date          DATE                             NOT NULL,
    end_date            DATE                             NOT NULL,
    capacity_passengers INT                              NOT NULL DEFAULT 14,
    price_mxn           DECIMAL(10, 2)                   NOT NULL DEFAULT 0.00,
    active              TINYINT(1)                       NOT NULL DEFAULT 1,
    template_id         INT                              NULL     DEFAULT NULL,
    created_at          TIMESTAMP                        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP                        NULL     DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_special_events_slug (slug)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

-- 4) Feria Tamaulipas 2026 + su plantilla dedicada
INSERT INTO transporte_special_events(slug, title, tab_label, description, direction, depart_time, return_time,
                                      start_date, end_date, capacity_passengers, price_mxn, active)
VALUES ('feria-tamaulipas-2026', 'Feria Tamaulipas 2026', 'Feria 2026',
        'Viaje redondo de Llera a la Feria Tamaulipas en Ciudad Victoria. Sales a las 5:00 PM y regresas a las 11:00 PM.',
        'LLE_TO_VIC', '17:00:00', '23:00:00', '2026-10-15', '2026-10-26', 14, 300.00, 1);

INSERT INTO transporte_departure_templates(direction, depart_time, capacity_passengers, active, special_event_id)
SELECT direction, depart_time, capacity_passengers, active, id
FROM transporte_special_events
WHERE slug = 'feria-tamaulipas-2026';

UPDATE transporte_special_events se
    JOIN transporte_departure_templates dt ON dt.special_event_id = se.id
SET se.template_id = dt.id
WHERE se.slug = 'feria-tamaulipas-2026';
