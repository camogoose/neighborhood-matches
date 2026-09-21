import { useState } from 'react';

export async function getServerSideProps() {
  if (process.env.VERCEL_ENV === 'production') return { notFound: true };
  return { props: {} };
}

export default function MatchingPreview() {
  const [place, setPlace] = useState('Narrowsburg, NY');
  const [region, setRegion] = useState('Denmark');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);
  async function search(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35000);
    let data;
    try {
      const response = await fetch('/api/like', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ place, region, priorities: [] }), signal: controller.signal
      });
      data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Search failed.');
    } catch (error) {
      data = { error: error.name === 'AbortError' ? 'Search timed out. No automatic retry was made.' : error.message };
    } finally {
      clearTimeout(timeout);
      setHistory(previous => [{ place, region, data, seconds: Math.round((Date.now() - started) / 1000) }, ...previous]);
      setBusy(false);
    }
  }
  return <main style={{ maxWidth: 900, margin: '60px auto', padding: 24, color: '#503326', fontFamily: 'system-ui' }}>
    <p>DRAFT TEST — not your live website</p>
    <h1>Identity-first matching test</h1>
    <p>Existing low-cost model, no paid web research. Each new search can still incur an API charge. Nothing runs automatically.</p>
    <form onSubmit={search} style={{ padding: 24, background: '#faf6ee', borderRadius: 16 }}>
      <label htmlFor="place">Place you love</label>
      <input id="place" required maxLength={120} value={place} onChange={e => setPlace(e.target.value)} disabled={busy} />
      <label htmlFor="region">Search within</label>
      <input id="region" required maxLength={120} value={region} onChange={e => setRegion(e.target.value)} disabled={busy} />
      <button disabled={busy}>{busy ? 'Finding matches…' : 'Test search'}</button>
    </form>
    <p role="status">{busy ? 'One search is running. No automatic retries.' : 'Ready.'}</p>
    {history.map((entry, index) => <section key={index} style={{ borderTop: '1px solid #ddd', marginTop: 30 }}>
      <h2>{entry.place} → {entry.region}</h2>
      <p>Finished in {entry.seconds} seconds. {entry.data.version ? `Version ${entry.data.version}` : ''}</p>
      {entry.data.error && <p role="alert">{entry.data.error}</p>}
      {entry.data.results?.length === 0 && <p>No sufficiently close matches returned.</p>}
      {entry.data.results?.map((result, i) => <article key={i}>
        <h3>{result.rank}. {result.match} — {result.city} {result.region}</h3>
        <p>{result.blurb}</p>
        <ul>{result.whatMakesItSpecial?.map((text, j) => <li key={j}>{text}</li>)}</ul>
        <p>{result.landmarks?.map(item => `${item.name}: ${item.why}`).join(' • ')}</p>
      </article>)}
    </section>)}
    <style jsx>{`input { display:block; box-sizing:border-box; width:100%; padding:14px; margin:8px 0 20px; font-size:16px; } button { padding:14px 24px; background:#e98b2d; border:1px solid #a96524; border-radius:8px; font-size:16px; } article { padding:12px 0; }`}</style>
  </main>;
}
