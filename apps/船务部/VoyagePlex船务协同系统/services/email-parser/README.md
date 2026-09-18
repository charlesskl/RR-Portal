# VoyagePlex 邮件解析服务

该服务是新系统的一部分，与 `legacy-reference/READ_ONLY_RR_PORTAL` 完全隔离。

规则来源：RR-Portal 船务管理系统 `main@690cbab`。旧代码仅用于行为参考；本服务使用自己的输入输出协议、临时目录和测试。

接口：`POST /v1/email-batches/parse`，表单字段 `files` 可重复上传多个 `.eml`。每封邮件独立解析，单封失败不会中断批次。

## 企业邮箱自动收取

解析服务支持从一个固定船务邮箱通过加密 IMAP 读取邮件。由管理员在运行解析服务的云服务器上配置以下环境变量，授权码不要写入仓库：

| 变量 | 说明 |
| --- | --- |
| `VOYAGEPLEX_MAIL_ADDRESS` | 完整企业邮箱地址 |
| `VOYAGEPLEX_MAIL_AUTH_CODE` | 该邮箱的客户端授权码 |
| `VOYAGEPLEX_MAIL_IMAP_HOST` | 可选，默认 `imaphz.qiye.163.com` |
| `VOYAGEPLEX_MAIL_FOLDER` | 可选，默认 `INBOX` |

云服务器须能向 `imaphz.qiye.163.com:993` 建立加密出站连接。解析服务不配置上述邮箱地址与授权码时，自动收取保持关闭。后台每 5 分钟读取一次，也可在“信息导入 → 邮件解析”点击“立即同步”。首次同步读取最近 7 天邮件，每次最多处理 50 封；后续通过邮箱 UID 继续读取。每日邮件按固定船务邮箱的 IMAP 收件时间归类，以北京时间（UTC+8）划分日期；转发邮件的原始发信日期不参与归类。邮件只进入待确认批次，人工确认后才创建或更新走柜任务。系统使用只读文件夹连接和 `BODY.PEEK[]`，不会把邮件标记为已读。

真实邮件样本只保留在用户授权的本地目录，不复制进仓库。可用以下命令执行回归验证：

```bash
python tools/check_customer_samples.py "/path/to/customer-emails"
```

运行：

```bash
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --port 8091
```
