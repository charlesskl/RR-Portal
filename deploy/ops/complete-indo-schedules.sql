BEGIN;
SET LOCAL lock_timeout='15s';
SET LOCAL statement_timeout='120s';
SET LOCAL search_path=indo_shipping,pg_catalog;
LOCK TABLE schedules,settings IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE completion_request AS SELECT :'fingerprint'::text fingerprint, :'actor'::text actor, :'backup_path'::text backup_path;
DO $$ BEGIN
 IF (SELECT COUNT(*) FROM schedules)<>7 OR
    (SELECT md5(string_agg(id::text||':'||md5(COALESCE(raw_rows::text,'')),',' ORDER BY id)) FROM schedules)<>
    (SELECT fingerprint FROM completion_request) THEN
   RAISE EXCEPTION 'Schedules changed since preview; no flags updated';
 END IF;
END $$;
CREATE TEMP TABLE completion_preserved(name text PRIMARY KEY, rows bigint,digest text);
DO $$ DECLARE t record;n bigint;h text;BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='indo_shipping' AND tablename NOT IN ('settings','audit_logs') LOOP
  EXECUTE format('SELECT COUNT(*),md5(COALESCE(string_agg(h, '''' ORDER BY h), '''')) FROM (SELECT md5(to_jsonb(r)::text) h FROM indo_shipping.%I r) s',t.tablename) INTO n,h;
  INSERT INTO completion_preserved VALUES(t.tablename,n,h);
 END LOOP;
END $$;
CREATE TEMP TABLE other_settings AS SELECT key,value FROM settings WHERE key NOT IN ('schedule_placed_manual','material_tracking_completed_schedules');
CREATE TEMP TABLE completion_keys AS
SELECT DISTINCT (r->>'orderNo')||'|'||(r->>'code') AS key FROM schedules s
CROSS JOIN LATERAL jsonb_array_elements(s.raw_rows) r
WHERE BTRIM(COALESCE(r->>'orderNo',''))<>'' AND BTRIM(COALESCE(r->>'code',''))<>'';
INSERT INTO settings(key,value)
SELECT 'schedule_placed_manual',jsonb_agg(key ORDER BY key)::text FROM (
 SELECT key FROM completion_keys UNION
 SELECT jsonb_array_elements_text(value::jsonb) FROM settings WHERE key='schedule_placed_manual'
) s
ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value;
INSERT INTO settings(key,value)
SELECT 'material_tracking_completed_schedules',
 (COALESCE((SELECT value::jsonb FROM settings WHERE key='material_tracking_completed_schedules'),'{}'::jsonb)
 || jsonb_object_agg(id::text,md5(raw_rows::text)))::text FROM schedules
ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value;
DO $$ DECLARE t record;n bigint;h text;BEGIN
 FOR t IN SELECT * FROM completion_preserved LOOP
  EXECUTE format('SELECT COUNT(*),md5(COALESCE(string_agg(h, '''' ORDER BY h), '''')) FROM (SELECT md5(to_jsonb(r)::text) h FROM indo_shipping.%I r) s',t.name) INTO n,h;
  IF n<>t.rows OR h<>t.digest THEN RAISE EXCEPTION 'Unrelated table changed: %',t.name; END IF;
 END LOOP;
 IF EXISTS((SELECT key,value FROM other_settings EXCEPT SELECT key,value FROM settings WHERE key NOT IN ('schedule_placed_manual','material_tracking_completed_schedules'))
 UNION ALL (SELECT key,value FROM settings WHERE key NOT IN ('schedule_placed_manual','material_tracking_completed_schedules') EXCEPT SELECT key,value FROM other_settings)) THEN
  RAISE EXCEPTION 'Unrelated settings changed';
 END IF;
 IF EXISTS(SELECT 1 FROM completion_keys k WHERE NOT COALESCE((SELECT value::jsonb FROM settings WHERE key='schedule_placed_manual') @> jsonb_build_array(k.key),false)) THEN
  RAISE EXCEPTION 'Purchase flag verification failed';
 END IF;
 IF (SELECT COUNT(*) FROM schedules s WHERE EXISTS(SELECT 1 FROM settings flag WHERE flag.key='material_tracking_completed_schedules' AND flag.value::jsonb->>s.id::text=md5(s.raw_rows::text)))<>7 THEN
  RAISE EXCEPTION 'Delivery snapshot verification failed';
 END IF;
END $$;
INSERT INTO audit_logs(username,module,action,entity_type,summary,details)
SELECT 'ops/'||actor,'schedules','complete_existing','schedule_completion',
 '按用户要求将现有排期采购标记为已下单、物料追踪确认送完；保留实际账面数量',
 jsonb_build_object('schedules',7,'order_product_keys',(SELECT COUNT(*) FROM completion_keys),'schedule_fingerprint',fingerprint,'backup_path',backup_path)
FROM completion_request;
SELECT COUNT(*) AS completed_order_product_keys FROM completion_keys;
COMMIT;
