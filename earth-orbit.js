(() => {
  const EARTH_ORBIT_BUILD = "earth-orbit-scene-2026.11.27-e";
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
        const response = await fetch(`http://127.0.0.1:8000/api/earth/texture/${year}?${query}`, { cache: "no-cache", signal: controller.signal });
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
    let selectedGroup = "active";
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

    function setSelected(object) {
      document.getElementById("earth-object-name").textContent = object.OBJECT_NAME || "Oggetto orbitale";
      document.getElementById("earth-object-catalog").textContent = object.NORAD_CAT_ID ?? object.OBJECT_ID ?? "n.d.";
      document.getElementById("earth-object-inclination").textContent = Number.isFinite(Number(object.INCLINATION)) ? `${Number(object.INCLINATION).toFixed(2)}°` : "n.d.";
      document.getElementById("earth-object-period").textContent = Number.isFinite(Number(object.MEAN_MOTION)) ? `${(1440 / Number(object.MEAN_MOTION)).toFixed(1)} min` : "n.d.";
      document.getElementById("earth-object-epoch").textContent = formatCatalogTimestamp(object.EPOCH);
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
      const positions = satelliteGeometry.attributes.position.array;
      const propagatedObjects = [];
      let valid = 0;
      for (const entry of positionEntries) {
        const [px, py, pz] = entry.positionKm || [];
        if (![px, py, pz].every(Number.isFinite)) continue;
        const distance = Math.hypot(px, py, pz);
        const scale = 10 / 6378.137;
        positions[valid * 3] = px * scale;
        positions[valid * 3 + 1] = pz * scale;
        positions[valid * 3 + 2] = -py * scale;
        propagatedObjects.push(entry.object);
        valid++;
      }
      satelliteGeometry.setDrawRange(0, valid);
      satelliteGeometry.attributes.position.needsUpdate = true;
      satelliteGeometry.computeBoundingSphere();
      currentObjects = propagatedObjects;
      document.getElementById("earth-orbit-status").textContent = `Posizioni ${payload.propagator || "SGP4"} al ${formatCatalogTimestamp(payload.propagatedAt, "time")} · elementi del catalogo: ${formatCatalogTimestamp(payload.updatedAt)}`;
    }

    function cacheKey(group) {
      return `${group}:limit=${orbitalLimit}`;
    }

    function clearPositionData() {
      positionEntries = [];
      currentObjects = [];
      satelliteGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
      satelliteGeometry.setDrawRange(0, 0);
    }

    function applyPositionPayload(payload, cacheAgeMs = null) {
      const records = payload.positions.map((entry) => ({ object: entry.object, positionKm: entry.positionKm }));
      positionEntries = records;
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
            : `Posizioni propagate con ${payload.propagator || "SGP4"}; gli elementi CelesTrak sono aggiornati al timestamp indicato.`;
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
        const response = await fetch(`http://127.0.0.1:8000/api/orbital-positions?group=${encodeURIComponent(group)}&limit=${orbitalLimit}`, {
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
      if (!orbitVisible) return;
      if (!isolated) {
        const now = new Date();
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
      window.clearTimeout(earthYearDebounce);
      textureRequest++;
      earthTextureController?.abort();
      earthTextureController = null;
      abortActiveGroupRequest();
      cancelAnimationFrame(frame);
      visibility.disconnect();
      resizeObserver.disconnect();
      renderer.dispose();
      detailedEarthTexture?.dispose();
      localBasemapTexture?.dispose();
      earth.geometry.dispose();
      earth.material.dispose();
      satelliteGeometry.dispose();
      satellitePoints.material.dispose();
    }, { once: true });
  };
})();
