// /pages/api/like-restaurant.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' });
  }

  try {
    const { this: thisInput, that: thatInput } = req.body || {};
    const thisName = thisInput?.name?.trim();
    const thatArea = thatInput?.area?.trim();

    if (!thisName || !thatArea) {
      return res.status(400).json({ error: 'Missing fields: this.name and that.area are required.' });
    }

    // Placeholder matches (replace with real logic later)
    const sample = [
      {
        name: `Neighborhood Bistro • ${thatArea}`,
        cityCountry: thatArea,
        mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`bistro near ${thatArea}`)}`,
        why: `Similar vibe to “${thisName}”: casual, mid-price, late hours.`
      },
      {
        name: `Classic Deli • ${thatArea}`,
        cityCountry: thatArea,
        mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`deli near ${thatArea}`)}`,
        why: `Cuts and sandwiches reminiscent of “${thisName}”.`
      },
      {
        name: `Chef’s Counter • ${thatArea}`,
        cityCountry: thatArea,
        mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`chef counter near ${thatArea}`)}`,
        why: `Open kitchen energy like “${thisName}”.`
      }
    ];

    return res.status(200).json({ matches: sample });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}
