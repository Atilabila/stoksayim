-- Kategori yönetimi: barkod/manuel ürün eklerken seçilecek kategoriler
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL UNIQUE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all operations for categories" ON categories FOR ALL USING (true) WITH CHECK (true);
