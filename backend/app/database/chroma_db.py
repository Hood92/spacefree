import chromadb
from app.core.config import settings

class ChromaDBManager:
    def __init__(self, collection_name: str = "star_atlas_collection"):
        self.client = chromadb.Client()
        # Inizializza subito la collezione all'avvio
        col_name = getattr(settings, "CHROMA_COLLECTION_NAME", collection_name)
        self.collection = self.client.get_or_create_collection(name=col_name)

    def get_collection(self, name: str):
        if self.collection is None or self.collection.name != name:
            self.collection = self.client.get_or_create_collection(name=name)
        return self.collection

    def add_documents(self, documents, ids, metadatas):
        if self.collection is None:
            self.get_collection("star_atlas_collection")
        self.collection.add(
            documents=documents,
            ids=ids,
            metadatas=metadatas
        )

    def query_documents(self, query_text: str, n_results: int = 5):
        if self.collection is None:
            self.get_collection("star_atlas_collection")
            
        results = self.collection.query(
            query_texts=[query_text],
            n_results=n_results
        )
        return results

chroma_manager = ChromaDBManager()