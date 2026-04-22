"""通过阿里云百炼 (Bailian) 的 OpenAI 兼容端点调用通义千问 VL 识别送货单 / 出入库单。

云端 ECS 在中国大陆，百炼国内直连稳定。

环境变量:
  BAILIAN_API_KEY     必填, 阿里云百炼 API key
                       (https://bailian.console.aliyun.com/?tab=model#/api-key)
  BAILIAN_MODEL       可选, 默认 qwen-vl-max-latest
  BAILIAN_BASE_URL    可选, 默认 https://dashscope.aliyuncs.com/compatible-mode/v1
"""
from __future__ import annotations

import base64
import json
import os
import re

import requests

DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_MODEL = "qwen-vl-max-latest"

SYSTEM_PROMPT = """你是一个送货单/出入库单识别助手。
给你一张图片,请只返回 JSON 数组,格式:
[{"purchase_code": "色粉/进货编号", "name": "品名或颜色", "quantity": 数字, "unit_price": 数字}]

规则:
- 只返回商品明细行,跳过表头、合计/总计、公司抬头、日期、备注、大写金额等。
- quantity 是数字(不带单位),unit_price 去掉 ¥/￥/Y 符号和千分位逗号。
- purchase_code 取最能唯一定位商品的编号(如 FK-20、89047色种、94387);若只有名称则编号留空。
- 如果图片里没有商品行,返回 []。
"""


class LLMOCRError(Exception):
    pass


def parse_image_llm(
    image_bytes: bytes,
    pigment_lookup: dict[str, int],
    timeout: int = 60,
) -> list[dict]:
    api_key = os.environ.get("BAILIAN_API_KEY", "").strip()
    if not api_key:
        raise LLMOCRError("BAILIAN_API_KEY 未设置")
    model = os.environ.get("BAILIAN_MODEL", "").strip() or DEFAULT_MODEL
    base = (os.environ.get("BAILIAN_BASE_URL", "").strip().rstrip("/") or DEFAULT_BASE_URL)
    url = f"{base}/chat/completions"

    b64 = base64.b64encode(image_bytes).decode("ascii")
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "请识别并严格按 JSON 数组返回。"},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                ],
            },
        ],
        "temperature": 0,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=timeout)
    except requests.RequestException as e:
        raise LLMOCRError(f"网络错误:{e}") from e
    if resp.status_code != 200:
        raise LLMOCRError(f"HTTP {resp.status_code}: {resp.text[:500]}")
    try:
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
    except (KeyError, ValueError, IndexError, TypeError) as e:
        raise LLMOCRError(f"响应结构异常:{e} / {resp.text[:300]}") from e
    if not isinstance(content, str):
        raise LLMOCRError(f"content 不是字符串: {type(content).__name__}")

    rows = _extract_json_array(content)
    return [_normalize_row(r, pigment_lookup) for r in rows if isinstance(r, dict)]


_FENCE_RE = re.compile(r"```(?:json)?\s*(.+?)\s*```", re.DOTALL)


def _extract_json_array(content: str):
    m = _FENCE_RE.search(content)
    if m:
        content = m.group(1)
    start = content.find("[")
    end = content.rfind("]")
    if start < 0 or end <= start:
        raise LLMOCRError(f"响应里找不到 JSON 数组:{content[:300]}")
    try:
        return json.loads(content[start:end + 1])
    except json.JSONDecodeError as e:
        raise LLMOCRError(f"JSON 解析失败:{e}") from e


def _to_float(v) -> float:
    if v is None:
        return 0.0
    s = str(v).strip().replace(",", "").replace("￥", "").replace("¥", "")
    s = re.sub(r"[^0-9.\-]", "", s)
    try:
        return float(s) if s else 0.0
    except ValueError:
        return 0.0


def _normalize_row(r: dict, pigment_lookup: dict[str, int]) -> dict:
    code = str(r.get("purchase_code") or "").strip()
    name = str(r.get("name") or "").strip()
    qty = _to_float(r.get("quantity"))
    price = _to_float(r.get("unit_price"))
    pigment_id = None
    if code:
        low = code.lower()
        pigment_id = pigment_lookup.get(low)
        if pigment_id is None and low.startswith(("a", "b")) and len(low) > 1:
            pigment_id = pigment_lookup.get(low[1:])
    return {
        "raw": f"{code} {name} {qty} {price}".strip(),
        "pigment_id": pigment_id,
        "purchase_code": code,
        "quantity": qty,
        "unit_price": price,
    }
