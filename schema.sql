-- schema.sql
-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE branches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_name VARCHAR(255) NOT NULL,
  vkn VARCHAR(20),
  username VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  barcode VARCHAR(100) UNIQUE,
  stok_kodu VARCHAR(50),
  product_name VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  unit VARCHAR(50) DEFAULT 'Adet',
  purchase_price DECIMAL(10, 2) DEFAULT 0, -- Used for valuation
  unit_price DECIMAL(10, 2) DEFAULT 0, -- Selling price (optional)
  current_stock NUMERIC DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  pieces_per_package NUMERIC,
  liters_per_unit NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- YENİ TABLO: Dönemsel Sayım Yönetimi
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL UNIQUE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE counting_periods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_name VARCHAR(100) NOT NULL UNIQUE, -- Örn: 2026 Q1
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE counts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  period_id UUID REFERENCES counting_periods(id) ON DELETE CASCADE,
  counted_stock NUMERIC NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  first_counted_at TIMESTAMPTZ,
  last_counted_at TIMESTAMPTZ,
  person_name VARCHAR(150),
  status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved')),
  -- Ensuring a branch doesn't duplicate a product count inadvertently for the same period
  UNIQUE(branch_id, product_id, period_id)
);

CREATE TABLE branch_stocks (
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit_cost NUMERIC(14, 4),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (branch_id, product_id)
);

CREATE INDEX idx_branch_stocks_product ON branch_stocks(product_id);

CREATE TABLE recipe_items (
  recipe_product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ingredient_product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity_per_recipe NUMERIC NOT NULL,
  recipe_unit VARCHAR(50),
  source_recipe_code VARCHAR(50),
  source_recipe_name VARCHAR(255),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (recipe_product_id, ingredient_product_id)
);

CREATE INDEX idx_recipe_items_ingredient ON recipe_items(ingredient_product_id);

-- Manuel tedarik girişleri (şube + dönem bazlı, kalıcı)
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

-- RLS Ayarları (+ FORCE: supabase/migrations/20260331140000 ile uyumlu hedef durum)
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE counting_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE manual_supplies ENABLE ROW LEVEL SECURITY;

ALTER TABLE branches FORCE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
ALTER TABLE counts FORCE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;
ALTER TABLE counting_periods FORCE ROW LEVEL SECURITY;
ALTER TABLE branch_stocks FORCE ROW LEVEL SECURITY;
ALTER TABLE recipe_items FORCE ROW LEVEL SECURITY;
ALTER TABLE manual_supplies FORCE ROW LEVEL SECURITY;

CREATE POLICY "branches_all_for_anon_authenticated" ON branches
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "products_all_for_anon_authenticated" ON products
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "counts_all_for_anon_authenticated" ON counts
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "categories_all_for_anon_authenticated" ON categories
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "counting_periods_all_for_anon_authenticated" ON counting_periods
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "branch_stocks_all_for_anon_authenticated" ON branch_stocks
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "recipe_items_all_for_anon_authenticated" ON recipe_items
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "manual_supplies_all_for_anon_authenticated" ON manual_supplies
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

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
