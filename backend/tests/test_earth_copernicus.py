from io import BytesIO
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

import requests
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.services.earth_imagery import HEIGHT, WIDTH, settings


def upstream_response(content, content_type="image/png", status=200):
    response = requests.Response()
    response.status_code = status
    response.headers["Content-Type"] = content_type
    response._content = content
    return response


def png_response(mode, color, partial=False):
    image = Image.new(mode, (WIDTH, HEIGHT), color)
    if partial:
        image.paste((0, 0, 0, 0), (WIDTH // 2, 0, WIDTH, HEIGHT))
    output = BytesIO()
    image.save(output, format="PNG")
    return upstream_response(output.getvalue())


class CopernicusWMSTests(TestCase):
    texture_url = "/api/earth/texture/2020?provider=copernicus"
    basemap_url = "/api/earth/basemap?provider=copernicus"
    instance = "124a7e17-e9ff-4a87-87bd-860c341b2937"

    def setUp(self):
        self.client = self.enterContext(TestClient(app))
        self.enterContext(patch.multiple(
            settings, COPERNICUS_WMS_ENDPOINT="https://example.test/ogc/wms",
            COPERNICUS_WMS_INSTANCE=self.instance, COPERNICUS_WMS_LAYER="RGB_TEST",
        ))
        self.get = self.enterContext(patch.object(requests.Session, "get"))

    def test_configuration_errors_do_not_contact_upstream(self):
        for name, value, reason in [
            ("COPERNICUS_WMS_ENDPOINT", "", "missing-config"),
            ("COPERNICUS_WMS_ENDPOINT", "http://example.test/wms?token=x", "invalid-config"),
            ("COPERNICUS_WMS_INSTANCE", "", "missing-config"),
            ("COPERNICUS_WMS_INSTANCE", "invalid", "invalid-config"),
            ("COPERNICUS_WMS_LAYER", "", "missing-config"),
            ("COPERNICUS_WMS_LAYER", "RGB,ANOTHER", "invalid-config"),
        ]:
            with self.subTest(name=name, reason=reason), patch.object(settings, name, value):
                result = self.client.get(self.texture_url)
                self.assertEqual(result.status_code, 503)
                self.assertEqual(result.headers["X-Texture-Reason"], reason)
                self.assertIn(name, result.json()["detail"])
        self.get.assert_not_called()

    def test_request_uses_global_lon_lat_extent_and_explicit_time_range(self):
        self.get.return_value = png_response("RGBA", (0, 0, 0, 255))
        result = self.client.get(self.texture_url)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.headers["X-Texture-Status"], "real")
        self.assertEqual(result.headers["X-Image-Coverage"], "100")
        self.assertEqual(result.headers["X-Image-Period"], "2020-07-01/2020-09-30")
        self.assertNotIn("X-Image-Date", result.headers)
        self.assertNotIn(self.instance, str(dict(result.headers)))
        self.assertEqual(self.get.call_args.args, (f"https://example.test/ogc/wms/{self.instance}",))
        params = self.get.call_args.kwargs["params"]
        self.assertEqual(
            [params[name] for name in ("VERSION", "SRS", "BBOX", "TIME", "TRANSPARENT")],
            ["1.1.1", "EPSG:4326", "-180,-90,180,90", "2020-07-01/2020-09-30", "TRUE"],
        )
        self.assertFalse(self.get.call_args.kwargs["allow_redirects"])
        self.assertEqual(self.client.get(self.basemap_url).status_code, 200)
        self.assertNotIn("TIME", self.get.call_args.kwargs["params"])

    def test_partial_image_is_labeled_with_and_without_composition(self):
        self.get.return_value = png_response("RGBA", (120, 20, 50, 255), partial=True)
        result = self.client.get(self.texture_url)
        self.assertEqual(result.headers["X-Texture-Status"], "partial")
        self.assertEqual(result.headers["X-Image-Coverage"], "50")
        self.assertNotIn("X-Texture-Background", result.headers)
        self.assertEqual(result.content, self.get.return_value.content)
        result = self.client.get(self.texture_url + "&fill_gaps=true", headers={"Origin": "http://127.0.0.1:3000"})
        self.assertIn("X-Texture-Background", result.headers["Access-Control-Expose-Headers"])
        self.assertEqual(result.headers["X-Texture-Status"], "partial")
        self.assertIn("Blue Marble", result.headers["X-Texture-Background"])
        self.assertNotIn("X-Texture-Fallback", result.headers)

    def test_rgb_without_mask_does_not_claim_full_coverage(self):
        self.get.return_value = png_response("RGB", (120, 20, 50))
        result = self.client.get(self.texture_url)
        self.assertEqual(result.headers["X-Texture-Status"], "coverage-unknown")
        self.assertNotIn("X-Image-Coverage", result.headers)

    def test_empty_invalid_and_wms_errors_are_never_images(self):
        for upstream, status, reason in [
            (png_response("RGBA", (120, 20, 50, 0)), 404, "no-coverage"),
            (upstream_response(b"truncated png"), 502, "invalid-image"),
            (upstream_response(png_response("RGBA", (120, 20, 50, 255)).content[:-4]), 502, "invalid-image"),
            (upstream_response(b"<html>error</html>", "text/html"), 502, "invalid-content-type"),
            (upstream_response(b"<ServiceException code='InvalidDimensionValue'/>", "application/xml"), 404, "no-coverage"),
            (upstream_response(b"<ServiceException>Invalid instance id</ServiceException>", "application/xml", 400), 502, "upstream-instance-rejected"),
            (upstream_response(b"<ServiceException code='LayerNotDefined'/>", "application/xml"), 502, "upstream-layer-rejected"),
            (upstream_response(b"", "application/xml", 403), 502, "upstream-access-denied"),
            (upstream_response(b"", "text/plain", 429), 502, "upstream-rate-limit"),
            (upstream_response(b"", "text/plain", 503), 502, "upstream-http"),
        ]:
            with self.subTest(reason=reason):
                self.get.return_value = upstream
                result = self.client.get(self.texture_url)
                self.assertEqual(result.status_code, status)
                self.assertEqual(result.headers["X-Texture-Status"], "unavailable")
                self.assertEqual(result.headers["X-Texture-Reason"], reason)
                self.assertEqual(result.headers["X-Upstream-Status"], str(upstream.status_code))
                self.assertNotIn("X-Texture-Source", result.headers)

    def test_timeout_and_connection_errors_use_explicit_fallback(self):
        for error, reason in [
            (requests.Timeout, "upstream-timeout"),
            (requests.ConnectionError, "upstream-connection"),
        ]:
            with self.subTest(reason=reason):
                self.get.side_effect = error
                result = self.client.get(self.texture_url)
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.headers["Content-Type"], "image/jpeg")
                self.assertEqual(result.headers["Cache-Control"], "no-store")
                self.assertEqual(result.headers["X-Texture-Status"], "fallback")
                self.assertEqual(result.headers["X-Texture-Reason"], reason)
                self.assertIn("Blue Marble", result.headers["X-Texture-Source"])
                self.assertNotIn("X-Image-Period", result.headers)
        self.get.side_effect = requests.Timeout
        with patch("app.main.EARTH_BASEMAP_PATH", Path("unavailable-blue-marble.jpg")):
            self.assertEqual(self.client.get(self.texture_url).status_code, 504)
