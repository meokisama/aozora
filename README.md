<p align="center">
    <img style="width:250px;" src="./src/assets/aozora-logo.png" />
</p>

<h4 align="center">青空の下で、物語が始まる。</h4>

<p align="center">
    <img src="https://img.shields.io/badge/license-GPL--3.0-blue.svg"/>
    <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg"/>
</p>

## About

**Aozora 青空** is a **desktop EPUB reader for Japanese light novels & manga** — tuned
for the things that matter when reading Japanese: tategaki, **multiple furigana display
modes**, **full-text search**, and a comfortable paginated layout. Import your `.epub`
library, then read with full TOC navigation, bookmarks, and adjustable typography.

It's a reading tool, not just a viewer: a built-in hover dictionary with
**[support for Yomitan dictionaries](#dictionary)** looks up words instantly — with
deinflection, furigana headwords, frequency, pitch accent, and kanji breakdowns from
your own imported dictionaries — while **reading statistics** turn every session into an
activity heatmap with daily goals and streaks. It also reads
**[fixed-layout manga EPUBs](#manga--fixed-layout)** as proper two-page spreads.

> **Aozora** targets **Japanese EPUB specifically**. The parser and reader are built
> around the structure and styling conventions of those books (tategaki, ruby, image
> spreads). Other EPUBs may render incorrectly.

![](./preview/preview-0.png)
![](./preview/preview-2.png)
![](./preview/preview-3.png)
![](./preview/preview-5.png)

## Features

- **Two layout modes**, toggled live without re-parsing:
  - **Paginated** (default) — one column-page at a time, char-based paging.
  - **Continuous** — native scroll.
- **Furigana** rendered with native `<ruby>`, with five display modes: **show**, **hide**,
  **dimmed**, **toggle-on-click**, and **reveal-on-hover/click**.
- **Full-text search\*** within the open book, with hit highlighting via the CSS
  Custom Highlight API (works across ruby and the paginated section swaps).
- [**Dictionary**](#dictionary) — Yomitan-style pop-up lookup: hover a word, hold a modifier
  (Shift by default), and get deinflected entries from your imported Yomitan
  dictionaries — furigana headwords, structured glossaries (numbered senses, tables,
  ruby, images), frequency, pitch-accent graphs, and kanji breakdowns (see below).
- [**Manga & fixed-layout**](#manga--fixed-layout) — image-per-page EPUBs render as true two-page spreads
  (see below).
- **Reading statistics** — automatic session tracking feeds a stats page with a
  GitHub-style activity heatmap, daily goal, streaks, milestones and per-book
  totals.
- **Reading position** is tracked by character offset at the
  viewport centre and restored on reopen — survives layout/font changes.
- **Bookmarks** — multiple per book, with editable names; click to jump, delete on hover.

## Manga & fixed-layout

Aozora's text reader follows the **ttsu (ッツ)** approach: the whole book is flattened
into one flowing document and reading position is a character offset, which is what
makes tategaki, live re-flow, and full-text search work so smoothly. That model is
built for **reflowable text** — a fixed-layout page (a full-page image) shows up as a
single standalone page, so manga read one page at a time with no real spreads.

![](./preview/preview-4.png)

Aozora adds a dedicated **fixed-layout path** on top, so image-per-page books read the
way they're meant to:

- **Detects fixed-layout books** declared `rendition:layout="pre-paginated"`, _and_
  **Open Manga Format (OMF)** books that reference page images directly from the spine
  (no XHTML wrapper).
- **Two-page spreads** — adjacent pages are paired into a spread honoring each page's
  `page-spread-left` / `-right` / `-center` and the book's
  `page-progression-direction` (right-to-left for Japanese manga). Covers and lone
  pages stay single.
- **Auto layout** — a two-page spread when the window is landscape, a single page when
  it's portrait; or force **Single** / **Spread** in settings.
- **Mixed books** — a light novel with embedded colour/illustration spreads: the prose
  flows as text while paired image pages render **side by side** in paginated mode.
  Search and character-offset progress keep working over the text; image pages simply
  contribute no characters.

## Dictionary

A built-in **hover dictionary with support for Yomitan dictionaries** lets you read with
instant lookups — no external app, no copy-paste. Hover a word in the reader and the
matching entry pops up right next to it.

- Open the **Dictionaries** page (sidebar) and **Import** one or more Yomitan
  dictionaries — `.zip` files in Yomitan/Yomichan **format v3**: JMdict, monolingual
  国語 dictionaries, frequency lists, pitch-accent dictionaries, KANJIDIC, and so on.
  Aozora ships no bundled dictionary; you bring your own.
- In the reader, **hover a word and hold the trigger key** — **Shift** by default,
  changeable to **Alt**, **Ctrl**, or **Hover only**. The matched run is highlighted
  and the popup stays **pinned** to the word, so you can move the cursor straight into
  it to scroll, copy, or read long entries without it jumping to another word.
- On the Dictionaries page you can toggle the whole feature, pick the trigger key,
  enable/disable each dictionary, and **reorder** them to set consult **priority**
  (higher dictionaries are shown first).

![](./preview/preview-6.png)

Each entry shows everything your dictionaries provide, rendered like Yomitan:

- **Furigana headwords** — the reading sits above the kanji as `<ruby>`, distributed
  per-segment so only the kanji carries furigana (食べる → 食[た]べる).
- **Structured glossaries** kept intact — numbered senses, lists, tables, ruby, and
  **embedded images** (e.g. stroke diagrams, pitch graphs) from the dictionary archive.
- **Frequency** badges, **pitch-accent** graphs (OJAD-style, with the downstep number),
  and **part-of-speech / commonness tags** colour-coded by category.
- **Kanji breakdown** — on/kun readings, meanings, stroke/grade/JLPT/frequency stats,
  and a kanji-only fallback when you hover a lone character.

Instead of a tokenizer, Aozora uses **rikai/Yomitan-style scanning**. For the text
starting at the cursor it tries successively shorter prefixes (longest first), runs
each through a **deinflection engine** — a direct port of Yomitan's ~140-rule Japanese
transform set — to recover candidate dictionary forms, then queries the enabled
dictionaries. A candidate only matches when its grammatical conditions are compatible
with the entry's part of speech, so a noun never matches a verb deinflection. The
longest prefix that hits anything wins, and its length drives the highlight. Inflected
words resolve to their dictionary form (e.g. 食べさせられた → 食べる) with the chain of
inflection reasons shown in the popup.

## Installation

### Download

Grab the latest installer from the
[**Releases**](https://github.com/meokisama/aozora/releases) page. On Windows, run the
`.exe` — the app installs and auto-updates on subsequent launches.

### Build from source

Requires **Node.js** and **Yarn**.

```bash
# Clone the repo
git clone https://github.com/meokisama/aozora.git
cd aozora

# Install dependencies
yarn install

# Run in development
yarn start

# Build a distributable installer (output in out/make/)
yarn make
```

## License

Aozora is licensed under the **GNU General Public License v3.0** (see [`LICENSE`](./LICENSE)).

It includes code ported from **[Yomitan](https://github.com/yomidevs/yomitan)**
(GPL-3.0) — the deinflection engine, the Japanese transform ruleset that power the hover dictionary. Yomitan dictionary files are created and
owned by their respective authors.
