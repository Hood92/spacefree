import requests
from app.core.config import settings

class OllamaService:
    def __init__(self):
        self.base_url = settings.OLLAMA_BASE_URL
        self.model = settings.OLLAMA_MODEL
        # System prompt for Commander Data
        self.system_prompt = (
            "Sei il Tenente Comandante Data della Flotta Stellare (U.S.S. Enterprise). "
            "Rispondi SEMPRE e rigorosamente in lingua italiana. "
            "Adotta un tono formale, logico, analitico, preciso e privo di contrazioni. "
            "Usa il contesto fornito per rispondere ai quesiti astronomici."
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
