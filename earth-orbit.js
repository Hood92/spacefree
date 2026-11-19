(() => {
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
    scene.add(world);
    const earthRadius = 10;
    const earthGeometry = new THREE.SphereGeometry(earthRadius, 128, 96);
    // Keep the geographic orientation without shifting the raster inside the UV domain.
    earthGeometry.rotateY(Math.PI);

    const earth = new THREE.Mesh(
      earthGeometry,
      new THREE.MeshBasicMaterial({ color: 0x123c5d })
    );
    earth.rotation.z = THREE.MathUtils.degToRad(23.4);
    world.add(earth);
    let detailedEarthTexture = null;
    const yearSlider = document.getElementById("earthYearSlider");
    const yearValue = document.getElementById("earthYearValue");
    const textureLoader = new THREE.TextureLoader();
    function setEarthTexture(texture) {
      detailedEarthTexture?.dispose();
      detailedEarthTexture = texture;
      if (texture) {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = true;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.offset.set(0, 0);
        texture.repeat.set(1, 1);
        texture.needsUpdate = true;
      }
      earth.material.map = texture;
      earth.material.color.set(texture ? 0xffffff : 0x123c5d);
      earth.material.needsUpdate = true;
    }
    let textureRequest = 0;
    async function loadEarthYear(year) {
      const requestId = ++textureRequest;
      yearValue.value = String(year);
      yearStatus.textContent = `Caricamento immagine ${providerName} per ${year}…`;
      try {
        const query = new URLSearchParams({ provider, fill_gaps: String(options.get("earthRaw") !== "1") });
        const response = await fetch(`http://127.0.0.1:8000/api/earth/texture/${year}?${query}`, { cache: "no-cache" });
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
        setEarthTexture(texture);
        const source = response.headers.get("X-Texture-Source") || "Fonte non dichiarata";
        const date = response.headers.get("X-Image-Date");
        const period = response.headers.get("X-Image-Period");
        const background = response.headers.get("X-Texture-Background");
        const coverage = response.headers.get("X-Image-Coverage");
        const reason = response.headers.get("X-Fallback-Reason");
        let description = source;
        if (fallback) {
          description = `Fallback locale · ${source}. Immagine storica ${providerName} non disponibile. ${reason || ""}`.trim();
        } else {
          if (date) description += ` · ${date}`;
          if (period) description += ` · periodo richiesto ${period}`;
          if (status === "partial" && coverage) {
            const percentage = Number(coverage).toLocaleString("it-IT", { maximumFractionDigits: 2 });
            description += ` · immagine parziale · copertura ${percentage}%`;
          } else if (status === "coverage-unknown") {
            description += " · copertura non verificabile";
          }
          if (background) description += ` · sfondo statico ${background} nelle lacune`;
        }
        yearStatus.textContent = description;
      } catch (error) {
        if (requestId !== textureRequest) return;
        setEarthTexture(null);
        yearStatus.textContent = `Immagine ${providerName} non disponibile per ${year}.${error.message ? ` ${error.message}` : ""}`;
      }
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
      yearSlider.addEventListener("input", () => loadEarthYear(Number(yearSlider.value)));
      loadEarthYear(Number(yearSlider.value));
    }
    const satelliteGeometry = new THREE.BufferGeometry();
    satelliteGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    const satellitePoints = new THREE.Points(
      satelliteGeometry,
      new THREE.PointsMaterial({ color: 0xb8f93a, size: 3, sizeAttenuation: false, transparent: true, opacity: 0.9 })
    );
    if (!isolated) world.add(satellitePoints);

    let positionEntries = [];
    let currentObjects = [];
    let selectedGroup = "active";
    let orbitVisible = false;
    let lastPropagation = 0;
    let groupRequest = 0;
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
      document.getElementById("earth-object-epoch").textContent = object.EPOCH ? new Date(object.EPOCH).toLocaleString("it-IT") : "n.d.";
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
      document.getElementById("earth-orbit-status").textContent = `Posizioni ${payload.propagator} al ${new Date(payload.propagatedAt).toLocaleTimeString("it-IT")} · elementi del catalogo: ${new Date(section.dataset.updatedAt).toLocaleString("it-IT")}`;
    }

    async function loadGroup(group) {
      const requestId = ++groupRequest;
      let loadingStage = "backend Python SGP4";
      selectedGroup = group;
      document.getElementById("earth-orbit-retry").hidden = true;
      document.querySelectorAll("[data-orbit-group]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.orbitGroup === group)));
      document.getElementById("earth-orbit-status").textContent = "Caricamento degli elementi orbitali…";
      try {
        loadingStage = "backend Python SGP4";
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 32000);
        let response;
        try {
          response = await fetch(`http://127.0.0.1:8000/api/orbital-positions?group=${encodeURIComponent(group)}&limit=12000`, { signal: controller.signal, headers: { Accept: "application/json" } });
        } finally { window.clearTimeout(timeout); }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (requestId !== groupRequest) return;
        if (!Array.isArray(payload.positions) || !payload.positions.length) throw new Error("Il backend non ha restituito posizioni SGP4 valide.");
        const catalogStatus = document.getElementById("earthCatalogStatus");
        catalogStatus.textContent = `${payload.fallback ? "Snapshot locale" : payload.stale ? "Cache CelesTrak" : "CelesTrak"} · elementi del ${new Date(payload.updatedAt).toLocaleString("it-IT")}`;
        document.getElementById("earth-orbit-retry").hidden = true;
        const records = payload.positions.map((entry) => ({ object: entry.object, positionKm: entry.positionKm }));
        if (!records.length) throw new Error("Gli elementi ricevuti non sono compatibili con il parser OMM/SGP4.");
        positionEntries = records;
        satelliteGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(records.length * 3), 3));
        satelliteGeometry.setDrawRange(0, records.length);
        satellitePoints.material.color.set(group === "debris" ? 0xff9b70 : group === "stations" ? 0xb8f93a : 0x82d8ff);
        section.dataset.updatedAt = payload.updatedAt;
        document.getElementById("earth-object-count").textContent = `${records.length.toLocaleString("it-IT")} oggetti propagati · ${group}`;
        document.getElementById("earth-object-note").textContent = payload.fallback
          ? "Connessione non disponibile: snapshot locale di stazioni spaziali, non aggiornato in tempo reale."
          : payload.stale
            ? "Fonte non raggiungibile: sono mostrati gli ultimi elementi memorizzati."
            : `Posizioni calcolate dal backend con ${payload.propagator}; clicca un punto per i dettagli.`;
        lastPropagation = 0;
        renderPositions(payload);
      } catch (error) {
        if (requestId !== groupRequest) return;
        document.getElementById("earthCatalogStatus").textContent = "Backend Python: SGP4 non disponibile";
        document.getElementById("earth-orbit-status").textContent = error.message.includes("HTTP")
          ? `Il server orbitale ha risposto ${error.message}.`
          : "Avvia il backend Python e installa backend/requirements.txt. Nessuna posizione approssimata viene mostrata.";
        document.getElementById("earth-object-count").textContent = "Catalogo orbitale non disponibile";
        console.warn("Atlante orbitale terrestre:", error.message);
        document.getElementById("earth-orbit-retry").hidden = false;
      }
    }

    document.querySelectorAll("[data-orbit-group]").forEach((button) => button.addEventListener("click", () => loadGroup(button.dataset.orbitGroup)));
    if (!isolated) document.getElementById("earth-orbit-retry").addEventListener("click", () => loadGroup(selectedGroup));
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
        earth.rotation.y = ((now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()) / 86164.0905) * Math.PI * 2;
      }
      if (time - lastPropagation > 30000 && positionEntries.length) {
        lastPropagation = time;
        loadGroup(selectedGroup);
      }
      renderer.render(scene, camera);
    }

    const visibility = new IntersectionObserver((entries) => {
      orbitVisible = entries[0].isIntersecting;
      if (!isolated && orbitVisible && !positionEntries.length) loadGroup(selectedGroup);
    }, { threshold: 0.15 });
    visibility.observe(section);
    frame = requestAnimationFrame(render);
    window.addEventListener("pagehide", () => {
      textureRequest++;
      cancelAnimationFrame(frame);
      visibility.disconnect();
      resizeObserver.disconnect();
      renderer.dispose();
      detailedEarthTexture?.dispose();
      earth.geometry.dispose();
      earth.material.dispose();
      satelliteGeometry.dispose();
      satellitePoints.material.dispose();
    }, { once: true });
  };
})();
