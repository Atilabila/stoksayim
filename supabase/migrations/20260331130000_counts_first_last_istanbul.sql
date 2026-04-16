-- Şube+ürün+dönem satırı için ilk ve son sayım giriş zamanı (UTC saklanır; uygulama Europe/Istanbul gösterir)
ALTER TABLE counts ADD COLUMN IF NOT EXISTS first_counted_at TIMESTAMPTZ;
ALTER TABLE counts ADD COLUMN IF NOT EXISTS last_counted_at TIMESTAMPTZ;

UPDATE counts
SET
first_counted_at = COALESCE(first_counted_at, "timestamp"),
last_counted_at = COALESCE(last_counted_at, "timestamp")
WHERE first_counted_at IS NULL OR last_counted_at IS NULL;

CREATE OR REPLACE FUNCTION counts_touch_timestamps_fn()
RETURNS TRIGGER AS $$
BEGIN
IF TG_OP = 'INSERT' THEN
  NEW.first_counted_at := COALESCE(NEW.first_counted_at, NOW());
  NEW.last_counted_at := NOW();
  NEW."timestamp" := NEW.last_counted_at;
ELSIF TG_OP = 'UPDATE' THEN
  NEW.first_counted_at := OLD.first_counted_at;
  IF (OLD.counted_stock IS DISTINCT FROM NEW.counted_stock)
      OR (OLD.person_name IS DISTINCT FROM NEW.person_name) THEN
    NEW.last_counted_at := NOW();
    NEW."timestamp" := NEW.last_counted_at;
  ELSE
    NEW.last_counted_at := OLD.last_counted_at;
    NEW."timestamp" := OLD."timestamp";
  END IF;
END IF;
RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS counts_touch_timestamps ON counts;
CREATE TRIGGER counts_touch_timestamps
BEFORE INSERT OR UPDATE ON counts
FOR EACH ROW
EXECUTE FUNCTION counts_touch_timestamps_fn();

COMMENT ON COLUMN counts.first_counted_at IS 'Bu şube+ürün+dönem satırında ilk sayım kaydı (UTC)';
COMMENT ON COLUMN counts.last_counted_at IS 'Son sayım miktarı/personel güncellemesi (UTC); salt onay durumu değişince dokunulmaz';
