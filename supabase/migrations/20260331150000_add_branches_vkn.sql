ALTER TABLE branches
ADD COLUMN IF NOT EXISTS vkn VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_branches_vkn ON branches(vkn);
