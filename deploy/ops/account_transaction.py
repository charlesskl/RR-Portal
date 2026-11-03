"""Bounded account-only transaction; supplied to existing Core python, never installed."""
import asyncio
from datetime import datetime
import hashlib
import json
import os
import sys

TARGET_ID = 1
TARGET_NAME = 'admin'
TARGET_ROLE = 'admin'
DEPARTMENT = '工程部'
GRANTS = ('epms:edit', 'epms:approve')
ALLOWLIST = ('department', 'permissions', 'updated_at')
PUBLIC_FIELDS = ('id', 'username', 'department', 'role', 'is_active', 'permissions', 'created_at', 'updated_at')
SCOPE = {'operation': 'engineering-admin-access-20261103', 'targetId': TARGET_ID,
         'username': TARGET_NAME, 'requiredRole': TARGET_ROLE, 'requiredActive': True,
         'department': DEPARTMENT, 'appendIfMissing': list(GRANTS),
         'allowlistedColumns': list(ALLOWLIST), 'workflow': 'inactive',
         'sourceCommit': '032b1d8'}

def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode()

def digest(value):
    return hashlib.sha256(encode(value)).hexdigest()

SCOPE_SHA256 = digest(SCOPE)

class Refusal(Exception):
    pass

def require(value, code):
    if not value:
        raise Refusal(code)

def identity(profile):
    require(type(profile) is dict and set(profile) == set(PUBLIC_FIELDS), 'unexpected_public_shape')
    require(type(profile['id']) is int and profile['id'] == TARGET_ID, 'wrong_id')
    require(profile['username'] == TARGET_NAME and profile['role'] == TARGET_ROLE
            and profile['is_active'] is True, 'unexpected_identity')
    require(profile['department'] is None or type(profile['department']) is str, 'malformed_department')
    grants = profile['permissions']
    require(type(grants) is list and all(type(x) is str for x in grants), 'malformed_permissions')
    return profile

def plan(profile):
    identity(profile)
    grants = list(profile['permissions'])
    added = [g for g in GRANTS if g not in grants]
    grants.extend(added)
    return {'department': DEPARTMENT, 'permissions': grants, 'appended': added,
            'changed': profile['department'] != DEPARTMENT or bool(added)}

def capabilities(profile):
    identity(profile)
    return {'canEdit': (profile['department'] or '').strip().lower() in ('工程部', 'engineering')
                        and 'epms:edit' in profile['permissions'],
            'canApprove': profile['role'] == 'admin' or 'epms:approve' in profile['permissions'],
            'workflowInactive': True}

def snapshot_valid(snapshot):
    require(type(snapshot) is dict and set(snapshot) == {'public', 'nonAllowlistedSHA256', 'schema'}, 'bad_snapshot')
    identity(snapshot['public'])
    require(type(snapshot['nonAllowlistedSHA256']) is str and len(snapshot['nonAllowlistedSHA256']) == 64
            and all(c in '0123456789abcdef' for c in snapshot['nonAllowlistedSHA256']), 'bad_fingerprint')
    require(type(snapshot['schema']) is dict and snapshot['schema'].get('triggers') == [], 'unexpected_users_triggers')
    require(snapshot['schema'].get('relation') == 'public.users'
            and snapshot['schema'].get('kind') == 'r', 'unexpected_relation')
    return snapshot

def check_after(before, after, proposal):
    snapshot_valid(after)
    require(before['nonAllowlistedSHA256'] == after['nonAllowlistedSHA256'], 'non_allowlisted_fields_changed')
    require(before['schema'] == after['schema'], 'schema_changed')
    a, b = after['public'], before['public']
    require(a['department'] == proposal['department'] and a['permissions'] == proposal['permissions'], 'readback_mismatch')
    require(all(a[k] == b[k] for k in PUBLIC_FIELDS if k not in ALLOWLIST), 'public_fields_changed')
    if not proposal['changed']:
        require(a == b, 'noop_changed_fields')

# This expression only RETURNS a DB-computed digest. No secret column value leaves PostgreSQL.
FINGERPRINT = "encode(sha256(convert_to((to_jsonb(u)-ARRAY['department','permissions','updated_at'])::text,'UTF8')),'hex')"
SELECT_PUBLIC = ','.join('u.' + key for key in PUBLIC_FIELDS)
SELECT_TARGET = ("SELECT " + SELECT_PUBLIC + "," + FINGERPRINT + " AS fingerprint FROM public.users u "
                 "WHERE u.id=:id AND u.username=:username")
UPDATE_ONE = ("UPDATE public.users AS u SET department=:new_department, permissions=CAST(:new_permissions AS json), "
              "updated_at=clock_timestamp() WHERE u.id=:id AND u.username=:username AND u.role=:role "
              "AND u.is_active IS TRUE AND " + FINGERPRINT + "=:fingerprint "
              "AND u.department IS NOT DISTINCT FROM :old_department "
              "AND to_jsonb(u.permissions)=CAST(:old_permissions AS jsonb) "
              "AND u.updated_at IS NOT DISTINCT FROM CAST(:old_updated_at AS timestamptz) RETURNING u.id")

class Postgres:
    def __init__(self, connection, text):
        self.c, self.text = connection, text

    async def snapshot(self, lock=False):
        count = (await self.c.execute(self.text("SELECT count(*) FROM public.users WHERE lower(btrim(username))=:username"), {'username': TARGET_NAME})).scalar_one()
        require(count == 1, 'target_not_unique')
        rows = (await self.c.execute(self.text(SELECT_TARGET + (' FOR UPDATE' if lock else '')),
                                     {'id': TARGET_ID, 'username': TARGET_NAME})).mappings().all()
        require(len(rows) == 1, 'target_not_unique')
        row = dict(rows[0])
        fingerprint = row.pop('fingerprint')
        for key in ('created_at', 'updated_at'):
            if row[key] is not None:
                row[key] = row[key].isoformat()
        identity(row)
        rel = (await self.c.execute(self.text("SELECT c.relkind::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='users'"))).scalar_one()
        triggers = (await self.c.execute(self.text("SELECT t.tgname FROM pg_trigger t WHERE t.tgrelid='public.users'::regclass AND NOT t.tgisinternal ORDER BY t.tgname"))).scalars().all()
        require(not triggers, 'unexpected_users_triggers')
        columns = [dict(r) for r in (await self.c.execute(self.text("SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='users' ORDER BY ordinal_position"))).mappings().all()]
        constraints = [dict(r) for r in (await self.c.execute(self.text("SELECT conname,contype::text AS contype,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.users'::regclass ORDER BY conname"))).mappings().all()]
        indexes = [dict(r) for r in (await self.c.execute(self.text("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='users' ORDER BY indexname"))).mappings().all()]
        rules = (await self.c.execute(self.text("SELECT rulename FROM pg_rules WHERE schemaname='public' AND tablename='users' ORDER BY rulename"))).scalars().all()
        require(not rules, 'unexpected_users_rules')
        rls = (await self.c.execute(self.text("SELECT relrowsecurity OR relforcerowsecurity FROM pg_class WHERE oid='public.users'::regclass"))).scalar_one()
        require(rls is False, 'unexpected_users_rls')
        value = {'public': row, 'nonAllowlistedSHA256': fingerprint,
                 'schema': {'relation': 'public.users', 'kind': rel, 'triggers': list(triggers),
                            'columns': columns, 'constraints': constraints, 'indexes': indexes,
                            'rules': list(rules), 'rowSecurity': rls}}
        return snapshot_valid(value)

    async def update(self, before, proposal):
        p = before['public']
        result = await self.c.execute(self.text(UPDATE_ONE), {
            'new_department': proposal['department'], 'new_permissions': json.dumps(proposal['permissions']),
            'id': TARGET_ID, 'username': TARGET_NAME, 'role': TARGET_ROLE,
            'fingerprint': before['nonAllowlistedSHA256'], 'old_department': p['department'],
            'old_permissions': json.dumps(p['permissions']),
            'old_updated_at': datetime.fromisoformat(p['updated_at']) if p['updated_at'] is not None else None})
        return list(result.scalars().all())

async def transaction(db, tx, payload, emit, receive):
    """One transaction; rollback only before COMMIT starts. Unknown commit is never retried."""
    stage, committing = 'snapshot', False
    try:
        before = snapshot_valid(await db.snapshot(lock=payload['mode'] == 'maintain'))
        if payload['mode'] != 'maintain':
            await tx.rollback()
            return {'event': 'result', 'success': True, 'snapshot': before, 'readOnly': True,
                    'mutationOutcome': 'not_attempted', 'updateCount': 0}
        require(digest(before) == payload['expectedSnapshotSHA256'], 'stale_diagnose_account')
        proposal = plan(before['public'])
        nonce = payload['nonce']
        backup = {'scopeSHA256': SCOPE_SHA256, 'diagnoseSHA256': payload['diagnoseSHA256'],
                  'nonce': nonce, 'before': before, 'proposal': proposal}
        backup_hash = digest(backup)
        stage = 'backup_ack'
        await emit({'event': 'backup', 'backup': backup, 'backupSHA256': backup_hash})
        ack = await receive()
        require(ack == {'event': 'backup_ack', 'backupSHA256': backup_hash,
                        'nonce': nonce, 'scopeSHA256': SCOPE_SHA256}, 'backup_ack_mismatch')
        stage = 'guarded_update'
        count = 0
        if proposal['changed']:
            ids = await db.update(before, proposal)
            require(ids == [TARGET_ID], 'guarded_update_count')
            count = 1
        stage = 'readback'
        after = snapshot_valid(await db.snapshot())
        check_after(before, after, proposal)
        prepared = {'beforeSHA256': digest(before), 'after': after, 'proposal': proposal,
                    'updateCount': count, 'backupSHA256': backup_hash, 'nonce': nonce}
        prepared_hash = digest(prepared)
        stage = 'commit_ack'
        await emit({'event': 'prepared', 'prepared': prepared, 'preparedSHA256': prepared_hash})
        ack = await receive()
        require(ack == {'event': 'commit_ack', 'preparedSHA256': prepared_hash,
                        'backupSHA256': backup_hash, 'nonce': nonce, 'scopeSHA256': SCOPE_SHA256},
                'commit_ack_mismatch')
        stage, committing = 'commit', True
        await tx.commit()
        return {'event': 'result', 'success': True, 'snapshot': after, 'readOnly': False,
                'mutationOutcome': 'committed' if count else 'committed_noop', 'updateCount': count,
                'backupSHA256': backup_hash, 'preparedSHA256': prepared_hash}
    except Exception as exc:
        if not committing:
            await tx.rollback()
        return {'event': 'result', 'success': False, 'errorType': type(exc).__name__,
                'errorCode': str(exc) if isinstance(exc, Refusal) else 'redacted_failure',
                'stage': stage, 'mutationOutcome': 'unknown' if committing else 'rolled_back'}

async def main():
    from sqlalchemy import text
    from app.database import engine
    engine.echo = False
    payload = json.loads(sys.stdin.readline())
    require(payload['mode'] in ('diagnose', 'maintain', 'verify', 'reconcile'), 'bad_mode')
    require(payload['scopeSHA256'] == SCOPE_SHA256, 'bad_scope')
    c = await engine.connect()
    tx = await c.begin()
    outcome = 'not_attempted'
    try:
        if payload['mode'] != 'maintain':
            await c.execute(text('SET TRANSACTION READ ONLY'))
            require((await c.execute(text('SHOW transaction_read_only'))).scalar_one() == 'on', 'not_read_only')
        await c.execute(text("SET LOCAL statement_timeout='8s'"))
        await c.execute(text("SET LOCAL lock_timeout='5s'"))
        await c.execute(text("SET LOCAL idle_in_transaction_session_timeout='90s'"))
        async def emit(value):
            print(json.dumps(value, ensure_ascii=True, separators=(',', ':')), flush=True)
        async def receive():
            line = sys.stdin.readline()
            require(bool(line) and len(line) <= 4096, 'missing_ack')
            return json.loads(line)
        result = await transaction(Postgres(c, text), tx, payload, emit, receive)
        outcome = result.get('mutationOutcome', 'not_attempted')
        await emit(result)
        if result.get('mutationOutcome') == 'unknown':
            # Do not issue rollback/retry after a possibly accepted COMMIT.
            os._exit(73)
        await c.close()
        await engine.dispose()
        return 0 if result['success'] else 1
    except Exception:
        if outcome in ('committed', 'committed_noop', 'unknown'):
            # A post-COMMIT transport/cleanup error is reconciled read-only, never rolled back or retried.
            try:
                print(json.dumps({'event': 'result', 'success': False, 'errorType': 'RuntimeBoundaryError',
                                  'mutationOutcome': 'unknown'}), flush=True)
            finally:
                os._exit(73)
        await tx.rollback()
        await c.close()
        await engine.dispose()
        print(json.dumps({'event': 'result', 'success': False, 'errorType': 'RuntimeBoundaryError',
                          'mutationOutcome': 'rolled_back'}), flush=True)
        return 1

if __name__ == '__main__':
    try:
        sys.exit(asyncio.run(main()))
    except Exception:
        print(json.dumps({'event': 'result', 'success': False, 'errorType': 'StartupError',
                          'mutationOutcome': 'not_attempted'}), flush=True)
        sys.exit(1)
