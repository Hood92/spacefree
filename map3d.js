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
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 3000);
  camera.position.set(0, 0, 115);

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
    new THREE.PointsMaterial({ color: 0xc4dce8, size: 1.15, sizeAttenuation: true, transparent: true, opacity: 0.78 })
  );
  galaxyGroup.add(starfield);

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
      const t = (index + 0.5) / Math.max(1, entries.length);
      const y = 1 - 2 * t;
      const radius = Math.sqrt(Math.max(0, 1 - y * y));
      const angle = index * goldenAngle;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const color = id === "sol" || /G[0-9]/.test(data.star) ? 0xffd98a : /A[0-9]|F[0-9]/.test(data.star) ? 0x9bdcff : /K[0-9]/.test(data.star) ? 0xffad70 : 0xff817e;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(id === "sol" ? 1.35 : entries.length > 100 ? 0.58 : 0.82, 16, 12),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 })
      );
      mesh.position.set(x * 49, y * 36, z * 42);
      mesh.userData = { id, label: data.shortName };
      mesh.userData.catalogOnly = id.startsWith("exo-");
      galaxyGroup.add(mesh);
      systemMeshes.push(mesh);
      systemDecorations.push(mesh);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.position.copy(mesh.position);
      glow.scale.set(11, 11, 1);
      glow.userData.systemId = id;
      galaxyGroup.add(glow);
      systemDecorations.push(glow);

      const label = document.createElement("span");
      label.className = "map3d-label map3d-star-label";
      label.textContent = data.shortName;
      label.title = `${data.shortName} · ${data.distance} anni luce`;
      container.appendChild(label);
      mesh.userData.labelElement = label;
    });
  }
  rebuildGalaxySystems();

  const specialObjects = [
    ...(typeof mapObjects === "undefined" ? [] : mapObjects.map((item) => ({ ...item, objectType: "blackhole" }))),
    ...(typeof probes === "undefined" ? [] : probes.map((item) => ({ ...item, objectType: "probe" }))),
  ];
  specialObjects.forEach((item, index) => {
    const seed = [...item.id].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 7);
    const angle = (seed / 4294967296) * Math.PI * 2;
    const y = ((seed >>> 8) / 0x1000000) * 1.6 - 0.8;
    const radius = Math.sqrt(1 - y * y);
    const position = new THREE.Vector3(Math.cos(angle) * radius * 53, y * 39, Math.sin(angle) * radius * 43);
    const isBlackHole = item.objectType === "blackhole";
    const mesh = new THREE.Mesh(
      isBlackHole ? new THREE.SphereGeometry(1.5, 18, 14) : new THREE.OctahedronGeometry(1.45, 0),
      new THREE.MeshBasicMaterial({ color: isBlackHole ? 0x090711 : 0xb8f93a })
    );
    mesh.position.copy(position);
    mesh.userData = { id: item.id, objectType: item.objectType };
    galaxyGroup.add(mesh);
    specialMeshes.push(mesh);
    if (isBlackHole) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(2.7, 0.3, 8, 32),
        new THREE.MeshBasicMaterial({ color: 0xb78cff, transparent: true, opacity: 0.8 })
      );
      ring.position.copy(position);
      ring.rotation.x = Math.PI / 2.6;
      ring.userData.id = item.id;
      ring.userData.specialObject = true;
      galaxyGroup.add(ring);
      specialDecorations.push(ring);
    }
    const label = document.createElement("span");
    label.className = "map3d-label map3d-object-label";
    label.textContent = item.name;
    label.title = item.distance || item.status || item.name;
    container.appendChild(label);
    mesh.userData.labelElement = label;
    mesh.userData.objectIndex = index;
  });

  function syncSceneFilters() {
    const filter = typeof activeMapFilter === "undefined" ? null : activeMapFilter;
    for (const mesh of systemMeshes) mesh.visible = !filter || filter.matches.has(mesh.userData.id);
    for (const mesh of specialMeshes) mesh.visible = !filter || filter.matches.has(mesh.userData.id);
    for (const object of systemDecorations) {
      if (object.userData?.systemId) object.visible = !filter || filter.matches.has(object.userData.systemId);
    }
    for (const object of specialDecorations) object.visible = !filter || filter.matches.has(object.userData.id);
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
  viewControls.innerHTML = '<button type="button" class="map3d-back">← Mappa stellare</button><div class="map3d-system-heading"><strong></strong><small>VISTA SCHEMATICA · ORBITE E DISTANZE COMPRESSE</small></div>';
  container.appendChild(viewControls);
  const viewTitle = viewControls.querySelector("strong");
  viewControls.querySelector("button").addEventListener("click", showGalaxy);

  function showGalaxy() {
    activeSystemView = null;
    systemGroup.visible = false;
    clearSystemGroup();
    galaxyGroup.visible = true;
    cameraBaseDistance = 115;
    document.querySelector(".map-panel")?.classList.remove("system3d-view");
    container.querySelectorAll(".map3d-label").forEach((label) => {
      label.style.display = "";
    });
    if (typeof zoom === "number") zoom = 3;
    if (typeof panX === "number") panX = 0;
    if (typeof panY === "number") panY = 0;
  }

  function clearSystemGroup() {
    while (systemGroup.children.length) {
      const child = systemGroup.children[0];
      systemGroup.remove(child);
      child.traverse((object) => {
        object.geometry?.dispose();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
        else object.material?.dispose();
      });
    }
    container.querySelectorAll(".map3d-body-label, .map3d-no-planets").forEach((element) => element.remove());
    systemBodies.length = 0;
  }

  function enterSystemView(id) {
    const data = systems[id];
    if (!data) return;
    activeSystemView = id;
    clearSystemGroup();
    galaxyGroup.visible = false;
    systemGroup.visible = true;
    cameraBaseDistance = 190;
    camera.position.set(0, 0, cameraBaseDistance);
    camera.position.x = camera.position.y = 0;
    if (typeof zoom === "number") zoom = 3;
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
      const radius = isGiant ? 1.65 : isDwarf ? 0.58 : 0.95;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 28, 20),
        new THREE.MeshStandardMaterial({ color: planet.color || "#9bb8c6", roughness: 0.86, metalness: 0.02 })
      );
      const phase = index * 2.399;
      mesh.position.set(Math.cos(phase) * orbitRadius, Math.sin(phase) * orbitRadius, 0);
      mesh.userData = { orbitRadius, phase, speed: 0.42 / Math.sqrt(orbitRadius), planet, systemId: id };
      systemGroup.add(mesh);
      systemBodies.push({ mesh, planet, systemId: id });
      const label = document.createElement("span");
      label.className = "map3d-label map3d-body-label";
      label.textContent = planet.name;
      container.appendChild(label);
      systemBodies[systemBodies.length - 1].label = label;
    });

    const emptyLabel = document.createElement("span");
    emptyLabel.className = "map3d-no-planets";
    emptyLabel.textContent = data.planets?.length ? "" : "Nessun pianeta confermato nel catalogo attuale.";
    emptyLabel.hidden = Boolean(data.planets?.length);
    container.appendChild(emptyLabel);
    systemBodies.emptyLabel = emptyLabel;
  }

  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 2;
  const pointer = new THREE.Vector2();
  renderer.domElement.addEventListener("click", (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    if (activeSystemView) {
      const hit = raycaster.intersectObjects(systemBodies.map((body) => body.mesh))[0];
      if (!hit) return;
      const body = systemBodies.find((item) => item.mesh === hit.object);
      if (body?.planet) {
        const card = [...document.querySelectorAll(".planet-card")].find((item) => item.dataset.planet === body.planet.name);
        card?.click();
      }
      return;
    }
    const hit = raycaster.intersectObjects(systemMeshes)[0];
    if (hit && typeof navigateToSystem === "function") {
      navigateToSystem(hit.object.userData.id);
      return;
    }
    const specialHit = raycaster.intersectObjects(specialMeshes)[0];
    if (!specialHit) return;
    const { id, objectType } = specialHit.object.userData;
    if (objectType === "blackhole" && typeof openBlackHole === "function") openBlackHole(id);
    else if (objectType === "probe" && typeof openProbe === "function") openProbe(id);
  });
  renderer.domElement.addEventListener("pointermove", (event) => {
    if (activeSystemView) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hovered = raycaster.intersectObjects(systemMeshes)[0]?.object || null;
    for (const mesh of systemMeshes) mesh.userData.hovered = mesh === hovered;
  });
  renderer.domElement.addEventListener("pointerleave", () => {
    for (const mesh of systemMeshes) mesh.userData.hovered = false;
  });
  window.addEventListener("map3d-open-system", (event) => enterSystemView(event.detail?.id));
  window.addEventListener("map3d-show-galaxy", showGalaxy);

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
    const mapZoom = typeof zoom === "number" ? zoom : 3;
    const mapPanX = typeof panX === "number" ? panX : 0;
    const mapPanY = typeof panY === "number" ? panY : 0;
    camera.position.z = cameraBaseDistance * (3 / mapZoom);
    const worldUnitsPerPixel =
      (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z) /
      Math.max(1, container.clientHeight);
    camera.position.x = -mapPanX * worldUnitsPerPixel;
    camera.position.y = mapPanY * worldUnitsPerPixel;
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  window.addEventListener("resize", resize);
  resize();

  let frame;
  function render() {
    frame = requestAnimationFrame(render);
    syncCameraToMapControls();
    starfield.rotation.y += 0.000025;
    const time = performance.now() / 1000;
    for (const body of systemBodies) {
      if (body.mesh.userData.orbitRadius) {
        const angle = body.mesh.userData.phase + time * body.mesh.userData.speed;
        body.mesh.position.x = Math.cos(angle) * body.mesh.userData.orbitRadius;
        body.mesh.position.y = Math.sin(angle) * body.mesh.userData.orbitRadius;
      }
      if (body.label) {
        const projected = body.mesh.position.clone().project(camera);
        const visible = projected.z > -1 && projected.z < 1;
        body.label.style.display = visible ? "block" : "none";
        if (visible) {
          body.label.style.left = `${(projected.x * 0.5 + 0.5) * container.clientWidth}px`;
          body.label.style.top = `${(-projected.y * 0.5 + 0.5) * container.clientHeight}px`;
        }
      }
    }
    for (const mesh of systemMeshes) {
      const projected = mesh.position.clone().project(camera);
      const visible = projected.z > -1 && projected.z < 1 && (!mesh.userData.catalogOnly || mesh.userData.hovered);
      mesh.userData.labelElement.style.display = visible ? "block" : "none";
      if (visible) {
        mesh.userData.labelElement.style.left = `${(projected.x * 0.5 + 0.5) * container.clientWidth}px`;
        mesh.userData.labelElement.style.top = `${(-projected.y * 0.5 + 0.5) * container.clientHeight}px`;
      }
    }
    for (const mesh of specialMeshes) {
      const projected = mesh.position.clone().project(camera);
      const visible = mesh.visible && projected.z > -1 && projected.z < 1;
      mesh.userData.labelElement.style.display = visible ? "block" : "none";
      if (visible) {
        mesh.userData.labelElement.style.left = `${(projected.x * 0.5 + 0.5) * container.clientWidth}px`;
        mesh.userData.labelElement.style.top = `${(-projected.y * 0.5 + 0.5) * container.clientHeight}px`;
      }
    }
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
