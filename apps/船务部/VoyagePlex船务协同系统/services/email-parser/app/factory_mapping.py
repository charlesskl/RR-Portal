import json
import re
from pathlib import Path


def _key(value: str) -> str:
    return re.sub(r"[^\w]", "", value).casefold()


# Preserve all cloud records, including aliases and the original local-factory flag.
FACTORY_MAPPINGS = json.loads(Path(__file__).with_name("factory-mappings.json").read_text(encoding="utf-8"))
_EXACT = {row["english_name"]: row["chinese_short_name"] for row in FACTORY_MAPPINGS}
_NORMALIZED: dict[str, set[str]] = {}
for row in FACTORY_MAPPINGS:
    _NORMALIZED.setdefault(_key(row["english_name"]), set()).add(row["chinese_short_name"])


def chinese_factory_name(value: str, records: list[dict] | None = None) -> str:
    name = value.strip()
    if records is not None:
        exact = {row["englishName"]: row["chineseShortName"] for row in records}
        if name in exact:
            return exact[name]
        matches = {row["chineseShortName"] for row in records if _key(row["englishName"]) == _key(name)}
        return next(iter(matches)) if len(matches) == 1 else name
    if name in _EXACT:
        return _EXACT[name]
    matches = _NORMALIZED.get(_key(name), set())
    # Ambiguous aliases must retain the source name rather than guess a factory.
    return next(iter(matches)) if len(matches) == 1 else name
