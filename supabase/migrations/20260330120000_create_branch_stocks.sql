-- Şube bazlı sistem stoku (ürün kartı maliyet ortak; miktar şubeye göre)
CREATE TABLE IF NOT EXISTS branch_stocks (
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (branch_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_branch_stocks_product ON branch_stocks(product_id);

ALTER TABLE branch_stocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all operations for branch_stocks" ON branch_stocks FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE branch_stocks IS 'Şube bazlı beklenen/sistem stok miktarı; sayım onayında güncellenir.';
