import os
from app.database.chroma_db import chroma_manager

def ingest_data(data_dir: str):
    # Ensure collection is initialized
    chroma_manager.get_collection("stellar_systems")
    
    documents = []
    ids = []
    metadatas = []
    
    for filename in os.listdir(data_dir):
        if filename.endswith(".txt"):
            path = os.path.join(data_dir, filename)
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
                documents.append(content)
                ids.append(filename.replace(".txt", ""))
                metadatas.append({"source": filename})
    
    if documents:
        chroma_manager.add_documents(
            documents=documents,
            ids=ids,
            metadatas=metadatas
        )
        print(f"Successfully ingested {len(documents)} documents.")
    else:
        print("No documents found to ingest.")

if __name__ == "__main__":
    DATA_DIR = "backend/data"
    ingest_data(DATA_DIR)
