# 排期扫描同步系统

端口: **8080**

## 启动方式

双击 `start.bat` 或运行：
```
cd server
node index.js
```

然后打开浏览器访问：http://localhost:8080

## 配置金山文档 API

编辑 `server/.env`：
```
KINGSOFT_APP_ID=你的AppID
KINGSOFT_ACCESS_TOKEN=你的AccessToken
KINGSOFT_FILE_ID=目标文档ID
```

## 功能说明

- 点击「开始扫描 Z 盘」扫描所有客户排期文件（约1-3分钟）
- 黄色 = 新单，蓝色 = 修改单
- 勾选订单后点击「确认已选」标记为已处理（下次不再显示）
- 配置金山文档 API 后可自动写入文档
