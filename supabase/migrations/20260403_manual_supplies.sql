-- manual_supplies: Şube + Dönem bazında manuel tedarik girişleri (kalıcı)
CREATE TABLE IF NOT EXISTS manual_supplies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  period_id UUID NOT NULL REFERENCES counting_periods(id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(branch_id, product_id, period_id)
);

CREATE INDEX IF NOT EXISTS idx_manual_supplies_period ON manual_supplies(period_id);
CREATE INDEX IF NOT EXISTS idx_manual_supplies_branch ON manual_supplies(branch_id);

ALTER TABLE manual_supplies ENABLE ROW LEVEL SECURITY;
ALTER TABLE manual_supplies FORCE ROW LEVEL SECURITY;

CREATE POLICY "manual_supplies_all_for_anon_authenticated" ON manual_supplies
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
