# Embedding a co-author map

The map can be embedded in any page with a plain `<iframe>`. Nothing is uploaded and no
account is needed: the frame builds the map in the visitor's browser from public data
(ORCID, researchmap, OpenAlex).

## 1. Get the snippet

Open the tool, set the map up the way you want it — years, grouping, projection, center
longitude, theme — and copy the snippet from **Put this map on your own site**. Every
setting you see is carried in the URL, so the embedded frame shows exactly what you saw.

The snippet looks like this:

```html
<div style="margin:28px 0;">
  <style>
    .coauthor-map-embed {
      display: block;
      width: 100%;
      border: none;
      border-radius: 12px;
      box-shadow: 0 2px 16px rgba(0, 0, 0, 0.08);
    }
  </style>
  <iframe
    class="coauthor-map-embed"
    title="Co-author map"
    src="https://ykfrkw.github.io/coauthor-map/widget.html?orcid=0000-0003-1317-0220"
    style="height:460px"
    loading="lazy"
  ></iframe>
  <p style="font-size:13px;margin-top:6px;">
    Made with <a href="https://yukifurukawa.jp/coauthor-map/">coauthor-map</a>
  </p>
  <script>
    (function () {
      if (window.coauthorMapEmbedResize) return;
      window.coauthorMapEmbedResize = true;
      var ORIGIN = 'https://ykfrkw.github.io';
      window.addEventListener('message', function (event) {
        if (event.origin !== ORIGIN) return;
        var data = event.data;
        if (!data || data.type !== 'embed:height') return;
        var height = parseInt(data.height, 10);
        if (!height || height < 100 || height > 5000) return;
        var frames = document.querySelectorAll('iframe.coauthor-map-embed');
        for (var i = 0; i < frames.length; i++) {
          if (frames[i].contentWindow === event.source) {
            frames[i].style.height = height + 'px';
          }
        }
      });
    })();
  </script>
</div>
```

The trailing script is what makes the frame fit its content; see
[section 3](#3-letting-the-frame-set-its-own-height). It is included by default.
Untick **Let the frame set its own height** in the embed panel if your CMS strips
inline scripts, and you get the same snippet without it — the frame then keeps the
fixed `height` you chose.

The credit line is appreciated but entirely optional: the MIT license does not ask for a
link back, and you are free to delete that paragraph or reword it. It carries a single
link, to the page that documents the tool.

> **WordPress note.** The `<style>` block deliberately contains no CSS comments and no
> child combinator (`>`). Some WordPress firewalls reject a request that contains either
> one inside a `<style>` block and answer with a 403. The generator refuses to emit a
> snippet that would trip this.

## 2. URL parameters

| Parameter    | Values                                                                      | Default                               |
| ------------ | --------------------------------------------------------------------------- | ------------------------------------- |
| `orcid`      | ORCID iD, e.g. `0000-0003-1317-0220`                                        | owner's ORCID                         |
| `rm`         | researchmap permalink, e.g. `yk_frkw`                                       | none; only read when you pass it      |
| `from`, `to` | publication years; `earliest` / `latest` for an open end                    | the full range in the data            |
| `proj`       | `equalEarth`, `naturalEarth`, `equirectangular`, `mercator`, `orthographic` | `equalEarth`                          |
| `center`     | center longitude, `-180`…`180`                                              | `140`, unless `scope` fits the map    |
| `scope`      | `auto`, `country`, `region`, `world`                                        | `auto`                                |
| `grain`      | `country`, or a merge radius in pixels `0`…`64`                             | `10` (`0` = one pin per city)         |
| `size`       | `papers`, `coauthors`, `uniform`                                            | `coauthors`                           |
| `theme`      | `minimal`, `dark`, `blueprint`, `paper`                                     | follows the visitor's system setting  |
| `min`        | keep co-authors with at least this many shared papers                       | `1` (everyone)                        |
| `xa`         | co-authors to leave out, e.g. `xa=5085050194.5002251483`                    | none                                  |
| `xi`         | organizations to leave out, e.g. `xi=62916508`                              | none                                  |
| `xd`         | papers to leave out, e.g. `xd=1016/j.eclinm.2026.103988`                    | none                                  |
| `pin`        | `primary`, `all`                                                            | `primary`                             |
| `orcidaff`   | `off` to skip the ORCID affiliation lookup                                  | on                                    |
| `labels`     | `on` to draw city names over the ten largest pins                           | off                                   |
| `legend`     | `on`, `off`                                                                 | on in the full page, off in the frame |

`orcid` and `rm` can be given together; the two publication lists are merged. Nothing is
read from researchmap unless you pass `rm`, so give it if the researcher keeps their
publication list there rather than on ORCID.

### The map keeps itself up to date

Leave `from` and `to` out and the map always covers everything the record holds. It is
rebuilt in the visitor's browser on every view, so a paper added to the ORCID record next
year turns up on the embedded map by itself — nobody has to touch the snippet.

The generator never writes an end year you did not choose: as long as the last year sits
at the right end of the slider, `to` stays out of the link, and the slider reads
`2019 – latest` rather than a year. Drag the last year down and the link pins it
(`to=2024`), which is what you want for a map of one project or one period — but that map
stops there. Drag it back to the right end to reopen it.

When you write a link by hand, `to=latest` and `from=earliest` mean the same as leaving
the parameter out, so `?orcid=…&from=earliest&to=latest` stays open forever. Writing
`?from=2019&to=2026` freezes the map at 2026.

Every co-author sits at **one** primary affiliation, so nobody appears in two cities.
The primary affiliation is the one printed first on their papers with you
(`authorships[].institutions[0]` in OpenAlex); ties go to the most recent paper, then to
the affiliation named on their ORCID record. `pin=all` restores the older behavior, where
a person appears in every city they have ever been affiliated with.

`min`, `xa`, `xi`, and `xd` are what the Corrections and “Who is on the map” panels write.
Whatever you fix on the page ends up in the snippet the page generates, so the embedded
map shows exactly what you were looking at. The IDs are shortened: OpenAlex IDs lose the
`https://openalex.org/A` prefix, DOIs lose the leading `10.`, and `.` (or `*` for DOIs)
separates them. Long correction lists make long URLs; the embed panel warns past about
1,800 characters and suggests raising `min` instead.

`scope=auto` picks the extent from where the co-authors actually are: one country if
they are all in the same country, one region if they are all on the same continent,
otherwise the whole world. When the map is fitted to a country or a region, the center
longitude follows that shape's centroid unless `center` is given explicitly.

## 3. Letting the frame set its own height

This is on by default and already sits in the snippet above; this section explains what
it does.

The frame reports the height it actually needs. It posts a message to the parent window
whenever its content resizes:

```js
{ type: 'embed:height', height: 462 }
```

The script in the snippet listens for that message and applies the height. The `height`
in the `style` attribute stays as the starting height, used until the first message
arrives (and as the final height if scripts are stripped).

The starting height defaults to `460`, which is what the frame actually measures in a
780px-wide column. The map is drawn to about `(frame width − 16) × 0.52`, capped at
520px, with roughly 63px for the padding and the line under the map, so a wider column
settles a little taller and a narrower one a little shorter. Raise or lower the number in
the embed panel if your content column is far from 780px; getting it close only matters
for the moment before the first message arrives, and for CMSes that strip the script.

Two checks in that listener are not optional:

- `event.origin` must equal the origin serving `widget.html`. Without it, any framed page
  on your site could resize the map.
- `event.source` must be the frame that sent the message. That is what makes this work
  when one page embeds more than one map.

The `window.coauthorMapEmbedResize` flag keeps a page with several snippets from
registering the listener more than once.

If your CMS strips inline `<script>`, untick **Let the frame set its own height** in the
embed panel. You then get the same snippet without the script, and the frame keeps the
fixed height you chose.

## 4. Accessibility and print

- The frame renders an `<svg role="img">` with a summary `aria-label`, and every pin is
  reachable with the Tab key.
- The same numbers are printed as text under the map — by country, by organization, and
  by year — and those tables can be copied as Markdown or CSV. A frame carrying
  `?controls=on` has them too, in a collapsed **The same map as text** panel, so a reader
  never has to leave your article to read the map as a table.
- If you need a static image instead of a live frame, use **Download** on the full page.
  SVG and 2x PNG are both produced with the credit baked into the corner.

## 5. Sources

Publication lists come from [ORCID](https://orcid.org/) and
[researchmap](https://researchmap.jp/); works, authors, and affiliations come from
[OpenAlex](https://openalex.org/) (CC0); country outlines come from Natural Earth via
[world-atlas](https://github.com/topojson/world-atlas).

Pins are cities, not organizations. OpenAlex stores institution coordinates at city
level, so every organization in one city shares a single point — Tokyo alone covers 15 of
them. The **Grouping** slider changes how much the map merges nearby points on screen; it
cannot go finer than one pin per city, because the data does not. It starts at a 10 px
merge radius, which keeps dense regions readable; slide it all the way to City, or pass
`grain=0`, to get every city as its own pin.
