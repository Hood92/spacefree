import tempfile
from datetime import datetime, timezone
from io import BytesIO
from unittest import TestCase
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
import requests
from PIL import Image

from app import main as main_module
from app.main import app, _geodetic_state
from app.services import earth_object_details as details_service


class EarthObjectDetailsTests(TestCase):
    def setUp(self):
        self.client = self.enterContext(TestClient(app))
        self.cache_dir = tempfile.TemporaryDirectory()
        self.enterContext(self.cache_dir)
        self.enterContext(patch.object(details_service, "CACHE_DIR", __import__("pathlib").Path(self.cache_dir.name)))
        self.satnogs_records = {
            25544: {
                "sat_id": "ISS-TEST", "norad_cat_id": 25544, "name": "ISS", "names": "ZARYA",
                "image": "satellites/ISS.jpg", "launched": "1998-11-20T00:00:00Z",
                "countries": "RU,US", "website": "https://www.nasa.gov/mission_pages/station/main/index.html",
            },
            33591: {
                "sat_id": "NOAA19-TEST", "norad_cat_id": 33591, "name": "NOAA 19",
                "image": None, "launched": "2009-02-06T00:00:00Z", "countries": "US",
                "operator": "NOAA", "status": "in orbit",
            },
        }
        self.fetch_patch = self.enterContext(patch.object(
            details_service, "_fetch_satnogs_record",
            side_effect=lambda norad: self.satnogs_records.get(norad),
        ))
        self.local_patch = self.enterContext(patch.object(
            details_service, "_local_catalog_record",
            side_effect=lambda norad: (
                ({"NORAD_CAT_ID": norad, "OBJECT_NAME": "FENGYUN 1C DEB", "OBJECT_TYPE": "DEBRIS"}, "celestrak-fengyun-1c-debris.json")
                if norad == 31190 else (None, None)
            ),
        ))

    def test_iss_station_has_attributed_satnogs_metadata_and_image(self):
        with patch.object(
            details_service,
            "_verify_satnogs_image",
            side_effect=lambda image: ({**image, "verified": True, "sha256": "iss-image-hash"} if image else None),
        ):
            response = self.client.get("/api/earth/object/25544?group=stations")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "available")
        self.assertEqual(data["name"], "ISS")
        self.assertEqual(data["launchDate"], "1998-11-20T00:00:00Z")
        self.assertEqual(data["image"]["url"], "https://db-satnogs.freetls.fastly.net/media/satellites/ISS.jpg")
        self.assertIn("SatNOGS DB", data["sources"][0]["name"])

    def test_active_satellite_returns_only_catalogued_fields_and_no_fake_image(self):
        response = self.client.get("/api/earth/object/33591?group=active")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["name"], "NOAA 19")
        self.assertEqual(data["owner"], "NOAA")
        self.assertIsNone(data["image"])
        self.assertIsNone(data["description"])

    def test_debris_without_satnogs_record_is_partial_and_has_no_image_or_biography(self):
        response = self.client.get("/api/earth/object/31190?group=debris")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "partial")
        self.assertEqual(data["type"], "DEBRIS")
        self.assertIsNone(data["image"])
        self.assertIsNone(data["description"])

    def test_unknown_object_is_unavailable_and_invalid_norad_is_rejected(self):
        response = self.client.get("/api/earth/object/999999?group=active")
        self.assertEqual(response.json()["status"], "unavailable")
        self.assertEqual(self.client.get("/api/earth/object/0").status_code, 400)

    def test_search_returns_only_verified_image_when_filter_is_enabled(self):
        candidates = [
            {"noradId": 25544, "group": "stations", "record": {"OBJECT_NAME": "ISS"}},
            {"noradId": 31190, "group": "debris", "record": {"OBJECT_NAME": "FENGYUN 1C DEB"}},
        ]

        satnogs_index = {
            "records": [{"sat_id": "ISS-TEST", "norad_cat_id": 25544, "name": "ISS", "names": "ZARYA", "image": "satellites/ISS.jpg", "launched": "1998-11-20", "countries": "RU,US"}],
            "state": "cache", "ageSeconds": 10, "complete": True,
        }
        with patch.object(details_service, "_iter_local_catalog", return_value=candidates), patch.object(
            details_service, "_get_satnogs_index", return_value=satnogs_index
        ), patch.object(
            details_service, "_verify_satnogs_image",
            side_effect=lambda image: {**image, "verified": True, "sha256": "iss"} if image else None,
        ):
            response = self.client.get("/api/earth/objects/search?q=ISS&verified_image_only=true&limit=4&offset=0")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual([item["noradId"] for item in data["items"]], [25544])
        self.assertTrue(data["items"][0]["imageVerified"])
        self.assertEqual(data["items"][0]["satnogsStatus"], "present")
        self.assertEqual(data["items"][0]["photoStatus"], "verified")
        self.assertEqual(data["coverage"], "partial")
        self.assertGreaterEqual(data["scanned"], 1)

    def test_index_search_matches_designator_and_reports_no_satnogs_card(self):
        candidates = [{"noradId": 31190, "group": "debris", "record": {
            "OBJECT_NAME": "FENGYUN 1C DEB", "OBJECT_ID": "1999-025ABC", "OBJECT_TYPE": "DEBRIS",
        }}]
        with patch.object(details_service, "_iter_local_catalog", return_value=candidates), patch.object(
            details_service, "_get_satnogs_index",
            return_value={"records": [], "state": "updated", "ageSeconds": 0, "complete": True},
        ):
            response = self.client.get("/api/earth/objects/search?q=1999-025ABC&verified_image_only=false")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["items"][0]["noradId"], 31190)
        self.assertEqual(data["items"][0]["satnogsStatus"], "absent")
        self.assertEqual(data["items"][0]["photoStatus"], "none")

    def test_unavailable_index_does_not_claim_that_card_is_absent(self):
        with patch.object(details_service, "_read_satnogs_index_cache", return_value=None), patch.object(
            details_service.requests, "get", side_effect=requests.ConnectionError("offline")
        ):
            result = details_service._get_satnogs_index()
        self.assertFalse(result["complete"])
        self.assertEqual(result["state"], "unavailable")

    def test_satnogs_full_index_is_cached_to_disk(self):
        response = requests.Response()
        response.status_code = 200
        response._content = b'[{"norad_cat_id":25544,"name":"ISS"}]'
        with patch.object(details_service, "requests") as requests_mock:
            requests_mock.get.return_value = response
            first = details_service._get_satnogs_index()
            second = details_service._get_satnogs_index()
        self.assertEqual(first["records"][0]["norad_cat_id"], 25544)
        self.assertEqual(first["state"], "updated")
        self.assertEqual(second["state"], "cache")
        requests_mock.get.assert_called_once()

    def test_geodetic_state_is_derived_from_teme_position_and_velocity(self):
        state = _geodetic_state(
            (6878.137, 0.0, 0.0), (0.0, 7.5, 0.0),
            datetime(2026, 11, 27, tzinfo=timezone.utc),
        )
        self.assertAlmostEqual(state["altitudeKm"], 500.0, places=3)
        self.assertAlmostEqual(state["latitudeDeg"], 0.0, places=3)
        self.assertAlmostEqual(state["speedKmPerSec"], 7.5, places=6)
        self.assertGreaterEqual(state["longitudeDeg"], -180)
        self.assertLessEqual(state["longitudeDeg"], 180)

    def test_selected_object_state_endpoint_returns_sgp4_kinematics_not_telemetry(self):
        omm_record = {
            "OBJECT_NAME": "ISS", "OBJECT_ID": "1998-067A", "CENTER_NAME": "EARTH",
            "REF_FRAME": "TEME", "TIME_SYSTEM": "UTC", "MEAN_ELEMENT_THEORY": "SGP4",
            "EPOCH": "2020-01-01T00:00:00.000000", "MEAN_MOTION": 15.5,
            "ECCENTRICITY": 0.0001, "INCLINATION": 51.6, "RA_OF_ASC_NODE": 20.0,
            "ARG_OF_PERICENTER": 50.0, "MEAN_ANOMALY": 40.0, "EPHEMERIS_TYPE": 0,
            "CLASSIFICATION_TYPE": "U", "NORAD_CAT_ID": 25544, "ELEMENT_SET_NO": 999,
            "REV_AT_EPOCH": 12345, "BSTAR": 0.0001, "MEAN_MOTION_DOT": 0.00001,
            "MEAN_MOTION_DDOT": 0.0,
        }
        catalog = {"objects": [omm_record], "updatedAt": "2026-11-27T00:00:00Z", "source": "test"}
        with patch.object(main_module, "orbital_objects", new=AsyncMock(return_value=catalog)):
            bulk_response = self.client.get("/api/orbital-positions?group=active&limit=1")
            response = self.client.get("/api/orbital-state/25544?group=active&at=2026-11-27T12:00:00Z")
        self.assertEqual(bulk_response.status_code, 200, bulk_response.text)
        bulk = bulk_response.json()
        self.assertEqual(bulk["elementModel"], "CelesTrak OMM da cache locale")
        self.assertEqual(bulk["coordinateFrame"], "TEME")
        self.assertEqual(len(bulk["positions"][0]["velocityKmPerSec"]), 3)
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["propagator"], "python-sgp4 / WGS72")
        self.assertEqual(data["telemetryStatus"], "not-integrated")
        self.assertEqual(len(data["positionKm"]), 3)
        self.assertEqual(len(data["velocityKmPerSec"]), 3)
        self.assertGreater(data["altitudeKm"], 100)

    def test_verifier_rejects_known_placeholder_filename_and_accepts_real_raster_asset(self):
        placeholder = details_service._verify_satnogs_image({
            "url": "https://db-satnogs.freetls.fastly.net/media/satellites/default-satellite.png"
        })
        self.assertFalse(placeholder["verified"])

        output = BytesIO()
        Image.effect_noise((256, 256), 80).convert("RGB").save(output, format="JPEG", quality=92)
        response = requests.Response()
        response.status_code = 200
        response.headers["Content-Type"] = "image/jpeg"
        response.raw = BytesIO(output.getvalue())
        with patch.object(details_service.requests, "get", return_value=response):
            verified = details_service._verify_satnogs_image({"url": "https://db-satnogs.freetls.fastly.net/media/satellites/test-real.jpg"})
        self.assertTrue(verified["verified"])
