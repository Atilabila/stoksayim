-- Paket / Lt karşılaştırma raporları için isteğe bağlı dönüşüm (ürün kartı)
ALTER TABLE products ADD COLUMN IF NOT EXISTS pieces_per_package NUMERIC;
ALTER TABLE products ADD COLUMN IF NOT EXISTS liters_per_unit NUMERIC;

COMMENT ON COLUMN products.pieces_per_package IS 'Birim PAKET ise: paket içi adet (karşılaştırmada tahmini adet için)';
COMMENT ON COLUMN products.liters_per_unit IS 'Birim Lt ise: satır başına litre (çoğu zaman 1)';
