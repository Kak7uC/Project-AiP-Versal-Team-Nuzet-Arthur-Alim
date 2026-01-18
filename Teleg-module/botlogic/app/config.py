from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


def _find_env_file() -> str | None:
    cur = Path(__file__).resolve()
    for parent in [cur.parent, *cur.parents]:
        candidate = parent / ".env"
        if candidate.exists():
            return str(candidate)
    return None


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_find_env_file() or ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # botlogic
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    AUTH_BASE_URL: str = "http://localhost:8080"
    CORE_BASE_URL: str = "http://localhost:8081"
    BOTLOGIC_DEMO_MODE: int = 0
    HTTP_TIMEOUT_SEC: float = 8.0
    LOGIN_TTL_SEC: int = 600


settings = Settings()
