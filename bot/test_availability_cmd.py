"""Проверка разбора команд «продано» / «продано 42»."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("main", Path(__file__).parent / "main.py")
main = importlib.util.module_from_spec(spec)
spec.loader.exec_module(main)

assert main.parse_availability_command("продано") == ("sold", [])
assert main.parse_availability_command("продано 42") == ("sold", ["42"])
assert main.parse_availability_command("продано 41, 42") == ("sold", ["41", "42"])
assert main.parse_availability_command("в наличии 43") == ("available", ["43"])
assert main.parse_availability_command("hello") == (None, [])

sizes = ["39", "41", "42"]
remaining = [s for s in sizes if s not in ["42"]]
assert remaining == ["39", "41"]
print("OK: availability commands")
