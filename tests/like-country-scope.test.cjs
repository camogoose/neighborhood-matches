// Offline contract tests: no API charges, network calls or live submissions.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(results = []) {
  const calls = [];
  const source = fs.readFileSync(path.join(__dirname, '../pages/api/like.js'), 'utf8')
    .replace('import OpenAI from "openai";', '')
    .replace('export const config', 'const config')
    .replace('export default async function handler', 'async function handler');
  const context = {
    OpenAI: class {
      constructor() {
        this.chat = { completions: { create: async (request) => {
          calls.push(request);
          return { choices: [{ message: { content: JSON.stringify({ results }) } }] };
        } } };
      }
    },
    process: { env: { OPENAI_API_KEY: 'offline-test-only' } },
    console,
    fetch: async () => ({ text: async () => '<rss></rss>', json: async () => [] }),
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return {
    calls,
    async request(body, method = 'POST') {
      const res = { code: 0, payload: null, setHeader() {},
        status(code) { this.code = code; return this; },
        json(payload) { this.payload = payload; return this; }, end() { return this; } };
      await context.handler({ method, headers: {}, body }, res);
      return res;
    },
  };
}

test('country prompt broadens candidates without forcing city diversity', async () => {
  const h = harness();
  await h.request({ place: 'Lower East Side, New York', region: 'Denmark',
    priorities: ['food and restaurants', 'arts and creative scene', 'gritty'] });
  const prompt = h.calls[0].messages[1].content;
  assert.match(prompt, /scope\/region: "Denmark"/);
  assert.match(prompt, /whole country/);
  assert.match(prompt, /multiple cities where available/);
  assert.match(prompt, /Geographic diversity is NOT a ranking goal/);
  assert.match(prompt, /same city if they are the strongest matches/);
  assert.match(prompt, /tourist retail corridor/);
  assert.doesNotMatch(prompt, /emphasize different\s+strong facets/);
  assert.equal(h.calls.length, 1, 'no extra model call or cost multiplier');
});

test('city scope and visitor preferences are preserved', async () => {
  const h = harness();
  await h.request({ place: 'East Village, NYC', region: 'Berlin',
    priorities: ['walkability', 'walkability', 'invalid', 'nightlife'] });
  const prompt = h.calls[0].messages[1].content;
  assert.match(prompt, /scope\/region: "Berlin"/);
  assert.match(prompt, /within that city instead/);
  assert.match(prompt, /visitor priorities: walkability, nightlife/);
});

test('three strong matches in one city remain allowed with existing response schema', async () => {
  const h = harness(['Area A', 'Area B', 'Area C'].map((match, i) => ({
    match, city: 'Example City', region: 'Example Country', rank: i + 1,
    blurb: 'Fixture only', whatMakesItSpecial: [], landmarks: [], tags: [], score: 0.9,
  })));
  const res = await h.request({ place: 'Example source', region: 'Example Country' });
  assert.equal(res.code, 200);
  assert.equal(res.payload.results.length, 3);
  assert(res.payload.results.every(r => r.city === 'Example City'));
  assert(res.payload.results.every(r => r.map.gmaps.startsWith('https://www.google.com/maps/')));
  assert.equal(res.payload.version, '0.6.1');
});

test('invalid inputs are rejected before model calls; health version updated', async () => {
  const h = harness();
  assert.equal((await h.request({ place: '', region: 'Denmark' })).code, 400);
  assert.equal(h.calls.length, 0);
  assert.equal((await h.request({}, 'GET')).payload.version, '0.6.1');
});
