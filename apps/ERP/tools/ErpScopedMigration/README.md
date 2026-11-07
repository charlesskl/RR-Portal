# P113 scoped cloud migration

This standalone .NET 8 tool applies only the reviewed migrations `173`, `174`,
and `175`, in that order. The embedded manifest pins each file's SHA-256.
It does not load application configuration, create a database, start the API,
back up/export/restore data, seed permissions, or bind accounts.

The release operator must first verify the existing cloud instance and mounts,
take and verify a native SQL Server backup, and arrange the ERP maintenance
window. Do not invoke the historical `erp-db-init` replay for this release.

Set `ERP_DB` explicitly in the execution environment. The connection must name
exactly `erp` for production or `erp_test` for isolated validation. Both modes
require the actual `SERVERPROPERTY('ServerName')` value obtained by preflight.
No connection string or account/credential values are printed.

```sh
dotnet ErpScopedMigration.dll inspect \
  --expected-database erp \
  --expected-server '<verified SQL Server identity>' \
  --migrations-dir /path/to/reviewed/db

dotnet ErpScopedMigration.dll apply \
  --expected-database erp \
  --expected-server '<verified SQL Server identity>' \
  --migrations-dir /path/to/reviewed/db
```

`inspect` validates the file hashes and database/server identities, then reports
schema hashes and exact table counts. It performs no business writes and is not
a transactional data snapshot.

`apply` uses one serializable transaction, `XACT_ABORT`, explicit index session
options, an application lock, and fixed-order exclusive locks on the affected
and protected raw-workflow/account tables. Enabled database/server DDL triggers
require separate review and cause the tool to stop.

The tool records each existing protected table's complete original-column JSON
fingerprint and row count, ordered by its primary key. JSON remains in process
memory; output contains hashes and counts only. Decimal columns are rendered
using their original precision/scale, with an independent exact-representability
check so a new low-order fractional digit cannot be hidden by that rendering.
Empty-table SQL NULL is accepted only when the independent count is zero.

Within the transaction it executes all three scripts twice, checks expected
columns, trusted/enabled CHECK and foreign-key constraints, index key order and
included columns, old schema/data preservation, and idempotence. Newly added
columns on existing tables must remain NULL, and newly created tables must
remain empty. Already-existing policy fields, snapshots and role bindings are
preserved rather than reset.

Only after those checks and a second on-disk hash check does it commit. A
validation or SQL failure before commit rolls back the transaction. If the
connection is lost during commit or its result cannot be captured, inspect the
actual database state before retrying. Errors are sanitized; SQL error messages
that may contain business values are not emitted. A failed process must not be
treated as a successful migration or followed by a data restore.

Build from the ERP directory using the repository's isolated check wrapper:

```sh
dotnet build tools/ErpScopedMigration/ErpScopedMigration.csproj
```

Changing any reviewed SQL requires updating the embedded manifest, rebuilding,
and repeating isolated migration verification before release. Build success
alone does not establish SQL execution or business-flow acceptance.
