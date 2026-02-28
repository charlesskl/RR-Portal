-- Create separate schemas for each plugin to isolate data
-- Core tables live in the public schema

CREATE SCHEMA IF NOT EXISTS plugin_business;
CREATE SCHEMA IF NOT EXISTS plugin_engineering;
CREATE SCHEMA IF NOT EXISTS plugin_indonesia;

GRANT ALL ON SCHEMA plugin_business TO postgres;
GRANT ALL ON SCHEMA plugin_engineering TO postgres;
GRANT ALL ON SCHEMA plugin_indonesia TO postgres;

-- ──────────────────────────────────────
-- To add a new plugin schema:
--   CREATE SCHEMA IF NOT EXISTS plugin_<name>;
--   GRANT ALL ON SCHEMA plugin_<name> TO postgres;
-- ──────────────────────────────────────
