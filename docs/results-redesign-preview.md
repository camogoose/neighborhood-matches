# Photo-led result-card preview

Design-only prototype at /results-preview.html on this branch's Vercel preview. Do not merge or publish to Squarespace yet.

## Scope
- New standalone preview derived from the committed V11 frontend.
- Main frontend, matching API, storage API, dependencies and production configuration untouched.
- Stacked mobile-first cards, photo/location/intro/tags, native keyboard-accessible details/summary chevrons.
- Original explanation retained in expandable detail; highlights labelled separately, not invented match evidence.
- Maps load only after opening Map & explore. Failed/missing photos have explicit fallback.
- Demo is fixed editorial sample content, not a matching-quality evaluation.
- All search calls blocked in preview, including query-only links. Preview sharing does not write sample data to storage. Valid short and old snapshot links can still render through inherited read paths. Existing canonical live sharing untouched.

## Images
No SDK, subscription or API key added. Five curated Wikimedia files only, exact match/city/region identity. No general automatic image search yet. Images cropped via CSS, individually credited and linked with license. Any adaptations use the same respective share-alike license.

- Domino Park waterfront: Andre Carrotflower, CC BY-SA 4.0. https://commons.wikimedia.org/wiki/File:Domino_Park,_Brooklyn_-_20220615_-_01_-_view_northward_featuring_skylines.jpg
- Ithaca Falls: Stilfehler at wikivoyage shared, CC BY-SA 1.0. https://commons.wikimedia.org/wiki/File:Ithaca_Falls.JPG
- Warren Street, Hudson: Daniel Case, CC BY-SA 3.0. https://commons.wikimedia.org/wiki/File:Warren_Street_west_view,_Hudson,_NY.jpg

Sources/individual licenses inspected 2026-09-24. General guidance https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia/en . Unsplash evaluated but not integrated; its API has attribution/hotlinking requirements and needs separate setup. https://unsplash.com/api-terms

## Verification so far
- Preview JavaScript syntax compiled in isolated JavaScript tool runtime.
- Pure card-rendering assertions: three collapsed disclosures, escaped text, full long explanation preserved, licensed-image credit, strict location fallback, deferred map markup.
- Local command runner unavailable this session. No claim of full Node test suite, mobile browser, image delivery, or end-to-end share verification. Must complete before release.

## Remaining before release
- Visual review at 360/390/768/1280px; keyboard and screen-reader checks; image error and slow-network checks.
- Verify image URLs load and crop well; current photos are older illustrative views, not current-condition evidence.
- Consolidate approved renderer into the canonical frontend (do not keep divergent copies long term).
- Remove preview guards only in the release artifact, rerun existing search/share tests plus browser regression tests.
- Keep genuine search results and stored snapshots unchanged. No matching prompt, paid image provider, app build, or cleanup scope.
- Only publish after explicit approval. Production remains unchanged.

## Photo coverage and fallback update — 2026-09-24
- Added Astoria Park, Queens by Rsmn, CC0 1.0: https://commons.wikimedia.org/wiki/File:Astoria_Park,_Queens.jpg (2016).
- Added Greenpoint, Brooklyn 2009 by Jleon, cropped by Beyond My Ken, using CC BY-SA 3.0: https://commons.wikimedia.org/wiki/File:Greenpoint,_Brooklyn_2009.JPG . CSS crop retains that license.
- Individual file pages reviewed for identity, creator and reuse terms. Dates included in alt text; these are illustrative older photographs, not evidence of current conditions.
- Unknown locations and failed image requests now use a compact full-width strip instead of an empty desktop image column. All explanations, highlights, landmarks, tags and maps remain.
- Cached image failures are also handled after rendering. Error handler tested for repeated calls.
- Isolated checks passed for JavaScript syntax, the three current sample photo mappings, wrong-region rejection and failed-image fallback.
- Image delivery and crop appearance NOT verified: web image fetches returned cache misses; local command/browser runner was unavailable.
- Photos still load from Wikimedia, not bundled/served by this project. Self-hosting and broad destination coverage remain unfinished. No paid service, API key, package, production change or AI search added.
