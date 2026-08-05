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
    style="height:720px"
    loading="lazy"
  ></iframe>
  <p style="font-size:13px;margin-top:6px;">
    Made with
    <a href="https://yukifurukawa.jp/coauthor-map/">coauthor-map</a> by Yuki
    Furukawa
  </p>
</div>
```

The credit line is appreciated but entirely optional: the MIT license does not ask for a
link back, and you are free to delete that paragraph or reword it. It carries a single
link, to the page that documents the tool.

> **WordPress note.** The `<style>` block deliberately contains no CSS comments and no
> child combinator (`>`). Some WordPress firewalls reject a request that contains either
> one inside a `<style>` block and answer with a 403. The generator refuses to emit a
> snippet that would trip this.

## 2. URL parameters

| Parameter    | Values                                                                      | Default                              |
| ------------ | --------------------------------------------------------------------------- | ------------------------------------ |
| `orcid`      | ORCID iD, e.g. `0000-0003-1317-0220`                                        | owner's map                          |
| `rm`         | researchmap permalink, e.g. `yk_frkw`                                       | owner's map                          |
| `from`, `to` | publication years                                                           | the full range in the data           |
| `proj`       | `equalEarth`, `naturalEarth`, `equirectangular`, `mercator`, `orthographic` | `equalEarth`                         |
| `center`     | center longitude, `-180`…`180`                                              | `140`                                |
| `grain`      | `country`, or a merge radius in pixels `0`…`64`                             | `10` (`0` = one pin per city)        |
| `size`       | `papers`, `coauthors`, `uniform`                                            | `papers`                             |
| `theme`      | `minimal`, `dark`, `blueprint`, `paper`                                     | follows the visitor's system setting |

`orcid` and `rm` can be given together; the two publication lists are merged.

## 3. Letting the frame set its own height

A fixed `height:720px` is fine, but the frame also reports the height it actually needs.
It posts a message to the parent window whenever its content resizes:

```js
{ type: 'embed:height', height: 812 }
```

Add this to the embedding page to follow it:

```html
<script>
  (function () {
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
```

The origin check matters: without it, any framed page on your site could resize the map.
Matching `event.source` against the frame is what makes this work when a page embeds more
than one map.

## 4. Accessibility and print

- The frame renders an `<svg role="img">` with a summary `aria-label`, and every pin is
  reachable with the Tab key.
- The full page version prints the same numbers as text under the map — by country, by
  organization, and by year — and those tables can be copied as Markdown or CSV.
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
