CREATE TABLE counting_periods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_name VARCHAR(100) NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);
