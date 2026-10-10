-- Raise departure template capacity ceiling to 14 passengers.
-- Existing templates still at the old 6/7 seat defaults are bumped to 14.
-- Per-template capacity remains editable in Admin → Horarios → Plantillas.

ALTER TABLE transporte_departure_templates
    MODIFY COLUMN capacity_passengers INT(11) NOT NULL DEFAULT 14;

UPDATE transporte_departure_templates
SET capacity_passengers = 14
WHERE capacity_passengers IN (6, 7);
