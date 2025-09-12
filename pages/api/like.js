// /pages/api/like.js
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { place, region } = parseBody(req);

    if (!place || !region) {
      return res.status(200).json({ ok: true, results: [] });
    }

    const results = await getMatches(place, region);
    res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error(err);
    res.status(200).json({ ok: false, error: err.message });
  }
}

function parseBody(req) {
  if (req.method === "POST") {
    try {
      if (typeof req.body === "string") return JSON.parse(req.body);
      return req.body || {};
    } catch { return {}; }
  }
  return req.query || {};
}

// Simple stub until your real matcher is built
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
