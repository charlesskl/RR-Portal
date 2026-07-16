# 加工厂私密数据恢复最终修复报告

日期：2026-07-16

## 审查范围与 SHA

- 基线 `origin/main`：`73675c4e9aa8ec497a291eba46dafc3eccd53bea`
- 最终审查起点：`fb69f82746070ae8bb8484f64a8480ac1bcde1b1`
- 修复提交：`0fd38655c79cb8353367deebed67a41587d554d6`
- 分支：`codex/factory-review-data-restore`

## TDD 证据

先扩展合同，再修改生产实现。

RED 1：

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/tests/test-factory-review-data-restore.ps1
FAIL: workflow must declare a top-level concurrency block
exit code 1
```

RED 2：

```text
Git Bash: scripts/tests/test-factory-review-data-restore.sh
FAIL: invalid EXPECTED_COMMIT must fail
exit code 1
```

GREEN：静态合同和行为合同随后覆盖并通过并发组、只读 Git、SSH 指纹、镜像 revision、
旧镜像拒绝、回滚健康失败停服、临时明文清理失败回滚、三分片以及 PR 合同工作流语义。

## 修复内容

1. 恢复工作流和 `deploy.yml` 使用完全相同的 `deploy-cloud` 并发组，均为
   `cancel-in-progress: false`；PowerShell 合同直接比较两者。
2. 恢复工作流只 fetch，不再 switch/merge/pull/reset/rebase。它要求 `origin/main`、
   `HEAD`、`EXPECTED_COMMIT` 完全相等，并要求恢复脚本 tracked 且 clean。
3. factory-review 最终镜像接受 `OCI_REVISION` 并写入 OCI revision label；云端 Compose
   从 `${AFTER_COMMIT:-local}` 传参。恢复脚本要求 40 位小写 hex commit，通过当前
   Compose 容器解析 image ID，再读取 image label 并精确比较。迁移直接使用已检查的
   image ID，避免 tag 漂移。旧镜像测试证明不会 stop、备份或迁移生产数据。
4. SSH 前增加独立 preflight，其唯一 Secret 输入是 `CLOUD_HOST_FINGERPRINT`；空值、
   非法字符、错误长度和错误 padding 都在 SSH action 前拒绝。四个 payload Secrets
   仍只在 SSH 步骤中读取。
5. 备份解压成功但恢复数据永久 unhealthy 时，回滚路径再次显式 stop 服务再失败；
   行为合同断言最后一个服务动作是 stop。
6. 主成功路径在 `committed=1` 前主动严格清理 `TEMP_DIR`。模拟清理失败会恢复同一
   备份、重新通过健康检查，并以失败状态退出；EXIT handler 继续兜底重试清理。
7. 设计和计划统一要求三个非空、连续、真正均分的 ASCII 分片，采用商和余数分配，
   长度差最多 1，每片最多 40,000 字符。
8. 新增无 Secrets 的 PR contract workflow：固定 checkout SHA、`contents: read`、完整
   路径过滤、PowerShell/Bash 合同、完整 diff、branch-only 资产名、大 blob 和跨行
   非空 snapshot 对象扫描。真正恢复工作流仍只有 `workflow_dispatch`。
9. Git 扫描不再把结构 marker 或历史空对象测试夹具当成泄密。扫描 branch-only blobs
   的实际内容和路径；当前分支未发现真实 payload、凭据或私密数据资产。

## 文件

- `.github/workflows/restore-factory-review-data.yml`
- `.github/workflows/factory-review-restore-contract.yml`
- `deploy/restore-factory-review-data.sh`
- `scripts/tests/test-factory-review-data-restore.ps1`
- `scripts/tests/test-factory-review-data-restore.sh`
- `apps/PMC跟仓管/加工厂月度评审管理制度/Dockerfile`
- `docker-compose.cloud.yml`
- `docs/superpowers/specs/2026-07-16-factory-review-private-data-restore-design.md`
- `docs/superpowers/plans/2026-07-16-factory-review-private-data-restore.md`
- `.superpowers/sdd/final-fix-report.md`

未修改其他业务代码。

## 验证输出

PowerShell 合同：

```text
PASS: transactional restore failure, lock, trace, and health contracts
PASS: factory review restore static and behavior contracts
exit code 0
```

独立 Git Bash 合同：

```text
PASS: transactional restore failure, lock, trace, and health contracts
exit code 0
```

应用测试：

```text
npm test -- --run
Test Files  13 passed (13)
Tests       45 passed (45)
Duration    4.41s
exit code 0
```

生产构建：

```text
npm run build
158 modules transformed
built in 718ms
exit code 0
```

Vite 报告已有 chunk 大于 500 kB 的性能提示，但构建成功，且本波次未修改应用业务代码
或打包配置。

YAML 解析（使用 factory-review `node_modules/yaml`）：

```text
PASS: ../../../.github/workflows/restore-factory-review-data.yml
PASS: ../../../.github/workflows/factory-review-restore-contract.yml
exit code 0
```

Shell 语法：

```text
bash -n deploy/restore-factory-review-data.sh
bash -n scripts/tests/test-factory-review-data-restore.sh
PASS: bash -n restore script and Bash contract
exit code 0
```

完整分支 diff 和资产扫描（修复提交后）：

```text
git diff --check origin/main...HEAD
PASS: diff clean; branch-only blobs=36; max=33621 bytes
      (scripts/tests/test-factory-review-data-restore.ps1);
      no plaintext/private assets
exit code 0
```

## 自审

- 逐项复核用户列出的 9 项最终 findings，均有实现和合同或扫描覆盖。
- 恢复工作流的 trigger 仍只有手动 dispatch；PR workflow 不引用 `${{ secrets.* }}`。
- payload 错误在 Docker 前失败；image revision 错误在 stop/backup/migration 前失败。
- rollback 解压失败不会 start；rollback health 失败最终 stop；清理失败恢复同一备份并健康。
- staged diff 只包含允许的 9 个实现/合同/文档文件；报告单独提交。
- 未发现 ZIP、gzip、SQLite、数据库、私密 migration、大 payload blob、明文凭据或非空
  私密 snapshot 对象进入分支历史。

## 残余风险

- 未触发真实 GitHub Actions 恢复，也未连接生产 SSH；真实三 Secret 传输、磁盘空间、
  Docker label、备份恢复和线上业务计数仍需 Task 4 按计划验证。
- 手工 SSH 部署可绕过 GitHub concurrency；仓库纪律禁止这种部署，运行时 revision 门禁
  会拒绝错误镜像，但恢复锁未与 `deploy/update-server.sh` 共用。
- 若生产文件系统本身拒绝删除，脚本会回滚并再次尝试清理后失败，但无法在底层 `rm`
  持续失败时证明明文已物理删除；该失败会保持可见且不会提交恢复事务。
- `${AFTER_COMMIT:-local}` 的本地 fallback 会生成 revision `local`，因此本地/手动构建的
  镜像会被生产恢复脚本有意拒绝。Task 4 必须等待正常 push deploy 成功。
- PR 扫描把 branch-only blob 上限设为 50,000 bytes；若同一 PR 混入合法的大文件，合同
  会 fail closed，需要拆分 PR，而不是放宽私密恢复分支的扫描门禁。
