from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    REDIS_HOST: str = "redis"
    REDIS_PORT: int = 6379

    AUTH_BASE_URL: str = "http://auth:8000"   # заглушка 
    CORE_BASE_URL: str = ""                   # заглушка 

    BOTLOGIC_DEMO_MODE: int = 1               
    HTTP_TIMEOUT_SEC: float = 8.0

    LOGIN_TTL_SEC: int = 60 * 10              


settings = Settings()
