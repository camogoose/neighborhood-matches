import shareStore from '../../lib/share-store.cjs';
const { snapshot, createShareStore, ID_PATTERN } = shareStore;
export const config = { api: { bodyParser: { sizeLimit: '24kb' } } };
const origins = new Set(['https://thisplaceisjustlikethatplace.com', 'https://www.thisplaceisjustlikethatplace.com']);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');
  const origin = req.headers.origin;
  if (origin && !origins.has(origin)) return res.status(403).json({ ok: false, error: 'Origin not allowed.' });
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET,POST,OPTIONS');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }
  try {
    // Validate before contacting storage. CORS is not authentication or abuse protection.
    const value = req.method === 'POST' ? snapshot(req.body) : req.query.id;
    if (req.method === 'GET' && (typeof value !== 'string' || !ID_PATTERN.test(value))) {
      return res.status(400).json({ ok: false, error: 'Invalid share link.' });
    }
    if (process.env.SHARING_ENABLED !== 'true' || !process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      return res.status(503).json({ ok: false, error: 'Short-link sharing is not available yet.' });
    }
    const store = createShareStore({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
    if (req.method === 'POST') {
      const id = await store.save(value);
      return res.status(200).json({ ok: true, id, url: `https://www.thisplaceisjustlikethatplace.com/?share=${id}` });
    }
    const data = await store.get(value);
    if (!data) return res.status(404).json({ ok: false, error: 'This shared result could not be found. No new search was run.' });
    return res.status(200).json({ ok: true, snapshot: data });
  } catch (error) {
    const status = [400, 429].includes(error.status) ? error.status : 503;
    return res.status(status).json({ ok: false, error: status === 503 ? 'Shared results are temporarily unavailable. Please try again later.' : error.message });
  }
}
