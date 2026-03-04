# Assembly Department (装配部) — Design Document

Date: 2026-03-04

## Summary

Add a new assembly department page (`assembly.html`) with full order management, login-based access, simplified workflow, and supervisor approval. Orders print in 兴信 format.

## Data Model

### assembly_orders

```json
{
  "id": 439,
  "order_number": "ORD-001",
  "product_name": "厨房四件套",
  "client_name": "ZURU",
  "date": "2026-03-04",
  "status": "待审核",
  "workshop": "装配车间",
  "created_by": "张三",
  "completed_date": null
}
```

### assembly_items

```json
{
  "id": 440,
  "order_id": 439,
  "sort_order": 0,
  "product_number": "77858-S001",
  "product_name": "清洁面板",
  "quantity": "500",
  "completion_time": "2026-03-10",
  "notes": "需要包装袋"
}
```

### assembly_users

```json
[{"name": "张三", "pin": "1234"}]
```

### Workflow Statuses

`待审核` → `待生产` → `生产中` → `已完成`

- `待审核 → 待生产`: Supervisor approval (PIN required)
- `待生产 → 生产中`: Assembly dept action
- `生产中 → 已完成`: Assembly dept action, sets `completed_date`
- `已驳回`: Supervisor can reject from `待审核`

## Server API

### New Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/assembly` | GET | List all assembly orders with items |
| `/api/assembly` | POST | Create order (requires `X-User` header) |
| `/api/assembly/:id` | GET | Get single order with items |
| `/api/assembly/:id` | PUT | Update order (owner only) |
| `/api/assembly/:id` | DELETE | Delete order (owner only) |
| `/api/assembly/:id/status` | PATCH | Status transitions |

### Modified Endpoints

- `GET /api/pending-reviews` — include assembly orders with `待审核` status
- `GET /api/stats` — add assembly counts

## Frontend: assembly.html

- **Theme:** Blue `#2980b9`
- **Auth:** Name + PIN login, stored in `sessionStorage('assembly_user')`, `X-User` header on writes
- **Layout:** Single table view (no tabs), status filter bar, create/edit modal
- **Auto-refresh:** 30s interval
- **Print:** Button per order → `print.html?type=assembly&id=X`

## Print Format

- Company: 东莞兴信塑胶制品有限公司
- Columns: 序号 | 产品编号 | 产品名称 | 数量 | 要求完成日期 | 备注

## Integration Points

- **index.html:** Add assembly stats card and link
- **supervisor.html:** Show assembly orders in review queue, approve/reject
- **print.html:** Add `type=assembly` rendering handler
- **data.json:** Initialize `assembly_orders: []`, `assembly_items: []`, `assembly_users: []`

## Approach

Clone `engineering.html`, strip to single order type with simplified fields. Reuse server CRUD factory pattern. Wire into existing supervisor workflow and dashboard.
