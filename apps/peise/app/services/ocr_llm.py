"""通过 OpenRouter 路由的多模态 LLM 识别送货单 / 出入库单。

OpenRouter 是 unified gateway，后端可以是 Gemini / Claude / GPT-4o / Qwen-VL / Gemma 等任何
多模态模型。云端 ECS 在中国大陆，原 Gemini 直连 + Cloudflare Worker `*.workers.dev` 都被 GFW 屏
蔽，OpenRouter 自有域名 `openrouter.ai` 通畅。

环境变量:
  OPENROUTER_API_KEY     必填 (https://openrouter.ai/keys)
  OPENROUTER_MODEL       可选, 默认 google/gemma-4-31b-it:free (免费 vision，
                          262k context). 也可以换成:
                          - google/gemini-2.5-flash (付费，质量高，每张约 ¥0.005)
                          - anthropic/claude-haiku-4.5 (付费，3x 价)
                          - 任何 https://openrouter.ai/models 多模态模型
  OPENROUTER_BASE_URL    可选, 默认 https://openrouter.ai/api/v1
"""
from __future__ import annotations

import base64
import json
import os
import re

import requests

DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "google/gemma-4-31b-it:free"

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
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise LLMOCRError("OPENROUTER_API_KEY 未设置")
    model = os.environ.get("OPENROUTER_MODEL", "").strip() or DEFAULT_MODEL
    base = (os.environ.get("OPENROUTER_BASE_URL", "").strip().rstrip("/") or DEFAULT_BASE_URL)
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
        # OpenRouter 推荐填这两个 header 用于 attribution / 排队优先级
        "HTTP-Referer": "https://8.148.146.194/peise/",
        "X-Title": "RR Portal - peise OCR",
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
