CREATE TABLE counts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  period_id UUID REFERENCES counting_periods(id) ON DELETE CASCADE,
  counted_stock NUMERIC NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved')),
  UNIQUE(branch_id, product_id, period_id)
);
