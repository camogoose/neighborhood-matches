// /pages/api/like.js
// CORS + robust body parsing + tourismUrl enrichment + safe fallbacks

export default async function handler(req, res) {
  // --- CORS (Squarespace needs this) ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // --- Parse input; accept both {thisPlace,thatRegion} and {place,region} ---
    const { thisPlace, thatRegion, place, region } = parseBody(req);
    const src = (thisPlace || place || "").trim();
    const dst = (thatRegion || region || "").trim();

    // --- Health check: GET /api/like -> quick status ---
    if (req.method === "GET" && !src && !dst) {
      return res.status(200).json({ ok: true, message: "like API is up", expects: "{ thisPlace, thatRegion } or { place, region }" });
    }

    // --- Your real matcher goes here; keep it robust even if src/dst empty ---
    const matches = await getMatches({ src, dst });

    // --- Enrich with tourismUrl (best-effort, never throws) ---
    const enriched = await addTourismUrls(matches);

    return res.status(200).json({
      ok: true,
      thisPlace: src,
      thatRegion: dst,
      results: enriched
    });
  } catch (err) {
    console.error("like.js error:", err);
    return res.status(200).json({ ok: false, error: String(err?.message || err || "Server error") });
  }
}

function parseBody(req) {
  if (req.method === "POST") {
    try {
      if (typeof req.body === "string") return JSON.parse(req.body);
      if (req.body && typeof req.body === "object") return req.body;
    } catch {}
  }
  // also allow URL query strings for quick tests
  return req.query || {};
}

// ----------------------
// Example matcher (stub)
// Replace with your real logic; just keep the shape { name/city/region/... }
// ----------------------
async function getMatches({ src, dst }) {
  // Quick demo data so you can verify end-to-end even with empty inputs
  if (!src || !dst) {
    return [
      {
        match: "Narrowsburg",
        city: "Narrowsburg",
        region: "NY",
        blurb: "Delaware River hamlet with small-town arts vibes.",
        whatMakesItSpecial: ["River views", "Arts scene", "Walkable main street"],
        landmarks: [{ name: "Main Street", why: "Shops & galleries" }],
        tags: ["small-town", "river", "arts"]
      }
    ];
  }

  // TODO: swap in your real candidate generation
  return [
    {
      match: src,
      city: dst,
      region: "",
      blurb: `Places in ${dst} that feel like ${src}.`,
      whatMakesItSpecial: ["Vibes", "Walkability", "Food scene"],
      landmarks: [],
      tags: ["prototype"]
    }
  ];
}

// ----------------------
// Tourism URL enrichment
// ----------------------
async function addTourismUrls(list) {
  const out = [];
  for (const item of list || []) {
    const name = formatTitle(item);
    let tourismUrl = null;
    try {
      tourismUrl = await lookupTourismUrl(name);
    } catch {}
    out.push({ ...item, tourismUrl });
  }
  return out;
}

function formatTitle(item) {
  const parts = [];
  const m = (item?.match || "").trim();
  let c = (item?.city || "").trim();
  let r = (item?.region || "").trim();
  if (c && r && c.toLowerCase() === r.toLowerCase()) r = "";
  if (m) parts.push(m);
  if (c && (!m || !m.toLowerCase().includes(c.toLowerCase()))) parts.push(c);
  if (r) parts.push(r);
  return parts.join(", ");
}

async function lookupTourismUrl(placeName) {
  // Try Wikidata P856 (official website)
  const id = await wikidataSearchEntity(placeName);
  const p856 = await wikidataOfficialWebsite(id);
  if (p856) return p856;

  // Conservative heuristic fallbacks (non-blocking)
  const guess = await heuristicGuess(placeName);
  return guess || null;
}

async function wikidataSearchEntity(name) {
  if (!name) return null;
  const params = new URLSearchParams({
    action: "wbsearchentities", language: "en", format: "json",
    search: name, type: "item", limit: "5", origin: "*"
  });
  const r = await fetch(`https://www.wikidata.org/w/api.php?${params.toString()}`, {
    headers: { "User-Agent": "This=That/1.0 (Vercel)" }
  });
  if (!r.ok) return null;
  const data = await r.json();
  const candidates = (data?.search || []).map(c => ({
    id: c.id,
    label: c.label || "",
    desc: (c.description || "").toLowerCase()
  }));
  if (!candidates.length) return null;
  candidates.sort((a, b) => scoreDesc(b.desc) - scoreDesc(a.desc));
  return candidates[0].id;
}
function scoreDesc(d) {
  let s = 0;
  if (d.includes("city")) s += 3;
  if (d.includes("town")) s += 3;
  if (d.includes("village")) s += 3;
  if (d.includes("neighborhood") || d.includes("neighbourhood")) s += 3;
  if (d.includes("borough")) s += 2;
  if (d.includes("hamlet")) s += 2;
  if (d.includes("municipality")) s += 2;
  if (d.includes("district")) s += 1;
  return s;
}
async function wikidataOfficialWebsite(entityId) {
  if (!entityId) return null;
  const r = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(entityId)}.json`, {
    headers: { "User-Agent": "This=That/1.0 (Vercel)" }
  });
  if (!r.ok) return null;
  const data = await r.json();
  const ent = data?.entities?.[entityId];
  const p856 = ent?.claims?.P856;
  const url = Array.isArray(p856) ? p856[0]?.mainsnak?.datavalue?.value : null;
  return typeof url === "string" ? url : null;
}
async function heuristicGuess(placeName) {
  try {
    const token = (placeName || "").split(",")[0].trim().toLowerCase().replace(/\s+/g, "");
    if (!token || token.length < 3) return null;
    const candidates = [
      `https://www.${token}.gov`,
      `https://www.${token}.org`,
      `https://visit${token}.com`,
      `https://www.${token}tourism.com`
    ];
    for (const url of candidates) {
      try {
        const r = await fetch(url, { method: "HEAD" });
        if (r.ok) return url;
      } catch {}
    }
    return null;
  } catch { return null; }
}
