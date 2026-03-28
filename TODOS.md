# TODOS

## P1 — Must do before implementation

### Spike Phase 2: End-to-End Dry-Run
- **What:** Run a full dry-run deployment using existing code (trigger.sh + agent CLAUDE.md) to validate that Claude Code correctly follows AGENT-PROTOCOL.md, writes valid state JSON, and triggers Telegram notifications.
- **Why:** The initial spike validated "Claude can run headlessly" but not "Claude correctly follows a complex multi-step protocol." Outside voice (CEO review 2026-03-28) identified this gap.
- **How:** `DEPLOY_DRY_RUN=true DEPLOY_SERVER=root@8.148.146.194 ./devops/scripts/trigger.sh zouhuo --context "spike phase 2 test"`
- **Success criteria:** All 4 phases produce valid state JSON, Telegram receives notification, exit code 0.
- **Effort:** S (CC: ~15min)
- **Added:** 2026-03-28, CEO Review

## P2 — Do after core is stable

### DRY: Extract json-utils.sh
- **What:** Create `devops/scripts/utils/json-utils.sh` with shared functions (`json_get`, `json_set`, `json_append`) to replace 40+ inline `python3 -c "..."` JSON parsing snippets across 11+ scripts.
- **Why:** Every script independently parses JSON with inline Python. Inconsistent error handling, hard to audit for injection, makes schema changes painful. Each new feature adds more inline parsing.
- **Context:** Scripts affected: trigger.sh, health-check.sh, cleanup.sh, perf-check.sh, pr-watcher.sh, status.sh, incident.sh, all qc/*.sh scripts. telegram.sh is a good model — it's already properly shared. registry.sh exists but is underutilized.
- **Effort:** M (CC: ~30min, touches 11+ files)
- **Added:** 2026-03-28, Eng Review

### DRY: Extract ssh-wrapper.sh
- **What:** Create `devops/scripts/utils/ssh-wrapper.sh` with SSH connection multiplexing. deploy.sh already implements this (ControlPath + ControlPersist), but 6+ other scripts use bare `ssh` calls without reuse.
- **Why:** health-check.sh, cleanup.sh (15+ SSH calls), rollback.sh, backup-db.sh all create separate SSH connections to the same server. Wastes time and risks rate-limiting (FP-06).
- **Context:** deploy.sh lines 82-97 have the reference implementation. Extract and source in all scripts that SSH to DEPLOY_SERVER.
- **Effort:** S (CC: ~20min)
- **Added:** 2026-03-28, Eng Review

### DRY: Extract retry-health-check utility
- **What:** Create a shared health check retry function. Currently deploy.sh (20 attempts, 3s), rollback.sh (10 attempts, 3s), and health-check.sh (single check + restart) each implement their own retry loop.
- **Why:** Inconsistent timeouts and retry behavior across scripts. deploy.sh waits 60s, rollback.sh waits 30s, for the same operation.
- **Effort:** S (CC: ~10min)
- **Added:** 2026-03-28, Eng Review
