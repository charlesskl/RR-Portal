"""一次性诊断:对指定图片跑 OCR,逐层打印证据。"""
import sys, io
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import create_app
from app.services.ocr import (
    _raw_ocr, _group_rows, _first_marker_pos, _parse_row, _is_valid,
    START_MARKERS, STOP_MARKERS, SKIP_KEYWORDS, build_pigment_lookup,
)

IMG = r"d:\xwechat_files\wxid_z63azb4tgium22_f11a\temp\RWTemp\2026-04\9e20f478899dc29eb19741386f9343c8\6246a185a07904124c8f4c7bc8e9b1a9.png"

app = create_app()
with app.app_context():
    lookup = build_pigment_lookup()
    print(f"[lookup] pigment tokens loaded: {len(lookup)}  sample: {list(lookup)[:8]}")
    data = Path(IMG).read_bytes()
    items = _raw_ocr(data)
    print(f"\n[raw ocr] {len(items)} text boxes")
    for it in items:
        print(f"  y={it['y']:.0f} x=[{it['x_min']:.0f},{it['x_max']:.0f}] conf={it['conf']:.2f}  {it['text']!r}")
    rows = _group_rows(items)
    print(f"\n[rows] {len(rows)} rows grouped")
    for i, row in enumerate(rows):
        raw = " ".join(it["text"] for it in row)
        print(f"  row#{i}: {raw!r}")
    stop_pos = _first_marker_pos(rows, ("合计", "总计"))
    start_pos = _first_marker_pos(rows, START_MARKERS)
    print(f"\n[markers] start_pos={start_pos}  stop_pos={stop_pos}")
    if stop_pos is not None and start_pos is not None and stop_pos < start_pos:
        print("[markers] -> reversing rows")
        rows = [list(reversed(r)) for r in reversed(rows)]
    parsed = []
    started = False
    for i, row in enumerate(rows):
        raw = " ".join(it["text"] for it in row)
        if not started:
            if any(m in raw for m in START_MARKERS):
                started = True
                print(f"[walk] row#{i} START hit -> {raw!r}")
            else:
                print(f"[walk] row#{i} skipped (before start): {raw!r}")
                continue
        if any(m in raw for m in STOP_MARKERS):
            print(f"[walk] row#{i} STOP hit -> {raw!r}")
            break
        if any(k in raw for k in SKIP_KEYWORDS):
            print(f"[walk] row#{i} SKIP keyword -> {raw!r}")
            continue
        r = _parse_row(row, lookup)
        if r is None:
            print(f"[walk] row#{i} parse=None: {raw!r}")
            continue
        ok = _is_valid(r)
        print(f"[walk] row#{i} parse={r}  valid={ok}")
        if ok:
            parsed.append(r)
    print(f"\n[final] {len(parsed)} rows kept")
    for r in parsed:
        print(f"  {r}")
