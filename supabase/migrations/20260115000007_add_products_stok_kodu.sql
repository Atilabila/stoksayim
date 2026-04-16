-- Stok Kodu (ST00168 vb.) - şubeler stok Excel ile uyumlu
ALTER TABLE products ADD COLUMN IF NOT EXISTS stok_kodu VARCHAR(50);
