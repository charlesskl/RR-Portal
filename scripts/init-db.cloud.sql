-- Cloud deployment: schemas for Batch A plugins
-- DB user is rrportal (not postgres)

CREATE SCHEMA IF NOT EXISTS plugin_business;
CREATE SCHEMA IF NOT EXISTS plugin_engineering;
CREATE SCHEMA IF NOT EXISTS plugin_indonesia;

-- Grant to the cloud DB user (matches DB_USER in .env.cloud)
DO $$
DECLARE
    db_user TEXT := current_user;
BEGIN
    EXECUTE format('GRANT ALL ON SCHEMA plugin_business TO %I', db_user);
    EXECUTE format('GRANT ALL ON SCHEMA plugin_engineering TO %I', db_user);
    EXECUTE format('GRANT ALL ON SCHEMA plugin_indonesia TO %I', db_user);
END
$$;
