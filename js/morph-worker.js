// Builds atlas morphs off the main thread.
import { computeMorph } from './atlas-morph.js';

self.onmessage = ({ data }) => {
  try {
    const r = computeMorph(data);
    self.postMessage({ key: data.key, ok: true, ...r }, r.frames.map(f => f.buffer));
  } catch (e) {
    self.postMessage({ key: data.key, ok: false, error: String((e && e.message) || e) });
  }
};
