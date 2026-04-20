"""PaddleOCR 单据识别服务。

输入图片字节,返回按行聚合的解析结果:
[{"raw": "原始拼接文本", "pigment_id": 12 or None, "quantity": 5.0, "unit_price": 12.5}, ...]

命中"配方""明细""料号"等起始标记后开始收集;遇到"合计""总计"等停止。
未命中任何起始标记时退化为全表解析。
"""
from __future__ import annotations

import io
import re
import threading

from PIL import Image, ImageOps
import numpy as np

_ocr_lock = threading.Lock()
_ocr_engine = None


def _get_engine():
    global _ocr_engine
    if _ocr_engine is None:
        with _ocr_lock:
            if _ocr_engine is None:
                from paddleocr import PaddleOCR
                _ocr_engine = PaddleOCR(use_angle_cls=True, lang="ch", show_log=False)
    return _ocr_engine


def _ocr_array(arr):
    result = _get_engine().ocr(arr, cls=True)
    if not result:
        return []
    page = result[0] or []
    items = []
    for entry in page:
        bbox, (text, conf) = entry[0], entry[1]
        ys = [p[1] for p in bbox]
        xs = [p[0] for p in bbox]
        items.append({
            "text": text.strip(),
            "conf": float(conf),
            "y": sum(ys) / 4,
            "x_min": min(xs),
            "x_max": max(xs),
            "h": max(ys) - min(ys),
        })
    return items


def _score(items):
    """命中起始标记 +100;否则按总字符数 × 平均置信度。"""
    joined = "".join(it["text"] for it in items)
    bonus = 100 if any(m in joined for m in START_MARKERS) else 0
    if not items:
        return 0
    avg_conf = sum(it["conf"] for it in items) / len(items)
    return bonus + len(joined) * avg_conf


def _raw_ocr(image_bytes: bytes):
    """自动尝试 4 个方向,选分数最高的。"""
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("RGB")
    best_items, best_score = [], -1
    for angle in (0, 90, 180, 270):
        rotated = img if angle == 0 else img.rotate(-angle, expand=True)
        items = _ocr_array(np.array(rotated))
        s = _score(items)
        if s > best_score:
            best_score, best_items = s, items
    return best_items


def _group_rows(items):
    items = sorted(items, key=lambda it: it["y"])
    rows = []
    for it in items:
        h = max(it["h"], 10)
        placed = False
        for row in rows:
            avg_y = sum(x["y"] for x in row) / len(row)
            if abs(it["y"] - avg_y) < h * 0.8:
                row.append(it)
                placed = True
                break
        if not placed:
            rows.append([it])
    return [sorted(r, key=lambda it: it["x_min"]) for r in rows]


NUM_RE = re.compile(r"\d+(?:,\d{3})*(?:\.\d+)?")


def _first_marker_pos(rows, markers):
    for i, row in enumerate(rows):
        raw = " ".join(it["text"] for it in row)
        if any(m in raw for m in markers):
            return i
    return None
START_MARKERS = ("配方", "明细", "料号", "产品编号", "序号",
                 "货号", "品名", "产品名称", "品号", "色粉编号")
STOP_MARKERS = ("合计", "总计", "数量合计", "总重", "车间", "制单",
                "约定", "条款", "签收", "客户如", "如有",
                "备注:", "备注:", "开户", "材质:", "材质:", "每份:", "每份:")
SKIP_KEYWORDS = ("ADD", "TEL", "FAX", "Date", "电话", "地址", "手机",
                 "公司", "客户:", "送货单号", "制表", "开户行", "主任",
                 "送货单", "发货单", "收货单", "出库单", "入库单", "订货单",
                 "客户名称", "供应商", "NO.", "NO:", "单号")
UNIT_TOKENS = {"kg", "g", "克", "千克", "公斤", "只", "包", "袋", "桶"}
SPLIT_RE = re.compile(r"[\s/\-、,,:]+")


def _lookup_token(token, pigment_lookup):
    """直查 → 去 A/B 冲淡前缀 → 返回命中的 id 或 None。"""
    if not token:
        return None
    if token in pigment_lookup:
        return pigment_lookup[token]
    if token[0] in ("a", "b") and len(token) > 1:
        stripped = token[1:]
        if stripped in pigment_lookup:
            return pigment_lookup[stripped]
    return None


def _parse_row(row, pigment_lookup):
    raw = " ".join(it["text"] for it in row)
    pigment_id = None
    match_idx = -1
    purchase_code = ""
    for idx, it in enumerate(row):
        token = it["text"].strip()
        low = token.lower()
        hit = _lookup_token(low, pigment_lookup)
        if hit is None:
            for sub in SPLIT_RE.split(low):
                hit = _lookup_token(sub, pigment_lookup)
                if hit is not None:
                    break
        if hit is not None:
            pigment_id = hit
            match_idx = idx
            if not purchase_code:
                purchase_code = token
            break
        # 未匹配时取最左 token 作为进货色粉编号候选(含中文也接受)
        if (not purchase_code and 1 <= len(token) <= 20
                and low not in UNIT_TOKENS
                and not any(m in token for m in START_MARKERS)
                and not token.startswith((".", "-"))):
            purchase_code = token
    # 数字从色号 token 之后收集;未匹配时假定首 token 为色号
    if match_idx >= 0:
        num_source = row[match_idx + 1:]
    elif len(row) >= 2:
        num_source = row[1:]
    else:
        num_source = row
    nums = [float(m.replace(",", "")) for it in num_source for m in NUM_RE.findall(it["text"])]
    if pigment_id is None and not nums:
        return None
    # 格式推断:
    # ≥3 个数字 → 「…数量 单价 金额」取倒数第三、第二
    # 恰好 2 个 → 若后者 ≈ 前者 × 正整数(2-1000),视为「单价 金额」,反推数量
    # 其他      → 首个为数量,次个为单价
    if len(nums) >= 3:
        quantity = nums[-3]
        unit_price = nums[-2]
    elif len(nums) == 2 and nums[0] > 0:
        ratio = nums[1] / nums[0]
        nearest = round(ratio)
        if 2 <= nearest <= 1000 and abs(ratio - nearest) < 0.02:
            quantity = float(nearest)
            unit_price = nums[0]
        else:
            quantity = nums[0]
            unit_price = nums[1]
    elif nums:
        quantity = nums[0]
        unit_price = 0.0
    else:
        quantity = 0.0
        unit_price = 0.0
    return {
        "raw": raw,
        "pigment_id": pigment_id,
        "purchase_code": purchase_code,
        "quantity": quantity,
        "unit_price": unit_price,
    }


def parse_image(image_bytes: bytes, pigment_lookup: dict[str, int]) -> list[dict]:
    items = _raw_ocr(image_bytes)
    rows = _group_rows(items)
    # 倒序检测:若"合计/总计"出现在"配方"之前,说明行序被翻转(例如图片 180° 旋转),
    # 整体倒序一遍,让起始标记重回顶部。
    stop_pos = _first_marker_pos(rows, ("合计", "总计"))
    start_pos = _first_marker_pos(rows, START_MARKERS)
    if stop_pos is not None and start_pos is not None and stop_pos < start_pos:
        rows = [list(reversed(r)) for r in reversed(rows)]
    parsed = []
    started = False
    for row in rows:
        raw = " ".join(it["text"] for it in row)
        if not started:
            if any(m in raw for m in START_MARKERS):
                started = True
            else:
                continue
        if any(m in raw for m in STOP_MARKERS):
            break
        if any(k in raw for k in SKIP_KEYWORDS):
            continue
        r = _parse_row(row, pigment_lookup)
        if r is not None and _is_valid(r):
            parsed.append(r)
    if not started:
        for row in rows:
            raw = " ".join(it["text"] for it in row)
            if any(k in raw for k in SKIP_KEYWORDS):
                continue
            if any(m in raw for m in STOP_MARKERS):
                break
            r = _parse_row(row, pigment_lookup)
            if r is not None and _is_valid(r):
                parsed.append(r)
    return parsed


def _is_valid(r):
    """过滤掉明显错误的行:数量/单价超合理范围,或无色号候选;
    也排除"纯数字 purchase_code 恰好等于数量"的情况(说明本行缺真正编号)。"""
    if r["pigment_id"] is None and not r["purchase_code"]:
        return False
    if r["quantity"] <= 0 or r["quantity"] >= 100000:
        return False
    if r["unit_price"] >= 1000000:
        return False
    pc = r["purchase_code"]
    if r["pigment_id"] is None and pc and pc.isdigit():
        try:
            if float(pc) == r["quantity"]:
                return False
        except ValueError:
            pass
    return True


def build_pigment_lookup() -> dict[str, int]:
    from app.models import Pigment
    lookup = {}
    for p in Pigment.query.filter_by(is_archived=False).all():
        if p.code:
            lookup[p.code.lower()] = p.id
        if p.purchase_code:
            lookup[p.purchase_code.lower()] = p.id
    return lookup
