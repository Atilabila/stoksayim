-- branch_transfers: şubeler arası sevk irsaliyeleri (giriş/çıkış izi için)
-- Ayrıca raw şube isimlerini kalıcı eşlemek için branch_transfer_branch_map tablosu.

CREATE TABLE IF NOT EXISTS branch_transfers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  to_branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  period_id UUID REFERENCES counting_periods(id) ON DELETE SET NULL,
  transfer_date DATE NOT NULL,
  evrak_no TEXT,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  source_pdf_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Aynı evrak+ürün tekrar yüklenirse duplicate sayıp atlayabilmek için.
-- Not: partial index (WHERE ...) PostgREST upsert ON CONFLICT ile çalışmaz.
-- Bu yüzden normal UNIQUE constraint; Postgres default NULLS DISTINCT olduğundan
-- evrak_no NULL olan satırlar birbiriyle çakışmaz.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ux_branch_transfers_evrak_product'
      AND conrelid = 'branch_transfers'::regclass
  ) THEN
    ALTER TABLE branch_transfers
      ADD CONSTRAINT ux_branch_transfers_evrak_product
      UNIQUE (evrak_no, product_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_branch_transfers_period ON branch_transfers(period_id);
CREATE INDEX IF NOT EXISTS idx_branch_transfers_from ON branch_transfers(from_branch_id, period_id);
CREATE INDEX IF NOT EXISTS idx_branch_transfers_to ON branch_transfers(to_branch_id, period_id);
CREATE INDEX IF NOT EXISTS idx_branch_transfers_date ON branch_transfers(transfer_date);

CREATE TABLE IF NOT EXISTS branch_transfer_branch_map (
  raw_name TEXT PRIMARY KEY,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE branch_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_transfers FORCE ROW LEVEL SECURITY;
ALTER TABLE branch_transfer_branch_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_transfer_branch_map FORCE ROW LEVEL SECURITY;

CREATE POLICY "branch_transfers_all_for_anon_authenticated" ON branch_transfers
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "branch_transfer_branch_map_all_for_anon_authenticated" ON branch_transfer_branch_map
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

