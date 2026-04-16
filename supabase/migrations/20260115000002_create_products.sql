CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  barcode VARCHAR(100) UNIQUE,
  product_name VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  unit VARCHAR(50) DEFAULT 'Adet',
  purchase_price DECIMAL(10, 2) DEFAULT 0,
  unit_price DECIMAL(10, 2) DEFAULT 0,
  current_stock NUMERIC DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
