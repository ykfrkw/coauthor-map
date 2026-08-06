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

The extent is chosen for you: if every co-author is in one country the map opens on that country, if they are all on one continent it opens on that region, and otherwise on the whole world. You can override it, change the projection, re-center the map on any longitude, pick a visual theme, filter by year, resize the pins by paper count or by number of people, and exclude anything the automatic matching got wrong.

## Why it starts from ORCID and researchmap, not from an author search

Author name disambiguation is unreliable, and silently so. Looking up one real ORCID in OpenAlex returns **two** author records for the same person, and one of them has papers from 1920, 1972 and 1988 attached to a researcher who started publishing in 2019 — roughly a quarter of the record belongs to other people with the same name.

Claimed works do not have this problem. For the same researcher, ORCID returns 34 papers, all genuinely theirs, and only 2% of the author rows are missing an affiliation, against 24% via the author-record route.

So the tool always starts from a list of DOIs the researcher has claimed. Searching OpenAlex by author name is available as a fallback for people with no ORCID works, but it warns you that the result will be noisy.

## One person, several author records

OpenAlex splits people. For the researcher above, 21 of 166 co-author records were duplicates of someone already in the list — a 13% inflation that made the largest pin 27% too big when pins are sized by number of people. The split has a consistent shape: a record with several papers, plus a record holding exactly one paper, usually a paper indexed in the current year that OpenAlex has not yet folded back into the existing cluster.

Two records are counted as one person when they share an ORCID iD, or when all three of these hold: the same name, an organization in common, and no paper on which both appear. That last condition is the one that matters. A paper never lists the same person twice, so two records appearing together on one paper are definitely two different people — it is the only certain test available, and it is checked first. The corrections panel lists every merge it made, so you can see what was folded together, and a checkbox turns the whole thing off (`?merge=off`, or `?merge=orcid` for ORCID matching only).

## One person, one pin

A co-author who has moved used to appear in every city they had ever been affiliated with: 55 of 145 people showed up more than once, one of them in six cities at the same time. The map is about people, so each co-author is now placed at exactly one primary affiliation.

The primary affiliation is the one **printed first on the paper** (`authorships[].institutions[0]`), which is the convention the literature already follows: the city that comes first most often wins, ties go to the most recent paper. On the reference map that decides 142 of 145 people. Where it does not decide — the same count in two cities in the same year — the affiliations on the person's ORCID record break the tie, and if that is inconclusive too, the smallest institution ID is picked so the result never wanders between reloads. One person falls through to that last rule, and two have no affiliation anywhere in OpenAlex or ORCID; they are counted as “affiliation missing” rather than guessed at.

Placing people once rather than once per affiliation drops the map from 69 cities in 15 countries to 47 in 14: the cities that disappear were never anybody's main address. `?pin=all` brings the old behavior back.

## Narrowing the map

Two controls decide who is on the map, and both travel in the URL, so a map you have corrected embeds exactly as you corrected it:

- **Main collaborations** (`?min=`) keeps co-authors with at least N shared papers. On the reference map, 2 or more keeps 53 people of 145, 3 or more keeps 27.
- **Co-authors** starts with everyone checked; unchecking someone takes them off the map (`?xa=`). Excluded organizations and papers ride along the same way (`?xi=`, `?xd=`).

## Pins are cities, not institutions

OpenAlex stores institution coordinates at **city** granularity. Fifteen Tokyo institutions all sit on exactly the same point (35.6895, 139.6917), and querying ROR directly returns that identical city centroid. Separating institutions geographically is therefore impossible with this data, and the tool does not pretend otherwise: a pin is a city, and the institutions in it are listed in the tooltip.

Cities are merged when two institutions share a rounded coordinate, or when they carry the same city name and sit within 100 km of each other. Without the second rule, Oxford splits into three pins — the university, Warneford Hospital and Oxford BioMedica are a few kilometres apart — each claiming the same 10 papers.

## Cost of a map

Seven HTTP requests and about 1.5 seconds on a cold load, for a researcher with 34 papers and 145 co-authors: one to ORCID for the claimed works, two to OpenAlex for the papers, three more for the 119 organizations, and one back to ORCID for affiliations. Results are cached in `sessionStorage` for 24 hours, so re-opening the page costs nothing. Because the requests come from your own browser, the OpenAlex rate limit is never a shared resource.

That last request is only made when it can change something. The primary affiliation is decided by the order printed on the paper for 142 of the 145 people, and the ORCID affiliation lookup exists for the rest; asking for all 145 up front cost 560ms and three requests and decided nobody. The map is now built once without it, and ORCID is asked only about the people still undecided — two of them here, in one request. If the printed order decides everyone, ORCID is never called at all.

researchmap is not read unless you ask for it (`?rm=`). It answered in 1.9 seconds, which made it the slowest step by far, and every one of the 25 papers it returned was already in the 34 from ORCID. The field is still there, and it is the right seed for a researcher who keeps their publication list on researchmap rather than ORCID.

## Data sources

| Source                                                                                                       | Used for                                | License                 |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ----------------------- |
| [ORCID](https://orcid.org) public API                                                                        | Claimed works, co-author affiliations   | CC0                     |
| [researchmap](https://researchmap.jp) public API                                                             | Registered papers (Japan)               | Per researchmap's terms |
| [OpenAlex](https://openalex.org)                                                                             | Author lists, affiliations, coordinates | CC0                     |
| [Natural Earth](https://www.naturalearthdata.com) via [world-atlas](https://github.com/topojson/world-atlas) | Country boundaries                      | Public domain           |

No API key is required for any of them. Requests to OpenAlex identify themselves through the polite pool.

The world map ships at two resolutions. The 110m outline (105 KB) always loads first; the finer 50m outline (739 KB) is fetched only once it is worth its weight — when the map fits a single country or a region, or when you zoom past three times the initial scale. It is swapped in without disturbing pins, labels, or zoom, and exports carry whichever outline is on screen.

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
npm test         # 443 tests, entirely offline
npm run build
node tests/regenerate-snapshot.mjs   # rewrite tests/fixtures/dataset-snapshot.json from the recorded fixtures
```

Tests never touch the network. `tests/fixtures/` holds recorded API responses plus `dataset-snapshot.json`, which is the expected aggregation output for a real researcher and doubles as the specification for the aggregation rules. Run the regenerate script only when you have deliberately changed an aggregation rule, and read the resulting diff.

`dev.html` renders the map straight from the snapshot without calling any API. It is excluded from the production build.

Adding `?review=1` to `index.html` or `widget.html` turns on review mode: click anywhere to drop a numbered pin and write a note about what you see, then copy the whole set as Markdown. Notes are anchored to the element under the click, so they survive a redraw or a change of window width, and they live in `localStorage` only. The code ships as a separate chunk that is fetched only when the parameter is present. Press Escape to hand the map back its own clicks.

Deployment is automatic: pushing to `main` runs the tests and publishes to GitHub Pages.

## Embedding

The tool exposes a lightweight `widget.html` for embedding in an iframe. See [docs/embedding.md](docs/embedding.md) for the snippet and the auto-resize script.

## License

MIT for the code. The data belongs to its sources, under the licenses listed above.

Built by [Yuki Furukawa](https://yukifurukawa.jp/coauthor-map/).
