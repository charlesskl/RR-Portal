# DevOps Agent — Autonomous Improvement Program

This is an experiment to have the DevOps agent improve itself autonomously, inspired by [autoresearch](https://github.com/karpathy/autoresearch).

## Setup

To set up a new improvement run, work with the user to:

1. **Agree on a run tag**: propose a tag based on today's date (e.g. `mar21`). The branch `devops-research/<tag>` must not already exist.
2. **Create the branch**: `git checkout -b devops-research/<tag>` from current main.
3. **Read the in-scope files**: The pipeline is contained in these files:
   - `devops/scripts/qc/*.sh` — QC checks (the files you modify)
   - `devops/scripts/deploy.sh` — Deployment pipeline
   - `devops/scripts/verify-deploy.sh` — Post-deploy verification (the evaluation harness — do not modify)
   - `devops/scripts/qc-runner.sh` — QC orchestrator
   - `devops/tests/fixtures/` — Test apps for validation
   - This file (`devops/program.md`) — Your instructions and knowledge base
4. **Establish baseline**: Run the full QC pipeline against all test fixtures. Record initial deployment_score.
5. **Initialize results.tsv**: Create `devops/logs/research-results.tsv` with the header row.

Once you get confirmation, kick off the experimentation loop.

## The Metric: deployment_score

Each test app deployment is scored on 4 dimensions (0 or 1 each):

| Dimension | How to measure | Score |
|-----------|---------------|-------|
| Health check | `curl http://localhost:{port}/health` returns 200 | 0 or 1 |
| API endpoints | All discovered `/api/` routes return non-404 through nginx sub-path | 0 to 1 (ratio) |
| Frontend loads | `curl http://{server}/{app-name}/` returns HTML with correct asset paths | 0 or 1 |
| No asset 404s | All `<script>` and `<link>` URLs in the HTML return 200 | 0 or 1 |

**Total: 0.0 to 4.0 (higher is better)**

The evaluation is done by `verify-deploy.sh` — this is the ground truth and MUST NOT be modified (same as autoresearch's `prepare.py`).

## What You CAN Modify

- `devops/scripts/qc/*.sh` — Add new checks, improve existing ones
- `devops/scripts/qc-runner.sh` — Add checks to the pipeline, adjust dependencies
- `devops/scripts/deploy.sh` — Improve deployment steps
- `devops/program.md` — Add new rules, failure patterns, and knowledge
- `devops/tests/fixtures/` — Add new test apps for edge cases you discover
- `devops/scripts/onboard.sh` — Improve onboarding pipeline

## What You CANNOT Modify

- `devops/scripts/verify-deploy.sh` — The evaluation harness (read-only)
- `devops/config/` — Registry files (they track real state)

## The Experiment Loop

LOOP FOREVER:

1. **Identify a weakness**: Review past verification.tsv failures. What class of error caused the deployment to fail? Common categories:
   - Sub-path routing (API paths not prefixed)
   - Missing health endpoint
   - Hardcoded configuration
   - Auth middleware not stripped
   - Wrong Vite/webpack base path
   - Volume permission issues
   - Missing directories in Dockerfile
   - Port conflicts
   - Frontend framework-specific issues

2. **Propose a fix**: Either:
   - Add or improve a QC check script
   - Add a rule to the Known Failure Patterns section below
   - Add a new test fixture to validate the fix
   - Improve the deployment pipeline

3. **Git commit** the change

4. **Run the experiment**: Deploy the relevant test fixture through the full pipeline:
   ```bash
   # Run QC pipeline
   ./devops/scripts/qc-runner.sh devops/tests/fixtures/{test-app}

   # If testing deployment, also run verify:
   ./devops/scripts/verify-deploy.sh {app-name} {server} {port} {compose-path}
   ```

5. **Measure**: Check if the test fixture now passes (deployment_score improved)

6. **Keep or discard**:
   - If deployment_score improved → KEEP (advance the branch)
   - If equal or worse → DISCARD (`git reset --hard HEAD~1`)
   - Log the result to results.tsv

7. **Update program.md**: If you kept a fix, document the failure pattern and fix in the Known Failure Patterns section below.

## Logging Results

Log every experiment to `devops/logs/research-results.tsv` (tab-separated):

```
commit	deployment_score	test_app	status	description
a1b2c3d	4.0	test-app-subpath	keep	baseline with QC-08
b2c3d4e	4.0	test-app-fetch-only	keep	added fetch wrapper auto-fix
c3d4e5f	3.0	test-app-auth	discard	auth stripping broke health endpoint
```

## NEVER STOP

Once the experiment loop has begun, do NOT pause to ask the human. The human might be asleep. You are autonomous. If you run out of ideas:

1. Re-read past failure logs in `devops/logs/verification.tsv`
2. Re-read this program.md for angles you haven't tried
3. Create new test fixtures for edge cases
4. Try combining previous near-misses
5. Try more radical changes (new QC checks, different fix strategies)
6. Look at the real deployed apps on the server for patterns

The loop runs until the human interrupts you, period.

## Verification-Before-Completion Contract

You MUST NEVER report "done" or "deployed" until ALL of these are verified with evidence:

1. **Health check**: `curl` the health endpoint, show the `{"status":"ok"}` response
2. **API routing**: Test at least 3 API endpoints through nginx sub-path, show HTTP 200 (or 401 for auth-gated)
3. **Frontend load**: `curl` the app through nginx, show the HTML contains correct asset paths
4. **Asset loading**: Verify JS/CSS bundle URLs return 200
5. **Log evidence**: Point to the verification.tsv entry showing pass

If ANY of these fail, you are NOT done. Fix the issue and re-verify.

## Known Failure Patterns

### Pattern 1: Absolute API Paths (zouhuo bug, 2026-03-21)
**Symptom**: Frontend loads, but all API calls return 404 through nginx.
**Root cause**: Frontend uses `/api/...` (absolute path from root) instead of `/{app-name}/api/...`.
**Fix**: Inject `axios.defaults.baseURL = '/{app-name}'` after axios import.
**QC check**: QC-08 (check-api-basepath.sh)
**Test fixture**: test-app-subpath

### Pattern 2: Missing Vite Base Path
**Symptom**: Frontend HTML loads, but JS/CSS assets return 404.
**Root cause**: Vite config missing `base: "/{app-name}/"`, so assets are requested from `/` instead of `/{app-name}/`.
**Fix**: Set `base: "/{app-name}/"` in vite.config.js/ts.
**QC check**: QC-08 (check-api-basepath.sh)
**Test fixture**: test-app-wrong-basepath

### Pattern 3: fetch() Without BaseURL
**Symptom**: Same as Pattern 1, but app uses fetch() instead of axios.
**Root cause**: fetch() doesn't have a baseURL concept like axios.
**Fix**: Inject a global fetch wrapper that prepends `/{app-name}` to `/api/` URLs.
**QC check**: QC-08 (check-api-basepath.sh)
**Test fixture**: test-app-fetch-only

### Pattern 4: Individual App Auth
**Symptom**: App shows its own login page instead of content. Double-auth friction.
**Root cause**: App has JWT/session auth middleware. Portal already handles auth via nginx basic auth.
**Fix**: Remove authenticate middleware args from route registrations. Set frontend auth state to always-true.
**QC check**: QC-09 (check-auth-bypass.sh) — IMPLEMENTED
**Test fixture**: test-app-with-auth

### Pattern 5: Volume Permission Denied
**Symptom**: Container crashes with EACCES on startup.
**Root cause**: Non-root container (appuser UID:GID 100:101) can't write to root-owned mounted volumes.
**Fix**: QC-10 ensures Dockerfile creates all needed dirs. deploy.sh auto-creates host dirs with chown 100:101.
**QC check**: QC-10 (check-app-dirs.sh) — IMPLEMENTED
**Deploy fix**: deploy.sh Step 4c auto-creates volume dirs — IMPLEMENTED

### Pattern 6: Docker Compose Insertion Position
**Symptom**: `docker compose` fails to parse the file.
**Root cause**: New service block was appended after `networks:` section.
**Fix**: Insert BEFORE the `networks:` section using Python YAML manipulation.
**QC check**: check-ports.sh (partially)
**Test fixture**: TODO

### Pattern 7: Missing Nginx Config
**Symptom**: App runs on container port but unreachable through portal URL.
**Root cause**: No upstream or location blocks in nginx.cloud.conf for the new app.
**Fix**: deploy.sh Step 4b auto-generates and injects upstream + location blocks.
**Deploy fix**: deploy.sh nginx-gen utility — IMPLEMENTED

### Pattern 8: Docker Network Isolation
**Symptom**: Nginx returns 502 Bad Gateway — can't resolve upstream.
**Root cause**: App container not on the same Docker network as nginx (platform-net).
**Fix**: Ensure docker-compose service has `networks: [platform-net]`.
**QC check**: QC-11 (check-compose-network.sh) — IMPLEMENTED

### Pattern 9: Monorepo Stack Detection Failure
**Symptom**: QC checks skip or fail because they can't detect the app's stack.
**Root cause**: App has server/ + client/ structure, package.json is in server/ not root.
**Fix**: detect-stack.sh utility checks both root and server/ for package.json.
**Utility**: devops/scripts/utils/detect-stack.sh — IMPLEMENTED

---

### Pattern 10: No Memory Limits on Containers
**Symptom**: One container OOM-kills the entire server.
**Root cause**: docker-compose service has no mem_limit, default is unlimited.
**Fix**: Add `mem_limit: 512m` and `memswap_limit: 512m` to service block.
**QC check**: QC-13 (check-resource-limits.sh) — IMPLEMENTED

### Pattern 11: Missing .env File
**Symptom**: Container crashes on startup because env vars are undefined.
**Root cause**: .env file not created from .env.example before first deploy.
**Fix**: QC-12 scans source for env var references, creates .env.example, copies to .env.
**QC check**: QC-12 (check-env-vars.sh) — IMPLEMENTED

### Pattern 12: Bloated Docker Images
**Symptom**: Deployment takes 10+ minutes due to SSH image transfer.
**Root cause**: Image includes dev dependencies, test files, or uses non-alpine base.
**Fix**: Advisory only — suggests multi-stage build, alpine base, .dockerignore.
**QC check**: QC-14 (check-image-size.sh) — IMPLEMENTED (advisory)

## Operational Capabilities

Beyond QC and deployment, a fully-developed DevOps agent handles:

| Capability | Script | Schedule |
|-----------|--------|----------|
| Health monitoring | health-check.sh | Every 5 minutes |
| PR detection & auto-fix | pr-watcher.sh | Every 60 seconds |
| Docker cleanup | cleanup.sh | Daily at 3:00 AM |
| Database backup | backup-db.sh | Daily at 2:00 AM |
| Deployment audit | utils/audit.sh | On every deploy/rollback |

All scheduled via launchd plists in `devops/launchd/`.

### Pattern 13: Missing Security Headers
**Symptom**: APIs vulnerable to XSS, clickjacking, MIME sniffing.
**Root cause**: No helmet middleware (Node.js) or security headers.
**Fix**: Advisory — warns but doesn't auto-install packages.
**QC check**: QC-15 (check-security.sh) — IMPLEMENTED (advisory)

### Pattern 14: Known Vulnerabilities in Dependencies
**Symptom**: npm audit shows critical/high vulnerabilities.
**Root cause**: Outdated packages with published CVEs.
**Fix**: Advisory — runs npm audit, reports findings.
**QC check**: QC-16 (check-deps.sh) — IMPLEMENTED (advisory)

## Full Command Reference

### Deployment
| Command | Description |
|---------|-------------|
| `onboard.sh <url>` | Clone, analyze, QC, register, build, PR |
| `deploy.sh <app>` | Full deployment pipeline with verification |
| `rollback.sh <app>` | Emergency rollback to previous version |
| `restart.sh <app>` | Restart container (--rebuild to rebuild first) |
| `scale.sh <app> <N>` | Scale to N replicas |

### Monitoring & Diagnostics
| Command | Description |
|---------|-------------|
| `status.sh` | Complete server dashboard |
| `health-check.sh` | Check all app health (auto-restart on failure) |
| `perf-check.sh` | Response time monitoring with alerts |
| `logs.sh <app>` | View/stream container logs |
| `exec.sh <app>` | Open shell in container |

### Maintenance
| Command | Description |
|---------|-------------|
| `cleanup.sh` | Docker prune, disk/memory monitoring, log rotation |
| `backup-db.sh` | PostgreSQL backup with 7-day retention |
| `verify-deploy.sh` | Post-deploy endpoint verification |

### Security & Infrastructure
| Command | Description |
|---------|-------------|
| `setup-ssl.sh <domain>` | HTTPS certificate (Let's Encrypt or self-signed) |
| `setup-firewall.sh` | UFW + fail2ban server hardening |

### Automation
| Daemon | Schedule | Purpose |
|--------|----------|---------|
| pr-watcher | Every 60s | PR detection and auto-fix |
| health-check | Every 5min | App health monitoring |
| cleanup | Daily 3:00 AM | Docker/disk maintenance |
| backup-db | Daily 2:00 AM | Database backup |

## QC Pipeline — 19 Checks

| # | Check | Category | Auto-fix? |
|---|-------|----------|-----------|
| 01 | check-config | Security | Yes |
| 02 | check-health | Reliability | Yes |
| 03 | check-lockfiles | Reproducibility | Yes |
| 04 | check-dockerfile | Containerization | Yes |
| 05 | check-lint | Code quality | Yes |
| 06 | check-api-basepath | Routing | Yes |
| 07 | check-auth-bypass | Auth | Yes |
| 08 | check-app-dirs | Permissions | Yes |
| 09 | check-env-vars | Configuration | Yes |
| 10 | check-docker-build | Build | Yes |
| 11 | check-ports | Networking | Yes |
| 12 | check-compose-network | Networking | Yes |
| 13 | check-resource-limits | Resources | Yes |
| 14 | check-image-size | Optimization | Advisory |
| 15 | check-security | Security | Advisory |
| 16 | check-deps | Security | Advisory |
| 17 | check-tests | Testing | Advisory |
| 18 | check-db-ready | Database | Advisory |
| 19 | check-frontend-basepath | Routing | Yes |

*This document grows autonomously as the agent discovers new failure patterns.*
*Last updated: 2026-03-28 (R4)*
