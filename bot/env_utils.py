import os
from pathlib import Path
from dotenv import load_dotenv


def load_environment(base_dir: str | os.PathLike[str] | None = None) -> list[Path]:
    """Load environment variables from a local .env file when present."""
    search_dir = Path(base_dir or Path(__file__).resolve().parent)
    candidates = [search_dir / '.env', search_dir.parent / '.env']
    loaded_paths: list[Path] = []

    for path in candidates:
        if path.exists():
            load_dotenv(path, override=False)
            loaded_paths.append(path)

    return loaded_paths


def get_required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value
