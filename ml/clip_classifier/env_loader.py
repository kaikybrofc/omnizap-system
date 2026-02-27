from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv


def load_project_env() -> None:
    """Load local and project-root .env files once per process."""
    current_dir = Path(__file__).resolve().parent
    root_dir = current_dir.parent.parent

    # Keep existing env precedence: do not overwrite already defined values.
    load_dotenv(current_dir / ".env", override=False)
    load_dotenv(root_dir / ".env", override=False)
