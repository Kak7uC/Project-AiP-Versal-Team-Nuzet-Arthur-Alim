from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    REDIS_HOST: str = "redis"
    REDIS_PORT: int = 6379

    AUTH_BASE_URL: str = "http://localhost:8080"
    CORE_BASE_URL: str = "http://localhost:8081"

    # 1 - демо, 0 - рабочий
    BOTLOGIC_DEMO_MODE: int = 0
    HTTP_TIMEOUT_SEC: float = 8.0

    LOGIN_TTL_SEC: int = 60 * 10


settings = Settings()
