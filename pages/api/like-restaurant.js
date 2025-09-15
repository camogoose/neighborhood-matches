// /pages/api/like-restaurant.js
// Next.js API route for "This=That — Restaurants"
// Works on Vercel as-is. Public, no auth. Safe mock data.
// Squarespace-friendly: includes permissive CORS for cross-origin requests.

function setCors(res) {
  // For testing, we allow all origins. If you want to lock this down later,
  // replace '*' with your domain, e.g. 'https://www.thisplaceisjustlikethatplace.com'
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(res);

  // Handle preflight quickly
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const thisInput = body?.this || {};
    const thatInput = body?.that || {};

    const thisName = (thisInput.name || '').trim();
    const thatArea = (thatInput.area || '').trim();

    if (!thisName || !thatArea) {
      return res.status(400).json({
        error: 'Missing fields',
        details: 'Provide this.name and that.area'
      });
    }

    // Optional lat/lng/address if you add autocomplete later:
    const thisLat = Number.isFinite(thisInput.lat) ? thisInput.lat : undefined;
    const thisLng = Number.isFinite(thisInput.lng) ? thisInput.lng : undefined;
    const thisAddr = thisInput.address || undefined;

    // ---- MOCK MATCHER (replace with your real logic later) ----
    // We fabricate 3 plausible matches in the requested area with “why” blurbs.
    const q = (term) => encodeURIComponent(`${term} near ${thatArea}`);
    const matches = [
      {
        name: `Neighborhood Bistro • ${thatArea}`,
        fullAddress: `${thatArea}`,
        cityCountry: thatArea,
        website: '',
        mapUrl: `https://www.google.com/maps/search/?api=1&query=${q('bistro')}`,
        why: `Similar vibe to “${thisName}”: casual atmosphere, mid-price mains, late hours.` +
             (thisLat && thisLng ? ` (Seeded by coordinates ${thisLat.toFixed(3)}, ${thisLng.toFixed(3)})` : '')
      },
      {
        name: `Classic Deli • ${thatArea}`,
        fullAddress: `${thatArea}`,
        cityCountry: thatArea,
        website: '',
        mapUrl: `https://www.google.com/maps/search/?api=1&query=${q('deli')}`,
        why: `Cuts, sandwiches, and counter service reminiscent of “${thisName}”.` +
             (thisAddr ? ` (Reference: ${thisAddr})` : '')
      },
      {
        name: `Chef’s Counter • ${thatArea}`,
        fullAddress: `${thatArea}`,
        cityCountry: thatArea,
        website: '',
        mapUrl: `https://www.google.com/maps/search/?api=1&query=${q('chef counter')}`,
        why: `Open-kitchen energy and a signature dish focus, like “${thisName}”.`
      }
    ];

    return res.status(200).json({ matches });
  } catch (err) {
    console.error('like-restaurant error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
