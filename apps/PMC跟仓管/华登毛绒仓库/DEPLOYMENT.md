# 部署指南

> 给最终部署的人(可以是非程序员)

## 第一次安装(在服务器电脑上做)

### 1. 安装 Python

下载 Python 3.10 或更高版本:https://www.python.org/downloads/

**Windows 安装时务必勾选 "Add Python to PATH"**

验证:CMD 输入 `python --version`,看到 `Python 3.10.x` 之类即可。

### 2. 拷贝项目到服务器电脑

随便找位置,如 `C:\huadeng_inventory\`,把整个项目文件夹复制过去。

### 3. 安装依赖

打开 CMD,进入项目目录:
```
cd C:\huadeng_inventory
pip install -r requirements.txt
```

如果下载慢,用国内镜像:
```
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

### 4. 初始化数据库 + 跑测试

```
python init_db.py
python test_logic.py
```

测试应该全绿(23/23 通过)。如果有红色,说明环境有问题。

### 5. 启动服务

双击 `start.bat`(Windows)。

会看到:
```
访问地址:
  本机:        http://localhost:5000
  局域网其他人: http://<本机IP>:5000
```

### 6. 测试访问

- 服务器本机:浏览器打开 http://localhost:5000
- 其他电脑:打开 http://服务器IP:5000(IP 用 `ipconfig` 查)

用 `admin / 123456` 登录,**首次登录后立即修改密码**!

---

## 找到服务器电脑的 IP

CMD 输入 `ipconfig`,找 "IPv4 地址",一般是 `192.168.1.xxx` 这种。

---

## 防火墙(Windows)

如果同事打不开,可能是防火墙拦了 5000 端口。

打开 控制面板 → Windows Defender 防火墙 → 高级设置 → 入站规则 → 新建规则 → 端口 → TCP / 5000 → 允许。

---

## 开机自启(可选)

Win+R 输入 `shell:startup` → 把 `start.bat` 的快捷方式拖进去。下次电脑开机自动启动服务。

---

## 数据备份(强烈建议)

数据**只在 `data/inventory.db` 这一个文件里**。

**最简单**:每周手动把 `data/inventory.db` 复制到 U 盘 / 网盘。

**进阶**:让 Claude Code 帮你实现 P7 的备份脚本,设置 Windows 任务计划每天自动备份。

---

## 数据库文件可以直接看吗?

可以!免费工具 [DB Browser for SQLite](https://sqlitebrowser.org/) 打开 `data/inventory.db` 就能直接看所有数据,做 SQL 查询。

---

## 换服务器电脑

把整个项目目录复制过去,重新装 Python 依赖,运行 `python app.py` 即可。数据完全保留。

---

## 安全建议

1. **改默认密码**!特别是 admin
2. 每天备份 `data/inventory.db`
3. 定期(3 个月)换密码
4. 服务器电脑装杀毒软件
5. **不要把这个服务暴露到公网**,只在公司内网用
