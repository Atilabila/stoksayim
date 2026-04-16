-- nostok_merge_map: ST kodu olmayan ürün sayımlarını ST kodlu ürünlere eşleştirme
-- source_product_id: sayımda stok kodu olmayan ürünün id'si
-- target_product_id: eşleştirilecek, ST kodu olan ürünün id'si
CREATE TABLE IF NOT EXISTS nostok_merge_map (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  target_product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_product_id)
);

CREATE INDEX IF NOT EXISTS idx_nostok_merge_source ON nostok_merge_map(source_product_id);
CREATE INDEX IF NOT EXISTS idx_nostok_merge_target ON nostok_merge_map(target_product_id);

ALTER TABLE nostok_merge_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE nostok_merge_map FORCE ROW LEVEL SECURITY;

CREATE POLICY "nostok_merge_map_all_for_anon_authenticated" ON nostok_merge_map
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
