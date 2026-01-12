from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    BOT_TOKEN: str = ""
    BOTLOGIC_BASE_URL: str = "http://nginx:8080"   # через nginx
    HTTP_TIMEOUT_SEC: float = 8.0


settings = Settings()
