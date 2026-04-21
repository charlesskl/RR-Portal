"""一次性诊断:用 OpenRouter Gemma 4 31B 识别指定图片,打印原始响应与解析结果。"""
import io, os, sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import create_app
from app.services.ocr_llm import parse_image_llm
from app.services.ocr import build_pigment_lookup

IMG = sys.argv[1] if len(sys.argv) > 1 else (
    r"d:\xwechat_files\wxid_z63azb4tgium22_f11a\temp\RWTemp\2026-04"
    r"\9e20f478899dc29eb19741386f9343c8\6246a185a07904124c8f4c7bc8e9b1a9.png"
)

if not os.environ.get("GEMINI_API_KEY"):
    print("请先设置 GEMINI_API_KEY 环境变量")
    raise SystemExit(1)

app = create_app()
with app.app_context():
    lookup = build_pigment_lookup()
    data = Path(IMG).read_bytes()
    print(f"[image] {IMG}  size={len(data)}")
    rows = parse_image_llm(data, lookup)
    print(f"[rows] {len(rows)}")
    for r in rows:
        print(f"  {r}")
