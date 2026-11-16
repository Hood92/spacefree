from pydantic import BaseModel
from typing import List, Optional

class QueryRequest(BaseModel):
    query: str
    max_results: Optional[int] = 5
    system_context: Optional[dict] = None

class QueryResponse(BaseModel):
    answer: str
    sources: List[str]
