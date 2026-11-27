import json
import math
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from requests import RequestException
from app.models.schemas import QueryRequest, QueryResponse
from app.services.earth_imagery import PROVIDERS, ImageryUnavailable, fetch_earth_image, fill_earth_gaps
from app.services.earth_object_details import get_earth_object_details, search_earth_objects
from app.services.ollama_service import ollama_service
from app.database.chroma_db import chroma_manager

app = FastAPI(title="SpaceFree Backend")
CACHE_DIR = Path(__file__).resolve().parents[2] / ".cache"
EARTH_BASEMAP_PATH = CACHE_DIR.parent / "earth-blue-marble.jpg"
EARTH_BASEMAP_SOURCE = "NASA Blue Marble Next Generation"
ORBITAL_CACHE_FILES = {
    "stations": ["celestrak-stations.json"],
    "visual": ["celestrak-visual.json"],
    "active": ["celestrak-active.json"],
    "debris": ["celestrak-fengyun-1c-debris.json", "celestrak-cosmos-2251-debris.json", "celestrak-iridium-33-debris.json"],
}

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict this to your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "X-Data-Source", "X-Image-Date", "X-Image-Period", "X-Texture-Source",
        "X-Texture-Fallback", "X-Fallback-Reason", "X-Texture-Background", "X-Image-Coverage",
        "X-Texture-Status", "X-Texture-Reason", "X-Requested-Provider", "X-Upstream-Status",
    ],
)

@app.get("/")
async def root():
    return {"message": "SpaceFree Backend is running"}


@app.get("/api/status")
def api_status(response: Response):
    headers = {"Cache-Control": "no-store"}
    try:
        configured = ollama_service.model_available()
    except (RequestException, ValueError) as error:
        raise HTTPException(status_code=503, detail="Stato Ollama non disponibile", headers=headers) from error
    response.headers.update(headers)
    return {"provider": "ollama", "configured": configured, "model": ollama_service.model}


@app.get("/api/orbital-objects")
async def orbital_objects(group: str = Query("active"), limit: int = Query(12000, ge=1, le=12000)):
    files = ORBITAL_CACHE_FILES.get(group.lower())
    if not files:
        raise HTTPException(status_code=400, detail="Gruppo orbitale non valido")
    objects = {}
    updated = []
    for filename in files:
        try:
            payload = json.loads((CACHE_DIR / filename).read_text(encoding="utf-8"))
            rows = payload.get("data", payload.get("objects", []))
            for row in rows if isinstance(rows, list) else []:
                catalog_id = row.get("NORAD_CAT_ID") or row.get("OBJECT_ID") or row.get("OBJECT_NAME")
                if catalog_id is not None:
                    objects[str(catalog_id)] = row
            if payload.get("fetchedAt"):
                updated.append(payload["fetchedAt"])
        except (OSError, json.JSONDecodeError):
            continue
    if not objects:
        raise HTTPException(status_code=503, detail="Cache CelesTrak non disponibile; aggiorna l'ingestione")
    updated_at = max(updated, default=None)
    fetched_seconds = float(updated_at or 0) / (1000 if float(updated_at or 0) > 10_000_000_000 else 1)
    age_seconds = max(0, __import__("time").time() - fetched_seconds)
    return {"group": group, "objects": list(objects.values())[:limit], "total": len(objects), "updatedAt": updated_at, "stale": age_seconds > 7200, "source": "CelesTrak cache locale"}

@app.get("/api/orbital-positions")
async def orbital_positions(group: str = Query("active"), limit: int = Query(12000, ge=1, le=12000)):
    try:
        from sgp4 import omm
        from sgp4.api import Satrec, jday
    except ImportError as error:
        raise HTTPException(status_code=503, detail="Dipendenza SGP4 assente: installa backend/requirements.txt") from error
    catalog = await orbital_objects(group, limit)
    now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
    jd, fraction = jday(now.year, now.month, now.day, now.hour, now.minute, now.second + now.microsecond / 1e6)
    positions = []
    for obj in catalog["objects"]:
        try:
            satellite = Satrec()
            omm.initialize(satellite, obj)
            error_code, position, velocity = satellite.sgp4(jd, fraction)
            if error_code == 0 and all(math.isfinite(value) and abs(value) < 1e8 for value in (*position, *velocity)):
                positions.append({"object": obj, "positionKm": position, "velocityKmPerSec": velocity})
        except (KeyError, TypeError, ValueError):
            continue
    if not positions:
        raise HTTPException(status_code=502, detail="Nessun elemento OMM valido per la propagazione SGP4")
    return {
        **catalog,
        "positions": positions,
        "propagatedAt": now.isoformat(),
        "propagator": "python-sgp4 / WGS72",
        "coordinateFrame": "TEME",
        "elementModel": "CelesTrak OMM da cache locale",
        "elementEpochField": "EPOCH",
        "telemetryStatus": "not-integrated",
    }


def _geodetic_state(position_km, velocity_km_s, at):
    """Convert TEME state to approximate WGS84 geodetic coordinates for display."""
    x, y, z = position_km
    julian_date = at.timestamp() / 86400.0 + 2440587.5
    centuries = (julian_date - 2451545.0) / 36525.0
    gmst_degrees = (280.46061837 + 360.98564736629 * (julian_date - 2451545.0) + 0.000387933 * centuries**2 - centuries**3 / 38710000.0) % 360
    theta = math.radians(gmst_degrees)
    cos_theta, sin_theta = math.cos(theta), math.sin(theta)
    ecef_x = cos_theta * x + sin_theta * y
    ecef_y = -sin_theta * x + cos_theta * y
    ecef_z = z
    semi_major_km = 6378.137
    eccentricity_sq = 6.69437999014e-3
    horizontal = math.hypot(ecef_x, ecef_y)
    latitude = math.atan2(ecef_z, horizontal * (1 - eccentricity_sq))
    altitude = 0.0
    for _ in range(5):
        prime_vertical = semi_major_km / math.sqrt(1 - eccentricity_sq * math.sin(latitude) ** 2)
        cosine = math.cos(latitude)
        altitude = horizontal / cosine - prime_vertical if abs(cosine) > 1e-10 else abs(ecef_z) - prime_vertical * (1 - eccentricity_sq)
        latitude = math.atan2(ecef_z, horizontal * (1 - eccentricity_sq * prime_vertical / (prime_vertical + altitude)))
    return {
        "latitudeDeg": math.degrees(latitude),
        "longitudeDeg": ((math.degrees(math.atan2(ecef_y, ecef_x)) + 180) % 360) - 180,
        "altitudeKm": altitude,
        "speedKmPerSec": math.sqrt(sum(component * component for component in velocity_km_s)),
    }


@app.get("/api/orbital-state/{norad_id}")
async def orbital_object_state(
    norad_id: int,
    group: str = Query("active"),
    at: str | None = Query(default=None, max_length=40),
):
    if norad_id < 1 or norad_id > 999_999_999:
        raise HTTPException(status_code=400, detail="ID NORAD non valido")
    group = group.lower()
    if group not in ORBITAL_CACHE_FILES:
        raise HTTPException(status_code=400, detail="Gruppo orbitale non valido")
    try:
        timestamp = datetime.fromisoformat(at.replace("Z", "+00:00")) if at else datetime.now(timezone.utc)
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Timestamp simulazione non valido") from error
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    timestamp = timestamp.astimezone(timezone.utc)
    catalog = await orbital_objects(group, 12000)
    obj = None
    for record in catalog["objects"]:
        try:
            if int(record.get("NORAD_CAT_ID") or 0) == norad_id:
                obj = record
                break
        except (TypeError, ValueError):
            continue
    if obj is None:
        raise HTTPException(status_code=404, detail="Oggetto non presente nel gruppo CelesTrak caricato")
    try:
        from sgp4 import omm
        from sgp4.api import Satrec, jday
        satellite = Satrec()
        omm.initialize(satellite, obj)
        jd, fraction = jday(timestamp.year, timestamp.month, timestamp.day, timestamp.hour, timestamp.minute, timestamp.second + timestamp.microsecond / 1e6)
        error_code, position, velocity = satellite.sgp4(jd, fraction)
    except (ImportError, KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=422, detail="Elementi OMM non validi per SGP4") from error
    if error_code != 0 or not all(math.isfinite(value) for value in (*position, *velocity)):
        raise HTTPException(status_code=422, detail=f"SGP4 non disponibile per questo oggetto (codice {error_code})")
    return {
        "noradId": norad_id,
        "objectName": obj.get("OBJECT_NAME"),
        "propagator": "python-sgp4 / WGS72",
        "coordinateFrame": "TEME",
        "positionKm": position,
        "velocityKmPerSec": velocity,
        **_geodetic_state(position, velocity, timestamp),
        "propagatedAt": timestamp.isoformat(),
        "elementEpoch": obj.get("EPOCH"),
        "catalogUpdatedAt": catalog.get("updatedAt"),
        "source": catalog.get("source"),
        "telemetryStatus": "not-integrated",
        "telemetryNote": "La risposta è una propagazione orbitale SGP4; non è telemetria di bordo né un'osservazione.",
    }


@app.get("/api/earth/object/{norad_id}")
async def earth_object_details(norad_id: int, group: str | None = Query(default=None)):
    if norad_id < 1 or norad_id > 999_999_999:
        raise HTTPException(status_code=400, detail="ID NORAD non valido")
    if group is not None and group.lower() not in ORBITAL_CACHE_FILES:
        raise HTTPException(status_code=400, detail="Gruppo orbitale non valido")
    return await get_earth_object_details(norad_id, group.lower() if group else None)


@app.get("/api/earth/objects/search")
async def earth_objects_search(
    q: str = Query(default="", max_length=100),
    group: str | None = Query(default=None),
    verified_image_only: bool = Query(default=True),
    limit: int = Query(default=12, ge=1, le=20),
    offset: int = Query(default=0, ge=0, le=10000),
):
    if group is not None and group.lower() not in ORBITAL_CACHE_FILES:
        raise HTTPException(status_code=400, detail="Gruppo orbitale non valido")
    return await search_earth_objects(
        query=q, group=group.lower() if group else None,
        verified_image_only=verified_image_only, limit=limit, offset=offset,
    )

@app.get("/api/exoplanets")
async def exoplanets():
    try:
        payload = json.loads((CACHE_DIR / "nasa-exoplanets.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise HTTPException(status_code=503, detail="Cache NASA Exoplanet Archive non disponibile")
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), (list, dict)):
        raise HTTPException(status_code=503, detail="Cache NASA Exoplanet Archive non valida")
    return {"records": payload["data"], "updatedAt": payload.get("fetchedAt"), "source": "NASA Exoplanet Archive cache locale"}

def earth_image_response(year: int | None = None, provider: str = "nasa", fill_gaps: bool = False):
    headers = {"X-Requested-Provider": provider if provider in PROVIDERS else "unknown"}
    try:
        image = fetch_earth_image(year, provider)
    except ImageryUnavailable as error:
        headers.update({
            "Cache-Control": "no-store",
            "X-Texture-Status": "unavailable",
            "X-Texture-Reason": error.reason,
        })
        if error.upstream_status is not None:
            headers["X-Upstream-Status"] = str(error.upstream_status)
        if not error.offline:
            raise HTTPException(status_code=error.status, detail=str(error), headers=headers) from error
        try:
            fallback = EARTH_BASEMAP_PATH.read_bytes()
        except OSError as fallback_error:
            raise HTTPException(
                status_code=error.status, detail=f"{error} Anche la Blue Marble locale non è disponibile.",
                headers=headers,
            ) from fallback_error
        headers.update({
            "X-Texture-Status": "fallback",
            "X-Texture-Fallback": "true",
            "X-Texture-Source": EARTH_BASEMAP_SOURCE,
            "X-Fallback-Reason": (
                "Timeout della fonte selezionata." if error.reason == "upstream-timeout"
                else "Connessione alla fonte selezionata non disponibile."
            ),
        })
        return Response(fallback, media_type="image/jpeg", headers=headers)

    headers.update({
        "Cache-Control": "public, max-age=86400" if year is not None else "public, max-age=604800",
        "X-Data-Source": image.source,
        "X-Texture-Source": image.source,
        "X-Texture-Status": "coverage-unknown",
    })
    if image.coverage is not None:
        headers["X-Image-Coverage"] = f"{image.coverage:.6f}".rstrip("0").rstrip(".")
        headers["X-Texture-Status"] = "partial" if image.coverage < 100 else "real"
    if image.date:
        headers["X-Image-Date"] = image.date
    if image.period:
        headers["X-Image-Period"] = image.period
    content = image.content
    if fill_gaps and (filled := fill_earth_gaps(image, EARTH_BASEMAP_PATH)):
        content = filled
        headers["X-Texture-Background"] = EARTH_BASEMAP_SOURCE
    return Response(content, media_type="image/png", headers=headers)


@app.get("/api/earth/texture/{year}")
def earth_texture(year: int, provider: str = "nasa", fill_gaps: bool = False):
    if not 2000 <= year <= 2026:
        raise HTTPException(status_code=400, detail="Anno fuori dall'intervallo 2000?2026")
    return earth_image_response(year, provider, fill_gaps)


@app.get("/api/earth/basemap")
def earth_basemap(provider: str = "nasa", fill_gaps: bool = False):
    return earth_image_response(provider=provider, fill_gaps=fill_gaps)


@app.post("/query", response_model=QueryResponse)
async def query(request: QueryRequest):
    # 1. Retrieve context from ChromaDB
    results = chroma_manager.query_documents(request.query, n_results=request.max_results)
    
    # 2. Construct prompt with context
    context = ""
    if results and 'documents' in results and results['documents']:
        context = " ".join(results['documents'][0])
    
    selected_system = request.system_context or {}
    system_context = (
        f"\n\nDati strutturati del catalogo Orbite per la domanda: {selected_system}"
        if selected_system else ""
    )
    prompt = f"Context: {context}{system_context}\n\nQuestion: {request.query}"
    
    # 3. Get response from Ollama
    answer = ollama_service.generate_response(prompt)
    
    return QueryResponse(
        answer=answer,
        sources=results.get('metadatas', [[],])[0] if results and 'documents' in results else []
    )

