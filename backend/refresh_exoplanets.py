import json
import time
from pathlib import Path
from tempfile import NamedTemporaryFile

import requests


def refresh_exoplanets():
    response = requests.get(
        "https://exoplanetarchive.ipac.caltech.edu/TAP/sync",
        params={
            "query": (
                "select pl_name,hostname,pl_rade,pl_bmasse,pl_orbsmax,pl_orbper,"
                "st_spectype,sy_dist,ra,dec from ps where default_flag=1 "
                "and sy_dist is not null order by sy_dist asc"
            ),
            "format": "json",
        },
        timeout=(5, 45),
    )
    response.raise_for_status()
    rows = response.json()
    if not isinstance(rows, list) or not any(
        isinstance(row, dict) and row.get("ra") is not None and row.get("dec") is not None
        for row in rows
    ):
        raise ValueError("La risposta NASA non contiene coordinate utilizzabili.")
    cache = Path(__file__).resolve().parents[1] / ".cache"
    cache.mkdir(exist_ok=True)
    now = int(time.time() * 1000)
    with NamedTemporaryFile(mode="w", encoding="utf-8", dir=cache, delete=False) as output:
        temporary_path = Path(output.name)
        try:
            json.dump({"data": rows, "fetchedAt": now, "checkedAt": now}, output)
            output.close()
            temporary_path.replace(cache / "nasa-exoplanets.json")
        finally:
            temporary_path.unlink(missing_ok=True)
    print(f"{len(rows)} record scaricati dal NASA Exoplanet Archive.")


if __name__ == "__main__":
    refresh_exoplanets()
