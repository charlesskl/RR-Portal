from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete, update
from pydantic import BaseModel
from datetime import datetime
from decimal import Decimal
from typing import Any

from plugin_sdk.auth import require_plugin_permission, TokenPayload
from plugin_sdk.models import StandardResponse, PaginatedResponse
from app.models import (
    db, ProductionOrder, InjectionItem, SlushItem, SprayItem,
    Problem, MaterialPrice, MaterialRequisition,
)

router = APIRouter(prefix="/api/rr-production", tags=["工程啤办单"])

VALID_CATEGORIES = {"injection", "slush", "spray"}
ITEM_MODELS = {
    "injection": InjectionItem,
    "slush": SlushItem,
    "spray": SprayItem,
}


# ═══════════════════ Schemas ═══════════════════


class OrderHeaderCreate(BaseModel):
    order_number: str | None = None
    doc_number: str | None = None
    date: str | None = None
    order_type: str | None = None
    stage: str | None = None
    workshop: str | None = None
    supervisor: str | None = None
    eng_name: str | None = None
    reason: str | None = None
    status: str | None = "待审核"
    receive_time: str | None = None
    eng_complete_time: str | None = None


class InjectionItemSchema(BaseModel):
    mold_id: str | None = None
    mold_name: str | None = None
    machine_type: str | None = None
    material: str | None = None
    color: str | None = None
    pigment_no: str | None = None
    quantity: int | None = None
    shoot_qty: int | None = None
    gross_weight_g: Decimal | None = None
    required_material_kg: Decimal | None = None
    mold_return_time: str | None = None
    completion_time: str | None = None
    notes: str | None = None


class SlushItemSchema(BaseModel):
    seq_no: int | None = None
    product_id: str | None = None
    product_image: str | None = None
    mold_id: str | None = None
    mold_name: str | None = None
    material: str | None = None
    color_code: str | None = None
    pigment_no: str | None = None
    unit_weight: Decimal | None = None
    quantity: int | None = None
    required_date: str | None = None
    return_time: str | None = None
    notes: str | None = None


class SprayItemSchema(BaseModel):
    client_name: str | None = None
    product_name: str | None = None
    sample_qty: int | None = None
    provide_time: str | None = None
    receive_time: str | None = None
    eng_complete_time: str | None = None
    delivery_time: str | None = None
    engineer: str | None = None
    notes: str | None = None


class OrderCreate(OrderHeaderCreate):
    items: list[dict] = []


class OrderUpdate(OrderHeaderCreate):
    items: list[dict] | None = None


class ItemPatchEntry(BaseModel):
    id: int
    order_id: int | None = None
    sort_order: int | None = None


class ItemPatchRequest(BaseModel):
    updates: list[dict] = []


class StatusUpdate(BaseModel):
    status: str


class ProblemCreate(BaseModel):
    order_type: str
    order_id: int
    order_number: str | None = None
    description: str
    reported_by: str | None = None


class MaterialPriceSchema(BaseModel):
    material: str
    unit_price: Decimal | None = None
    notes: str | None = None


class RequisitionCreate(BaseModel):
    date: str | None = None
    order_id: int | None = None
    order_number: str | None = None
    material: str | None = None
    requested_weight_kg: Decimal | None = None
    applicant: str | None = None
    notes: str | None = None


class RequisitionStatusUpdate(BaseModel):
    status: str


# ═══════════════════ Helpers ═══════════════════


def _validate_category(category: str):
    if category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category: {category}")


def _order_to_dict(o: ProductionOrder) -> dict:
    return {
        "id": o.id,
        "order_type_category": o.order_type_category,
        "order_number": o.order_number,
        "doc_number": o.doc_number,
        "date": o.date,
        "order_type": o.order_type,
        "stage": o.stage,
        "workshop": o.workshop,
        "supervisor": o.supervisor,
        "eng_name": o.eng_name,
        "reason": o.reason,
        "status": o.status,
        "receive_time": o.receive_time,
        "eng_complete_time": o.eng_complete_time,
        "created_at": o.created_at.isoformat() if o.created_at else None,
        "updated_at": o.updated_at.isoformat() if o.updated_at else None,
    }


def _item_to_dict(item) -> dict:
    d = {}
    for c in item.__table__.columns:
        val = getattr(item, c.name)
        if isinstance(val, Decimal):
            val = float(val)
        elif isinstance(val, datetime):
            val = val.isoformat()
        d[c.name] = val
    return d


async def _get_order_or_404(session: AsyncSession, order_id: int) -> ProductionOrder:
    result = await session.execute(
        select(ProductionOrder).where(ProductionOrder.id == order_id)
    )
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="未找到")
    return order


async def _get_order_with_items(session: AsyncSession, order_id: int) -> dict:
    order = await _get_order_or_404(session, order_id)
    ItemModel = ITEM_MODELS[order.order_type_category]
    items_result = await session.execute(
        select(ItemModel)
        .where(ItemModel.order_id == order_id)
        .order_by(ItemModel.sort_order)
    )
    items = items_result.scalars().all()
    data = _order_to_dict(order)
    data["items"] = [_item_to_dict(it) for it in items]
    return data


async def _create_items(session: AsyncSession, category: str, order_id: int, items: list[dict]):
    ItemModel = ITEM_MODELS[category]
    for i, item_data in enumerate(items):
        item_data.pop("id", None)
        item_data.pop("order_id", None)
        item = ItemModel(order_id=order_id, sort_order=i, **item_data)
        session.add(item)


async def _replace_items(session: AsyncSession, category: str, order_id: int, items: list[dict]):
    ItemModel = ITEM_MODELS[category]
    await session.execute(
        delete(ItemModel).where(ItemModel.order_id == order_id)
    )
    await _create_items(session, category, order_id, items)


# ═══════════════════ Orders CRUD (per category) ═══════════════════


@router.get("/{category}", response_model=StandardResponse)
async def list_orders(
    category: str,
    _: TokenPayload = Depends(require_plugin_permission("rr-production:read")),
    session: AsyncSession = Depends(db.get_session),
):
    _validate_category(category)
    result = await session.execute(
        select(ProductionOrder)
        .where(ProductionOrder.order_type_category == category)
        .order_by(ProductionOrder.id.desc())
    )
    orders = result.scalars().all()
    return StandardResponse(data=[_order_to_dict(o) for o in orders])


@router.get("/{category}/{order_id}", response_model=StandardResponse)
async def get_order(
    category: str,
    order_id: int,
    _: TokenPayload = Depends(require_plugin_permission("rr-production:read")),
    session: AsyncSession = Depends(db.get_session),
):
    _validate_category(category)
    data = await _get_order_with_items(session, order_id)
    return StandardResponse(data=data)


@router.post("/{category}", response_model=StandardResponse)
async def create_order(
    category: str,
    req: OrderCreate,
    _: TokenPayload = Depends(require_plugin_permission("rr-production:write")),
    session: AsyncSession = Depends(db.get_session),
):
    _validate_category(category)
    order = ProductionOrder(
        order_type_category=category,
        order_number=req.order_number,
        doc_number=req.doc_number,
        date=req.date,
        order_type=req.order_type,
        stage=req.stage,
        workshop=req.workshop,
        supervisor=req.supervisor,
        eng_name=req.eng_name,
        reason=req.reason,
        status=req.status or "待审核",
        receive_time=req.receive_time,
        eng_complete_time=req.eng_complete_time,
    )
    session.add(order)
    await session.flush()
    await session.refresh(order)

    if req.items:
        await _create_items(session, category, order.id, req.items)
        await session.flush()

    data = await _get_order_with_items(session, order.id)
    return StandardResponse(data=data, message="创建成功")


@router.put("/{category}/{order_id}", response_model=StandardResponse)
async def update_order(
    category: str,
    order_id: int,
    req: OrderUpdate,
    _: TokenPayload = Depends(require_plugin_permission("rr-production:write")),
    session: AsyncSession = Depends(db.get_session),
):
    _validate_category(category)
    order = await _get_order_or_404(session, order_id)

    for field in [
        "order_number", "doc_number", "date", "order_type", "stage",
        "workshop", "supervisor", "eng_name", "reason", "status",
        "receive_time", "eng_complete_time",
    ]:
        val = getattr(req, field, None)
        if val is not None:
            setattr(order, field, val)

    if req.items is not None:
        await _replace_items(session, category, order_id, req.items)

    await session.flush()
    await session.refresh(order)
    data = await _get_order_with_items(session, order.id)
    return StandardResponse(data=data, message="更新成功")


@router.delete("/{category}/{order_id}", response_model=StandardResponse)
async def delete_order(
    category: str,
    order_id: int,
    _: TokenPayload = Depends(require_plugin_permission("rr-production:manage")),
    session: AsyncSession = Depends(db.get_session),
):
    _validate_category(category)
    order = await _get_order_or_404(session, order_id)
    ItemModel = ITEM_MODELS[category]
    await session.execute(delete(ItemModel).where(ItemModel.order_id == order_id))
    await session.delete(order)
    await session.flush()
    return StandardResponse(data=None, message="删除成功")


@router.patch("/{category}/{order_id}/status", response_model=StandardResponse)
async def update_order_status(
    category: str,
    order_id: int,
    req: StatusUpdate,
    _: TokenPayload = Depends(require_plugin_permission("rr-production:manage")),
    session: AsyncSession = Depends(db.get_session),
):
    _validate_category(category)
    order = await _get_order_or_404(session, order_id)
    order.status = req.status
    await session.flush()
    return StandardResponse(data=None, message="状态已更新")


@router.patch("/{category}/{order_id}/items", response_model=StandardResponse)
async def patch_order_items(
    category: str,
    order_id: int,
    req: ItemPatchRequest,
    _: TokenPayload = Depends(require_plugin_permission("rr-production:write")),
    session: AsyncSession = Depends(db.get_session),
):
    """局部更新明细行字段（啤机填写 / 仓库填写）"""
    _validate_category(category)
    await _get_order_or_404(session, order_id)
    ItemModel = ITEM_MODELS[category]

    for u in req.updates:
        item_id = u.get("id")
        if not item_id:
            continue
        result = await session.execute(
            select(ItemModel).where(
                ItemModel.id == item_id,
                ItemModel.order_id == order_id,
            )
        )
        item = result.scalar_one_or_none()
        if item:
            for k, v in u.items():
                if k in ("id", "order_id", "sort_order"):
                    continue
                if hasattr(item, k):
                    setattr(item, k, v)

    await session.flush()
    return StandardResponse(data=None, message="明细已更新")


# ═══════════════════ Problems ═══════════════════


@router.get("/problems", response_model=StandardResponse)
async def list_problems(
    _: TokenPayload = Depends(require_plugin_permission("rr-production:read")),
    session: AsyncSession = Depends(db.get_session),
    type: str | None = None,
    order_id: int | None = None,
):
    query = select(Problem)
    if type:
        query = query.where(Problem.order_type == type)
    if order_id:
        query = query.where(Problem.order_id == order_id)
    result = await session.execute(query.order_by(Problem.id.desc()))
    problems = result.scalars().all()
    return StandardResponse(data=[_item_to_dict(p) for p in problems])


@router.post("/problems", response_model=StandardResponse)
async def create_problem(
    req: ProblemCreate,
    _: TokenPayload = Depends(require_plugin_permission("rr-production:write")),
    session: AsyncSession = Depends(db.get_session),
):
    problem = Problem(
        order_type=req.order_type,
        order_id=req.order_id,
        order_number=req.order_number,
        description=req.description,
        reported_by=req.reported_by,
    )
    session.add(problem)
    await session.flush()
    await session.refresh(problem)
    return StandardResponse(data=_item_to_dict(problem), message="问题已提交")


@router.patch("/problems/{problem_id}/resolve", response_model=StandardResponse)
async def resolve_problem(
    problem_id: int,
    _: TokenPayload = Depends(require_plugin_permission("rr-production:manage")),
    session: AsyncSession = Depends(db.get_session),
):
    result = await session.execute(select(Problem).where(Problem.id == problem_id))
    problem = result.scalar_one_or_none()
    if not problem:
        raise HTTPException(status_code=404, detail="未找到")
    problem.status = "已解决"
    problem.resolved_at = func.now()
    await session.flush()
    await session.refresh(problem)
    return StandardResponse(data=_item_to_dict(problem), message="问题已解决")


# ═══════════════════ Material Prices ═══════════════════


@router.get("/material-prices", response_model=StandardResponse)
async def list_material_prices(
    _: TokenPayload = Depends(require_plugin_permission("rr-production:read")),
    session: AsyncSession = Depends(db.get_session),
):
    result = await session.execute(select(MaterialPrice).order_by(MaterialPrice.id))
    prices = result.scalars().all()
    return StandardResponse(data=[_item_to_dict(p) for p in prices])


@router.put("/material-prices", response_model=StandardResponse)
async def replace_material_prices(
    prices: list[MaterialPriceSchema],
    _: TokenPayload = Depends(require_plugin_permission("rr-production:manage")),
    session: AsyncSession = Depends(db.get_session),
):
    await session.execute(delete(MaterialPrice))
    for p in prices:
        session.add(MaterialPrice(
            material=p.material,
            unit_price=p.unit_price,
            notes=p.notes,
        ))
    await session.flush()
    result = await session.execute(select(MaterialPrice).order_by(MaterialPrice.id))
    return StandardResponse(
        data=[_item_to_dict(mp) for mp in result.scalars().all()],
        message="原料价格已更新",
    )


# ═══════════════════ Material Stats ═══════════════════


@router.get("/material-stats", response_model=StandardResponse)
async def material_stats(
    _: TokenPayload = Depends(require_plugin_permission("rr-production:read")),
    session: AsyncSession = Depends(db.get_session),
    month: str | None = None,
):
    """原料用量汇总统计"""
    # 获取价格表
    prices_result = await session.execute(select(MaterialPrice).order_by(MaterialPrice.id))
    prices = prices_result.scalars().all()
    stats: dict[str, dict] = {}
    for i, p in enumerate(prices):
        stats[p.material] = {
            "seq": i + 1,
            "material": p.material,
            "unit_price": float(p.unit_price) if p.unit_price else 0,
            "notes": p.notes or "",
            "total_actual_weight": 0,
            "total_amount": 0,
        }

    # 筛选订单
    order_query = select(ProductionOrder.id).where(
        ProductionOrder.order_type_category == "injection"
    )
    if month:
        order_query = order_query.where(ProductionOrder.date.like(f"{month}%"))

    valid_order_ids = (await session.execute(order_query)).scalars().all()

    if valid_order_ids:
        items_result = await session.execute(
            select(InjectionItem).where(InjectionItem.order_id.in_(valid_order_ids))
        )
        for item in items_result.scalars().all():
            if not item.material:
                continue
            if item.material not in stats:
                stats[item.material] = {
                    "seq": len(stats) + 1,
                    "material": item.material,
                    "unit_price": 0,
                    "notes": "",
                    "total_actual_weight": 0,
                    "total_amount": 0,
                }
            stats[item.material]["total_actual_weight"] += float(item.actual_weight_kg or 0)
            stats[item.material]["total_amount"] += float(item.actual_amount_hkd or 0)

    return StandardResponse(data=list(stats.values()))


# ═══════════════════ Injection Costs ═══════════════════


@router.get("/injection-costs", response_model=StandardResponse)
async def injection_costs(
    _: TokenPayload = Depends(require_plugin_permission("rr-production:read")),
    session: AsyncSession = Depends(db.get_session),
    month: str | None = None,
):
    """啤办费用汇总"""
    order_query = select(ProductionOrder).where(
        ProductionOrder.order_type_category == "injection"
    )
    if month:
        order_query = order_query.where(ProductionOrder.date.like(f"{month}%"))

    orders = (await session.execute(order_query)).scalars().all()
    result_list = []
    for o in orders:
        items = (await session.execute(
            select(InjectionItem)
            .where(InjectionItem.order_id == o.id)
            .order_by(InjectionItem.sort_order)
        )).scalars().all()
        for it in items:
            result_list.append({
                "order_number": o.order_number or "",
                "doc_number": o.doc_number or "",
                "date": o.date or "",
                "workshop": o.workshop or "",
                "mold_id": it.mold_id or "",
                "mold_name": it.mold_name or "",
                "injection_cost": float(it.injection_cost) if it.injection_cost else None,
                "notes": it.notes or "",
            })

    return StandardResponse(data=result_list)


# ═══════════════════ Requisitions ═══════════════════


@router.get("/requisitions", response_model=StandardResponse)
async def list_requisitions(
    _: TokenPayload = Depends(require_plugin_permission("rr-production:read")),
    session: AsyncSession = Depends(db.get_session),
    order_id: int | None = None,
):
    query = select(MaterialRequisition)
    if order_id:
        query = query.where(MaterialRequisition.order_id == order_id)
    result = await session.execute(query.order_by(MaterialRequisition.id.desc()))
    return StandardResponse(data=[_item_to_dict(r) for r in result.scalars().all()])


@router.post("/requisitions", response_model=StandardResponse)
async def create_requisition(
    req: RequisitionCreate,
    _: TokenPayload = Depends(require_plugin_permission("rr-production:write")),
    session: AsyncSession = Depends(db.get_session),
):
    now = datetime.now()
    date_str = now.strftime("%Y%m%d")

    # 生成领料单号
    count_result = await session.execute(
        select(func.count()).select_from(MaterialRequisition).where(
            MaterialRequisition.req_number.like(f"LL-{date_str}-%")
        )
    )
    seq = (count_result.scalar() or 0) + 1

    requisition = MaterialRequisition(
        req_number=f"LL-{date_str}-{seq:03d}",
        date=req.date or now.strftime("%Y-%m-%d"),
        order_id=req.order_id,
        order_number=req.order_number,
        material=req.material,
        requested_weight_kg=req.requested_weight_kg,
        applicant=req.applicant,
        notes=req.notes,
    )
    session.add(requisition)
    await session.flush()
    await session.refresh(requisition)
    return StandardResponse(data=_item_to_dict(requisition), message="领料单已创建")


@router.patch("/requisitions/{req_id}/status", response_model=StandardResponse)
async def update_requisition_status(
    req_id: int,
    req: RequisitionStatusUpdate,
    _: TokenPayload = Depends(require_plugin_permission("rr-production:manage")),
    session: AsyncSession = Depends(db.get_session),
):
    result = await session.execute(
        select(MaterialRequisition).where(MaterialRequisition.id == req_id)
    )
    requisition = result.scalar_one_or_none()
    if not requisition:
        raise HTTPException(status_code=404, detail="未找到")
    requisition.status = req.status
    if req.status == "已出库":
        requisition.issued_at = func.now()
    await session.flush()
    await session.refresh(requisition)
    return StandardResponse(data=_item_to_dict(requisition), message="状态已更新")


@router.delete("/requisitions/{req_id}", response_model=StandardResponse)
async def delete_requisition(
    req_id: int,
    _: TokenPayload = Depends(require_plugin_permission("rr-production:manage")),
    session: AsyncSession = Depends(db.get_session),
):
    result = await session.execute(
        select(MaterialRequisition).where(MaterialRequisition.id == req_id)
    )
    requisition = result.scalar_one_or_none()
    if not requisition:
        raise HTTPException(status_code=404, detail="未找到")
    await session.delete(requisition)
    await session.flush()
    return StandardResponse(data=None, message="领料单已删除")


# ═══════════════════ Stats / Dashboard ═══════════════════


@router.get("/stats", response_model=StandardResponse)
async def stats(
    _: TokenPayload = Depends(require_plugin_permission("rr-production:read")),
    session: AsyncSession = Depends(db.get_session),
):
    result_data = {}
    for category in VALID_CATEGORIES:
        total = (await session.execute(
            select(func.count()).select_from(ProductionOrder).where(
                ProductionOrder.order_type_category == category
            )
        )).scalar() or 0

        pending = (await session.execute(
            select(func.count()).select_from(ProductionOrder).where(
                ProductionOrder.order_type_category == category,
                ProductionOrder.status == "待生产",
            )
        )).scalar() or 0

        in_progress = (await session.execute(
            select(func.count()).select_from(ProductionOrder).where(
                ProductionOrder.order_type_category == category,
                ProductionOrder.status == "生产中",
            )
        )).scalar() or 0

        done = (await session.execute(
            select(func.count()).select_from(ProductionOrder).where(
                ProductionOrder.order_type_category == category,
                ProductionOrder.status == "已完成",
            )
        )).scalar() or 0

        result_data[category] = {
            "total": total,
            "pending": pending,
            "inProgress": in_progress,
            "done": done,
        }

    return StandardResponse(data=result_data)


# ═══════════════════ Dashboard (legacy compat) ═══════════════════


@router.get("/dashboard", response_model=StandardResponse)
async def dashboard(
    _: TokenPayload = Depends(require_plugin_permission("rr-production:read")),
    session: AsyncSession = Depends(db.get_session),
):
    total = (await session.execute(
        select(func.count()).select_from(ProductionOrder)
    )).scalar() or 0

    counts = {}
    for status_val in ["待审核", "待经理审核", "待生产", "生产中", "已完成", "已驳回", "已取消"]:
        counts[status_val] = (await session.execute(
            select(func.count()).select_from(ProductionOrder).where(
                ProductionOrder.status == status_val
            )
        )).scalar() or 0

    return StandardResponse(data={
        "total_orders": total,
        "pending_review": counts["待审核"],
        "pending_manager": counts["待经理审核"],
        "pending_production": counts["待生产"],
        "in_production": counts["生产中"],
        "completed": counts["已完成"],
        "rejected": counts["已驳回"],
        "cancelled": counts["已取消"],
    })
