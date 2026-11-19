import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID
from xml.etree import ElementTree

import requests
from PIL import Image, ImageChops
from urllib3.exceptions import ReadTimeoutError

from app.core.config import settings


logger = logging.getLogger(__name__)

WMS_URL = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
SNAPSHOT_URL = "https://wvs.earthdata.nasa.gov/api/v1/snapshot"
COPERNICUS_SOURCE = "Copernicus Data Space / Sentinel Hub"
BASEMAP = "BlueMarble_ShadedRelief"
MODIS_TERRA = "MODIS_Terra_CorrectedReflectance_TrueColor"
VIIRS_NOAA20 = "VIIRS_NOAA20_CorrectedReflectance_TrueColor"
WIDTH, HEIGHT = 2048, 1024
MAP_PARAMS = {"BBOX": "-180,-90,180,90", "WIDTH": WIDTH, "HEIGHT": HEIGHT, "FORMAT": "image/png"}
WMS_PARAMS = {"SERVICE": "WMS", "VERSION": "1.1.1", "REQUEST": "GetMap", "SRS": "EPSG:4326", "STYLES": ""}
SNAPSHOT_PARAMS = {"REQUEST": "GetSnapshot", "CRS": "EPSG:4326", "WRAP": "day"}
HEADERS = {"User-Agent": "SpaceFree/1.0 (Earth imagery)", "Accept": "image/png"}
TIMEOUT = (4, 12)
PNG_END = b"\x00\x00\x00\x00IEND\xaeB\x60\x82"


class ImageryUnavailable(Exception):
    def __init__(
        self, message: str, *, reason: str, status: int = 502,
        offline: bool = False, upstream_status: int | None = None,
    ):
        super().__init__(message)
        self.reason = reason
        self.status = status
        self.offline = offline
        self.upstream_status = upstream_status


@dataclass(frozen=True)
class MapRequest:
    url: str
    source: str
    layer: str
    params: dict[str, str]
    date: str | None = None
    period: str | None = None
    requires_response: bool = False
    black_is_nodata: bool = False


@dataclass(frozen=True)
class MapImage:
    content: bytes
    source: str
    date: str | None
    period: str | None
    black_is_nodata: bool
    coverage: float | None


def _nasa_requests(year: int | None) -> list[MapRequest]:
    layer = BASEMAP if year is None else MODIS_TERRA
    date = None if year is None else f"{year}-07-01"
    requests_to_try = [
        MapRequest(WMS_URL, "NASA GIBS WMS", layer, WMS_PARAMS, date, black_is_nodata=year is not None),
        MapRequest(SNAPSHOT_URL, "NASA Worldview Snapshots", layer, SNAPSHOT_PARAMS, date),
    ]
    if year is not None:
        alternate_layer = VIIRS_NOAA20 if year >= 2018 else MODIS_TERRA
        alternate_date = date if year >= 2018 else f"{year}-06-15"
        requests_to_try.append(
            MapRequest(
                WMS_URL, "NASA GIBS WMS", alternate_layer, WMS_PARAMS, alternate_date,
                requires_response=True, black_is_nodata=True,
            )
        )
    return requests_to_try


def _copernicus_requests(year: int | None) -> list[MapRequest]:
    if year is not None and year < 2015:
        raise ImageryUnavailable("Sentinel-2 non disponibile prima del 2015.", reason="no-coverage", status=404)
    endpoint = settings.COPERNICUS_WMS_ENDPOINT.strip().rstrip("/")
    instance_id = settings.COPERNICUS_WMS_INSTANCE.strip()
    layer = settings.COPERNICUS_WMS_LAYER.strip()
    missing = [
        name for name, value in (
            ("COPERNICUS_WMS_ENDPOINT", endpoint),
            ("COPERNICUS_WMS_INSTANCE", instance_id),
            ("COPERNICUS_WMS_LAYER", layer),
        ) if not value
    ]
    if missing:
        raise ImageryUnavailable(
            f"Configurazione WMS Copernicus incompleta. Variabili mancanti: {', '.join(missing)}.",
            reason="missing-config", status=503,
        )
    try:
        url = urlsplit(endpoint)
        if (
            url.scheme != "https" or not url.hostname or url.username is not None
            or url.query or url.fragment or not url.path.endswith("/wms")
            or re.search(r"[\s?#\\]", endpoint) or url.port == 0
        ):
            raise ValueError
    except ValueError:
        raise ImageryUnavailable(
            "COPERNICUS_WMS_ENDPOINT deve essere un URL HTTPS base che termina in /wms.",
            reason="invalid-config", status=503,
        ) from None
    try:
        instance = UUID(instance_id)
    except ValueError:
        raise ImageryUnavailable(
            "COPERNICUS_WMS_INSTANCE deve contenere l'UUID dell'istanza Sentinel Hub.",
            reason="invalid-config", status=503,
        ) from None
    if not re.fullmatch(r"[A-Za-z0-9_.:-]+", layer):
        raise ImageryUnavailable(
            "COPERNICUS_WMS_LAYER deve contenere il nome di un singolo layer WMS.",
            reason="invalid-config", status=503,
        )

    # A mosaic has a request window, not a single observation date.
    period = f"{year}-07-01/{year}-09-30" if year is not None else None
    return [
        MapRequest(
            f"{endpoint}/{instance}", COPERNICUS_SOURCE,
            layer, {**WMS_PARAMS, "TRANSPARENT": "TRUE", "SHOWLOGO": "false"}, period=period,
        )
    ]


PROVIDERS: dict[str, Callable[[int | None], list[MapRequest]]] = {
    "nasa": _nasa_requests,
    "copernicus": _copernicus_requests,
}


def _wms_error(response: requests.Response) -> ImageryUnavailable:
    status = response.status_code
    code = ""
    message = ""
    if len(response.content) <= 16_384:
        try:
            root = ElementTree.fromstring(response.content)
            for node in root.iter():
                if node.tag.split("}")[-1] in {"ServiceException", "Exception"}:
                    code = (node.get("code") or node.get("exceptionCode") or "").lower()
                    message = " ".join(node.itertext()).lower()
                    break
        except (ElementTree.ParseError, ValueError, LookupError):
            pass

    reason, detail, status_code = "invalid-content-type", "La fonte WMS non ha restituito un PNG.", 502
    if status in {401, 403}:
        reason, detail = "upstream-access-denied", "Accesso WMS negato. Verificare istanza e autorizzazioni."
    elif "invalid instance id" in message:
        reason, detail = "upstream-instance-rejected", "Il servizio WMS ha rifiutato l'istanza configurata."
    elif code == "layernotdefined" or "layer not found" in message or "invalid layer" in message:
        reason, detail = "upstream-layer-rejected", "Il servizio WMS ha rifiutato il layer configurato."
    elif code in {"invalidcrs", "invalidsrs"}:
        reason, detail = "upstream-crs-rejected", "Il layer WMS non supporta la proiezione EPSG:4326 richiesta."
    elif code == "invaliddimensionvalue":
        reason, detail, status_code = "no-coverage", "Il servizio WMS non offre il periodo richiesto.", 404
    elif "meters per pixel" in message or "metres per pixel" in message:
        reason, detail = "upstream-resolution-limit", "Il layer WMS non supporta la risoluzione richiesta per la vista globale."
    elif status == 429:
        reason, detail = "upstream-rate-limit", "Limite di richieste WMS raggiunto. Riprovare più tardi."
    elif status != 200:
        reason, detail = "upstream-http", f"Il servizio WMS ha risposto con HTTP {status}."
    elif code or message:
        reason, detail = "upstream-wms-error", "Il servizio WMS ha restituito un errore GetMap in formato XML."
    return ImageryUnavailable(detail, reason=reason, status=status_code, upstream_status=status)


def _coverage_mask(image: Image.Image, black_is_nodata: bool) -> Image.Image:
    alpha = image.getchannel("A")
    if black_is_nodata:
        # Historical GIBS WMS encodes gaps as opaque, exactly black pixels.
        red, green, blue = (image.getchannel(band) for band in ("R", "G", "B"))
        nonblack = ImageChops.lighter(ImageChops.lighter(red, green), blue)
        alpha = ImageChops.multiply(alpha, nonblack.point([0] + [255] * 255))
    return alpha


def _fetch_map(session: requests.Session, request: MapRequest) -> MapImage:
    params = {**MAP_PARAMS, **request.params, "LAYERS": request.layer}
    if time := request.date or request.period:
        params["TIME"] = time
        if "SERVICE" in request.params:
            params["TRANSPARENT"] = "TRUE"

    try:
        response = session.get(
            request.url, params=params, timeout=TIMEOUT,
            allow_redirects=request.source != COPERNICUS_SOURCE,
        )
    except requests.exceptions.SSLError:
        raise ImageryUnavailable("Connessione TLS WMS non valida.", reason="upstream-tls") from None
    except requests.RequestException as error:
        if isinstance(error, requests.Timeout) or any(isinstance(arg, ReadTimeoutError) for arg in error.args):
            raise ImageryUnavailable(
                "Il servizio di immagini non ha risposto entro il timeout.", reason="upstream-timeout",
                status=504, offline=True,
            ) from None
        if isinstance(error, requests.ConnectionError):
            raise ImageryUnavailable(
                "Il servizio di immagini è irraggiungibile.", reason="upstream-connection",
                status=503, offline=True,
            ) from None
        raise ImageryUnavailable("Errore nella richiesta al servizio di immagini.", reason="upstream-request") from None

    media_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
    if response.status_code != 200 or media_type != "image/png":
        raise _wms_error(response)
    try:
        if not response.content.endswith(PNG_END):
            raise ValueError
        with Image.open(BytesIO(response.content), formats=["PNG"]) as image:
            if image.size != (WIDTH, HEIGHT):
                raise ValueError
            image.verify()
        with Image.open(BytesIO(response.content), formats=["PNG"]) as image:
            has_mask = request.black_is_nodata or "A" in image.getbands() or "transparency" in image.info
            rgba = image.convert("RGBA")
    except (OSError, SyntaxError, ValueError, Image.DecompressionBombError):
        raise ImageryUnavailable(
            "PNG WMS non valido, incompleto o con dimensioni diverse da 2048 x 1024.",
            reason="invalid-image", upstream_status=200,
        ) from None

    coverage = None
    if has_mask:
        mask = _coverage_mask(rgba, request.black_is_nodata)
        histogram = mask.histogram()
        coverage = 100 * sum(value * count for value, count in enumerate(histogram)) / (255 * WIDTH * HEIGHT)
        if coverage == 0 or (
            request.source != COPERNICUS_SOURCE and not request.black_is_nodata
            and not rgba.convert("RGB").getbbox()
        ):
            raise ImageryUnavailable(
                "La fonte ha restituito un raster vuoto per l'area e il periodo richiesti.",
                reason="no-coverage", status=404, upstream_status=200,
            )
    elif not rgba.convert("RGB").getbbox():
        raise ImageryUnavailable(
            "Il raster WMS è interamente nero e privo di maschera di copertura.",
            reason="unverified-blank-image", upstream_status=200,
        )
    return MapImage(
        response.content, f"{request.source} / {request.layer}",
        request.date, request.period, request.black_is_nodata, coverage,
    )


def fill_earth_gaps(image: MapImage, background_path: Path) -> bytes | None:
    if image.coverage is None or image.coverage >= 100:
        return None
    with Image.open(BytesIO(image.content)) as original:
        overlay = original.convert("RGBA")
    try:
        with Image.open(background_path) as background:
            base = background.convert("RGBA").resize(overlay.size, Image.Resampling.LANCZOS)
    except OSError as error:
        logger.warning("Sfondo terrestre locale non disponibile: %s", error)
        return None

    overlay.putalpha(_coverage_mask(overlay, image.black_is_nodata))
    output = BytesIO()
    Image.alpha_composite(base, overlay).convert("RGB").save(output, format="PNG")
    return output.getvalue()


def fetch_earth_image(year: int | None = None, provider: str = "nasa") -> MapImage:
    build_requests = PROVIDERS.get(provider)
    if build_requests is None:
        raise ImageryUnavailable("Fonte per il globo sconosciuta.", reason="unknown-provider", status=400)

    with requests.Session() as session:
        session.headers.update(HEADERS)
        failure = None
        for candidate in build_requests(year):
            if candidate.requires_response and (failure is None or failure.offline):
                continue
            try:
                return _fetch_map(session, candidate)
            except ImageryUnavailable as error:
                if failure is None or not error.offline or failure.offline:
                    failure = error
                logger.warning(
                    "%s (%s, %s): %s (upstream status %s)",
                    candidate.source, candidate.layer, candidate.date or candidate.period,
                    error.reason, error.upstream_status,
                )
    if failure is not None:
        raise failure
    raise ImageryUnavailable("Nessuna richiesta disponibile per la fonte selezionata.", reason="no-request")
