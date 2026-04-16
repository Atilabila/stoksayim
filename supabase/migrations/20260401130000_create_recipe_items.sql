-- Üretim reçeteleri: satılan ürün -> bileşen tüketimi
CREATE TABLE IF NOT EXISTS recipe_items (
  recipe_product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ingredient_product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity_per_recipe NUMERIC NOT NULL,
  recipe_unit VARCHAR(50),
  source_recipe_code VARCHAR(50),
  source_recipe_name VARCHAR(255),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (recipe_product_id, ingredient_product_id)
);

CREATE INDEX IF NOT EXISTS idx_recipe_items_ingredient ON recipe_items(ingredient_product_id);

ALTER TABLE recipe_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable all operations for recipe_items" ON recipe_items;
DROP POLICY IF EXISTS "recipe_items_all_for_anon_authenticated" ON recipe_items;
CREATE POLICY "recipe_items_all_for_anon_authenticated" ON recipe_items
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE recipe_items IS 'Satış ürününün bileşen tüketim reçetesi (ürün bazında malzeme düşümü).';
