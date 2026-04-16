-- Add market_intelligence column to roles table
-- Stores three Tavily search results: company intel, talent pool, industry metrics
ALTER TABLE roles ADD COLUMN IF NOT EXISTS market_intelligence jsonb;

-- Optional index for non-null market intelligence rows
CREATE INDEX IF NOT EXISTS roles_market_intelligence_exists
  ON roles ((market_intelligence IS NOT NULL));
