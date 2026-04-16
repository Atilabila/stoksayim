CREATE TABLE IF NOT EXISTS sales_recipe_map (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sale_product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  target_product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sale_product_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_recipe_map_sale ON sales_recipe_map(sale_product_id);
CREATE INDEX IF NOT EXISTS idx_sales_recipe_map_target ON sales_recipe_map(target_product_id);

ALTER TABLE sales_recipe_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_recipe_map FORCE ROW LEVEL SECURITY;

CREATE POLICY "sales_recipe_map_all_for_anon_authenticated" ON sales_recipe_map
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
