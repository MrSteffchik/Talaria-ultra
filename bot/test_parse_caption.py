"""Локальные тесты парсера подписи (без Telegram/Supabase)."""
import os
import sys

os.environ.setdefault("TELEGRAM_TOKEN", "test")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test")

from main import (  # noqa: E402
    parse_caption,
    extract_size_numbers,
    strip_all_emoji,
    _utf16_units_before,
)


class FakeEntity:
    def __init__(self, offset: int, length: int, etype: str = "strikethrough"):
        self.offset = offset
        self.length = length
        self.type = etype


def test_price_strikethrough_order():
    """Старая цена зачёркнута, скидочная — обычная строка."""
    text = "Туфли\n430.000 сум\n330 000 сум"
    line_old = "430.000 сум"
    off = text.index(line_old)
    u16_start = _utf16_units_before(text, off)
    u16_end = _utf16_units_before(text, off + len(line_old))
    entities = [FakeEntity(u16_start, u16_end - u16_start)]
    r = parse_caption(text, entities)
    assert r is not None
    main_part = r["price"].split("(было:")[0]
    assert "330" in main_part
    assert "430" in r["price"]


def test_price_swapped_without_entity():
    """Две цены без entity: меньшая должна быть актуальной."""
    text = "Модель\n430.000 сум\nЦена со скидкой 330 000 сум"
    r = parse_caption(text, [])
    assert r is not None
    assert r["price"].startswith("330") or "330" in r["price"].split("(")[0]


def test_sizes_premium_emoji_stripped():
    raw = "🔥 41, 42, 43 🔥"
    cleaned = strip_all_emoji(raw)
    sizes = extract_size_numbers(cleaned)
    assert sizes == ["41", "42", "43"]


def test_sizes_line_in_caption():
    text = "Кроссовки\n➡️ 39, 40, 41\n450 000 сум"
    r = parse_caption(text, [])
    assert r is not None
    assert r["sizes"] == "39, 40, 41"


if __name__ == "__main__":
    tests = [
        test_price_strikethrough_order,
        test_price_swapped_without_entity,
        test_sizes_premium_emoji_stripped,
        test_sizes_line_in_caption,
    ]
    failed = 0
    for t in tests:
        try:
            t()
            print("OK", t.__name__)
        except Exception as exc:
            failed += 1
            print("FAIL", t.__name__, exc)
    sys.exit(1 if failed else 0)
