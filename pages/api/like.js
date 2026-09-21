// pages/api/like.js
// v0.7.0 — evidence-backed source identity, candidate research and core-first ranking
// Keeps existing result fields; adds source citations and research metadata.
// Runtime: Node.js (not Edge)

import researchMatch from "../../lib/research-match.cjs";
const { createMatcher, VERSION } = researchMatch;
const findMatches = createMatcher();

export const config = { runtime: "nodejs", api: { bodyParser: { sizeLimit: "4kb" } }, maxDuration: 120 };

// ---- CORS ----
function setCors(req, res) {
  const allowedOrigins = [
    "https://www.vorrasi.com",
    "https://vorrasi.com",
    "https://thisplaceisjustlikethatplace.com",
    "https://www.thisplaceisjustlikethatplace.com",
    "https://mike-vorrasi.squarespace.com",
  ];
  const SQS_REGEX = /^https:\/\/[a-z0-9-]+\.squarespace\.com$/i;
  const origin = req.headers.origin;
  if (origin && (allowedOrigins.includes(origin) || SQS_REGEX.test(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}



// ---- helpers ----
function readInput(value, maxLength = 120) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}
const MATCH_PRIORITIES = new Set([
  "food and restaurants",
  "nightlife",
  "arts and creative scene",
  "architecture and atmosphere",
  "local and less touristy",
  "walkability",
  "affordable",
  "gritty",
  "polished",
]);
function readPriorities(value) {
  const values = Array.isArray(value) ? value : [];
  return [...new Set(values
    .map((item) => readInput(item, 50).toLowerCase())
    .filter((item) => MATCH_PRIORITIES.has(item))
  )].slice(0, 3);
}


export default async function handler(req, res) {
  setCors(req, res);
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, service: "This Is Just Like That",
      version: VERSION, sections: ["resultsOnly"], mode: process.env.OPENAI_API_KEY ? "research" : "missing_api_key" });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET,POST,OPTIONS");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  const place = readInput(req.body?.place), region = readInput(req.body?.region);
  const priorities = readPriorities(req.body?.priorities);
  if (!place || !region) return res.status(400).json({ ok: false,
    error: 'Provide non-empty text values for "place" and "region"' });
  try {
    const matched = await findMatches(place, region, priorities);
    // Source links replace unrelated hotel roundups. No extra unsourced enrichment.
    const results = matched.results.map(item => ({
      ...item, news: null,
      map: { lat: null, lon: null, image: "",
        gmaps: "https://www.google.com/maps/search/?api=1&query=" +
          encodeURIComponent([item.match, item.city, item.region].filter(Boolean).join(", ")) }
    }));
    return res.status(200).json({ ok: true, place, region, priorities, ...matched, results, version: VERSION });
  } catch (error) {
    // Never expose provider responses, credentials or an unresearched fallback.
    const safeMessages = [
      "Research did not complete. Please try again.",
      "Web research was unavailable. Please try again.",
      "Research returned an unreadable result. Please try again.",
      "Research returned no sources. Please try again.",
      "Candidate research was incomplete. Please try again.",
      "Search is busy. Please try again shortly.",
      "Place research is temporarily unavailable. Please try again later.",
      "Place research took too long. Please try again.",
      "Place research is not configured yet.",
      "Could not identify that place reliably. Try including its state or country.",
      "Not enough reliable information about that place yet. Try a more specific place name."
    ];
    const message = safeMessages.includes(error.message) ? error.message :
      "We couldn’t research these places reliably right now. Please try again.";
    // Log only allowlisted diagnostics, never raw model output or credentials.
    console.error("Place research failed:", message);
    return res.status(error.message.startsWith("Search is busy") ? 429 : 503).json({ ok: false, error: message,
      ...(process.env.VERCEL_ENV === 'preview' && error.researchDiagnostic ?
        { researchDiagnostic: error.researchDiagnostic } : {}) });
  }
}
