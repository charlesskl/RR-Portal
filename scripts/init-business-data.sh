#!/bin/bash
# Create the business_data database for Business-data-statistics app
# This runs as part of PostgreSQL docker-entrypoint-initdb.d

set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE business_data OWNER $POSTGRES_USER;
EOSQL

# Initialize the business_data schema
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "business_data" -f /docker-entrypoint-initdb.d/seed/business-data-init.sql
