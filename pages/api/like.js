// pages/api/like.js
// v0.4.2 — Source-place profile (traits/landmarks/size/vibe) + 3 matches + travel-only news
// Runtime: Node.js (not Edge)

import OpenAI from "openai";

export const config = { runtime: "nodejs", api: { bodyParser: true } };

// ---- CORS: allow your preview + live Squarespace domains (edit as needed) ----
function setCors(req, res) {
  const allowedOrigins = [
    // Your personal site (optional — keep if you still embed there)
    "https://www.vorrasi.com",
    "https://vorrasi.com",

    // Squarespace preview domain for THIS project (keep while testing)
    "https://contrabass-dog-6kj.squarespace.com",

    // Your live custom domain (both www + bare)
    "https://thisplaceisjustlikethatplace.com",
    "https://www.thisplaceisjustlikethatplace.com",

    // Squarespace editor login domain (sometimes used during previews)
    "https://mike-vorrasi.squarespace.com"
  ];

  // Optional: allow any *.squarespace.com (uncomment if you prefer broader testing)
  // const SQS_REGEX = /^https:\/\/[a-z0-9-]+\.squarespace\.com$/i;

  const origin = req.headers.origin;
  if (origin && (allowedOrigins.includes(origin) /* || SQS_REGEX.test(origin) */)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---- tiny helpers (no deps) ----
function pick(s, re) { const m = re.exec(s); return m ? m[1].trim() : ""; }
function clean(str) {
  return String(str || "")
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
async function fetchTravelNews(q) {
  const url = "https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q="
    + encodeURIComponent(q + " (travel OR tourism OR visit OR guide)");
  try {
    const r = await fetch(url);
    const xml = await r.text();
    const item = pick(xml, /<item>([\s\S]*?)<\/item>/i);
    if (!item) return null;
    const title = clean(pick(item, /<title>([\s\S]*?)<\/title>/i));
    const link  = clean(pick(item, /<link>([\s\S]*?)<\/link>/i));
    const desc  = clean(pick(item, /<description>([\s\S]*?)<\/description>/i));
    const img   = pick(item, /<media:content[^>]*url="([^"]+)"/i)
               || pick(item, /<enclosure[^>]*url="([^"]+)"/i) || "";
    return {
      title: title || "",
      url: link || "",
      image: img || "",
      snippet: (desc || "").replace(/<[^>]+>/g, "").slice(0, 180) + ((desc && desc.length > 180) ? "…" : "")
    };
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "This Is Just Like That",
      version: "0.4.2",
      sections: ["sourceProfile", "results"],
      news_filter: "travel-only",
      mode: process.env.OPENAI_API_KEY ? "openai" : "missing_api_key",
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET,POST,OPTIONS");
    return res.status(405).json({ ok: false, error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { place, region } = req.body || {};
    if (!place || !region) {
      return res.status(400).json({ ok: false, error: 'Missing JSON: { "place": "...", "region": "..." }' });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ ok: false, error: "OPENAI_API_KEY is not set" });
    }

    // Prompt: build a concise profile of the source place + 3 best matches inside region
    const prompt = `
You are a neighborhood-matching engine.

Task A — PROFILE the source place (concise, factual, no hype):
- place: "${place}"
Return:
{
  "sourceProfile": {
    "summary": "1 sentence overview of ${place} vibe.",
    "traits": [
      { "title": "2–4 words", "detail": "1–2 sentences specific to ${place}" },
      { "title": "2–4 words", "detail": "1–2 sentences specific to ${place}" },
      { "title": "2–4 words", "detail": "1–2 sentences specific to ${place}" }
    ],
    "landmarks": [
      { "name": "spot name", "why": "why it matters in 1 short sentence" }
    ],
    "size": { "populationApprox": "e.g., ~100k", "densityNote": "short note (optional)" },
    "vibeTags": ["short","comma-free","tags","3-6"]
  }
}

Task B — MATCH inside scope (consider scale + vibe):
- scope/region: "${region}"
Rules:
- Prefer neighborhoods (not entire cities) when possible.
- Factor scale similarity: population/density/foot-traffic if known; if not, infer typical scale.
- Avoid duplicates; be accurate.

Return exactly 3 candidates:
{
  "results": [
    {
      "rank": 1,
      "match": "Neighborhood",
      "city": "City",
      "region": "Region/State/Country",
      "blurb": "Why this matches ${place} in 1–2 sentences",
      "tags": ["1-3 words","3-6 tags"],
      "score": 0.0
    }
  ]
}

Output ONLY valid JSON with both "sourceProfile" and "results".
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.6,
      messages: [
        { role: "system", content: "You return strictly valid JSON for a neighborhood-matching API." },
        { role: "user", content: prompt },
      ],
    });

    let text = completion.choices?.[0]?.message?.content || "{}";
    text = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "");
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = {}; }

    // Normalize sourceProfile
    const sp = parsed?.sourceProfile || {};
    const sourceProfile = {
      summary: sp.summary || `What makes ${place} special.`,
      traits: Array.isArray(sp.traits) ? sp.traits.slice(0, 3).map(t => ({
        title: String(t?.title || "").slice(0, 40) || "Trait",
        detail: String(t?.detail || "").slice(0, 300) || ""
      })) : [],
      landmarks: Array.isArray(sp.landmarks) ? sp.landmarks.slice(0, 5).map(l => ({
        name: String(l?.name || "").slice(0, 80),
        why: String(l?.why || "").slice(0, 160)
      })) : [],
      size: {
        populationApprox: sp?.size?.populationApprox || "",
        densityNote: sp?.size?.densityNote || ""
      },
      vibeTags: Array.isArray(sp.vibeTags) ? sp.vibeTags.slice(0, 6) : []
    };

    // Normalize matches
    const base = Array.isArray(parsed?.results) ? parsed.results.slice(0, 3) : [];
    const normalized = base.map((r, i) => ({
      rank: typeof r.rank === "number" ? r.rank : i + 1,
      match: r.match || r.neighborhood || "Unknown",
      city: r.city || "",
      region: r.region || String(region),
      blurb: r.blurb || `Feels similar to ${place}.`,
      tags: Array.isArray(r.tags) ? r.tags.slice(0, 6) : [],
      score: typeof r.score === "number" ? r.score : 0.75,
      source: "openai",
    }));

    // Attach travel news for each match (best-effort)
    const withNews = await Promise.all(normalized.map(async (item) => {
      const nq = `${item.match} ${item.city} ${item.region}`;
      const news = await fetchTravelNews(nq);
      return { ...item, news: news || null };
    }));

    return res.status(200).json({
      ok: true,
      place, region,
      sourceProfile,
      results: withNews,
      version: "0.4.2"
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error", detail: String(err?.message || err) });
  }
}
