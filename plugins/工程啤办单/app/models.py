from sqlalchemy import Column, Integer, String, Date, DateTime, Text, Numeric, ForeignKey, JSON
from sqlalchemy.sql import func
from plugin_sdk.database import PluginDatabase

db = PluginDatabase("plugin_rr_production")
Base = db.create_base()


# ─── 通用订单表（injection / slush / spray 共用结构） ───


class ProductionOrder(Base):
    __tablename__ = "production_orders"

    id = Column(Integer, primary_key=True, index=True)
    order_type_category = Column(String(20), nullable=False, index=True)  # injection / slush / spray
    order_number = Column(String(50))           # 产品编号
    doc_number = Column(String(50))             # 订单编号（啤办单用）
    date = Column(String(20))                   # 日期
    order_type = Column(String(30))             # 试模/试色/啤办/搪胶/搪办/喷油/返工
    stage = Column(String(10))                  # T0/EP/FEP/PP（啤办单用）
    workshop = Column(String(30))               # 车间
    supervisor = Column(String(50))             # 主管
    eng_name = Column(String(50))               # 跟进工程师
    reason = Column(Text)                       # 原因/备注
    status = Column(String(20), default="待审核")  # 待审核/待经理审核/待生产/生产中/已完成/已驳回/已取消
    receive_time = Column(String(20))           # 收到胶件时间（喷油单用）
    eng_complete_time = Column(String(20))      # 工程预计完成时间（喷油单用）
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


# ─── 啤办单明细行 ───


class InjectionItem(Base):
    __tablename__ = "injection_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("production_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    sort_order = Column(Integer, default=0)
    mold_id = Column(String(50))                # 工模编号
    mold_name = Column(String(200))             # 工模名称
    machine_type = Column(String(50))           # 机型
    material = Column(String(100))              # 原料
    color = Column(String(100))                 # 颜色
    pigment_no = Column(String(50))             # 色粉编号
    quantity = Column(Integer)                  # 件数/套数
    shoot_qty = Column(Integer)                 # 数量(啤)
    gross_weight_g = Column(Numeric(10, 2))     # 整啤毛重(g)
    required_material_kg = Column(Numeric(10, 2))  # 所需用料(KG)
    mold_return_time = Column(String(30))       # 模具回厂时间
    completion_time = Column(String(30))        # 啤办完成时间
    notes = Column(Text)                        # 备注
    # 仓库填写字段
    actual_weight_kg = Column(Numeric(10, 2))   # 实际用料
    actual_amount_hkd = Column(Numeric(10, 2))  # 实际金额
    injection_cost = Column(Numeric(10, 2))     # 啤办费用


# ─── 搪胶单明细行 ───


class SlushItem(Base):
    __tablename__ = "slush_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("production_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    sort_order = Column(Integer, default=0)
    seq_no = Column(Integer)                    # 序号
    product_id = Column(String(50))             # 产品编号
    product_image = Column(Text)                # 产品图片URL
    mold_id = Column(String(50))                # 工模编号
    mold_name = Column(String(200))             # 工模名称
    material = Column(String(100))              # 原料
    color_code = Column(String(100))            # 颜色/编号
    pigment_no = Column(String(50))             # 色粉编号
    unit_weight = Column(Numeric(10, 2))        # 每啤毛重(g)
    quantity = Column(Integer)                  # 数量
    required_date = Column(String(30))          # 要求完成日期
    return_time = Column(String(30))            # 回模时间
    notes = Column(Text)                        # 备注


# ─── 喷油单明细行 ───


class SprayItem(Base):
    __tablename__ = "spray_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("production_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    sort_order = Column(Integer, default=0)
    client_name = Column(String(200))           # 客名
    product_name = Column(String(200))          # 名称
    sample_qty = Column(Integer)                # 样板数量
    provide_time = Column(String(30))           # 提供胶件时间
    receive_time = Column(String(30))           # 收到胶件时间
    eng_complete_time = Column(String(30))      # 工程预计完成时间
    delivery_time = Column(String(30))          # 喷油交货时间
    engineer = Column(String(50))               # 工程师/PMC
    notes = Column(Text)                        # 备注


# ─── 问题反馈 ───


class Problem(Base):
    __tablename__ = "problems"

    id = Column(Integer, primary_key=True, index=True)
    order_type = Column(String(20))             # injection / slush / spray
    order_id = Column(Integer, index=True)
    order_number = Column(String(50))
    description = Column(Text, nullable=False)
    reported_by = Column(String(50))
    status = Column(String(20), default="待处理")   # 待处理 / 已解决
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    resolved_at = Column(DateTime(timezone=True))


# ─── 原料价格 ───


class MaterialPrice(Base):
    __tablename__ = "material_prices"

    id = Column(Integer, primary_key=True, index=True)
    material = Column(String(100), nullable=False)
    unit_price = Column(Numeric(10, 2))
    notes = Column(Text)


# ─── 领料单 ───


class MaterialRequisition(Base):
    __tablename__ = "material_requisitions"

    id = Column(Integer, primary_key=True, index=True)
    req_number = Column(String(30), unique=True)
    date = Column(String(20))
    order_id = Column(Integer)
    order_number = Column(String(50))
    material = Column(String(100))
    requested_weight_kg = Column(Numeric(10, 2))
    applicant = Column(String(50))
    notes = Column(Text)
    status = Column(String(20), default="待出库")   # 待出库 / 已出库
    issued_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
