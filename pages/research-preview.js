import { useState } from 'react';
import Head from 'next/head';

function Sources({ sources = [] }) {
  return <ul>{sources.filter(s => {
    try { const u = new URL(s.url); return u.protocol === 'https:' && !u.username && !u.password; }
    catch { return false; }
  }).map(s => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title || s.url}</a></li>)}</ul>;
}

export default function ResearchPreview() {
  const [place, setPlace] = useState('Narrowsburg, NY');
  const [region, setRegion] = useState('Denmark');
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(null);
  async function search(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setData(null); setSeconds(null);
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 125000);
    try {
      const response = await fetch('/api/like', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ place, region, priorities: [] }) });
      if (!(response.headers.get('content-type') || '').includes('application/json')) {
        throw new Error('The preview returned a login or server page. Refresh and sign into Vercel if asked.');
      }
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Search could not complete.');
      setData(result);
    } catch (e) {
      setError(e.name === 'AbortError' ? 'Research timed out. Please try again.' : e.message);
    } finally {
      clearTimeout(timer); setBusy(false); setSeconds(Math.round((Date.now() - started) / 1000));
    }
  }
  return <main>
    <Head><title>Research matching test</title><meta name="robots" content="noindex,nofollow" /></Head>
    <p className="badge">DRAFT TEST — not your live website</p>
    <h1>Does it understand the place?</h1>
    <p>First check the starting-place profile, then the matches and their sources. A successful search does not guarantee an accurate match.</p>
    <form onSubmit={search}>
      <label>Place you love<input required maxLength={120} value={place} disabled={busy} onChange={e => setPlace(e.target.value)} /></label>
      <label>Search within<input required maxLength={120} value={region} disabled={busy} onChange={e => setRegion(e.target.value)} /></label>
      <button disabled={busy}>{busy ? 'Researching…' : 'Test search'}</button>
    </form>
    <p>Try Narrowsburg, NY; Hood River, Oregon; or Lower East Side, New York. No search runs until you press the button. Research uses the preview’s paid API connection.</p>
    <div role="status" aria-live="polite">{busy ? 'Researching the place and comparing candidates. This may take up to two minutes.' : seconds !== null ? `Finished in ${seconds} seconds.` : ''}</div>
    {error && <p role="alert">{error}</p>}
    {data && <>
      <p>Backend version: {data.version}</p>
      {data.research?.profile && <section>
        <h2>What the search understood</h2>
        <h3>{data.research.profile.name}</h3>
        <p>Place type: {data.research.profile.placeType}</p>
        <ul>{data.research.profile.features.map(f => <li key={f.id}><strong>{f.importance}: </strong>{f.claim}</li>)}</ul>
        <h3>Starting-place sources</h3><Sources sources={data.research.profile.sources} />
      </section>}
      <h2>Matches</h2>
      {data.research?.notice && <p>{data.research.notice}</p>}
      {!data.results?.length && <p>No candidates passed the evidence and defining-character checks.</p>}
      {(data.results || []).map((r, i) => <section key={i}>
        <h3>{i + 1}. {[r.match, r.city, r.region].filter(Boolean).join(', ')}</h3>
        <p>{r.blurb}</p><ul>{(r.whatMakesItSpecial || []).map((x, j) => <li key={j}>{x}</li>)}</ul>
        <h4>Match sources</h4><Sources sources={r.sources} />
      </section>)}
    </>}
    <style jsx>{`
      main { max-width: 850px; margin: 40px auto; padding: 24px; color: #492d20; font: 17px/1.6 system-ui, sans-serif; }
      .badge { font-size: 13px; font-weight: bold; letter-spacing: .06em; }
      form, section { background: #faf6ee; border: 1px solid #ded4c7; border-radius: 14px; padding: 24px; margin: 24px 0; }
      label { display: block; margin-bottom: 16px; font-weight: bold; }
      input { box-sizing: border-box; display: block; width: 100%; padding: 12px; font: inherit; border: 1px solid #aaa; border-radius: 6px; }
      button { padding: 12px 24px; font: inherit; background: #e88930; color: #261a10; border: 1px solid #9d591b; border-radius: 8px; cursor: pointer; }
      button:disabled { opacity: .6; cursor: wait; }
      [role=alert] { color: #a11; }
      section { overflow-wrap: anywhere; }
    `}</style>
  </main>;
}
