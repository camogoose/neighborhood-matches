const { createHash } = require('node:crypto');
const MAX_BYTES = 20 * 1024;
const ID_PATTERN = /^[a-f0-9]{24}$/;
function invalid() { const e = new Error('Invalid shared results.'); e.status = 400; throw e; }
function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) invalid();
  return value;
}
function list(value, max, fn) {
  if (!Array.isArray(value) || value.length > max) invalid();
  return value.map(fn);
}
function snapshot(value) {
  if (!value || value.v !== 1 || !Array.isArray(value.results) || !value.results.length) invalid();
  const out = {
    v: 1, place: text(value.place, 120, true), region: text(value.region, 120, true),
    priorities: list(value.priorities || [], 3, x => text(x, 60)),
    results: list(value.results, 3, r => {
      if (!r || typeof r !== 'object') invalid();
      let news = null;
      if (r.news) {
        const url = text(r.news.url, 2048, true);
        try { if (!['https:', 'http:'].includes(new URL(url).protocol)) invalid(); } catch { invalid(); }
        news = { title: text(r.news.title || '', 500), url, snippet: text(r.news.snippet || '', 1500) };
      }
      return { rank: Number.isInteger(r.rank) && r.rank >= 0 && r.rank <= 3 ? r.rank : invalid(),
        match: text(r.match, 200, true), city: text(r.city || '', 200), region: text(r.region, 200, true),
        blurb: text(r.blurb, 3000, true),
        whatMakesItSpecial: list(r.whatMakesItSpecial || [], 5, x => text(x, 600)),
        landmarks: list(r.landmarks || [], 3, x => ({ name: text(x?.name, 300), why: text(x?.why, 1000) })),
        tags: list(r.tags || [], 6, x => text(x, 100)), news };
    })
  };
  if (Buffer.byteLength(JSON.stringify(out)) > MAX_BYTES) invalid();
  return out;
}
// Immutable, deduplicated records. No expiry or eviction of old links.
// Redis executes this atomically, so parallel creates cannot exceed the caps.
const SAVE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 'EXISTS' end
local count = tonumber(redis.call('GET', KEYS[2]) or '0')
local bytes = tonumber(redis.call('GET', KEYS[3]) or '0')
local daily = tonumber(redis.call('GET', KEYS[4]) or '0')
if count >= 20000 or bytes + string.len(ARGV[1]) > 100663296 then return 'FULL' end
if daily >= 500 then return 'LIMIT' end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('INCR', KEYS[2])
redis.call('INCRBY', KEYS[3], string.len(ARGV[1]))
redis.call('INCR', KEYS[4])
redis.call('EXPIRE', KEYS[4], 172800)
return 'CREATED'
`;
function createShareStore({ url, token, fetchImpl = fetch, now = () => new Date() }) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.upstash.io') || endpoint.username || endpoint.password) throw new Error('Invalid storage configuration');
  async function command(args) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetchImpl(endpoint.origin, { method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args), signal: controller.signal });
      if (!response.ok) throw new Error('Storage unavailable');
      const body = await response.json();
      if (body.error || !Object.prototype.hasOwnProperty.call(body, 'result')) throw new Error('Storage unavailable');
      return body.result;
    } finally { clearTimeout(timer); }
  }
  return {
    async save(input) {
      const json = JSON.stringify(snapshot(input));
      const id = createHash('sha256').update(json).digest('hex').slice(0, 24);
      const prefix = '{shares-v1}:';
      const result = await command(['EVAL', SAVE_SCRIPT, 4, prefix + id, prefix + 'count', prefix + 'bytes',
        prefix + 'day:' + now().toISOString().slice(0, 10), json]);
      if (result === 'FULL' || result === 'LIMIT') {
        const e = new Error('New short links are temporarily unavailable. Existing links are unchanged.'); e.status = 429; throw e;
      }
      if (!['CREATED', 'EXISTS'].includes(result)) throw new Error('Storage unavailable');
      return id;
    },
    async get(id) {
      if (!ID_PATTERN.test(id)) invalid();
      const json = await command(['GET', '{shares-v1}:' + id]);
      if (json === null) return null;
      return snapshot(JSON.parse(json));
    }
  };
}
module.exports = { snapshot, createShareStore, SAVE_SCRIPT, ID_PATTERN };
