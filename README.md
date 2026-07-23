<p align="center">
    <img style="width:250px;" src="./src/assets/aozora-logo.png" />
</p>

<h4 align="center">青空の下で、物語が始まる。</h4>

<p align="center">
    <img src="https://img.shields.io/badge/license-GPL--3.0-blue.svg"/>
    <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg"/>
</p>

## About

**Aozora 青空** is a desktop EPUB reader made for Japanese learners to read light novels and manga, with a built-in **[Yomitan dictionary](#dictionary)**, **[Anki flashcard mining](#anki)**, **[waifu voice read-aloud (TTS)](#voice-waifu-tts)** with karaoke highlight, full-text search, reading stats, and more.

> **Built for Japanese EPUB.** The parser and reader are tuned for the conventions of
> these books. Other EPUBs still open and read fine, they just won't get the Japanese-specific handling.

![](./preview/preview-0.png)
![](./preview/preview-2.png)
![](./preview/preview-3.png)
![](./preview/preview-4.png)
![](./preview/preview-5.png)

## Features

- **Flexible layout & text direction**: read in **Paginated** or **Continuous** (native
  scroll) mode, with horizontal or vertical (tategaki, vertical-rl) text direction. When
  reading horizontally, you can adjust the number of **columns per page** (Paginated) or
  the **side margins** (Continuous).
- **Furigana customization**: rendered with native `<ruby>`, with five handy display
  modes: **show**, **hide**, **dimmed**, **reveal-on-click**, or **reveal-on-hover/click**.
- **Footnote popups**: click the author's note reference to open a small panel right there,
  without jumping to the end of the chapter.
- **Full-text search**: quickly look up any keyword within the book you're reading.
- [**Dictionary**](#dictionary): hover a word and hold the trigger key (**Shift** by
  default) to open a Yomitan-style lookup popup. It shows full furigana, structured
  glossaries (numbered senses, tables, images), commonness, example sentences, pitch-accent
  graphs, and kanji breakdowns.
- **Illustration gallery**: browse every image in the book in a full-screen viewer, and
  click an image to jump straight to its position in the text and keep reading.
- **Reading statistics**: automatically tracks your reading time and compiles it into a
  visual dashboard — a GitHub-style heatmap, reading streaks, a daily goal, milestones, and
  per-book totals.
- **Full-screen reading**: a distraction-free mode, one click from the toolbar or the
  **F11** key.
- [**Anki flashcard mining**](#anki): create Anki cards instantly from the dictionary popup
  via **AnkiConnect**. It automatically maps the word, reading, definition, containing
  sentence, and a screenshot of the passage to the right fields in your note.
- [**Voice waifu (TTS)**](#voice-waifu-tts): listen to natural Japanese pronunciation via
  **VOICEVOX**. Click the speaker icon on a dictionary entry to hear a single word, or hold
  a key + hover to hear a whole sentence with a **karaoke-style highlight** synced to the
  voice.
- **Discord Rich Presence**: automatically shows the book you're reading on your Discord profile.

  ![](/preview/preview-7.png)

## Dictionary

A built-in **hover dictionary with support for Yomitan dictionaries** lets you read with
instant lookups, no external app, no copy-paste. Hover a word in the reader and the
matching entry pops up right next to it.

- To use it, open the **Dictionaries** page (sidebar) and click **Import** to add
  dictionaries. It supports `.zip` files in Yomitan/Yomichan **format v3** such as JMdict,
  Jitendex, and so on. Note that Aozora ships no bundled dictionary data — you bring your
  own, or install one of the recommended dictionaries offered right there in the app.
- On the **Dictionaries** page you can toggle the whole lookup feature, change the trigger
  key, enable/disable each dictionary individually, and drag to **reorder** them to set
  **priority** (dictionaries higher up show their results first).

![](./preview/preview-6.png)

Each entry shows everything your dictionaries provide, rendered like Yomitan:

- **Furigana headwords**: the reading sits above the kanji as `<ruby>`, distributed
  per-segment so only the kanji carries furigana (食べる → 食[た]べる).
- **Structured glossaries** kept intact: numbered senses, lists, tables, ruby, and
  **embedded images** (e.g. stroke diagrams, pitch graphs) from the dictionary archive.
- **Frequency** badges, **pitch-accent** graphs (OJAD-style, with the downstep number),
  and **part-of-speech / commonness tags** colour-coded by category.
- **Kanji breakdown**: on/kun readings, meanings, stroke/grade/JLPT/frequency stats,
  and a kanji-only fallback when you hover a lone character.

Instead of a tokenizer, Aozora uses **rikai/Yomitan-style scanning**. For the text
starting at the cursor it tries successively shorter prefixes (longest first), runs
each through a **deinflection engine**, a direct port of Yomitan's ~140-rule Japanese
transform set, to recover candidate dictionary forms, then queries the enabled
dictionaries. A candidate only matches when its grammatical conditions are compatible
with the entry's part of speech, so a noun never matches a verb deinflection. The
longest prefix that hits anything wins, and its length drives the highlight. Inflected
words resolve to their dictionary form (e.g. 食べさせられた → 食べる) with the chain of
inflection reasons shown in the popup.

## Anki

Turn the words you look up into flashcards without leaving the reader. Aozora talks to
Anki through the **[AnkiConnect](https://ankiweb.net/shared/info/2055492159)** add-on,
an **＋ Anki** button appears on every dictionary
entry, and one click builds a card from what's on screen.

**Setup** (once): install the AnkiConnect add-on in Anki, restart the app and keep Anki running, then
open **Aozora Settings → Anki**:

- **Enable** the integration and hit **Test** to connect (this loads your decks and note
  types).
- Pick the target **deck** and **note type**, then map each of that note type's **fields**
  to a piece of card content. Aozora guesses sensible defaults from the field names
  (e.g. a field called _Sentence_ → the sentence, _Meaning_ → the definition).
- Optionally set **tags**, choose whether to **allow or prevent duplicates**, and toggle
  the **screenshot** (with an adjustable image quality).

The content you can map onto a field:

| Marker                           | What it inserts                                                    |
| -------------------------------- | ------------------------------------------------------------------ |
| **Word** / **Reading**           | the dictionary headword and its kana reading                       |
| **Furigana**                     | the reading over the kanji, as `<ruby>` or as plain `漢字[かんじ]` |
| **Definition**                   | the glossary, kept as structured HTML or flattened to plain text   |
| **Sentence**                     | the full sentence the word was found in (furigana excluded)        |
| **Pitch accent** / **Frequency** | the downstep number(s) and frequency rating(s)                     |
| **Book title** / **Book author** | the current book's metadata                                        |
| **Screenshot**                   | an image of the passage, cropped to the sentence's paragraph       |

**Mining**: in the reader, hover a word and hold the trigger key as usual, then click
**＋ Anki** in the popup. The button shows a check when the card is added; if the note
already exists (and duplicates are prevented), it says so instead. The book's title is
also attached as a tag automatically, so cards stay grouped by source.

## Voice waifu (TTS)

Aozora can speak the Japanese you're reading, a single word, or a whole sentence, using
**[VOICEVOX](https://voicevox.hiroshiba.jp/)** for the voice.

**VOICEVOX** is a free Japanese text-to-speech engine with a cast of expressive character
voices (ずんだもん, 四国めたん, and many more). It runs **entirely on your machine**: there's
no account, no network round-trip, and nothing you read leaves your computer. The
downloadable app also exposes a small local HTTP engine, and that's what Aozora talks to,
so its synthesis quality is far beyond what a browser's built-in speech offers. Aozora uses
**VOICEVOX exclusively**; there is no lower-quality fallback engine, so it's required for
the read-aloud feature.

**Setup** (once): download and run **VOICEVOX** from
[voicevox.hiroshiba.jp](https://voicevox.hiroshiba.jp/), then open
**Aozora Settings → Read aloud**:

- **Enable** read aloud and hit **Test** to connect to the engine (default
  `http://127.0.0.1:50021`). This loads the available voices.
- Pick a **voice** and set the **speed**. A quick preview button lets you hear the choice.
- Choose the **Read sentence** hotkey, **Alt** by default, or **Ctrl** / **Shift** (kept
  separate from the dictionary's lookup key so the two gestures never collide).

<video src="https://github.com/user-attachments/assets/29e5493c-92c6-4ee5-b102-ad7f5a340336" controls width="100%"></video>

Two ways to listen, both in the reader:

- **A word**: in the dictionary popup, click the 🔊 button on any entry to hear that
  headword's reading.
- **A sentence**: **hold the read-sentence hotkey and hover a sentence**; a floating
  **Read sentence** button appears next to the cursor. Click it and Aozora speaks the whole
  sentence while a **karaoke-style highlight grows across the text in time with the audio**,
  driven by VOICEVOX's per-mora timings. The highlight paints only the base text, never the
  furigana above it.

## Installation

### Download

Grab the latest installer from the
[**Releases**](https://github.com/meokisama/aozora/releases) page. On Windows, run the
`.exe`, the app installs and auto-updates on subsequent launches.

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
(GPL-3.0), the deinflection engine, the Japanese transform ruleset that power the hover dictionary. Yomitan dictionary files are created and
owned by their respective authors.
