(() => {
  const EARTH_ORBIT_BUILD = "earth-orbit-scene-2026.11.27-e";
  const API_ORIGIN = window.location.port && window.location.port !== "8000"
    ? `${window.location.protocol}//${window.location.hostname}:8000`
    : window.location.origin;
  window.initializeEarthOrbit = function initializeEarthOrbit(THREE) {
    const section = document.getElementById("earth-orbit");
    const mount = document.getElementById("earth-orbit-canvas");
    if (!section || !mount || section.dataset.initialized) return;
    section.dataset.initialized = "true";
    const isolated = section.dataset.earthMode === "local";
    const options = new URLSearchParams(window.location.search);
    const provider = options.get("earthProvider") || "nasa";
    const providerName = provider === "copernicus" ? "Copernicus" : provider === "nasa" ? "NASA" : "della fonte selezionata";
    const yearStatus = document.getElementById("earthYearStatus");

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (error) {
      yearStatus.textContent = "WebGL non disponibile per il globo terrestre.";
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x030e17, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 500);
    camera.position.set(0, 0, 190);
    const world = new THREE.Group();
    world.name = "earth-world";
    scene.add(world);
    const earthRadius = 10;
    const earthGeometry = new THREE.SphereGeometry(earthRadius, 128, 96);
    // Keep the geographic orientation without shifting the raster inside the UV domain.
    earthGeometry.rotateY(Math.PI);
    const earthSurface = new THREE.Group();
    earthSurface.name = "earth-axial-tilt";
    const earth = new THREE.Mesh(
      earthGeometry,
      new THREE.MeshBasicMaterial({ color: 0x123c5d })
    );
    earth.name = "earth-surface";
    earthSurface.rotation.z = THREE.MathUtils.degToRad(23.4);
    earthSurface.add(earth);
    world.add(earthSurface);
    let detailedEarthTexture = null;
    let localBasemapTexture = null;
    let localBasemapPromise = Promise.resolve(null);
    let disposed = false;
    let earthDiagnosticLogged = false;
    const yearSlider = document.getElementById("earthYearSlider");
    const yearValue = document.getElementById("earthYearValue");
    const textureLoader = new THREE.TextureLoader();
    function configureTexture(texture) {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = true;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.offset.set(0, 0);
      texture.repeat.set(1, 1);
      texture.needsUpdate = true;
    }
    function composeEarthTexture(texture) {
      const source = texture.image;
      const width = Math.max(1, source?.naturalWidth || source?.videoWidth || source?.width || 2048);
      const height = Math.max(1, source?.naturalHeight || source?.videoHeight || source?.height || 1024);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      context.fillStyle = "#123c5d";
      context.fillRect(0, 0, width, height);
      const basemap = localBasemapTexture?.image;
      if (basemap) context.drawImage(basemap, 0, 0, width, height);
      // Canvas compositing turns partial/transparent provider pixels into one
      // opaque equirectangular raster before it reaches the single sphere mesh.
      context.drawImage(source, 0, 0, width, height);
      const composed = new THREE.CanvasTexture(canvas);
      configureTexture(composed);
      return composed;
    }
    function applyEarthMap(map, source) {
      if (map && !map.isTexture) {
        throw new TypeError("La mappa terrestre deve essere un oggetto THREE.Texture.");
      }
      if (map) configureTexture(map);
      earth.material.map = map || null;
      earth.material.color.set(map ? 0xffffff : 0x123c5d);
      earth.material.transparent = false;
      earth.material.needsUpdate = true;

      // Log a serialized snapshot: DevTools cannot display a later-mutated object
      // or conflate the texture's constructor name with whether a map is assigned.
      const activeMap = earth.material.map;
      const image = activeMap?.image;
      console.info(`[EarthOrbit texture] ${JSON.stringify({
        build: EARTH_ORBIT_BUILD,
        source,
        hasMap: Boolean(activeMap),
        isTexture: Boolean(activeMap?.isTexture),
        mapType: activeMap?.isCanvasTexture ? "CanvasTexture" : activeMap ? "Texture" : null,
        mapUuid: activeMap?.uuid || null,
        dimensions: image ? [image.width || image.naturalWidth || 0, image.height || image.naturalHeight || 0] : null,
        textureVersion: activeMap?.version ?? null,
        assigned: earth.material.map === map,
        materialTransparent: earth.material.transparent,
      })}`);
      if (map && earth.material.map !== map) {
        throw new Error("La texture terrestre non è rimasta assegnata al materiale.");
      }
    }
    function setEarthTexture(texture, textureStatus = "") {
      // A partial NASA mosaic contains large diagonal acquisition swaths.
      // Keep its reported status, but show the continuous local basemap.
      const useContinuousBasemap = !isolated && (textureStatus === "partial" || textureStatus === "fallback");
      const providerTextureIsComplete = !isolated && texture && textureStatus === "real";
      const displayTexture = texture && !isolated && !useContinuousBasemap && !providerTextureIsComplete
        ? composeEarthTexture(texture)
        : (useContinuousBasemap ? null : texture);
      if (texture && displayTexture !== texture) texture.dispose();
      detailedEarthTexture?.dispose();
      detailedEarthTexture = displayTexture;
      const mapSource = useContinuousBasemap
        ? `Blue Marble locale continua (${textureStatus})`
        : providerTextureIsComplete ? `texture provider originale (${provider}, real)`
          : texture ? (isolated ? "Blue Marble locale (test)" : `texture provider composta (${textureStatus || "stato non verificato"})`)
          : "Blue Marble locale / immagine non disponibile";
      applyEarthMap(displayTexture || (!isolated ? localBasemapTexture : null), mapSource);
      if (!earthDiagnosticLogged) {
        logEarthOrbitDiagnostics();
        earthDiagnosticLogged = true;
      }
    }
    if (!isolated) {
      localBasemapPromise = textureLoader.loadAsync("earth-blue-marble.jpg").then((texture) => {
        if (disposed) { texture.dispose(); return; }
        localBasemapTexture = texture;
        if (!detailedEarthTexture) {
          applyEarthMap(texture, "Blue Marble locale");
        }
        return texture;
      }).catch(() => {
        // La sfera blu uniforme resta comunque continua se manca anche il basemap locale.
        return null;
      });
    }
    let textureRequest = 0;
    let earthYearDebounce = null;
    let earthTextureController = null;
    const earthYearDebounceMs = 220;
    async function loadEarthYear(year) {
      const requestId = ++textureRequest;
      const controller = new AbortController();
      earthTextureController = controller;
      yearValue.value = String(year);
      yearStatus.textContent = (detailedEarthTexture || earth.material.map)
        ? `Caricamento ${providerName} ${year}; l'immagine precedente resta visibile.`
        : `Caricamento immagine ${providerName} per ${year}…`;
      try {
        const query = new URLSearchParams({ provider, fill_gaps: String(options.get("earthRaw") !== "1") });
        const response = await fetch(`${API_ORIGIN}/api/earth/texture/${year}?${query}`, { cache: "no-cache", signal: controller.signal });
        if (!response.ok) {
          const { detail } = await response.json().catch(() => ({}));
          throw new Error(typeof detail === "string" ? detail : `Il backend ha risposto con HTTP ${response.status}.`);
        }
        const status = response.headers.get("X-Texture-Status");
        const fallback = status === "fallback" || response.headers.get("X-Texture-Fallback") === "true";
        const mediaType = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
        if (mediaType !== (fallback ? "image/jpeg" : "image/png")) {
          throw new Error("Il backend ha restituito un formato immagine inatteso.");
        }
        const blob = await response.blob();
        if (requestId !== textureRequest) return;
        const url = URL.createObjectURL(blob);
        let texture;
        try {
          texture = await textureLoader.loadAsync(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        if (requestId !== textureRequest) { texture.dispose(); return; }
        if (!isolated) await localBasemapPromise;
        if (requestId !== textureRequest || disposed) { texture.dispose(); return; }
        setEarthTexture(texture, status || "coverage-unknown");
        const source = response.headers.get("X-Data-Source") || response.headers.get("X-Texture-Source") || "Fonte non dichiarata";
        const date = response.headers.get("X-Image-Date");
        const period = response.headers.get("X-Image-Period");
        const background = response.headers.get("X-Texture-Background");
        const coverage = response.headers.get("X-Image-Coverage");
        const reason = response.headers.get("X-Fallback-Reason");
        const textureStatus = status || "coverage-unknown";
        let description = source;
        if (fallback) {
          description = `Fallback locale · ${source}. Immagine storica ${providerName} non disponibile. ${reason || ""}`.trim();
        } else {
          if (textureStatus === "real") description = `Copertura completa · ${description}`;
          else if (textureStatus === "partial") description = `Copertura parziale · ${description}`;
          else if (textureStatus === "coverage-unknown") description = `Copertura non verificata · ${description}`;
          if (date) description += ` · ${date}`;
          if (period) description += ` · periodo richiesto ${period}`;
          if (status === "partial" && coverage) {
            const percentage = Number(coverage).toLocaleString("it-IT", { maximumFractionDigits: 2 });
            description += ` · immagine parziale · copertura ${percentage}%`;
          } else if (status === "coverage-unknown") {
            description += " · copertura non verificabile";
          }
          if (textureStatus === "partial") {
            if (background) description += ` · risposta composta dal backend su ${background}`;
          } else if (background) {
            description += ` · sfondo statico ${background} nelle lacune`;
          } else if (textureStatus === "coverage-unknown") {
            description += " · trasparenze mostrate sul basemap locale Blue Marble";
          }
          if (textureStatus === "partial") {
            description += " · visualizzazione Blue Marble locale continua: il mosaico parziale contiene bande di acquisizione oblique";
          }
        }
        if (fallback) description += " · visualizzazione Blue Marble locale continua";
        yearStatus.textContent = description;
      } catch (error) {
        if (requestId !== textureRequest || error.name === "AbortError" || disposed) return;
        setEarthTexture(null);
        yearStatus.textContent = `Immagine ${providerName} non disponibile per ${year}. Sfondo Blue Marble locale, non dato remoto.${error.message ? ` ${error.message}` : ""}`;
      } finally {
        if (earthTextureController === controller) earthTextureController = null;
      }
    }
    function scheduleEarthYear(year) {
      window.clearTimeout(earthYearDebounce);
      textureRequest++;
      earthTextureController?.abort();
      earthTextureController = null;
      yearValue.value = String(year);
      yearStatus.textContent = `Anno ${year} selezionato · immagine corrente visibile fino al termine del caricamento.`;
      earthYearDebounce = window.setTimeout(() => {
        earthYearDebounce = null;
        loadEarthYear(year);
      }, earthYearDebounceMs);
    }
    if (isolated) {
      const requestId = ++textureRequest;
      textureLoader.loadAsync("earth-blue-marble.jpg").then((texture) => {
        if (requestId !== textureRequest) { texture.dispose(); return; }
        setEarthTexture(texture);
        yearStatus.textContent = `Texture locale di test · Blue Marble · ${texture.image.width} × ${texture.image.height}`;
      }).catch(() => {
        if (requestId === textureRequest) yearStatus.textContent = "Texture locale non disponibile.";
      });
    } else {
      yearSlider.addEventListener("input", () => scheduleEarthYear(Number(yearSlider.value)));
      loadEarthYear(Number(yearSlider.value));
    }
    const satelliteGeometry = new THREE.BufferGeometry();
    satelliteGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    const satellitePoints = new THREE.Points(
      satelliteGeometry,
      new THREE.PointsMaterial({ color: 0xb8f93a, size: 3, sizeAttenuation: false, transparent: true, opacity: 0.9 })
    );
    satellitePoints.name = "satellite-points";
    if (!isolated) world.add(satellitePoints);
    const selectedMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xb8f93a, transparent: true, opacity: 0.9 })
    );
    selectedMarker.name = "selected-orbit-object-marker";
    selectedMarker.visible = false;
    if (!isolated) world.add(selectedMarker);

    const scriptUrl = [...document.scripts]
      .map((script) => script.src)
      .find((src) => src && new URL(src).pathname.endsWith("/earth-orbit.js")) || "URL script non individuata";
    const sceneObjects = [];
    scene.traverse((object) => {
      if (object !== scene) sceneObjects.push({
        name: object.name || object.type,
        type: object.type,
        geometry: object.geometry?.type || null,
        material: Array.isArray(object.material)
          ? object.material.map((material) => material.type)
          : object.material?.type || null,
      });
    });
    function logEarthOrbitDiagnostics() {
      console.info("[EarthOrbit diagnostica]", {
      build: EARTH_ORBIT_BUILD,
      scriptUrl,
      threeRevision: THREE.REVISION,
      mode: isolated ? "test-locale" : "orbitale",
      sphere: {
        radius: earthGeometry.parameters.radius,
        widthSegments: earthGeometry.parameters.widthSegments,
        heightSegments: earthGeometry.parameters.heightSegments,
        material: earth.material.type,
        side: earth.material.side,
        transparent: earth.material.transparent,
        map: earth.material.map?.isCanvasTexture ? "CanvasTexture" : earth.material.map?.isTexture ? "Texture" : null,
        hasMap: Boolean(earth.material.map),
        textureVersion: earth.material.map?.version ?? null,
      },
      renderer: {
        antialias: renderer.getContext().getContextAttributes()?.antialias,
        pixelRatio: renderer.getPixelRatio(),
        alpha: renderer.getContext().getContextAttributes()?.alpha,
      },
      camera: {
        type: camera.type,
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
        position: camera.position.toArray(),
      },
      sceneObjects,
      });
    }

    let positionEntries = [];
    let currentObjects = [];
    let simulationTimeMs = Date.now();
    let simulationRate = 1;
    let simulationPaused = false;
    let lastFrameTime = null;
    let lastKinematicsUiUpdate = 0;
    let selectedObjectId = null;
    let trajectoryWorker = null;
    let trajectorySamples = [];
    let trajectoryGeneration = 0;
    let trajectoryWorkerBusy = false;
    let trajectoryWorkerReady = false;
    let trajectoryWorkerDisabled = false;
    let trajectoryRetryAfter = 0;
    let interpolatedPositions = new Float64Array(0);
    let interpolatedVelocities = new Float64Array(0);
    const trajectoryStepMs = 30_000;
    let lastBoundsUpdateMs = -Infinity;
    let selectedGroup = "active";
    let selectedDetailsController = null;
    let selectedDetailsRequest = 0;
    let earthSearchController = null;
    let earthSearchRequest = 0;
    let earthSearchOffsets = [0];
    let earthSearchNextOffset = null;
    let orbitVisible = false;
    let groupRequest = 0;
    let activeGroupRequest = null;
    const positionCache = new Map();
    const retryAfter = new Map();
    const positionCacheTtlMs = 2 * 60 * 1000;
    const positionRetryDelayMs = 30 * 1000;
    const orbitalLimit = 12000;
    let frame = 0;
    let dragging = false;
    let dragged = false;
    let lastPointer = null;
    const orbitTouches = new Map();
    let pinchStart = null;
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 1.5;
    const pointer = new THREE.Vector2();

    let minZoom = 0;
    function resize() {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      camera.aspect = width / height;
      const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * camera.aspect);
      const firstResize = minZoom === 0;
      minZoom = earthRadius * 1.08 / Math.sin(Math.min(verticalHalfFov, horizontalHalfFov));
      if (isolated && firstResize) camera.position.z = minZoom * 1.18;
      camera.position.z = Math.max(camera.position.z, minZoom);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    }
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    function trajectorySpanAt(atMs) {
      if (!trajectorySamples.length) return null;
      if (trajectorySamples.length === 1 || atMs <= trajectorySamples[0].timeMs) return { a: trajectorySamples[0], b: trajectorySamples[0], u: 0, dtSeconds: 0 };
      for (let index = 1; index < trajectorySamples.length; index++) {
        const a = trajectorySamples[index - 1], b = trajectorySamples[index];
        if (atMs <= b.timeMs) {
          const dtSeconds = Math.max(1e-6, (b.timeMs - a.timeMs) / 1000);
          return { a, b, u: Math.max(0, Math.min(1, (atMs - a.timeMs) / (b.timeMs - a.timeMs))), dtSeconds };
        }
      }
      const last = trajectorySamples[trajectorySamples.length - 1];
      return { a: last, b: last, u: 0, dtSeconds: 0 };
    }

    function updateInterpolatedTrajectory(atMs) {
      const size = positionEntries.length * 3;
      if (interpolatedPositions.length !== size) {
        interpolatedPositions = new Float64Array(size);
        interpolatedVelocities = new Float64Array(size);
      }
      const span = trajectorySpanAt(atMs);
      if (!span) return null;
      const { a, b, u, dtSeconds } = span;
      if (a === b || dtSeconds <= 0) {
        interpolatedPositions.set(a.positions);
        interpolatedVelocities.set(a.velocities);
        return span;
      }
      const u2 = u * u, u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u;
      const h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
      const dh00 = (6 * u2 - 6 * u) / dtSeconds, dh10 = 3 * u2 - 4 * u + 1;
      const dh01 = (-6 * u2 + 6 * u) / dtSeconds, dh11 = 3 * u2 - 2 * u;
      for (let offset = 0; offset < size; offset++) {
        const p0 = a.positions[offset], p1 = b.positions[offset];
        const v0 = a.velocities[offset], v1 = b.velocities[offset];
        if (!Number.isFinite(p0) || !Number.isFinite(p1) || !Number.isFinite(v0) || !Number.isFinite(v1)) {
          interpolatedPositions[offset] = Number.NaN;
          interpolatedVelocities[offset] = Number.NaN;
          continue;
        }
        interpolatedPositions[offset] = h00 * p0 + h10 * dtSeconds * v0 + h01 * p1 + h11 * dtSeconds * v1;
        interpolatedVelocities[offset] = dh00 * p0 + dh10 * v0 + dh01 * p1 + dh11 * v1;
      }
      return span;
    }

    function geodeticState(position, velocity, atMs) {
      const julianDate = atMs / 86400000 + 2440587.5;
      const centuries = (julianDate - 2451545.0) / 36525;
      const gmst = (280.46061837 + 360.98564736629 * (julianDate - 2451545.0) + 0.000387933 * centuries ** 2 - centuries ** 3 / 38710000) * Math.PI / 180;
      const cos = Math.cos(gmst), sin = Math.sin(gmst);
      const ecefX = cos * position[0] + sin * position[1], ecefY = -sin * position[0] + cos * position[1], ecefZ = position[2];
      const a = 6378.137, eccentricitySquared = 6.69437999014e-3, horizontal = Math.hypot(ecefX, ecefY);
      let latitude = Math.atan2(ecefZ, horizontal * (1 - eccentricitySquared)), altitude = 0;
      for (let iteration = 0; iteration < 5; iteration++) {
        const primeVertical = a / Math.sqrt(1 - eccentricitySquared * Math.sin(latitude) ** 2);
        const cosLatitude = Math.cos(latitude);
        altitude = Math.abs(cosLatitude) > 1e-10 ? horizontal / cosLatitude - primeVertical : Math.abs(ecefZ) - primeVertical * (1 - eccentricitySquared);
        latitude = Math.atan2(ecefZ, horizontal * (1 - eccentricitySquared * primeVertical / (primeVertical + altitude)));
      }
      return { altitude, speed: Math.hypot(velocity[0], velocity[1], velocity[2]), latitude: latitude * 180 / Math.PI, longitude: ((Math.atan2(ecefY, ecefX) * 180 / Math.PI + 540) % 360) - 180 };
    }

    function updateSelectedKinematics(atMs = simulationTimeMs) {
      const id = Number(selectedObjectId);
      const index = positionEntries.findIndex((entry) => Number(entry.object.NORAD_CAT_ID ?? entry.object.norad_cat_id) === id);
      const span = updateInterpolatedTrajectory(atMs);
      if (index < 0 || !span) {
        document.getElementById("earth-object-kinematics-status").textContent = "Campioni SGP4 non disponibili per questo oggetto.";
        return;
      }
      const offset = index * 3;
      const position = interpolatedPositions.subarray(offset, offset + 3), velocity = interpolatedVelocities.subarray(offset, offset + 3);
      if (![...position, ...velocity].every(Number.isFinite)) {
        document.getElementById("earth-object-kinematics-status").textContent = "SGP4 non ha prodotto uno stato valido per questo elemento.";
        return;
      }
      const values = geodeticState(position, velocity, atMs);
      document.getElementById("earth-state-altitude").textContent = `${values.altitude.toFixed(1)} km`;
      document.getElementById("earth-state-speed").textContent = `${values.speed.toFixed(3)} km/s`;
      document.getElementById("earth-state-latitude").textContent = `${values.latitude.toFixed(3)} deg`;
      document.getElementById("earth-state-longitude").textContent = `${values.longitude.toFixed(3)} deg`;
      document.getElementById("earth-state-time").textContent = formatCatalogTimestamp(atMs);
      const object = positionEntries[index].object;
      const method = span.a !== span.b ? `interpolazione cubica Hermite tra campioni SGP4 (${formatCatalogTimestamp(span.a.timeMs)} -> ${formatCatalogTimestamp(span.b.timeMs)})` : `ultimo campione SGP4 al ${formatCatalogTimestamp(span.a.timeMs)}${trajectoryWorkerDisabled ? "; moto sospeso per worker non disponibile" : "; nessuna estrapolazione oltre il campione"}`;
      document.getElementById("earth-object-kinematics-status").textContent = `${method}; epoca elemento ${formatCatalogTimestamp(object.EPOCH)}.`;
    }

    function handleTrajectoryWorkerMessage(event) {
      const message = event.data || {};
      if (message.type === "error") {
        trajectoryWorkerBusy = false;
        trajectoryWorkerDisabled = true;
        document.getElementById("earth-orbit-status").textContent = `Propagazione browser SGP4 non disponibile: ${message.message}. Posizioni ferme all'ultimo campione, senza estrapolazioni.`;
        document.getElementById("earth-simulation-status").textContent = "Worker SGP4 non disponibile; non viene simulato un moto approssimato.";
        return;
      }
      if (message.generation !== trajectoryGeneration) return;
      trajectoryWorkerBusy = false;
      const incoming = (message.samples || []).map((sample) => ({ timeMs: sample.timeMs, positions: sample.positions, velocities: sample.velocities, propagated: sample.propagated }));
      if (message.type === "initialized") {
        trajectorySamples = incoming.sort((a, b) => a.timeMs - b.timeMs);
        trajectoryWorkerReady = true;
      } else if (message.type === "sample" && incoming.length) {
        trajectorySamples.push(...incoming);
        trajectorySamples.sort((a, b) => a.timeMs - b.timeMs);
        trajectorySamples = trajectorySamples.slice(-2);
      }
      updateOrbitalPoints(simulationTimeMs);
      if (selectedObjectId) updateSelectedKinematics(simulationTimeMs);
      const total = trajectorySamples.at(-1)?.propagated ?? 0;
      document.getElementById("earth-orbit-status").textContent = `Satellite.js SGP4 | ${total.toLocaleString("it-IT")} elementi propagati | Hermite tra campioni ogni ${trajectoryStepMs / 1000} s simulati.`;
    }

    function startTrajectoryWorker(payload) {
      trajectoryGeneration++;
      trajectoryWorkerBusy = true;
      trajectoryWorkerReady = false;
      trajectoryWorkerDisabled = false;
      const payloadDate = parseCatalogTimestamp(payload?.propagatedAt);
      const initialTime = simulationTimeMs;
      const seed = { timeMs: payloadDate?.getTime() || initialTime, positions: new Float64Array(positionEntries.length * 3), velocities: new Float64Array(positionEntries.length * 3), propagated: positionEntries.length };
      for (let index = 0; index < positionEntries.length; index++) {
        const offset = index * 3;
        seed.positions.set(positionEntries[index].positionKm || [Number.NaN, Number.NaN, Number.NaN], offset);
        seed.velocities.set(positionEntries[index].velocityKmPerSec || [Number.NaN, Number.NaN, Number.NaN], offset);
      }
      trajectorySamples = [seed];
      try {
        if (!trajectoryWorker) {
          trajectoryWorker = new Worker(new URL("./earth-orbit-sgp4-worker.js", document.baseURI));
          trajectoryWorker.addEventListener("message", handleTrajectoryWorkerMessage);
          trajectoryWorker.addEventListener("error", (error) => handleTrajectoryWorkerMessage({ data: { type: "error", message: error.message || "errore worker SGP4" } }));
        }
        trajectoryWorker.postMessage({ type: "initialize", generation: trajectoryGeneration, objects: positionEntries.map((entry) => entry.object), startTimeMs: initialTime, stepMs: trajectoryStepMs });
        document.getElementById("earth-orbit-status").textContent = "Inizializzazione del propagatore SGP4 nel worker; elementi OMM CelesTrak in uso.";
      } catch (error) {
        trajectoryWorkerBusy = false;
        trajectoryWorkerDisabled = true;
        document.getElementById("earth-orbit-status").textContent = `Worker SGP4 non disponibile (${error.message}); posizioni ferme all'ultimo campione.`;
      }
    }

    function requestTrajectorySample(atMs) {
      if (!trajectoryWorker || trajectoryWorkerDisabled || !trajectoryWorkerReady || trajectoryWorkerBusy || !trajectorySamples.length) return;
      const last = trajectorySamples[trajectorySamples.length - 1];
      if (atMs - last.timeMs < trajectoryStepMs) return;
      trajectoryWorkerBusy = true;
      trajectoryWorker.postMessage({ type: "sample", generation: trajectoryGeneration, timeMs: atMs });
    }

    function setSelected(object) {
      document.getElementById("earth-object-name").textContent = object.OBJECT_NAME || "Oggetto orbitale";
      document.getElementById("earth-object-catalog").textContent = object.NORAD_CAT_ID ?? object.OBJECT_ID ?? "n.d.";
      const inclination = Number(object.INCLINATION), meanMotion = Number(object.MEAN_MOTION);
      document.getElementById("earth-object-inclination").textContent = object.INCLINATION !== null && object.INCLINATION !== undefined && object.INCLINATION !== "" && Number.isFinite(inclination) ? `${inclination.toFixed(2)}?` : "n.d.";
      document.getElementById("earth-object-period").textContent = object.MEAN_MOTION !== null && object.MEAN_MOTION !== undefined && object.MEAN_MOTION !== "" && Number.isFinite(meanMotion) && meanMotion > 0 ? `${(1440 / meanMotion).toFixed(1)} min` : "n.d.";
      document.getElementById("earth-object-epoch").textContent = formatCatalogTimestamp(object.EPOCH);
      const objectId = Number(object.NORAD_CAT_ID ?? object.norad_cat_id);
      selectedObjectId = Number.isInteger(objectId) && objectId > 0 ? objectId : null;
      const index = currentObjects.findIndex((entry) => Number(entry.NORAD_CAT_ID ?? entry.norad_cat_id) === objectId);
      if (index >= 0) {
        const positions = satelliteGeometry.attributes.position.array;
        selectedMarker.position.fromArray(positions, index * 3);
        selectedMarker.visible = true;
      } else selectedMarker.visible = false;
      updateSelectedKinematics(simulationTimeMs);
      loadSelectedObjectDetails(object);
    }

    function resetSelectedDetails(message) {
      document.getElementById("earth-object-details-status").textContent = message;
      document.getElementById("earth-object-details-fields").replaceChildren();
      document.getElementById("earth-object-description").hidden = true;
      document.getElementById("earth-object-description").textContent = "";
      document.getElementById("earth-object-details-source").replaceChildren();
      const figure = document.getElementById("earth-object-image-figure");
      const image = document.getElementById("earth-object-image");
      image.hidden = true;
      image.removeAttribute("src");
      figure.hidden = false;
      document.getElementById("earth-object-image-caption").textContent = "Nessuna immagine disponibile nella fonte consultata.";
    }

    function addDetailRow(label, value) {
      if (value === null || value === undefined || value === "") return;
      const row = document.createElement("div");
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = label;
      description.textContent = String(value);
      row.append(term, description);
      document.getElementById("earth-object-details-fields").append(row);
    }

    function countryPresentation(value) {
      if (!value) return null;
      const aliases = { Russia: "RU", Russian: "RU", "United States": "US", USA: "US", China: "CN", Japan: "JP", India: "IN", France: "FR", Germany: "DE", Italy: "IT", Canada: "CA", "United Kingdom": "GB", Spain: "ES", Ukraine: "UA" };
      const countries = String(value).split(/[;,|]/).map((part) => part.trim()).filter(Boolean);
      const displayNames = new Intl.DisplayNames(["it"], { type: "region" });
      return countries.map((entry) => {
        const code = /^[A-Za-z]{2}$/.test(entry) ? entry.toUpperCase() : aliases[entry] || null;
        const name = code ? displayNames.of(code) : entry;
        const flag = code ? String.fromCodePoint(...[...code].map((letter) => 127397 + letter.charCodeAt(0))) : "";
        return { code, name, flag };
      });
    }

    function showObjectDialog(object, details) {
      if (!details || details.status === "unavailable") return;
      const hasDetails = [details.type, details.owner, details.countries, details.launchDate, details.objectStatus, details.description, details.image?.url].some(Boolean);
      if (!hasDetails) return;
      const dialog = document.getElementById("earth-object-dialog");
      const noradId = object.NORAD_CAT_ID ?? object.norad_cat_id ?? details.noradId;
      document.getElementById("earth-object-dialog-title").textContent = `${details.name || object.OBJECT_NAME || "Oggetto orbitale"} (NORAD ${noradId ?? "n.d."})`;
      const status = document.getElementById("earth-object-dialog-status");
      status.textContent = document.getElementById("earth-object-details-status").textContent;
      const content = document.getElementById("earth-object-dialog-content");
      content.replaceChildren();
      const orbitHeading = document.createElement("h4");
      orbitHeading.textContent = "Dati orbitali catalogati";
      content.append(orbitHeading, document.querySelector("#earth-object-panel > dl").cloneNode(true));
      const countries = countryPresentation(details.countries);
      const countryBox = document.getElementById("earth-object-dialog-country");
      countryBox.replaceChildren();
      if (countries?.length) {
        for (const country of countries) {
          const item = document.createElement("span");
          item.className = "earth-object-country-item";
          if (country.flag) {
            const flag = document.createElement("span");
            flag.className = "earth-object-flag";
            flag.setAttribute("role", "img");
            flag.setAttribute("aria-label", `Bandiera ${country.name}`);
            flag.textContent = country.flag;
            item.append(flag);
          }
          const name = document.createElement("strong");
          name.textContent = country.name;
          item.append(name);
          countryBox.append(item);
        }
        countryBox.hidden = false;
      } else countryBox.hidden = true;
      const metadataHeading = document.createElement("h4");
      metadataHeading.textContent = "Metadati e missione";
      content.append(metadataHeading, document.getElementById("earth-object-details-fields").cloneNode(true));
      const image = document.getElementById("earth-object-image-figure");
      if (!image.hidden) content.append(image.cloneNode(true));
      const description = document.getElementById("earth-object-description");
      if (!description.hidden) content.append(description.cloneNode(true));
      const sources = document.getElementById("earth-object-details-source");
      if (sources.childNodes.length) content.append(sources.cloneNode(true));
      if (!dialog.open) dialog.showModal();
    }

    async function loadSelectedObjectDetails(object) {
      selectedDetailsController?.abort();
      selectedDetailsController = null;
      const requestId = ++selectedDetailsRequest;
      const rawNoradId = object.NORAD_CAT_ID ?? object.norad_cat_id;
      const noradId = Number(rawNoradId);
      if (!Number.isInteger(noradId) || noradId < 1) {
        resetSelectedDetails("ID NORAD assente: dettagli esterni non richiedibili.");
        return;
      }

      resetSelectedDetails("Ricerca dei metadati nel catalogo SatNOGS…");
      const controller = new AbortController();
      selectedDetailsController = controller;
      try {
        const query = new URLSearchParams({ group: selectedGroup });
        const response = await fetch(`${API_ORIGIN}/api/earth/object/${noradId}?${query}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const details = await response.json();
        if (requestId !== selectedDetailsRequest) return;

        const cacheLabel = details.cache?.state === "stale"
          ? " · cache locale obsoleta"
          : details.cache?.state === "fresh" ? " · cache locale" : "";
        const statusText = details.status === "available"
          ? `Metadati disponibili${cacheLabel}.`
          : details.status === "partial"
            ? `Metadati parziali: alcuni campi non sono presenti nelle fonti consultate${cacheLabel}.`
            : `Dettagli non disponibili${cacheLabel}.`;
        document.getElementById("earth-object-details-status").textContent = details.message
          ? `${statusText} ${details.message}` : statusText;

        addDetailRow("SCHEDA SATNOGS", details.satnogsStatus === "present" ? "Presente nel catalogo SatNOGS" : details.satnogsStatus === "absent" ? "Nessuna scheda trovata nella fonte consultata" : "Presenza non verificabile: fonte non raggiungibile");
        addDetailRow("STATO IMMAGINE", details.photoStatus === "verified" || details.image?.verified === true ? "File immagine verificato tecnicamente" : details.image ? "Immagine associata ma non verificata (potrebbe essere un'icona)" : details.satnogsStatus === "present" ? "La scheda non contiene un'immagine" : details.satnogsStatus === "absent" ? "Nessuna immagine: scheda SatNOGS assente" : "Stato immagine non verificabile");
        addDetailRow("TIPO / CATEGORIA", details.type);
        addDetailRow("PROPRIETARIO / OPERATORE", details.owner);
        addDetailRow("PAESE / PAESI", details.countries);
        addDetailRow("DATA DI LANCIO", details.launchDate ? formatCatalogTimestamp(details.launchDate) : null);
        addDetailRow("STATO IN CATALOGO", details.objectStatus);
        if (details.website) {
          addDetailRow("SITO DELLA SCHEDA", details.website);
        }

        const description = document.getElementById("earth-object-description");
        if (details.description) {
          description.textContent = details.description;
          description.hidden = false;
        }

        const imageFigure = document.getElementById("earth-object-image-figure");
        const image = document.getElementById("earth-object-image");
        const caption = document.getElementById("earth-object-image-caption");
        if (details.image?.url && details.image.verified === true) {
          image.alt = details.name ? `Immagine catalogata di ${details.name}` : `Immagine catalogata dell'oggetto NORAD ${noradId}`;
          image.onload = () => { if (requestId === selectedDetailsRequest) image.hidden = false; };
          image.onerror = () => {
            if (requestId !== selectedDetailsRequest) return;
            image.hidden = true;
            image.removeAttribute("src");
            caption.textContent = "Immagine indicata dalla fonte non raggiungibile; nessuna immagine sostitutiva mostrata.";
          };
          image.src = details.image.url;
          caption.textContent = `${details.image.caption || "Immagine catalogata"} · ${details.image.source || "fonte non indicata"} · verifica tecnica del file, soggetto non classificato visivamente`;
          imageFigure.hidden = false;
        } else if (details.image?.url) {
          caption.textContent = "Immagine presente nella scheda ma non verificata come asset reale; non viene mostrata.";
          imageFigure.hidden = false;
        }

        const sourceContainer = document.getElementById("earth-object-details-source");
        for (const source of details.sources || []) {
          if (!source?.name || !source?.url || !source.url.startsWith("https://")) continue;
          if (sourceContainer.childNodes.length) sourceContainer.append(document.createTextNode(" · "));
          const link = document.createElement("a");
          link.href = source.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = source.name;
          sourceContainer.append(link);
        }
        showObjectDialog(object, details);
      } catch (error) {
        if (error.name === "AbortError" || requestId !== selectedDetailsRequest) return;
        resetSelectedDetails("Dettagli non disponibili: la fonte esterna non ha risposto. I dati orbitali del catalogo restano visibili.");
      } finally {
        if (selectedDetailsController === controller) selectedDetailsController = null;
      }
    }

    function parseCatalogTimestamp(value) {
      if (value === null || value === undefined || value === "") return null;
      let milliseconds;
      if (typeof value === "number" && Number.isFinite(value)) {
        milliseconds = Math.abs(value) < 1e12 ? value * 1000 : value;
      } else if (typeof value === "string") {
        const normalized = value.trim();
        if (!normalized) return null;
        if (/^-?\d+(?:\.\d+)?$/.test(normalized)) {
          const numeric = Number(normalized);
          if (!Number.isFinite(numeric)) return null;
          milliseconds = Math.abs(numeric) < 1e12 ? numeric * 1000 : numeric;
        } else {
          milliseconds = Date.parse(normalized);
        }
      } else {
        return null;
      }
      if (!Number.isFinite(milliseconds)) return null;
      const date = new Date(milliseconds);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    function formatCatalogTimestamp(value, style = "full") {
      const date = parseCatalogTimestamp(value);
      if (!date) return "data non disponibile";
      return date.toLocaleString("it-IT", style === "time" ? { timeStyle: "medium" } : undefined);
    }

    function renderPositions(payload) {
      if (!positionEntries.length) return;
      startTrajectoryWorker(payload);
      updateOrbitalPoints(simulationTimeMs);
      const cacheInfo = payload.stale ? "elementi da cache CelesTrak obsoleta" : "elementi CelesTrak in cache";
      document.getElementById("earth-orbit-status").textContent = `Avvio campionamento SGP4 | ${cacheInfo} | epoca elementi ${formatCatalogTimestamp(payload.updatedAt)}.`;
    }

    function updateOrbitalPoints(atMs) {
      if (!positionEntries.length) return;
      updateInterpolatedTrajectory(atMs);
      const positions = satelliteGeometry.attributes.position.array;
      const propagatedObjects = [];
      let valid = 0;
      for (let index = 0; index < positionEntries.length; index++) {
        const offset = index * 3;
        const px = interpolatedPositions[offset], py = interpolatedPositions[offset + 1], pz = interpolatedPositions[offset + 2];
        if (![px, py, pz].every(Number.isFinite)) continue;
        const scale = 10 / 6378.137;
        positions[valid * 3] = px * scale;
        positions[valid * 3 + 1] = pz * scale;
        positions[valid * 3 + 2] = -py * scale;
        propagatedObjects.push(positionEntries[index].object);
        valid++;
      }
      satelliteGeometry.setDrawRange(0, valid);
      satelliteGeometry.attributes.position.needsUpdate = true;
      if (atMs - lastBoundsUpdateMs >= 5000 || !satelliteGeometry.boundingSphere) {
        satelliteGeometry.computeBoundingSphere();
        lastBoundsUpdateMs = atMs;
      }
      currentObjects = propagatedObjects;
      const selectedIndex = currentObjects.findIndex((object) => Number(object.NORAD_CAT_ID ?? object.norad_cat_id) === Number(selectedObjectId));
      if (selectedIndex >= 0) {
        selectedMarker.position.fromArray(positions, selectedIndex * 3);
        selectedMarker.visible = true;
      } else if (selectedObjectId) selectedMarker.visible = false;
    }

    function cacheKey(group) {
      return `${group}:limit=${orbitalLimit}`;
    }

    function clearPositionData() {
      positionEntries = [];
      currentObjects = [];
      trajectoryGeneration++;
      trajectorySamples = [];
      trajectoryWorkerReady = false;
      trajectoryWorkerBusy = false;
      interpolatedPositions = new Float64Array(0);
      interpolatedVelocities = new Float64Array(0);
      selectedMarker.visible = false;
      satelliteGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
      satelliteGeometry.setDrawRange(0, 0);
    }

    function applyPositionPayload(payload, cacheAgeMs = null) {
      const records = payload.positions.map((entry) => ({ object: entry.object, positionKm: entry.positionKm, velocityKmPerSec: entry.velocityKmPerSec }));
      positionEntries = records;
      interpolatedPositions = new Float64Array(records.length * 3);
      interpolatedVelocities = new Float64Array(records.length * 3);
      satelliteGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(records.length * 3), 3));
      satelliteGeometry.setDrawRange(0, records.length);
      satellitePoints.material.color.set(selectedGroup === "debris" ? 0xff9b70 : selectedGroup === "stations" ? 0xb8f93a : 0x82d8ff);
      section.dataset.updatedAt = payload.updatedAt || "";
      const updatedAt = formatCatalogTimestamp(payload.updatedAt);
      const source = payload.fallback
        ? "Snapshot locale · fallback"
        : payload.stale
          ? "Cache CelesTrak obsoleta"
          : payload.source || "Catalogo CelesTrak";
      const cacheLabel = cacheAgeMs === null ? "" : ` · cache in sessione, ${Math.max(1, Math.floor(cacheAgeMs / 1000))} s fa`;
      document.getElementById("earthCatalogStatus").textContent = `${source}${cacheLabel} · elementi del ${updatedAt}`;
      document.getElementById("earth-object-count").textContent = `${records.length.toLocaleString("it-IT")} oggetti propagati · ${selectedGroup}`;
      document.getElementById("earth-orbit-retry").hidden = false;
      document.getElementById("earth-object-note").textContent = payload.fallback
        ? "Snapshot locale: dati storici di ripiego, non aggiornati in tempo reale."
        : payload.stale
          ? "Cache CelesTrak obsoleta: sono mostrati gli ultimi elementi disponibili, non telemetria live."
          : cacheAgeMs !== null
            ? "Cache temporanea della sessione: posizioni e catalogo non sono telemetria in tempo reale."
            : `Elementi CelesTrak ${formatCatalogTimestamp(payload.updatedAt)}; propagazione SGP4 nel worker e raccordo Hermite.`;
      renderPositions(payload);
      if (cacheAgeMs !== null) {
        document.getElementById("earth-orbit-status").textContent += " · riuso cache; nessuna nuova richiesta.";
      }
    }

    function abortActiveGroupRequest() {
      if (!activeGroupRequest) return;
      const request = activeGroupRequest;
      activeGroupRequest = null;
      groupRequest++;
      request.controller.abort();
    }

    async function loadGroup(group, { force = false } = {}) {
      if (isolated || disposed) return;
      // Ignore repeated clicks while this group's request is already in flight.
      if (activeGroupRequest?.group === group) return;
      if (activeGroupRequest) abortActiveGroupRequest();
      const requestId = ++groupRequest;
      selectedGroup = group;
      document.getElementById("earth-orbit-retry").hidden = true;
      document.querySelectorAll("[data-orbit-group]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.orbitGroup === group)));

      const key = cacheKey(group);
      const cached = positionCache.get(key);
      const cacheAgeMs = cached ? Date.now() - cached.cachedAt : null;
      if (!force && cached && cacheAgeMs < positionCacheTtlMs) {
        applyPositionPayload(cached.payload, cacheAgeMs);
        return;
      }
      if (cached) applyPositionPayload(cached.payload, cacheAgeMs);
      else clearPositionData();

      if (!force && (retryAfter.get(key) || 0) > Date.now()) {
        document.getElementById("earthCatalogStatus").textContent = cached
          ? "Cache di sessione scaduta · aggiornamento temporaneamente non disponibile"
          : "Backend orbitale non disponibile · attesa prima del nuovo tentativo";
        document.getElementById("earth-orbit-status").textContent = cached
          ? "Mostro i dati memorizzati; usa Aggiorna / riprova per un nuovo tentativo."
          : "Nessun dato orbitale in cache. Usa Aggiorna / riprova per forzare un tentativo.";
        document.getElementById("earth-orbit-retry").hidden = false;
        return;
      }

      document.getElementById("earth-orbit-status").textContent = cached
        ? "Mostro la cache di sessione mentre verifico gli elementi aggiornati…"
        : "Caricamento degli elementi orbitali…";
      const controller = new AbortController();
      activeGroupRequest = { group, controller, requestId };
      let timeout = null;
      let timedOut = false;
      try {
        timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 32000);
        const response = await fetch(`${API_ORIGIN}/api/orbital-positions?group=${encodeURIComponent(group)}&limit=${orbitalLimit}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (requestId !== groupRequest || disposed) return;
        if (!Array.isArray(payload.positions) || !payload.positions.length) {
          throw new Error("Il backend non ha restituito posizioni SGP4 valide.");
        }
        positionCache.set(key, { payload, cachedAt: Date.now() });
        retryAfter.delete(key);
        applyPositionPayload(payload);
      } catch (error) {
        if (requestId !== groupRequest || disposed) return;
        const errorMessage = timedOut ? "timeout del backend dopo 32 secondi" : error.message || "rete non disponibile";
        retryAfter.set(key, Date.now() + positionRetryDelayMs);
        if (cached) {
          applyPositionPayload(cached.payload, cacheAgeMs);
          document.getElementById("earthCatalogStatus").textContent = "Aggiornamento non disponibile · mostro la cache di sessione";
          document.getElementById("earth-orbit-status").textContent = `Dati memorizzati non aggiornati; richiesta fallita (${errorMessage}).`;
        } else {
          clearPositionData();
          document.getElementById("earthCatalogStatus").textContent = "Backend Python: SGP4 non disponibile";
          document.getElementById("earth-orbit-status").textContent = errorMessage.includes("HTTP")
            ? `Il server orbitale ha risposto ${errorMessage}. Nessuna posizione approssimata viene mostrata.`
            : `Backend orbitale non disponibile (${errorMessage}). Nessuna posizione approssimata viene mostrata.`;
          document.getElementById("earth-object-count").textContent = "Catalogo orbitale non disponibile";
        }
        console.warn("Atlante orbitale terrestre:", errorMessage);
        document.getElementById("earth-orbit-retry").hidden = false;
      } finally {
        window.clearTimeout(timeout);
        if (activeGroupRequest?.requestId === requestId) activeGroupRequest = null;
      }
    }

    function renderEarthSearchResults(data) {
      const results = document.getElementById("earth-object-search-results");
      results.replaceChildren();
      for (const item of data.items || []) {
        const card = document.createElement("article");
        card.className = "earth-object-search-card";
        const select = document.createElement("button");
        select.type = "button";
        select.className = "earth-object-search-select";
        select.setAttribute("aria-label", `Seleziona ${item.name}, NORAD ${item.noradId}`);
        const title = document.createElement("strong");
        title.textContent = item.name || `NORAD ${item.noradId}`;
        const catalog = document.createElement("span");
        catalog.textContent = `NORAD ${item.noradId} · ${item.group}`;
        const badges = document.createElement("span");
        badges.className = "earth-object-search-badges";
        const dataBadge = document.createElement("span");
        dataBadge.className = `earth-object-search-badge ${item.hasData ? "is-data" : "is-partial"}`;
        dataBadge.textContent = item.satnogsRecord
          ? item.hasData ? "METADATI SATNOGS" : "SCHEDA SATNOGS · CAMPI LIMITATI"
          : item.hasData ? "DATI SOLO CATALOGO LOCALE" : "NESSUN METADATO DESCRITTIVO";
        const cardBadge = document.createElement("span");
        cardBadge.className = `earth-object-search-badge ${item.satnogsStatus === "present" ? "is-data" : "is-no-photo"}`;
        cardBadge.textContent = item.satnogsStatus === "present" ? "SCHEDA SATNOGS" : item.satnogsStatus === "absent" ? "NON NELL'INDICE PUBBLICO SATNOGS" : item.satnogsStatus === "stale-absent" ? "ASSENTE NELL'INDICE SATNOGS OBSOLETO" : "SCHEDA NON VERIFICABILE";
        const imageBadge = document.createElement("span");
        imageBadge.className = `earth-object-search-badge ${item.imageVerified ? "is-photo" : "is-no-photo"}`;
        imageBadge.textContent = item.photoStatus === "verified" ? "IMMAGINE VERIFICATA" : item.photoStatus === "none" && item.satnogsStatus === "present" ? "NESSUNA IMMAGINE NELLA SCHEDA" : item.photoStatus === "none" && item.satnogsStatus === "absent" ? "SENZA SCHEDA NÉ IMMAGINE" : item.photoStatus === "unverified" ? "IMMAGINE NON VERIFICATA / POSSIBILE ICONA" : "IMMAGINE NON VERIFICABILE";
        badges.append(dataBadge, cardBadge, imageBadge);
        const meta = document.createElement("span");
        meta.className = "earth-object-search-meta";
        meta.textContent = [item.type, item.owner, item.countries, item.launchDate].filter(Boolean).join(" · ") || "Nessun altro campo documentato";
        select.append(title, catalog, badges, meta);
        select.addEventListener("click", () => selectEarthSearchResult(item));
        card.append(select);
        if (item.imageVerified && item.image?.url) {
          const thumbnail = document.createElement("img");
          thumbnail.className = "earth-object-search-thumbnail";
          thumbnail.src = item.image.url;
          thumbnail.alt = `Immagine catalogata per ${item.name}`;
          thumbnail.loading = "lazy";
          thumbnail.onerror = () => {
            thumbnail.remove();
            imageBadge.textContent = "IMMAGINE NON RAGGIUNGIBILE";
            imageBadge.className = "earth-object-search-badge is-no-photo";
          };
          card.append(thumbnail);
        }
        if (item.satnogsUrl) {
          const external = document.createElement("a");
          external.href = item.satnogsUrl;
          external.target = "_blank";
          external.rel = "noopener noreferrer";
          external.className = "earth-object-search-external";
          external.textContent = "Scheda SatNOGS ↗";
          card.append(external);
        }
        results.append(card);
      }
      const matching = (data.items || []).length;
      const coverage = `Fonte: ${data.source}; indice SatNOGS ${data.indexState || "n.d."}${data.indexAgeSeconds != null ? ` (${Math.floor(data.indexAgeSeconds / 60)} min)` : ""}; copertura parziale. Esaminati ${data.scanned} candidati su ${data.totalCandidates}${data.sourceErrors ? `; ${data.sourceErrors} verifiche fonte non riuscite` : ""}.`;
      const empty = matching ? `${matching} risultati.` : data.indexComplete === false
        ? `Indice SatNOGS non disponibile${data.sourceWarning ? `: ${data.sourceWarning}` : ""}; non posso confermare schede o assenze. Riprova più tardi.`
        : document.getElementById("earth-object-search-verified").checked
          ? "Nessuna immagine verificata in questa pagina. Continua la ricerca o disattiva il filtro immagini."
          : "Nessun oggetto trovato con questo nome, NORAD ID o designatore. Prova un'altra query o gruppo.";
      document.getElementById("earth-object-search-status").textContent = `${empty} ${coverage} ${data.cache}`;
      earthSearchNextOffset = data.hasMore && data.nextOffset > data.offset ? data.nextOffset : null;
      document.getElementById("earth-object-search-next").disabled = earthSearchNextOffset === null;
      document.getElementById("earth-object-search-previous").disabled = earthSearchOffsets.length <= 1;
    }

    async function runEarthObjectSearch(offset = 0, resetPages = false) {
      earthSearchController?.abort();
      const requestId = ++earthSearchRequest;
      const controller = new AbortController();
      earthSearchController = controller;
      const button = document.getElementById("earth-object-search-submit");
      button.disabled = true;
      if (resetPages) {
        earthSearchOffsets = [0];
        earthSearchNextOffset = null;
        document.getElementById("earth-object-search-next").disabled = true;
        document.getElementById("earth-object-search-previous").disabled = true;
      }
      document.getElementById("earth-object-search-status").textContent = "Ricerca nel catalogo locale e verifica dei metadati/immagini…";
      document.getElementById("earth-object-search-results").replaceChildren();
      try {
        const params = new URLSearchParams({
          q: document.getElementById("earth-object-search-query").value.trim(),
          verified_image_only: String(document.getElementById("earth-object-search-verified").checked),
          limit: "12",
          offset: String(offset),
        });
        const group = document.getElementById("earth-object-search-group").value;
        if (group !== "all") params.set("group", group);
        const response = await fetch(`${API_ORIGIN}/api/earth/objects/search?${params}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (requestId !== earthSearchRequest) return;
        if (!Array.isArray(data.items)) throw new Error(data.detail || "La risposta API non contiene una lista items valida");
        if (resetPages) earthSearchOffsets = [0];
        renderEarthSearchResults(data);
      } catch (error) {
        if (error.name === "AbortError" || requestId !== earthSearchRequest) return;
        document.getElementById("earth-object-search-status").textContent = `Ricerca non disponibile: ${error.message}. Il catalogo orbitale principale resta utilizzabile.`;
      } finally {
        if (requestId === earthSearchRequest) {
          button.disabled = false;
          earthSearchController = null;
        }
      }
    }

    async function selectEarthSearchResult(item) {
      if (["stations", "visual", "active", "debris"].includes(item.group) && item.group !== selectedGroup) await loadGroup(item.group);
      const index = currentObjects.findIndex((object) => Number(object.NORAD_CAT_ID ?? object.norad_cat_id) === Number(item.noradId));
      const object = index >= 0 ? currentObjects[index] : item.orbitalRecord || { NORAD_CAT_ID: item.noradId, OBJECT_NAME: item.name };
      setSelected(object);
      if (index < 0) {
        document.getElementById("earth-object-note").textContent = "Oggetto trovato nel catalogo locale; non presente nelle posizioni SGP4 correnti, quindi non è evidenziabile sul globo.";
      } else {
        document.getElementById("earth-object-note").textContent = "Oggetto selezionato dall'indice; il marcatore verde evidenzia la posizione propagata SGP4 corrente.";
      }
      document.getElementById("earth-object-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    document.getElementById("earth-object-search-form").addEventListener("submit", (event) => {
      event.preventDefault();
      runEarthObjectSearch(0, true);
    });
    const objectSearchInput = document.getElementById("earth-object-search-query");
    objectSearchInput.addEventListener("focus", () => runEarthObjectSearch(0, true));
    let objectSearchDebounce = 0;
    objectSearchInput.addEventListener("input", () => {
      window.clearTimeout(objectSearchDebounce);
      objectSearchDebounce = window.setTimeout(() => runEarthObjectSearch(0, true), 220);
    });
    document.getElementById("earth-object-search-group").addEventListener("change", () => runEarthObjectSearch(0, true));
    document.getElementById("earth-object-search-verified").addEventListener("change", () => runEarthObjectSearch(0, true));
    document.getElementById("earth-object-dialog-close").addEventListener("click", () => document.getElementById("earth-object-dialog").close());
    document.getElementById("earth-object-dialog").addEventListener("click", (event) => {
      if (event.target === event.currentTarget) event.currentTarget.close();
    });
    const simulationToggle = document.getElementById("earth-simulation-toggle");
    const simulationSpeed = document.getElementById("earth-simulation-speed");
    simulationToggle.addEventListener("click", () => {
      simulationPaused = !simulationPaused;
      simulationToggle.textContent = simulationPaused ? "RIPRENDI" : "PAUSA";
      simulationToggle.setAttribute("aria-pressed", String(simulationPaused));
      document.getElementById("earth-simulation-status").textContent = simulationPaused
        ? "Tempo simulato in pausa. Nessuna richiesta di aggiornamento SGP4 viene eseguita."
        : `Tempo simulato a ${simulationRate}x; satellite.js ricalcola SGP4 nel worker e interpola con Hermite tra campioni.`;
    });
    simulationSpeed.addEventListener("change", () => {
      simulationRate = Math.max(1, Number(simulationSpeed.value) || 1);
      document.getElementById("earth-simulation-status").textContent = simulationPaused
        ? `Tempo simulato in pausa · velocità impostata ${simulationRate}×.`
        : `Tempo simulato a ${simulationRate}x; satellite.js ricalcola SGP4 nel worker e interpola con Hermite tra campioni.`;
    });
    document.getElementById("earth-object-search-previous").addEventListener("click", () => {
      if (earthSearchOffsets.length <= 1) return;
      earthSearchOffsets.pop();
      runEarthObjectSearch(earthSearchOffsets[earthSearchOffsets.length - 1]);
    });
    document.getElementById("earth-object-search-next").addEventListener("click", () => {
      if (earthSearchNextOffset === null) return;
      earthSearchOffsets.push(earthSearchNextOffset);
      runEarthObjectSearch(earthSearchNextOffset);
    });
    document.querySelectorAll("[data-orbit-group]").forEach((button) => button.addEventListener("click", () => loadGroup(button.dataset.orbitGroup)));
    if (!isolated) document.getElementById("earth-orbit-retry").addEventListener("click", () => loadGroup(selectedGroup, { force: true }));
    renderer.domElement.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "touch") {
        event.preventDefault();
        orbitTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        renderer.domElement.setPointerCapture(event.pointerId);
        if (orbitTouches.size >= 2) {
          const [a, b] = [...orbitTouches.values()];
          pinchStart = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: camera.position.z };
          dragging = false;
        } else { dragging = true; dragged = false; lastPointer = { x: event.clientX, y: event.clientY }; }
        return;
      }
      dragging = true;
      dragged = false;
      lastPointer = { x: event.clientX, y: event.clientY };
      renderer.domElement.setPointerCapture(event.pointerId);
    });
    renderer.domElement.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch" && orbitTouches.has(event.pointerId)) {
        event.preventDefault();
        orbitTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (orbitTouches.size >= 2 && pinchStart) {
          const [a, b] = [...orbitTouches.values()];
          const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
          camera.position.z = THREE.MathUtils.clamp(pinchStart.zoom * pinchStart.distance / distance, minZoom, Math.max(minZoom, 420));
          dragged = true;
        } else if (dragging && lastPointer) {
          world.rotation.y += (event.clientX - lastPointer.x) * 0.006;
          world.rotation.x = THREE.MathUtils.clamp(world.rotation.x + (event.clientY - lastPointer.y) * 0.006, -1.1, 1.1);
          lastPointer = { x: event.clientX, y: event.clientY };
        }
        return;
      }
      if (!dragging || !lastPointer) return;
      if (Math.hypot(event.clientX - lastPointer.x, event.clientY - lastPointer.y) > 3) dragged = true;
      world.rotation.y += (event.clientX - lastPointer.x) * 0.006;
      world.rotation.x = THREE.MathUtils.clamp(world.rotation.x + (event.clientY - lastPointer.y) * 0.006, -1.1, 1.1);
      lastPointer = { x: event.clientX, y: event.clientY };
    });
    const stopDrag = (event) => {
      if (event.pointerType === "touch") {
        orbitTouches.delete(event.pointerId);
        if (orbitTouches.size < 2) pinchStart = null;
        if (orbitTouches.size === 1) { const [, point] = [...orbitTouches.entries()][0]; dragging = true; lastPointer = { x: point.x, y: point.y }; }
        else if (!orbitTouches.size) { dragging = false; lastPointer = null; }
        return;
      }
      dragging = false; lastPointer = null;
    };
    renderer.domElement.addEventListener("pointerup", stopDrag);
    renderer.domElement.addEventListener("pointercancel", stopDrag);
    renderer.domElement.addEventListener("wheel", (event) => {
      event.preventDefault();
      camera.position.z = THREE.MathUtils.clamp(camera.position.z * Math.exp(event.deltaY * 0.001), minZoom, Math.max(minZoom, 420));
    }, { passive: false });
    renderer.domElement.addEventListener("click", (event) => {
      if (isolated || dragging || dragged) { dragged = false; return; }
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(satellitePoints)[0];
      if (hit && currentObjects[hit.index]) setSelected(currentObjects[hit.index]);
    });

    function render(time) {
      frame = requestAnimationFrame(render);
      if (lastFrameTime !== null && !simulationPaused) simulationTimeMs += Math.max(0, time - lastFrameTime) * simulationRate;
      lastFrameTime = time;
      if (!orbitVisible) return;
      updateOrbitalPoints(simulationTimeMs);
      if (!simulationPaused) requestTrajectorySample(simulationTimeMs);
      if (time - lastKinematicsUiUpdate > 250) {
        document.getElementById("earth-simulation-clock").textContent = `${new Date(simulationTimeMs).toISOString().replace("T", " ").replace(".000Z", " UTC")}`;
        if (selectedObjectId) updateSelectedKinematics(simulationTimeMs);
        lastKinematicsUiUpdate = time;
      }
      if (!isolated) {
        const now = new Date(simulationTimeMs);
        // Keep axial tilt on the parent and apply daily spin around the mesh's
        // own local north/south axis. Combining both rotations on the parent
        // changes the Euler basis and makes the texture orientation drift.
        earth.rotation.y = ((now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()) / 86164.0905) * Math.PI * 2;
      }
      renderer.render(scene, camera);
    }

    const visibility = new IntersectionObserver((entries) => {
      orbitVisible = entries[0].isIntersecting;
      if (!isolated && !orbitVisible) abortActiveGroupRequest();
      if (!isolated && orbitVisible && !positionEntries.length) loadGroup(selectedGroup);
    }, { threshold: 0.15 });
    visibility.observe(section);
    frame = requestAnimationFrame(render);
    window.addEventListener("pagehide", () => {
      disposed = true;
      selectedDetailsController?.abort();
      selectedDetailsController = null;
      earthSearchController?.abort();
      earthSearchController = null;
      window.clearTimeout(earthYearDebounce);
      textureRequest++;
      earthTextureController?.abort();
      earthTextureController = null;
      abortActiveGroupRequest();
      cancelAnimationFrame(frame);
      trajectoryWorker?.terminate();
      trajectoryWorker = null;
      visibility.disconnect();
      resizeObserver.disconnect();
      renderer.dispose();
      detailedEarthTexture?.dispose();
      localBasemapTexture?.dispose();
      earth.geometry.dispose();
      earth.material.dispose();
      satelliteGeometry.dispose();
      satellitePoints.material.dispose();
      selectedMarker.geometry.dispose();
      selectedMarker.material.dispose();
    }, { once: true });
  };
})();
