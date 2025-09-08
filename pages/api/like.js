// pages/api/like.js

export const config = {
  // Force Node.js runtime (not Edge)
  runtime: 'nodejs',
  api: { bodyParser: true },
};

function setCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); // swap '*' for your Squarespace domain later
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const MOCK_SUGGESTIONS = {
  germany: [
    { neighborhood: 'Kreuzberg', city: 'Berlin', score: 0.87 },
    { neighborhood: 'Schanzenviertel', city: 'Hamburg', score: 0.82 },
    { neighborhood: 'Belgisches Viertel', city: 'Cologne', score: 0.78 },
  ],
  london: [
    { neighborhood: 'Shoreditch', city: 'London', score: 0.86 },
    { neighborhood: 'Dalston', city: 'London', score: 0.81 },
    { neighborhood: 'Peckham', city: 'London', score: 0.77 },
  ],
  florida: [
    { neighborhood: 'Wynwood', city: 'Miami', score: 0.84 },
    { neighborhood: 'Ybor City', city: 'Tampa', score: 0.80 },
    { neighborhood: 'Downtown', city: 'St. Petersburg', score: 0.76 },
  ],
  default: [
    { neighborhood: 'Arts District', city: 'Example City', score: 0.75 },
    { neighborhood: 'Riverside', city: 'Example City', score: 0.72 },
    { neighborhood: 'Warehouse Row', city: 'Example City', score: 0.70 },
  ],
};

export default function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      service: 'This Is Just Like That',
      version: '0.1.0',
    });
  }

  if (req.method === 'POST') {
    try {
      const { place, region } = req.body || {};
      if (!place || !region) {
        return res
          .status(400)
          .json({ ok: false, error: 'Missing JSON: { "place": "...", "region": "..." }' });
      }

      const key = String(region).toLowerCase().trim();
      const list = MOCK_SUGGESTIONS[key] || MOCK_SUGGESTIONS.default;

      const results = list.slice(0, 3).map((r, i) => ({
        rank: i + 1,
        match: r.neighborhood,
        city: r.city,
        region: key,
        like: { place },
        source: 'mock',
        score: r.score,
      }));

      return res.status(200).json({
        ok: true,
        count: results.length,
        place,
        region,
        results,
      });
    } catch (err) {
      return res
        .status(500)
        .json({ ok: false, error: 'Server error', detail: String(err?.message || err) });
    }
  }

  res.setHeader('Allow', 'GET,POST,OPTIONS');
  return res.status(405).json({ ok: false, error: `Method ${req.method} Not Allowed` });
}
