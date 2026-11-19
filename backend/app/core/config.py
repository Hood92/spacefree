from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    PROJECT_NAME: str = "SpaceFree Backend"
    DATABASE_URL: str = "http://localhost:8000"
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "gemma4:12b"
    COPERNICUS_WMS_ENDPOINT: str = "https://sh.dataspace.copernicus.eu/ogc/wms"
    COPERNICUS_WMS_INSTANCE: str = ""
    COPERNICUS_WMS_LAYER: str = ""

settings = Settings()
