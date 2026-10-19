-- DRAFT ONLY. No production execution is authorized by this file.
-- main = the sealed complete-v3/baseline.sqlite3, mode=ro&immutable=1.
-- current = a closed, transaction-consistent current.sqlite3 with its typed
-- manifest, mode=ro&immutable=1. Do not attach/open either as writable.
-- The reviewed wrapper must verify both seals/receipts before AND after reads,
-- PRAGMA query_only=ON, BEGIN, and a <=15s SQLite progress deadline.
-- Before this SELECT, privately assert exactly 6 baseline rows, owner counts
-- {2:2,3:2,5:2,6:0}. Save IDs/UIDs/hash correspondence only in a NEW O_EXCL 0700
-- evidence directory, files 0600, never stdout. Do not create sessions/call API.
-- Bind p*: exact canonical namespace prefix, privately derived from the sealed
-- binding and compared to both DB states. Never print these address-containing
-- values. Bind e*: original candidates.private.json eligible arrays, validated
-- sorted/unique uint32 and UIDVALIDITY equal to the sealed state. Bind n*: an
-- existing sealed current eligible array with matching UIDVALIDITY, or NULL if
-- there is no such receipt. Do not silently substitute [] for missing evidence.
-- Bind same: JSON map {"privateRowId":true/false}, calculated by comparing the
-- COMPLETE original typed row hash with the current typed row hash. Do not
-- compare just the fields in this query or exclude fields to make it pass.
-- Bind batch_same: the analogous per-item boolean for its complete original
-- ImportBatch typed row. A batch counter/status change is not silently ignored.
-- Output contains no ID, UID, key/address, timestamp, subject, raw error,
-- ResultJson, body, username, credentials or configuration.

WITH approved(owner,prefix,original_eligible,current_eligible) AS (
 VALUES (2,:p2,:e2,:n2),(3,:p3,:e3,:n3),(5,:p5,:e5,:n5),(6,:p6,:e6,:n6)
), kinds(kind) AS (
 VALUES ('metadata'),('message_size'),('body_read'),('parse_memory'),
        ('parse_timeout'),('parse_result_size'),('parse_process'),('parse_cancelled')
), selected AS (
 SELECT b.Id, b.MailOwnerId AS owner, p.prefix,
        p.original_eligible, p.current_eligible,
        CAST(substr(b.MailboxKey,length(p.prefix)+1) AS INTEGER) AS private_uid,
        b.MailboxKey = p.prefix || CAST(CAST(substr(b.MailboxKey,length(p.prefix)+1) AS INTEGER) AS TEXT)
          AND CAST(substr(b.MailboxKey,length(p.prefix)+1) AS INTEGER) BETWEEN 1 AND 4294967295 AS original_uid_ok,
        b.MailboxKey = p.prefix || CAST(CAST(substr(b.MailboxKey,length(p.prefix)+1) AS INTEGER) AS TEXT)
          AND CAST(substr(b.MailboxKey,length(p.prefix)+1) AS INTEGER) BETWEEN 1 AND 4294967295
          AND b.MailboxKey = c.MailboxKey
          AND c.Company='Huadeng' AND c.MailOwnerId=b.MailOwnerId
          AND bs.Address=cs.Address AND bs.MailboxIdentity=cs.MailboxIdentity
          AND bs.UidValidity=cs.UidValidity AND bs.UidValidity BETWEEN 1 AND 4294967295
          AND p.prefix='Huadeng:' || b.MailOwnerId || ':' || bs.MailboxIdentity || ':' || bs.Address || ':' || bs.UidValidity || ':'
          AND CAST(substr(b.MailboxKey,length(p.prefix)+1) AS INTEGER)<=cs.LastUid
          AND bu.Username=cu.Username AND bu.MailboxAddress=cu.MailboxAddress
          AND cu.MailboxAddress=cs.Address AND cu.IsActive=1
          AND (cu.CompanyAccess IN ('Huadeng','Both') OR cu.Role='admin') AS identity_ok,
        COALESCE(json_extract(:same,'$."' || b.Id || '"')=1,0) AS typed_unchanged,
        COALESCE(json_extract(:batch_same,'$."' || b.Id || '"')=1,0) AS batch_typed_unchanged,
        CASE WHEN c.Status IN ('failed','pending','confirmed','duplicate','duplicate_confirmed')
             THEN c.Status WHEN c.Id IS NULL THEN 'missing' ELSE 'other' END AS current_status,
        length(b.MailReceivedDate)=10 AND date(b.MailReceivedDate,'+0 days')=b.MailReceivedDate
          AND b.MailReceivedDate>='2026-10-08' AS original_in_requested_range,
        bs0.StartDate='2026-10-08' AND cs0.StartDate=bs0.StartDate AS original_start_unchanged,
        date(b.MailReceivedAt,'+8 hours')=b.MailReceivedDate
          AND b.MailReceivedAt=c.MailReceivedAt AND b.MailReceivedDate=c.MailReceivedDate AS received_date_consistent,
        COALESCE(CASE WHEN length(CAST(b.ResultJson AS BLOB))<=2097152 AND json_valid(b.ResultJson)
          THEN (SELECT kind FROM kinds WHERE kind=json_extract(b.ResultJson,'$.failure_kind')) END,
          CASE WHEN b.Error='邮件中的业务附件均无法解析' THEN 'all_business_attachments_unparseable' ELSE 'other' END) AS failure_kind,
        c.Status='failed' AND c.HandlingStatus='Pending' AND c.HandlingOutcome=''
          AND c.WorkNote='' AND c.ReviewedAt IS NULL AND lower(c.ClassificationSource)<>'manual'
          AND cb.Kind='Email' AND cb.Status='PendingConfirmation'
          AND cb.Company=c.Company AND cb.MailOwnerId=c.MailOwnerId
          AND cb.FailedCount>0 AND cb.ParsedCount>=0 AND cb.TotalCount>=cb.ParsedCount+cb.FailedCount
          AND CASE WHEN length(CAST(c.TaskIdsJson AS BLOB))<=4096 AND json_valid(c.TaskIdsJson)
                   THEN json_type(c.TaskIdsJson)='array' AND json_array_length(c.TaskIdsJson)=0 ELSE 0 END
          AND NOT EXISTS (SELECT 1 FROM current.ShipmentTasks t WHERE t.SourceImportItemId=b.Id)
          AS api_handling_eligible
 FROM main.ImportEmailItems b
 JOIN approved p ON p.owner=b.MailOwnerId
 LEFT JOIN current.ImportEmailItems c ON c.Id=b.Id
 LEFT JOIN current.ImportBatches cb ON cb.Id=c.ImportBatchId
 JOIN main.MailSyncStates bs ON bs.Id=1000+b.MailOwnerId
 LEFT JOIN current.MailSyncStates cs ON cs.Id=bs.Id
 JOIN main.MailSystemSettings bs0 ON bs0.Id=bs.Id
 LEFT JOIN current.MailSystemSettings cs0 ON cs0.Id=bs.Id
 JOIN main.Users bu ON bu.Id=b.MailOwnerId
 LEFT JOIN current.Users cu ON cu.Id=bu.Id
 WHERE b.Company='Huadeng' AND b.Status='failed' AND b.MailboxKey<>''
), observations AS (
 SELECT *,
   CASE WHEN original_uid_ok THEN EXISTS (SELECT 1 FROM json_each(original_eligible) j
          WHERE j.type='integer' AND j.value=private_uid) ELSE NULL END AS original_candidate,
   CASE WHEN identity_ok AND current_eligible IS NOT NULL THEN EXISTS
        (SELECT 1 FROM json_each(current_eligible) j WHERE j.type='integer' AND j.value=private_uid)
        ELSE NULL END AS current_candidate,
   -- SourceEmailsJson is a secondary task provenance list. Its malformed or
   -- unrecognized contents must remain UNKNOWN, not be called "no task".
   CASE WHEN EXISTS (SELECT 1 FROM current.ShipmentTasks t
          WHERE length(CAST(t.SourceEmailsJson AS BLOB))>2097152
            OR CASE WHEN json_valid(t.SourceEmailsJson) THEN json_type(t.SourceEmailsJson)<>'array' ELSE 1 END
            OR EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(t.SourceEmailsJson) THEN t.SourceEmailsJson ELSE '[]' END) j
                 WHERE j.type<>'object' OR CASE WHEN j.type='object'
                       THEN json_type(j.value,'$.id') IS NOT 'integer' OR json_extract(j.value,'$.id')<=0 ELSE 0 END))
        THEN NULL ELSE NOT EXISTS (
          SELECT 1 FROM current.ShipmentTasks t, json_each(t.SourceEmailsJson) j
          WHERE CASE WHEN j.type='object' THEN json_extract(j.value,'$.id') END=selected.Id
        ) END AS no_secondary_task_reference
 FROM selected
)
SELECT owner, 'failed' AS original_status, current_status,
       COALESCE(original_in_requested_range,0) AS received_on_or_after_oct08,
       COALESCE(original_start_unchanged,0) AS original_start_unchanged,
       COALESCE(received_date_consistent,0) AS stored_received_date_consistent,
       failure_kind AS failureKind, COALESCE(identity_ok,0) AS identityMatching,
       typed_unchanged AS originalTypedRowUnchanged,
       batch_typed_unchanged AS originalBatchTypedRowUnchanged,
       COALESCE(api_handling_eligible,0) AS apiHandlingEligible,
       no_secondary_task_reference AS noSecondaryTaskReference,
       original_candidate AS uidInOriginalEligibleCandidates,
       current_candidate AS uidInCurrentEligibleCandidates
FROM observations ORDER BY owner,Id;

-- ROLLBACK after reading; no UPDATE/INSERT/DELETE and no parser/IMAP/API calls.
-- Any NULL/false gate is unresolved/ineligible, never auto-converted to true.
-- This audit DOES NOT authorize changing original baseline rows. If specific
-- originals prove eligible, a separately reviewed in-place retry plan must pin
-- their exact private IDs+UID namespace+before hashes, recheck handling/tasks in
-- the API write transaction, preserve baseline/seals, record after hashes and
-- allowed columns/batch/contact deltas. All other original rows must remain
-- byte/typed-identical. Keep the old full-preservation receipt unchanged; final
-- reporting must disclose authorized baseline-row updates explicitly.
