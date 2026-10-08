# 客户排期原始数据（Excel）

各客户排期表原始文件，按客户分文件夹存放，用于「业务部 → 客户排期表」的导入。

## 那边（新机器）首次运行步骤

1. 拉取最新代码：`git pull`
2. 建/补数据库表（脚本幂等，含排期表 69/70/71 和菜单权限种子）：
   ```powershell
   ./db/run-db.ps1 -ConnectionString $env:ERP_DB
   ```
3. 重启后端（`Program.cs` 注册了 SchedulingService，必须重启才生效）
4. 前端 `npm run dev` 后打开「业务部 → 客户排期表」，点「导入排期」，选本目录下对应客户的 Excel 导入即可
   - 重复导入按自然键（排期客户+PO号+客PO+SKU+货号+数量）自动更新，不会重复
