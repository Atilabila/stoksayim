-- Hugin XML dosyalarındaki <SUBE_KODU> değerlerini sistemdeki şubelere
-- kalıcı olarak eşlemek için harita. (Örn: "YUCESONKURT" -> SONKURT şubesi)
-- Bu sayede XML klasörü her yüklendiğinde eşleşme otomatik gelir.

CREATE TABLE IF NOT EXISTS sales_xml_branch_map (
  sube_kodu TEXT PRIMARY KEY,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_xml_branch_map_branch
  ON sales_xml_branch_map(branch_id);

ALTER TABLE sales_xml_branch_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_xml_branch_map FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_xml_branch_map_all_for_anon_authenticated" ON sales_xml_branch_map;
CREATE POLICY "sales_xml_branch_map_all_for_anon_authenticated" ON sales_xml_branch_map
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
