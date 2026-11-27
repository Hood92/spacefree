"""Verified, source-attributed metadata for one catalogued orbital object."""

import asyncio
import hashlib
import io
import json
import logging
import re
import threading
import time
from pathlib import Path
from urllib.parse import quote, urlparse

import requests
from PIL import Image, UnidentifiedImageError

logger = logging.getLogger(__name__)
SATNOGS_API = "https://db.satnogs.org/api/satellites/"
SATNOGS_SOURCE = "SatNOGS DB (Libre Space Foundation), CC BY-SA 4.0"
SATNOGS_DETAILS_URL = "https://db.satnogs.org/satellite/"
SATNOGS_MEDIA_BASE = "https://db-satnogs.freetls.fastly.net/media/"
CACHE_DIR = Path(__file__).resolve().parents[2] / ".cache" / "earth-object-details"
CACHE_TTL_SECONDS = 30 * 24 * 60 * 60
NEGATIVE_TTL_SECONDS = 6 * 60 * 60
IMAGE_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60
SATNOGS_INDEX_TTL_SECONDS = 6 * 60 * 60
SATNOGS_INDEX_URL = SATNOGS_API
REQUEST_TIMEOUT = (3, 7)
IMAGE_TIMEOUT = (3, 6)
MAX_IMAGE_BYTES = 8 * 1024 * 1024
LOCAL_CATALOG_FILES = {
    "stations": ("celestrak-stations.json",),
    "visual": ("celestrak-visual.json",),
    "active": ("celestrak-active.json",),
    "debris": (
        "celestrak-fengyun-1c-debris.json",
        "celestrak-cosmos-2251-debris.json",
        "celestrak-iridium-33-debris.json",
    ),
}
_satnogs_index_lock = threading.Lock()


def _read_satnogs_index_cache():
    path = CACHE_DIR / "satnogs-index.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        records = payload.get("records")
        fetched_at = float(payload.get("fetchedAt", 0))
        if not isinstance(records, list):
            return None
        return records, fetched_at, max(0, time.time() - fetched_at)
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None


def _fetch_satnogs_index():
    response = requests.get(
        SATNOGS_INDEX_URL,
        params={"format": "json"},
        headers={"Accept": "application/json", "User-Agent": "Orbite/1.0 (SatNOGS object index)"},
        timeout=(4, 18),
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, list):
        raise ValueError("SatNOGS ha restituito un indice in formato inatteso")
    records = []
    for row in payload:
        if not isinstance(row, dict):
            continue
        try:
            norad_id = int(row.get("norad_cat_id") or 0)
        except (TypeError, ValueError):
            continue
        if norad_id > 0:
            records.append(row)
    fetched_at = time.time()
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        (CACHE_DIR / "satnogs-index.json").write_text(
            json.dumps({"fetchedAt": fetched_at, "records": records}), encoding="utf-8"
        )
    except OSError as error:
        logger.warning("Indice SatNOGS non memorizzabile: %s", error)
    return records, fetched_at, 0


def _get_satnogs_index():
    with _satnogs_index_lock:
        cached = _read_satnogs_index_cache()
        if cached and cached[2] < SATNOGS_INDEX_TTL_SECONDS:
            return {"records": cached[0], "state": "cache", "ageSeconds": int(cached[2]), "complete": True}
        try:
            records, fetched_at, _ = _fetch_satnogs_index()
            return {"records": records, "state": "updated", "ageSeconds": 0, "complete": True, "fetchedAt": fetched_at}
        except (requests.RequestException, ValueError, OSError) as error:
            if cached:
                return {"records": cached[0], "state": "stale", "ageSeconds": int(cached[2]), "complete": True, "warning": str(error)}
            return {"records": [], "state": "unavailable", "ageSeconds": None, "complete": False, "warning": str(error)}


def _value(record: dict, *keys: str):
    for key in keys:
        value = record.get(key)
        if value is None:
            continue
        if isinstance(value, str):
            value = value.strip()
            if not value or value.lower() in {"none", "null", "unknown", "n/a"}:
                continue
        return value
    return None


def _local_catalog_record(norad_id: int) -> tuple[dict | None, str | None]:
    cache_root = Path(__file__).resolve().parents[2] / ".cache"
    for filenames in LOCAL_CATALOG_FILES.values():
        for filename in filenames:
            try:
                payload = json.loads((cache_root / filename).read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            rows = payload.get("data", payload.get("objects", [])) if isinstance(payload, dict) else []
            for row in rows if isinstance(rows, list) else []:
                try:
                    row_id = int(row.get("NORAD_CAT_ID") or row.get("norad_cat_id") or 0)
                except (TypeError, ValueError):
                    continue
                if row_id == norad_id:
                    return row, filename
    return None, None


def _iter_local_catalog(group: str | None = None):
    cache_root = Path(__file__).resolve().parents[2] / ".cache"
    groups = {group: LOCAL_CATALOG_FILES[group]} if group else LOCAL_CATALOG_FILES
    found = {}
    for catalog_group, filenames in groups.items():
        for filename in filenames:
            try:
                payload = json.loads((cache_root / filename).read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            rows = payload.get("data", payload.get("objects", [])) if isinstance(payload, dict) else []
            for row in rows if isinstance(rows, list) else []:
                if not isinstance(row, dict):
                    continue
                try:
                    norad_id = int(row.get("NORAD_CAT_ID") or row.get("norad_cat_id") or 0)
                except (TypeError, ValueError):
                    continue
                if norad_id > 0:
                    found.setdefault(norad_id, {"noradId": norad_id, "group": catalog_group, "record": row})
    return list(found.values())


def _satnogs_image(value) -> dict | None:
    if not isinstance(value, str) or not value.strip():
        return None
    value = value.strip()
    if value.startswith("https://"):
        parsed = urlparse(value)
        if parsed.hostname not in {"db.satnogs.org", "db-satnogs.freetls.fastly.net"}:
            return None
        url = value
    else:
        url = SATNOGS_MEDIA_BASE + quote(value.lstrip("/"), safe="/")
    return {"url": url, "caption": "Immagine associata alla scheda SatNOGS", "source": SATNOGS_SOURCE, "verified": False}


def _verify_satnogs_image(image: dict | None) -> dict | None:
    if not image:
        return None
    url = image["url"]
    filename = Path(urlparse(url).path).name.lower()
    if re.search(r"(?:default|placeholder|no[-_]?image|missing|generic|satellite[-_]?icon|unknown)", filename):
        return {**image, "verified": False, "verification": "nome file compatibile con un placeholder"}

    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()
    verification_path = CACHE_DIR / "image-verification" / f"{digest}.json"
    try:
        cached = json.loads(verification_path.read_text(encoding="utf-8"))
        if time.time() - float(cached["checkedAt"]) < IMAGE_CACHE_TTL_SECONDS:
            return {**image, **cached["result"]}
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
        pass

    result = {"verified": False, "verification": "immagine non verificata"}
    try:
        response = requests.get(url, headers={"User-Agent": "Orbite/1.0 (image verification)"}, timeout=IMAGE_TIMEOUT, stream=True)
        try:
            response.raise_for_status()
            content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
            content_buffer = bytearray()
            for chunk in response.iter_content(64 * 1024):
                if chunk:
                    content_buffer.extend(chunk)
                    if len(content_buffer) > MAX_IMAGE_BYTES:
                        raise ValueError("immagine oltre il limite di 8 MiB")
            content = bytes(content_buffer)
        finally:
            response.close()
        if not content_type.startswith("image/"):
            raise ValueError("contenuto non immagine")
        with Image.open(io.BytesIO(content)) as image_file:
            width, height = image_file.size
            image_format = (image_file.format or "").upper()
            image_file.verify()
        if image_format not in {"JPEG", "PNG", "WEBP"} or width < 160 or height < 120 or len(content) < 4096:
            raise ValueError("dimensioni o formato compatibili con un'icona/placeholder")
        with Image.open(io.BytesIO(content)) as image_file:
            thumbnail = image_file.convert("RGB")
            thumbnail.thumbnail((48, 48))
            colors = thumbnail.getcolors(maxcolors=4096) or []
        if len(colors) < 24:
            raise ValueError("immagine troppo uniforme, possibile icona generica")
        result = {
            "verified": True,
            "verification": "file immagine raggiungibile, valido e sopra le soglie anti-placeholder",
            "width": width,
            "height": height,
            "format": image_format.lower(),
            "sha256": hashlib.sha256(content).hexdigest(),
        }
    except (requests.RequestException, OSError, ValueError, Image.DecompressionBombError, UnidentifiedImageError) as error:
        result = {"verified": False, "verification": str(error) or "immagine non verificabile"}

    try:
        verification_path.parent.mkdir(parents=True, exist_ok=True)
        verification_path.write_text(json.dumps({"checkedAt": time.time(), "result": result}), encoding="utf-8")
    except OSError as error:
        logger.warning("Esito verifica immagine SatNOGS non memorizzabile: %s", error)
    return {**image, **result}


def _fetch_satnogs_record(norad_id: int) -> dict | None:
    response = requests.get(
        SATNOGS_API,
        params={"norad_cat_id": norad_id, "format": "json"},
        headers={"Accept": "application/json", "User-Agent": "Orbite/1.0 (orbital object details)"},
        timeout=REQUEST_TIMEOUT,
    )
    if response.status_code == 404:
        return None
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, list):
        raise ValueError("SatNOGS ha restituito un formato inatteso")
    for row in payload:
        if not isinstance(row, dict):
            continue
        try:
            if int(row.get("norad_cat_id") or 0) == norad_id:
                return row
        except (TypeError, ValueError):
            continue
    return None


def _build_details(norad_id: int, satnogs: dict | None, local: dict | None, group: str | None) -> dict:
    name = _value(satnogs or {}, "name", "names") or _value(local or {}, "OBJECT_NAME", "name")
    launched = _value(satnogs or {}, "launched", "launch_date") or _value(local or {}, "LAUNCH_DATE", "launched")
    owner = _value(satnogs or {}, "operator", "owner") or _value(local or {}, "OPERATOR", "OWNER")
    countries = _value(satnogs or {}, "countries", "country") or _value(local or {}, "COUNTRY_CODE", "COUNTRY")
    sat_type = _value(satnogs or {}, "object_type", "type") or _value(local or {}, "OBJECT_TYPE", "TYPE")
    description = _value(satnogs or {}, "description", "mission", "purpose")
    status_text = _value(satnogs or {}, "status")
    image = _satnogs_image(_value(satnogs or {}, "image"))
    website = _value(satnogs or {}, "website")

    if not sat_type and group == "debris":
        sat_type = "Catalogato nel gruppo detriti CelesTrak"
    elif not sat_type and group == "stations":
        sat_type = "Catalogato nel gruppo stazioni CelesTrak"

    detail_url = None
    if satnogs and satnogs.get("sat_id"):
        detail_url = SATNOGS_DETAILS_URL + quote(str(satnogs["sat_id"])) + "/"
    sources = []
    if satnogs:
        sources.append({"name": SATNOGS_SOURCE, "url": detail_url or f"{SATNOGS_API}?norad_cat_id={norad_id}&format=json"})
    if local:
        sources.append({"name": "CelesTrak · catalogo locale", "url": f"https://celestrak.org/satcat/search.php?CATNR={norad_id}"})

    has_catalog_fields = any((name, launched, sat_type, status_text))
    metadata_status = "available" if satnogs and sum(value is not None for value in (name, launched, owner, countries, sat_type, image, description)) >= 3 else "partial" if satnogs or local else "unavailable"
    if not has_catalog_fields and not image and not description and not owner and not countries:
        metadata_status = "unavailable"
    return {
        "noradId": norad_id,
        "name": name,
        "status": metadata_status,
        "satnogsRecord": bool(satnogs),
        "satnogsStatus": "present" if satnogs else "absent",
        "objectStatus": status_text,
        "owner": owner,
        "countries": countries,
        "launchDate": launched,
        "type": sat_type,
        "description": description,
        "website": website,
        "image": image,
        "photoStatus": "unverified" if image else "none",
        "sources": sources,
        "message": None if metadata_status != "unavailable" else "Nessun dettaglio verificato trovato nelle fonti consultate.",
    }


def _cache_path(norad_id: int, group: str | None = None) -> Path:
    group_key = group if group in {"stations", "visual", "active", "debris"} else "all"
    return CACHE_DIR / f"{norad_id}-{group_key}.json"


def _read_cache(norad_id: int, group: str | None = None):
    try:
        value = json.loads(_cache_path(norad_id, group).read_text(encoding="utf-8"))
        data = value["data"]
        if not isinstance(data, dict):
            return None, None, False
        age = max(0, time.time() - float(value["cachedAt"]))
        ttl = NEGATIVE_TTL_SECONDS if data.get("status") == "unavailable" else CACHE_TTL_SECONDS
        return data, age, age < ttl
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
        return None, None, False


def _write_cache(norad_id: int, data: dict, group: str | None = None):
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _cache_path(norad_id, group).write_text(json.dumps({"cachedAt": time.time(), "data": data}), encoding="utf-8")
    except OSError as error:
        logger.warning("Cache dettagli oggetto %s non scrivibile: %s", norad_id, error)


def _fresh_details(norad_id: int, group: str | None) -> dict:
    local, _filename = _local_catalog_record(norad_id)
    try:
        satnogs = _fetch_satnogs_record(norad_id)
    except requests.RequestException as error:
        if not local:
            raise
        data = _build_details(norad_id, None, local, group)
        data["satnogsRecord"] = None
        data["satnogsStatus"] = "unknown"
        data["photoStatus"] = "unknown" if not data.get("image") else "unverified"
        data["message"] = f"SatNOGS non raggiungibile; mostro solo i campi del catalogo locale. ({error.__class__.__name__})"
        return data
    data = _build_details(norad_id, satnogs, local, group)
    data["image"] = _verify_satnogs_image(data.get("image"))
    data["photoStatus"] = "verified" if data["image"] and data["image"].get("verified") else "unverified" if data["image"] else "none"
    return data


async def get_earth_object_details(norad_id: int, group: str | None = None) -> dict:
    cached, age, fresh = _read_cache(norad_id, group)
    if cached and cached.get("image") and "verified" not in cached["image"]:
        fresh = False
    if cached is not None and fresh:
        cached.setdefault("satnogsRecord", None)
        cached.setdefault("satnogsStatus", "unknown")
        cached.setdefault("photoStatus", "unknown" if cached.get("image") else "none")
        return {**cached, "cache": {"state": "fresh", "ageSeconds": int(age or 0)}}

    try:
        data = await asyncio.to_thread(_fresh_details, norad_id, group)
    except (requests.RequestException, ValueError, OSError) as error:
        logger.info("Dettagli SatNOGS non disponibili per NORAD %s: %s", norad_id, error)
        if cached is not None:
            return {**cached, "cache": {"state": "stale", "ageSeconds": int(age or 0)}, "message": "Fonte non raggiungibile; mostro i metadati memorizzati."}
        return {
            "noradId": norad_id, "name": None, "status": "unavailable", "objectStatus": None,
            "owner": None, "countries": None, "launchDate": None, "type": None,
            "description": None, "website": None, "image": None, "sources": [],
            "message": "Fonte dei metadati non raggiungibile; nessun dato descrittivo mostrato.",
            "cache": {"state": "miss", "ageSeconds": None},
        }
    _write_cache(norad_id, data, group)
    return {**data, "cache": {"state": "updated", "ageSeconds": 0}}


async def search_earth_objects(
    query: str = "", group: str | None = None, verified_image_only: bool = True,
    limit: int = 12, offset: int = 0,
) -> dict:
    normalized_query = query.strip().casefold()
    index = await asyncio.to_thread(_get_satnogs_index)
    satnogs_by_id = {int(row["norad_cat_id"]): row for row in index["records"] if row.get("norad_cat_id")}
    local_candidates = _iter_local_catalog(group)
    candidates_by_id = {
        item["noradId"]: {**item, "satnogs": satnogs_by_id.get(item["noradId"])}
        for item in local_candidates
    }
    if group is None:
        for norad_id, satnogs in satnogs_by_id.items():
            candidates_by_id.setdefault(norad_id, {
                "noradId": norad_id, "group": "satnogs", "record": {}, "satnogs": satnogs,
            })
    candidates = list(candidates_by_id.values())

    def search_text(candidate):
        row = candidate["record"]
        sat = candidate.get("satnogs") or {}
        return " ".join(str(value or "") for value in (
            sat.get("name"), sat.get("names"), sat.get("sat_id"), sat.get("norad_cat_id"),
            row.get("OBJECT_NAME"), row.get("OBJECT_ID"), row.get("NORAD_CAT_ID"),
            row.get("OBJECT_TYPE"), row.get("TYPE"), candidate.get("group"),
        )).casefold()

    if normalized_query:
        candidates = [item for item in candidates if normalized_query in search_text(item)]
    candidates.sort(key=lambda item: (
        str((item.get("satnogs") or {}).get("name") or item["record"].get("OBJECT_NAME") or f"NORAD {item['noradId']}").casefold(),
        item["noradId"],
    ))

    total_candidates = len(candidates)
    offset = max(0, min(offset, total_candidates))
    scan_limit = min(60, max(limit * (4 if verified_image_only else 1), limit))
    page = candidates[offset:min(total_candidates, offset + scan_limit)]
    semaphore = asyncio.Semaphore(4)

    async def build_item(candidate):
        async with semaphore:
            norad_id = candidate["noradId"]
            local = candidate["record"] or None
            sat = candidate.get("satnogs")
            details = _build_details(norad_id, sat, local, candidate["group"] if candidate["group"] != "satnogs" else None)
            image = details.get("image")
            if image:
                details["image"] = await asyncio.to_thread(_verify_satnogs_image, image)
            verified = bool(details.get("image") and details["image"].get("verified"))
            details["photoStatus"] = "verified" if verified else "unverified" if image else "none"
            return candidate, details

    fetched = await asyncio.gather(*(build_item(candidate) for candidate in page), return_exceptions=True)
    source_errors = 0 if index["complete"] else 1
    found = []
    for candidate_index, result in enumerate(fetched, start=offset):
        if isinstance(result, Exception):
            source_errors += 1
            continue
        candidate, details = result
        sat = candidate.get("satnogs")
        local = candidate["record"]
        has_verified_image = details["photoStatus"] == "verified"
        if verified_image_only and not has_verified_image:
            continue
        source_url = next((source["url"] for source in details.get("sources", []) if source.get("name", "").startswith("SatNOGS DB")), None)
        if sat and sat.get("sat_id"):
            source_url = f"{SATNOGS_DETAILS_URL}{quote(str(sat['sat_id']), safe='')}/"
        found.append({
            "_candidateIndex": candidate_index,
            "noradId": candidate["noradId"],
            "name": details.get("name") or local.get("OBJECT_NAME") or f"NORAD {candidate['noradId']}",
            "group": candidate["group"],
            "metadataStatus": details.get("status", "unavailable"),
            "hasData": details.get("status") in {"available", "partial"},
            "satnogsRecord": bool(sat),
            "satnogsStatus": "present" if sat else "stale-absent" if index["complete"] and index["state"] == "stale" else "absent" if index["complete"] else "unknown",
            "photoStatus": details["photoStatus"] if index["complete"] else "unknown",
            "imageVerified": has_verified_image,
            "image": details.get("image") if has_verified_image else None,
            "type": details.get("type"), "owner": details.get("owner"),
            "countries": details.get("countries"), "launchDate": details.get("launchDate"),
            "orbitalRecord": {
                "NORAD_CAT_ID": candidate["noradId"],
                "OBJECT_NAME": details.get("name") or local.get("OBJECT_NAME"),
                "INCLINATION": local.get("INCLINATION"), "MEAN_MOTION": local.get("MEAN_MOTION"), "EPOCH": local.get("EPOCH"),
            },
            "satnogsUrl": source_url,
            "source": "SatNOGS DB + catalogo CelesTrak locale" if sat and local else "SatNOGS DB" if sat else "catalogo CelesTrak locale",
            "cacheState": index["state"],
        })

    # Repeated identical files are likely catalogue artwork; they are not counted as individual photos.
    image_counts = {}
    for item in found:
        image_hash = (item.get("image") or {}).get("sha256")
        if image_hash:
            image_counts[image_hash] = image_counts.get(image_hash, 0) + 1
    filtered = []
    for item in found:
        image_hash = (item.get("image") or {}).get("sha256")
        if image_hash and image_counts[image_hash] > 1:
            item["imageVerified"] = False
            item["photoStatus"] = "unverified"
            item["image"] = None
            if verified_image_only:
                continue
        item.pop("_candidateIndex", None)
        filtered.append(item)

    return {
        "items": filtered[:limit],
        "query": query.strip(),
        "group": group or "all",
        "limit": limit,
        "offset": offset,
        "nextOffset": offset + len(page),
        "hasMore": offset + len(page) < total_candidates,
        "totalCandidates": total_candidates,
        "scanned": len(page),
        "sourceErrors": source_errors,
        "sourceStatus": "degraded" if source_errors else "ok",
        "coverage": "partial",
        "coverageNote": "Indice degli oggetti pubblicati da SatNOGS DB con unione degli snapshot CelesTrak locali disponibili. Un indice SatNOGS completo non equivale a copertura di tutti gli oggetti orbitali; se la fonte non risponde, gli stati di presenza sono unknown.",
        "source": "SatNOGS DB API + catalogo CelesTrak locale",
        "indexState": index["state"],
        "indexAgeSeconds": index.get("ageSeconds"),
        "indexComplete": index["complete"],
        "sourceWarning": index.get("warning"),
        "imageRule": "File immagine associato da SatNOGS, raggiungibile e valido, formato raster >=160×120 e 4 KiB, con colori sufficienti; nomi tipici di placeholder e immagini identiche condivise nello stesso blocco sono esclusi. Verifica tecnica, non classificazione visiva del soggetto.",
        "cache": f"Indice SatNOGS su disco: {index['state']} (TTL {SATNOGS_INDEX_TTL_SECONDS // 3600} h); verifiche immagine su disco fino a 30 giorni.",
    }

