#!/bin/sh
set -eu
mkdir -p /app/data
if [ ! -s /app/data/inspection-mappings.json ]; then
  cp /app/seed/inspection-mappings.json /app/data/inspection-mappings.json
fi
exec npm run start -- --hostname 0.0.0.0 --port 3000
