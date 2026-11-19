import json
import os
from pathlib import Path
from app.database.chroma_db import chroma_manager

def ingest_data(data_dir: str | None = None):
    # Ensure collection is initialized
    chroma_manager.get_collection("stellar_systems")
    
    documents = []
    ids = []
    metadatas = []
    
    project_root = Path(__file__).resolve().parents[1]
    source_dir = Path(data_dir) if data_dir else project_root / "data"
    cache_dir = project_root.parent / ".cache"
    for filename in os.listdir(source_dir):
        if filename.endswith(".txt"):
            path = source_dir / filename
            content = path.read_text(encoding="utf-8")
            documents.append(content)
            ids.append(filename.removesuffix(".txt"))
            metadatas.append({"source": filename, "type": "text"})

    for path in sorted(cache_dir.glob("*.json")) if cache_dir.exists() else []:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            rows = payload.get("data", payload.get("objects", []))
            if not isinstance(rows, list) or not rows:
                continue
            documents.append(json.dumps(rows, ensure_ascii=False))
            ids.append(f"cache-{path.stem}")
            metadatas.append({"source": path.name, "type": "catalog-json", "updated_at": str(payload.get("fetchedAt", "unknown"))})
        except (OSError, json.JSONDecodeError):
            continue
    
    if documents:
        collection = chroma_manager.get_collection("stellar_systems")
        for identifier in ids:
            try:
                collection.delete(ids=[identifier])
            except Exception:
                pass
        chroma_manager.add_documents(documents=documents, ids=ids, metadatas=metadatas)
        print(f"Successfully ingested {len(documents)} documents.")
    else:
        print("No documents found to ingest.")

if __name__ == "__main__":
    ingest_data()
