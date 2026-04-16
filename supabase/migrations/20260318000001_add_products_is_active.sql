-- Add active/passive flag for products (stok kartları)
ALTER TABLE products
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;