-- 2026-02-09
-- Folio diario: RES-YYYYMMDD-###
-- Requiere MariaDB/MySQL y ejecutar antes de desplegar el cambio en backend.

START TRANSACTION;

-- 1) Add columns used by daily folio.
ALTER TABLE transporte_reservations
    ADD COLUMN IF NOT EXISTS folio_date DATE         NULL AFTER created_at,
    ADD COLUMN IF NOT EXISTS daily_seq  INT UNSIGNED NULL AFTER folio_date;

-- 2) Backfill folio_date from linked trip date.
UPDATE transporte_reservations r
    JOIN transporte_trips t ON t.id = r.trip_id
SET r.folio_date = t.trip_date
WHERE r.folio_date IS NULL;

-- Safety fallback for rare orphan/legacy rows.
UPDATE transporte_reservations
SET folio_date = DATE(created_at)
WHERE folio_date IS NULL;

-- 3) Backfill daily sequence per folio_date ordered by creation.
UPDATE transporte_reservations r
    JOIN (SELECT z.id,
                 z.folio_date,
                 (@seq := IF(@prev_date = z.folio_date, @seq + 1, 1)) AS new_seq,
                 (@prev_date := z.folio_date)                         AS _marker
          FROM (SELECT r2.id, r2.folio_date, r2.created_at
                FROM transporte_reservations r2
                WHERE r2.folio_date IS NOT NULL
                ORDER BY r2.folio_date, r2.created_at, r2.id) z
                   JOIN (SELECT @prev_date := NULL, @seq := 0) vars) s ON s.id = r.id
SET r.daily_seq = s.new_seq
WHERE r.daily_seq IS NULL;

-- 4) Enforce consistency and uniqueness per day.
ALTER TABLE transporte_reservations
    MODIFY COLUMN folio_date DATE NOT NULL,
    MODIFY COLUMN daily_seq INT UNSIGNED NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_res_folio_date_daily_seq
    ON transporte_reservations (folio_date, daily_seq);

COMMIT;

