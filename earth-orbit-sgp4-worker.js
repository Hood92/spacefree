/* SGP4 propagation runs off the rendering thread. Samples are sent back as
 * position and velocity arrays so the main thread can use bounded Hermite
 * interpolation between exact propagated states. */
const SATELLITE_JS_URL = "https://cdn.jsdelivr.net/npm/satellite.js@6.0.1/dist/satellite.min.js";
let satrecs = [];
let generation = 0;

try {
  importScripts(SATELLITE_JS_URL);
  if (!self.satellite?.json2satrec || !self.satellite?.propagate) {
    throw new Error("satellite.js API non disponibile nel worker");
  }
} catch (error) {
  self.postMessage({ type: "error", generation, message: error.message || "satellite.js non caricabile" });
}

function propagateAt(timeMs) {
  const positions = new Float64Array(satrecs.length * 3);
  const velocities = new Float64Array(satrecs.length * 3);
  positions.fill(Number.NaN);
  velocities.fill(Number.NaN);
  const date = new Date(timeMs);
  let propagated = 0;
  for (let index = 0; index < satrecs.length; index++) {
    const satrec = satrecs[index];
    if (!satrec) continue;
    try {
      const state = self.satellite.propagate(satrec, date);
      if (!state?.position || !state?.velocity) continue;
      const offset = index * 3;
      const values = [state.position.x, state.position.y, state.position.z,
        state.velocity.x, state.velocity.y, state.velocity.z];
      if (!values.every(Number.isFinite)) continue;
      positions[offset] = values[0];
      positions[offset + 1] = values[1];
      positions[offset + 2] = values[2];
      velocities[offset] = values[3];
      velocities[offset + 1] = values[4];
      velocities[offset + 2] = values[5];
      propagated++;
    } catch (_error) {
      // Keep invalid/decayed elements as NaN; never synthesize a position.
    }
  }
  return { timeMs, positions, velocities, propagated };
}

function sendSamples(type, samples, requestGeneration) {
  const transfers = [];
  for (const sample of samples) transfers.push(sample.positions.buffer, sample.velocities.buffer);
  self.postMessage({ type, generation: requestGeneration, samples }, transfers);
}

self.onmessage = (event) => {
  const message = event.data || {};
  try {
    if (message.type === "initialize") {
      generation = message.generation;
      satrecs = (message.objects || []).map((omm) => {
        try { return self.satellite.json2satrec(omm); }
        catch (_error) { return null; }
      });
      const start = propagateAt(message.startTimeMs);
      const next = propagateAt(message.startTimeMs + message.stepMs);
      sendSamples("initialized", [start, next], generation);
      return;
    }
    if (message.type === "sample" && message.generation === generation) {
      sendSamples("sample", [propagateAt(message.timeMs)], generation);
    }
  } catch (error) {
    self.postMessage({ type: "error", generation, message: error.message || "Errore SGP4 nel worker" });
  }
};
