#!/usr/bin/env bash
set -euo pipefail
cd /opt/rr-portal
COMPOSE_FILE=docker-compose.cloud.yml
ENV_FILE=.env.cloud.production
MAINT_FLAG_DIR=/opt/rr-portal/deploy/maintenance
MAINT_COMPOSE_SERVICES=indo-shipping
source deploy/service-maintenance.sh
compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }
sql() { compose exec -T db sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}" "$@"' psql "$@"; }

[[ "${OPS_EXPECTED:-}" == '{"purchase_orders":40,"po_items":144,"po_receipts":98,"outbound":68,"shipment_links":10}' ]] || { echo 'Unexpected cleanup scope'; exit 1; }
[[ "${OPS_ACTOR:-}" =~ ^[A-Za-z0-9-]{1,39}$ ]] || { echo 'Invalid operator'; exit 1; }
[[ "${OPS_SQL_FILE:-}" == /tmp/indo-clear.*/* ]] && [[ -f "$OPS_SQL_FILE" ]] || { echo 'Missing reviewed SQL'; exit 1; }

stopped=0
restore_service() {
  local status=$?
  trap - EXIT
  if [[ "$stopped" == 1 ]]; then
    if compose start indo-shipping && wait_service_ready indo-shipping; then
      maintenance_off indo-shipping
      require_maintenance_cleared indo-shipping || status=1
    else
      echo 'Failed to recover indo-shipping; only its maintenance flag remains'
      status=1
    fi
  fi
  exit "$status"
}
trap restore_service EXIT
maintenance_on indo-shipping
stopped=1
compose stop -t 30 indo-shipping

umask 077
mkdir -p deploy/backups
backup="/opt/rr-portal/deploy/backups/indo-purchase-clear-$(date -u +%Y%m%dT%H%M%SZ).dump"
compose exec -T db sh -c 'exec pg_dump -Fc --schema=indo_shipping -U "${POSTGRES_USER:-rrportal}" -d "${POSTGRES_DB:-rrportal}"' > "$backup"
test -s "$backup"
compose exec -T db pg_restore --list < "$backup" > /dev/null
echo "Backup retained: $backup"
sha256sum "$backup"

sql -v expected="$OPS_EXPECTED" -v actor="$OPS_ACTOR" -v backup_path="$backup" < "$OPS_SQL_FILE"
sql <<'SQL'
BEGIN READ ONLY;
SELECT jsonb_build_object('purchase_orders',(SELECT COUNT(*) FROM indo_shipping.purchase_orders),
 'po_items',(SELECT COUNT(*) FROM indo_shipping.po_items),'po_receipts',(SELECT COUNT(*) FROM indo_shipping.po_receipts),
 'outbound',(SELECT COUNT(*) FROM indo_shipping.outbound),'shipment_links',(SELECT COUNT(*) FROM indo_shipping.shipment_items WHERE outbound_id IS NOT NULL),
 'shipments',(SELECT COUNT(*) FROM indo_shipping.shipments),'shipment_items',(SELECT COUNT(*) FROM indo_shipping.shipment_items)) AS cleanup_after;
COMMIT;
SQL
