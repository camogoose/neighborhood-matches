const text = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const keyPart = v => v.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
function cacheKey(place, region, priorities) {
  return JSON.stringify(['0.6.2', keyPart(place), keyPart(region), [...priorities].sort()]);
}

// Warm-instance optimization, NOT a durable cache or an account-wide spending limit.
function createResultCache({ max = 128, ttl = 21600000, maxActive = 2, now = Date.now } = {}) {
  const entries = new Map();
  let active = 0;
  return async (key, make) => {
    const hit = entries.get(key);
    if (hit && (hit.pending || hit.expires > now())) return hit.promise;
    if (hit) entries.delete(key);
    for (const [k, v] of entries) if (!v.pending && v.expires <= now()) entries.delete(k);
    if (active >= maxActive) throw Object.assign(new Error('Busy'), { code: 'BUSY' });
    if (entries.size >= max) {
      const oldest = [...entries].find(([, v]) => !v.pending);
      if (!oldest) throw Object.assign(new Error('Busy'), { code: 'BUSY' });
      entries.delete(oldest[0]);
    }
    active++;
    const entry = { pending: true, expires: 0 };
    entry.promise = Promise.resolve().then(make).then(value => {
      entry.pending = false;
      entry.expires = now() + ttl;
      return value;
    }, error => { entries.delete(key); throw error; }).finally(() => { active--; });
    entries.set(key, entry);
    return entry.promise;
  };
}

function normalizeResults(parsed) {
  if (!parsed || !Array.isArray(parsed.results)) throw new Error('Invalid result schema');
  const seen = new Set();
  const normalized = [];
  for (const r of parsed.results.slice(0, 3)) {
    if (!r || typeof r !== 'object') throw new Error('Invalid result');
    const match = text(r.match, 120), city = text(r.city, 120), region = text(r.region, 120);
    const blurb = text(r.blurb, 700);
    if (!match || !region || !blurb) throw new Error('Missing place details');
    const identity = JSON.stringify([match, city, region].map(keyPart));
    if (seen.has(identity)) continue;
    seen.add(identity);
    normalized.push({ rank: normalized.length + 1, match, city, region, blurb,
      whatMakesItSpecial: (Array.isArray(r.whatMakesItSpecial) ? r.whatMakesItSpecial : []).map(v => text(v, 240)).filter(Boolean).slice(0, 5),
      landmarks: (Array.isArray(r.landmarks) ? r.landmarks : []).filter(v => v && typeof v === 'object').map(v => ({ name: text(v.name, 80), why: text(v.why, 160) })).filter(v => v.name).slice(0, 3),
      tags: (Array.isArray(r.tags) ? r.tags : []).map(v => text(v, 40)).filter(Boolean).slice(0, 6),
      score: Number.isFinite(r.score) ? Math.max(0, Math.min(1, r.score)) : 0,
      source: 'openai' });
  }
  return normalized;
}
module.exports = { cacheKey, createResultCache, normalizeResults };
