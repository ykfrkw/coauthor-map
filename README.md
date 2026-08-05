# coauthor-map

Plot your co-author network on a world map, straight from an ORCID iD or a researchmap permalink.

**Live tool: https://ykfrkw.github.io/coauthor-map/**
Background and usage notes: https://yukifurukawa.jp/coauthor-map/

Everything runs in your browser. There is no server, no account, no API key, and nothing you enter is sent anywhere except to the public APIs listed below.

---

## What it does

1. Reads the works **you have claimed** on ORCID, and/or the papers registered on your researchmap profile.
2. Looks each DOI up in OpenAlex to get the full author list and each author's affiliation on that paper.
3. Resolves every affiliation to coordinates and draws the result as pins on a world map.
4. Gives you the same data as a table you can copy out — by country, by institution, by period.

You can change the projection, re-center the map on any longitude, pick a visual theme, filter by year, resize the pins by paper count or by number of people, and exclude anything the automatic matching got wrong.

## Why it starts from ORCID and researchmap, not from an author search

Author name disambiguation is unreliable, and silently so. Looking up one real ORCID in OpenAlex returns **two** author records for the same person, and one of them has papers from 1920, 1972 and 1988 attached to a researcher who started publishing in 2019 — roughly a quarter of the record belongs to other people with the same name.

Claimed works do not have this problem. For the same researcher, ORCID returns 34 papers, all genuinely theirs, and only 2% of the author rows are missing an affiliation, against 24% via the author-record route.

So the tool always starts from a list of DOIs the researcher has claimed. Searching OpenAlex by author name is available as a fallback for people with no ORCID works, but it warns you that the result will be noisy.

## Pins are cities, not institutions

OpenAlex stores institution coordinates at **city** granularity. Fifteen Tokyo institutions all sit on exactly the same point (35.6895, 139.6917), and querying ROR directly returns that identical city centroid. Separating institutions geographically is therefore impossible with this data, and the tool does not pretend otherwise: a pin is a city, and the institutions in it are listed in the tooltip.

Cities are merged when two institutions share a rounded coordinate, or when they carry the same city name and sit within 100 km of each other. Without the second rule, Oxford splits into three pins — the university, Warneford Hospital and Oxford BioMedica are a few kilometres apart — each claiming the same 10 papers.

## Cost of a map

Seven HTTP requests, about 3.6 seconds on a cold load, for a researcher with 34 papers and 166 co-authors. Results are cached in `sessionStorage` for 24 hours, so re-opening the page costs nothing. Because the requests come from your own browser, the OpenAlex rate limit is never a shared resource.

## Data sources

| Source | Used for | License |
|---|---|---|
| [ORCID](https://orcid.org) public API | Claimed works | CC0 |
| [researchmap](https://researchmap.jp) public API | Registered papers (Japan) | Per researchmap's terms |
| [OpenAlex](https://openalex.org) | Author lists, affiliations, coordinates | CC0 |
| [Natural Earth](https://www.naturalearthdata.com) via [world-atlas](https://github.com/topojson/world-atlas) | Country boundaries | Public domain |

No API key is required for any of them. Requests to OpenAlex identify themselves through the polite pool.

## Known limits

- **City granularity is the floor.** See above.
- **Affiliation is the one printed on the paper**, not where the person works now.
- Authors listed without an affiliation cannot be placed. The tool counts them and shows the number rather than dropping them silently.
- Papers with no DOI are not included, because the DOI is what links a claimed work to OpenAlex.
- Very large consortium author lists will dominate the pin sizes. Use the exclusion panel.

## Development

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 90 tests, entirely offline
npm run build
```

Tests never touch the network. `tests/fixtures/` holds recorded API responses plus `dataset-snapshot.json`, which is the expected aggregation output for a real researcher and doubles as the specification for the aggregation rules.

`dev.html` renders the map straight from the snapshot without calling any API. It is excluded from the production build.

Deployment is automatic: pushing to `main` runs the tests and publishes to GitHub Pages.

## Embedding

The tool exposes a lightweight `widget.html` for embedding in an iframe. See [docs/embedding.md](docs/embedding.md) for the snippet and the auto-resize script.

## License

MIT for the code. The data belongs to its sources, under the licenses listed above.

Built by [Yuki Furukawa](https://yukifurukawa.jp/coauthor-map/).
