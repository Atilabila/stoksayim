-- Add person name to count records
ALTER TABLE counts
ADD COLUMN IF NOT EXISTS person_name VARCHAR(150);

