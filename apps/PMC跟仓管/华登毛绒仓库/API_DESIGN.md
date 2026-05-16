# API 设计文档

> 前端已经按这个调用,后端必须严格遵守。

## 通用约定

**请求格式**:所有 POST/PUT 请求 body 都是 JSON,`Content-Type: application/json`

**字段命名**:
- 前端 → 后端:**驼峰**(billNo)
- 数据库 → 后端 → 前端:**下划线**(bill_no),前端用 `normalizeRecord()` 自动转

**认证**:基于 Session Cookie,登录后 cookie 自动带上

**错误响应**:
```json
{ "error": "错误信息" }
```
状态码:400(参数错)/ 401(未登录)/ 403(无权限)/ 404(不存在)/ 500(服务器错)

**成功响应**:
```json
{ "success": true, ... }
```

---

## 认证

### POST /api/login
**权限**:无需登录
**请求**:`{ "username": "admin", "password": "123456" }`
**响应**:
```json
{
  "success": true,
  "user": {"username": "admin", "role": "admin", "display_name": "系统管理员"}
}
```

### POST /api/logout
**权限**:需登录

### GET /api/me
**权限**:需登录
**响应**:`{ "id": 1, "username": "admin", "role": "admin", "display_name": "..." }`

---

## 入库(已实现,作为参考)

### GET /api/in
**权限**:任何登录用户
**Query 参数**:
- `category`(可选):'plush' 或 'costume',筛选品类

**响应**:数组,按日期倒序
```json
[
  {
    "id": 7,
    "category": "plush",
    "date": "2026-05-11",
    "bill_no": "IN-007",
    "sku": "HD-T003",
    "name": "恐龙毛绒 20cm 绿色",
    "style": "rare",
    "flag": "日本",
    "qty": 80,
    "created_by": "admin",
    "created_at": "2026-05-11 10:23:45"
  }
]
```

### POST /api/in
**权限**:admin / operator
**请求**:
```json
{
  "category": "plush",
  "date": "2026-05-12",
  "billNo": "IN-008",
  "sku": "HD-T001",
  "name": "小熊毛绒 25cm 棕色",
  "style": "normal",
  "flag": "美国",
  "qty": 500
}
```

**戏服示例**:
```json
{
  "category": "costume",
  "date": "2026-05-12",
  "billNo": "IN-201",
  "sku": "CS-001",
  "name": "小熊配套连衣裙",
  "style": "M码连衣裙",
  "flag": "美国",
  "qty": 100
}
```

**校验**:
- category 必须是 'plush' 或 'costume'(默认 plush)
- 毛绒 style 只能是 'normal' 或 'rare'
- 戏服 style 是任意非空文本
- qty 必须是正整数

**响应**:`{ "success": true, "id": 8 }`

### DELETE /api/in/{id}
**权限**:admin
**响应**:`{ "success": true }`

---

## 库存查询(已实现)

### GET /api/stock
**权限**:任何登录用户
**Query 参数**:
- `category`(可选):'plush' 或 'costume'

**响应**:库存汇总数组
```json
[
  {
    "category": "plush",
    "sku": "HD-T001",
    "name": "小熊毛绒 25cm 棕色",
    "style": "normal",
    "flag": "美国",
    "in_total": 800,
    "out_total": 300,
    "stock": 500
  }
]
```

---

## 出库(待实现,与入库结构一致)

### GET /api/out?category=plush|costume
**权限**:任何登录用户

### POST /api/out
**权限**:admin / operator
**请求**:
```json
{
  "category": "plush",
  "date": "2026-05-12",
  "billNo": "OUT-004",
  "po": "PO-2026-0501",
  "picker": "王师傅",
  "sku": "HD-T001",
  "name": "小熊毛绒 25cm 棕色",
  "style": "normal",
  "flag": "美国",
  "qty": 200
}
```

**戏服示例**:
```json
{
  "category": "costume",
  "date": "2026-05-12",
  "billNo": "OUT-201",
  "po": "PO-2026-0501",
  "picker": "李工",
  "sku": "CS-001",
  "name": "小熊配套连衣裙",
  "style": "M码连衣裙",
  "flag": "美国",
  "qty": 50
}
```

**校验**:同入库,但 po 和 picker 是可选字段(允许空字符串)

### DELETE /api/out/{id}
**权限**:admin

---

## 布标(待实现)

### GET /api/flags
**权限**:任何登录用户
**响应**:字符串数组 `["中国", "美国", ...]`

### POST /api/flags
**权限**:admin
**请求**:`{ "name": "荷兰" }`

### DELETE /api/flags/{name}
**权限**:admin
**URL**:name 是中文,Flask 自动 URL-decode

---

## 用户管理(待实现)

### GET /api/users
**权限**:admin
**响应**:用户数组(不含 password_hash)

### POST /api/users
**权限**:admin
**请求**:
```json
{
  "username": "newuser",
  "password": "abc123",
  "role": "operator",
  "display_name": "张三"
}
```

### DELETE /api/users/{id}
**权限**:admin
**约束**:不能删除自己

### PUT /api/users/{id}/password
**权限**:任何登录用户改自己 / admin 改任何人
**请求**:`{ "old_password": "123456", "new_password": "abc123" }`
**约束**:
- 非 admin:user_id 必须等于自己的 id,且需要验证 old_password
- admin:user_id 可以是任何人,old_password 字段可以省略

---

## 导出 CSV(待实现,可选)

### GET /api/export/in?category=plush&from=2026-01-01&to=2026-12-31
**权限**:任何登录用户
**响应**:`Content-Type: text/csv; charset=utf-8`
**响应头**:`Content-Disposition: attachment; filename=in_records_20260512.csv`
**重要**:文件第一字节必须是 BOM (`\ufeff`),不然 Excel 会乱码

### GET /api/export/out?category=plush&from=...&to=...
同上

### GET /api/export/stock?category=plush
导出当前库存(按 货号+款式+布标 聚合)
