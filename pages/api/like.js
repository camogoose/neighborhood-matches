// /pages/api/like.js
// Adds tourismUrl automatically using Wikidata (property P856 "official website").
// No keys required. Works server-side on Vercel. Safe if rate-limited: it just returns nulls.

export default async function handler(req, res) {
  try {
    // ================================
    // 1) Parse input
    // ================================
    const { thisPlace, thatRegion, refs } = parseBody(req);

    // ================================
    // 2) Your existing matching logic
    //    (stubbed here as an example)
    //    -> Make sure each match has a .name string at minimum
    // ================================
    const matches = await getMatches({ thisPlace, thatRegion, refs });

    // ================================
    // 3) Enrich each match with tourismUrl
    // ================================
    const enriched = await enrichWithTourismUrl(matches);

    // Return as usual, but now each item may include tourismUrl
    res.status(200).json({ ok: true, thisPlace, thatRegion, results: enriched });
  } catch (err) {
    console.error("like.js error:", err);
    res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}

/** Parse JSON body safely */
function parseBody(req) {
  if (req.method === "POST") {
    try {
      return typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    } catch {
      return {};
    }
  }
  // Allow GET for quick tests: /api/like?thisPlace=Soho&thatRegion=Denmark
  const { thisPlace, thatRegion, refs } = req.query || {};
  return { thisPlace, thatRegion, refs };
}

/** Stub: replace with your real matching logic that returns an array of { name, ... } */
async function getMatches({ thisPlace, thatRegion }) {
  // Example output shape (keep yours)
  // IMPORTANT: the "name" is what we query against for the tourism URL.
  return [
    { name: "Narrowsburg, NY", description: "Delaware River hamlet...", mapUrl: "" },
    // ...your real matches here
  ];
}

/** Add tourismUrl to each match by querying Wikidata for official website (P856). */
async function enrichWithTourismUrl(matches) {
  return Promise.all(
    (matches || []).map(async (m) => {
      const tourismUrl =
        (await lookupOfficialWebsiteViaWikidata(m.name)) ||
        (await heuristicTourismGuess(m.name)) ||
        null;

      return { ...m, tourismUrl };
    })
  );
}

/** Step 1: Find a Wikidata entity ID for the place name */
async function wikidataSearchEntity(name) {
  const params = new URLSearchParams({
    action: "wbsearchentities",
    language: "en",
    format: "json",
    search: name,
    origin: "*",
    // type= item narrows to items (not properties)
    type: "item",
    limit: "5",
  });

  const url = `https://www.wikidata.org/w/api.php?${params.toString()}`;
  const r = await fetch(url, { headers: { "User-Agent": "This=That/1.0 (Vercel)" } });
  if (!r.ok) return null;
  const data = await r.json();

  // Try to prefer items whose label or description includes common place words
  const candidates = (data?.search || []).filter(Boolean);
  if (!candidates.length) return null;

  // Lightweight ranking: prefer those with "city", "town", "neighborhood", "borough", "village" in the description
  const scored = candidates
    .map((c) => ({
      id: c.id,
      label: c.label || "",
      desc: (c.description || "").toLowerCase(),
      score: scoreDesc(c.description || "", name),
    }))
    .sort((a, b) => b.score - a.score);

  return scored[0]?.id || candidates[0]?.id || null;
}

function scoreDesc(desc, name) {
  const d = desc.toLowerCase();
  let s = 0;
  if (d.includes("city")) s += 3;
  if (d.includes("town")) s += 3;
  if (d.includes("village")) s += 3;
  if (d.includes("borough")) s += 2;
  if (d.includes("neighborhood") || d.includes("neighbourhood")) s += 3;
  if (d.includes("hamlet")) s += 2;
  if (d.includes("county")) s += 1;
  if (d.includes("municipality")) s += 2;
  if (d.includes("district")) s += 1;
  if (d.includes("tourism")) s += 1;
  // small boost if the name text appears in the label/desc
  const n = (name || "").toLowerCase().trim();
  if (n && d.includes(n.split(",")[0])) s += 1;
  return s;
}

/** Step 2: Pull the entity JSON and read P856 (official website) */
async function wikidataOfficialWebsite(entityId) {
  if (!entityId) return null;
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(entityId)}.json`;
  const r = await fetch(url, { headers: { "User-Agent": "This=That/1.0 (Vercel)" } });
  if (!r.ok) return null;
  const data = await r.json();

  const ent = data?.entities?.[entityId];
  const claims = ent?.claims;
  const p856 = claims?.P856; // official website
  const urlClaim = Array.isArray(p856) ? p856[0] : null;
  const value = urlClaim?.mainsnak?.datavalue?.value;
  return typeof value === "string" ? value : null;
}

/** Full lookup: try Wikidata search -> P856. */
async function lookupOfficialWebsiteViaWikidata(placeName) {
  try {
    const id = await wikidataSearchEntity(placeName);
    if (!id) return null;
    const website = await wikidataOfficialWebsite(id);
    return website || null;
  } catch {
    return null;
  }
}

/** Fallback: very light heuristic guesses (kept conservative to avoid junk). */
async function heuristicTourismGuess(placeName) {
  try {
    // Extract a likely "City" token (before comma)
    const cityToken = (placeName || "").split(",")[0].trim().toLowerCase().replace(/\s+/g, "");
    if (!cityToken || cityToken.length < 3) return null;

    // Common patterns that many cities/towns actually use:
    const candidates = [
      `https://www.${cityToken}.gov`,          // e.g., city.gov
      `https://www.${cityToken}-ny.gov`,       // e.g., city-ny.gov
      `https://www.${cityToken}.org`,          // e.g., town.org
      `https://visit${cityToken}.com`,         // e.g., visitphilly.com (works for many)
      `https://www.${cityToken}tourism.com`,   // e.g., bouldertourism.com
    ];

    // Probe quickly; stop at first that responds 200–399
    for (const url of candidates) {
      try {
        const r = await fetch(url, { method: "HEAD" });
        if (r.ok) return url;
      } catch {
        // continue
      }
    }
    return null;
  } catch {
    return null;
  }
}
