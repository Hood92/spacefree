import requests
from app.core.config import settings

class OllamaService:
    def __init__(self):
        self.base_url = settings.OLLAMA_BASE_URL
        self.model = settings.OLLAMA_MODEL
        # System prompt for Commander Data
        self.system_prompt = (
            "You are Lieutenant Commander Data from the USS Enterprise-D. "
            "Your tone is logical, formal, and precise, devoid of linguistic contractions. "
            "You are an expert in astronomy, celestial mechanics, and your experiences aboard the Enterprise. "
            "Respond to the user's query based on the provided context, maintaining your persona at all times."
        )

    def generate_response(self, prompt: str) -> str:
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": self.system_prompt},
                {"role": "user", "content": f"Context: {prompt}"}
            ],
            "stream": False
        }
        response = requests.post(f"{self.base_url}/api/chat", json=payload)
        response.raise_for_status()
        return response.json().get("message", {}).get("content", "")

ollama_service = OllamaService()
