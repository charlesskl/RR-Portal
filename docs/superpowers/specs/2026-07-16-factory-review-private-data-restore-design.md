# 加工厂评审系统私密数据恢复设计

## 目标

把用户提供的 `加工厂系统已有数据_已清除认证秘密_20260716.zip` 恢复到线上
`factory-review` 服务，同时确保联系人、电话和业务记录不进入公开 Git 历史。

## 数据范围

恢复包包含 19 个普通账户元数据、2 个超级用户元数据、186 家加工厂、92 条订单、
479 条品质检验记录、10 个评分模板，以及少量 5S、评分、会议和 KPI 记录。恢复包不含
密码哈希、令牌、API Key、OTP、MFA 或认证会话数据。恢复后的账户保持锁定状态，现有
管理员密码继续由 `FACTORY_REVIEW_ADMIN_PASSWORD` 管理。

## 传输与恢复

1. 将恢复迁移脚本压缩并编码，始终均分为三个非空临时分片；三个分片长度差不超过
   1 个字符，且每个分片不超过 40,000 个 ASCII 字符。
2. 分片只写入仓库级临时 GitHub Secrets，不提交明文或可解密的数据文件。
3. 一次性恢复工作流与正常部署共用 `deploy-cloud` 并发组并排队执行。SSH 前的独立
   preflight 只读取 `CLOUD_HOST_FINGERPRINT`，要求其为 OpenSSH SHA256 指纹；payload
   Secrets 只在随后固定 SHA 的 SSH action 步骤中读取。
4. 恢复工作流只 `git fetch origin main`，不推进服务器 Git。远端 `origin/main`、`HEAD`
   和 `EXPECTED_COMMIT` 必须完全相等，恢复脚本必须 tracked 且 clean。
5. 正常部署为最终 `factory-review` 镜像写入
   `org.opencontainers.image.revision=$AFTER_COMMIT`。恢复脚本在停服前检查
   `EXPECTED_COMMIT` 为 40 位十六进制提交，并通过当前容器的 image ID 校验该 OCI
   revision 精确相等；旧镜像或无标签镜像立即失败，不触碰生产数据也不停止服务。
6. 恢复前复制完整 `pb_data` 到带时间戳的服务器备份目录。
7. 使用已验证的当前 `factory-review` 镜像启动一次性 PocketBase migration 容器；容器沿用生产
   `pb_data` bind mount，并额外挂载私密迁移脚本。
8. 迁移按记录 ID 幂等更新；加工厂在 ID 不匹配时可按唯一名称复用，避免重复数据。
9. 恢复完成后查询 PocketBase SQLite，确认关键表记录数不低于恢复包基线。
10. 在提交恢复事务前主动且严格删除服务器临时明文；清理失败按迁移失败处理并恢复同一
    备份。成功后删除 GitHub 临时 Secrets，并保留备份供人工审计。

## 失败与回滚

- 分片缺失、哈希不一致、备份失败、迁移失败或数量校验失败时立即停止。
- 校验失败时停止 `factory-review`，把恢复前备份还原为 `pb_data`，再重新启动并检查健康状态。
- 备份解压成功但恢复后的服务始终不健康时，再次显式停止 `factory-review` 后返回失败。
- 临时明文清理失败发生在事务提交前，必须恢复同一备份并验证服务重新健康。
- 日志只输出分片状态、哈希结果和记录数量，不输出业务数据或 Secret 内容。

## 验证

- 静态测试验证工作流不包含明文业务数据，并且必须先备份再恢复。
- 无 Secrets 的 PR contract workflow 自动运行 PowerShell 和 Bash 合同、完整分支 diff 检查、
  分支独有 blob 大小/资产名扫描，以及包含声明、赋值号和左花括号的真实 snapshot
  数据对象字面量扫描。
  单独出现的 `const SNAPSHOT =` payload 结构 marker 不视为数据泄露。
- 本地解析恢复包，验证 JSON 和迁移脚本一致，且不存在认证秘密字段。
- 线上验证 `/factory-review/health`、登录页和主要业务表计数。
- 恢复成功后确认临时 GitHub Secrets 已删除。
