document.addEventListener("DOMContentLoaded", async () => {
  "use strict";

  const container = document.getElementById("map-container");
  if (!container) {
    console.error('Mappa 3D: elemento "#map-container" assente.');
    return;
  }

  // Se la CDN primaria non risponde, prova una seconda sorgente per Three.js.
  async function ensureThree() {
    if (window.THREE) return true;
    const sources = [
      "https://unpkg.com/three@0.158.0/build/three.min.js",
      "https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js",
    ];
    for (const src of sources) {
      const loaded = await new Promise((resolve) => {
        const script = document.createElement("script");
        const timeout = window.setTimeout(() => finish(false), 8000);
        const finish = (ok) => {
          window.clearTimeout(timeout);
          script.onload = script.onerror = null;
          if (!ok) script.remove();
          resolve(ok && Boolean(window.THREE));
        };
        script.src = src;
        script.onload = () => finish(true);
        script.onerror = () => finish(false);
        document.head.appendChild(script);
      });
      if (loaded) return true;
    }
    return false;
  }

  if (!(await ensureThree())) {
    console.error("Three.js non raggiungibile: la mappa 3D non può essere inizializzata.");
    return;
  }
  window.initializeEarthOrbit?.(THREE);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04111d);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 6000);
  camera.position.set(0, 0, 115);
  const GALACTIC_MAP_SCALE = 0.0095; // unità di mappa per anno luce
  const SUN_GALACTIC_RADIUS_LY = 26000;
  // X punta dal Sole verso il centro galattico; il Sole è sul lato opposto.
  const SUN_GALACTIC_POSITION = new THREE.Vector3(SUN_GALACTIC_RADIUS_LY * GALACTIC_MAP_SCALE, 0, 0);
  scene.add(new THREE.AmbientLight(0x9bb8d0, 0.75));
  const stellarKeyLight = new THREE.DirectionalLight(0xc9e6ff, 1.35);
  stellarKeyLight.position.set(-80, 120, 90);
  scene.add(stellarKeyLight);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  } catch (error) {
    console.error("Mappa 3D non disponibile: impossibile creare il renderer WebGL.", error);
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.setAttribute("aria-label", "Mappa 3D interattiva dei sistemi stellari");
  renderer.domElement.setAttribute("role", "img");
  container.appendChild(renderer.domElement);
  document.querySelector(".map-panel")?.classList.add("map3d-ready");

  // Campo stellare deterministico distribuito in profondità.
  const starCount = 16000;
  const starPositions = new Float32Array(starCount * 3);
  let seed = 20261115;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < starCount; i++) {
    starPositions[i * 3] = (random() - 0.5) * 1800;
    starPositions[i * 3 + 1] = (random() - 0.5) * 1100;
    starPositions[i * 3 + 2] = (random() - 0.5) * 1800;
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  const galaxyGroup = new THREE.Group();
  const overviewTilt = 0.36;
  galaxyGroup.rotation.x = overviewTilt;
  scene.add(galaxyGroup);
  let activeGalaxyId = DEFAULT_GALAXY_ID;
  const galaxyLayers = new Map();
  for (const [id, galaxy] of atlasGalaxies) {
    const group = new THREE.Group();
    group.name = galaxy.name;
    group.userData.galaxyId = id;
    group.visible = id === activeGalaxyId;
    galaxyLayers.set(id, group);
    galaxyGroup.add(group);
  }
  const milkyWay = galaxyLayers.get(DEFAULT_GALAXY_ID);
  const starfield = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({ color: 0xc4dce8, size: 1.05, sizeAttenuation: true, transparent: true, opacity: 0.38, depthWrite: false })
  );
  starfield.userData.positionStatus = "illustration";
  galaxyGroup.add(starfield);

  // Illustrazione procedurale statica, separata dalle posizioni del catalogo.
  const galaxyParticleCount = 18000;
  const galaxyPositions = new Float32Array(galaxyParticleCount * 3);
  const galaxyColors = new Float32Array(galaxyParticleCount * 3);
  const coreColor = new THREE.Color(0xffd49c);
  const diskColor = new THREE.Color(0x8a9fb8);
  const armColor = new THREE.Color(0x9acbfa);
  const brightColor = new THREE.Color(0xe3eeff);
  const particleColor = new THREE.Color();
  const scatter = () => random() + random() + random() - 1.5;
  const barAngle = 0.52;
  const barCos = Math.cos(barAngle);
  const barSin = Math.sin(barAngle);
  for (let i = 0; i < galaxyParticleCount; i++) {
    const component = random();
    let x, y, z;
    if (component < 0.17) {
      const major = scatter() * 88;
      const minor = scatter() * 29;
      x = major * barCos - minor * barSin;
      z = major * barSin + minor * barCos;
      y = scatter() * (33 - 15 * Math.min(1, Math.abs(major) / 95));
      particleColor.copy(coreColor).multiplyScalar(0.38 + random() * 0.56);
    } else {
      const onArm = component < 0.78;
      const radius = onArm ? 52 + 416 * Math.pow(random(), 1.2) : 470 * Math.pow(random(), 0.74);
      const arm = onArm ? Math.floor(random() * 4) : 0;
      const lane = barAngle + arm * Math.PI / 2 + Math.log(radius / 52) * (2.12 + arm * 0.07);
      const irregularity = 0.13 * Math.sin(radius * 0.044 + arm * 1.7) + scatter() * (0.27 + radius / 1900);
      const angle = onArm ? lane + irregularity : random() * Math.PI * 2;
      x = radius * Math.cos(angle);
      z = radius * Math.sin(angle);
      y = scatter() * (onArm ? 10 + radius * 0.029 : 17 + radius * 0.042);
      const taper = 1 - THREE.MathUtils.smoothstep(radius, 290, 480) * 0.68;
      const brightness = onArm ? (arm % 2 === 0 ? 0.62 : 0.4) : 0.28;
      const variation = 0.42 + random() * 0.58 + (onArm ? 0.16 * Math.sin(radius * 0.077 + arm) : 0);
      particleColor.copy(onArm ? armColor : diskColor).lerp(brightColor, random() * 0.40)
        .multiplyScalar(brightness * taper * variation);
    }
    galaxyPositions.set([x, y, z], i * 3);
    particleColor.toArray(galaxyColors, i * 3);
  }
  const macroGeometry = new THREE.BufferGeometry();
  macroGeometry.setAttribute("position", new THREE.BufferAttribute(galaxyPositions, 3));
  macroGeometry.setAttribute("color", new THREE.BufferAttribute(galaxyColors, 3));
  const macroGalaxy = new THREE.Points(macroGeometry, new THREE.PointsMaterial({
    size: 3.2, sizeAttenuation: false, vertexColors: true, transparent: true,
    opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  macroGalaxy.userData.positionStatus = "illustration";
  milkyWay.add(macroGalaxy);

  // Texture radiale condivisa: evita i quadrati visibili con SpriteMaterial senza mappa.
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = glowCanvas.height = 64;
  const glowContext = glowCanvas.getContext("2d");
  const glowGradient = glowContext.createRadialGradient(32, 32, 0, 32, 32, 32);
  glowGradient.addColorStop(0, "rgba(255,255,255,0.9)");
  glowGradient.addColorStop(0.16, "rgba(255,255,255,0.42)");
  glowGradient.addColorStop(1, "rgba(255,255,255,0)");
  glowContext.fillStyle = glowGradient;
  glowContext.fillRect(0, 0, 64, 64);
  const glowTexture = new THREE.CanvasTexture(glowCanvas);
  const markerCanvas = document.createElement("canvas");
  markerCanvas.width = markerCanvas.height = 32;
  const markerInk = markerCanvas.getContext("2d");
  markerInk.fillStyle = "#ffffff";
  markerInk.beginPath();
  markerInk.arc(16, 16, 13, 0, Math.PI * 2);
  markerInk.fill();
  const markerTexture = new THREE.CanvasTexture(markerCanvas);
  starfield.material.map = markerTexture;
  macroGalaxy.material.map = glowTexture;

  const systemMeshes = [];
  const systemDecorations = [];
  const specialMeshes = [];
  let selectedSpecialId = null;
  const catalogBatches = new Map();
  let galaxyCatalogRevision = 0;
  const galaxyCaption = document.getElementById("galaxyPositionStatus");

  function updateGalaxyCaption() {
    if (!galaxyCaption) return;
    const galaxy = atlasGalaxies.get(activeGalaxyId);
    const mapped = systemMeshes.filter(({ userData }) => userData.galaxyId === activeGalaxyId).length;
    const total = Object.values(systems).filter((system) => system.galaxyId === activeGalaxyId).length;
    galaxyCaption.textContent = `${galaxy.name} · ${galaxy.diagram} · ${mapped} sistemi in mappa${total > mapped ? ` · ${total - mapped} senza posizione 3D` : ""}`;
  }

  function galacticPositionFromCatalog(raDegrees, decDegrees, distanceLy) {
    const ra = THREE.MathUtils.degToRad(raDegrees);
    const dec = THREE.MathUtils.degToRad(decDegrees);
    const cosDec = Math.cos(dec);
    const x = cosDec * Math.cos(ra);
    const y = cosDec * Math.sin(ra);
    const z = Math.sin(dec);
    // Rotazione ICRS/equatoriale → coordinate galattiche (matrice IAU J2000).
    const towardCenter = -0.0548755604 * x - 0.8734370902 * y - 0.4838350155 * z;
    const galacticY = 0.4941094279 * x - 0.4448296300 * y + 0.7469822445 * z;
    const galacticZ = -0.8676661490 * x - 0.1980763734 * y + 0.4559837762 * z;
    const distance = distanceLy * GALACTIC_MAP_SCALE;
    return new THREE.Vector3(
      SUN_GALACTIC_POSITION.x - towardCenter * distance,
      SUN_GALACTIC_POSITION.y + galacticZ * distance,
      SUN_GALACTIC_POSITION.z + galacticY * distance
    );
  }

  function objectPosition(data, id = data.id) {
    if (data.positionStatus === "solar-anchor" && data.galaxyId === DEFAULT_GALAXY_ID) {
      return SUN_GALACTIC_POSITION.clone();
    }
    if (data.positionStatus === "reference" && data.galaxyId === DEFAULT_GALAXY_ID) {
      if (id === "bh-sgra") return new THREE.Vector3();
      if (id === "sol") return SUN_GALACTIC_POSITION.clone();
    }
    // Future galaxies can provide coordinates in their own, explicitly defined frame.
    if (data.positionStatus === "catalog" && Array.isArray(data.galaxyPosition)
        && data.galaxyPosition.length === 3 && data.galaxyPosition.every(Number.isFinite)) {
      return new THREE.Vector3(...data.galaxyPosition);
    }
    const { ra, dec, distanceLy } = data;
    if (data.galaxyId === DEFAULT_GALAXY_ID && Number.isFinite(ra) && ra >= 0 && ra < 360
        && Number.isFinite(dec) && Math.abs(dec) <= 90 && Number.isFinite(distanceLy) && distanceLy > 0) {
      return galacticPositionFromCatalog(ra, dec, distanceLy);
    }
    return null;
  }

  function disposeGalaxySystems() {
    for (const object of systemDecorations) {
      object.removeFromParent();
      object.geometry?.dispose();
      object.material?.dispose();
    }
    systemMeshes.length = 0;
    systemDecorations.length = 0;
    catalogBatches.clear();
  }

  function rebuildGalaxySystems() {
    disposeGalaxySystems();
    galaxyCatalogRevision++;
    for (const [id, data] of Object.entries(systems)) {
      const layer = galaxyLayers.get(data.galaxyId);
      const position = layer && objectPosition(data, id);
      if (!position) continue;
      const starDescriptor = String(data.star || "").trim().toUpperCase();
      const spectralMatch = starDescriptor.match(/^([OBAFGKM])(?=\d|\s|$)/) || starDescriptor.match(/\(\s*([OBAFGKM])(?=\d|\s|$)/);
      const spectralClass = spectralMatch?.[1] || "G";
      const starVisuals = {
        O: { color: 0x9bbcff, radius: 0.068, glow: 8.6, halo: 16, emissive: 1.34 },
        B: { color: 0xaacbff, radius: 0.064, glow: 8.2, halo: 15, emissive: 1.28 },
        A: { color: 0xd5e5ff, radius: 0.061, glow: 7.9, halo: 14.5, emissive: 1.2 },
        F: { color: 0xfff0d2, radius: 0.058, glow: 7.7, halo: 14, emissive: 1.13 },
        G: { color: 0xffd98a, radius: 0.056, glow: 7.5, halo: 13.8, emissive: 1.08 },
        K: { color: 0xffad70, radius: 0.052, glow: 7.2, halo: 13.2, emissive: 1.02 },
        M: { color: 0xff817e, radius: 0.048, glow: 6.9, halo: 12.6, emissive: 0.96 },
      }[spectralClass];
      const color = starVisuals.color;
      const catalog = data.dataSource === "nasa-exoplanet-archive";
      const mesh = catalog ? new THREE.Object3D() : new THREE.Mesh(
        new THREE.SphereGeometry(starVisuals.radius, 20, 16),
        new THREE.MeshStandardMaterial({
          color, emissive: color, emissiveIntensity: starVisuals.emissive,
          transparent: true, depthWrite: false, roughness: 0.38, metalness: 0.04,
        })
      );
      mesh.position.copy(position);
      mesh.userData = {
        id, galaxyId: data.galaxyId, text: id === "sol" ? "Sole" : data.shortName,
        title: id === "sol" ? "Riferimento solare della mappa" : "Posizione da dati di catalogo",
        catalog, color, starVisuals, systemDecorations: [],
      };
      systemMeshes.push(mesh);
      if (catalog) {
        if (!catalogBatches.has(data.galaxyId)) catalogBatches.set(data.galaxyId, { markers: [] });
        const markers = catalogBatches.get(data.galaxyId).markers;
        mesh.userData.batchIndex = markers.length;
        markers.push(mesh);
        continue;
      }
      layer.add(mesh);
      systemDecorations.push(mesh);
      for (const [size, opacity] of [[starVisuals.glow, 0.62], [starVisuals.halo, 0.2]]) {
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTexture, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
        }));
        glow.position.copy(position);
        glow.userData = { baseSize: size, baseOpacity: opacity };
        layer.add(glow);
        systemDecorations.push(glow);
        mesh.userData.systemDecorations.push(glow);
      }
    }
    for (const [id, batch] of catalogBatches) {
      const geometry = new THREE.BufferGeometry().setFromPoints(batch.markers.map((marker) => marker.position));
      geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(batch.markers.length * 3), 3));
      batch.points = new THREE.Points(geometry, new THREE.PointsMaterial({
        map: markerTexture, size: 6, sizeAttenuation: false, vertexColors: true,
        transparent: true, depthWrite: false,
      }));
      galaxyLayers.get(id).add(batch.points);
      systemDecorations.push(batch.points);
    }
    updateGalaxyCaption();
  }
  rebuildGalaxySystems();
  // Punto di partenza visivo, indipendente dai controlli della camera.
  const mapCameraTarget = systemMeshes.find((mesh) => mesh.userData.id === "sol")?.position.clone() || new THREE.Vector3();
  const systemCameraTarget = new THREE.Vector3();
  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    const movementKeys = ["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright"];
    if (!movementKeys.includes(key) || event.target.closest("input, textarea, select, [contenteditable='true']")) return;
    event.preventDefault();
    mapTravel = null;
    shipFlight = null;
    pendingSystemId = null;
    pendingSpecialId = null;
    const distance = cameraBaseDistance * (3 / Math.max(0.12, typeof zoom === "number" ? zoom : 0.2));
    const step = Math.max(0.2, distance * 0.018) * (event.shiftKey ? 3 : 1);
    const target = activeSystemView ? systemCameraTarget : mapCameraTarget;
    if (key === "w" || key === "arrowup") target.z -= step;
    if (key === "s" || key === "arrowdown") target.z += step;
    if (key === "a" || key === "arrowleft") target.x -= step;
    if (key === "d" || key === "arrowright") target.x += step;
    if (key === "q") target.y -= step;
    if (key === "e") target.y += step;
  });

  // Navicella LCARS: resta nella mappa galattica e conserva l'ultima destinazione.
  const ship = new THREE.Group();
  const shipMaterials = [0xffa94d, 0xffd36e, 0x8fdcff].map((color) =>
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3, metalness: 0.55, roughness: 0.35 })
  );
  const saucer = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), shipMaterials[0]);
  saucer.scale.set(2.3, 0.35, 1.25);
  ship.add(saucer);
  const hull = new THREE.Mesh(new THREE.ConeGeometry(0.72, 2.7, 12), shipMaterials[1]);
  hull.rotation.z = -Math.PI / 2;
  hull.position.x = 1.8;
  ship.add(hull);
  const nacelleGeometry = new THREE.CapsuleGeometry(0.22, 2.2, 4, 8);
  for (const z of [-1.25, 1.25]) {
    const nacelle = new THREE.Mesh(nacelleGeometry, shipMaterials[2]);
    nacelle.rotation.z = Math.PI / 2;
    nacelle.position.set(-0.15, 0.7, z);
    ship.add(nacelle);
  }
  // Copiare il vettore: modificare direttamente mesh.position sposterebbe Sol
  // insieme alla navicella, lasciandole sovrapposte anche dopo il distacco.
  const shipStart = systemMeshes.find((mesh) => mesh.userData.id === "sol")?.position.clone() || new THREE.Vector3();
  shipStart.y += 0.16;
  ship.position.copy(shipStart);
  ship.scale.setScalar(0.035);
  galaxyGroup.add(ship);
  let shipFlight = null;
  let pendingSystemId = null;
  let pendingSpecialId = null;
  let pendingTravelDetailDelayMs = 0;
  let pendingTravelPlanetName = null;
  let mapTravel = null;
  let pendingTravelSource = "map";

  // Trascinamento sul canvas ruota l'intera galassia senza limiti angolari.
  let mapRotationPointer = null;
  let mapPanPointer = null;
  let suppressMapClick = false;
  renderer.domElement.style.touchAction = "pan-y";
  const mapOrbitToggle = document.getElementById("mapOrbitToggle");
  const touchPointers = new Map();
  let touchGesture = null;
  const touchNavigationDefault = window.matchMedia("(max-width: 1024px)").matches;
  if (touchNavigationDefault && mapOrbitToggle) {
    mapOrbitToggle.setAttribute("aria-pressed", "true");
    mapOrbitToggle.setAttribute("aria-label", "Disattiva i controlli touch e riattiva lo scorrimento della pagina");
    mapOrbitToggle.title = "Trascina con un dito per ruotare; usa due dita per zoom e pan; premi per scorrere la pagina";
    renderer.domElement.style.touchAction = "none";
  }
  mapOrbitToggle?.addEventListener("click", () => {
    const enabled = mapOrbitToggle.getAttribute("aria-pressed") !== "true";
    mapOrbitToggle.setAttribute("aria-pressed", String(enabled));
    mapOrbitToggle.setAttribute("aria-label", enabled ? "Disattiva i controlli touch e riattiva lo scorrimento della pagina" : "Attiva rotazione con un dito e zoom e pan con due dita");
    mapOrbitToggle.title = enabled ? "Trascina con un dito per ruotare; usa due dita per zoom e pan; premi per scorrere la pagina" : "Attiva rotazione con un dito e pinch-to-zoom con due dita";
    renderer.domElement.style.touchAction = enabled ? "none" : "pan-y";
  });
  renderer.domElement.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch") {
      if (mapOrbitToggle?.getAttribute("aria-pressed") !== "true") return;
      event.stopPropagation();
      if (touchPointers.size === 0) suppressMapClick = false;
      touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      renderer.domElement.setPointerCapture(event.pointerId);
      mapRotationPointer = null;
      mapPanPointer = null;
      if (touchPointers.size >= 2) {
        const [first, second] = [...touchPointers.values()];
        const rect = renderer.domElement.getBoundingClientRect();
        const centerX = (first.x + second.x) / 2 - rect.left;
        const centerY = (first.y + second.y) / 2 - rect.top;
        const originX = rect.width / 2;
        const originY = rect.height / 2;
        touchGesture = {
          mode: "pinch",
          distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
          centerX,
          centerY,
          zoom: typeof zoom === "number" ? zoom : 0.2,
          panX: typeof panX === "number" ? panX : 0,
          panY: typeof panY === "number" ? panY : 0,
          worldX: originX + (centerX - originX - (typeof panX === "number" ? panX : 0)) / Math.max(0.12, typeof zoom === "number" ? zoom : 0.2),
          worldY: originY + (centerY - originY - (typeof panY === "number" ? panY : 0)) / Math.max(0.12, typeof zoom === "number" ? zoom : 0.2),
        };
      } else {
        touchGesture = { mode: "rotate", id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, startX: event.clientX, startY: event.clientY };
      }
      return;
    }
    if (event.button === 2) {
      event.preventDefault();
      event.stopPropagation();
      mapPanPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      renderer.domElement.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    event.stopPropagation();
    mapRotationPointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    renderer.domElement.setPointerCapture(event.pointerId);
  });
  renderer.domElement.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch" && touchPointers.has(event.pointerId)) {
      event.preventDefault();
      event.stopPropagation();
      touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const rect = renderer.domElement.getBoundingClientRect();
      if (touchGesture?.mode === "pinch" && touchPointers.size >= 2) {
        const [first, second] = [...touchPointers.values()];
        const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
        const centerX = (first.x + second.x) / 2 - rect.left;
        const centerY = (first.y + second.y) / 2 - rect.top;
        const nextZoom = Math.max(0.12, Math.min(24, touchGesture.zoom * distance / touchGesture.distance));
        const originX = rect.width / 2;
        const originY = rect.height / 2;
        zoom = nextZoom;
        panX = centerX - originX - (touchGesture.worldX - originX) * zoom;
        panY = centerY - originY - (touchGesture.worldY - originY) * zoom;
        if (typeof clampMapPan === "function") clampMapPan();
        zoomLabel.textContent = `${zoom.toFixed(2)}×`;
      } else if (touchGesture?.mode === "rotate" && touchGesture.id === event.pointerId) {
        const dx = event.clientX - touchGesture.x;
        const dy = event.clientY - touchGesture.y;
        if (Math.hypot(event.clientX - touchGesture.startX, event.clientY - touchGesture.startY) > 9) touchGesture.moved = true;
        if (touchGesture.moved) {
          const rotationTarget = activeSystemView ? systemGroup : galaxyGroup;
          rotationTarget.rotation.y += dx * 0.005;
          rotationTarget.rotation.x += dy * 0.005;
          touchGesture.x = event.clientX;
          touchGesture.y = event.clientY;
        }
      }
      return;
    }
    if (mapPanPointer?.id === event.pointerId) {
      const dx = event.clientX - mapPanPointer.x;
      const dy = event.clientY - mapPanPointer.y;
      if (typeof panX === "number") panX += dx;
      if (typeof panY === "number") panY += dy;
      if (typeof clampMapPan === "function") clampMapPan();
      mapPanPointer.x = event.clientX;
      mapPanPointer.y = event.clientY;
      return;
    }
    if (!mapRotationPointer || mapRotationPointer.id !== event.pointerId) return;
    const dx = event.clientX - mapRotationPointer.x;
    const dy = event.clientY - mapRotationPointer.y;
    if (Math.hypot(dx, dy) > 3) mapRotationPointer.moved = true;
    if (mapRotationPointer.moved) {
      const rotationTarget = activeSystemView ? systemGroup : galaxyGroup;
      rotationTarget.rotation.y += dx * 0.005;
      rotationTarget.rotation.x += dy * 0.005;
      mapRotationPointer.x = event.clientX;
      mapRotationPointer.y = event.clientY;
    }
  });
  const endMapRotation = (event) => {
    if (event.pointerType === "touch" && touchPointers.has(event.pointerId)) {
      const wasPinching = touchGesture?.mode === "pinch";
      touchPointers.delete(event.pointerId);
      if (touchPointers.size === 1) {
        const [remainingId, point] = [...touchPointers.entries()][0];
        touchGesture = { mode: "rotate", id: remainingId, x: point.x, y: point.y, moved: wasPinching, startX: point.x, startY: point.y };
      } else if (touchPointers.size === 0) {
        suppressMapClick = event.type !== "pointercancel" && Boolean(touchGesture?.moved || wasPinching);
        touchGesture = null;
      }
      return;
    }
    if (mapPanPointer?.id === event.pointerId) {
      mapPanPointer = null;
      return;
    }
    if (!mapRotationPointer || mapRotationPointer.id !== event.pointerId) return;
    suppressMapClick = event.type !== "pointercancel" && mapRotationPointer.moved;
    mapRotationPointer = null;
  };
  renderer.domElement.addEventListener("pointerup", endMapRotation);
  renderer.domElement.addEventListener("pointercancel", endMapRotation);
  renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());

  const specialObjects = [
    ...(typeof mapObjects === "undefined" ? [] : mapObjects.map((item) => ({ ...item, objectType: "blackhole" }))),
    ...(typeof probes === "undefined" ? [] : probes.map((item) => ({ ...item, objectType: "probe" }))),
  ];
  specialObjects.forEach((item) => {
    const layer = galaxyLayers.get(item.galaxyId);
    const position = layer && objectPosition(item);
    if (!position) return;
    const marker = new THREE.Object3D();
    marker.position.copy(position);
    marker.userData = { id: item.id, galaxyId: item.galaxyId, item };
    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "map3d-special-marker";
    badge.dataset.objectId = item.id;
    badge.dataset.positionStatus = item.positionStatus;
    badge.dataset.markerKind = item.objectType === "blackhole" ? "blackhole" : item.historic ? "historic" : "probe";
    const category = item.objectType === "blackhole" ? "Buco nero" : item.historic ? "Sonda storica" : "Missione attiva";
    badge.title = `${item.name} · ${category} · ${item.positionNote}`;
    badge.setAttribute("aria-label", badge.title);
    badge.hidden = true;
    const leader = document.createElement("span");
    leader.className = "map3d-marker-leader";
    leader.hidden = true;
    leader.setAttribute("aria-hidden", "true");
    badge.addEventListener("pointerdown", (event) => event.stopPropagation());
    badge.addEventListener("click", (event) => {
      event.stopPropagation();
      travelToSpecial(marker, item);
    });
    container.append(leader, badge);
    Object.assign(marker.userData, { badge, leader });
    specialMeshes.push(marker);
  });

  function syncSceneFilters() {
    const filter = typeof activeMapFilter === "undefined" ? null : activeMapFilter;
    for (const marker of [...systemMeshes, ...specialMeshes]) {
      marker.userData.filterMatch = !filter || filter.matches.has(marker.userData.id);
    }
    for (const { markers, points } of catalogBatches.values()) {
      const colors = points.geometry.attributes.color;
      const color = new THREE.Color();
      const tint = new THREE.Color();
      markers.forEach((marker, index) => {
        if (filter && marker.userData.filterMatch) color.set(0xb8f93a);
        else color.set(0x9de6ff).lerp(tint.set(marker.userData.color), 0.3);
        color.multiplyScalar(marker.userData.filterMatch ? 1 : 0.30);
        colors.setXYZ(index, color.r, color.g, color.b);
      });
      colors.needsUpdate = true;
    }
  }
  syncSceneFilters();
  window.addEventListener("map3d-filter", syncSceneFilters);
  window.addEventListener("map3d-catalog-updated", () => {
    rebuildGalaxySystems();
    syncSceneFilters();
  });

  const systemGroup = new THREE.Group();
  systemGroup.visible = false;
  scene.add(systemGroup);
  const ambientLight = new THREE.AmbientLight(0x9bb8d0, 1.3);
  scene.add(ambientLight);
  const systemBodies = [];
  let activeSystemView = null;
  let cameraBaseDistance = 115;

  const viewControls = document.createElement("div");
  viewControls.className = "map3d-system-controls";
  viewControls.innerHTML = '<button type="button" class="map3d-back">← Mappa stellare</button><div class="map3d-system-heading"><strong></strong><small>VISTA SCHEMATICA · TRASCINA PER RUOTARE · ROTELLA PER ZOOM</small></div>';
  container.appendChild(viewControls);
  const viewTitle = viewControls.querySelector("strong");
  viewControls.querySelector("button").addEventListener("click", () => showGalaxy());

  function showGalaxy(reset = false) {
    activeSystemView = null;
    systemGroup.visible = false;
    clearSystemGroup();
    galaxyGroup.visible = true;
    cameraBaseDistance = 115;
    if (reset) {
      selectGalaxy(DEFAULT_GALAXY_ID);
      galaxyGroup.rotation.set(overviewTilt, 0, 0);
      const solarSystem = systemMeshes.find((mesh) => mesh.userData.id === "sol");
      if (solarSystem) mapCameraTarget.copy(solarSystem.position);
      mapTravel = null;
      shipFlight = null;
      pendingSystemId = null;
      pendingSpecialId = selectedSpecialId = null;
    }
    document.querySelector(".map-panel")?.classList.remove("system3d-view");
  }

  function selectGalaxy(id) {
    if (id === activeGalaxyId || !galaxyLayers.has(id)) return;
    galaxyLayers.get(activeGalaxyId).visible = false;
    activeGalaxyId = id;
    galaxyLayers.get(id).visible = true;
    mapCameraTarget.set(0, 0, 0);
    updateGalaxyCaption();
  }

  function clearSystemGroup() {
    while (systemGroup.children.length) {
      const child = systemGroup.children[0];
      systemGroup.remove(child);
      child.traverse((object) => {
        object.geometry?.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          if (!material) return;
          material.userData.disposed = true;
          material.map?.dispose();
          material.bumpMap?.dispose();
          material.dispose();
        });
      });
    }
    for (const body of systemBodies) {
      if (!body.maps) continue;
      Object.values(body.maps).forEach((texture) => texture.dispose());
    }
    container.querySelectorAll(".map3d-body-label, .map3d-no-planets").forEach((element) => element.remove());
    systemBodies.length = 0;
  }

  const planetTextureLoader = new THREE.TextureLoader();
  planetTextureLoader.setCrossOrigin("anonymous");
  function createProceduralPlanetMaps(planet, index, systemId) {
    const width = 512, height = 256;
    const seedText = `${systemId}-${planet.name}-${index}`;
    let textureSeed = [...seedText].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 17);
    const randomTexture = () => ((textureSeed = (textureSeed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const isEarth = /terra|earth/i.test(planet.name);
    const isGas = /gassoso|gigante/i.test(planet.type);
    const base = new THREE.Color(planet.color || "#9bb8c6");
    const makeCanvas = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return [canvas, canvas.getContext("2d")];
    };
    const [surfaceCanvas, surface] = makeCanvas();
    const [heightCanvas, heightContext] = makeCanvas();
    const [cloudCanvas, clouds] = makeCanvas();
    const baseColor = `#${base.getHexString()}`;
    surface.fillStyle = isEarth ? "#103f80" : baseColor;
    surface.fillRect(0, 0, width, height);
    heightContext.fillStyle = "#777777";
    heightContext.fillRect(0, 0, width, height);
    clouds.clearRect(0, 0, width, height);
    if (isGas) {
      for (let y = 0; y < height; y += 1) {
        const wave = Math.sin(y * 0.065) * 13 + Math.sin(y * 0.19) * 5;
        const tone = 0.76 + wave / 180 + randomTexture() * 0.16;
        surface.fillStyle = `rgb(${Math.round(base.r * 255 * tone)},${Math.round(base.g * 255 * tone)},${Math.round(base.b * 255 * tone)})`;
        surface.fillRect(0, y, width, 1);
      }
      for (let band = 0; band < 18; band += 1) {
        const y = randomTexture() * height;
        surface.fillStyle = `rgba(55,35,27,${0.08 + randomTexture() * 0.16})`;
        surface.fillRect(0, y, width, 2 + randomTexture() * 8);
      }
    } else if (isEarth) {
      surface.fillStyle = "#428b4b";
      for (let land = 0; land < 17; land += 1) {
        const x = randomTexture() * width, y = randomTexture() * height;
        const rx = 8 + randomTexture() * 42, ry = 4 + randomTexture() * 20;
        const rotation = randomTexture() * Math.PI;
        surface.beginPath();
        surface.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
        surface.fill();
        heightContext.fillStyle = `rgb(${Math.round(145 + randomTexture() * 80)},${Math.round(145 + randomTexture() * 80)},${Math.round(145 + randomTexture() * 80)})`;
        heightContext.beginPath();
        heightContext.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
        heightContext.fill();
      }
      surface.fillStyle = "rgba(239,245,226,.7)";
      surface.fillRect(0, 0, width, 16);
      surface.fillRect(0, height - 16, width, 16);
      for (let cloud = 0; cloud < 150; cloud += 1) {
        clouds.fillStyle = `rgba(255,255,255,${0.08 + randomTexture() * 0.38})`;
        clouds.beginPath();
        clouds.ellipse(randomTexture() * width, randomTexture() * height, 2 + randomTexture() * 18, 1 + randomTexture() * 4, 0, 0, Math.PI * 2);
        clouds.fill();
      }
    } else {
      surface.fillStyle = "rgba(255,255,255,.12)";
      for (let feature = 0; feature < 650; feature += 1) {
        const radius = 0.5 + randomTexture() * 3.5;
        const x = randomTexture() * width, y = randomTexture() * height;
        surface.globalAlpha = 0.05 + randomTexture() * 0.22;
        surface.beginPath();
        surface.arc(x, y, radius, 0, Math.PI * 2);
        surface.fill();
        heightContext.fillStyle = randomTexture() > 0.5 ? "#aaaaaa" : "#555555";
        heightContext.beginPath();
        heightContext.arc(x, y, radius * 1.3, 0, Math.PI * 2);
        heightContext.fill();
      }
      surface.globalAlpha = 1;
    }
    const surfaceMap = new THREE.CanvasTexture(surfaceCanvas);
    const bumpMap = new THREE.CanvasTexture(heightCanvas);
    const cloudMap = new THREE.CanvasTexture(cloudCanvas);
    surfaceMap.colorSpace = THREE.SRGBColorSpace;
    cloudMap.colorSpace = THREE.SRGBColorSpace;
    for (const texture of [surfaceMap, bumpMap, cloudMap]) texture.needsUpdate = true;
    return { surfaceMap, bumpMap, cloudMap };
  }

  function createPlanetMaterial(planet, index, systemId) {
    const maps = createProceduralPlanetMaps(planet, index, systemId);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: maps.surfaceMap,
      bumpMap: maps.bumpMap,
      bumpScale: /gassoso|gigante/i.test(planet.type) ? 0.08 : 0.22,
      roughness: 0.84,
      metalness: 0.015,
    });
    const textureUrl = planet.textureUrl || planet.texture;
    if (typeof textureUrl === "string" && textureUrl.trim()) {
      planetTextureLoader.load(textureUrl, (texture) => {
        if (material.userData.disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        material.map = texture;
        material.needsUpdate = true;
        maps.surfaceMap.dispose();
      }, undefined, () => { /* Le mappe procedurali restano il fallback silenzioso. */ });
    }
    return { material, maps };
  }

  function enterSystemView(id, afterFlight = false) {
    const data = systems[id];
    if (!data) return;
    const destination = systemMeshes.find((mesh) => mesh.userData.id === id);
    if (destination && !afterFlight) {
      shipFlight = {
        from: ship.position.clone(),
        // Sosta appena sopra la stella alla stessa scala delle coordinate mappa.
        to: destination.position.clone().add(new THREE.Vector3(0, 0.16, 0)),
        start: performance.now(),
        duration: 1500,
      };
      pendingSystemId = id;
      return;
    }
    pendingSystemId = null;
    activeSystemView = id;
    systemGroup.userData.galaxyId = data.galaxyId;
    clearSystemGroup();
    galaxyGroup.visible = false;
    systemGroup.visible = true;
    cameraBaseDistance = 190;
    systemCameraTarget.set(0, 0, 0);
    camera.position.set(0, 0, cameraBaseDistance);
    camera.position.x = camera.position.y = 0;
    if (typeof zoom === "number") {
      zoom = 3;
      if (zoomLabel) zoomLabel.textContent = `${zoom.toFixed(2)}×`;
    }
    if (typeof panX === "number") panX = 0;
    if (typeof panY === "number") panY = 0;
    document.querySelector(".map-panel")?.classList.add("system3d-view");
    viewTitle.textContent = data.shortName;
    viewControls.querySelector("small").textContent = destination
      ? "ORBITE SCHEMATICHE ? TRASCINA PER RUOTARE ? ROTELLA PER ZOOM"
      : "POSIZIONE GALATTICA NON DISPONIBILE ? ORBITE SCHEMATICHE";

    const starColor = id === "sol" || /G[0-9]/.test(data.star) ? 0xffd98a : /A[0-9]|F[0-9]/.test(data.star) ? 0x9bdcff : /K[0-9]/.test(data.star) ? 0xffad70 : 0xff817e;
    const star = new THREE.Mesh(
      new THREE.SphereGeometry(4.3, 40, 28),
      new THREE.MeshBasicMaterial({ color: starColor })
    );
    systemGroup.add(star);
    const starGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: starColor, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
    starGlow.scale.set(28, 28, 1);
    systemGroup.add(starGlow);
    const light = new THREE.PointLight(starColor, 180, 260, 1.5);
    systemGroup.add(light);
    const starLabel = document.createElement("span");
    starLabel.className = "map3d-label map3d-body-label";
    starLabel.textContent = data.shortName;
    container.appendChild(starLabel);
    systemBodies.push({ mesh: star, label: starLabel, star: true });

    (data.planets || []).forEach((planet, index) => {
      const distanceMatch = String(planet.distance).replace(",", ".").match(/[0-9]+(?:\.[0-9]+)?/);
      const au = distanceMatch ? Number(distanceMatch[0]) : index + 1;
      const orbitRadius = 11 + Math.log1p(Math.max(0, au)) * 14;
      const orbit = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(
          Array.from({ length: 128 }, (_, point) => {
            const angle = (point / 128) * Math.PI * 2;
            return new THREE.Vector3(Math.cos(angle) * orbitRadius, Math.sin(angle) * orbitRadius, 0);
          })
        ),
        new THREE.LineBasicMaterial({ color: 0x8fb4c0, transparent: true, opacity: 0.22 })
      );
      systemGroup.add(orbit);
      const isGiant = /gassoso|gigante/i.test(planet.type);
      const isDwarf = /nano/i.test(planet.type);
      // Scala visiva esagerata per mantenere i pianeti leggibili senza
      // intervenire sul raggio orbitale calcolato sopra.
      const planetScale = 1.55;
      const radius = (isGiant ? 1.65 : isDwarf ? 0.58 : 0.95) * planetScale;
      const planetMaps = createPlanetMaterial(planet, index, id);
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), planetMaps.material);
      const phase = index * 2.399;
      const orbitGroup = new THREE.Group();
      orbitGroup.position.set(Math.cos(phase) * orbitRadius, Math.sin(phase) * orbitRadius, 0);
      const spinAxisGroup = new THREE.Group();
      const orbitalNormal = new THREE.Vector3(0, 0, 1);
      const localNorth = new THREE.Vector3(0, 1, 0);
      const alignPole = new THREE.Quaternion().setFromUnitVectors(localNorth, orbitalNormal);
      const hasCataloguedAxialTilt = typeof planet.axialTiltDeg === "number" && Number.isFinite(planet.axialTiltDeg);
      const axialTiltDeg = hasCataloguedAxialTilt ? planet.axialTiltDeg : 0;
      if (axialTiltDeg !== 0) {
        const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(axialTiltDeg));
        alignPole.premultiply(tilt);
      }
      spinAxisGroup.quaternion.copy(alignPole);
      orbitGroup.add(spinAxisGroup);
      spinAxisGroup.add(mesh);
      mesh.userData = { orbitRadius, phase, speed: 0.42 / Math.sqrt(orbitRadius), spinSpeed: 0.12, planet, systemId: id };
      const poleAxis = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -radius * 1.28, 0), new THREE.Vector3(0, radius * 1.28, 0)]),
        new THREE.LineBasicMaterial({ color: 0xd8efff, transparent: true, opacity: 0.72, depthWrite: false })
      );
      spinAxisGroup.add(poleAxis);
      const northPole = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.16, radius * 0.085), 12, 8), new THREE.MeshBasicMaterial({ color: 0x7df9ff }));
      const southPole = northPole.clone();
      northPole.position.y = radius * 1.34;
      southPole.position.y = -radius * 1.34;
      spinAxisGroup.add(northPole, southPole);
      systemGroup.add(orbitGroup);
      const hitMesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, colorWrite: false, depthWrite: false })
      );
      hitMesh.position.copy(orbitGroup.position);
      hitMesh.scale.setScalar(Math.max(radius * 1.45, 2.2));
      hitMesh.userData.planetHitTarget = true;
      systemGroup.add(hitMesh);
      systemBodies.push({ mesh, orbitGroup, spinAxisGroup, hitMesh, planet, systemId: id, axialTiltDeg, maps: planetMaps.maps });
      if (/terra|earth/i.test(planet.name)) {
        const cloudLayer = new THREE.Mesh(
          new THREE.SphereGeometry(radius * 1.012, 40, 28),
          new THREE.MeshBasicMaterial({ map: planetMaps.maps.cloudMap, transparent: true, opacity: 0.62, depthWrite: false })
        );
        const atmosphere = new THREE.Mesh(
          new THREE.SphereGeometry(radius * 1.055, 40, 28),
          new THREE.MeshBasicMaterial({ color: 0x68bfff, transparent: true, opacity: 0.12, side: THREE.BackSide, depthWrite: false })
        );
        mesh.add(cloudLayer, atmosphere);
      }
      const label = document.createElement("span");
      label.className = "map3d-label map3d-body-label";
      label.textContent = planet.name;
      label.title = hasCataloguedAxialTilt
        ? `Obliquità catalogata: ${axialTiltDeg}°`
        : "Asse polare neutro rispetto al piano orbitale; obliquità non catalogata.";
      container.appendChild(label);
      systemBodies[systemBodies.length - 1].label = label;
      label.tabIndex = 0;
      label.setAttribute("role", "button");
      label.setAttribute("aria-label", `Apri dettagli per ${planet.name}`);
      label.addEventListener("click", (event) => {
        event.stopPropagation();
        const card = [...document.querySelectorAll(".planet-card")].find((item) => item.dataset.planet === planet.name);
        card?.click();
      });
      label.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          label.click();
        }
      });
    });

    const emptyLabel = document.createElement("span");
    emptyLabel.className = "map3d-no-planets";
    emptyLabel.textContent = data.planets?.length ? "" : "Nessun pianeta confermato nel catalogo attuale.";
    emptyLabel.hidden = Boolean(data.planets?.length);
    container.appendChild(emptyLabel);
    systemBodies.emptyLabel = emptyLabel;
    window.dispatchEvent(new CustomEvent("map3d-system-entered", { detail: { id, source: pendingTravelSource, planetName: pendingTravelPlanetName, detailDelayMs: pendingTravelDetailDelayMs } }));
  }

  function travelToSystem(id, source = "map", detailDelayMs = 0, planetName = null) {
    const destination = systemMeshes.find((mesh) => mesh.userData.id === id);
    if (!systems[id]) return;
    selectedSpecialId = null;
    pendingTravelSource = source;
    pendingTravelDetailDelayMs = detailDelayMs;
    pendingTravelPlanetName = planetName;
    if (!destination) {
      mapTravel = shipFlight = pendingSpecialId = null;
      enterSystemView(id, true);
      return;
    }
    selectGalaxy(destination.userData.galaxyId);
    if (activeSystemView) {
      activeSystemView = null;
      systemGroup.visible = false;
      clearSystemGroup();
      galaxyGroup.visible = true;
      cameraBaseDistance = 115;
      document.querySelector(".map-panel")?.classList.remove("system3d-view");
    }
    const startZoom = typeof zoom === "number" ? zoom : 0.2;
    const startDistance = cameraBaseDistance * (3 / startZoom);
    const worldUnitsPerPixel =
      (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * startDistance) /
      Math.max(1, container.clientHeight);
    const cameraFocusWorld = galaxyGroup.localToWorld(mapCameraTarget.clone());
    cameraFocusWorld.x -= (typeof panX === "number" ? panX : 0) * worldUnitsPerPixel;
    cameraFocusWorld.y += (typeof panY === "number" ? panY : 0) * worldUnitsPerPixel;
    const from = galaxyGroup.worldToLocal(cameraFocusWorld);
    const to = destination.position.clone();
    mapCameraTarget.copy(from);
    if (typeof panX === "number") panX = 0;
    if (typeof panY === "number") panY = 0;
    const travelDuration = source === "filter" ? 2000 : 2400;
    mapTravel = { id, from, to, start: performance.now(), duration: travelDuration, startZoom, endZoom: 24 };
    shipFlight = {
      from: ship.position.clone(),
      to: destination.position.clone().add(new THREE.Vector3(0, 0.16, 0)),
      start: mapTravel.start,
      duration: travelDuration,
    };
    pendingSystemId = id;
    pendingSpecialId = null;
  }

  function travelToSpecial(mesh, item) {
    selectGalaxy(mesh.userData.galaxyId);
    if (activeSystemView) {
      activeSystemView = null;
      systemGroup.visible = false;
      clearSystemGroup();
      galaxyGroup.visible = true;
      cameraBaseDistance = 115;
      document.querySelector(".map-panel")?.classList.remove("system3d-view");
    }
    const startZoom = typeof zoom === "number" ? zoom : 0.2;
    const startDistance = cameraBaseDistance * (3 / startZoom);
    const worldUnitsPerPixel =
      (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * startDistance) /
      Math.max(1, container.clientHeight);
    const focusWorld = galaxyGroup.localToWorld(mapCameraTarget.clone());
    focusWorld.x -= (typeof panX === "number" ? panX : 0) * worldUnitsPerPixel;
    focusWorld.y += (typeof panY === "number" ? panY : 0) * worldUnitsPerPixel;
    const from = galaxyGroup.worldToLocal(focusWorld);
    const to = mesh.position.clone();
    mapCameraTarget.copy(from);
    if (typeof panX === "number") panX = 0;
    if (typeof panY === "number") panY = 0;
    pendingSystemId = null;
    pendingSpecialId = selectedSpecialId = item.id;
    pendingTravelDetailDelayMs = 0;
    const start = performance.now();
    mapTravel = { id: item.id, from, to, start, duration: 2200, startZoom, endZoom: Math.max(startZoom, 8) };
    shipFlight = {
      from: ship.position.clone(),
      to: to.clone().add(new THREE.Vector3(0, 0.2, 0)),
      start,
      duration: 2200,
    };
  }
  window.travelToSpecialObject = (id) => {
    const mesh = specialMeshes.find((candidate) => candidate.userData.id === id);
    const item = specialObjects.find((candidate) => candidate.id === id);
    if (mesh && item) travelToSpecial(mesh, item);
    else if (item?.objectType === "blackhole") openBlackHole(id);
    else if (item?.objectType === "probe") openProbe(id);
  };

  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 2;
  const pointer = new THREE.Vector2();
  const pickWorld = new THREE.Vector3();
  let hoveredMarker = null;
  let systemPointer = null;
  let labelUnderPointer = null;
  const isActiveMarker = (marker) => marker.userData.galaxyId === activeGalaxyId;
  function markerWorldPosition(marker, target) {
    const layer = galaxyLayers.get(marker.userData.galaxyId);
    return target.copy(marker.position).applyMatrix4(layer.matrixWorld);
  }

  function findSystemHit(event) {
    const directHit = raycaster.intersectObjects(systemMeshes.filter((marker) => marker.isMesh && isActiveMarker(marker)), false)[0]?.object;
    const rect = renderer.domElement.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    let closest = null;
    const isTouch = event.pointerType === "touch" || window.matchMedia("(pointer: coarse)").matches;
    const pickRadius = isTouch ? 42 : event.pointerType === "pen" ? 28 : 16;
    let closestDistanceSquared = pickRadius * pickRadius;
    let closestDepth = Infinity;
    for (const mesh of systemMeshes) {
      if (!isActiveMarker(mesh)) continue;
      if (mesh.userData.catalog && mesh.userData.batchIndex >= catalogBatches.get(activeGalaxyId).points.geometry.drawRange.count) continue;
      markerWorldPosition(mesh, pickWorld);
      const depth = camera.position.distanceToSquared(pickWorld);
      const projected = pickWorld.project(camera);
      if (projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1.08 || Math.abs(projected.y) > 1.08) continue;
      const screenX = (projected.x * 0.5 + 0.5) * rect.width;
      const screenY = (-projected.y * 0.5 + 0.5) * rect.height;
      const distanceSquared = (screenX - pointerX) ** 2 + (screenY - pointerY) ** 2;
      if (distanceSquared < closestDistanceSquared || (Math.abs(distanceSquared - closestDistanceSquared) < 0.25 && depth < closestDepth)) {
        closest = mesh;
        closestDistanceSquared = distanceSquared;
        closestDepth = depth;
      }
    }
    // La posizione sullo schermo decide tra marcatori vicini: il raycast può
    // colpire la stella sovrapposta (spesso Sol) anche quando il dito è più
    // vicino a un altro sistema.
    return closest || directHit;
  }
  renderer.domElement.addEventListener("click", (event) => {
    if (suppressMapClick) {
      suppressMapClick = false;
      return;
    }
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    if (activeSystemView) {
      const selectableBodies = systemBodies.filter((item) => item.planet);
      const visibleHit = raycaster.intersectObjects(selectableBodies.map((body) => body.mesh), false)[0];
      const hit = visibleHit || raycaster.intersectObjects(selectableBodies.map((body) => body.hitMesh), false)[0];
      let body = hit && selectableBodies.find((item) => item.mesh === hit.object || item.hitMesh === hit.object);
      if (!visibleHit) {
        const rect = renderer.domElement.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const clickY = event.clientY - rect.top;
        let nearestDistance = 24;
        let nearestBody = null;
        for (const candidate of selectableBodies) {
          const screenPosition = candidate.mesh.getWorldPosition(new THREE.Vector3()).project(camera);
          if (screenPosition.z < -1 || screenPosition.z > 1) continue;
          const x = (screenPosition.x * 0.5 + 0.5) * rect.width;
          const y = (-screenPosition.y * 0.5 + 0.5) * rect.height;
          const distance = Math.hypot(x - clickX, y - clickY);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestBody = candidate;
          }
        }
        if (nearestBody) body = nearestBody;
      }
      if (!body) return;
      if (body?.planet) {
        const card = [...document.querySelectorAll(".planet-card")].find((item) => item.dataset.planet === body.planet.name);
        card?.click();
      }
      return;
    }
    const systemHit = findSystemHit(event);
    if (systemHit) navigateToSystem(systemHit.userData.id);
  });
  renderer.domElement.addEventListener("pointermove", (event) => {
    if (activeSystemView) return;
    systemPointer = event.buttons ? null : { x: event.offsetX, y: event.offsetY };
  });
  renderer.domElement.addEventListener("pointerleave", () => {
    systemPointer = null;
  });
  const handleMapTravel = (event) => {
    const id = event.detail?.id;
    if (!id) return;
    window.pendingMapTravel = null;
    travelToSystem(id, event.detail?.source || "map", event.detail?.detailDelayMs || 0, event.detail?.planetName || null);
  };
  window.addEventListener("map3d-open-system", handleMapTravel);
  window.addEventListener("map3d-travel-to", handleMapTravel);
  if (window.pendingMapTravel?.id) travelToSystem(window.pendingMapTravel.id, window.pendingMapTravel.source || "map", window.pendingMapTravel.detailDelayMs || 0, window.pendingMapTravel.planetName || null);
  window.addEventListener("map3d-show-galaxy", (event) => showGalaxy(Boolean(event.detail?.reset)));

  const visibleGalaxyLabels = new Map();
  const labelProjection = new THREE.Vector3();
  function isSpecialFilter(kind) {
    return ["blackhole", "probe", "historic-probe"].includes(kind);
  }

  let previousSpecialFilter = null;
  window.addEventListener("map3d-filter", () => {
    const kind = activeMapFilter?.kind;
    if (kind === previousSpecialFilter) return;
    previousSpecialFilter = kind;
    selectedSpecialId = null;
    if (!isSpecialFilter(kind)) return;
    selectGalaxy(DEFAULT_GALAXY_ID);
    showGalaxy();
    hoveredMarker = null;
    systemPointer = null;
    labelUnderPointer = null;
    mapTravel = shipFlight = pendingSystemId = pendingSpecialId = null;
    const bounds = new THREE.Box3();
    galaxyGroup.updateMatrixWorld();
    for (const marker of specialMeshes) {
      if (isActiveMarker(marker) && activeMapFilter.matches.has(marker.userData.id)) {
        bounds.expandByPoint(markerWorldPosition(marker, labelProjection));
      }
    }
    if (bounds.isEmpty()) return;
    mapCameraTarget.copy(galaxyGroup.worldToLocal(bounds.getCenter(labelProjection)));
    const half = bounds.getSize(labelProjection).multiplyScalar(0.5);
    const viewRadius = Math.max(half.x / camera.aspect, half.y);
    const viewDistance = half.z + 1.65 * viewRadius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    setZoom(Math.min(4, cameraBaseDistance * 3 / Math.max(1, viewDistance)));
    if (container.clientWidth < 640) panY = Math.round(container.clientHeight * 0.10);
  });

  // These offsets are in screen pixels. A leader line connects a displaced badge to its anchor.
  const badgeOffsets = [[0, 0]];
  for (const radius of [36, 70, 102, 136]) {
    for (let index = 0; index < 8; index++) {
      const angle = index * Math.PI / 4;
      badgeOffsets.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
    }
  }
  const specialProjection = new THREE.Vector3();
  const markerOverlays = document.querySelectorAll("#filterSummaryPanel, #mapFilterNotice, .map-controls");
  function layoutSpecialMarkers(filter) {
    const visible = !activeSystemView;
    const filterActive = isSpecialFilter(filter?.kind);
    const rect = container.getBoundingClientRect();
    const obstacles = [...markerOverlays, ...visibleGalaxyLabels.values()]
      .filter((element) => !element.hidden)
      .map((element) => element.getBoundingClientRect())
      .filter((bounds) => bounds.width && bounds.height);
    const used = [];
    const ordered = selectedSpecialId
      ? [...specialMeshes].sort((a, b) => Number(b.userData.id === selectedSpecialId) - Number(a.userData.id === selectedSpecialId))
      : specialMeshes;
    for (const marker of ordered) {
      const { id, badge, leader, item } = marker.userData;
      const selected = id === selectedSpecialId;
      if (!visible || !isActiveMarker(marker)
          || !(selected || (filterActive ? filter.matches.has(id) : id === "bh-sgra" && !filter))) {
        badge.hidden = leader.hidden = true;
        continue;
      }
      markerWorldPosition(marker, specialProjection).project(camera);
      if (Math.abs(specialProjection.x) > 1 || Math.abs(specialProjection.y) > 1 || Math.abs(specialProjection.z) > 1) {
        badge.hidden = leader.hidden = true;
        continue;
      }
      const x = (specialProjection.x + 1) * rect.width / 2;
      const y = (1 - specialProjection.y) * rect.height / 2;
      let placed = false;
      for (const [dx, dy] of badgeOffsets) {
        if (item.positionStatus === "solar-anchor" && dx === 0 && dy === 0) continue;
        const left = x + dx;
        const top = y + dy;
        if (left < 16 || left > rect.width - 16 || top < 16 || top > rect.height - 16) continue;
        const screenX = left + rect.left;
        const screenY = top + rect.top;
        const covers = (other) => screenX > other.left - 16 && screenX < other.right + 16
          && screenY > other.top - 16 && screenY < other.bottom + 16;
        if (obstacles.some(covers)) continue;
        if (used.some((point) => Math.abs(point.x - left) < 34 && Math.abs(point.y - top) < 34)) continue;
        used.push({ x: left, y: top });
        placed = true;
        badge.hidden = false;
        badge.classList.toggle("map3d-special-marker-selected", selected);
        badge.style.left = `${left}px`;
        badge.style.top = `${top}px`;
        leader.hidden = !dx && !dy;
        if (!leader.hidden) {
          leader.style.left = `${x}px`;
          leader.style.top = `${y}px`;
          leader.style.width = `${Math.hypot(dx, dy)}px`;
          leader.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
        }
        break;
      }
      if (!placed) badge.hidden = leader.hidden = true;
    }
  }

  let nextLabelLayout = 0;
  let lastLabelState = [];
  let galaxyFocus = null;
  const closeGalaxyZoom = 7;

  function layoutGalaxyLabels(mapZoom, filter) {
    const now = performance.now();
    if (now < nextLabelLayout) return;
    nextLabelLayout = now + 35;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const containerRect = container.getBoundingClientRect();
    const rotation = galaxyGroup.quaternion;
    const activeElement = document.activeElement;
    const state = [
      width, height, mapZoom, camera.position.x, camera.position.y, camera.position.z,
      rotation.x, rotation.y, rotation.z, rotation.w, galaxyCatalogRevision, activeGalaxyId,
      activeSystemView, pendingSystemId, activeSystem, selectedSpecialId, filter, activeElement,
      systemPointer?.x, systemPointer?.y, labelUnderPointer,
      ...Array.from(markerOverlays, (element) => element.hidden),
    ];
    if (state.length === lastLabelState.length && state.every((value, index) => value === lastLabelState[index])) return;
    lastLabelState = state;

    const overview = mapZoom < 1.3;
    const close = mapZoom >= closeGalaxyZoom;
    const specialFilter = isSpecialFilter(filter?.kind);
    const planetFilter = filter && !specialFilter;
    const solarFilter = ["probe", "historic-probe"].includes(filter?.kind);
    const selectedId = pendingSystemId ?? (specialFilter ? null : activeSystem);
    const candidates = [];
    let pointed = null;
    let pointerDistance = 16 ** 2;
    let center = null;
    let centerDistance = (Math.min(width, height) * 0.20) ** 2;
    let selected = null;
    let keyboard = null;
    let pointedLabel = null;
    if (!activeSystemView) {
      galaxyGroup.updateMatrixWorld();
      for (const marker of systemMeshes) {
        if (!isActiveMarker(marker)) continue;
        const { id, catalog, filterMatch, batchIndex } = marker.userData;
        const reference = id === "sol";
        const visibleInFilter = !filter || filterMatch || (reference && solarFilter);
        const hasFocus = visibleGalaxyLabels.get(marker) === activeElement;
        const hasPointer = marker === labelUnderPointer && !specialFilter;
        const inZoomRange = reference || (!overview && (!catalog || mapZoom >= 3.5));
        const visibleByDefault = visibleInFilter && (planetFilter || inZoomRange);
        const drawn = !catalog || batchIndex < catalogBatches.get(activeGalaxyId).points.geometry.drawRange.count;
        const eligibleTarget = !specialFilter && visibleInFilter && drawn && (systemPointer || close);
        if (!visibleByDefault && !eligibleTarget && id !== selectedId && !hasFocus && !hasPointer) continue;

        markerWorldPosition(marker, labelProjection).project(camera);
        if (Math.abs(labelProjection.x) >= 1 || Math.abs(labelProjection.y) >= 1 || Math.abs(labelProjection.z) >= 1) continue;
        const x = (labelProjection.x + 1) * width / 2;
        const y = (1 - labelProjection.y) * height / 2;
        const distance = (x - width / 2) ** 2 + (y - height / 2) ** 2;
        const distanceToPointer = eligibleTarget && systemPointer
          ? (x - systemPointer.x) ** 2 + (y - systemPointer.y) ** 2 : Infinity;
        // A small bias keeps a centered target from flickering between adjacent points.
        const distanceToCenter = eligibleTarget && close ? distance * (marker === galaxyFocus ? 0.78 : 1) : Infinity;
        const pointerMatch = distanceToPointer < pointerDistance;
        const centerMatch = distanceToCenter < centerDistance;
        if ((close || !visibleByDefault) && id !== selectedId && !hasFocus && !hasPointer && !pointerMatch && !centerMatch) continue;
        const candidate = { marker, reference, x, y, depth: labelProjection.z, distance };
        if (!close && visibleByDefault) candidates.push(candidate);
        if (id === selectedId) selected = candidate;
        if (hasFocus) keyboard = candidate;
        if (hasPointer) pointedLabel = candidate;
        if (pointerMatch) {
          pointerDistance = distanceToPointer;
          pointed = candidate;
        }
        if (centerMatch) {
          centerDistance = distanceToCenter;
          center = candidate;
        }
      }
    }

    const focus = (pendingSystemId && selected) || keyboard || pointedLabel || pointed || selected || center;
    galaxyFocus = focus?.marker ?? null;
    hoveredMarker = pointed?.marker ?? null;
    const limit = close ? 1 : overview && !planetFilter ? 2 : width < 640 ? 4 : 7;
    const ordered = focus ? [focus] : [];
    if (limit > 1) {
      candidates.sort((a, b) => Number(b.reference) - Number(a.reference) || a.distance - b.distance || a.depth - b.depth);
      ordered.push(...candidates);
    }
    const accepted = [];
    const reserved = width < 640
      ? [".map-controls", ".map-class-filters", ".map-filter-notice", ".filter-summary-panel", ".map3d-system-controls"]
        .flatMap((selector) => [...document.querySelectorAll(selector)])
        .filter((element) => !element.hidden && getComputedStyle(element).display !== "none")
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left - containerRect.left, right: rect.right - containerRect.left, top: rect.top - containerRect.top, bottom: rect.bottom - containerRect.top };
        })
      : [];
    const next = new Set();
    for (const candidate of ordered) {
      if (accepted.length >= limit) break;
      const { marker } = candidate;
      const focused = marker === galaxyFocus;
      if (next.has(marker)) continue;
      if (!focused && focus && Math.hypot(candidate.x - focus.x, candidate.y - focus.y) < 108) continue;
      const compact = width < 640;
      const labelWidth = Math.min(focused ? (compact ? 220 : 198) : (compact ? 188 : 170), 14 + marker.userData.text.length * (focused ? (compact ? 8.8 : 8) : (compact ? 8 : 7)), width - 32);
      const labelHeight = focused ? (compact ? 34 : 26) : (compact ? 28 : 20);
      const offset = focused ? 18 : 14;
      const verticalCenter = THREE.MathUtils.clamp(candidate.y - labelHeight / 2, 2, height - labelHeight - 2);
      const placements = [
        { left: candidate.x + offset, top: verticalCenter },
        { left: candidate.x - labelWidth - offset, top: verticalCenter },
        { left: candidate.x - labelWidth / 2, top: candidate.y - labelHeight - offset },
        { left: candidate.x - labelWidth / 2, top: candidate.y + offset },
      ];
      const boundsFor = ({ left, top }) => ({ left, right: left + labelWidth, top, bottom: top + labelHeight });
      const collides = (bounds, other) => bounds.left < other.right + 6 && bounds.right > other.left - 6
        && bounds.top < other.bottom + 4 && bounds.bottom > other.top - 4;
      const bounds = placements.map(boundsFor).find((item) => item.left >= 4 && item.right <= width - 4
        && item.top >= 2 && item.bottom <= height - 2
        && !accepted.some((other) => collides(item, other))
        && !reserved.some((other) => collides(item, other)));
      if (!bounds) continue;
      const { left, top } = bounds;
      let label = visibleGalaxyLabels.get(marker);
      if (!label) {
        label = document.createElement("button");
        label.type = "button";
        label.className = "map3d-label map3d-galaxy-label map3d-star-label";
        label.dataset.systemId = marker.userData.id;
        const text = document.createElement("span");
        text.textContent = marker.userData.text;
        label.appendChild(text);
        label.title = `${marker.userData.text} · ${marker.userData.title}`;
        label.addEventListener("pointerenter", () => { labelUnderPointer = marker; });
        label.addEventListener("pointerleave", () => {
          if (labelUnderPointer === marker) labelUnderPointer = null;
        });
        label.addEventListener("pointerdown", (event) => event.stopPropagation());
        label.addEventListener("click", (event) => {
          event.stopPropagation();
          navigateToSystem(marker.userData.id);
        });
        container.appendChild(label);
        visibleGalaxyLabels.set(marker, label);
      }
      label.classList.toggle("map3d-galaxy-label-priority", focused);
      label.style.left = `${left}px`;
      label.style.top = `${top}px`;
      label.style.width = `${labelWidth}px`;
      label.style.setProperty("--marker-x", `${candidate.x - left}px`);
      label.style.setProperty("--marker-y", `${candidate.y - top}px`);
      label.style.setProperty("--system-marker-color", marker.userData.filterMatch && filter ? "#b8f93a" : marker.userData.id === "sol" ? "#ffda87" : "#aeeaff");
      accepted.push(bounds);
      next.add(marker);
    }
    for (const [marker, label] of visibleGalaxyLabels) {
      if (next.has(marker)) continue;
      if (labelUnderPointer === marker) labelUnderPointer = null;
      label.remove();
      visibleGalaxyLabels.delete(marker);
    }
    layoutSpecialMarkers(filter);
  }

  function resize() {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  // La UI esistente aggiorna zoom/panX/panY per la mappa DOM. Applica gli
  // stessi valori alla camera, così rotella, pulsanti e trascinamento
  // continuano a funzionare anche con il canvas Three.js.
  function syncCameraToMapControls() {
    const mapZoom = typeof zoom === "number" ? zoom : 0.2;
    const mapPanX = typeof panX === "number" ? panX : 0;
    const mapPanY = typeof panY === "number" ? panY : 0;
    const focus = activeSystemView ? systemGroup.localToWorld(systemCameraTarget.clone()) : galaxyGroup.localToWorld(mapCameraTarget.clone());
    const cameraDistance = cameraBaseDistance * (3 / mapZoom);
    const worldUnitsPerPixel =
      (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * cameraDistance) /
      Math.max(1, container.clientHeight);
    focus.x -= mapPanX * worldUnitsPerPixel;
    focus.y += mapPanY * worldUnitsPerPixel;
    camera.position.set(focus.x, focus.y, focus.z + cameraDistance);
    camera.lookAt(focus);
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  window.addEventListener("resize", resize);
  resize();

  let frame;
  function render() {
    frame = requestAnimationFrame(render);
    syncCameraToMapControls();
    const mapZoom = typeof zoom === "number" ? zoom : 3;
    starfield.rotation.y += 0.000025;
    const time = performance.now() / 1000;
    const currentFilter = typeof activeMapFilter === "undefined" ? null : activeMapFilter;
    const filterActive = Boolean(currentFilter);
    const pulseWave = (phase = 0) => 0.5 + 0.5 * Math.sin(time * 4.2 + phase);
    if (mapTravel) {
      const progress = Math.min(1, (performance.now() - mapTravel.start) / mapTravel.duration);
      const eased = progress * progress * (3 - 2 * progress);
      mapCameraTarget.lerpVectors(mapTravel.from, mapTravel.to, eased);
      zoom = Math.exp(Math.log(mapTravel.startZoom) + (Math.log(mapTravel.endZoom) - Math.log(mapTravel.startZoom)) * eased);
      if (zoomLabel) zoomLabel.textContent = `${zoom.toFixed(2)}×`;
      if (progress >= 1) {
        mapCameraTarget.copy(mapTravel.to);
        mapTravel = null;
      }
    }
    if (shipFlight) {
      const progress = Math.min(1, (performance.now() - shipFlight.start) / shipFlight.duration);
      const eased = progress * progress * (3 - 2 * progress);
      ship.position.lerpVectors(shipFlight.from, shipFlight.to, eased);
      ship.position.y += Math.sin(progress * Math.PI) * Math.min(0.8, shipFlight.from.distanceTo(shipFlight.to) * 0.16);
      ship.rotation.y += 0.015;
      if (progress >= 1) {
        shipFlight = null;
        if (pendingSystemId) {
          enterSystemView(pendingSystemId, true);
        } else if (pendingSpecialId) {
          const item = specialObjects.find((candidate) => candidate.id === pendingSpecialId);
          pendingSpecialId = null;
          if (item?.objectType === "blackhole" && typeof openBlackHole === "function") openBlackHole(item.id);
          if (item?.objectType === "probe" && typeof openProbe === "function") openProbe(item.id);
        }
      }
    }
    for (const body of systemBodies) {
      if (body.mesh.userData.orbitRadius) {
        const angle = body.mesh.userData.phase + time * body.mesh.userData.speed;
        body.orbitGroup.position.set(
          Math.cos(angle) * body.mesh.userData.orbitRadius,
          Math.sin(angle) * body.mesh.userData.orbitRadius,
          0
        );
        body.mesh.rotation.y += body.mesh.userData.spinSpeed;
        if (body.hitMesh) body.hitMesh.position.copy(body.orbitGroup.position);
      }
      if (body.planet) {
        const bodyFilterable = filterActive && !["probe", "historic-probe", "blackhole"].includes(currentFilter.kind);
        const bodyMatches = bodyFilterable && typeof planetMatchesMapFilter === "function" && planetMatchesMapFilter(body.planet, currentFilter.kind);
        const pulse = pulseWave(body.mesh.userData.phase || 0);
        body.mesh.material.transparent = true;
        body.mesh.material.opacity = !bodyFilterable || bodyMatches ? 1 : 0.28;
        body.mesh.material.emissive.set(bodyMatches ? 0x73ffad : 0x000000);
        body.mesh.material.emissiveIntensity = bodyMatches ? 0.65 + pulse * 0.95 : 0;
      }
      if (body.label) {
        const worldPosition = body.mesh.getWorldPosition(new THREE.Vector3());
        const projected = worldPosition.project(camera);
        const visible = projected.z > -1 && projected.z < 1;
        body.label.style.display = visible ? "block" : "none";
        if (visible) {
          body.label.style.left = `${(projected.x * 0.5 + 0.5) * container.clientWidth}px`;
          body.label.style.top = `${(-projected.y * 0.5 + 0.5) * container.clientHeight}px`;
        }
      }
    }
    const localZoomFade = THREE.MathUtils.smoothstep(mapZoom, 0.24, 1.15);
    const galaxyCameraDistance = cameraBaseDistance * (3 / Math.max(0.12, mapZoom));
    const markerScale = galaxyCameraDistance / 1725;
    for (const mesh of systemMeshes) {
      if (!mesh.isMesh || !isActiveMarker(mesh)) continue;
      const distanceFromCamera = camera.position.distanceTo(mesh.getWorldPosition(new THREE.Vector3()));
      const localProximity = 1 - THREE.MathUtils.smoothstep(distanceFromCamera, 90, 520);
      const matched = filterActive && mesh.userData.filterMatch;
      const dimOpacity = filterActive && !mesh.userData.filterMatch ? 0.16 : 1;
      const pulse = matched ? pulseWave(String(mesh.userData.id || "").length) : 0;
      const lodOpacity = (0.14 + 0.86 * localZoomFade * localProximity) * dimOpacity * (matched ? 0.78 + pulse * 0.22 : 1);
      mesh.material.opacity = lodOpacity;
      mesh.material.emissiveIntensity = mesh === hoveredMarker ? mesh.userData.starVisuals.emissive * 1.45 : mesh.userData.starVisuals.emissive * (matched ? 1.1 + pulse * 0.9 : dimOpacity);
      for (const decoration of mesh.userData.systemDecorations) {
        decoration.visible = mesh.visible;
        decoration.material.opacity = decoration.userData.baseOpacity * lodOpacity * (matched ? 1 + pulse * 0.55 : 1);
        const size = decoration.userData.baseSize * markerScale * (matched ? 1 + pulse * 0.2 : 1);
        decoration.scale.set(size, size, 1);
      }
    }
    const batch = catalogBatches.get(activeGalaxyId);
    if (batch) {
      const specialFilter = isSpecialFilter(currentFilter?.kind);
      const cap = filterActive && !specialFilter ? batch.markers.length : mapZoom < 1.3 ? 85 : mapZoom < 3 ? 850 : batch.markers.length;
      batch.points.geometry.setDrawRange(0, cap);
      batch.points.material.size = mapZoom < 1.3 ? 4.5 : 5.5;
      batch.points.material.opacity = specialFilter ? 0.22 : mapZoom >= closeGalaxyZoom && galaxyFocus ? 0.29 : mapZoom < 1.3 ? 0.63 : 0.82;
    }
    layoutGalaxyLabels(mapZoom, currentFilter);
    const macroFade = activeSystemView ? 0 : 1 - THREE.MathUtils.smoothstep(typeof zoom === "number" ? zoom : 3, 0.35, 1.35);
    macroGalaxy.material.opacity += (macroFade * 0.73 - macroGalaxy.material.opacity) * 0.08;
    macroGalaxy.visible = macroGalaxy.material.opacity > 0.015;
    starfield.material.opacity = (mapZoom < 1.3 ? 0.21 : 0.11) - macroGalaxy.material.opacity * 0.07;
    renderer.render(scene, camera);
  }
  render();

  // Rilascia renderer, texture ed etichette quando la pagina viene chiusa.
  window.addEventListener("pagehide", () => {
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    clearSystemGroup();
    renderer.dispose();
    starGeometry.dispose();
    macroGeometry.dispose();
    macroGalaxy.material.dispose();
    starfield.material.dispose();
    glowTexture.dispose();
    markerTexture.dispose();
    container.querySelectorAll(".map3d-label").forEach((label) => label.remove());
    viewControls.remove();
    disposeGalaxySystems();
    for (const { userData } of specialMeshes) {
      userData.badge.remove();
      userData.leader.remove();
    }
  }, { once: true });
});
