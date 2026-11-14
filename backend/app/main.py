from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.models.schemas import QueryRequest, QueryResponse
from app.services.ollama_service import ollama_service
from app.database.chroma_db import chroma_manager

app = FastAPI(title="SpaceFree Backend")

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict this to your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"message": "SpaceFree Backend is running"}

@app.post("/query", response_model=QueryResponse)
async def query(request: QueryRequest):
    # 1. Retrieve context from ChromaDB
    results = chroma_manager.query_documents(request.query, n_results=request.max_results)
    
    # 2. Construct prompt with context
    context = ""
    if results and 'documents' in results and results['documents']:
        context = " ".join(results['documents'][0])
    
    prompt = f"Context: {context}\n\nQuestion: {request.query}"
    
    # 3. Get response from Ollama
    answer = ollama_service.generate_response(prompt)
    
    return QueryResponse(
        answer=answer,
        sources=results.get('metadatas', [[],])[0] if results and 'documents' in results else []
    )

