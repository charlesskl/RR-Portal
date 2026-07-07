"""Word 附件解析器 — 从 .docx 文件中提取仓库地址等信息（入仓场景）。"""

import re

from docx import Document


def parse_word_attachment(file_path: str) -> dict:
    """解析 Word 附件，提取仓库地址和 SO 号。

    Args:
        file_path: .docx 文件路径

    Returns:
        dict: {
            'warehouse': str,   # 仓库/送货/收货地址
            'so_number': str,   # SO 号（备用）
        }
    """
    doc = Document(file_path)
    full_text = '\n'.join(p.text for p in doc.paragraphs)

    result = {'warehouse': '', 'so_number': ''}

    # 仓库地址
    wh_match = re.search(
        r'(?:仓库地址|送货地址|收货地址)[：:\s]*(.+?)(?:\n|$)', full_text
    )
    if wh_match:
        result['warehouse'] = wh_match.group(1).strip()

    # SO 号（备用）
    so_match = re.search(r'SO\s*#?\s*([A-Z0-9]+)', full_text, re.IGNORECASE)
    if so_match:
        result['so_number'] = so_match.group(1).strip()

    return result
