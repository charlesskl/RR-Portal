"""PaddleOCR 备援 — 云端镜像禁用。

云端镜像不带 PaddleOCR (paddlepaddle ~600MB + paddleocr ~100MB 太重，
跟 ECS 4 GiB RAM / 3 Mbps 带宽不匹配)。OCR 路径只走阿里云百炼通义千问 VL
(app/services/ocr_llm.py)。LLM 失败时不再静默回退，让用户知道需要复盘配置。

要在本地启用真正的 PaddleOCR 路径：
1. requirements.txt 加 `paddlepaddle` 和 `paddleocr`
2. Dockerfile 装回 `libglib2.0-0 libgl1`
3. 把本文件恢复成 git history 里 PaddleOCR 实现版本
"""
from __future__ import annotations


class OCRDisabledError(RuntimeError):
    """本地 PaddleOCR 备援被调用但镜像里没装。"""


def parse_image(image_bytes: bytes, pigment_lookup) -> list[dict]:
    raise OCRDisabledError(
        "本地 PaddleOCR 备援已禁用（云端镜像未安装）。"
        "请检查 BAILIAN_API_KEY 是否配置、阿里云百炼端点是否可达。"
    )


def build_pigment_lookup() -> dict[str, int]:
    """色粉编号 → DB id 索引，LLM 路径和 PaddleOCR 路径都用。"""
    from app.models import Pigment
    lookup: dict[str, int] = {}
    for p in Pigment.query.filter_by(is_archived=False).all():
        if p.code:
            lookup[p.code.lower()] = p.id
        if p.purchase_code:
            lookup[p.purchase_code.lower()] = p.id
    return lookup
