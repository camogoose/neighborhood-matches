// pages/api/like.js
// v0.5.4 — JSON mode + one retry if empty; results-only; landmarks; filtered travel news.

import OpenAI from "openai";

export const config = { runtime: "nodejs", api: { bodyParser: true } };

// ---- CORS ----
function setCors(req, res) {
  const allowedOrigins = [
    "https://www.vorrasi.com",
    "https://vorrasi.com",
    "https://contrabass-dog-6klj.squarespace.com",
    "https://thisplaceisjustlikethatplace.com",
    "https://www.thisplaceisjustlikethatplace.com",
    "https://mike-vorrasi.squarespace.com"
  ];
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---- tiny helpers ----
function pick(s, re) { const m = re.exec(s); return m ? m[1].trim() : ""; }
function clean(str) {
  return String(str || "")
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// ---- travel/news filtering ----
const NEGATIVE_KEYWORDS = [
  "murder","homicide","shooting","stabbing","assault","kidnapping",
  "rape","bomb","terror","massacre","deadly","death","fatal","police","arrest"
];
function domainOf(u=""){ try { return new URL(u).host.replace(/^www\./,""); } catch { return ""; } }
function isTravelDomain(u=""){
  const h = domainOf(u);
  if (!h) return false;
  return /lonelyplanet|cntraveler|afar|atlasobscura|timeout|thrillist|travelandleisure|nationalgeographic|guardian|nytimes|bbc|washingtonpost|eater|curbed|visit|tourism|city|municipality|gov/i.test(h);
}
function hasNegative(text=""){
  const t = text.toLowerCase();
  return NEGATIVE_KEYWORDS.some(k => t.includes(k));
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

    if (!isTravelDomain(link)) return null;
    if (hasNegative((title||"") + " " + (desc||""))) return null;

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

// ---- OpenAI call helpers (JSON mode + retry) ----
async function getMatchesJSON(place, region
