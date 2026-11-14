import chromadb
from app.core.config import settings

class ChromaDBManager:
    def __init__(self):
        self.client = chromadb.Client()
        self.collection = None

    def get_collection(self, name: str):
        if self.collection is None:
            self.collection = self.client.get_or_create_collection(name=name)
        return self.collection

    def add_documents(self, documents, ids, metadatas):
        self.collection.add(
            documents=documents,
            ids=ids,
            metadatas=metadatas
        )

    def query_documents(self, query_text: str, n_results: int = 5):
        results = self.collection.query(
            query_texts=[query_text],
            n_results=n_results
        )
        return results

chroma_manager = ChromaDBManager()
