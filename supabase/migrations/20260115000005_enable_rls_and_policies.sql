-- RLS Ayarları
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE counting_periods ENABLE ROW LEVEL SECURITY;

-- Güvenlik politikaları (uygulama tarafında oturum yönetimi varsayıldı)
CREATE POLICY "Enable all operations for branches" ON branches FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all operations for products" ON products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all operations for counts" ON counts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all operations for counting_periods" ON counting_periods FOR ALL USING (true) WITH CHECK (true);
