CREATE TABLE IF NOT EXISTS pos_product_map (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pos_name TEXT NOT NULL UNIQUE,
  target_product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_map_name ON pos_product_map(pos_name);

ALTER TABLE pos_product_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_product_map FORCE ROW LEVEL SECURITY;

CREATE POLICY "pos_product_map_all_for_anon_authenticated" ON pos_product_map
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
