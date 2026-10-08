# Windows 服务器部署说明

目标：网页和 API 不依赖打开的终端窗口运行。

## 1. 发布项目

在项目根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\publish-windows.ps1
```

脚本会完成三件事：

1. 构建前端 `web2/dist`
2. 复制前端文件到后端 `src/ErpApi/wwwroot`
3. 发布后端到 `publish/erpapi`

发布完成后，`publish/erpapi` 就是服务器运行目录。

## 2. 配置环境变量

后端启动前必须配置：

```powershell
setx ERP_DB "Server=数据库地址;Database=数据库名;User Id=用户名;Password=密码;TrustServerCertificate=True;"
setx ERP_JWT_KEY "至少32位的随机密钥字符串"
setx ERP_URLS "http://localhost:5000"
```

如果要让局域网其他电脑访问，把 `ERP_URLS` 改成：

```powershell
setx ERP_URLS "http://0.0.0.0:5000"
```

设置后重新打开 PowerShell，或者重新登录一次，让任务计划能读到新环境变量。

## 3. 注册任务计划

在项目根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-task.ps1
```

该脚本会：

1. 检查发布目录是否存在
2. 检查并持久化 `ERP_DB`、`ERP_JWT_KEY`、`ERP_URLS`
3. 注册名为 `WebpageERP` 的任务计划
4. 立即启动任务

之后访问：

```text
http://localhost:5000
```

这时可以关闭终端，网页仍然会继续运行。电脑重新登录后，任务计划也会自动启动。

## 4. 停止或重启

停止：

```powershell
schtasks /End /TN WebpageERP
```

启动：

```powershell
schtasks /Run /TN WebpageERP
```

删除任务：

```powershell
schtasks /Delete /TN WebpageERP /F
```

## 5. 如果任务计划被系统拒绝

有些电脑会禁止创建任务计划。此时可以直接运行隐藏启动脚本：

```powershell
wscript.exe .\scripts\start-published-hidden.vbs
```

它会启动 `publish/erpapi/ErpApi.exe`，关闭终端后网页仍然可以访问：

```text
http://localhost:5000
```

停止时先查 PID：

```powershell
netstat -ano | findstr :5000
```

然后停止对应进程：

```powershell
Stop-Process -Id 进程号 -Force
```

## 6. 更新版本

下次更新代码后重新执行发布脚本，再重启任务：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\publish-windows.ps1
schtasks /End /TN WebpageERP
schtasks /Run /TN WebpageERP
```
