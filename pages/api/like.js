// /pages/api/like.js
export default async function handler(req, res) {
  // --- Allow CORS so Squarespace can fetch this API ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { place, region } = parseBody(req);

    // If missing input, return empty list
    if (!place || !region) {
      return res.status(200).json({ ok: true, results: [] });
    }

    // Build matches (replace with your real logic)
    const results = await getMatches(place, region);

    // Send back results
    res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error(err);
    // Always return 200 so the front-end doesn't treat as a network error
    res.status(200).json({ ok: false, error: err.message });
  }
}

function parseBody(req) {
  if (req.method === "POST") {
    try {
      if (typeof req.body === "string") return JSON.parse(req.body);
      return req.body || {};
    } catch {
      return {};
    }
  }
  return req.query || {};
}

// Stub matching logic (replace with real algorithm / DB lookup)
async function getMatches(place, region) {
  return [
    {
      match: place,
      city: region,
      region: "",
      blurb: `Neighborhoods in ${region} that feel like ${place}.`,
      whatMakesItSpecial: ["Walkability", "Cafés", "Boutiques"],
      landmarks: [{ name: "Main Square", why: "Cultural hub" }],
      tags: ["prototype"],
      news: {
        title: "Travel piece about this area",
        url: "https://example.com/travel-piece",
        snippet: "Great vibes and food culture."
      }
    }
  ];
}
