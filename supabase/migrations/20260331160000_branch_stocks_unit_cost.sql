-- Şube bazlı birim maliyet (ürün kartındaki purchase_price yerine veya yanında)
ALTER TABLE branch_stocks
ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(14, 4);

COMMENT ON COLUMN branch_stocks.unit_cost IS 'Bu şubede bu ürün için birim maliyet (TL); yoksa ürün kartı purchase_price kullanılır.';
