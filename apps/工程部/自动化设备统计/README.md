# 自动化设备统计

生产自动化设备投资、生产量、节省成本和结余统计系统。

## 数据库

- `db/schema.ts`：设备、生产记录和用户权限表结构。
- `drizzle/0000_initial.sql`：幂等建表、索引和当前页面已有数据种子。
- 原始 Excel、账号和未加密业务快照不提交到 GitHub。

## 开发

```bash
npm install
npm run dev
```

当前应用保留 OpenAI Sites 配置，便于现有线上版本继续运行。合入 RR Portal 后需按平台评审结果接入共享数据库与统一认证。
