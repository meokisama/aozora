import path from "path-browserify";
import { getManifestItems, getSpineItemRefs, type OpfContents } from "./opf";
import { buildDummyImage } from "./dummy-image";
import { clearAllBadImageRef, countCharacters, fixXHtmlHref, tagGaijiImages } from "./dom-utils";

export const PREPEND = "aoz-";

/** A flattened-tree section: a main chapter or a sub-section under one. */
export interface Section {
  reference: string;
  charactersWeight: number;
  label?: string;
  startCharacter?: number;
  characters?: number;
  parentChapter?: string;
}

export interface GeneratedHtml {
  element: HTMLDivElement;
  characters: number;
  sections: Section[];
}

// eslint-disable-next-line no-control-regex
const controlCharactersRegex = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/gim;
const htmlHexEntitiesRegex = /&#x([0-9A-Fa-f]+);/gim;
const htmlDecEntitiesRegex = /&#(\d+);/gim;
const selfClosingTagsRegex = /><\/(meta|link)>/gim;
const selfClosingContentTags = [
  "a",
  "body",
  "code",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "ol",
  "ops:default",
  "p",
  "rb",
  "rt",
  "ruby",
  "script",
  "span",
  "td",
  "th",
  "title",
];

// Precompiled once: XHTML lets these content tags self-close (`<p/>`), which HTML
// parsing mishandles, so each self-closing form is expanded to an explicit pair.
// Compiling per spine item (there can be hundreds) was pure waste.
const selfClosingContentTagRes = selfClosingContentTags.map((tag) => ({ tag, re: new RegExp(`<${tag}[^>]+?>`, "gim") }));

/**
 * Flattens the EPUB spine into one detached <div> tree (a wrapper per spine
 * item, id `aoz-<idref>`), replaces image references with dummy data-URIs
 * carrying the original path, and derives the chapter sections + total char count.
 */
export function generateHtml(data: Record<string, string | Blob>, contents: OpfContents, _contentsDirectory: string): GeneratedHtml {
  const manifestItems = getManifestItems(contents);
  const fallbackData = new Map<string, string>();
  let navKey = "";

  // Spine items are usually XHTML, but Open Manga Format (OMF) books reference
  // images directly from the spine. Track both so the flattener can synthesize a
  // wrapper for an image-in-spine page.
  const itemIdToImageRef: Record<string, string> = {};
  const itemIdToHtmlRef = manifestItems.reduce(
    (acc, item) => {
      if (item["@_fallback"]) fallbackData.set(item["@_id"], item["@_fallback"]);
      const mt = item["@_media-type"];
      if (mt === "application/xhtml+xml" || mt === "text/html") {
        acc[item["@_id"]] = item["@_href"];
        if (item["@_properties"] === "nav") navKey = item["@_href"];
      } else if (mt?.startsWith("image/")) {
        itemIdToImageRef[item["@_id"]] = item["@_href"];
      }
      return acc;
    },
    {} as Record<string, string>,
  );

  let tocData: { type: number; content: string } = { type: 3, content: "" };
  const blobLocations = Object.entries(data).reduce((acc, [key, value]) => {
    const isV2Toc = key.endsWith(".ncx") && !tocData.content;
    if (isV2Toc || navKey === key) {
      tocData = { type: isV2Toc ? 2 : 3, content: value as string };
    }
    if (value instanceof Blob) acc.push(key);
    return acc;
  }, [] as string[]);

  const parser = new DOMParser();
  const itemRefs = getSpineItemRefs(contents);
  const sectionData: Section[] = [];
  const result = document.createElement("div");

  let mainChapters: Section[] = [];
  // The blob key set is invariant across spine items — build it once, not per item.
  const blobKeys = new Set(blobLocations);

  // Table of contents → main chapters
  if (tocData.type && tocData.content) {
    let parsedToc = parser.parseFromString(tocData.content, "text/html");
    if (tocData.type === 3) {
      let nav = parsedToc.querySelector('nav[epub\\:type="toc"],nav#toc');
      if (!nav) parsedToc = parser.parseFromString(tocData.content, "text/xml");
      nav = parsedToc.querySelector('nav[epub\\:type="toc"],nav#toc');
      if (nav) {
        mainChapters = [...nav.querySelectorAll("a")].map((a) => ({
          reference: a.href,
          charactersWeight: 1,
          label: a.innerText,
        }));
      }
    } else {
      mainChapters = [...parsedToc.querySelectorAll("navPoint")].map((elm) => {
        const navLabel = elm.querySelector("navLabel text") as HTMLElement | null;
        const contentElm = elm.querySelector("content");
        return {
          reference: contentElm!.getAttribute("src") || "",
          charactersWeight: 1,
          label: navLabel?.innerText,
        };
      });
    }
  }

  if (mainChapters.length) {
    const firstChapterMatchIndex = itemRefs.findIndex((ref) =>
      mainChapters[0].reference.includes(itemIdToHtmlRef[ref["@_idref"].split("/").pop() || ""]),
    );
    if (firstChapterMatchIndex !== 0) {
      const firstRef = itemRefs[0]["@_idref"];
      const firstHTMLRef = itemIdToHtmlRef[firstRef];
      const fallbackRef = fallbackData.get(firstRef);
      const reference = firstHTMLRef || (fallbackRef ? itemIdToHtmlRef[fallbackRef] : firstHTMLRef);
      mainChapters.unshift({
        reference,
        charactersWeight: 1,
        label: "Preface",
        startCharacter: 0,
      });
    }
  }

  let currentMainChapter = mainChapters[0];
  let currentMainChapterId = currentMainChapter ? `${PREPEND}${itemRefs[0]["@_idref"]}` : "";
  let currentMainChapterIndex = 0;
  let previousCharacterCount = 0;
  let currentCharCount = 0;

  // Maps a spine item's href (full path and basename) to its wrapper id, so
  // whole-file in-content links (e.g. an embedded TOC page) resolve to a target.
  const hrefToWrapperId = new Map<string, string>();

  // Flatten each spine item
  itemRefs.forEach((item) => {
    let itemIdRef = item["@_idref"];
    let htmlHref = itemIdToHtmlRef[itemIdRef];
    if (!htmlHref && fallbackData.has(itemIdRef)) {
      itemIdRef = fallbackData.get(itemIdRef)!;
      htmlHref = itemIdToHtmlRef[itemIdRef];
    }
    // Image-in-spine (OMF): the spine item *is* an image with no XHTML wrapper.
    const imageHref = !htmlHref ? itemIdToImageRef[itemIdRef] : null;

    let innerHtml: string;
    let htmlClass = "";
    let bodyId = "";
    let bodyClass = "";

    if (imageHref) {
      // Synthesize a body holding just the image. The dummy placeholder carries
      // the manifest href (also the blob key), so buildReaderHtml swaps it for an
      // object URL at render time — same path as embedded images.
      htmlHref = imageHref; // let TOC / href resolution match the image item
      innerHtml = `<img class="aoz-spine-item-image" alt="" src="${buildDummyImage(imageHref)}" />`;
    } else {
      let contentToParse = (data[htmlHref] as string) || "";

      for (const { tag, re } of selfClosingContentTagRes) {
        contentToParse = contentToParse.replace(re, (m) => (m.endsWith("/>") ? `${m.slice(0, -2)}></${tag}>` : m));
      }

      contentToParse = contentToParse
        .replace(controlCharactersRegex, "")
        .replace(selfClosingTagsRegex, ">")
        .replace(htmlHexEntitiesRegex, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(htmlDecEntitiesRegex, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
        .replace("<!DOCTYPE html []>", "<!DOCTYPE html>")
        .trim();

      let parsedContent = parser.parseFromString(contentToParse, "text/html");
      let body: HTMLElement | null = parsedContent.body;
      if (!body?.childNodes?.length) {
        parsedContent = parser.parseFromString(contentToParse, "text/xml");
        body = parsedContent.querySelector("body");
        if (!body?.childNodes?.length) {
          throw new Error("Unable to find valid body content while parsing EPUB");
        }
      }

      htmlClass = parsedContent.querySelector("html")?.className || "";
      bodyId = body.id || "";
      bodyClass = body.className || "";

      // Resolve each image reference against its spine item's folder to the blob
      // key (manifest href), then swap the packed image for its dummy placeholder
      // *on the element itself*. Deliberately NOT a whole-HTML string replace: flat
      // numeric filenames like `1.jpg` are substrings of `11.jpg`/`110.jpg`, so a
      // global replaceAll chews the key out of already-substituted dummies (or hits
      // such a string in prose). Per-element matching is exact.
      for (const elm of [...body.querySelectorAll("image,img")]) {
        const attributes = elm.tagName.toLowerCase() === "image" ? elm.getAttributeNames().filter((attr) => attr.endsWith("href")) : ["src"];
        for (const attr of attributes) {
          const value = elm.getAttribute(attr);
          if (!value) continue;
          const resolved = path.join(path.dirname(htmlHref), value);
          let key: string | null = blobKeys.has(resolved) ? resolved : null;
          if (!key) {
            // The href may be percent-encoded (spaces etc.) while the blob key is not.
            try {
              const decoded = decodeURIComponent(resolved);
              if (blobKeys.has(decoded)) key = decoded;
            } catch {
              /* malformed escape — leave unresolved */
            }
          }
          elm.setAttribute(attr, key ? buildDummyImage(key) : resolved);
        }
      }

      innerHtml = body.innerHTML || "";
    }

    const childBodyDiv = document.createElement("div");
    childBodyDiv.className = `aoz-book-body-wrapper ${bodyClass}`;
    if (bodyId) childBodyDiv.id = bodyId;
    childBodyDiv.innerHTML = innerHtml;

    const childHtmlDiv = document.createElement("div");
    childHtmlDiv.className = `aoz-book-html-wrapper ${htmlClass}`;
    childHtmlDiv.appendChild(childBodyDiv);

    const childWrapperDiv = document.createElement("div");
    childWrapperDiv.id = `${PREPEND}${itemIdRef}`;
    childWrapperDiv.appendChild(childHtmlDiv);
    result.appendChild(childWrapperDiv);

    if (htmlHref) {
      hrefToWrapperId.set(htmlHref, childWrapperDiv.id);
      const base = htmlHref.split("/").pop();
      if (base) hrefToWrapperId.set(base, childWrapperDiv.id);
    }

    // Mark inline-glyph images before counting so each gaiji weighs one character
    // (and the reader/gallery treat them as glyphs, not illustrations).
    tagGaijiImages(childWrapperDiv);

    const elementCharCount = countCharacters(childWrapperDiv);
    currentCharCount += elementCharCount;
    if (!elementCharCount) {
      childHtmlDiv.classList.add("aoz-no-text");
      childBodyDiv.classList.add("aoz-no-text");
    }

    const mainChapterIndex = mainChapters.findIndex((chapter) => chapter.reference.includes(htmlHref.split("/").pop() || ""));
    const mainChapter = mainChapterIndex > -1 ? mainChapters[mainChapterIndex] : undefined;
    const characters = currentCharCount - previousCharacterCount;

    if (mainChapter) {
      const oldMainChapterIndex = currentMainChapterIndex;
      currentMainChapter = mainChapter;
      currentMainChapterIndex = sectionData.length;
      currentMainChapterId = `${PREPEND}${itemIdRef}`;
      sectionData.push({
        reference: currentMainChapterId,
        charactersWeight: characters || 1,
        label: currentMainChapter.label,
        startCharacter: currentMainChapterIndex
          ? (sectionData[oldMainChapterIndex].startCharacter || 0) + (sectionData[oldMainChapterIndex].characters || 0)
          : 0,
        characters,
      });
    } else if (currentMainChapter) {
      sectionData[currentMainChapterIndex].characters = (sectionData[currentMainChapterIndex].characters || 0) + characters;
      sectionData.push({
        reference: `${PREPEND}${itemIdRef}`,
        charactersWeight: characters || 1,
        parentChapter: currentMainChapterId,
      });
    }

    previousCharacterCount = currentCharCount;
  });

  clearAllBadImageRef(result);
  fixXHtmlHref(result);
  flattenAnchorHref(result, hrefToWrapperId);

  return {
    element: result,
    characters: currentCharCount,
    sections: sectionData.filter((s) => s.reference.startsWith(PREPEND)),
  };
}

/**
 * Rewrites internal <a> hrefs to in-document fragments resolvable against the
 * flattened tree: fragment links keep their fragment (original element ids are
 * preserved in the flattened HTML), whole-file links map to the target spine
 * item's wrapper id. External (protocol) links are left untouched.
 */
function flattenAnchorHref(el: Element, hrefToWrapperId: Map<string, string>): void {
  Array.from(el.getElementsByTagName("a")).forEach((tag) => {
    const oldHref = tag.getAttribute("href");
    if (!oldHref) return;
    // Leave absolute/protocol links (http:, mailto:, …) alone.
    if (/^[a-z][a-z0-9+.-]*:/i.test(oldHref)) return;

    const hashIndex = oldHref.indexOf("#");
    const fragment = hashIndex >= 0 ? oldHref.slice(hashIndex + 1) : "";
    if (fragment) {
      tag.setAttribute("href", `#${fragment}`);
      return;
    }

    const file = oldHref.trim();
    if (!file) return;
    const base = file.split("/").pop() || file;
    const wrapperId = hrefToWrapperId.get(file) || hrefToWrapperId.get(base) || hrefToWrapperId.get(decodeURIComponent(base));
    tag.setAttribute("href", `#${wrapperId || base}`);
  });
}
