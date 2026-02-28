#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────
# Create a new plugin scaffold
#
# Usage:
#   ./scripts/create-plugin.sh sales "Sales & CRM" Sales
#   ./scripts/create-plugin.sh inventory "Inventory Management" Warehouse
#
# Args:
#   $1 = plugin name (lowercase, no spaces)
#   $2 = display name
#   $3 = department
# ──────────────────────────────────────

cd "$(dirname "$0")/.."

if [ $# -lt 3 ]; then
    echo "Usage: $0 <plugin-name> <display-name> <department>"
    echo "Example: $0 sales \"Sales & CRM\" Sales"
    exit 1
fi

PLUGIN_NAME="$1"
DISPLAY_NAME="$2"
DEPARTMENT="$3"
PLUGIN_DIR="plugins/$PLUGIN_NAME"

if [ -d "$PLUGIN_DIR" ]; then
    echo "Error: Plugin '$PLUGIN_NAME' already exists at $PLUGIN_DIR"
    exit 1
fi

echo "Creating plugin: $PLUGIN_NAME ($DISPLAY_NAME)"

# Create directories
mkdir -p "$PLUGIN_DIR/app"

# plugin.yaml
cat > "$PLUGIN_DIR/plugin.yaml" << EOF
name: $PLUGIN_NAME
display_name: "$DISPLAY_NAME"
version: "1.0.0"
department: $DEPARTMENT
description: "$DISPLAY_NAME plugin"
api_prefix: /api/$PLUGIN_NAME
health_check: /api/$PLUGIN_NAME/health
permissions:
  - ${PLUGIN_NAME}:read
  - ${PLUGIN_NAME}:write
EOF

# Dockerfile
cat > "$PLUGIN_DIR/Dockerfile" << 'EOF'
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

COPY plugin_sdk /tmp/plugin_sdk
RUN pip install --no-cache-dir /tmp/plugin_sdk && rm -rf /tmp/plugin_sdk

COPY plugins/PLUGIN_NAME/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY plugins/PLUGIN_NAME/ .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
EOF
sed -i '' "s/PLUGIN_NAME/$PLUGIN_NAME/g" "$PLUGIN_DIR/Dockerfile" 2>/dev/null || \
sed -i "s/PLUGIN_NAME/$PLUGIN_NAME/g" "$PLUGIN_DIR/Dockerfile"

# requirements.txt
cat > "$PLUGIN_DIR/requirements.txt" << EOF
# Plugin SDK is pre-installed in the Docker image
# Add $DISPLAY_NAME-specific dependencies below
EOF

# app/__init__.py
touch "$PLUGIN_DIR/app/__init__.py"

# app/models.py
cat > "$PLUGIN_DIR/app/models.py" << EOF
from sqlalchemy import Column, Integer, String, DateTime, Text
from sqlalchemy.sql import func
from plugin_sdk.database import PluginDatabase

db = PluginDatabase("plugin_$PLUGIN_NAME")
Base = db.create_base()


# Define your models here. Example:
#
# class Item(Base):
#     __tablename__ = "items"
#
#     id = Column(Integer, primary_key=True, index=True)
#     name = Column(String(200), nullable=False)
#     description = Column(Text)
#     created_at = Column(DateTime(timezone=True), server_default=func.now())
EOF

# app/router.py
cat > "$PLUGIN_DIR/app/router.py" << EOF
from fastapi import APIRouter, Depends
from plugin_sdk.auth import get_current_user_from_token, TokenPayload
from plugin_sdk.models import StandardResponse

router = APIRouter(prefix="/api/$PLUGIN_NAME", tags=["$DISPLAY_NAME"])


@router.get("/hello", response_model=StandardResponse[dict])
async def hello(user: TokenPayload = Depends(get_current_user_from_token)):
    return StandardResponse(
        data={"message": "Hello from $DISPLAY_NAME plugin!", "user": user.sub}
    )
EOF

# app/main.py
cat > "$PLUGIN_DIR/app/main.py" << EOF
import logging
from plugin_sdk import BasePlugin, PluginEventBus
from app.models import db, Base
from app.router import router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)

event_bus = PluginEventBus()


class ${DISPLAY_NAME// /}Plugin(BasePlugin):
    async def on_startup(self):
        await db.init_tables(Base)
        await event_bus.connect()
        await event_bus.start_listening()

    async def on_shutdown(self):
        await event_bus.disconnect()
        await db.close()


plugin = ${DISPLAY_NAME// /}Plugin("plugin.yaml")
app = plugin.app
app.include_router(router)
EOF

echo ""
echo "Plugin '$PLUGIN_NAME' created at $PLUGIN_DIR/"
echo ""
echo "Next steps:"
echo "  1. Add DB schema in scripts/init-db.sql:"
echo "     CREATE SCHEMA IF NOT EXISTS plugin_$PLUGIN_NAME;"
echo "     GRANT ALL ON SCHEMA plugin_$PLUGIN_NAME TO postgres;"
echo ""
echo "  2. Add service to docker-compose.yml:"
echo "     plugin-$PLUGIN_NAME:"
echo "       build:"
echo "         context: ."
echo "         dockerfile: plugins/$PLUGIN_NAME/Dockerfile"
echo "       env_file: .env"
echo "       environment:"
echo "         - SERVICE_NAME=plugin-$PLUGIN_NAME"
echo "         - DATABASE_URL=postgresql+asyncpg://\${DB_USER:-postgres}:\${DB_PASSWORD:-postgres}@db:5432/\${DB_NAME:-enterprise}"
echo "         - REDIS_URL=redis://redis:6379/0"
echo "         - CORE_SERVICE_URL=http://core:8000"
echo "         - SERVICE_URL=http://plugin-$PLUGIN_NAME:8000"
echo "       depends_on:"
echo "         core: { condition: service_healthy }"
echo "         db: { condition: service_healthy }"
echo "       restart: unless-stopped"
echo "       networks:"
echo "         - platform-net"
echo ""
echo "  3. Add nginx location in nginx/nginx.conf:"
echo "     upstream plugin_$PLUGIN_NAME {"
echo "       server plugin-$PLUGIN_NAME:8000;"
echo "     }"
echo "     location /api/$PLUGIN_NAME {"
echo "       proxy_pass http://plugin_$PLUGIN_NAME;"
echo "       proxy_set_header Host \$host;"
echo "       proxy_set_header X-Real-IP \$remote_addr;"
echo "       proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;"
echo "       proxy_set_header X-Forwarded-Proto \$scheme;"
echo "     }"
echo ""
echo "  4. Deploy: docker compose build plugin-$PLUGIN_NAME && docker compose up -d plugin-$PLUGIN_NAME"
