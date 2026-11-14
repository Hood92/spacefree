from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    PROJECT_NAME: str = "SpaceFree Backend"
    DATABASE_URL: str = "http://localhost:8000"
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "gemma4:12b"
    
    class Config:
        env_file = ".env"

settings = Settings()
