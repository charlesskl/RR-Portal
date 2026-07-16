# RR-Portal AI Context and Migration Handoff

Last updated: 2026-07-16

This document is a sanitized handoff for continuing RR-Portal work on another
computer. It intentionally excludes passwords, API keys, database connection
strings, private SSH keys, customer records, phone numbers, and business data.

## Repository

- GitHub: https://github.com/charlesskl/RR-Portal
- Default branch: `main`
- Previous local path: `D:\project\project\RR-Portal`
- Production host: Aliyun ECS (host details are stored in GitHub Secrets)
- Production deployment: merge to `main` -> GitHub Actions ->
  `deploy/update-server.sh`
- Production health entry: `http://8.148.146.194/nginx-health`

Read these files before making changes:

1. `AGENTS.md`
2. `docker-compose.cloud.yml`
3. `deploy/update-server.sh`
4. `nginx/nginx.cloud.conf`

Important deployment rule: do not manually run a broad Docker Compose rebuild
while GitHub Actions is deploying. Service deployments must remain isolated
with `--no-deps` and a specific service name.

## Codex Conversation

- Thread ID: `019f2100-51a5-7a80-b4d8-f93a2df2c1d1`
- Saved title: `RR-Portal PR、部署与数据恢复交接记录`
- The thread was pinned on the old computer on 2026-07-16.

The original conversation contains historical credentials and business details.
Do not export or commit it in plaintext. This file is the safe continuation
summary.

## Current Production State

### Factory review system

- App: `apps/PMC跟仓管/加工厂月度评审管理制度`
- Service: `factory-review`
- URL: `/factory-review/`
- PR #269 added the application and was merged.
- PR #273 added the secure transactional data restore process and was merged.
- PR #273 merge commit: `8efa0236956383b14bb7624312a71bc7815b094a`
- Deployment run `29498437377` completed successfully.
- Restore run `29499494338` completed successfully.
- Live health check returned `{"status":"ok"}`.

The restored package contained:

- 19 users and 2 superuser records
- 186 factories
- 92 orders
- 479 quality inspections
- 10 score templates
- 1 quality 5S record
- 1 monthly score
- 1 review meeting
- 1 KPI log

The restore created a production backup before migration, verified required
record counts, restarted the service, and checked health. The four temporary
payload GitHub Secrets were deleted after success. The local temporary decoded
payload and split files were also deleted. No plaintext business snapshot was
committed to Git.

The persistent `CLOUD_HOST_FINGERPRINT` GitHub Secret stores the verified SSH
host fingerprint used by the production restore workflow. Do not replace it
without independently verifying the server host key.

### Shipping and record-player management

Recent merged work includes:

- PR #231: shipping department and shipping management system
- PR #235/#237: private shipping history seed and sparse-data installation
- PR #238/#240: large-list performance and save rate-limit fixes
- PR #226/#230: record-player management system naming and application
- PR #239/#250/#253/#254/#255/#256/#267/#271: department inventory flows,
  import/export, clearing, bulk deletion, admin department switching, sorting,
  and worksheet fixes

### Quality and internal quote systems

Recent merged work includes:

- PR #221/#225: quality system changes
- PR #223: internal quote RMB conversion
- PR #224/#242: QC OCR deployment fixes
- PR #243: QC dashboard/backend synchronization
- PR #245/#247/#248/#249: ABS recycled material default pricing fixes
- PR #246: internal quote assembly import grouping
- PR #252/#264/#270: internal quote category, import, allocation, and factory
  workflow changes
- PR #263/#266: QC import preview and refresh

PR #222 and PR #244 were closed without merging. Do not treat their branch
contents as production state.

### CPG and Lihong processing rules

- PR #257/#258/#259 fixed record date ordering and summary/import display.
- PR #261 fixed Lihong inventory flow rules.
- The Lihong workbook has no finished-goods flow.
- In the web workflow, processing-warehouse outbound corresponds to the
  workbook's semi-finished-goods inbound operation.

## Open Work

### PR #268: Indonesia shipping portal

- URL: https://github.com/charlesskl/RR-Portal/pull/268
- State on 2026-07-16: OPEN
- Intent: add an Indonesia department and Indonesia shipping portal.
- Original PR history contains a real business data snapshot and must not be
  merged as-is.
- A clean-history branch was prepared previously with public sample data and
  deployment-time secret initialization.
- The clean branch was synchronized with the then-current `main`; backend tests
  passed 31 tests with one environment-dependent SQL Server integration test
  skipped, and frontend tests/build/lint/audit passed.
- Before continuing, fetch the latest `main` (which now includes PR #273), rerun
  the stale-base regression scan, and preserve both `/indo-shipping/health` and
  `/factory-review/health` in deployment health checks.
- Historical Indonesia data must use a private, encrypted or temporary-secret
  transfer. Never recommit the plaintext snapshot.
- Database connection details and credentials were shared in the old chat.
  Retrieve them from an approved secret manager or rotate them; do not recover
  them from this file.

### PR #272

- URL: https://github.com/charlesskl/RR-Portal/pull/272
- State on 2026-07-16: OPEN
- Title: `feat(zuru-master): 应用当前工作台与总分排期核对`
- Review independently before merging; it was not part of the factory data
  restore work.

## New Computer Setup

1. Install Git, GitHub CLI, Docker Desktop, Node.js, Python, and .NET SDKs used
   by the repository.
2. Sign in to Codex with the same account.
3. Run `gh auth login` and verify access with
   `gh repo view charlesskl/RR-Portal`.
4. Clone the repository and read `AGENTS.md` before editing:

   ```powershell
   git clone https://github.com/charlesskl/RR-Portal.git
   cd RR-Portal
   git fetch --all --prune
   git status
   ```

5. Restore the SSH private key/config through a secure channel if direct server
   access is required. Never place private keys in the repository.
6. GitHub repository Secrets remain on GitHub and do not need to be copied to
   the new computer. Verify names only with `gh secret list`; their values cannot
   and should not be exported.
7. Re-authenticate any local package registries, cloud CLIs, or database tools.
8. Reopen the repository in Codex and provide `AI_CONTEXT.md` as the starting
   context for the next task.

## Files Not Stored in GitHub

The following may still exist only on the old computer and must be copied
separately if they are needed:

- WeChat attachments and original business workbooks
- The original factory-review ZIP supplied on 2026-07-16
- Local `.env` files
- SSH keys and SSH config
- Uncommitted files shown by `git status`
- Other workspaces such as `D:\WebpageERP` and `D:\project\project\CPG`

Use an encrypted external disk or an approved private cloud location for these
files. Do not upload raw `.env` files, credentials, or business data to GitHub.

## Security Actions Before Retiring the Old Computer

1. Rotate credentials that appeared in the old chat, especially the QC Bailian
   API key and Indonesia SQL Server credentials.
2. Confirm GitHub Secrets contain the replacement values before revoking the old
   ones.
3. Sign out of GitHub CLI, Codex, browsers, database tools, and SSH agents on the
   old computer after the new computer is verified.
4. Securely erase local `.env` files, private keys, temporary exports, and
   business attachments only after confirming the encrypted backup can be read.

## Verification Commands

```powershell
gh pr list --repo charlesskl/RR-Portal --state open
gh run list --repo charlesskl/RR-Portal --workflow deploy.yml --limit 5
curl.exe -fsS http://8.148.146.194/factory-review/health
git status --short
```

Expected factory-review health response:

```json
{"status":"ok"}
```
