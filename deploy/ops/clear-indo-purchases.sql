BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '120s';
SET LOCAL search_path = indo_shipping, pg_catalog;
LOCK TABLE purchase_orders, po_items, po_receipts, outbound, shipment_items IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE cleanup_request AS SELECT :'expected'::jsonb AS expected, :'backup_path'::text AS backup_path, :'actor'::text AS actor;
CREATE TEMP TABLE cleanup_before AS SELECT jsonb_build_object(
  'purchase_orders', (SELECT COUNT(*) FROM purchase_orders),
  'po_items', (SELECT COUNT(*) FROM po_items),
  'po_receipts', (SELECT COUNT(*) FROM po_receipts),
  'outbound', (SELECT COUNT(*) FROM outbound),
  'shipment_links', (SELECT COUNT(*) FROM shipment_items WHERE outbound_id IS NOT NULL)
) AS counts;
DO $$
BEGIN
  IF (SELECT counts FROM cleanup_before) <> (SELECT expected FROM cleanup_request) THEN
    RAISE EXCEPTION 'Counts changed since preview; no records deleted';
  END IF;
END $$;

-- Compare every retained table. Only the explicitly authorized outbound link is excluded.
CREATE TEMP TABLE cleanup_preserved(name text PRIMARY KEY, rows bigint, digest text);
DO $$
DECLARE t record; expression text; n bigint; fingerprint text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='indo_shipping'
    AND tablename NOT IN ('purchase_orders','po_items','po_receipts','outbound','audit_logs')
  LOOP
    expression := CASE WHEN t.tablename='shipment_items' THEN '(to_jsonb(r)-''outbound_id'')' ELSE 'to_jsonb(r)' END;
    EXECUTE format('SELECT COUNT(*), md5(COALESCE(string_agg(h, '''' ORDER BY h), '''')) FROM (SELECT md5((%s)::text) h FROM indo_shipping.%I r) s',expression,t.tablename) INTO n,fingerprint;
    INSERT INTO cleanup_preserved VALUES(t.tablename,n,fingerprint);
  END LOOP;
END $$;

UPDATE shipment_items SET outbound_id=NULL WHERE outbound_id IS NOT NULL;
DELETE FROM outbound;
DELETE FROM po_receipts;
DELETE FROM po_items;
DELETE FROM purchase_orders;

DO $$
DECLARE t record; expression text; n bigint; fingerprint text;
BEGIN
  IF EXISTS (SELECT 1 FROM purchase_orders) OR EXISTS (SELECT 1 FROM po_items)
    OR EXISTS (SELECT 1 FROM po_receipts) OR EXISTS (SELECT 1 FROM outbound)
    OR EXISTS (SELECT 1 FROM shipment_items WHERE outbound_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Cleanup verification failed';
  END IF;
  FOR t IN SELECT * FROM cleanup_preserved LOOP
    expression := CASE WHEN t.name='shipment_items' THEN '(to_jsonb(r)-''outbound_id'')' ELSE 'to_jsonb(r)' END;
    EXECUTE format('SELECT COUNT(*), md5(COALESCE(string_agg(h, '''' ORDER BY h), '''')) FROM (SELECT md5((%s)::text) h FROM indo_shipping.%I r) s',expression,t.name) INTO n,fingerprint;
    IF n<>t.rows OR fingerprint<>t.digest THEN RAISE EXCEPTION 'Retained table changed: %',t.name; END IF;
  END LOOP;
END $$;
INSERT INTO audit_logs(username,module,action,entity_type,summary,details)
SELECT 'ops/'||r.actor,'purchase','clear_records','purchase_stock',
  '按用户要求清空采购订单及出入库记录；保留走货单和明细，仅解除出库关联',
  jsonb_build_object('before',b.counts,'backup_path',r.backup_path,'preserved_tables',(SELECT jsonb_object_agg(name,rows) FROM cleanup_preserved))
FROM cleanup_before b CROSS JOIN cleanup_request r;
SELECT counts AS deleted_counts FROM cleanup_before;
SELECT name,rows AS retained_rows FROM cleanup_preserved ORDER BY name;
COMMIT;
