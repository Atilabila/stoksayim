-- RLS: tablo sahibi dışındaki roller için politikaların zorunlu uygulanması (Postgres FORCE ROW LEVEL SECURITY)
-- Ayrıca politikaları anon + authenticated rollerine açıkça bağlar (ileride authenticated-only daraltması için hazırlık).

ALTER TABLE branches FORCE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
ALTER TABLE counts FORCE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;
ALTER TABLE counting_periods FORCE ROW LEVEL SECURITY;
ALTER TABLE branch_stocks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable all operations for branches" ON branches;
DROP POLICY IF EXISTS "Enable all operations for products" ON products;
DROP POLICY IF EXISTS "Enable all operations for counts" ON counts;
DROP POLICY IF EXISTS "Enable all operations for categories" ON categories;
DROP POLICY IF EXISTS "Enable all operations for counting_periods" ON counting_periods;
DROP POLICY IF EXISTS "Enable all operations for branch_stocks" ON branch_stocks;

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
