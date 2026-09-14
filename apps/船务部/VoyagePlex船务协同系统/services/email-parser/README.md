# VoyagePlex 邮件解析服务

该服务是新系统的一部分，与 `legacy-reference/READ_ONLY_RR_PORTAL` 完全隔离。

规则来源：RR-Portal 船务管理系统 `main@690cbab`。旧代码仅用于行为参考；本服务使用自己的输入输出协议、临时目录和测试。

接口：`POST /v1/email-batches/parse`，表单字段 `files` 可重复上传多个 `.eml`。每封邮件独立解析，单封失败不会中断批次。

真实邮件样本只保留在用户授权的本地目录，不复制进仓库。可用以下命令执行回归验证：

```bash
python tools/check_customer_samples.py "/path/to/customer-emails"
```

运行：

```bash
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --port 8091
```
