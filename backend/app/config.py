from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite:///./local.db"
    supabase_url: str = ""
    supabase_key: str = ""
    mock_mode: bool = True
    openai_api_key: str = ""
    deepl_api_key: str = ""
    elevenlabs_api_key: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
