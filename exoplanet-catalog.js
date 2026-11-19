function rowsFromTap(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data) && Array.isArray(payload?.metadata)) {
    const columns = payload.metadata.map((item) => String(item.name).toLowerCase());
    return payload.data.map((values) => Object.fromEntries(columns.map((column, index) => [column, values[index]])));
  }
  return [];
}

function safeCatalogText(value, max = 180) {
  return String(value ?? "").replace(/[<>"'&\u0000-\u001f]/g, "").slice(0, max);
}

function catalogNumber(value) {
  return typeof value === "number" || (typeof value === "string" && value.trim()) ? Number(value) : NaN;
}

function hasCatalogPosition(row) {
  const ra = catalogNumber(row.ra);
  const dec = catalogNumber(row.dec);
  const distance = catalogNumber(row.sy_dist);
  return ra >= 0 && ra < 360 && Math.abs(dec) <= 90 && Number.isFinite(distance) && distance > 0;
}

function buildExoplanetSystems(payload) {
  const grouped = new Map();
  for (const row of rowsFromTap(payload)) {
    if (!row || typeof row !== "object") continue;
    const hostname = safeCatalogText(row.hostname, 80).trim();
    const planetName = safeCatalogText(row.pl_name, 90).trim();
    if (!hostname || !planetName) continue;
    if (!grouped.has(hostname)) grouped.set(hostname, { hostname, planets: [], row });
    const system = grouped.get(hostname);
    if (!hasCatalogPosition(system.row) && hasCatalogPosition(row)) system.row = row;
    const radius = catalogNumber(row.pl_rade);
    const mass = catalogNumber(row.pl_bmasse);
    const semiMajor = catalogNumber(row.pl_orbsmax);
    const period = catalogNumber(row.pl_orbper);
    const type = Number.isFinite(radius)
      ? radius < 1.6 ? "Esopianeta roccioso" : radius < 4 ? "Esopianeta · super-Terra" : radius < 8 ? "Esopianeta ghiacciato" : "Esopianeta gigante gassoso"
      : "Esopianeta confermato";
    const color = type.includes("roccioso") ? "#c99a72" : type.includes("gassoso") ? "#d9b078" : type.includes("ghiacciato") ? "#87c6d4" : "#ad9ee3";
    system.planets.push({
      name: planetName,
      color,
      type,
      diameter: [Number.isFinite(radius) ? `${radius.toFixed(2)} R⊕` : "", Number.isFinite(mass) ? `${mass.toFixed(2)} M⊕` : ""].filter(Boolean).join(" · ") || "Non misurati",
      year: Number.isFinite(period) ? `${period.toFixed(2)} giorni` : "Non noto",
      distance: Number.isFinite(semiMajor) ? `${semiMajor.toPrecision(3)} UA` : "Orbita non determinata",
      description: "Esopianeta confermato. Parametri osservativi dal NASA Exoplanet Archive; i valori non pubblicati restano indicati come non noti.",
    });
  }
  return [...grouped.values()].map(({ hostname, planets, row }, index) => {
    const slug = hostname.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || `system-${index + 1}`;
    const distance = catalogNumber(row.sy_dist);
    const lightYears = Number.isFinite(distance) ? (distance * 3.26156).toFixed(2) : "n.d.";
    const ra = catalogNumber(row.ra);
    const dec = catalogNumber(row.dec);
    return {
      id: `exo-${slug}`,
      galaxyId: "milky-way",
      dataSource: "nasa-exoplanet-archive",
      positionStatus: hasCatalogPosition(row) ? "catalog" : "unavailable",
      shortName: hostname,
      name: `${hostname}<span>.</span>`,
      description: `Sistema extrasolare con ${planets.length} pianet${planets.length === 1 ? "a confermato" : "i confermati"}, catalogato dal NASA Exoplanet Archive. Le orbite mostrate sono schematiche.`,
      distance: lightYears,
      distanceLy: Number.isFinite(distance) ? distance * 3.26156 : null,
      ra: Number.isFinite(ra) ? ra : null,
      dec: Number.isFinite(dec) ? dec : null,
      star: safeCatalogText(row.st_spectype || "Stella catalogata", 40),
      starType: "catalogata",
      count: String(planets.length).padStart(2, "0"),
      planets,
    };
  });
}

if (typeof module === "object" && module.exports) {
  module.exports = buildExoplanetSystems;
} else {
  window.buildExoplanetSystems = buildExoplanetSystems;
}
