# Factory Review Private Data Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the approved factory-review business snapshot to production without committing plaintext business data to Git.

**Architecture:** A manual GitHub Actions workflow transports a gzip/base64 payload through temporary repository secrets. A focused server script reconstructs and verifies the payload, stops PocketBase, takes a consistent backup, runs the private migration in a one-off container, verifies SQLite row counts, and rolls back automatically on failure.

**Tech Stack:** GitHub Actions, Bash, Docker Compose, PocketBase 0.39.6, SQLite, PowerShell contract tests.

## Global Constraints

- Plaintext business data, contact details, and the restore migration must never be committed to Git.
- The existing `FACTORY_REVIEW_ADMIN_PASSWORD` remains the only active administrator credential.
- The restore must back up `pb_data` before migration and restore that backup after any migration or verification failure.
- Temporary payload secrets must be deleted after a successful restore.
- Logs may include hashes and row counts but must not include payload fragments or business records.
- The restore and normal deploy workflows must share concurrency group `deploy-cloud` with `cancel-in-progress: false`.
- The restore workflow must not advance server Git; `origin/main`, `HEAD`, and `EXPECTED_COMMIT` must already be identical.
- The running factory-review image OCI revision must exactly equal the 40-hex `EXPECTED_COMMIT` before production data is touched or the service is stopped.

---

### Task 1: Restore Script Contract Tests

**Files:**
- Create: `scripts/tests/test-factory-review-data-restore.ps1`
- Create: `scripts/tests/test-factory-review-data-restore.sh`

**Interfaces:**
- Consumes: `deploy/restore-factory-review-data.sh` as a sourceable Bash module when `RESTORE_FACTORY_REVIEW_SOURCE_ONLY=1`.
- Produces: Contract coverage for `require_payload_parts`, `reconstruct_payload`, `verify_snapshot_counts`, and rollback ordering.

- [ ] **Step 1: Write the failing PowerShell static contract test**

Assert that the restore script uses `set -euo pipefail`, checks SHA-256 before stopping the service, creates a tar backup before invoking `pocketbase migrate up`, registers an error trap, verifies the six required table counts, and never enables shell tracing.

- [ ] **Step 2: Write the failing Bash behavior test**

Source the restore script in a temporary directory with mocked `docker`, `tar`, and `curl` commands. Verify missing payload parts fail, a wrong SHA fails before Docker is called, and verification failure invokes backup restoration.

- [ ] **Step 3: Run tests and verify failure**

Run:

```powershell
pwsh -NoProfile -File scripts/tests/test-factory-review-data-restore.ps1
```

Expected: failure because `deploy/restore-factory-review-data.sh` does not exist.

- [ ] **Step 4: Commit tests**

```bash
git add scripts/tests/test-factory-review-data-restore.ps1 scripts/tests/test-factory-review-data-restore.sh
git commit -m "test: define factory data restore contract"
```

### Task 2: Transactional Server Restore Script

**Files:**
- Create: `deploy/restore-factory-review-data.sh`
- Test: `scripts/tests/test-factory-review-data-restore.ps1`
- Test: `scripts/tests/test-factory-review-data-restore.sh`

**Interfaces:**
- Consumes environment variables `FACTORY_REVIEW_DATA_PART_1_B64`, `FACTORY_REVIEW_DATA_PART_2_B64`, `FACTORY_REVIEW_DATA_PART_3_B64`, `FACTORY_REVIEW_DATA_SHA256`, `EXPECTED_COMMIT`, and optional `INSTALL_DIR`.
- Produces a restored `apps/PMC跟仓管/加工厂月度评审管理制度/pb_data` and a timestamped backup under `backups/factory-review-data-restore/`.

- [ ] **Step 1: Implement payload reconstruction**

Concatenate non-empty payload parts without printing them, Base64-decode to `restore-data-migration.js.gz`, compare lowercase SHA-256 using `sha256sum -c`, decompress to a mode-600 temporary migration file, and reject a script that lacks both `const SNAPSHOT =` and `migrate((app) =>`.

- [ ] **Step 2: Bind migration to the deployed image revision**

Require `EXPECTED_COMMIT` to match `^[0-9a-f]{40}$`. Resolve the current Compose container, inspect its image ID, and inspect the image label `org.opencontainers.image.revision`. Refuse a missing or mismatched label before stopping `factory-review` or touching `pb_data`.

- [ ] **Step 3: Implement consistent backup and migration**

Stop only `factory-review`, archive the complete `pb_data` directory, and run the current Compose image with production `pb_data` plus the temporary migration mounted read-only:

```bash
docker run --rm \
  -v "$PB_DATA_DIR:/pb/pb_data" \
  -v "$MIGRATION_FILE:/pb/private-migrations/1790000000_restore_factory_data.js:ro" \
  "$FACTORY_REVIEW_IMAGE" \
  /pb/pocketbase migrate up --dir=/pb/pb_data --migrationsDir=/pb/private-migrations
```

- [ ] **Step 4: Implement verification and rollback**

Use Python's standard `sqlite3` module to require minimum counts: `users >= 19`, `factories >= 186`, `orders >= 92`, `quality_inspections >= 479`, `score_templates >= 10`, and `monthly_scores >= 1`. On error, stop the service, move the failed `pb_data` aside, extract the backup, restart `factory-review`, and require the health endpoint to return success.
If rollback extraction succeeds but health never becomes healthy, explicitly stop `factory-review` before failing. On the main success path, strictly delete `TEMP_DIR` before setting `committed=1`; cleanup failure must restore the same backup and end with the restored service healthy.

- [ ] **Step 5: Run contract tests**

Run:

```powershell
pwsh -NoProfile -File scripts/tests/test-factory-review-data-restore.ps1
```

Expected: both PowerShell and Bash contracts pass with no payload content in output.

- [ ] **Step 6: Commit implementation**

```bash
git add deploy/restore-factory-review-data.sh scripts/tests/test-factory-review-data-restore.ps1 scripts/tests/test-factory-review-data-restore.sh
git commit -m "feat: add transactional factory data restore"
```

### Task 3: Manual Private Restore Workflow

**Files:**
- Create: `.github/workflows/restore-factory-review-data.yml`
- Modify: `scripts/tests/test-factory-review-data-restore.ps1`

**Interfaces:**
- Consumes repository secrets `FACTORY_REVIEW_DATA_PART_1_B64`, `FACTORY_REVIEW_DATA_PART_2_B64`, `FACTORY_REVIEW_DATA_PART_3_B64`, and `FACTORY_REVIEW_DATA_SHA256` plus existing cloud SSH secrets.
- Produces one manually dispatched production restore run.

- [ ] **Step 1: Extend the failing static test for workflow safety**

Require `workflow_dispatch`, concurrency group `deploy-cloud` with `cancel-in-progress: false`, pinned `appleboy/ssh-action@0ff4204d59e8e51228ff73bce53f80d53301dee2`, a 20-minute timeout, explicit payload secret environment mapping, `set -euo pipefail`, and invocation of `bash deploy/restore-factory-review-data.sh`. Reject `pull_request` and automatic `push` triggers.

- [ ] **Step 2: Add fail-closed SSH and read-only Git gates**

Before SSH, run an independent preflight whose only Secret input is `CLOUD_HOST_FINGERPRINT`; reject empty values and values outside `^SHA256:[A-Za-z0-9+/]{43}=?$`. Keep all four payload Secrets scoped only to the SSH step. On the server, fetch `origin main` without merging, switching, pulling, resetting, or rebasing; require `origin/main`, `HEAD`, and `EXPECTED_COMMIT` to be identical, then require `deploy/restore-factory-review-data.sh` to be tracked and clean before invoking it. Do not echo or persist payload variables.

- [ ] **Step 3: Run all restore contracts**

Run:

```powershell
pwsh -NoProfile -File scripts/tests/test-factory-review-data-restore.ps1
```

Expected: pass.

- [ ] **Step 4: Run repository diff checks**

Run:

Run `git diff --check origin/main...HEAD` and inspect every blob from `git rev-list --objects origin/main..HEAD`. Reject private restore asset names, blobs larger than 50,000 bytes, and blobs matching the cross-line Perl expression `const\s+SNAPSHOT\s*=\s*\{(?!\s*\})`, which denotes a non-empty snapshot object. Expected: no whitespace errors, private assets, large branch-only payload blobs, or non-empty private snapshot objects. The harmless structural marker `const SNAPSHOT =` and the synthetic empty fixture are expected and must not be treated as leaks.

- [ ] **Step 5: Add the PR contract workflow**

Create `.github/workflows/factory-review-restore-contract.yml` with pinned checkout, `permissions: contents: read`, no Secret references, PR path filters covering both workflows, restore script/tests, factory-review Dockerfile, cloud Compose, and design/plan documents. Run both contracts plus the diff and branch-object scans. Keep the real restore workflow manual-only.

- [ ] **Step 6: Commit workflow**

```bash
git add .github/workflows/restore-factory-review-data.yml scripts/tests/test-factory-review-data-restore.ps1
git commit -m "ci: add private factory data restore workflow"
```

### Task 4: Ship and Perform the Restore

**Files:**
- No repository file changes after Task 3.

**Interfaces:**
- Consumes the user-provided ZIP and the merged manual workflow.
- Produces verified production data and then removes all temporary payload secrets.

- [ ] **Step 1: Validate and package the migration locally**

Extract only `factory-review-data-package/restore-data-migration.js` in a temporary directory, verify it contains no password/token/API-key markers, gzip it, compute SHA-256, and Base64-encode without line breaks. Always divide the encoded value into exactly three non-empty contiguous parts: start every part at `floor(length / 3)` characters and distribute the remainder one character at a time to the first parts. Require the part lengths to differ by at most one character and every part to be at most 40,000 ASCII characters.

- [ ] **Step 2: Review, push, and merge the PR**

Run the factory-review unit tests/build, restore contract tests, YAML parse, `bash -n`, `git diff --check`, and branch-only plaintext/large-blob scans. Push the branch, open a PR, review checks, and merge with admin squash after all checks pass. Wait for the normal `Deploy to Cloud` workflow for the merged commit to complete successfully before creating payload Secrets or dispatching restore.

- [ ] **Step 3: Create temporary GitHub Secrets**

Independently obtain the production SSH host's OpenSSH SHA256 fingerprint, verify it out of band, and write/verify `CLOUD_HOST_FINGERPRINT`. Write all three non-empty payload parts and the SHA-256 to their exact repository Secrets. Confirm only Secret names, never values.

- [ ] **Step 4: Dispatch and monitor the restore workflow**

After the normal deploy has succeeded for the exact merged commit, dispatch `.github/workflows/restore-factory-review-data.yml` on `main`, monitor to completion, and stop on any Git/revision gate, backup, migration, verification, rollback, cleanup, or health failure.

- [ ] **Step 5: Verify production and remove temporary Secrets**

Check `/factory-review/health`, the login page, and the workflow's verified row counts. Delete all four temporary payload secrets immediately after success and verify their names no longer appear in `gh secret list`.
