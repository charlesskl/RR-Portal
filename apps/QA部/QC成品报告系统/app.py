from __future__ import annotations

import base64
import hashlib
import io
import json
import mimetypes
import os
import secrets
import shutil
import uuid
from datetime import date, datetime, timezone
from functools import wraps
from pathlib import Path

from flask import (
    Flask,
    abort,
    flash,
    g,
    jsonify,
    redirect,
    render_template,
    request,
    send_file,
    session,
    url_for,
)
from PIL import Image, ImageOps
from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    event,
    func,
    select,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, scoped_session, sessionmaker
from werkzeug.security import check_password_hash, generate_password_hash

from pdf_service import generate_report_pdf


UTC = timezone.utc


class TrustedPrefixMiddleware:
    """Apply the Portal mount prefix only when it exactly matches configuration."""

    def __init__(self, application, trusted_prefix: str):
        self.application = application
        self.trusted_prefix = trusted_prefix.rstrip("/")

    def __call__(self, environ, start_response):
        if environ.get("HTTP_X_FORWARDED_PREFIX", "").rstrip("/") == self.trusted_prefix:
            environ["SCRIPT_NAME"] = self.trusted_prefix
        return self.application(environ, start_response)


PHOTO_CATEGORIES = {
    "product": "产品照片 / Product",
    "marking": "产品标识 / Marking",
    "date_code": "日期码 / Date code",
    "packaging": "包装照片 / Packaging",
    "barcode": "条码 / Barcode",
    "defect": "缺陷照片 / Defect",
    "carton": "外箱 / Carton",
    "warehouse": "仓库存货 / Warehouse",
    "instruction": "说明书 / Instruction",
    "other": "其他 / Other",
}
DEFAULT_TESTS = [
    ("Carton Drop", "30in x 10T", True),
    ("Toy Drop-Safety", "36in x 6T", True),
    ("Toy Drop-Reliability", "36in x 6T", True),
    ("Torque-Safety", "4 IN.LBS x 10S", True),
    ("Tension-Safety", "21 LBS x 10S", True),
    ("Current test", "<= 150mA", True),
    ("Battery voltage", ">= 1.5V", True),
    ("Abrasion", "", False),
    ("Adhesion", "3M810 x 6T", True),
    ("Metal Detection", "", False),
    ("Rev. Polarity Check", "", False),
    ("Polybag thickness", "", False),
]
DEFAULT_PHOTO_SLOTS = [
    ("product_overview", "产品整体 / Product overview", "拍摄完整产品及主要配件", True, "product"),
    ("components", "组件 / Components", "展开并拍摄所有组件", False, "product"),
    ("front", "包装正面 / Front side", "包装正面需完整清晰", True, "packaging"),
    ("rear", "包装背面 / Rear side", "包装背面需完整清晰", True, "packaging"),
    ("left", "包装左侧 / Left side", "拍摄左侧面", False, "packaging"),
    ("right", "包装右侧 / Right side", "拍摄右侧面", False, "packaging"),
    ("top", "包装顶部 / Top side", "拍摄顶部", False, "packaging"),
    ("bottom", "包装底部 / Bottom side", "拍摄底部", False, "packaging"),
    ("marking", "产品标识 / Product marking", "近距离拍摄产品标签及版权信息", True, "marking"),
    ("date_code", "日期码 / Date code", "近距离拍摄产品或包装日期码", True, "date_code"),
    ("barcode", "条码 / Barcode", "拍摄可读条码及扫码结果", True, "barcode"),
    ("instruction", "说明书 / Instruction", "拍摄说明书或菜单页", False, "instruction"),
    ("defect", "缺陷证据 / Defect evidence", "缺陷近景；填写样品编号，同一缺陷可上传多角度", False, "defect"),
    ("carton_front", "外箱正唛 / Carton front", "拍摄外箱正唛", True, "carton"),
    ("carton_side", "外箱侧唛 / Carton side", "拍摄外箱侧唛", False, "carton"),
    ("carton_packing", "装箱状态 / Carton packing", "开箱拍摄产品装箱状态", True, "carton"),
    ("warehouse", "仓库存货 / Warehouse", "拍摄整批货物在仓库存放状态", True, "warehouse"),
]
PO_FIELD_DEFINITIONS = [
    ("customer_name", "客户 / Customer", "document", "customer", True),
    ("factory_name", "工厂 / Factory", "document", "factory", False),
    ("country", "国家 / Country", "document", "country", False),
    ("po_no", "PO 编号 / PO number", "document", "po_number", True),
    ("item_no", "货号 / Item number", "item", "item_number", True),
    ("description", "产品描述 / Description", "item", "description", True),
    ("po_quantity", "订购数量 / Ordered quantity", "item", "ordered_quantity", True),
    ("carton_count", "箱数 / Carton count", "item", "carton_count", False),
    ("case_pack", "装箱数 / Case pack", "item", "case_pack", False),
    ("date_code", "日期码 / Date code", "item", "date_code", False),
    ("barcode", "单品条码 / Product barcode", "item", "barcode", False),
    ("age_grade", "年龄等级 / Age grade", "item", "age_grade", False),
    ("origin", "原产国 / Country of origin", "item", "country_of_origin", False),
    ("size_mm", "产品尺寸 / Product dimensions", "item", "product_dimensions_mm", False),
    ("net_weight_kg", "产品净重 / Product N.W.", "item", "product_net_weight_kg", False),
    ("gross_weight_kg", "产品毛重 / Product G.W.", "item", "product_gross_weight_kg", False),
    ("assortment_ratio", "组合比例 / Assortment ratio", "item", "assortment_ratio", False),
    ("individual_packaging", "单品包装 / Individual packaging", "item", "individual_packaging", False),
    ("master_carton_dimension", "外箱尺寸 / Master carton dimensions", "item", "master_carton_dimensions_mm", False),
    ("master_carton_nw", "外箱净重 / Master carton N.W.", "item", "master_carton_net_weight_kg", False),
    ("master_carton_gw", "外箱毛重 / Master carton G.W.", "item", "master_carton_gross_weight_kg", False),
    ("outer_carton_barcode", "外箱条码 / Outer carton barcode", "item", "outer_carton_barcode", False),
    ("inner_carton_details", "内箱资料 / Inner carton details", "item", "inner_carton_details", False),
]
PO_ALLOWED_EXTENSIONS = {".pdf", ".xls", ".xlsx", ".jpg", ".jpeg", ".png"}


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(20), default="qc")
    password_hash: Mapped[str] = mapped_column(String(255))
    signature_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


class Customer(Base):
    __tablename__ = "customers"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), unique=True)
    country: Mapped[str] = mapped_column(String(100), default="")
    address: Mapped[str] = mapped_column(Text, default="")


class Product(Base):
    __tablename__ = "products"
    id: Mapped[int] = mapped_column(primary_key=True)
    item_no: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    description: Mapped[str] = mapped_column(String(255))
    size_mm: Mapped[str] = mapped_column(String(120), default="")
    net_weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    gross_weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    barcode: Mapped[str] = mapped_column(String(120), default="")
    age_grade: Mapped[str] = mapped_column(String(40), default="")
    origin: Mapped[str] = mapped_column(String(80), default="CHINA")


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    po_no: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[int] = mapped_column(Integer)
    carton_count: Mapped[int] = mapped_column(Integer, default=0)
    case_pack: Mapped[int] = mapped_column(Integer, default=0)
    date_code: Mapped[str] = mapped_column(String(100), default="")


class POImport(Base):
    __tablename__ = "po_imports"
    id: Mapped[int] = mapped_column(primary_key=True)
    original_name: Mapped[str] = mapped_column(String(255))
    file_path: Mapped[str] = mapped_column(String(500))
    mime_type: Mapped[str] = mapped_column(String(120), default="application/octet-stream")
    checksum: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(40), default="queued", index=True)
    error_message: Mapped[str] = mapped_column(Text, default="")
    model: Mapped[str] = mapped_column(String(120), default="")
    prompt_version: Mapped[str] = mapped_column(String(40), default="")
    schema_version: Mapped[str] = mapped_column(String(40), default="")
    request_id: Mapped[str] = mapped_column(String(160), default="")
    raw_result: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class POItem(Base):
    __tablename__ = "po_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    po_import_id: Mapped[int] = mapped_column(ForeignKey("po_imports.id", ondelete="CASCADE"), index=True)
    item_index: Mapped[int] = mapped_column(Integer, default=0)
    review_status: Mapped[str] = mapped_column(String(40), default="needs_review")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


class ExtractedField(Base):
    __tablename__ = "extracted_fields"
    id: Mapped[int] = mapped_column(primary_key=True)
    po_item_id: Mapped[int] = mapped_column(ForeignKey("po_items.id", ondelete="CASCADE"), index=True)
    field_key: Mapped[str] = mapped_column(String(100), index=True)
    raw_value: Mapped[str] = mapped_column(Text, default="")
    normalized_value: Mapped[str] = mapped_column(Text, default="")
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    source_ref: Mapped[str] = mapped_column(Text, default="")
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


class ReportSource(Base):
    """Links a report to the exact PO item used to create it without altering legacy rows."""

    __tablename__ = "report_sources"
    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("reports.id", ondelete="CASCADE"), unique=True, index=True)
    po_item_id: Mapped[int] = mapped_column(ForeignKey("po_items.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


class PhotoChecklistTemplate(Base):
    __tablename__ = "photo_checklist_templates"
    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"), nullable=True, index=True)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"), nullable=True, index=True)
    slot_key: Mapped[str] = mapped_column(String(80), index=True)
    label: Mapped[str] = mapped_column(String(180))
    instruction: Mapped[str] = mapped_column(Text, default="")
    example_path: Mapped[str] = mapped_column(String(500), default="")
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    category: Mapped[str] = mapped_column(String(40), default="other")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class ReportPhotoSlot(Base):
    __tablename__ = "report_photo_slots"
    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("reports.id", ondelete="CASCADE"), index=True)
    template_slot_id: Mapped[int | None] = mapped_column(ForeignKey("photo_checklist_templates.id"), nullable=True)
    slot_key: Mapped[str] = mapped_column(String(80), index=True)
    label: Mapped[str] = mapped_column(String(180))
    instruction: Mapped[str] = mapped_column(Text, default="")
    example_path: Mapped[str] = mapped_column(String(500), default="")
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    category: Mapped[str] = mapped_column(String(40), default="other")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class AQLRule(Base):
    __tablename__ = "aql_rules"
    id: Mapped[int] = mapped_column(primary_key=True)
    standard: Mapped[str] = mapped_column(String(100), default="ANSI/ASQ Z1.4")
    version: Mapped[str] = mapped_column(String(50), default="company-authorized")
    inspection_level: Mapped[str] = mapped_column(String(20), default="II")
    lot_min: Mapped[int] = mapped_column(Integer)
    lot_max: Mapped[int] = mapped_column(Integer)
    sample_size: Mapped[int] = mapped_column(Integer)
    severity: Mapped[str] = mapped_column(String(20))
    aql: Mapped[float] = mapped_column(Float)
    accept: Mapped[int] = mapped_column(Integer)
    reject: Mapped[int] = mapped_column(Integer)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Report(Base):
    __tablename__ = "reports"
    __table_args__ = (UniqueConstraint("report_no", "revision", name="uq_reports_number_revision"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    report_no: Mapped[str] = mapped_column(String(100), index=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("reports.id"), nullable=True)
    po_id: Mapped[int] = mapped_column(ForeignKey("purchase_orders.id"))
    inspector_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    product_snapshot: Mapped[str] = mapped_column(Text)
    packing_snapshot: Mapped[str] = mapped_column(Text)
    inspection_date: Mapped[date] = mapped_column(Date, default=date.today)
    inspection_status: Mapped[str] = mapped_column(String(40), default="Final 1st")
    inspection_level: Mapped[str] = mapped_column(String(20), default="II")
    completed_pct: Mapped[int] = mapped_column(Integer, default=100)
    sample_size: Mapped[int] = mapped_column(Integer, default=0)
    inspected_qty: Mapped[int] = mapped_column(Integer, default=0)
    critical_count: Mapped[int] = mapped_column(Integer, default=0)
    major_count: Mapped[int] = mapped_column(Integer, default=0)
    minor_count: Mapped[int] = mapped_column(Integer, default=0)
    critical_aql: Mapped[float] = mapped_column(Float, default=0)
    major_aql: Mapped[float] = mapped_column(Float, default=1.0)
    minor_aql: Mapped[float] = mapped_column(Float, default=4.0)
    result: Mapped[str] = mapped_column(String(20), default="ON HOLD")
    result_reason: Mapped[str] = mapped_column(Text, default="")
    manual_hold: Mapped[bool] = mapped_column(Boolean, default=False)
    hold_reason: Mapped[str] = mapped_column(Text, default="")
    master_carton_dimension: Mapped[str] = mapped_column(String(120), default="")
    master_carton_nw: Mapped[float | None] = mapped_column(Float, nullable=True)
    master_carton_gw: Mapped[float | None] = mapped_column(Float, nullable=True)
    outer_carton_barcode: Mapped[str] = mapped_column(String(160), default="")
    remarks: Mapped[str] = mapped_column(Text, default="")
    signature_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    signed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    signature_checksum: Mapped[str] = mapped_column(String(64), default="")
    signed_data_checksum: Mapped[str] = mapped_column(String(64), default="")
    finalized: Mapped[bool] = mapped_column(Boolean, default=False)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


class Defect(Base):
    __tablename__ = "defects"
    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("reports.id", ondelete="CASCADE"), index=True)
    severity: Mapped[str] = mapped_column(String(20))
    description: Mapped[str] = mapped_column(String(255))
    quantity: Mapped[int] = mapped_column(Integer, default=1)


class TestResult(Base):
    __tablename__ = "test_results"
    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("reports.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    standard: Mapped[str] = mapped_column(String(160), default="")
    result: Mapped[str] = mapped_column(String(40), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class TestTemplate(Base):
    __tablename__ = "test_templates"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), unique=True)
    standard: Mapped[str] = mapped_column(String(160), default="")
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class DefectCategory(Base):
    __tablename__ = "defect_categories"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), unique=True)
    default_severity: Mapped[str] = mapped_column(String(20), default="minor")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Photo(Base):
    __tablename__ = "photos"
    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("reports.id", ondelete="CASCADE"), index=True)
    category: Mapped[str] = mapped_column(String(40))
    caption: Mapped[str] = mapped_column(String(255), default="")
    file_path: Mapped[str] = mapped_column(String(500))
    original_name: Mapped[str] = mapped_column(String(255), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    checksum: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


class PhotoEvidence(Base):
    __tablename__ = "photo_evidence"
    id: Mapped[int] = mapped_column(primary_key=True)
    photo_id: Mapped[int] = mapped_column(ForeignKey("photos.id", ondelete="CASCADE"), unique=True, index=True)
    slot_id: Mapped[int] = mapped_column(ForeignKey("report_photo_slots.id", ondelete="CASCADE"), index=True)
    original_path: Mapped[str] = mapped_column(String(500))
    processed_path: Mapped[str] = mapped_column(String(500))
    original_checksum: Mapped[str] = mapped_column(String(64))
    processed_checksum: Mapped[str] = mapped_column(String(64))
    upload_source: Mapped[str] = mapped_column(String(20), default="gallery")
    sample_ids: Mapped[str] = mapped_column(Text, default="")
    defect_group: Mapped[str] = mapped_column(String(120), default="")
    quality_status: Mapped[str] = mapped_column(String(40), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


class AIAnalysisRun(Base):
    __tablename__ = "ai_analysis_runs"
    __table_args__ = (
        Index(
            "uq_ai_analysis_active_report",
            "report_id",
            unique=True,
            sqlite_where=text("status IN ('queued','processing','retrying')"),
            postgresql_where=text("status IN ('queued','processing','retrying')"),
        ),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("reports.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(40), default="queued", index=True)
    model: Mapped[str] = mapped_column(String(120), default="")
    prompt_version: Mapped[str] = mapped_column(String(40), default="")
    schema_version: Mapped[str] = mapped_column(String(40), default="")
    request_id: Mapped[str] = mapped_column(String(160), default="")
    raw_result: Mapped[str] = mapped_column(Text, default="")
    input_manifest: Mapped[str] = mapped_column(Text, default="[]")
    input_manifest_checksum: Mapped[str] = mapped_column(String(64), default="")
    error_message: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AIObservation(Base):
    __tablename__ = "ai_observations"
    id: Mapped[int] = mapped_column(primary_key=True)
    analysis_run_id: Mapped[int] = mapped_column(ForeignKey("ai_analysis_runs.id", ondelete="CASCADE"), index=True)
    photo_id: Mapped[int | None] = mapped_column(ForeignKey("photos.id", ondelete="SET NULL"), nullable=True)
    slot_key: Mapped[str] = mapped_column(String(80), default="")
    clarity_status: Mapped[str] = mapped_column(String(40), default="unknown")
    ocr_text: Mapped[str] = mapped_column(Text, default="")
    barcode: Mapped[str] = mapped_column(Text, default="")
    date_code: Mapped[str] = mapped_column(Text, default="")
    consistency: Mapped[str] = mapped_column(Text, default="not_checked")
    visible_state: Mapped[str] = mapped_column(Text, default="")
    requires_retake: Mapped[bool] = mapped_column(Boolean, default=False)
    reason: Mapped[str] = mapped_column(Text, default="")


class AIFinding(Base):
    __tablename__ = "ai_findings"
    id: Mapped[int] = mapped_column(primary_key=True)
    analysis_run_id: Mapped[int] = mapped_column(ForeignKey("ai_analysis_runs.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(180))
    description_en: Mapped[str] = mapped_column(String(255))
    suggested_severity: Mapped[str] = mapped_column(String(20), default="minor")
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    evidence_photo_ids: Mapped[str] = mapped_column(Text, default="[]")
    duplicate_group: Mapped[str] = mapped_column(String(120), default="")
    reason: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    confirmed_defect_id: Mapped[int | None] = mapped_column(ForeignKey("defects.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


class QCDecision(Base):
    __tablename__ = "qc_decisions"
    id: Mapped[int] = mapped_column(primary_key=True)
    finding_id: Mapped[int] = mapped_column(ForeignKey("ai_findings.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(20))
    before_json: Mapped[str] = mapped_column(Text, default="{}")
    after_json: Mapped[str] = mapped_column(Text, default="{}")
    affected_quantity: Mapped[int] = mapped_column(Integer, default=0)
    sample_ids: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


class ReportVersion(Base):
    __tablename__ = "report_versions"
    __table_args__ = (UniqueConstraint("report_id", "template", "language", name="uq_report_versions_output"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("reports.id"), index=True)
    template: Mapped[str] = mapped_column(String(20))
    language: Mapped[str] = mapped_column(String(20))
    file_path: Mapped[str] = mapped_column(String(500), unique=True)
    checksum: Mapped[str] = mapped_column(String(64))
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    signed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    signature_checksum: Mapped[str] = mapped_column(String(64), default="")
    data_checksum: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(100))
    entity_type: Mapped[str] = mapped_column(String(60))
    entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    detail: Mapped[str] = mapped_column(Text, default="")
    ip_address: Mapped[str] = mapped_column(String(80), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))


def json_load(value: str) -> dict:
    try:
        return json.loads(value or "{}")
    except json.JSONDecodeError:
        return {}


def json_list(value: str) -> list:
    try:
        parsed = json.loads(value or "[]")
        return parsed if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        return []


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_checksum(value) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def verified_storage_file(storage_root: str | Path, file_path: str | Path, expected_checksum: str = "") -> Path:
    root = Path(storage_root).resolve()
    path = Path(file_path).resolve(strict=True)
    if path != root and root not in path.parents:
        raise ValueError("Stored file is outside the configured storage root")
    if not path.is_file():
        raise ValueError("Stored file is missing")
    if expected_checksum and file_sha256(path) != expected_checksum:
        raise ValueError("Stored file checksum mismatch")
    return path


def photo_manifest(db, report_id: int) -> list[dict]:
    rows = db.execute(
        select(Photo, PhotoEvidence)
        .join(PhotoEvidence, PhotoEvidence.photo_id == Photo.id)
        .where(Photo.report_id == report_id)
        .order_by(Photo.id)
    ).all()
    return [
        {
            "photo_id": photo.id,
            "slot_id": evidence.slot_id,
            "category": photo.category,
            "sort_order": photo.sort_order,
            "processed_checksum": evidence.processed_checksum,
            "original_checksum": evidence.original_checksum,
            "sample_ids": evidence.sample_ids,
            "defect_group": evidence.defect_group,
        }
        for photo, evidence in rows
    ]


def current_photo_manifest_checksum(db, report_id: int) -> str:
    return canonical_checksum(photo_manifest(db, report_id))


def latest_ai_run(db, report_id: int) -> AIAnalysisRun | None:
    return db.scalar(select(AIAnalysisRun).where(AIAnalysisRun.report_id == report_id).order_by(AIAnalysisRun.id.desc()))


def active_ai_run(db, report_id: int) -> AIAnalysisRun | None:
    return db.scalar(
        select(AIAnalysisRun)
        .where(AIAnalysisRun.report_id == report_id, AIAnalysisRun.status.in_(["queued", "processing", "retrying"]))
        .order_by(AIAnalysisRun.id.desc())
    )


def analysis_run_is_current(db, run: AIAnalysisRun | None) -> bool:
    return bool(
        run
        and run.status == "completed"
        and run.input_manifest_checksum
        and run.input_manifest_checksum == current_photo_manifest_checksum(db, run.report_id)
    )


def invalidate_signature(report: Report) -> bool:
    had_signature = bool(report.signature_path or report.signed_at or report.signed_by_id)
    report.signature_path = None
    report.signed_at = None
    report.signed_by_id = None
    report.signature_checksum = ""
    report.signed_data_checksum = ""
    return had_signature


def invalidate_ai_outputs(db, report: Report, reason: str) -> int:
    runs = list(db.scalars(select(AIAnalysisRun).where(AIAnalysisRun.report_id == report.id)).all())
    run_ids = [run.id for run in runs]
    if not run_ids:
        return 0
    findings = list(db.scalars(select(AIFinding).where(AIFinding.analysis_run_id.in_(run_ids))).all())
    removed = 0
    for finding in findings:
        if finding.confirmed_defect_id:
            defect = db.get(Defect, finding.confirmed_defect_id)
            finding.confirmed_defect_id = None
            if defect:
                db.delete(defect)
                removed += 1
        if finding.status in {"pending", "accepted", "edited"}:
            finding.status = "superseded"
    for run in runs:
        if run.status not in {"queued", "processing", "retrying"}:
            run.status = "stale"
            run.error_message = reason[:2000]
    db.flush()
    return removed


def report_data_checksum(db, report: Report) -> str:
    report_fields = {
        name: getattr(report, name)
        for name in (
            "report_no", "revision", "po_id", "inspector_id", "product_snapshot", "packing_snapshot",
            "inspection_date", "inspection_status", "inspection_level", "completed_pct", "sample_size",
            "inspected_qty", "critical_count", "major_count", "minor_count", "critical_aql", "major_aql",
            "minor_aql", "result", "result_reason", "manual_hold", "hold_reason", "master_carton_dimension",
            "master_carton_nw", "master_carton_gw", "outer_carton_barcode", "remarks",
        )
    }
    defects = [
        {"id": item.id, "severity": item.severity, "description": item.description, "quantity": item.quantity}
        for item in db.scalars(select(Defect).where(Defect.report_id == report.id).order_by(Defect.id))
    ]
    tests = [
        {"id": item.id, "name": item.name, "standard": item.standard, "result": item.result}
        for item in db.scalars(select(TestResult).where(TestResult.report_id == report.id).order_by(TestResult.id))
    ]
    run = latest_ai_run(db, report.id)
    ai_payload: dict = {}
    if run:
        findings = list(db.scalars(select(AIFinding).where(AIFinding.analysis_run_id == run.id).order_by(AIFinding.id)).all())
        finding_ids = [item.id for item in findings]
        decisions = list(
            db.scalars(select(QCDecision).where(QCDecision.finding_id.in_(finding_ids)).order_by(QCDecision.id)).all()
        ) if finding_ids else []
        ai_payload = {
            "run_id": run.id,
            "status": run.status,
            "input_manifest_checksum": run.input_manifest_checksum,
            "response_checksum": canonical_checksum(run.raw_result),
            "findings": [
                {"id": item.id, "status": item.status, "confirmed_defect_id": item.confirmed_defect_id}
                for item in findings
            ],
            "decisions": [
                {"id": item.id, "finding_id": item.finding_id, "action": item.action, "before": item.before_json, "after": item.after_json}
                for item in decisions
            ],
        }
    return canonical_checksum({"report": report_fields, "defects": defects, "tests": tests, "photos": photo_manifest(db, report.id), "ai": ai_payload})


def utcnow() -> datetime:
    return datetime.now(UTC)


def create_app(test_config: dict | None = None) -> Flask:
    app = Flask(__name__)
    root = Path(__file__).resolve().parent
    app.config.update(
        SECRET_KEY=os.getenv("SECRET_KEY", "dev-change-this-secret"),        DATABASE_URL=os.getenv("DATABASE_URL", f"sqlite:///{(root / 'data' / 'qc.db').as_posix()}"),
        STORAGE_ROOT=os.getenv("STORAGE_ROOT", str(root / "storage")),
        MAX_CONTENT_LENGTH=int(os.getenv("MAX_UPLOAD_MB", "64")) * 1024 * 1024,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.getenv("COOKIE_SECURE", "false").lower() == "true",
        SESSION_COOKIE_PATH=os.getenv("SESSION_COOKIE_PATH", "/"),
        PROXY_PREFIX=os.getenv("PROXY_PREFIX", ""),
        AUTO_CREATE_SCHEMA=os.getenv("AUTO_CREATE_SCHEMA", "true").lower() == "true",
        SEED_DATABASE=os.getenv("SEED_DATABASE", "true").lower() == "true",
        SEED_SAMPLE_DATA=os.getenv("SEED_SAMPLE_DATA", "false").lower() == "true",
        TESTING=False,
    )
    if test_config:
        app.config.update(test_config)
    if app.config["TESTING"] and "SEED_SAMPLE_DATA" not in (test_config or {}):
        app.config["SEED_SAMPLE_DATA"] = True
    # 非测试环境必须使用显式配置的 SECRET_KEY，禁止带已知默认密钥运行
    if app.config["SECRET_KEY"] == "dev-change-this-secret" and not app.config["TESTING"]:
        raise RuntimeError("SECRET_KEY 未配置，拒绝启动（请通过环境变量设置）")

    if app.config["PROXY_PREFIX"]:
        app.wsgi_app = TrustedPrefixMiddleware(app.wsgi_app, app.config["PROXY_PREFIX"])

    Path(app.config["STORAGE_ROOT"]).mkdir(parents=True, exist_ok=True)
    db_url = app.config["DATABASE_URL"]
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)
    if db_url.startswith("sqlite:///") and db_url != "sqlite:///:memory:":
        Path(db_url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
    connect_args = {"check_same_thread": False, "timeout": 30} if db_url.startswith("sqlite") else {}
    engine = create_engine(db_url, future=True, pool_pre_ping=True, connect_args=connect_args)
    if db_url.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def configure_sqlite(connection, _record):
            cursor = connection.cursor()
            try:
                cursor.execute("PRAGMA journal_mode=WAL")
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.execute("PRAGMA busy_timeout=30000")
            finally:
                cursor.close()
    app.extensions["db_engine"] = engine
    app.extensions["db_session"] = scoped_session(sessionmaker(bind=engine, autoflush=False, expire_on_commit=False))
    if app.config["AUTO_CREATE_SCHEMA"]:
        Base.metadata.create_all(engine)

    @app.before_request
    def open_db_and_protect():
        g.db = app.extensions["db_session"]()
        if "csrf_token" not in session:
            session["csrf_token"] = secrets.token_urlsafe(24)
        if request.method in {"POST", "PUT", "PATCH", "DELETE"} and request.endpoint != "static":
            supplied = request.headers.get("X-CSRF-Token") or request.form.get("csrf_token")
            if supplied != session.get("csrf_token"):
                abort(400, "CSRF token invalid")

    @app.teardown_request
    def close_db(error=None):
        db = getattr(g, "db", None)
        if db is not None:
            if error:
                db.rollback()
            db.close()
        app.extensions["db_session"].remove()

    @app.context_processor
    def template_helpers():
        return {
            "csrf_token": lambda: session.get("csrf_token", ""),
            "current_user": current_user,
            "photo_categories": PHOTO_CATEGORIES,
            "json_load": json_load,
            "json_list": json_list,
        }

    register_routes(app)
    if app.config["SEED_DATABASE"]:
        with app.app_context():
            seed_database(
                app.extensions["db_session"](),
                include_sample_data=app.config["SEED_SAMPLE_DATA"],
            )
    return app


def current_user() -> User | None:
    user_id = session.get("user_id")
    if not user_id or not hasattr(g, "db"):
        return None
    return g.db.get(User, user_id)


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not current_user():
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = current_user()
        if not user:
            return redirect(url_for("login"))
        if user.role != "admin":
            abort(403)
        return view(*args, **kwargs)

    return wrapped


def audit(db, action: str, entity_type: str, entity_id: int | None, detail: str = ""):
    user = current_user()
    db.add(
        AuditLog(
            user_id=user.id if user else None,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            detail=detail,
            ip_address=request.headers.get("X-Forwarded-For", request.remote_addr or "")[:80],
        )
    )


def setting(db, key: str, default: str = "") -> str:
    item = db.get(Setting, key)
    return item.value if item else default


def po_snapshot(db, po: PurchaseOrder) -> tuple[dict, dict]:
    customer = db.get(Customer, po.customer_id)
    product = db.get(Product, po.product_id)
    product_data = {
        "po_no": po.po_no,
        "po_quantity": po.quantity,
        "customer_name": customer.name,
        "country": customer.country,
        "item_no": product.item_no,
        "description": product.description,
        "size_mm": product.size_mm,
        "net_weight_kg": product.net_weight_kg,
        "gross_weight_kg": product.gross_weight_kg,
        "barcode": product.barcode,
        "age_grade": product.age_grade,
        "origin": product.origin,
        "date_code": po.date_code,
    }
    packing = {
        "carton_count": po.carton_count,
        "case_pack": po.case_pack,
        "assortment_ratio": "SINGLE",
        "individual_packaging": "Open Box",
        "marks": ["Instruction Sheet", "CE Marks", "Name & Address", "WEEE"],
    }
    return product_data, packing


def find_aql_rules(db, report: Report) -> dict[str, AQLRule]:
    snapshot = json_load(report.product_snapshot)
    lot = int(snapshot.get("po_quantity") or 0)
    wanted = {
        "critical": report.critical_aql,
        "major": report.major_aql,
        "minor": report.minor_aql,
    }
    found: dict[str, AQLRule] = {}
    for severity, aql in wanted.items():
        rule = db.scalar(
            select(AQLRule)
            .where(
                AQLRule.active.is_(True),
                AQLRule.inspection_level == report.inspection_level,
                AQLRule.severity == severity,
                AQLRule.aql == float(aql),
                AQLRule.lot_min <= lot,
                AQLRule.lot_max >= lot,
            )
            .order_by(AQLRule.id.desc())
        )
        if rule:
            found[severity] = rule
    return found


def evaluate_report(db, report: Report) -> tuple[str, str, dict]:
    rules = find_aql_rules(db, report)
    counts = {
        "critical": report.critical_count,
        "major": report.major_count,
        "minor": report.minor_count,
    }
    detail = {
        severity: {
            "count": counts[severity],
            "aql": getattr(report, f"{severity}_aql"),
            "accept": rules[severity].accept if severity in rules else None,
            "reject": rules[severity].reject if severity in rules else None,
        }
        for severity in counts
    }
    rejected = [name for name, count in counts.items() if name in rules and count >= rules[name].reject]
    if rejected:
        return "REJECT", "Reject threshold reached: " + ", ".join(rejected), detail

    required_tests = json_load(report.packing_snapshot).get("required_tests", [])
    completed_tests = {
        item.name: (item.result or "").strip().upper()
        for item in db.scalars(select(TestResult).where(TestResult.report_id == report.id))
    }
    failed_tests = [name for name in required_tests if completed_tests.get(name) == "FAIL"]
    if failed_tests:
        return "REJECT", "Required performance test failed: " + ", ".join(failed_tests), detail

    missing: list[str] = []
    snapshot = json_load(report.product_snapshot)
    for key in ("po_no", "item_no", "customer_name", "po_quantity"):
        if not snapshot.get(key):
            missing.append(key)
    if not report.inspection_date:
        missing.append("inspection_date")
    if len(rules) != 3:
        missing.append("AQL rule")
    expected_sample = max((r.sample_size for r in rules.values()), default=report.sample_size)
    if expected_sample and report.inspected_qty < expected_sample:
        missing.append(f"inspected_qty<{expected_sample}")
    photo_slots = list(db.scalars(select(ReportPhotoSlot).where(ReportPhotoSlot.report_id == report.id)).all())
    if photo_slots:
        populated_slots = set(
            db.scalars(
                select(PhotoEvidence.slot_id)
                .join(Photo, Photo.id == PhotoEvidence.photo_id)
                .where(Photo.report_id == report.id)
            ).all()
        )
        for slot in photo_slots:
            if slot.required and slot.id not in populated_slots:
                missing.append("photo-slot:" + slot.slot_key)
    else:
        required = [x for x in setting(db, "required_photo_categories", "product,packaging,warehouse").split(",") if x]
        present = set(db.scalars(select(Photo.category).where(Photo.report_id == report.id)).all())
        for category in required:
            if category not in present:
                missing.append("photo:" + category)
    for test_name in required_tests:
        if completed_tests.get(test_name) != "PASS":
            missing.append("test:" + test_name)

    source = db.scalar(select(ReportSource).where(ReportSource.report_id == report.id))
    if source:
        run = latest_ai_run(db, report.id)
        if not run or run.status != "completed":
            missing.append("AI analysis" if not run else f"AI analysis:{run.status}")
        elif not analysis_run_is_current(db, run):
            missing.append("AI analysis:stale evidence")
        else:
            pending = db.scalar(
                select(func.count())
                .select_from(AIFinding)
                .where(AIFinding.analysis_run_id == run.id, AIFinding.status == "pending")
            ) or 0
            if pending:
                missing.append(f"AI findings pending:{pending}")
            retakes = db.scalar(
                select(func.count())
                .select_from(AIObservation)
                .where(AIObservation.analysis_run_id == run.id, AIObservation.requires_retake.is_(True))
            ) or 0
            if retakes:
                missing.append(f"photos require retake:{retakes}")
            mismatch_photo_ids: set[int] = set()
            for observation in db.scalars(select(AIObservation).where(AIObservation.analysis_run_id == run.id)):
                comparisons = json_list(observation.consistency)
                if observation.photo_id and any(item.get("status") == "mismatch" for item in comparisons if isinstance(item, dict)):
                    mismatch_photo_ids.add(observation.photo_id)
            reviewed_photo_ids: set[int] = set()
            for finding in db.scalars(select(AIFinding).where(AIFinding.analysis_run_id == run.id, AIFinding.status.in_(["accepted", "edited", "rejected"]))):
                evidence_ids = json_list(finding.evidence_photo_ids)
                for photo_id in evidence_ids:
                    try:
                        reviewed_photo_ids.add(int(photo_id))
                    except (TypeError, ValueError):
                        continue
            unresolved_mismatches = mismatch_photo_ids - reviewed_photo_ids
            if unresolved_mismatches:
                missing.append(f"PO mismatches pending:{len(unresolved_mismatches)}")
    if report.manual_hold:
        if not report.hold_reason.strip():
            missing.append("hold_reason")
        return "ON HOLD", report.hold_reason.strip() or "Manual hold reason required", detail
    undecided = [name for name, count in counts.items() if name in rules and count > rules[name].accept]
    if undecided:
        missing.append("between Ac/Re: " + ", ".join(undecided))
    if missing:
        return "ON HOLD", "Missing/incomplete: " + ", ".join(missing), detail
    return "PASS", "All defect counts are within acceptance limits", detail


def sync_counts_from_defects(db, report: Report):
    sums = dict(
        db.execute(
            select(Defect.severity, func.sum(Defect.quantity))
            .where(Defect.report_id == report.id)
            .group_by(Defect.severity)
        ).all()
    )
    report.critical_count = int(sums.get("critical") or 0)
    report.major_count = int(sums.get("major") or 0)
    report.minor_count = int(sums.get("minor") or 0)


def refresh_result(db, report: Report):
    sync_counts_from_defects(db, report)
    result, reason, _ = evaluate_report(db, report)
    report.result = result
    report.result_reason = reason
    report.updated_at = utcnow()


def process_uploaded_image(upload, destination: Path) -> tuple[str, str]:
    if not upload or not upload.filename:
        raise ValueError("No image selected")
    raw = upload.read()
    if len(raw) > 18 * 1024 * 1024:
        raise ValueError("Image exceeds 18 MB")
    try:
        image = Image.open(io.BytesIO(raw))
        image.verify()
        image = Image.open(io.BytesIO(raw))
        if image.width * image.height > 40_000_000:
            raise ValueError("Image dimensions exceed the 40 megapixel limit")
        image = ImageOps.exif_transpose(image).convert("RGB")
    except Exception as exc:
        raise ValueError("Unsupported or invalid image") from exc
    image.thumbnail((2200, 2200), Image.Resampling.LANCZOS)
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, "JPEG", quality=86, optimize=True)
    return destination.name, file_sha256(destination)


def store_evidence_image(raw: bytes, original_name: str, original_destination: Path, processed_destination: Path) -> tuple[str, str]:
    if not raw:
        raise ValueError("Empty image")
    if len(raw) > 18 * 1024 * 1024:
        raise ValueError("Image exceeds 18 MB")
    try:
        image = Image.open(io.BytesIO(raw))
        image.verify()
        image = Image.open(io.BytesIO(raw))
        if image.width * image.height > 40_000_000:
            raise ValueError("Image dimensions exceed the 40 megapixel limit")
        image = ImageOps.exif_transpose(image).convert("RGB")
    except Exception as exc:
        raise ValueError("Unsupported or invalid image") from exc
    original_destination.parent.mkdir(parents=True, exist_ok=True)
    processed_destination.parent.mkdir(parents=True, exist_ok=True)
    original_destination.write_bytes(raw)
    image.thumbnail((2400, 2400), Image.Resampling.LANCZOS)
    image.save(processed_destination, "JPEG", quality=88, optimize=True, exif=b"")
    return file_sha256(original_destination), file_sha256(processed_destination)


def _json_value(value) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float, bool)):
        return str(value)
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def validate_po_upload_signature(raw: bytes, suffix: str) -> None:
    valid = {
        ".pdf": raw.startswith(b"%PDF-") or b"%PDF-" in raw[:1024],
        ".png": raw.startswith(b"\x89PNG\r\n\x1a\n"),
        ".jpg": raw.startswith(b"\xff\xd8\xff"),
        ".jpeg": raw.startswith(b"\xff\xd8\xff"),
        ".xlsx": raw.startswith(b"PK\x03\x04"),
        ".xls": raw.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"),
    }.get(suffix, False)
    if not valid:
        raise ValueError("PO file content does not match its extension")


def _source_value(source) -> str:
    if not isinstance(source, dict):
        return ""
    cleaned = {key: value for key, value in source.items() if value is not None and value != "" and value != []}
    return json.dumps(cleaned, ensure_ascii=False, sort_keys=True)


def _safe_int(value, default: int = 0) -> int:
    if value is None or value == "":
        return default
    try:
        return int(float(str(value).replace(",", "").split()[0]))
    except (TypeError, ValueError):
        digits = "".join(char for char in str(value) if char.isdigit())
        return int(digits) if digits else default


def _safe_float(value):
    if value is None or value == "":
        return None
    cleaned = "".join(char for char in str(value).replace(",", ".") if char.isdigit() or char in ".-")
    try:
        return float(cleaned)
    except (TypeError, ValueError):
        return None


def _new_session(application: Flask):
    return sessionmaker(bind=application.extensions["db_engine"], autoflush=False, expire_on_commit=False)()


def _job_audit(db, user_id: int | None, action: str, entity_type: str, entity_id: int | None, detail: str = ""):
    db.add(AuditLog(user_id=user_id, action=action, entity_type=entity_type, entity_id=entity_id, detail=detail, ip_address="worker"))


def process_po_import_job(import_id: int, application: Flask | None = None):
    """RQ/local job: extract a PO and persist field-level evidence for QC review."""

    queued_execution = application is None
    application = application or globals()["app"]
    db = _new_session(application)
    po_import = None
    try:
        po_import = db.get(POImport, import_id)
        if not po_import:
            return {"status": "missing", "id": import_id}
        po_import.status = "processing"
        po_import.error_message = ""
        db.commit()

        from ai_service import AIService

        source_path = verified_storage_file(application.config["STORAGE_ROOT"], po_import.file_path, po_import.checksum)
        result = AIService().extract_po(source_path, filename=po_import.original_name, mime_type=po_import.mime_type)
        payload = result.data
        metadata = result.metadata

        old_items = list(db.scalars(select(POItem).where(POItem.po_import_id == po_import.id)).all())
        if old_items:
            old_ids = [item.id for item in old_items]
            db.query(ExtractedField).filter(ExtractedField.po_item_id.in_(old_ids)).delete(synchronize_session=False)
            db.query(POItem).filter(POItem.id.in_(old_ids)).delete(synchronize_session=False)

        document_fields = payload.get("document_fields") or {}
        extracted_items = payload.get("items") or []
        if not extracted_items:
            po_import.status = "needs_review"
            po_import.error_message = "未能从 PO 中识别货号，请人工检查文件或重新上传更清晰的资料。"
        for item_index, item_data in enumerate(extracted_items):
            po_item = POItem(po_import_id=po_import.id, item_index=item_index, review_status="needs_review")
            db.add(po_item)
            db.flush()
            item_fields = item_data.get("fields") or {}
            for field_key, _label, scope, ai_key, _required in PO_FIELD_DEFINITIONS:
                evidence = (document_fields if scope == "document" else item_fields).get(ai_key) or {}
                raw_value = _json_value(evidence.get("raw_value"))
                normalized_value = _json_value(evidence.get("normalized_value"))
                db.add(
                    ExtractedField(
                        po_item_id=po_item.id,
                        field_key=field_key,
                        raw_value=raw_value,
                        normalized_value=normalized_value,
                        confidence=float(evidence.get("confidence") or 0),
                        source_ref=_source_value(evidence.get("source")),
                        confirmed=False,
                    )
                )

        po_import.model = metadata.model
        po_import.prompt_version = metadata.prompt_version
        po_import.schema_version = metadata.schema_version
        po_import.request_id = metadata.request_id or metadata.response_id
        po_import.raw_result = json.dumps(result.to_dict(), ensure_ascii=False, sort_keys=True)
        po_import.status = "needs_review"
        po_import.completed_at = utcnow()
        _job_audit(db, po_import.created_by, "po_extract_complete", "po_import", po_import.id, f"items:{len(extracted_items)}")
        db.commit()
        return {"status": po_import.status, "id": po_import.id, "items": len(extracted_items)}
    except Exception as exc:
        db.rollback()
        po_import = db.get(POImport, import_id)
        if po_import:
            will_retry = False
            if queued_execution:
                try:
                    from rq import get_current_job

                    job = get_current_job()
                    will_retry = bool(job and (getattr(job, "retries_left", 0) or 0) > 0)
                except Exception:
                    will_retry = False
            po_import.status = "retrying" if will_retry else "failed"
            po_import.error_message = str(exc)[:2000]
            po_import.completed_at = None if will_retry else utcnow()
            _job_audit(db, po_import.created_by, "po_extract_retrying" if will_retry else "po_extract_failed", "po_import", po_import.id, str(exc)[:500])
            db.commit()
        if queued_execution:
            raise
        return {"status": "failed", "id": import_id, "error": str(exc)}
    finally:
        db.close()


def _select_photo_templates(db, customer_id: int | None, product_id: int | None) -> list[PhotoChecklistTemplate]:
    candidates = list(
        db.scalars(
            select(PhotoChecklistTemplate)
            .where(PhotoChecklistTemplate.active.is_(True))
            .order_by(PhotoChecklistTemplate.sort_order, PhotoChecklistTemplate.id)
        ).all()
    )
    chosen: dict[str, tuple[int, PhotoChecklistTemplate]] = {}
    for item in candidates:
        if item.product_id is not None and item.product_id == product_id:
            priority = 3
        elif item.product_id is None and item.customer_id is not None and item.customer_id == customer_id:
            priority = 2
        elif item.product_id is None and item.customer_id is None:
            priority = 1
        else:
            continue
        current = chosen.get(item.slot_key)
        if not current or priority > current[0]:
            chosen[item.slot_key] = (priority, item)
    return sorted((value[1] for value in chosen.values()), key=lambda x: (x.sort_order, x.id))


def instantiate_photo_slots(db, report: Report, customer_id: int | None, product_id: int | None):
    if db.scalar(select(func.count()).select_from(ReportPhotoSlot).where(ReportPhotoSlot.report_id == report.id)):
        return
    for template in _select_photo_templates(db, customer_id, product_id):
        db.add(
            ReportPhotoSlot(
                report_id=report.id,
                template_slot_id=template.id,
                slot_key=template.slot_key,
                label=template.label,
                instruction=template.instruction,
                example_path=template.example_path,
                required=template.required,
                category=template.category,
                sort_order=template.sort_order,
            )
        )


def _field_map(db, po_item_id: int) -> dict[str, ExtractedField]:
    return {item.field_key: item for item in db.scalars(select(ExtractedField).where(ExtractedField.po_item_id == po_item_id)).all()}


def create_report_from_po_item(db, po_item: POItem, inspector: User) -> Report:
    fields = _field_map(db, po_item.id)
    required_keys = {key for key, _label, _scope, _ai, required in PO_FIELD_DEFINITIONS if required}
    missing = [key for key in required_keys if not fields.get(key) or not fields[key].normalized_value.strip() or not fields[key].confirmed]
    if missing:
        raise ValueError("请先确认必填字段：" + ", ".join(sorted(missing)))

    value = lambda key, default="": fields[key].normalized_value.strip() if key in fields else default
    customer_name = value("customer_name")
    customer = db.scalar(select(Customer).where(Customer.name == customer_name))
    if not customer:
        customer = Customer(name=customer_name, country=value("country"), address="")
        db.add(customer)
        db.flush()

    item_no = value("item_no")
    product = db.scalar(select(Product).where(Product.item_no == item_no))
    if not product:
        product = Product(
            item_no=item_no,
            description=value("description"),
            size_mm=value("size_mm"),
            net_weight_kg=_safe_float(value("net_weight_kg")),
            gross_weight_kg=_safe_float(value("gross_weight_kg")),
            barcode=value("barcode"),
            age_grade=value("age_grade"),
            origin=value("origin"),
        )
        db.add(product)
        db.flush()

    actual_po_no = value("po_no")
    internal_po_no = actual_po_no
    existing_po = db.scalar(select(PurchaseOrder).where(PurchaseOrder.po_no == internal_po_no))
    if existing_po and existing_po.product_id != product.id:
        internal_po_no = f"{actual_po_no}-{item_no}"[:100]
        suffix = 2
        while db.scalar(select(PurchaseOrder).where(PurchaseOrder.po_no == internal_po_no)):
            internal_po_no = f"{actual_po_no}-{item_no}-{suffix}"[:100]
            suffix += 1
    po = db.scalar(select(PurchaseOrder).where(PurchaseOrder.po_no == internal_po_no))
    if not po:
        po = PurchaseOrder(
            po_no=internal_po_no,
            customer_id=customer.id,
            product_id=product.id,
            quantity=_safe_int(value("po_quantity")),
            carton_count=_safe_int(value("carton_count")),
            case_pack=_safe_int(value("case_pack")),
            date_code=value("date_code"),
        )
        db.add(po)
        db.flush()

    product_data = {
        "po_no": actual_po_no,
        "po_quantity": _safe_int(value("po_quantity")),
        "customer_name": customer_name,
        "factory_name": value("factory_name"),
        "country": value("country"),
        "item_no": item_no,
        "description": value("description"),
        "size_mm": value("size_mm"),
        "net_weight_kg": value("net_weight_kg"),
        "gross_weight_kg": value("gross_weight_kg"),
        "barcode": value("barcode"),
        "age_grade": value("age_grade"),
        "origin": value("origin"),
        "date_code": value("date_code"),
    }
    test_templates = list(db.scalars(select(TestTemplate).where(TestTemplate.active.is_(True)).order_by(TestTemplate.sort_order, TestTemplate.id)).all())
    packing = {
        "carton_count": _safe_int(value("carton_count")),
        "case_pack": _safe_int(value("case_pack")),
        "assortment_ratio": value("assortment_ratio"),
        "individual_packaging": value("individual_packaging"),
        "master_carton_dimension": value("master_carton_dimension"),
        "master_carton_nw": value("master_carton_nw"),
        "master_carton_gw": value("master_carton_gw"),
        "outer_carton_barcode": value("outer_carton_barcode"),
        "inner_carton_details": value("inner_carton_details"),
        "required_tests": [template.name for template in test_templates if template.required],
    }
    base_report_no = f"QC-{date.today():%Y%m%d}-{actual_po_no}-{item_no}"[:100]
    report_no = base_report_no
    suffix = 2
    while db.scalar(select(func.count()).select_from(Report).where(Report.report_no == report_no)):
        report_no = f"{base_report_no[:94]}-{suffix}"
        suffix += 1
    report = Report(
        report_no=report_no,
        po_id=po.id,
        inspector_id=inspector.id,
        product_snapshot=json.dumps(product_data, ensure_ascii=False),
        packing_snapshot=json.dumps(packing, ensure_ascii=False),
        inspection_date=date.today(),
        master_carton_dimension=value("master_carton_dimension"),
        master_carton_nw=_safe_float(value("master_carton_nw")),
        master_carton_gw=_safe_float(value("master_carton_gw")),
        outer_carton_barcode=value("outer_carton_barcode"),
    )
    db.add(report)
    db.flush()
    db.add(ReportSource(report_id=report.id, po_item_id=po_item.id))
    for index, template in enumerate(test_templates):
        db.add(TestResult(report_id=report.id, name=template.name, standard=template.standard, result="", sort_order=index))
    instantiate_photo_slots(db, report, customer.id, product.id)
    db.flush()
    rules = find_aql_rules(db, report)
    report.sample_size = max((rule.sample_size for rule in rules.values()), default=0)
    refresh_result(db, report)
    po_item.review_status = "report_created"
    return report


def process_analysis_run_job(run_id: int, application: Flask | None = None):
    """RQ/local job: analyze processed evidence images and persist reviewable AI drafts."""

    queued_execution = application is None
    application = application or globals()["app"]
    db = _new_session(application)
    run = None
    try:
        run = db.get(AIAnalysisRun, run_id)
        if not run:
            return {"status": "missing", "id": run_id}
        report = db.get(Report, run.report_id)
        if report.finalized:
            run.status = "cancelled"
            run.error_message = "Report was finalized before analysis started"
            run.completed_at = utcnow()
            db.commit()
            return {"status": "cancelled", "id": run.id}
        if run.input_manifest_checksum != current_photo_manifest_checksum(db, report.id):
            run.status = "stale"
            run.error_message = "Evidence changed before analysis started"
            run.completed_at = utcnow()
            refresh_result(db, report)
            db.commit()
            return {"status": "stale", "id": run.id}
        run.status = "processing"
        run.error_message = ""
        db.commit()

        from ai_service import AIService, PhotoInput

        rows = db.execute(
            select(Photo, PhotoEvidence, ReportPhotoSlot)
            .join(PhotoEvidence, PhotoEvidence.photo_id == Photo.id)
            .join(ReportPhotoSlot, ReportPhotoSlot.id == PhotoEvidence.slot_id)
            .where(Photo.report_id == report.id)
            .order_by(ReportPhotoSlot.sort_order, Photo.sort_order, Photo.id)
        ).all()
        photo_inputs = []
        for photo, evidence, slot in rows:
            verified_storage_file(application.config["STORAGE_ROOT"], evidence.original_path, evidence.original_checksum)
            processed_path = verified_storage_file(application.config["STORAGE_ROOT"], evidence.processed_path, evidence.processed_checksum)
            photo_inputs.append(
                PhotoInput(
                    path=processed_path,
                    photo_id=str(photo.id),
                    slot_key=slot.slot_key,
                    sample_id=evidence.sample_ids or None,
                    group_id=evidence.defect_group or None,
                    caption=photo.caption or None,
                )
            )
        checklist = [
            {"slot_key": slot.slot_key, "label": slot.label, "instruction": slot.instruction, "required": slot.required}
            for slot in db.scalars(select(ReportPhotoSlot).where(ReportPhotoSlot.report_id == report.id).order_by(ReportPhotoSlot.sort_order, ReportPhotoSlot.id))
        ]
        reference = {**json_load(report.product_snapshot), "packing": json_load(report.packing_snapshot)}
        result = AIService().inspect_photos(photo_inputs, po_reference=reference, checklist=checklist)
        metadata = result.metadata

        db.refresh(report)
        db.refresh(run)
        if report.finalized:
            run.status = "cancelled"
            run.error_message = "Report was finalized while analysis was running"
            run.completed_at = utcnow()
            db.commit()
            return {"status": "cancelled", "id": run.id}
        if run.input_manifest_checksum != current_photo_manifest_checksum(db, report.id):
            run.status = "stale"
            run.error_message = "Evidence changed while analysis was running"
            run.completed_at = utcnow()
            refresh_result(db, report)
            db.commit()
            return {"status": "stale", "id": run.id}

        db.query(AIObservation).filter(AIObservation.analysis_run_id == run.id).delete()
        db.query(AIFinding).filter(AIFinding.analysis_run_id == run.id).delete()
        valid_photo_ids = {photo.id for photo, _evidence, _slot in rows}
        for observation in result.data.get("observations") or []:
            try:
                photo_id = int(observation.get("photo_id"))
            except (TypeError, ValueError):
                photo_id = None
            if photo_id not in valid_photo_ids:
                photo_id = None
            db.add(
                AIObservation(
                    analysis_run_id=run.id,
                    photo_id=photo_id,
                    slot_key=str(observation.get("slot_key") or "")[:80],
                    clarity_status=str(observation.get("clarity") or "unknown")[:40],
                    ocr_text=json.dumps(observation.get("ocr_text") or [], ensure_ascii=False),
                    barcode=json.dumps(observation.get("barcodes") or [], ensure_ascii=False),
                    date_code=json.dumps(observation.get("date_codes") or [], ensure_ascii=False),
                    consistency=json.dumps(observation.get("po_comparisons") or [], ensure_ascii=False),
                    visible_state=str(observation.get("visible_condition") or ""),
                    requires_retake=bool(observation.get("needs_retake")),
                    reason=str(observation.get("retake_reason") or "; ".join(observation.get("limitations") or [])),
                )
            )
        for finding in result.data.get("findings") or []:
            db.add(
                AIFinding(
                    analysis_run_id=run.id,
                    name=str(finding.get("title") or "Potential visible defect")[:180],
                    description_en=str(finding.get("report_description_en") or finding.get("title") or "")[:255],
                    suggested_severity=str(finding.get("suggested_severity") or "minor").lower()[:20],
                    confidence=float(finding.get("confidence") or 0),
                    evidence_photo_ids=json.dumps(finding.get("evidence_photo_ids") or []),
                    duplicate_group=str(finding.get("finding_key") or "")[:120],
                    reason=str(finding.get("reason") or finding.get("deduplication_basis") or ""),
                    status="pending",
                )
            )
        run.model = metadata.model
        run.prompt_version = metadata.prompt_version
        run.schema_version = metadata.schema_version
        run.request_id = metadata.request_id or metadata.response_id
        run.raw_result = json.dumps(result.to_dict(), ensure_ascii=False, sort_keys=True)
        run.status = "completed"
        run.completed_at = utcnow()
        db.flush()
        refresh_result(db, report)
        _job_audit(db, run.created_by, "ai_analysis_complete", "ai_analysis_run", run.id, f"findings:{len(result.data.get('findings') or [])}")
        db.commit()
        return {"status": "completed", "id": run.id}
    except Exception as exc:
        db.rollback()
        run = db.get(AIAnalysisRun, run_id)
        if run:
            will_retry = False
            if queued_execution:
                try:
                    from rq import get_current_job

                    job = get_current_job()
                    will_retry = bool(job and (getattr(job, "retries_left", 0) or 0) > 0)
                except Exception:
                    will_retry = False
            run.status = "retrying" if will_retry else "failed"
            run.error_message = str(exc)[:2000]
            run.completed_at = None if will_retry else utcnow()
            report = db.get(Report, run.report_id)
            if report and not report.finalized:
                refresh_result(db, report)
            _job_audit(db, run.created_by, "ai_analysis_retrying" if will_retry else "ai_analysis_failed", "ai_analysis_run", run.id, str(exc)[:500])
            db.commit()
        if queued_execution:
            raise
        return {"status": "failed", "id": run_id, "error": str(exc)}
    finally:
        db.close()


def build_unified_pdf_payload(db, report: Report, company_name: str, report_title: str, logo_path: str | None = None) -> dict:
    snapshot = json_load(report.product_snapshot)
    packing = json_load(report.packing_snapshot)
    rules = find_aql_rules(db, report)
    defects = list(db.scalars(select(Defect).where(Defect.report_id == report.id).order_by(Defect.id)).all())
    tests = list(db.scalars(select(TestResult).where(TestResult.report_id == report.id).order_by(TestResult.sort_order, TestResult.id)).all())
    inspector = db.get(User, report.signed_by_id or report.inspector_id)
    slots = list(db.scalars(select(ReportPhotoSlot).where(ReportPhotoSlot.report_id == report.id).order_by(ReportPhotoSlot.sort_order, ReportPhotoSlot.id)).all())
    photo_slots = []
    for slot in slots:
        rows = db.execute(
            select(Photo, PhotoEvidence)
            .join(PhotoEvidence, PhotoEvidence.photo_id == Photo.id)
            .where(PhotoEvidence.slot_id == slot.id)
            .order_by(Photo.sort_order, Photo.id)
        ).all()
        photo_slots.append(
            {
                "name": slot.slot_key,
                "label": slot.label,
                "order": slot.sort_order,
                "required": slot.required,
                "section": slot.category,
                "photos": [
                    {
                        "file_path": photo.file_path,
                        "caption": photo.caption,
                        "sample_id": evidence.sample_ids,
                        "order": photo.sort_order,
                    }
                    for photo, evidence in rows
                ],
            }
        )
    if not slots:
        legacy_photos = list(db.scalars(select(Photo).where(Photo.report_id == report.id).order_by(Photo.category, Photo.sort_order)).all())
        grouped: dict[str, list[Photo]] = {}
        for photo in legacy_photos:
            grouped.setdefault(photo.category, []).append(photo)
        photo_slots = [{"name": category, "label": PHOTO_CATEGORIES.get(category, category), "order": index, "section": category, "photos": [{"file_path": photo.file_path, "caption": photo.caption, "order": photo.sort_order} for photo in photos]} for index, (category, photos) in enumerate(grouped.items())]
    latest_run = db.scalar(select(AIAnalysisRun).where(AIAnalysisRun.report_id == report.id).order_by(AIAnalysisRun.id.desc()))
    return {
        "report_no": report.report_no,
        "revision": report.revision,
        "company_name": company_name,
        "report_title": report_title,
        "logo_path": logo_path,
        "inspection_date": report.inspection_date.isoformat() if report.inspection_date else "",
        "result": report.result,
        "result_reason": report.result_reason,
        "generated_at": utcnow().isoformat(),
        "overview": {
            "customer": snapshot.get("customer_name", ""),
            "factory": snapshot.get("factory_name", ""),
            "country": snapshot.get("country", ""),
            "po_no": snapshot.get("po_no", ""),
            "item_no": snapshot.get("item_no", ""),
            "description": snapshot.get("description", ""),
            "order_quantity": snapshot.get("po_quantity", ""),
            "sample_size": report.sample_size,
            "inspected_quantity": report.inspected_qty,
            "inspection_level": report.inspection_level,
        },
        "aql": {
            severity: {
                "severity": severity.title(),
                "aql": getattr(report, f"{severity}_aql"),
                "count": getattr(report, f"{severity}_count"),
                "sample_size": rules[severity].sample_size if severity in rules else report.sample_size,
                "accept": rules[severity].accept if severity in rules else "",
                "reject": rules[severity].reject if severity in rules else "",
            }
            for severity in ("critical", "major", "minor")
        },
        "defects": [{"severity": defect.severity.title(), "description": defect.description, "quantity": defect.quantity, "status": "confirmed"} for defect in defects],
        "tests": [{"name": test.name, "standard": test.standard, "result": test.result} for test in tests],
        "product": snapshot,
        "packing": {
            **packing,
            "master_carton": {
                "dimensions": report.master_carton_dimension or packing.get("master_carton_dimension", ""),
                "net_weight": report.master_carton_nw if report.master_carton_nw is not None else packing.get("master_carton_nw", ""),
                "gross_weight": report.master_carton_gw if report.master_carton_gw is not None else packing.get("master_carton_gw", ""),
                "barcode": report.outer_carton_barcode or packing.get("outer_carton_barcode", ""),
                "case_pack": packing.get("case_pack", ""),
                "carton_count": packing.get("carton_count", ""),
            },
            "inner_carton": packing.get("inner_carton_details", ""),
        },
        "remarks": report.remarks,
        "photo_slots": photo_slots,
        "inspector": {
            "name": inspector.name if inspector else "",
            "signed_at": report.signed_at.isoformat() if report.signed_at else "",
            "signature_path": report.signature_path or "",
        },
        "ai_trace": {
            "model": latest_run.model,
            "prompt_version": latest_run.prompt_version,
            "schema_version": latest_run.schema_version,
            "request_id": latest_run.request_id,
        } if latest_run else {},
    }


def register_routes(app: Flask):
    @app.get("/favicon.ico")
    def favicon():
        return "", 204

    @app.get("/health")
    def health():
        queue_required = os.getenv("QUEUE_REQUIRED", "false").lower() == "true"
        checks = {
            "database": False,
            "storage": False,
            "queue": None if not queue_required else False,
            "ai_configured": bool(os.getenv("OPENAI_API_KEY", "").strip()),
        }
        try:
            g.db.execute(text("SELECT 1"))
            checks["database"] = True
        except Exception:
            pass

        probe = Path(app.config["STORAGE_ROOT"]) / f".health-{uuid.uuid4().hex}"
        try:
            probe.write_bytes(b"ok")
            checks["storage"] = True
        except OSError:
            pass
        finally:
            try:
                probe.unlink(missing_ok=True)
            except OSError:
                pass

        if queue_required:
            try:
                from task_queue import get_queue

                checks["queue"] = get_queue(required=True, check_connection=True) is not None
            except Exception:
                checks["queue"] = False

        required_checks = [checks["database"], checks["storage"]]
        if queue_required:
            required_checks.append(checks["queue"])
        healthy = all(required_checks)
        return jsonify(
            status="ok" if healthy else "unhealthy",
            checks=checks,
            time=utcnow().isoformat(),
        ), 200 if healthy else 503

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            username = request.form.get("username", "").strip().lower()
            user = g.db.scalar(select(User).where(User.username == username, User.active.is_(True)))
            if not user or not check_password_hash(user.password_hash, request.form.get("password", "")):
                flash("账号或密码不正确。", "error")
                return render_template("login.html")
            session.clear()
            session["user_id"] = user.id
            session["csrf_token"] = secrets.token_urlsafe(24)
            audit(g.db, "login", "user", user.id)
            g.db.commit()
            # next 只允许站内相对路径，防开放重定向到钓鱼站
            next_url = request.args.get("next") or ""
            if not (next_url.startswith("/") and not next_url.startswith("//")):
                next_url = url_for("new_report")
            return redirect(next_url)
        return render_template("login.html")

    @app.post("/logout")
    @login_required
    def logout():
        session.clear()
        return redirect(url_for("login"))

    @app.get("/")
    @login_required
    def home():
        return redirect(url_for("new_report"))

    @app.get("/reports")
    @login_required
    def dashboard():
        search = request.args.get("q", "").strip()
        status = request.args.get("status", "").strip()
        stmt = select(Report).order_by(Report.updated_at.desc())
        if status:
            stmt = stmt.where(Report.result == status)
        reports = list(g.db.scalars(stmt).all())
        if search:
            needle = search.casefold()
            reports = [
                r
                for r in reports
                if needle in r.report_no.casefold()
                or needle in json_load(r.product_snapshot).get("po_no", "").casefold()
                or needle in json_load(r.product_snapshot).get("item_no", "").casefold()
                or needle in json_load(r.product_snapshot).get("customer_name", "").casefold()
            ]
        totals = {key: g.db.scalar(select(func.count()).select_from(Report).where(Report.result == key)) or 0 for key in ["PASS", "ON HOLD", "REJECT"]}
        return render_template("dashboard.html", reports=reports, totals=totals, search=search, status=status)

    @app.route("/reports/new", methods=["GET", "POST"])
    @login_required
    def new_report():
        if request.method == "POST":
            # Backward-compatible/manual API path used by existing integrations.
            legacy_po_id = request.form.get("po_id", type=int)
            if legacy_po_id:
                po = g.db.get(PurchaseOrder, legacy_po_id)
                if not po:
                    flash("请选择有效的订单。", "error")
                    return redirect(url_for("new_report"))
                product_data, packing = po_snapshot(g.db, po)
                test_templates = list(g.db.scalars(select(TestTemplate).where(TestTemplate.active.is_(True)).order_by(TestTemplate.sort_order, TestTemplate.id)).all())
                packing["required_tests"] = [template.name for template in test_templates if template.required]
                base = f"QC-{date.today():%Y%m%d}-{po.po_no}"
                report_no = base
                suffix_no = 2
                while g.db.scalar(select(func.count()).select_from(Report).where(Report.report_no == report_no)):
                    report_no = f"{base}-{suffix_no}"
                    suffix_no += 1
                report = Report(report_no=report_no, po_id=po.id, inspector_id=current_user().id, product_snapshot=json.dumps(product_data, ensure_ascii=False), packing_snapshot=json.dumps(packing, ensure_ascii=False), inspection_date=date.today(), inspected_qty=0)
                g.db.add(report)
                g.db.flush()
                for index, template in enumerate(test_templates):
                    g.db.add(TestResult(report_id=report.id, name=template.name, standard=template.standard, result="", sort_order=index))
                refresh_result(g.db, report)
                audit(g.db, "create", "report", report.id, report.report_no)
                g.db.commit()
                return redirect(url_for("edit_report", report_id=report.id))
            upload = request.files.get("po_file")
            if not upload or not upload.filename:
                flash("请选择 PDF、Excel 或扫描图片 PO。", "error")
                return redirect(url_for("new_report"))
            suffix = Path(upload.filename).suffix.lower()
            if suffix not in PO_ALLOWED_EXTENSIONS:
                flash("仅支持 PDF、XLS/XLSX、JPG 和 PNG。", "error")
                return redirect(url_for("new_report"))
            raw = upload.read()
            if not raw:
                flash("上传文件为空。", "error")
                return redirect(url_for("new_report"))
            maximum = int(os.getenv("AI_MAX_DOCUMENT_BYTES", str(25 * 1024 * 1024)))
            if len(raw) > maximum:
                flash(f"PO 文件超过允许大小（{maximum // 1024 // 1024} MB）。", "error")
                return redirect(url_for("new_report"))
            try:
                validate_po_upload_signature(raw, suffix)
            except ValueError as exc:
                flash(str(exc), "error")
                return redirect(url_for("new_report"))
            folder = Path(app.config["STORAGE_ROOT"]) / "po-imports" / uuid.uuid4().hex
            folder.mkdir(parents=True, exist_ok=True)
            destination = folder / f"source{suffix}"
            destination.write_bytes(raw)
            mime_type = upload.mimetype or mimetypes.guess_type(upload.filename)[0] or "application/octet-stream"
            po_import = POImport(
                original_name=Path(upload.filename).name[:255],
                file_path=str(destination),
                mime_type=mime_type[:120],
                checksum=file_sha256(destination),
                status="queued",
                created_by=current_user().id,
            )
            g.db.add(po_import)
            g.db.flush()
            audit(g.db, "po_upload", "po_import", po_import.id, po_import.original_name)
            g.db.commit()
            try:
                from task_queue import enqueue

                job = enqueue("app.process_po_import_job", po_import.id)
                if job is None:
                    process_po_import_job(po_import.id, app)
            except Exception as exc:
                failed = g.db.get(POImport, po_import.id)
                failed.status = "failed"
                failed.error_message = str(exc)[:2000]
                g.db.commit()
            return redirect(url_for("po_import_detail", import_id=po_import.id))

        imports = list(g.db.scalars(select(POImport).order_by(POImport.created_at.desc()).limit(12)).all())
        return render_template("new_report.html", imports=imports)

    @app.route("/reports/new/manual", methods=["GET", "POST"])
    @login_required
    def new_manual_report():
        orders = list(g.db.scalars(select(PurchaseOrder).order_by(PurchaseOrder.po_no)).all())
        if request.method == "POST":
            po = g.db.get(PurchaseOrder, request.form.get("po_id", type=int))
            if not po:
                flash("请选择有效的订单。", "error")
                return render_template("new_manual_report.html", orders=orders)
            product_data, packing = po_snapshot(g.db, po)
            test_templates = list(g.db.scalars(select(TestTemplate).where(TestTemplate.active.is_(True)).order_by(TestTemplate.sort_order, TestTemplate.id)).all())
            packing["required_tests"] = [template.name for template in test_templates if template.required]
            base = f"QC-{date.today():%Y%m%d}-{po.po_no}"
            report_no = base
            suffix = 2
            while g.db.scalar(select(func.count()).select_from(Report).where(Report.report_no == report_no)):
                report_no = f"{base}-{suffix}"
                suffix += 1
            report = Report(report_no=report_no, po_id=po.id, inspector_id=current_user().id, product_snapshot=json.dumps(product_data, ensure_ascii=False), packing_snapshot=json.dumps(packing, ensure_ascii=False), inspection_date=date.today(), inspected_qty=0)
            g.db.add(report)
            g.db.flush()
            for index, template in enumerate(test_templates):
                g.db.add(TestResult(report_id=report.id, name=template.name, standard=template.standard, result="", sort_order=index))
            instantiate_photo_slots(g.db, report, po.customer_id, po.product_id)
            g.db.flush()
            rules = find_aql_rules(g.db, report)
            report.sample_size = max((rule.sample_size for rule in rules.values()), default=0)
            refresh_result(g.db, report)
            audit(g.db, "create_manual", "report", report.id, report.report_no)
            g.db.commit()
            return redirect(url_for("inspection_workspace", report_id=report.id))
        return render_template("new_manual_report.html", orders=orders)

    @app.get("/po-imports/<int:import_id>")
    @login_required
    def po_import_detail(import_id: int):
        po_import = g.db.get(POImport, import_id)
        if not po_import:
            abort(404)
        items = list(g.db.scalars(select(POItem).where(POItem.po_import_id == po_import.id).order_by(POItem.item_index)).all())
        field_rows = list(g.db.scalars(select(ExtractedField).where(ExtractedField.po_item_id.in_([item.id for item in items]) if items else ExtractedField.id == -1)).all())
        fields_by_item: dict[int, dict[str, ExtractedField]] = {item.id: {} for item in items}
        for field in field_rows:
            fields_by_item.setdefault(field.po_item_id, {})[field.field_key] = field
        sources = {source.po_item_id: source.report_id for source in g.db.scalars(select(ReportSource).where(ReportSource.po_item_id.in_([item.id for item in items]) if items else ReportSource.id == -1)).all()}
        return render_template("po_review.html", po_import=po_import, items=items, fields_by_item=fields_by_item, field_definitions=PO_FIELD_DEFINITIONS, reports_by_item=sources)

    @app.get("/po-imports/<int:import_id>/source")
    @login_required
    def po_import_source(import_id: int):
        po_import = g.db.get(POImport, import_id)
        if not po_import:
            abort(404)
        try:
            source_path = verified_storage_file(app.config["STORAGE_ROOT"], po_import.file_path, po_import.checksum)
        except ValueError:
            abort(409, "PO source failed its integrity check")
        return send_file(source_path, mimetype=po_import.mime_type, as_attachment=False, download_name=po_import.original_name, conditional=True)

    @app.post("/po-imports/<int:import_id>/items/<int:item_id>/confirm")
    @login_required
    def confirm_po_item(import_id: int, item_id: int):
        po_item = g.db.scalar(select(POItem).where(POItem.id == item_id).with_for_update())
        if not po_item or po_item.po_import_id != import_id:
            abort(404)
        existing_source = g.db.scalar(select(ReportSource).where(ReportSource.po_item_id == po_item.id))
        if existing_source:
            flash("该货号已经建立验货报告，已打开现有报告。", "info")
            return redirect(url_for("inspection_workspace", report_id=existing_source.report_id))
        fields = _field_map(g.db, po_item.id)
        for field_key, _label, _scope, _ai, _required in PO_FIELD_DEFINITIONS:
            field = fields.get(field_key)
            if not field:
                continue
            field.normalized_value = request.form.get(f"field_{field_key}", "").strip()
            field.confirmed = True
            field.reviewed_by = current_user().id
            field.updated_at = utcnow()
        po_item.review_status = "confirmed"
        g.db.flush()
        try:
            report = create_report_from_po_item(g.db, po_item, current_user())
        except ValueError as exc:
            g.db.rollback()
            flash(str(exc), "error")
            return redirect(url_for("po_import_detail", import_id=import_id) + f"#item-{item_id}")
        audit(g.db, "confirm_po_item", "po_item", po_item.id, f"report:{report.id}")
        g.db.commit()
        flash("PO 字段已确认，已为该货号建立独立验货报告。", "success")
        return redirect(url_for("inspection_workspace", report_id=report.id))

    @app.route("/reports/<int:report_id>/inspection", methods=["GET", "POST"])
    @login_required
    def inspection_workspace(report_id: int):
        report = g.db.scalar(select(Report).where(Report.id == report_id).with_for_update()) if request.method == "POST" else g.db.get(Report, report_id)
        if not report:
            abort(404)
        if report.finalized:
            return redirect(url_for("report_detail", report_id=report.id))
        if request.method == "POST":
            report.inspection_date = date.fromisoformat(request.form.get("inspection_date") or date.today().isoformat())
            report.inspected_qty = max(0, request.form.get("inspected_qty", type=int) or 0)
            report.inspection_level = request.form.get("inspection_level", "II")[:20]
            report.critical_aql = request.form.get("critical_aql", type=float) if request.form.get("critical_aql") not in {None, ""} else 0
            report.major_aql = request.form.get("major_aql", type=float) if request.form.get("major_aql") not in {None, ""} else 1.0
            report.minor_aql = request.form.get("minor_aql", type=float) if request.form.get("minor_aql") not in {None, ""} else 4.0
            report.manual_hold = request.form.get("manual_hold") == "on"
            report.hold_reason = request.form.get("hold_reason", "").strip()
            report.remarks = request.form.get("remarks", "").strip()
            tests = list(g.db.scalars(select(TestResult).where(TestResult.report_id == report.id)).all())
            for test in tests:
                test.standard = request.form.get(f"test_standard_{test.id}", test.standard).strip()[:160]
                result_value = request.form.get(f"test_result_{test.id}", "").strip().upper()
                test.result = result_value if result_value in {"", "PASS", "FAIL", "N/A"} else ""
            g.db.flush()
            signature_invalidated = invalidate_signature(report)
            rules = find_aql_rules(g.db, report)
            report.sample_size = max((rule.sample_size for rule in rules.values()), default=0)
            refresh_result(g.db, report)
            audit(g.db, "save_inspection", "report", report.id, report.result)
            if signature_invalidated:
                audit(g.db, "invalidate_signature", "report", report.id, "Inspection data changed")
            g.db.commit()
            flash("验货数据已保存并重新判定。", "success")
            return redirect(url_for("inspection_workspace", report_id=report.id))

        po = g.db.get(PurchaseOrder, report.po_id)
        if not g.db.scalar(select(func.count()).select_from(ReportPhotoSlot).where(ReportPhotoSlot.report_id == report.id)):
            instantiate_photo_slots(g.db, report, po.customer_id if po else None, po.product_id if po else None)
            g.db.commit()
        slots = list(g.db.scalars(select(ReportPhotoSlot).where(ReportPhotoSlot.report_id == report.id).order_by(ReportPhotoSlot.sort_order, ReportPhotoSlot.id)).all())
        evidence_rows = g.db.execute(
            select(Photo, PhotoEvidence)
            .join(PhotoEvidence, PhotoEvidence.photo_id == Photo.id)
            .where(Photo.report_id == report.id)
            .order_by(Photo.sort_order, Photo.id)
        ).all()
        photos_by_slot: dict[int, list[tuple[Photo, PhotoEvidence]]] = {slot.id: [] for slot in slots}
        for photo, evidence in evidence_rows:
            photos_by_slot.setdefault(evidence.slot_id, []).append((photo, evidence))
        latest_run = g.db.scalar(select(AIAnalysisRun).where(AIAnalysisRun.report_id == report.id).order_by(AIAnalysisRun.id.desc()))
        observations = list(g.db.scalars(select(AIObservation).where(AIObservation.analysis_run_id == latest_run.id).order_by(AIObservation.id)).all()) if latest_run else []
        findings = list(g.db.scalars(select(AIFinding).where(AIFinding.analysis_run_id == latest_run.id).order_by(AIFinding.id)).all()) if latest_run else []
        tests = list(g.db.scalars(select(TestResult).where(TestResult.report_id == report.id).order_by(TestResult.sort_order, TestResult.id)).all())
        defects = list(g.db.scalars(select(Defect).where(Defect.report_id == report.id).order_by(Defect.id)).all())
        decisions_by_finding: dict[int, QCDecision] = {}
        if findings:
            for qc_decision in g.db.scalars(select(QCDecision).where(QCDecision.finding_id.in_([item.id for item in findings])).order_by(QCDecision.id)):
                decisions_by_finding[qc_decision.finding_id] = qc_decision
        rules = find_aql_rules(g.db, report)
        _, _, decision = evaluate_report(g.db, report)
        required_total = sum(1 for slot in slots if slot.required)
        required_done = sum(1 for slot in slots if slot.required and photos_by_slot.get(slot.id))
        return render_template(
            "ai_inspection.html",
            report=report,
            snapshot=json_load(report.product_snapshot),
            packing=json_load(report.packing_snapshot),
            slots=slots,
            photos_by_slot=photos_by_slot,
            latest_run=latest_run,
            observations=observations,
            findings=findings,
            tests=tests,
            defects=defects,
            defects_by_id={item.id: item for item in defects},
            decisions_by_finding=decisions_by_finding,
            rules=rules,
            decision=decision,
            required_total=required_total,
            required_done=required_done,
        )

    @app.post("/reports/<int:report_id>/photo-slots/<int:slot_id>/photos", endpoint="upload_slot_photos_form")
    @app.post("/api/reports/<int:report_id>/photo-slots/<int:slot_id>/photos")
    @login_required
    def upload_slot_photos(report_id: int, slot_id: int):
        report = g.db.scalar(select(Report).where(Report.id == report_id).with_for_update())
        slot = g.db.get(ReportPhotoSlot, slot_id)
        api_request = request.path.startswith("/api/")
        if not report or not slot or slot.report_id != report.id:
            abort(404)
        if report.finalized:
            return (jsonify(error="finalized report photos are immutable"), 409) if api_request else abort(409)
        running = active_ai_run(g.db, report.id)
        if running:
            if api_request:
                return jsonify(error="wait for the active AI analysis before changing evidence", analysis_run_id=running.id), 409
            flash("AI 正在分析，完成前不能更改证据照片。", "warning")
            return redirect(url_for("inspection_workspace", report_id=report.id) + f"#slot-{slot.id}")
        uploads = request.files.getlist("photos") or ([request.files.get("photo")] if request.files.get("photo") else [])
        uploads = [upload for upload in uploads if upload and upload.filename]
        if not uploads:
            return (jsonify(error="photo is required"), 422) if api_request else redirect(url_for("inspection_workspace", report_id=report.id) + f"#slot-{slot.id}")
        source = request.form.get("upload_source", "gallery")
        if source not in {"camera", "gallery"}:
            source = "gallery"
        current_max = g.db.scalar(select(func.max(Photo.sort_order)).where(Photo.report_id == report.id, Photo.category == slot.category)) or 0
        created = []
        try:
            for upload in uploads:
                raw = upload.read()
                token = uuid.uuid4().hex
                original_suffix = Path(upload.filename).suffix.lower()
                if original_suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
                    original_suffix = ".upload"
                original = Path(app.config["STORAGE_ROOT"]) / "photo-originals" / str(report.id) / f"{token}{original_suffix}"
                processed = Path(app.config["STORAGE_ROOT"]) / "photos" / str(report.id) / f"{token}.jpg"
                original_checksum, processed_checksum = store_evidence_image(raw, upload.filename, original, processed)
                current_max += 1
                photo = Photo(
                    report_id=report.id,
                    category=slot.category,
                    caption=request.form.get("caption", "").strip()[:255],
                    file_path=str(processed),
                    original_name=Path(upload.filename).name[:255],
                    sort_order=current_max,
                    checksum=processed_checksum,
                )
                g.db.add(photo)
                g.db.flush()
                g.db.add(
                    PhotoEvidence(
                        photo_id=photo.id,
                        slot_id=slot.id,
                        original_path=str(original),
                        processed_path=str(processed),
                        original_checksum=original_checksum,
                        processed_checksum=processed_checksum,
                        upload_source=source,
                        sample_ids=request.form.get("sample_ids", "").strip(),
                        defect_group=request.form.get("defect_group", "").strip()[:120],
                    )
                )
                created.append(photo.id)
        except ValueError as exc:
            g.db.rollback()
            if api_request:
                return jsonify(error=str(exc)), 422
            flash("照片无法处理：" + str(exc), "error")
            return redirect(url_for("inspection_workspace", report_id=report.id) + f"#slot-{slot.id}")
        g.db.flush()
        removed = invalidate_ai_outputs(g.db, report, "Evidence photo uploaded after analysis")
        signature_invalidated = invalidate_signature(report)
        refresh_result(g.db, report)
        audit(g.db, "upload_slot_photo", "report", report.id, f"slot:{slot.slot_key};count:{len(created)};source:{source};superseded_defects:{removed}")
        if signature_invalidated:
            audit(g.db, "invalidate_signature", "report", report.id, "Evidence photo changed")
        g.db.commit()
        if api_request:
            return jsonify(photo_ids=created, slot_id=slot.id), 201
        flash(f"“{slot.label}”已上传 {len(created)} 张照片。", "success")
        return redirect(url_for("inspection_workspace", report_id=report.id) + f"#slot-{slot.id}")

    @app.post("/api/reports/<int:report_id>/analysis-runs")
    @login_required
    def start_analysis_run(report_id: int):
        report = g.db.scalar(select(Report).where(Report.id == report_id).with_for_update())
        if not report:
            abort(404)
        if report.finalized:
            return jsonify(error="finalized report is immutable"), 409
        running = active_ai_run(g.db, report.id)
        if running:
            return jsonify(error="analysis is already running", analysis_run_id=running.id), 409
        slots = list(g.db.scalars(select(ReportPhotoSlot).where(ReportPhotoSlot.report_id == report.id)).all())
        populated = set(g.db.scalars(select(PhotoEvidence.slot_id).join(Photo, Photo.id == PhotoEvidence.photo_id).where(Photo.report_id == report.id)).all())
        missing = [{"slot_id": slot.id, "slot_key": slot.slot_key, "label": slot.label} for slot in slots if slot.required and slot.id not in populated]
        if missing:
            return jsonify(error="required photos are missing", missing_slots=missing), 422
        if not populated:
            return jsonify(error="at least one evidence photo is required"), 422
        evidence_rows = g.db.execute(
            select(Photo, PhotoEvidence).join(PhotoEvidence, PhotoEvidence.photo_id == Photo.id).where(Photo.report_id == report.id)
        ).all()
        try:
            for _photo, evidence in evidence_rows:
                verified_storage_file(app.config["STORAGE_ROOT"], evidence.original_path, evidence.original_checksum)
                verified_storage_file(app.config["STORAGE_ROOT"], evidence.processed_path, evidence.processed_checksum)
        except ValueError as exc:
            return jsonify(error=str(exc)), 409
        manifest = photo_manifest(g.db, report.id)
        invalidate_ai_outputs(g.db, report, "Superseded by a new analysis run")
        signature_invalidated = invalidate_signature(report)
        run = AIAnalysisRun(
            report_id=report.id,
            status="queued",
            created_by=current_user().id,
            input_manifest=json.dumps(manifest, ensure_ascii=False, sort_keys=True),
            input_manifest_checksum=canonical_checksum(manifest),
        )
        g.db.add(run)
        g.db.flush()
        refresh_result(g.db, report)
        audit(g.db, "start_ai_analysis", "ai_analysis_run", run.id, f"report:{report.id}")
        if signature_invalidated:
            audit(g.db, "invalidate_signature", "report", report.id, "AI analysis restarted")
        g.db.commit()
        try:
            from task_queue import enqueue

            job = enqueue("app.process_analysis_run_job", run.id)
            if job is None:
                process_analysis_run_job(run.id, app)
        except Exception as exc:
            failed = g.db.get(AIAnalysisRun, run.id)
            failed.status = "failed"
            failed.error_message = str(exc)[:2000]
            failed.completed_at = utcnow()
            g.db.commit()
            return jsonify(error=str(exc), analysis_run_id=run.id), 503
        return jsonify(analysis_run_id=run.id, status="queued"), 202

    @app.get("/api/analysis-runs/<int:run_id>")
    @login_required
    def get_analysis_run(run_id: int):
        run = g.db.get(AIAnalysisRun, run_id)
        if not run:
            abort(404)
        observations = list(g.db.scalars(select(AIObservation).where(AIObservation.analysis_run_id == run.id).order_by(AIObservation.id)).all())
        findings = list(g.db.scalars(select(AIFinding).where(AIFinding.analysis_run_id == run.id).order_by(AIFinding.id)).all())
        decision_map: dict[int, QCDecision] = {}
        if findings:
            for decision in g.db.scalars(select(QCDecision).where(QCDecision.finding_id.in_([item.id for item in findings])).order_by(QCDecision.id)):
                decision_map[decision.finding_id] = decision
        return jsonify(
            id=run.id,
            report_id=run.report_id,
            status=run.status,
            error=run.error_message,
            model=run.model,
            prompt_version=run.prompt_version,
            schema_version=run.schema_version,
            request_id=run.request_id,
            observations=[{"id": item.id, "photo_id": item.photo_id, "slot_key": item.slot_key, "clarity": item.clarity_status, "requires_retake": item.requires_retake, "reason": item.reason, "ocr_text": json_list(item.ocr_text), "barcodes": json_list(item.barcode), "date_codes": json_list(item.date_code), "po_comparisons": json_list(item.consistency), "visible_condition": item.visible_state} for item in observations],
            findings=[{"id": item.id, "name": item.name, "description_en": item.description_en, "suggested_severity": item.suggested_severity, "confidence": item.confidence, "evidence_photo_ids": json.loads(item.evidence_photo_ids or "[]"), "reason": item.reason, "status": item.status, "qc_decision": ({"action": decision_map[item.id].action, "affected_quantity": decision_map[item.id].affected_quantity, "sample_ids": decision_map[item.id].sample_ids, "after": json_load(decision_map[item.id].after_json)} if item.id in decision_map else None)} for item in findings],
        )

    @app.patch("/api/findings/<int:finding_id>")
    @app.post("/findings/<int:finding_id>/review")
    @login_required
    def review_ai_finding(finding_id: int):
        finding = g.db.get(AIFinding, finding_id)
        if not finding:
            abort(404)
        run = g.db.get(AIAnalysisRun, finding.analysis_run_id)
        report = g.db.scalar(select(Report).where(Report.id == run.report_id).with_for_update())
        api_request = request.path.startswith("/api/")
        if report.finalized:
            return (jsonify(error="finalized report is immutable"), 409) if api_request else abort(409)
        current_run = latest_ai_run(g.db, report.id)
        if current_run is None or current_run.id != run.id or not analysis_run_is_current(g.db, run):
            message = "AI finding belongs to a stale or superseded analysis"
            return (jsonify(error=message), 409) if api_request else abort(409, message)
        payload = (request.get_json(silent=True) or {}) if api_request else request.form
        action = str(payload.get("action") or "").lower()
        if action not in {"accept", "edit", "reject"}:
            return (jsonify(error="action must be accept, edit or reject"), 422) if api_request else abort(422)
        defect = g.db.get(Defect, finding.confirmed_defect_id) if finding.confirmed_defect_id else None
        previous_decision = g.db.scalar(select(QCDecision).where(QCDecision.finding_id == finding.id).order_by(QCDecision.id.desc()))
        before = {
            "status": finding.status,
            "description_en": defect.description if defect else finding.description_en,
            "severity": defect.severity if defect else finding.suggested_severity,
            "affected_quantity": defect.quantity if defect else 0,
            "sample_ids": previous_decision.sample_ids if previous_decision else "",
            "confirmed_defect_id": finding.confirmed_defect_id,
        }
        quantity = _safe_int(payload.get("affected_quantity"), 0)
        sample_ids = str(payload.get("sample_ids") or "").strip()
        description = str(payload.get("description_en") or finding.description_en).strip()[:255]
        severity = str(payload.get("severity") or finding.suggested_severity).lower()
        if action != "reject" and (quantity < 1 or not description or severity not in {"critical", "major", "minor"}):
            message = "接受或修改建议时，必须填写英文描述、有效等级和受影响数量。"
            if api_request:
                return jsonify(error=message), 422
            flash(message, "error")
            return redirect(url_for("inspection_workspace", report_id=report.id) + "#ai-review")
        if action == "reject":
            finding.confirmed_defect_id = None
            finding.status = "rejected"
            if defect:
                g.db.delete(defect)
        else:
            if not defect:
                defect = Defect(report_id=report.id, severity=severity, description=description, quantity=quantity)
                g.db.add(defect)
                g.db.flush()
                finding.confirmed_defect_id = defect.id
            else:
                defect.severity = severity
                defect.description = description
                defect.quantity = quantity
            finding.status = "edited" if action == "edit" or description != finding.description_en or severity != finding.suggested_severity else "accepted"
        after = {"status": finding.status, "description_en": description, "severity": severity, "affected_quantity": quantity, "sample_ids": sample_ids, "confirmed_defect_id": finding.confirmed_defect_id}
        g.db.add(QCDecision(finding_id=finding.id, user_id=current_user().id, action=action, before_json=json.dumps(before, ensure_ascii=False), after_json=json.dumps(after, ensure_ascii=False), affected_quantity=quantity, sample_ids=sample_ids))
        g.db.flush()
        signature_invalidated = invalidate_signature(report)
        refresh_result(g.db, report)
        audit(g.db, "review_ai_finding", "ai_finding", finding.id, action)
        if signature_invalidated:
            audit(g.db, "invalidate_signature", "report", report.id, "AI finding decision changed")
        g.db.commit()
        if api_request:
            return jsonify(id=finding.id, status=finding.status, report_result=report.result)
        flash("AI 建议已记录，正式缺陷数量已重新计算。", "success")
        return redirect(url_for("inspection_workspace", report_id=report.id) + "#ai-review")

    @app.route("/reports/<int:report_id>/edit", methods=["GET", "POST"])
    @login_required
    def edit_report(report_id: int):
        report = g.db.scalar(select(Report).where(Report.id == report_id).with_for_update()) if request.method == "POST" else g.db.get(Report, report_id)
        if not report:
            abort(404)
        if report.finalized:
            flash("正式版本已锁定，请创建修订版后修改。", "warning")
            return redirect(url_for("report_detail", report_id=report.id))
        if g.db.scalar(select(ReportSource).where(ReportSource.report_id == report.id)):
            flash("AI 验货报告必须在引导式工作台修改，以保留 AI 建议与 QC 审核关系。", "warning")
            return redirect(url_for("inspection_workspace", report_id=report.id))
        if request.method == "POST":
            report.inspection_date = date.fromisoformat(request.form.get("inspection_date") or date.today().isoformat())
            report.inspection_status = request.form.get("inspection_status", "Final 1st")[:40]
            report.inspection_level = request.form.get("inspection_level", "II")[:20]
            report.completed_pct = max(0, min(100, request.form.get("completed_pct", type=int) or 0))
            report.inspected_qty = max(0, request.form.get("inspected_qty", type=int) or 0)
            report.critical_aql = request.form.get("critical_aql", type=float) or 0
            report.major_aql = request.form.get("major_aql", type=float) or 1.0
            report.minor_aql = request.form.get("minor_aql", type=float) or 4.0
            report.manual_hold = request.form.get("manual_hold") == "on"
            report.hold_reason = request.form.get("hold_reason", "").strip()
            report.master_carton_dimension = request.form.get("master_carton_dimension", "")[:120]
            report.master_carton_nw = request.form.get("master_carton_nw", type=float)
            report.master_carton_gw = request.form.get("master_carton_gw", type=float)
            report.outer_carton_barcode = request.form.get("outer_carton_barcode", "")[:160]
            report.remarks = request.form.get("remarks", "").strip()

            g.db.query(Defect).filter(Defect.report_id == report.id).delete()
            for index in range(1, 6):
                description = request.form.get(f"defect_description_{index}", "").strip()
                quantity = request.form.get(f"defect_quantity_{index}", type=int) or 0
                severity = request.form.get(f"defect_severity_{index}", "minor")
                if description and quantity > 0 and severity in {"critical", "major", "minor"}:
                    g.db.add(Defect(report_id=report.id, description=description[:255], quantity=quantity, severity=severity))
            tests = list(g.db.scalars(select(TestResult).where(TestResult.report_id == report.id).order_by(TestResult.sort_order)).all())
            for test in tests:
                result_value = request.form.get(f"test_result_{test.id}", "").strip().upper()
                test.result = result_value if result_value in {"", "PASS", "FAIL", "N/A"} else ""
            g.db.flush()
            signature_invalidated = invalidate_signature(report)
            rules = find_aql_rules(g.db, report)
            report.sample_size = max((r.sample_size for r in rules.values()), default=0)
            refresh_result(g.db, report)
            audit(g.db, "update", "report", report.id, report.result)
            if signature_invalidated:
                audit(g.db, "invalidate_signature", "report", report.id, "Legacy report data changed")
            g.db.commit()
            flash("报告草稿已保存并重新判定。", "success")
            return redirect(url_for("edit_report", report_id=report.id))
        defects = list(g.db.scalars(select(Defect).where(Defect.report_id == report.id).order_by(Defect.id)).all())
        tests = list(g.db.scalars(select(TestResult).where(TestResult.report_id == report.id).order_by(TestResult.sort_order)).all())
        photos = list(g.db.scalars(select(Photo).where(Photo.report_id == report.id).order_by(Photo.category, Photo.sort_order)).all())
        defect_categories = list(g.db.scalars(select(DefectCategory).where(DefectCategory.active.is_(True)).order_by(DefectCategory.sort_order, DefectCategory.id)).all())
        rules = find_aql_rules(g.db, report)
        _, _, decision = evaluate_report(g.db, report)
        return render_template("report_form.html", report=report, defects=defects, tests=tests, photos=photos, rules=rules, decision=decision, defect_categories=defect_categories)

    @app.get("/reports/<int:report_id>")
    @login_required
    def report_detail(report_id: int):
        report = g.db.get(Report, report_id)
        if not report:
            abort(404)
        versions = list(g.db.scalars(select(ReportVersion).where(ReportVersion.report_id == report.id).order_by(ReportVersion.template, ReportVersion.language)).all())
        photos = list(g.db.scalars(select(Photo).where(Photo.report_id == report.id).order_by(Photo.category, Photo.sort_order)).all())
        defects = list(g.db.scalars(select(Defect).where(Defect.report_id == report.id)).all())
        signer = g.db.get(User, report.signed_by_id) if report.signed_by_id else None
        return render_template("report_detail.html", report=report, versions=versions, photos=photos, defects=defects, signer=signer)

    @app.get("/reports/<int:report_id>/preview")
    @login_required
    def preview_report(report_id: int):
        report = g.db.get(Report, report_id)
        if not report:
            abort(404)
        template = request.args.get("template", "unified")
        language = request.args.get("language", "en")
        if template not in {"unified", "legacy", "modern"} or language not in {"en", "bilingual"}:
            abort(400)
        folder = Path(app.config["STORAGE_ROOT"]) / "previews" / str(report.id)
        folder.mkdir(parents=True, exist_ok=True)
        destination = folder / f"{uuid.uuid4().hex}-{template}-{language}.pdf"
        if template == "unified":
            from unified_pdf import generate_unified_report_pdf

            payload = build_unified_pdf_payload(g.db, report, setting(g.db, "company_name", "Quality Control Department"), setting(g.db, "report_title", "QUALITY INSPECTION REPORT"), setting(g.db, "logo_path", "") or None)
            generate_unified_report_pdf(payload, destination)
        else:
            generate_report_pdf(
                g.db,
                report,
                destination,
                template,
                language,
                setting(g.db, "company_name", "Quality Control Department"),
                setting(g.db, "report_title", "QUALITY INSPECTION REPORT"),
                setting(g.db, "logo_path", "") or None,
            )
        audit(g.db, "preview_pdf", "report", report.id, f"{template}:{language}")
        g.db.commit()
        preview_bytes = io.BytesIO(destination.read_bytes())
        destination.unlink(missing_ok=True)
        return send_file(preview_bytes, mimetype="application/pdf", as_attachment=False, download_name=f"{report.report_no}-PREVIEW.pdf", conditional=True)

    @app.post("/reports/<int:report_id>/photos")
    @login_required
    def upload_photos(report_id: int):
        report = g.db.scalar(select(Report).where(Report.id == report_id).with_for_update())
        if not report or report.finalized:
            abort(409)
        category = request.form.get("category", "other")
        if category not in PHOTO_CATEGORIES:
            abort(400, "Invalid category")
        uploads = request.files.getlist("photos")
        added = 0
        current_max = g.db.scalar(select(func.max(Photo.sort_order)).where(Photo.report_id == report.id, Photo.category == category)) or 0
        for upload in uploads:
            if not upload.filename:
                continue
            destination = Path(app.config["STORAGE_ROOT"]) / "photos" / str(report.id) / f"{uuid.uuid4().hex}.jpg"
            _, checksum = process_uploaded_image(upload, destination)
            current_max += 1
            g.db.add(Photo(report_id=report.id, category=category, caption=request.form.get("caption", "")[:255], file_path=str(destination), original_name=upload.filename[:255], sort_order=current_max, checksum=checksum))
            added += 1
        g.db.flush()
        signature_invalidated = invalidate_signature(report)
        refresh_result(g.db, report)
        audit(g.db, "upload_photo", "report", report.id, f"{category}:{added}")
        if signature_invalidated:
            audit(g.db, "invalidate_signature", "report", report.id, "Legacy photo uploaded")
        g.db.commit()
        flash(f"已上传 {added} 张照片。", "success")
        return redirect(url_for("edit_report", report_id=report.id) + "#photos")

    @app.post("/reports/<int:report_id>/photos/<int:photo_id>/delete")
    @login_required
    def delete_photo(report_id: int, photo_id: int):
        report = g.db.scalar(select(Report).where(Report.id == report_id).with_for_update())
        photo = g.db.get(Photo, photo_id)
        if not report or not photo or photo.report_id != report.id or report.finalized:
            abort(409)
        running = active_ai_run(g.db, report.id)
        if running:
            abort(409, "wait for the active AI analysis before changing evidence")
        evidence = g.db.scalar(select(PhotoEvidence).where(PhotoEvidence.photo_id == photo.id))
        evidence_slot_id = evidence.slot_id if evidence else None
        Path(photo.file_path).unlink(missing_ok=True)
        if evidence:
            Path(evidence.original_path).unlink(missing_ok=True)
            if Path(evidence.processed_path) != Path(photo.file_path):
                Path(evidence.processed_path).unlink(missing_ok=True)
            g.db.delete(evidence)
        g.db.delete(photo)
        g.db.flush()
        removed = invalidate_ai_outputs(g.db, report, "Evidence photo deleted after analysis")
        signature_invalidated = invalidate_signature(report)
        refresh_result(g.db, report)
        audit(g.db, "delete_photo", "photo", photo.id, f"superseded_defects:{removed}")
        if signature_invalidated:
            audit(g.db, "invalidate_signature", "report", report.id, "Evidence photo deleted")
        g.db.commit()
        if evidence_slot_id:
            return redirect(url_for("inspection_workspace", report_id=report.id) + f"#slot-{evidence_slot_id}")
        return redirect(url_for("edit_report", report_id=report.id) + "#photos")

    @app.get("/media/photos/<int:photo_id>")
    @login_required
    def media_photo(photo_id: int):
        photo = g.db.get(Photo, photo_id)
        if not photo:
            abort(404)
        try:
            photo_path = verified_storage_file(app.config["STORAGE_ROOT"], photo.file_path, photo.checksum)
        except ValueError:
            abort(409, "Photo failed its integrity check")
        return send_file(photo_path, mimetype="image/jpeg", conditional=True)

    @app.post("/reports/<int:report_id>/signature")
    @login_required
    def save_signature(report_id: int):
        report = g.db.scalar(select(Report).where(Report.id == report_id).with_for_update())
        if not report or report.finalized:
            abort(409)
        signature_return = "inspection_workspace" if g.db.scalar(select(ReportSource).where(ReportSource.report_id == report.id)) or g.db.scalar(select(func.count()).select_from(ReportPhotoSlot).where(ReportPhotoSlot.report_id == report.id)) else "edit_report"
        running = active_ai_run(g.db, report.id)
        if running:
            flash("AI 分析仍在处理中，请等待完成后再签名。", "warning")
            return redirect(url_for(signature_return, report_id=report.id) + "#signature")
        source = g.db.scalar(select(ReportSource).where(ReportSource.report_id == report.id))
        run = latest_ai_run(g.db, report.id)
        if source and (not analysis_run_is_current(g.db, run)):
            flash("照片证据尚无有效的最新 AI 分析，请先重新分析。", "warning")
            return redirect(url_for(signature_return, report_id=report.id) + "#ai-review")
        if run:
            pending = g.db.scalar(select(func.count()).select_from(AIFinding).where(AIFinding.analysis_run_id == run.id, AIFinding.status == "pending")) or 0
            if pending:
                flash("请先审核全部 AI 建议再签名。", "warning")
                return redirect(url_for(signature_return, report_id=report.id) + "#ai-review")
        signer = current_user()
        mode = request.form.get("signature_mode", "draw")
        if mode == "profile":
            user = signer
            if not user.signature_path:
                flash("当前账号还没有预存签名。", "error")
                return redirect(url_for(signature_return, report_id=report.id) + "#signature")
            try:
                profile_source = verified_storage_file(app.config["STORAGE_ROOT"], user.signature_path)
            except ValueError:
                flash("预存签名文件已损坏，请重新手写签名。", "error")
                return redirect(url_for(signature_return, report_id=report.id) + "#signature")
            destination = Path(app.config["STORAGE_ROOT"]) / "signatures" / str(report.id) / f"{uuid.uuid4().hex}.png"
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(profile_source, destination)
        else:
            data_url = request.form.get("signature_data", "")
            if not data_url.startswith("data:image/png;base64,"):
                flash("请先在签名板上签名。", "error")
                return redirect(url_for(signature_return, report_id=report.id) + "#signature")
            raw = base64.b64decode(data_url.split(",", 1)[1], validate=True)
            if len(raw) > 2 * 1024 * 1024:
                flash("签名图片过大，请重新签名。", "error")
                return redirect(url_for(signature_return, report_id=report.id) + "#signature")
            image = Image.open(io.BytesIO(raw)).convert("RGBA")
            if image.width * image.height > 5_000_000:
                flash("签名图片尺寸过大，请重新签名。", "error")
                return redirect(url_for(signature_return, report_id=report.id) + "#signature")
            if image.getbbox() is None:
                flash("签名不能为空。", "error")
                return redirect(url_for(signature_return, report_id=report.id) + "#signature")
            image.thumbnail((1200, 400), Image.Resampling.LANCZOS)
            destination = Path(app.config["STORAGE_ROOT"]) / "signatures" / str(report.id) / f"{uuid.uuid4().hex}.png"
            destination.parent.mkdir(parents=True, exist_ok=True)
            image.save(destination, "PNG", optimize=True)
            if request.form.get("save_to_profile") == "on":
                user = current_user()
                profile = Path(app.config["STORAGE_ROOT"]) / "signatures" / "profiles" / f"user-{user.id}.png"
                profile.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(destination, profile)
                user.signature_path = str(profile)
        if report.signature_path:
            Path(report.signature_path).unlink(missing_ok=True)
        report.signature_path = str(destination)
        report.signed_at = utcnow()
        report.signed_by_id = signer.id
        report.signature_checksum = file_sha256(destination)
        refresh_result(g.db, report)
        g.db.flush()
        report.signed_data_checksum = report_data_checksum(g.db, report)
        audit(g.db, "sign", "report", report.id, f"signed_by:{signer.id};signature:{report.signature_checksum};data:{report.signed_data_checksum}")
        g.db.commit()
        flash("电子签名已保存。", "success")
        return redirect(url_for(signature_return, report_id=report.id) + "#signature")

    # Register the browser route first so url_for("finalize_report") points to
    # the HTML redirect flow rather than the JSON API endpoint.
    @app.post("/api/reports/<int:report_id>/finalize")
    @app.post("/reports/<int:report_id>/finalize")
    @login_required
    def finalize_report(report_id: int):
        api_request = request.path.startswith("/api/")
        report = g.db.scalar(select(Report).where(Report.id == report_id).with_for_update())
        if not report:
            abort(404)
        if report.finalized:
            return (jsonify(error="report is already finalized"), 409) if api_request else abort(409)
        running = active_ai_run(g.db, report.id)
        if running:
            message = "AI analysis is still active; wait for it before finalizing"
            if api_request:
                return jsonify(error=message, analysis_run_id=running.id), 409
            flash("AI 分析仍在处理中，不能锁定报告。", "warning")
            return redirect(url_for("inspection_workspace", report_id=report.id) + "#ai-review")
        refresh_result(g.db, report)
        target = "inspection_workspace" if g.db.scalar(select(func.count()).select_from(ReportPhotoSlot).where(ReportPhotoSlot.report_id == report.id)) else "edit_report"
        try:
            if not report.signature_path or not report.signed_by_id or not report.signature_checksum or not report.signed_data_checksum:
                raise ValueError("A current QC signature is required")
            verified_storage_file(app.config["STORAGE_ROOT"], report.signature_path, report.signature_checksum)
            current_data_checksum = report_data_checksum(g.db, report)
            if current_data_checksum != report.signed_data_checksum:
                invalidate_signature(report)
                audit(g.db, "invalidate_signature", "report", report.id, "Signed report data changed before finalization")
                g.db.commit()
                raise ValueError("Report data changed after signing; QC must sign again")
            for photo, evidence in g.db.execute(select(Photo, PhotoEvidence).join(PhotoEvidence, PhotoEvidence.photo_id == Photo.id).where(Photo.report_id == report.id)):
                verified_storage_file(app.config["STORAGE_ROOT"], evidence.original_path, evidence.original_checksum)
                verified_storage_file(app.config["STORAGE_ROOT"], evidence.processed_path, evidence.processed_checksum)
        except ValueError as exc:
            if api_request:
                return jsonify(error=str(exc)), 409
            flash(str(exc), "error")
            return redirect(url_for(target, report_id=report.id) + "#signature")

        g.db.flush()
        folder = Path(app.config["STORAGE_ROOT"]) / "reports" / f"report-{report.id}" / f"rev-{report.revision}"
        folder.mkdir(parents=True, exist_ok=True)
        ai_workflow = bool(g.db.scalar(select(ReportSource).where(ReportSource.report_id == report.id)) or g.db.scalar(select(func.count()).select_from(ReportPhotoSlot).where(ReportPhotoSlot.report_id == report.id)))
        created_versions: list[ReportVersion] = []
        if ai_workflow:
            from unified_pdf import generate_unified_report_pdf

            destination = folder / f"unified-en-{uuid.uuid4().hex[:8]}.pdf"
            payload = build_unified_pdf_payload(g.db, report, setting(g.db, "company_name", "Dongguan Hanson Plastic Product Ltd"), setting(g.db, "report_title", "QUALITY INSPECTION REPORT"), setting(g.db, "logo_path", "") or None)
            generate_unified_report_pdf(payload, destination)
            created_versions.append(ReportVersion(report_id=report.id, template="unified", language="en", file_path=str(destination), checksum=file_sha256(destination), created_by=current_user().id, signed_by_id=report.signed_by_id, signed_at=report.signed_at, signature_checksum=report.signature_checksum, data_checksum=report.signed_data_checksum))
        else:
            for template in ("legacy", "modern"):
                for language in ("en", "bilingual"):
                    destination = folder / f"{template}-{language}-{uuid.uuid4().hex[:8]}.pdf"
                    generate_report_pdf(g.db, report, destination, template, language, setting(g.db, "company_name", "Dongguan Hanson Plastic Product Ltd"), setting(g.db, "report_title", "QUALITY INSPECTION REPORT"), setting(g.db, "logo_path", "") or None)
                    created_versions.append(ReportVersion(report_id=report.id, template=template, language=language, file_path=str(destination), checksum=file_sha256(destination), created_by=current_user().id, signed_by_id=report.signed_by_id, signed_at=report.signed_at, signature_checksum=report.signature_checksum, data_checksum=report.signed_data_checksum))
        if report_data_checksum(g.db, report) != report.signed_data_checksum:
            for version in created_versions:
                Path(version.file_path).unlink(missing_ok=True)
            invalidate_signature(report)
            audit(g.db, "invalidate_signature", "report", report.id, "Report data changed during PDF generation")
            g.db.commit()
            message = "Report data changed during PDF generation; QC must review and sign again"
            if api_request:
                return jsonify(error=message), 409
            flash(message, "error")
            return redirect(url_for(target, report_id=report.id) + "#signature")
        for version in created_versions:
            g.db.add(version)
        report.finalized = True
        report.finalized_at = utcnow()
        audit(g.db, "finalize", "report", report.id, report.result)
        g.db.commit()
        if api_request:
            return jsonify(id=report.id, report_no=report.report_no, revision=report.revision, result=report.result, finalized=True, pdf_versions=[{"id": item.id, "template": item.template, "language": item.language, "checksum": item.checksum} for item in created_versions]), 201
        flash(("统一英文正式报告" if ai_workflow else "兼容格式正式报告") + "已锁定；原始数据、照片和 PDF 不可覆盖。", "success")
        return redirect(url_for("report_detail", report_id=report.id))

    @app.post("/reports/<int:report_id>/revision")
    @login_required
    def create_revision(report_id: int):
        source = g.db.get(Report, report_id)
        if not source or not source.finalized:
            abort(409)
        max_revision = g.db.scalar(select(func.max(Report.revision)).where(Report.report_no == source.report_no)) or 0
        copy_fields = {column.name: getattr(source, column.name) for column in Report.__table__.columns if column.name not in {"id", "revision", "parent_id", "signature_path", "signed_at", "signed_by_id", "signature_checksum", "signed_data_checksum", "finalized", "finalized_at", "created_at", "updated_at"}}
        revision = Report(**copy_fields, revision=max_revision + 1, parent_id=source.id, signature_path=None, signed_at=None, finalized=False, finalized_at=None, created_at=utcnow(), updated_at=utcnow())
        g.db.add(revision)
        g.db.flush()
        source_link = g.db.scalar(select(ReportSource).where(ReportSource.report_id == source.id))
        if source_link:
            g.db.add(ReportSource(report_id=revision.id, po_item_id=source_link.po_item_id))
        slot_map: dict[int, int] = {}
        for source_slot in g.db.scalars(select(ReportPhotoSlot).where(ReportPhotoSlot.report_id == source.id).order_by(ReportPhotoSlot.sort_order, ReportPhotoSlot.id)):
            new_slot = ReportPhotoSlot(report_id=revision.id, template_slot_id=source_slot.template_slot_id, slot_key=source_slot.slot_key, label=source_slot.label, instruction=source_slot.instruction, example_path=source_slot.example_path, required=source_slot.required, category=source_slot.category, sort_order=source_slot.sort_order)
            g.db.add(new_slot)
            g.db.flush()
            slot_map[source_slot.id] = new_slot.id
        ai_defect_ids = set(
            g.db.scalars(
                select(AIFinding.confirmed_defect_id)
                .join(AIAnalysisRun, AIFinding.analysis_run_id == AIAnalysisRun.id)
                .where(AIAnalysisRun.report_id == source.id, AIFinding.confirmed_defect_id.is_not(None))
            ).all()
        )
        for defect in g.db.scalars(select(Defect).where(Defect.report_id == source.id)):
            # AI-confirmed defects must be regenerated from a new analysis run
            # so the revision is bound to its own copied evidence manifest.
            if defect.id not in ai_defect_ids:
                g.db.add(Defect(report_id=revision.id, severity=defect.severity, description=defect.description, quantity=defect.quantity))
        for test in g.db.scalars(select(TestResult).where(TestResult.report_id == source.id)):
            g.db.add(TestResult(report_id=revision.id, name=test.name, standard=test.standard, result=test.result, sort_order=test.sort_order))
        for photo in g.db.scalars(select(Photo).where(Photo.report_id == source.id)):
            token = uuid.uuid4().hex
            destination = Path(app.config["STORAGE_ROOT"]) / "photos" / str(revision.id) / f"{token}.jpg"
            destination.parent.mkdir(parents=True, exist_ok=True)
            processed_source = verified_storage_file(app.config["STORAGE_ROOT"], photo.file_path, photo.checksum)
            shutil.copy2(processed_source, destination)
            new_photo = Photo(report_id=revision.id, category=photo.category, caption=photo.caption, file_path=str(destination), original_name=photo.original_name, sort_order=photo.sort_order, checksum=file_sha256(destination))
            g.db.add(new_photo)
            g.db.flush()
            evidence = g.db.scalar(select(PhotoEvidence).where(PhotoEvidence.photo_id == photo.id))
            if evidence and evidence.slot_id in slot_map:
                original_source = verified_storage_file(app.config["STORAGE_ROOT"], evidence.original_path, evidence.original_checksum)
                original_suffix = original_source.suffix or ".upload"
                original_destination = Path(app.config["STORAGE_ROOT"]) / "photo-originals" / str(revision.id) / f"{token}{original_suffix}"
                original_destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(original_source, original_destination)
                g.db.add(PhotoEvidence(photo_id=new_photo.id, slot_id=slot_map[evidence.slot_id], original_path=str(original_destination), processed_path=str(destination), original_checksum=file_sha256(original_destination), processed_checksum=file_sha256(destination), upload_source=evidence.upload_source, sample_ids=evidence.sample_ids, defect_group=evidence.defect_group, quality_status=evidence.quality_status))
        g.db.flush()
        refresh_result(g.db, revision)
        audit(g.db, "create_revision", "report", revision.id, f"from:{source.id}")
        g.db.commit()
        flash(f"已创建 Rev.{revision.revision}，旧版本保持不变。", "success")
        return redirect(url_for("inspection_workspace", report_id=revision.id) if slot_map else url_for("edit_report", report_id=revision.id))

    @app.post("/reports/<int:report_id>/copy")
    @login_required
    def copy_report(report_id: int):
        source = g.db.get(Report, report_id)
        if not source:
            abort(404)
        prefix = f"{source.report_no}-COPY"
        report_no = prefix
        suffix = 2
        while g.db.scalar(select(func.count()).select_from(Report).where(Report.report_no == report_no)):
            report_no = f"{prefix}-{suffix}"
            suffix += 1
        excluded = {"id", "report_no", "revision", "parent_id", "inspector_id", "signature_path", "signed_at", "signed_by_id", "signature_checksum", "signed_data_checksum", "finalized", "finalized_at", "created_at", "updated_at"}
        fields = {column.name: getattr(source, column.name) for column in Report.__table__.columns if column.name not in excluded}
        copied = Report(
            **fields,
            report_no=report_no,
            revision=0,
            parent_id=source.id,
            inspector_id=current_user().id,
            signature_path=None,
            signed_at=None,
            finalized=False,
            finalized_at=None,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        g.db.add(copied)
        g.db.flush()
        source_link = g.db.scalar(select(ReportSource).where(ReportSource.report_id == source.id))
        if source_link:
            g.db.add(ReportSource(report_id=copied.id, po_item_id=source_link.po_item_id))
        slot_map: dict[int, int] = {}
        for source_slot in g.db.scalars(select(ReportPhotoSlot).where(ReportPhotoSlot.report_id == source.id).order_by(ReportPhotoSlot.sort_order, ReportPhotoSlot.id)):
            new_slot = ReportPhotoSlot(report_id=copied.id, template_slot_id=source_slot.template_slot_id, slot_key=source_slot.slot_key, label=source_slot.label, instruction=source_slot.instruction, example_path=source_slot.example_path, required=source_slot.required, category=source_slot.category, sort_order=source_slot.sort_order)
            g.db.add(new_slot)
            g.db.flush()
            slot_map[source_slot.id] = new_slot.id
        ai_defect_ids = set(
            g.db.scalars(
                select(AIFinding.confirmed_defect_id)
                .join(AIAnalysisRun, AIFinding.analysis_run_id == AIAnalysisRun.id)
                .where(AIAnalysisRun.report_id == source.id, AIFinding.confirmed_defect_id.is_not(None))
            ).all()
        )
        for defect in g.db.scalars(select(Defect).where(Defect.report_id == source.id)):
            if defect.id not in ai_defect_ids:
                g.db.add(Defect(report_id=copied.id, severity=defect.severity, description=defect.description, quantity=defect.quantity))
        for test in g.db.scalars(select(TestResult).where(TestResult.report_id == source.id)):
            g.db.add(TestResult(report_id=copied.id, name=test.name, standard=test.standard, result=test.result, sort_order=test.sort_order))
        for photo in g.db.scalars(select(Photo).where(Photo.report_id == source.id)):
            token = uuid.uuid4().hex
            destination = Path(app.config["STORAGE_ROOT"]) / "photos" / str(copied.id) / f"{token}.jpg"
            destination.parent.mkdir(parents=True, exist_ok=True)
            processed_source = verified_storage_file(app.config["STORAGE_ROOT"], photo.file_path, photo.checksum)
            shutil.copy2(processed_source, destination)
            new_photo = Photo(report_id=copied.id, category=photo.category, caption=photo.caption, file_path=str(destination), original_name=photo.original_name, sort_order=photo.sort_order, checksum=file_sha256(destination))
            g.db.add(new_photo)
            g.db.flush()
            evidence = g.db.scalar(select(PhotoEvidence).where(PhotoEvidence.photo_id == photo.id))
            if evidence and evidence.slot_id in slot_map:
                original_source = verified_storage_file(app.config["STORAGE_ROOT"], evidence.original_path, evidence.original_checksum)
                original_suffix = original_source.suffix or ".upload"
                original_destination = Path(app.config["STORAGE_ROOT"]) / "photo-originals" / str(copied.id) / f"{token}{original_suffix}"
                original_destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(original_source, original_destination)
                g.db.add(PhotoEvidence(photo_id=new_photo.id, slot_id=slot_map[evidence.slot_id], original_path=str(original_destination), processed_path=str(destination), original_checksum=file_sha256(original_destination), processed_checksum=file_sha256(destination), upload_source=evidence.upload_source, sample_ids=evidence.sample_ids, defect_group=evidence.defect_group, quality_status=evidence.quality_status))
        g.db.flush()
        refresh_result(g.db, copied)
        audit(g.db, "copy", "report", copied.id, f"from:{source.id}")
        g.db.commit()
        flash("报告已复制为新的可编辑草稿。", "success")
        return redirect(url_for("inspection_workspace", report_id=copied.id) if slot_map else url_for("edit_report", report_id=copied.id))

    @app.get("/reports/<int:report_id>/pdf/<int:version_id>")
    @login_required
    def download_pdf(report_id: int, version_id: int):
        version = g.db.get(ReportVersion, version_id)
        if not version or version.report_id != report_id:
            abort(404)
        try:
            pdf_path = verified_storage_file(app.config["STORAGE_ROOT"], version.file_path, version.checksum)
        except ValueError as exc:
            audit(g.db, "pdf_integrity_failure", "report_version", version.id, str(exc))
            g.db.commit()
            abort(409, "Official PDF failed its integrity check")
        report = g.db.get(Report, report_id)
        name = f"{report.report_no}-Rev{report.revision}-{version.template}-{version.language}.pdf"
        return send_file(pdf_path, mimetype="application/pdf", as_attachment=request.args.get("download") == "1", download_name=name, conditional=True)

    @app.post("/api/po-imports")
    @login_required
    def api_create_po_import():
        upload = request.files.get("file") or request.files.get("po_file")
        if not upload or not upload.filename:
            return jsonify(error="file is required"), 422
        suffix = Path(upload.filename).suffix.lower()
        if suffix not in PO_ALLOWED_EXTENSIONS:
            return jsonify(error="supported formats: PDF, XLS, XLSX, JPG, PNG"), 422
        raw = upload.read()
        maximum = int(os.getenv("AI_MAX_DOCUMENT_BYTES", str(25 * 1024 * 1024)))
        if not raw or len(raw) > maximum:
            return jsonify(error="file is empty or exceeds configured limit"), 422
        try:
            validate_po_upload_signature(raw, suffix)
        except ValueError as exc:
            return jsonify(error=str(exc)), 422
        folder = Path(app.config["STORAGE_ROOT"]) / "po-imports" / uuid.uuid4().hex
        folder.mkdir(parents=True, exist_ok=True)
        destination = folder / f"source{suffix}"
        destination.write_bytes(raw)
        po_import = POImport(
            original_name=Path(upload.filename).name[:255],
            file_path=str(destination),
            mime_type=(upload.mimetype or mimetypes.guess_type(upload.filename)[0] or "application/octet-stream")[:120],
            checksum=file_sha256(destination),
            status="queued",
            created_by=current_user().id,
        )
        g.db.add(po_import)
        g.db.flush()
        audit(g.db, "api_po_upload", "po_import", po_import.id, po_import.original_name)
        g.db.commit()
        try:
            from task_queue import enqueue

            job = enqueue("app.process_po_import_job", po_import.id)
            if job is None:
                process_po_import_job(po_import.id, app)
        except Exception as exc:
            failed = g.db.get(POImport, po_import.id)
            failed.status = "failed"
            failed.error_message = str(exc)[:2000]
            g.db.commit()
            return jsonify(id=po_import.id, status="failed", error=str(exc)), 503
        return jsonify(id=po_import.id, status="queued"), 202

    @app.get("/api/po-imports/<int:import_id>")
    @login_required
    def api_get_po_import(import_id: int):
        po_import = g.db.get(POImport, import_id)
        if not po_import:
            abort(404)
        items = list(g.db.scalars(select(POItem).where(POItem.po_import_id == po_import.id).order_by(POItem.item_index)).all())
        result_items = []
        for item in items:
            fields = list(g.db.scalars(select(ExtractedField).where(ExtractedField.po_item_id == item.id).order_by(ExtractedField.id)).all())
            source = g.db.scalar(select(ReportSource).where(ReportSource.po_item_id == item.id))
            result_items.append(
                {
                    "id": item.id,
                    "item_index": item.item_index,
                    "review_status": item.review_status,
                    "report_id": source.report_id if source else None,
                    "fields": {
                        field.field_key: {
                            "raw_value": field.raw_value,
                            "normalized_value": field.normalized_value,
                            "confidence": field.confidence,
                            "source_ref": json.loads(field.source_ref or "{}"),
                            "confirmed": field.confirmed,
                        }
                        for field in fields
                    },
                }
            )
        return jsonify(id=po_import.id, filename=po_import.original_name, checksum=po_import.checksum, status=po_import.status, error=po_import.error_message, model=po_import.model, prompt_version=po_import.prompt_version, schema_version=po_import.schema_version, request_id=po_import.request_id, items=result_items)

    @app.patch("/api/po-imports/<int:import_id>/items/<int:item_id>/fields")
    @login_required
    def api_update_po_fields(import_id: int, item_id: int):
        po_item = g.db.get(POItem, item_id)
        if not po_item or po_item.po_import_id != import_id:
            abort(404)
        payload = request.get_json(silent=True) or {}
        updates = payload.get("fields") or {}
        fields = _field_map(g.db, po_item.id)
        allowed = {item[0] for item in PO_FIELD_DEFINITIONS}
        for key, update in updates.items():
            if key not in allowed or key not in fields:
                continue
            normalized = update.get("normalized_value") if isinstance(update, dict) else update
            fields[key].normalized_value = _json_value(normalized)
            fields[key].confirmed = bool(update.get("confirmed", True)) if isinstance(update, dict) else True
            fields[key].reviewed_by = current_user().id
            fields[key].updated_at = utcnow()
        po_item.review_status = "confirmed" if all(field.confirmed for field in fields.values()) else "needs_review"
        audit(g.db, "api_review_po_fields", "po_item", po_item.id, f"fields:{len(updates)}")
        g.db.commit()
        return jsonify(id=po_item.id, review_status=po_item.review_status)

    @app.route("/api/reports", methods=["GET", "POST"])
    @login_required
    def api_reports():
        if request.method == "POST":
            payload = request.get_json(silent=True) or {}
            po_item_id = _safe_int(payload.get("po_item_id"))
            po_item = g.db.scalar(select(POItem).where(POItem.id == po_item_id).with_for_update())
            if not po_item:
                return jsonify(error="valid po_item_id is required"), 422
            existing_source = g.db.scalar(select(ReportSource).where(ReportSource.po_item_id == po_item.id))
            if existing_source:
                return jsonify(error="report already exists for this PO item", report_id=existing_source.report_id), 409
            try:
                report = create_report_from_po_item(g.db, po_item, current_user())
            except ValueError as exc:
                return jsonify(error=str(exc)), 422
            audit(g.db, "api_create_from_po_item", "report", report.id, f"po_item:{po_item.id}")
            g.db.commit()
            return jsonify(id=report.id, report_no=report.report_no, result=report.result), 201
        items = list(g.db.scalars(select(Report).order_by(Report.updated_at.desc())).all())
        return jsonify([
            {"id": r.id, "report_no": r.report_no, "revision": r.revision, "result": r.result, "finalized": r.finalized, "snapshot": json_load(r.product_snapshot), "updated_at": r.updated_at.isoformat()}
            for r in items
        ])

    @app.route("/api/customers", methods=["GET", "POST"])
    @login_required
    def api_customers():
        if request.method == "GET":
            return jsonify([{"id": item.id, "name": item.name, "country": item.country, "address": item.address} for item in g.db.scalars(select(Customer).order_by(Customer.name))])
        if current_user().role != "admin":
            abort(403)
        payload = request.get_json(silent=True) or {}
        if not str(payload.get("name", "")).strip():
            return jsonify(error="name is required"), 422
        item = Customer(name=str(payload["name"]).strip(), country=str(payload.get("country", "")).strip(), address=str(payload.get("address", "")).strip())
        g.db.add(item)
        g.db.flush()
        audit(g.db, "api_create", "customer", item.id)
        g.db.commit()
        return jsonify(id=item.id), 201

    @app.route("/api/customers/<int:item_id>", methods=["GET", "PATCH", "DELETE"])
    @login_required
    def api_customer_item(item_id: int):
        item = g.db.get(Customer, item_id)
        if not item:
            abort(404)
        if request.method == "GET":
            return jsonify(id=item.id, name=item.name, country=item.country, address=item.address)
        if current_user().role != "admin":
            abort(403)
        if request.method == "DELETE":
            used = g.db.scalar(select(func.count()).select_from(PurchaseOrder).where(PurchaseOrder.customer_id == item.id)) or 0
            if used:
                return jsonify(error="customer is used by purchase orders"), 409
            g.db.delete(item)
            audit(g.db, "api_delete", "customer", item.id)
            g.db.commit()
            return "", 204
        payload = request.get_json(silent=True) or {}
        if "name" in payload and str(payload["name"]).strip():
            item.name = str(payload["name"]).strip()
        if "country" in payload:
            item.country = str(payload["country"]).strip()
        if "address" in payload:
            item.address = str(payload["address"]).strip()
        audit(g.db, "api_update", "customer", item.id)
        g.db.commit()
        return jsonify(id=item.id, name=item.name, country=item.country, address=item.address)

    @app.route("/api/products", methods=["GET", "POST"])
    @login_required
    def api_products():
        if request.method == "GET":
            return jsonify([{"id": item.id, "item_no": item.item_no, "description": item.description, "size_mm": item.size_mm, "barcode": item.barcode, "age_grade": item.age_grade, "origin": item.origin} for item in g.db.scalars(select(Product).order_by(Product.item_no))])
        if current_user().role != "admin":
            abort(403)
        payload = request.get_json(silent=True) or {}
        if not str(payload.get("item_no", "")).strip() or not str(payload.get("description", "")).strip():
            return jsonify(error="item_no and description are required"), 422
        item = Product(item_no=str(payload["item_no"]).strip(), description=str(payload["description"]).strip(), size_mm=str(payload.get("size_mm", "")).strip(), barcode=str(payload.get("barcode", "")).strip(), age_grade=str(payload.get("age_grade", "")).strip(), origin=str(payload.get("origin", "CHINA")).strip())
        g.db.add(item)
        g.db.flush()
        audit(g.db, "api_create", "product", item.id)
        g.db.commit()
        return jsonify(id=item.id), 201

    @app.route("/api/products/<int:item_id>", methods=["GET", "PATCH", "DELETE"])
    @login_required
    def api_product_item(item_id: int):
        item = g.db.get(Product, item_id)
        if not item:
            abort(404)
        fields = ("item_no", "description", "size_mm", "barcode", "age_grade", "origin", "net_weight_kg", "gross_weight_kg")
        if request.method == "GET":
            return jsonify({"id": item.id, **{field: getattr(item, field) for field in fields}})
        if current_user().role != "admin":
            abort(403)
        if request.method == "DELETE":
            used = g.db.scalar(select(func.count()).select_from(PurchaseOrder).where(PurchaseOrder.product_id == item.id)) or 0
            if used:
                return jsonify(error="product is used by purchase orders"), 409
            g.db.delete(item)
            audit(g.db, "api_delete", "product", item.id)
            g.db.commit()
            return "", 204
        payload = request.get_json(silent=True) or {}
        for field in fields:
            if field in payload:
                value = payload[field]
                if field in {"net_weight_kg", "gross_weight_kg"}:
                    value = float(value) if value not in {None, ""} else None
                else:
                    value = str(value).strip()
                setattr(item, field, value)
        audit(g.db, "api_update", "product", item.id)
        g.db.commit()
        return jsonify({"id": item.id, **{field: getattr(item, field) for field in fields}})

    @app.route("/api/orders", methods=["GET", "POST"])
    @login_required
    def api_orders():
        if request.method == "GET":
            return jsonify([{"id": item.id, "po_no": item.po_no, "customer_id": item.customer_id, "product_id": item.product_id, "quantity": item.quantity, "carton_count": item.carton_count, "case_pack": item.case_pack, "date_code": item.date_code} for item in g.db.scalars(select(PurchaseOrder).order_by(PurchaseOrder.po_no))])
        if current_user().role != "admin":
            abort(403)
        payload = request.get_json(silent=True) or {}
        required = ("po_no", "customer_id", "product_id", "quantity")
        if any(payload.get(key) in {None, ""} for key in required):
            return jsonify(error="po_no, customer_id, product_id and quantity are required"), 422
        item = PurchaseOrder(po_no=str(payload["po_no"]).strip(), customer_id=int(payload["customer_id"]), product_id=int(payload["product_id"]), quantity=int(payload["quantity"]), carton_count=int(payload.get("carton_count") or 0), case_pack=int(payload.get("case_pack") or 0), date_code=str(payload.get("date_code", "")).strip())
        g.db.add(item)
        g.db.flush()
        audit(g.db, "api_create", "order", item.id)
        g.db.commit()
        return jsonify(id=item.id), 201

    @app.route("/api/orders/<int:item_id>", methods=["GET", "PATCH", "DELETE"])
    @login_required
    def api_order_item(item_id: int):
        item = g.db.get(PurchaseOrder, item_id)
        if not item:
            abort(404)
        fields = ("po_no", "customer_id", "product_id", "quantity", "carton_count", "case_pack", "date_code")
        if request.method == "GET":
            return jsonify({"id": item.id, **{field: getattr(item, field) for field in fields}})
        if current_user().role != "admin":
            abort(403)
        if request.method == "DELETE":
            used = g.db.scalar(select(func.count()).select_from(Report).where(Report.po_id == item.id)) or 0
            if used:
                return jsonify(error="order is used by inspection reports"), 409
            g.db.delete(item)
            audit(g.db, "api_delete", "order", item.id)
            g.db.commit()
            return "", 204
        payload = request.get_json(silent=True) or {}
        numeric_fields = {"customer_id", "product_id", "quantity", "carton_count", "case_pack"}
        for field in fields:
            if field in payload:
                setattr(item, field, int(payload[field]) if field in numeric_fields else str(payload[field]).strip())
        audit(g.db, "api_update", "order", item.id)
        g.db.commit()
        return jsonify({"id": item.id, **{field: getattr(item, field) for field in fields}})

    @app.route("/api/settings", methods=["GET", "PATCH"])
    @admin_required
    def api_settings():
        allowed = {"company_name", "report_title", "required_photo_categories"}
        if request.method == "GET":
            return jsonify({item.key: item.value for item in g.db.scalars(select(Setting).where(Setting.key.in_(allowed)))})
        payload = request.get_json(silent=True) or {}
        for key in allowed:
            if key in payload:
                item = g.db.get(Setting, key) or Setting(key=key, value="")
                item.value = str(payload[key]).strip()
                g.db.add(item)
        audit(g.db, "api_update", "settings", None)
        g.db.commit()
        return jsonify({item.key: item.value for item in g.db.scalars(select(Setting).where(Setting.key.in_(allowed)))})

    @app.patch("/api/photos/<int:photo_id>")
    @login_required
    def api_photo_update(photo_id: int):
        photo = g.db.get(Photo, photo_id)
        if not photo:
            abort(404)
        report = g.db.get(Report, photo.report_id)
        if report.finalized:
            return jsonify(error="finalized report photos are immutable"), 409
        payload = request.get_json(silent=True) or {}
        if "category" in payload:
            if payload["category"] not in PHOTO_CATEGORIES:
                return jsonify(error="invalid category"), 422
            photo.category = payload["category"]
        if "caption" in payload:
            photo.caption = str(payload["caption"])[:255]
        if "sort_order" in payload:
            photo.sort_order = max(0, int(payload["sort_order"]))
        refresh_result(g.db, report)
        audit(g.db, "api_update", "photo", photo.id)
        g.db.commit()
        return jsonify(id=photo.id, category=photo.category, caption=photo.caption, sort_order=photo.sort_order)

    @app.route("/api/test-templates", methods=["GET", "POST"])
    @admin_required
    def api_test_templates():
        if request.method == "GET":
            return jsonify([{"id": item.id, "name": item.name, "standard": item.standard, "required": item.required, "active": item.active, "sort_order": item.sort_order} for item in g.db.scalars(select(TestTemplate).order_by(TestTemplate.sort_order, TestTemplate.id))])
        payload = request.get_json(silent=True) or {}
        if not str(payload.get("name", "")).strip():
            return jsonify(error="name is required"), 422
        item = TestTemplate(name=str(payload["name"]).strip(), standard=str(payload.get("standard", "")).strip(), required=bool(payload.get("required", False)), active=bool(payload.get("active", True)), sort_order=int(payload.get("sort_order", 0)))
        g.db.add(item)
        g.db.flush()
        audit(g.db, "api_create", "test_template", item.id)
        g.db.commit()
        return jsonify(id=item.id), 201

    @app.route("/api/test-templates/<int:item_id>", methods=["GET", "PATCH", "DELETE"])
    @admin_required
    def api_test_template_item(item_id: int):
        item = g.db.get(TestTemplate, item_id)
        if not item:
            abort(404)
        if request.method == "GET":
            return jsonify(id=item.id, name=item.name, standard=item.standard, required=item.required, active=item.active, sort_order=item.sort_order)
        if request.method == "DELETE":
            g.db.delete(item)
            audit(g.db, "api_delete", "test_template", item.id)
            g.db.commit()
            return "", 204
        payload = request.get_json(silent=True) or {}
        for field in ("name", "standard"):
            if field in payload:
                setattr(item, field, str(payload[field]).strip())
        for field in ("required", "active"):
            if field in payload:
                setattr(item, field, bool(payload[field]))
        if "sort_order" in payload:
            item.sort_order = int(payload["sort_order"])
        audit(g.db, "api_update", "test_template", item.id)
        g.db.commit()
        return jsonify(id=item.id, name=item.name, standard=item.standard, required=item.required, active=item.active, sort_order=item.sort_order)

    @app.route("/api/photo-checklist-templates", methods=["GET", "POST"])
    @admin_required
    def api_photo_checklist_templates():
        fields = ("customer_id", "product_id", "slot_key", "label", "instruction", "example_path", "required", "category", "sort_order", "active")
        if request.method == "GET":
            return jsonify([{"id": item.id, **{field: getattr(item, field) for field in fields}} for item in g.db.scalars(select(PhotoChecklistTemplate).order_by(PhotoChecklistTemplate.sort_order, PhotoChecklistTemplate.id))])
        payload = request.get_json(silent=True) or {}
        if not str(payload.get("slot_key", "")).strip() or not str(payload.get("label", "")).strip() or str(payload.get("category", "other")) not in PHOTO_CATEGORIES:
            return jsonify(error="slot_key, label and valid category are required"), 422
        item = PhotoChecklistTemplate(
            customer_id=int(payload["customer_id"]) if payload.get("customer_id") else None,
            product_id=int(payload["product_id"]) if payload.get("product_id") else None,
            slot_key=str(payload["slot_key"]).strip()[:80],
            label=str(payload["label"]).strip()[:180],
            instruction=str(payload.get("instruction", "")).strip(),
            example_path=str(payload.get("example_path", "")).strip(),
            required=bool(payload.get("required", False)),
            category=str(payload.get("category", "other")),
            sort_order=int(payload.get("sort_order", 0)),
            active=bool(payload.get("active", True)),
        )
        g.db.add(item)
        g.db.flush()
        audit(g.db, "api_create", "photo_checklist_template", item.id)
        g.db.commit()
        return jsonify(id=item.id), 201

    @app.route("/api/photo-checklist-templates/<int:item_id>", methods=["GET", "PATCH", "DELETE"])
    @admin_required
    def api_photo_checklist_template_item(item_id: int):
        item = g.db.get(PhotoChecklistTemplate, item_id)
        if not item:
            abort(404)
        fields = ("customer_id", "product_id", "slot_key", "label", "instruction", "example_path", "required", "category", "sort_order", "active")
        if request.method == "GET":
            return jsonify({"id": item.id, **{field: getattr(item, field) for field in fields}})
        if request.method == "DELETE":
            used = g.db.scalar(select(func.count()).select_from(ReportPhotoSlot).where(ReportPhotoSlot.template_slot_id == item.id)) or 0
            if used:
                item.active = False
                audit(g.db, "api_deactivate", "photo_checklist_template", item.id, f"used:{used}")
                g.db.commit()
                return jsonify(id=item.id, active=False, message="used template was deactivated")
            g.db.delete(item)
            audit(g.db, "api_delete", "photo_checklist_template", item.id)
            g.db.commit()
            return "", 204
        payload = request.get_json(silent=True) or {}
        for field in fields:
            if field not in payload:
                continue
            if field in {"customer_id", "product_id"}:
                value = int(payload[field]) if payload[field] else None
            elif field == "sort_order":
                value = int(payload[field])
            elif field in {"required", "active"}:
                value = bool(payload[field])
            else:
                value = str(payload[field]).strip()
            setattr(item, field, value)
        if item.category not in PHOTO_CATEGORIES or not item.slot_key or not item.label:
            return jsonify(error="invalid photo checklist template"), 422
        audit(g.db, "api_update", "photo_checklist_template", item.id)
        g.db.commit()
        return jsonify({"id": item.id, **{field: getattr(item, field) for field in fields}})

    @app.route("/api/defect-categories", methods=["GET", "POST"])
    @admin_required
    def api_defect_categories():
        if request.method == "GET":
            return jsonify([{"id": item.id, "name": item.name, "default_severity": item.default_severity, "active": item.active, "sort_order": item.sort_order} for item in g.db.scalars(select(DefectCategory).order_by(DefectCategory.sort_order, DefectCategory.id))])
        payload = request.get_json(silent=True) or {}
        severity = str(payload.get("default_severity", "minor")).lower()
        if not str(payload.get("name", "")).strip() or severity not in {"critical", "major", "minor"}:
            return jsonify(error="name and a valid default_severity are required"), 422
        item = DefectCategory(name=str(payload["name"]).strip(), default_severity=severity, active=bool(payload.get("active", True)), sort_order=int(payload.get("sort_order", 0)))
        g.db.add(item)
        g.db.flush()
        audit(g.db, "api_create", "defect_category", item.id)
        g.db.commit()
        return jsonify(id=item.id), 201

    @app.route("/api/defect-categories/<int:item_id>", methods=["GET", "PATCH", "DELETE"])
    @admin_required
    def api_defect_category_item(item_id: int):
        item = g.db.get(DefectCategory, item_id)
        if not item:
            abort(404)
        if request.method == "GET":
            return jsonify(id=item.id, name=item.name, default_severity=item.default_severity, active=item.active, sort_order=item.sort_order)
        if request.method == "DELETE":
            g.db.delete(item)
            audit(g.db, "api_delete", "defect_category", item.id)
            g.db.commit()
            return "", 204
        payload = request.get_json(silent=True) or {}
        if "name" in payload and str(payload["name"]).strip():
            item.name = str(payload["name"]).strip()
        if "default_severity" in payload:
            severity = str(payload["default_severity"]).lower()
            if severity not in {"critical", "major", "minor"}:
                return jsonify(error="invalid default_severity"), 422
            item.default_severity = severity
        if "active" in payload:
            item.active = bool(payload["active"])
        if "sort_order" in payload:
            item.sort_order = int(payload["sort_order"])
        audit(g.db, "api_update", "defect_category", item.id)
        g.db.commit()
        return jsonify(id=item.id, name=item.name, default_severity=item.default_severity, active=item.active, sort_order=item.sort_order)

    @app.route("/api/aql-rules", methods=["GET", "POST"])
    @admin_required
    def api_aql_rules():
        fields = ("standard", "version", "inspection_level", "lot_min", "lot_max", "sample_size", "severity", "aql", "accept", "reject", "active")
        if request.method == "GET":
            return jsonify([{"id": item.id, **{field: getattr(item, field) for field in fields}} for item in g.db.scalars(select(AQLRule).order_by(AQLRule.lot_min, AQLRule.severity, AQLRule.aql))])
        payload = request.get_json(silent=True) or {}
        required = ("lot_min", "lot_max", "sample_size", "severity", "aql", "accept", "reject")
        if any(payload.get(key) in {None, ""} for key in required) or str(payload.get("severity", "")).lower() not in {"critical", "major", "minor"}:
            return jsonify(error="complete AQL rule fields are required"), 422
        item = AQLRule(
            standard=str(payload.get("standard", "ANSI/ASQ Z1.4")).strip(), version=str(payload.get("version", "company-authorized")).strip(), inspection_level=str(payload.get("inspection_level", "II")).strip(),
            lot_min=int(payload["lot_min"]), lot_max=int(payload["lot_max"]), sample_size=int(payload["sample_size"]), severity=str(payload["severity"]).lower(),
            aql=float(payload["aql"]), accept=int(payload["accept"]), reject=int(payload["reject"]), active=bool(payload.get("active", True)),
        )
        if item.lot_min < 1 or item.lot_max < item.lot_min or item.sample_size < 1 or item.reject <= item.accept:
            return jsonify(error="invalid lot, sample, or Ac/Re range"), 422
        g.db.add(item)
        g.db.flush()
        audit(g.db, "api_create", "aql_rule", item.id)
        g.db.commit()
        return jsonify(id=item.id), 201

    @app.route("/api/aql-rules/<int:item_id>", methods=["GET", "PATCH", "DELETE"])
    @admin_required
    def api_aql_rule_item(item_id: int):
        item = g.db.get(AQLRule, item_id)
        if not item:
            abort(404)
        fields = ("standard", "version", "inspection_level", "lot_min", "lot_max", "sample_size", "severity", "aql", "accept", "reject", "active")
        if request.method == "GET":
            return jsonify({"id": item.id, **{field: getattr(item, field) for field in fields}})
        if request.method == "DELETE":
            g.db.delete(item)
            audit(g.db, "api_delete", "aql_rule", item.id)
            g.db.commit()
            return "", 204
        payload = request.get_json(silent=True) or {}
        integer_fields = {"lot_min", "lot_max", "sample_size", "accept", "reject"}
        for field in fields:
            if field not in payload:
                continue
            if field in integer_fields:
                value = int(payload[field])
            elif field == "aql":
                value = float(payload[field])
            elif field == "active":
                value = bool(payload[field])
            else:
                value = str(payload[field]).strip()
            setattr(item, field, value)
        item.severity = item.severity.lower()
        if item.severity not in {"critical", "major", "minor"} or item.lot_min < 1 or item.lot_max < item.lot_min or item.sample_size < 1 or item.reject <= item.accept:
            return jsonify(error="invalid AQL rule"), 422
        audit(g.db, "api_update", "aql_rule", item.id)
        g.db.commit()
        return jsonify({"id": item.id, **{field: getattr(item, field) for field in fields}})

    @app.post("/api/aql/calculate")
    @login_required
    def api_aql_calculate():
        payload = request.get_json(silent=True) or {}
        lot = int(payload.get("lot_quantity") or 0)
        level = str(payload.get("inspection_level") or "II")
        output = {}
        for severity in ("critical", "major", "minor"):
            aql = float(payload.get(f"{severity}_aql") or (0 if severity == "critical" else 1.0 if severity == "major" else 4.0))
            rule = g.db.scalar(select(AQLRule).where(AQLRule.active.is_(True), AQLRule.inspection_level == level, AQLRule.severity == severity, AQLRule.aql == aql, AQLRule.lot_min <= lot, AQLRule.lot_max >= lot).order_by(AQLRule.id.desc()))
            output[severity] = {"aql": aql, "sample_size": rule.sample_size, "accept": rule.accept, "reject": rule.reject} if rule else None
        if not all(output.values()):
            return jsonify(error="Authorized AQL rule is not configured", rules=output), 422
        return jsonify(rules=output, sample_size=max(v["sample_size"] for v in output.values()))

    @app.route("/admin", methods=["GET", "POST"])
    @admin_required
    def admin():
        if request.method == "POST":
            action = request.form.get("action")
            if action == "customer":
                g.db.add(Customer(name=request.form["name"].strip(), country=request.form.get("country", "").strip(), address=request.form.get("address", "").strip()))
            elif action == "product":
                g.db.add(Product(item_no=request.form["item_no"].strip(), description=request.form["description"].strip(), size_mm=request.form.get("size_mm", "").strip(), barcode=request.form.get("barcode", "").strip(), age_grade=request.form.get("age_grade", "").strip(), origin=request.form.get("origin", "CHINA").strip()))
            elif action == "order":
                g.db.add(PurchaseOrder(po_no=request.form["po_no"].strip(), customer_id=request.form.get("customer_id", type=int), product_id=request.form.get("product_id", type=int), quantity=request.form.get("quantity", type=int), carton_count=request.form.get("carton_count", type=int) or 0, case_pack=request.form.get("case_pack", type=int) or 0, date_code=request.form.get("date_code", "").strip()))
            elif action == "aql":
                g.db.add(AQLRule(standard=request.form.get("standard", "ANSI/ASQ Z1.4"), version=request.form.get("version", "company-authorized"), inspection_level=request.form.get("inspection_level", "II"), lot_min=request.form.get("lot_min", type=int), lot_max=request.form.get("lot_max", type=int), sample_size=request.form.get("sample_size", type=int), severity=request.form.get("severity", "minor"), aql=request.form.get("aql", type=float), accept=request.form.get("accept", type=int), reject=request.form.get("reject", type=int)))
            elif action == "test_template":
                g.db.add(TestTemplate(name=request.form["name"].strip(), standard=request.form.get("standard", "").strip(), required=request.form.get("required") == "on", active=True, sort_order=request.form.get("sort_order", type=int) or 0))
            elif action == "defect_category":
                severity = request.form.get("default_severity", "minor")
                if severity not in {"critical", "major", "minor"}:
                    abort(400)
                g.db.add(DefectCategory(name=request.form["name"].strip(), default_severity=severity, active=True, sort_order=request.form.get("sort_order", type=int) or 0))
            elif action == "photo_slot":
                category = request.form.get("category", "other")
                if category not in PHOTO_CATEGORIES:
                    abort(400)
                g.db.add(PhotoChecklistTemplate(customer_id=request.form.get("customer_id", type=int), product_id=request.form.get("product_id", type=int), slot_key=request.form["slot_key"].strip()[:80], label=request.form["label"].strip()[:180], instruction=request.form.get("instruction", "").strip(), required=request.form.get("required") == "on", category=category, sort_order=request.form.get("sort_order", type=int) or 0, active=True))
            elif action == "user":
                password = request.form.get("password", "")
                if len(password) < 10:
                    flash("密码至少需要 10 位。", "error")
                    return redirect(url_for("admin"))
                g.db.add(User(username=request.form["username"].strip().lower(), name=request.form["name"].strip(), role=request.form.get("role", "qc"), password_hash=generate_password_hash(password)))
            elif action == "settings":
                for key in ("company_name", "report_title", "required_photo_categories"):
                    item = g.db.get(Setting, key) or Setting(key=key, value="")
                    item.value = request.form.get(key, "").strip()
                    g.db.add(item)
                logo = request.files.get("logo")
                if logo and logo.filename:
                    destination = Path(app.config["STORAGE_ROOT"]) / "branding" / "company-logo.jpg"
                    process_uploaded_image(logo, destination)
                    logo_setting = g.db.get(Setting, "logo_path") or Setting(key="logo_path", value="")
                    logo_setting.value = str(destination)
                    g.db.add(logo_setting)
            else:
                abort(400)
            audit(g.db, "admin_create", action or "unknown", None)
            g.db.commit()
            flash("基础资料已保存。", "success")
            return redirect(url_for("admin"))
        return render_template(
            "admin.html",
            customers=list(g.db.scalars(select(Customer).order_by(Customer.name)).all()),
            products=list(g.db.scalars(select(Product).order_by(Product.item_no)).all()),
            orders=list(g.db.scalars(select(PurchaseOrder).order_by(PurchaseOrder.po_no)).all()),
            aql_rules=list(g.db.scalars(select(AQLRule).order_by(AQLRule.lot_min, AQLRule.severity)).all()),
            test_templates=list(g.db.scalars(select(TestTemplate).order_by(TestTemplate.sort_order, TestTemplate.id)).all()),
            defect_categories=list(g.db.scalars(select(DefectCategory).order_by(DefectCategory.sort_order, DefectCategory.id)).all()),
            photo_checklist_templates=list(g.db.scalars(select(PhotoChecklistTemplate).order_by(PhotoChecklistTemplate.sort_order, PhotoChecklistTemplate.id)).all()),
            users=list(g.db.scalars(select(User).order_by(User.username)).all()),
            settings={item.key: item.value for item in g.db.scalars(select(Setting)).all()},
        )

    @app.get("/admin/audit")
    @admin_required
    def audit_page():
        logs = list(g.db.scalars(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(300)).all())
        return render_template("audit.html", logs=logs)


def seed_database(db, *, include_sample_data: bool = False):
    try:
        if not db.scalar(select(func.count()).select_from(User)):
            admin_pw = os.getenv("ADMIN_PASSWORD")
            qc_pw = os.getenv("QC_PASSWORD")
            if not admin_pw or not qc_pw:
                from flask import current_app
                if current_app.config.get("TESTING"):
                    admin_pw = admin_pw or "Admin@12345"
                    qc_pw = qc_pw or "QC@12345"
                else:
                    raise RuntimeError("ADMIN_PASSWORD/QC_PASSWORD 未配置，无法初始化账号")
            db.add_all([
                User(username="admin", name="系统管理员", role="admin", password_hash=generate_password_hash(admin_pw)),
                User(username="qc", name="QC Inspector", role="qc", password_hash=generate_password_hash(qc_pw)),
            ])
        if include_sample_data:
            customer = db.scalar(select(Customer).where(Customer.name == "Zanzoon"))
            if not customer:
                customer = Customer(name="Zanzoon", country="ARGENTINA", address="90 rue de Villiers, 92300 Levallois-Perret, France")
                db.add(customer)
                db.flush()
            product = db.scalar(select(Product).where(Product.item_no == "5226155"))
            if not product:
                product = Product(item_no="5226155", description="Pokémon Trainer Expert", size_mm="260 x 70 x 260", net_weight_kg=0.229, gross_weight_kg=0.656, barcode="8431524502305", age_grade="6+", origin="CHINA")
                db.add(product)
                db.flush()
            if not db.scalar(select(PurchaseOrder).where(PurchaseOrder.po_no == "PO-26032401")):
                db.add(PurchaseOrder(po_no="PO-26032401", customer_id=customer.id, product_id=product.id, quantity=2004, carton_count=334, case_pack=6, date_code="261521ES"))
            existing_rules = db.scalar(select(func.count()).select_from(AQLRule)) or 0
            if not existing_rules:
                db.add_all([
                    AQLRule(lot_min=1201, lot_max=3200, sample_size=125, severity="critical", aql=0, accept=0, reject=1),
                    AQLRule(lot_min=1201, lot_max=3200, sample_size=125, severity="major", aql=1.0, accept=3, reject=4),
                    AQLRule(lot_min=1201, lot_max=3200, sample_size=125, severity="minor", aql=4.0, accept=10, reject=11),
                ])
        if not db.scalar(select(func.count()).select_from(TestTemplate)):
            db.add_all([TestTemplate(name=name, standard=standard, required=required, sort_order=index) for index, (name, standard, required) in enumerate(DEFAULT_TESTS)])
            db.flush()
        if not db.get(Setting, "ai_workflow_defaults_v1"):
            default_test_names = {name for name, _standard, required in DEFAULT_TESTS if required}
            for template in db.scalars(select(TestTemplate).where(TestTemplate.name.in_(default_test_names))):
                template.required = True
            db.add(Setting(key="ai_workflow_defaults_v1", value="applied"))
        if not db.get(Setting, "ai_workflow_defaults_v2"):
            existing_test_names = set(db.scalars(select(TestTemplate.name)).all())
            next_order = (db.scalar(select(func.max(TestTemplate.sort_order))) or 0) + 1
            for name, standard, required in DEFAULT_TESTS:
                if name not in existing_test_names:
                    db.add(TestTemplate(name=name, standard=standard, required=required, sort_order=next_order))
                    next_order += 1
            db.add(Setting(key="ai_workflow_defaults_v2", value="applied"))
        if not db.scalar(select(func.count()).select_from(PhotoChecklistTemplate)):
            db.add_all([
                PhotoChecklistTemplate(slot_key=slot_key, label=label, instruction=instruction, required=required, category=category, sort_order=index)
                for index, (slot_key, label, instruction, required, category) in enumerate(DEFAULT_PHOTO_SLOTS)
            ])
        if not db.scalar(select(func.count()).select_from(DefectCategory)):
            db.add_all([
                DefectCategory(name="DIRTY MARK", default_severity="minor", sort_order=0),
                DefectCategory(name="COLOR VARIATION", default_severity="minor", sort_order=1),
                DefectCategory(name="FUNCTION FAILURE", default_severity="major", sort_order=2),
                DefectCategory(name="SHARP POINT", default_severity="critical", sort_order=3),
            ])
        defaults = {
            "company_name": "Dongguan Hanson Plastic Product Ltd",
            "report_title": "QUALITY INSPECTION REPORT",
            "required_photo_categories": "product,packaging,warehouse",
            "logo_path": "",
        }
        for key, value in defaults.items():
            if not db.get(Setting, key):
                db.add(Setting(key=key, value=value))
        db.commit()
    finally:
        db.close()


app = None if os.getenv("QC_SKIP_APP_INIT", "false").lower() == "true" else create_app()


if __name__ == "__main__":
    if app is None:
        raise RuntimeError("QC_SKIP_APP_INIT cannot be enabled when starting the web application")
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "8000")), debug=os.getenv("FLASK_DEBUG", "false").lower() == "true")
