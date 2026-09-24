# Results UI release — 2026-09-24

Published `frontend/squarespace-short-links.html` to the existing Squarespace Home code block after explicit user launch approval. No backend, matching, storage, header artwork, or native form block was replaced.

The original live block was copied through the editor and saved locally as `squarespace-live-backup-2026-09-24.html`. After CRLF normalization it exactly matched the branch's original frontend file. Rollback: replace the Home code block with that backup and Save.

Verified on the public website:

- One real Austin, Texas → New York City search returned three results.
- Expandable match details retained the full text and highlights.
- Map disclosure loaded the correct Google map.
- All three curated result images loaded, with credits and licenses.
- Short-link save and reopen succeeded without a new search.
- Legacy `#d=` format rendered three cards without a new search.
- At 390px viewport, cards stacked into one column with no horizontal overflow.
- Contact opened the original Squarespace email/message form; no message was submitted.

27 targeted tests passed: results-cards, share-frontend, share, budget-match. The pre-existing country-scope harness has four import-syntax failures in the full suite; unrelated to this frontend release.

Image coverage is deliberately limited to five verified locations (Williamsburg, Astoria, Greenpoint, Ithaca, Hudson). Unknown locations and failed image requests use a compact, honest fallback, never unrelated stock images. No paid photo API was added. Borough/city aliases are accepted only for the three known NYC locations within New York, USA.

Source and regression tests are on `codex/photo-led-results-preview` / PR #7. Squarespace publication is separate from Vercel deployment; the backend remains unchanged.
