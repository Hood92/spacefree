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
  scene.add(galaxyGroup);
  const starfield = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({ color: 0xc4dce8, size: 1.05, sizeAttenuation: true, transparent: true, opacity: 0.38, depthWrite: false })
  );
  galaxyGroup.add(starfield);

  // Spirale galattica procedurale: diventa protagonista quando la camera si allontana.
  const galaxyParticleCount = 18000;
  const galaxyPositions = new Float32Array(galaxyParticleCount * 3);
  const galaxyColors = new Float32Array(galaxyParticleCount * 3);
  const armColors = [new THREE.Color(0x68bfe8), new THREE.Color(0xc39cff), new THREE.Color(0xffc778)];
  for (let i = 0; i < galaxyParticleCount; i++) {
    const arm = i % 3;
    const radius = 22 + Math.pow(random(), 0.72) * 940;
    // L'orientamento grafico pone la posizione solare fra i bracci principali,
    // nella regione schematica del Braccio di Orione.
    const angle = arm * (Math.PI * 2 / 3) + radius * 0.012 - THREE.MathUtils.degToRad(110) + (random() - 0.5) * 0.34;
    galaxyPositions[i * 3] = Math.cos(angle) * radius;
    galaxyPositions[i * 3 + 1] = (random() - 0.5) * Math.max(3, 42 * (1 - radius / 1100));
    galaxyPositions[i * 3 + 2] = Math.sin(angle) * radius * 0.68;
    const color = armColors[arm].clone().lerp(new THREE.Color(0xffe7bd), random() * 0.42);
    galaxyColors[i * 3] = color.r;
    galaxyColors[i * 3 + 1] = color.g;
    galaxyColors[i * 3 + 2] = color.b;
  }
  const macroGeometry = new THREE.BufferGeometry();
  macroGeometry.setAttribute("position", new THREE.BufferAttribute(galaxyPositions, 3));
  macroGeometry.setAttribute("color", new THREE.BufferAttribute(galaxyColors, 3));
  const macroGalaxy = new THREE.Points(macroGeometry, new THREE.PointsMaterial({
    size: 1.75, sizeAttenuation: true, vertexColors: true, transparent: true,
    opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  macroGalaxy.rotation.x = -0.12;
  galaxyGroup.add(macroGalaxy);

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

  const systemMeshes = [];
  const systemDecorations = [];
  const specialMeshes = [];
  const specialDecorations = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

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
      SUN_GALACTIC_POSITION.y + galacticY * distance,
      SUN_GALACTIC_POSITION.z + galacticZ * distance
    );
  }

  function rebuildGalaxySystems() {
    for (const object of systemDecorations) {
      galaxyGroup.remove(object);
      object.geometry?.dispose();
      object.material?.dispose();
    }
    systemMeshes.length = 0;
    systemDecorations.length = 0;
    container.querySelectorAll(".map3d-star-label").forEach((label) => label.remove());
    const entries = Object.entries(systems);
    entries.forEach(([id, data], index) => {
      const distance = Number(String(data.distance || "0").replace(",", ".").match(/[0-9]+(?:\.[0-9]+)?/)?.[0] || 0);
      const hasSkyCoordinates = Number.isFinite(Number(data.ra)) && Number.isFinite(Number(data.dec)) && data.ra != null && data.dec != null;
      let position;
      if (id === "sol") {
        position = SUN_GALACTIC_POSITION.clone();
      } else if (hasSkyCoordinates) {
        position = galacticPositionFromCatalog(Number(data.ra), Number(data.dec), distance);
      } else {
        // I sistemi locali preesistenti non hanno RA/Dec nel catalogo statico:
        // si mostrano vicino al Sole in una disposizione dichiaratamente schematica.
        const hash = [...id].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 7);
        const angle = (hash / 4294967296) * Math.PI * 2;
        const y = (((hash >>> 8) / 0x1000000) * 2) - 1;
        const horizontal = Math.sqrt(1 - y * y);
        const localDistance = Math.max(2.2, distance * 1.55);
        position = SUN_GALACTIC_POSITION.clone().add(new THREE.Vector3(
          Math.cos(angle) * horizontal,
          y,
          Math.sin(angle) * horizontal
        ).multiplyScalar(localDistance));
      }
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
      const mesh = new THREE.Mesh(
        // Mantieni i nodi molto più piccoli delle distanze astronomiche:
        // alla scala galattica sfere grandi si sovrapporrebbero ai sistemi vicini.
        new THREE.SphereGeometry(starVisuals.radius, 20, 16),
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: starVisuals.emissive,
          transparent: true,
          opacity: 1,
          depthWrite: false,
          roughness: 0.38,
          metalness: 0.04,
        })
      );
      mesh.position.copy(position);
      mesh.userData = { id, label: data.shortName, distanceLy: distance, spectralClass, starVisuals, filterVisible: true };
      mesh.userData.systemDecorations = [];
      mesh.userData.catalogOnly = id.startsWith("exo-");
      galaxyGroup.add(mesh);
      systemMeshes.push(mesh);
      systemDecorations.push(mesh);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color, transparent: true, opacity: 0.62, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.position.copy(mesh.position);
      const glowSize = starVisuals.glow;
      glow.scale.set(glowSize, glowSize, 1);
      glow.userData.baseSize = glowSize;
      glow.userData.baseOpacity = 0.62;
      glow.userData.systemId = id;
      galaxyGroup.add(glow);
      systemDecorations.push(glow);
      mesh.userData.systemDecorations.push(glow);
      {
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTexture,
          color,
          transparent: true,
          opacity: 0.2,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }));
        halo.position.copy(mesh.position);
        const haloSize = starVisuals.halo;
        halo.scale.set(haloSize, haloSize, 1);
        halo.userData.baseSize = haloSize;
        halo.userData.baseOpacity = 0.2;
        halo.userData.systemId = id;
        galaxyGroup.add(halo);
        systemDecorations.push(halo);
        mesh.userData.systemDecorations.push(halo);
      }

      const label = document.createElement("span");
      label.className = "map3d-label map3d-star-label";
      label.textContent = data.shortName;
      label.title = hasSkyCoordinates
        ? `${data.shortName} · ${data.distance} anni luce · RA ${Number(data.ra).toFixed(3)}°, Dec ${Number(data.dec).toFixed(3)}°`
        : `${data.shortName} · ${data.distance} anni luce · coordinate schematiche`;
      container.appendChild(label);
      mesh.userData.labelElement = label;
      label.tabIndex = 0;
      label.setAttribute("role", "button");
      label.setAttribute("aria-label", `Viaggia verso ${data.shortName}`);
      label.addEventListener("click", (event) => {
        event.stopPropagation();
        if (typeof navigateToSystem === "function") navigateToSystem(id);
      });
      label.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          label.click();
        }
      });
    });
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
  mapOrbitToggle?.addEventListener("click", () => {
    const enabled = mapOrbitToggle.getAttribute("aria-pressed") !== "true";
    mapOrbitToggle.setAttribute("aria-pressed", String(enabled));
    mapOrbitToggle.setAttribute("aria-label", enabled ? "Disattiva rotazione touch e riattiva lo scorrimento" : "Attiva rotazione touch della mappa");
    renderer.domElement.style.touchAction = enabled ? "none" : "pan-y";
  });
  renderer.domElement.addEventListener("pointerdown", (event) => {
    if (event.button === 2) {
      event.preventDefault();
      event.stopPropagation();
      mapPanPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      renderer.domElement.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    if (event.pointerType === "touch" && mapOrbitToggle?.getAttribute("aria-pressed") !== "true") return;
    event.stopPropagation();
    mapRotationPointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    renderer.domElement.setPointerCapture(event.pointerId);
  });
  renderer.domElement.addEventListener("pointermove", (event) => {
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
    if (mapPanPointer?.id === event.pointerId) {
      mapPanPointer = null;
      return;
    }
    if (!mapRotationPointer || mapRotationPointer.id !== event.pointerId) return;
    suppressMapClick = mapRotationPointer.moved;
    mapRotationPointer = null;
  };
  renderer.domElement.addEventListener("pointerup", endMapRotation);
  renderer.domElement.addEventListener("pointercancel", endMapRotation);
  renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());

  const specialObjects = [
    ...(typeof mapObjects === "undefined" ? [] : mapObjects.map((item) => ({ ...item, objectType: "blackhole" }))),
    ...(typeof probes === "undefined" ? [] : probes.map((item) => ({ ...item, objectType: "probe" }))),
  ];
  specialObjects.forEach((item, index) => {
    const seed = [...item.id].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 7);
    const angle = (seed / 4294967296) * Math.PI * 2;
    const y = ((seed >>> 8) / 0x1000000) * 1.6 - 0.8;
    const radius = Math.sqrt(1 - y * y);
    const distanceText = String(item.distance || "");
    const distanceLy = item.objectType === "blackhole"
      ? Number(distanceText.replace(/[^0-9]/g, "") || 0)
      : Number(distanceText.replace(",", ".").match(/[0-9]+(?:\.[0-9]+)?/)?.[0] || 0);
    const localOffset = new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius)
      .multiplyScalar(distanceLy * GALACTIC_MAP_SCALE);
    const isBlackHole = item.objectType === "blackhole";
    const position = item.id === "bh-sgra"
      ? new THREE.Vector3(0, 0, 0)
      : isBlackHole
        ? SUN_GALACTIC_POSITION.clone().add(localOffset)
        : new THREE.Vector3(Math.cos(angle) * radius * 53, y * 39, Math.sin(angle) * radius * 43);
    const mesh = new THREE.Mesh(
      isBlackHole ? new THREE.SphereGeometry(0.08, 18, 14) : new THREE.OctahedronGeometry(0.12, 0),
      new THREE.MeshBasicMaterial({ color: isBlackHole ? 0x090711 : 0xb8f93a, transparent: true, opacity: 1 })
    );
    mesh.position.copy(position);
    mesh.userData = { id: item.id, objectType: item.objectType, filterVisible: true, filterMatch: true, baseColor: new THREE.Color(isBlackHole ? 0x090711 : 0xb8f93a), decorations: [] };
    galaxyGroup.add(mesh);
    specialMeshes.push(mesh);
    const specialGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture,
      color: isBlackHole ? 0xb78cff : 0xb8f93a,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    specialGlow.position.copy(position);
    specialGlow.userData = { id: item.id, baseOpacity: 0.78, baseSize: isBlackHole ? 7 : 5.5 };
    specialGlow.scale.set(specialGlow.userData.baseSize, specialGlow.userData.baseSize, 1);
    galaxyGroup.add(specialGlow);
    specialDecorations.push(specialGlow);
    mesh.userData.decorations.push(specialGlow);
    if (isBlackHole) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.16, 0.018, 8, 32),
        new THREE.MeshBasicMaterial({ color: 0xb78cff, transparent: true, opacity: 0.8 })
      );
      ring.position.copy(position);
      ring.rotation.x = Math.PI / 2.6;
      ring.userData.id = item.id;
      ring.userData.specialObject = true;
      ring.userData.baseOpacity = 0.8;
      galaxyGroup.add(ring);
      specialDecorations.push(ring);
      mesh.userData.decorations.push(ring);
    }
    const label = document.createElement("span");
    label.className = "map3d-label map3d-object-label";
    label.textContent = item.name;
    label.title = item.distance || item.status || item.name;
    container.appendChild(label);
    mesh.userData.labelElement = label;
    mesh.userData.objectIndex = index;
    label.tabIndex = 0;
    label.setAttribute("role", "button");
    label.setAttribute("aria-label", `Apri i dettagli di ${item.name}`);
    label.addEventListener("click", (event) => {
      event.stopPropagation();
      travelToSpecial(mesh, item);
    });
    label.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        label.click();
      }
    });
  });

  function syncSceneFilters() {
    const filter = typeof activeMapFilter === "undefined" ? null : activeMapFilter;
    for (const mesh of systemMeshes) {
      mesh.userData.filterVisible = true;
      mesh.userData.filterMatch = !filter || filter.matches.has(mesh.userData.id);
      mesh.visible = true;
    }
    for (const mesh of specialMeshes) {
      mesh.userData.filterVisible = true;
      mesh.userData.filterMatch = !filter || filter.matches.has(mesh.userData.id);
      mesh.visible = true;
    }
    for (const object of systemDecorations) {
      if (object.userData?.systemId) object.visible = true;
    }
    for (const object of specialDecorations) object.visible = true;
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
  viewControls.querySelector("button").addEventListener("click", showGalaxy);

  function showGalaxy(reset = false) {
    activeSystemView = null;
    systemGroup.visible = false;
    clearSystemGroup();
    galaxyGroup.visible = true;
    cameraBaseDistance = 115;
    if (reset) {
      galaxyGroup.rotation.set(0, 0, 0);
      const solarSystem = systemMeshes.find((mesh) => mesh.userData.id === "sol");
      if (solarSystem) mapCameraTarget.copy(solarSystem.position);
      mapTravel = null;
      shipFlight = null;
      pendingSystemId = null;
      pendingSpecialId = null;
    }
    document.querySelector(".map-panel")?.classList.remove("system3d-view");
    container.querySelectorAll(".map3d-label").forEach((label) => {
      label.style.display = "";
    });
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
      mesh.position.set(Math.cos(phase) * orbitRadius, Math.sin(phase) * orbitRadius, 0);
      mesh.userData = { orbitRadius, phase, speed: 0.42 / Math.sqrt(orbitRadius), planet, systemId: id };
      systemGroup.add(mesh);
      const hitMesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, colorWrite: false, depthWrite: false })
      );
      hitMesh.position.copy(mesh.position);
      hitMesh.scale.setScalar(Math.max(radius * 1.45, 2.2));
      hitMesh.userData.planetHitTarget = true;
      systemGroup.add(hitMesh);
      systemBodies.push({ mesh, hitMesh, planet, systemId: id, maps: planetMaps.maps });
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
    if (!systems[id] || !destination) return;
    pendingTravelSource = source;
    pendingTravelDetailDelayMs = detailDelayMs;
    pendingTravelPlanetName = planetName;
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
    pendingSpecialId = item.id;
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
  };

  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 2;
  const pointer = new THREE.Vector2();
  function findSystemHit(event) {
    const directHit = raycaster.intersectObjects(systemMeshes, false)[0]?.object;
    if (directHit) return directHit;
    const rect = renderer.domElement.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    let closest = null;
    let closestDistanceSquared = 15 * 15;
    let closestDepth = Infinity;
    for (const mesh of systemMeshes) {
      if (!mesh.userData.filterVisible) continue;
      const worldPosition = mesh.getWorldPosition(new THREE.Vector3());
      const projected = worldPosition.project(camera);
      if (projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1.08 || Math.abs(projected.y) > 1.08) continue;
      const screenX = (projected.x * 0.5 + 0.5) * rect.width;
      const screenY = (-projected.y * 0.5 + 0.5) * rect.height;
      const distanceSquared = (screenX - pointerX) ** 2 + (screenY - pointerY) ** 2;
      const depth = camera.position.distanceTo(worldPosition);
      if (distanceSquared < closestDistanceSquared || (Math.abs(distanceSquared - closestDistanceSquared) < 0.25 && depth < closestDepth)) {
        closest = mesh;
        closestDistanceSquared = distanceSquared;
        closestDepth = depth;
      }
    }
    return closest;
  }
  function findSpecialHit(event) {
    const directHit = raycaster.intersectObjects(specialMeshes, false)[0]?.object;
    if (directHit) return directHit;
    const rect = renderer.domElement.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    let closest = null;
    let closestDistanceSquared = 18 * 18;
    let closestDepth = Infinity;
    for (const mesh of specialMeshes) {
      if (!mesh.userData.filterVisible) continue;
      const worldPosition = mesh.getWorldPosition(new THREE.Vector3());
      const projected = worldPosition.project(camera);
      if (projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1.08 || Math.abs(projected.y) > 1.08) continue;
      const screenX = (projected.x * 0.5 + 0.5) * rect.width;
      const screenY = (-projected.y * 0.5 + 0.5) * rect.height;
      const distanceSquared = (screenX - pointerX) ** 2 + (screenY - pointerY) ** 2;
      const depth = camera.position.distanceTo(worldPosition);
      if (distanceSquared < closestDistanceSquared || (Math.abs(distanceSquared - closestDistanceSquared) < 0.25 && depth < closestDepth)) {
        closest = mesh;
        closestDistanceSquared = distanceSquared;
        closestDepth = depth;
      }
    }
    return closest;
  }
  function screenDistanceToMesh(event, mesh) {
    const rect = renderer.domElement.getBoundingClientRect();
    const projected = mesh.getWorldPosition(new THREE.Vector3()).project(camera);
    return Math.hypot(
      (projected.x * 0.5 + 0.5) * rect.width - (event.clientX - rect.left),
      (-projected.y * 0.5 + 0.5) * rect.height - (event.clientY - rect.top)
    );
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
    const directSystem = raycaster.intersectObjects(systemMeshes, false)[0];
    const directSpecial = raycaster.intersectObjects(specialMeshes, false)[0];
    if (directSystem && (!directSpecial || directSystem.distance <= directSpecial.distance)) {
      if (typeof navigateToSystem === "function") navigateToSystem(directSystem.object.userData.id);
      return;
    }
    if (directSpecial) {
      const item = specialObjects[directSpecial.object.userData.objectIndex];
      if (item) travelToSpecial(directSpecial.object, item);
      return;
    }
    const systemHit = findSystemHit(event);
    const specialHit = findSpecialHit(event);
    if (systemHit && (!specialHit || screenDistanceToMesh(event, systemHit) <= screenDistanceToMesh(event, specialHit))) {
      if (typeof navigateToSystem === "function") navigateToSystem(systemHit.userData.id);
      return;
    }
    if (!specialHit) return;
    const item = specialObjects[specialHit.userData.objectIndex];
    if (item) travelToSpecial(specialHit, item);
  });
  renderer.domElement.addEventListener("pointermove", (event) => {
    if (activeSystemView) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hovered = findSystemHit(event);
    for (const mesh of systemMeshes) mesh.userData.hovered = mesh === hovered;
  });
  renderer.domElement.addEventListener("pointerleave", () => {
    for (const mesh of systemMeshes) mesh.userData.hovered = false;
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
        body.mesh.position.x = Math.cos(angle) * body.mesh.userData.orbitRadius;
        body.mesh.position.y = Math.sin(angle) * body.mesh.userData.orbitRadius;
        if (body.hitMesh) body.hitMesh.position.copy(body.mesh.position);
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
    const occupiedLabelSlots = new Set();
    for (const mesh of systemMeshes) {
      const worldPosition = mesh.getWorldPosition(new THREE.Vector3());
      const projected = worldPosition.project(camera);
      const cameraDistance = camera.position.distanceTo(mesh.getWorldPosition(new THREE.Vector3()));
      const zoomFade = 0.58 + 0.42 * THREE.MathUtils.smoothstep(mapZoom, 0.2, 8);
      const proximityFade = 0.5 + 0.5 * (1 - THREE.MathUtils.smoothstep(cameraDistance, 200, 2400));
      const labelFilterFade = filterActive && !mesh.userData.filterMatch ? 0.18 : 1;
      const labelPulse = filterActive && mesh.userData.filterMatch ? 0.78 + pulseWave(mesh.userData.id.length) * 0.22 : 1;
      const labelFade = zoomFade * proximityFade * labelFilterFade * labelPulse;
      const screenX = (projected.x * 0.5 + 0.5) * container.clientWidth;
      const screenY = (-projected.y * 0.5 + 0.5) * container.clientHeight;
      const labelSlot = `${Math.round(screenX / 110)}:${Math.round(screenY / 28)}`;
      const inView = projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 1.08 && Math.abs(projected.y) < 1.08;
      const visible = mesh.visible && inView && labelFade > 0.02 && !occupiedLabelSlots.has(labelSlot);
      if (visible) occupiedLabelSlots.add(labelSlot);
      mesh.userData.labelElement.style.display = visible ? "block" : "none";
      mesh.userData.labelElement.style.opacity = String(labelFade);
      mesh.userData.labelElement.style.fontSize = `${8 + THREE.MathUtils.smoothstep(mapZoom, 0.2, 8) * 3}px`;
      if (visible) {
        mesh.userData.labelElement.style.left = `${screenX}px`;
        mesh.userData.labelElement.style.top = `${screenY}px`;
      }
    }
    const localZoomFade = THREE.MathUtils.smoothstep(mapZoom, 0.24, 1.15);
    const galaxyCameraDistance = cameraBaseDistance * (3 / Math.max(0.12, mapZoom));
    const markerScale = galaxyCameraDistance / 1725;
    for (const mesh of systemMeshes) {
      const distanceFromCamera = camera.position.distanceTo(mesh.getWorldPosition(new THREE.Vector3()));
      const localProximity = 1 - THREE.MathUtils.smoothstep(distanceFromCamera, 90, 520);
      const matched = filterActive && mesh.userData.filterMatch;
      const dimOpacity = filterActive && !mesh.userData.filterMatch ? 0.16 : 1;
      const pulse = matched ? pulseWave(String(mesh.userData.id || "").length) : 0;
      const lodOpacity = (0.14 + 0.86 * localZoomFade * localProximity) * dimOpacity * (matched ? 0.78 + pulse * 0.22 : 1);
      mesh.visible = mesh.userData.filterVisible;
      mesh.material.opacity = lodOpacity;
      mesh.material.emissiveIntensity = mesh.userData.hovered ? mesh.userData.starVisuals.emissive * 1.45 : mesh.userData.starVisuals.emissive * (matched ? 1.1 + pulse * 0.9 : dimOpacity);
      for (const decoration of mesh.userData.systemDecorations) {
        decoration.visible = mesh.visible;
        decoration.material.opacity = decoration.userData.baseOpacity * lodOpacity * (matched ? 1 + pulse * 0.55 : 1);
        const size = decoration.userData.baseSize * markerScale * (matched ? 1 + pulse * 0.2 : 1);
        decoration.scale.set(size, size, 1);
      }
    }
    for (const mesh of specialMeshes) {
      const worldPosition = mesh.getWorldPosition(new THREE.Vector3());
      const projected = worldPosition.project(camera);
      const distanceFromCamera = camera.position.distanceTo(worldPosition);
      const matched = filterActive && mesh.userData.filterMatch;
      const pulse = matched ? pulseWave(mesh.userData.objectIndex) : 0;
      const filterDim = filterActive && !mesh.userData.filterMatch ? 0.14 : 1;
      mesh.material.opacity = filterDim * (matched ? 0.72 + pulse * 0.28 : 1);
      for (const decoration of mesh.userData.decorations) {
        decoration.visible = true;
        decoration.material.opacity = decoration.userData.baseOpacity * filterDim * (matched ? 0.68 + pulse * 0.62 : 1);
        if (decoration.userData.baseSize) {
          const size = decoration.userData.baseSize * markerScale * (matched ? 1 + pulse * 0.28 : 1);
          decoration.scale.set(size, size, 1);
        }
        if (decoration.userData.specialObject) decoration.scale.setScalar(matched ? 0.9 + pulse * 0.45 : 1);
      }
      const proximityFade = 0.52 + 0.48 * (1 - THREE.MathUtils.smoothstep(distanceFromCamera, 220, 2600));
      const labelFilterFade = filterActive && !mesh.userData.filterMatch ? 0.15 : 1;
      const visible = projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 1.08 && Math.abs(projected.y) < 1.08 && !occupiedLabelSlots.has(`${Math.round(((projected.x * 0.5 + 0.5) * container.clientWidth) / 110)}:${Math.round(((-projected.y * 0.5 + 0.5) * container.clientHeight) / 28)}`);
      const labelFade = proximityFade * labelFilterFade * (matched ? 0.78 + pulse * 0.22 : 1);
      mesh.userData.labelElement.style.display = visible ? "block" : "none";
      mesh.userData.labelElement.style.opacity = String(labelFade);
      mesh.userData.labelElement.style.fontSize = `${8 + THREE.MathUtils.smoothstep(mapZoom, 0.2, 8) * 3}px`;
      if (visible) {
        const screenX = (projected.x * 0.5 + 0.5) * container.clientWidth;
        const screenY = (-projected.y * 0.5 + 0.5) * container.clientHeight;
        mesh.userData.labelElement.style.left = `${screenX}px`;
        mesh.userData.labelElement.style.top = `${screenY}px`;
        occupiedLabelSlots.add(`${Math.round(screenX / 110)}:${Math.round(screenY / 28)}`);
      }
    }
    const macroFade = activeSystemView ? 0 : 1 - THREE.MathUtils.smoothstep(typeof zoom === "number" ? zoom : 3, 0.35, 1.35);
    macroGalaxy.material.opacity += (macroFade * 0.58 - macroGalaxy.material.opacity) * 0.035;
    macroGalaxy.visible = macroGalaxy.material.opacity > 0.015;
    starfield.material.opacity = 0.34 - macroGalaxy.material.opacity * 0.12;
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
    container.querySelectorAll(".map3d-label").forEach((label) => label.remove());
    viewControls.remove();
    systemMeshes.forEach((mesh) => {
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
    specialMeshes.forEach((mesh) => {
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
    specialDecorations.forEach((object) => {
      object.geometry.dispose();
      object.material.dispose();
    });
  }, { once: true });
});
