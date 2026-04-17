-- Tedarik CSV eşleşmelerini kalıcı hale getiren haritalar.
-- Amaç: Kullanıcı CSV'yi her yüklediğinde daha önce eşlediği materialName/branchName için
-- ürün/şube otomatik seçili gelsin (pos_product_map mantığının benzeri).

CREATE TABLE IF NOT EXISTS supply_csv_material_map (
  raw_material TEXT PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supply_csv_material_map_product
  ON supply_csv_material_map(product_id);

CREATE TABLE IF NOT EXISTS supply_csv_branch_map (
  raw_branch TEXT PRIMARY KEY,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supply_csv_branch_map_branch
  ON supply_csv_branch_map(branch_id);

ALTER TABLE supply_csv_material_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE supply_csv_material_map FORCE ROW LEVEL SECURITY;
ALTER TABLE supply_csv_branch_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE supply_csv_branch_map FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "supply_csv_material_map_all_for_anon_authenticated" ON supply_csv_material_map;
CREATE POLICY "supply_csv_material_map_all_for_anon_authenticated" ON supply_csv_material_map
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "supply_csv_branch_map_all_for_anon_authenticated" ON supply_csv_branch_map;
CREATE POLICY "supply_csv_branch_map_all_for_anon_authenticated" ON supply_csv_branch_map
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
