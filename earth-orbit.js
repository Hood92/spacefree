(() => {
  const satelliteSources = [
    "https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/dist/satellite.min.js",
    "https://unpkg.com/satellite.js@5.0.0/dist/satellite.min.js",
  ];
  let satelliteLibraryPromise;

  function loadSatelliteLibrary() {
    if (window.satellite?.json2satrec) return Promise.resolve(window.satellite);
    if (satelliteLibraryPromise) return satelliteLibraryPromise;
    satelliteLibraryPromise = (async () => {
      for (const source of satelliteSources) {
        const loaded = await new Promise((resolve) => {
          const script = document.createElement("script");
          const timeout = window.setTimeout(() => finish(false), 6000);
          const finish = (ok) => {
            window.clearTimeout(timeout);
            script.onload = script.onerror = null;
            if (!ok) script.remove();
            resolve(ok && Boolean(window.satellite?.json2satrec && window.satellite?.propagate));
          };
          script.src = source;
          script.onload = () => finish(true);
          script.onerror = () => finish(false);
          document.head.appendChild(script);
        });
        if (loaded) return window.satellite;
      }
      throw new Error("Libreria SGP4 non raggiungibile dai CDN");
    })().catch((error) => {
      satelliteLibraryPromise = null;
      throw error;
    });
    return satelliteLibraryPromise;
  }

  function makeEarthTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    const ocean = context.createLinearGradient(0, 0, 0, 512);
    ocean.addColorStop(0, "#153d63");
    ocean.addColorStop(0.48, "#1477a0");
    ocean.addColorStop(1, "#082d4c");
    context.fillStyle = ocean;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const continents = [
      [[0.04,.15],[.12,.08],[.2,.12],[.23,.21],[.2,.29],[.16,.32],[.15,.42],[.1,.47],[.07,.39],[.06,.29]],
      [[.17,.4],[.23,.42],[.25,.52],[.23,.63],[.21,.75],[.18,.87],[.15,.78],[.14,.63],[.16,.53]],
      [[.39,.2],[.47,.16],[.51,.22],[.54,.29],[.51,.39],[.48,.48],[.46,.62],[.42,.67],[.4,.56],[.42,.43],[.39,.34]],
      [[.47,.2],[.57,.14],[.67,.16],[.76,.19],[.81,.27],[.78,.35],[.71,.37],[.68,.45],[.62,.43],[.59,.34],[.53,.35],[.5,.28]],
      [[.75,.5],[.81,.49],[.86,.56],[.84,.66],[.79,.7],[.76,.63]],
      [[.86,.68],[.9,.66],[.92,.72],[.9,.78],[.86,.76]],
      [[.02,.03],[.98,.03],[.98,.1],[.89,.12],[.8,.09],[.73,.13],[.65,.1],[.58,.14],[.48,.11],[.38,.13],[.28,.1],[.2,.13],[.11,.1],[.02,.12]],
    ];
    context.fillStyle = "#648b61";
    for (const polygon of continents) {
      context.beginPath();
      polygon.forEach(([x, y], index) => {
        const px = x * canvas.width;
        const py = y * canvas.height;
        if (index === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      });
      context.closePath();
      context.fill();
    }
    context.strokeStyle = "rgba(197,222,171,.35)";
    context.lineWidth = 5;
    for (const polygon of continents.slice(0, 6)) {
      context.beginPath();
      polygon.forEach(([x, y], index) => index ? context.lineTo(x * canvas.width, y * canvas.height) : context.moveTo(x * canvas.width, y * canvas.height));
      context.closePath();
      context.stroke();
    }
    return canvas;
  }

  window.initializeEarthOrbit = function initializeEarthOrbit(THREE) {
    const section = document.getElementById("earth-orbit");
    const mount = document.getElementById("earth-orbit-canvas");
    if (!section || !mount || section.dataset.initialized) return;
    section.dataset.initialized = "true";

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (error) {
      document.getElementById("earth-orbit-status").textContent = "WebGL non disponibile per il globo orbitale.";
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x030e17, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
    camera.position.set(0, 0, 190);
    const world = new THREE.Group();
    scene.add(world);
    scene.add(new THREE.AmbientLight(0x9abbd0, 1.5));

    const earthTexture = new THREE.CanvasTexture(makeEarthTexture());
    earthTexture.colorSpace = THREE.SRGBColorSpace;
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(10, 64, 48),
      new THREE.MeshPhongMaterial({ map: earthTexture, specular: 0x31536a, shininess: 18 })
    );
    earth.rotation.z = THREE.MathUtils.degToRad(23.4);
    world.add(earth);
    let detailedEarthTexture = null;
    // Mappa Blue Marble ad alta risoluzione; la texture procedurale resta pronta
    // come fallback se la sorgente immagini non è raggiungibile.
    new THREE.TextureLoader().load(
      "https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg",
      (texture) => {
        detailedEarthTexture = texture;
        texture.colorSpace = THREE.SRGBColorSpace;
        earth.material.map = texture;
        earth.material.needsUpdate = true;
      },
      undefined,
      () => console.warn("Texture terrestre ad alta risoluzione non disponibile; uso la mappa incorporata.")
    );
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(10.28, 48, 32),
      new THREE.MeshBasicMaterial({ color: 0x3eabe0, transparent: true, opacity: 0.11, side: THREE.BackSide, depthWrite: false })
    );
    world.add(atmosphere);
    const satelliteGeometry = new THREE.BufferGeometry();
    satelliteGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    const satellitePoints = new THREE.Points(
      satelliteGeometry,
      new THREE.PointsMaterial({ color: 0xb8f93a, size: 3, sizeAttenuation: false, transparent: true, opacity: 0.9 })
    );
    world.add(satellitePoints);

    let satrecEntries = [];
    let currentObjects = [];
    let selectedGroup = "active";
    let orbitVisible = false;
    let lastPropagation = 0;
    let groupRequest = 0;
    let frame = 0;
    let dragging = false;
    let dragged = false;
    let lastPointer = null;
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 1.5;
    const pointer = new THREE.Vector2();

    function resize() {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      camera.aspect = width / height;
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

    function propagateKepler(object, date) {
      const meanMotion = Number(object.MEAN_MOTION);
      const eccentricity = Number(object.ECCENTRICITY);
      const inclination = Number(object.INCLINATION) * Math.PI / 180;
      const ascendingNode = Number(object.RA_OF_ASC_NODE) * Math.PI / 180;
      const argumentPerigee = Number(object.ARG_OF_PERICENTER) * Math.PI / 180;
      const meanAnomaly = Number(object.MEAN_ANOMALY) * Math.PI / 180;
      const epoch = Date.parse(object.EPOCH);
      if (![meanMotion, eccentricity, inclination, ascendingNode, argumentPerigee, meanAnomaly, epoch].every(Number.isFinite) || meanMotion <= 0 || eccentricity < 0 || eccentricity >= 1) return null;
      const n = meanMotion * 2 * Math.PI / 86400;
      const semiMajorAxis = Math.cbrt(398600.4418 / (n * n));
      const mean = meanAnomaly + n * ((date.getTime() - epoch) / 1000);
      let eccentricAnomaly = mean;
      for (let iteration = 0; iteration < 8; iteration++) eccentricAnomaly -= (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - mean) / (1 - eccentricity * Math.cos(eccentricAnomaly));
      const xOrbit = semiMajorAxis * (Math.cos(eccentricAnomaly) - eccentricity);
      const yOrbit = semiMajorAxis * Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(eccentricAnomaly);
      const cosO = Math.cos(ascendingNode), sinO = Math.sin(ascendingNode);
      const cosW = Math.cos(argumentPerigee), sinW = Math.sin(argumentPerigee);
      const cosI = Math.cos(inclination), sinI = Math.sin(inclination);
      return {
        x: (cosO * cosW - sinO * sinW * cosI) * xOrbit + (-cosO * sinW - sinO * cosW * cosI) * yOrbit,
        y: (sinO * cosW + cosO * sinW * cosI) * xOrbit + (-sinO * sinW + cosO * cosW * cosI) * yOrbit,
        z: sinW * sinI * xOrbit + cosW * sinI * yOrbit,
      };
    }

    function propagatePositions(now = Date.now()) {
      if (!satrecEntries.length) return;
      const date = new Date(now);
      const positions = satelliteGeometry.attributes.position.array;
      const propagatedObjects = [];
      let valid = 0;
      for (let index = 0; index < satrecEntries.length; index++) {
        let state;
        try {
          state = satrecEntries[index].satrec && window.satellite?.propagate
            ? window.satellite.propagate(satrecEntries[index].satrec, date)
            : { position: propagateKepler(satrecEntries[index].object, date) };
        }
        catch { continue; }
        const position = state?.position;
        if (!position || !Number.isFinite(position.x + position.y + position.z)) continue;
        const distance = Math.hypot(position.x, position.y, position.z);
        const altitude = Math.max(0, distance - 6378.137);
        const displayRadius = 10 + 24 * Math.pow(Math.min(2, altitude / 40000), 0.45);
        const scale = displayRadius / distance;
        positions[valid * 3] = position.x * scale;
        positions[valid * 3 + 1] = position.z * scale;
        positions[valid * 3 + 2] = -position.y * scale;
        propagatedObjects.push(satrecEntries[index].object);
        valid++;
      }
      satelliteGeometry.setDrawRange(0, valid);
      satelliteGeometry.attributes.position.needsUpdate = true;
      satelliteGeometry.computeBoundingSphere();
      currentObjects = propagatedObjects;
      const computed = new Date(now).toLocaleTimeString("it-IT");
      const method = satrecEntries.some((entry) => entry.satrec) ? "SGP4" : "Kepler (approssimazione)";
      document.getElementById("earth-orbit-status").textContent = `Posizioni ${method} calcolate alle ${computed} · elementi del catalogo: ${new Date(section.dataset.updatedAt).toLocaleString("it-IT")}`;
    }

    async function loadGroup(group) {
      const requestId = ++groupRequest;
      let loadingStage = "libreria SGP4";
      selectedGroup = group;
      document.getElementById("earth-orbit-retry").hidden = true;
      document.querySelectorAll("[data-orbit-group]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.orbitGroup === group)));
      document.getElementById("earth-orbit-status").textContent = "Caricamento degli elementi orbitali…";
      try {
        let library = null;
        try { library = await loadSatelliteLibrary(); }
        catch (error) { console.warn("Libreria SGP4 non disponibile; uso la propagazione kepleriana di riserva:", error.message); }
        loadingStage = "API CelesTrak";
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 32000);
        let response;
        try {
          response = await fetch(`/api/orbital-objects?group=${encodeURIComponent(group)}&limit=12000`, { signal: controller.signal, headers: { Accept: "application/json" } });
        } finally {
          window.clearTimeout(timeout);
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (requestId !== groupRequest) return;
        if (!Array.isArray(payload.objects) || !payload.objects.length) throw new Error("Il catalogo orbitale non contiene oggetti validi.");
        const catalogStatus = document.getElementById("earthCatalogStatus");
        catalogStatus.textContent = `${payload.fallback ? "Snapshot locale" : payload.stale ? "Cache CelesTrak" : "CelesTrak"} · elementi del ${new Date(payload.updatedAt).toLocaleString("it-IT")}`;
        document.getElementById("earth-orbit-retry").hidden = true;
        const records = [];
        for (const object of payload.objects || []) {
          try {
            const satrec = library?.json2satrec(object) || null;
            const hasKeplerElements = Number(object.MEAN_MOTION) > 0 && Number.isFinite(Date.parse(object.EPOCH));
            if ((satrec && !satrec.error) || hasKeplerElements) records.push({ satrec: satrec && !satrec.error ? satrec : null, object });
          } catch { /* Scarta i record orbitali non validi senza interrompere il catalogo. */ }
        }
        if (!records.length) throw new Error("Gli elementi ricevuti non sono compatibili con il parser OMM/SGP4.");
        satrecEntries = records;
        satelliteGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(records.length * 3), 3));
        satelliteGeometry.setDrawRange(0, records.length);
        satellitePoints.material.color.set(group === "debris" ? 0xff9b70 : group === "stations" ? 0xb8f93a : 0x82d8ff);
        section.dataset.updatedAt = payload.updatedAt;
        document.getElementById("earth-object-count").textContent = `${records.length.toLocaleString("it-IT")} oggetti propagati · ${group}`;
        document.getElementById("earth-object-note").textContent = payload.fallback
          ? "Connessione non disponibile: snapshot locale di stazioni spaziali, non aggiornato in tempo reale."
          : payload.stale
            ? "Fonte non raggiungibile: sono mostrati gli ultimi elementi memorizzati."
            : library
              ? "Posizioni calcolate con SGP4 dagli elementi orbitali del catalogo; clicca un punto per i dettagli."
              : "SGP4 non disponibile: posizioni kepleriane indicative, basate sugli elementi del catalogo; clicca un punto per i dettagli.";
        lastPropagation = 0;
        propagatePositions();
      } catch (error) {
        if (requestId !== groupRequest) return;
        document.getElementById("earthCatalogStatus").textContent = loadingStage === "API CelesTrak"
          ? "CelesTrak: server o rete non raggiungibili"
          : "CelesTrak: in attesa della libreria SGP4";
        document.getElementById("earth-orbit-status").textContent = error.message.includes("HTTP")
          ? `Il server orbitale ha risposto ${error.message}.`
          : loadingStage === "libreria SGP4"
            ? "La libreria SGP4 non si è caricata. Controlla la connessione ai CDN e premi Riprova."
            : "Il server non ha raggiunto CelesTrak. Controlla npm start e la connessione del computer. Riprova.";
        document.getElementById("earth-object-count").textContent = "Catalogo orbitale non disponibile";
        console.warn("Atlante orbitale terrestre:", error.message);
        document.getElementById("earth-orbit-retry").hidden = false;
      }
    }

    document.querySelectorAll("[data-orbit-group]").forEach((button) => button.addEventListener("click", () => loadGroup(button.dataset.orbitGroup)));
    document.getElementById("earth-orbit-retry").addEventListener("click", () => loadGroup(selectedGroup));
    renderer.domElement.addEventListener("pointerdown", (event) => {
      dragging = true;
      dragged = false;
      lastPointer = { x: event.clientX, y: event.clientY };
      renderer.domElement.setPointerCapture(event.pointerId);
    });
    renderer.domElement.addEventListener("pointermove", (event) => {
      if (!dragging || !lastPointer) return;
      if (Math.hypot(event.clientX - lastPointer.x, event.clientY - lastPointer.y) > 3) dragged = true;
      world.rotation.y += (event.clientX - lastPointer.x) * 0.006;
      world.rotation.x = THREE.MathUtils.clamp(world.rotation.x + (event.clientY - lastPointer.y) * 0.006, -1.1, 1.1);
      lastPointer = { x: event.clientX, y: event.clientY };
    });
    const stopDrag = () => { dragging = false; lastPointer = null; };
    renderer.domElement.addEventListener("pointerup", stopDrag);
    renderer.domElement.addEventListener("pointercancel", stopDrag);
    renderer.domElement.addEventListener("wheel", (event) => {
      event.preventDefault();
      camera.position.z = THREE.MathUtils.clamp(camera.position.z * Math.exp(event.deltaY * 0.001), 45, 420);
    }, { passive: false });
    renderer.domElement.addEventListener("click", (event) => {
      if (dragging || dragged) { dragged = false; return; }
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(satellitePoints)[0];
      if (hit && currentObjects[hit.index]) setSelected(currentObjects[hit.index]);
    });

    function render(time) {
      frame = requestAnimationFrame(render);
      if (!orbitVisible) return;
      earth.rotation.y = window.satellite?.gstime ? -window.satellite.gstime(new Date()) : earth.rotation.y + 0.0005;
      if (time - lastPropagation > (satrecEntries.length > 3000 ? 4000 : 1200)) {
        lastPropagation = time;
        propagatePositions();
      }
      renderer.render(scene, camera);
    }

    const visibility = new IntersectionObserver((entries) => {
      orbitVisible = entries[0].isIntersecting;
      if (orbitVisible && !satrecEntries.length) loadGroup(selectedGroup);
    }, { threshold: 0.15 });
    visibility.observe(section);
    frame = requestAnimationFrame(render);
    window.addEventListener("pagehide", () => {
      cancelAnimationFrame(frame);
      visibility.disconnect();
      resizeObserver.disconnect();
      renderer.dispose();
      earthTexture.dispose();
      detailedEarthTexture?.dispose();
      satelliteGeometry.dispose();
    }, { once: true });
  };
})();
