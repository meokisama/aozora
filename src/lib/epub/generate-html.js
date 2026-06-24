import path from "path-browserify";
import { getManifestItems, getSpineItemRefs } from "./opf";
import { buildDummyImage } from "./dummy-image";
import { clearAllBadImageRef, countCharacters, fixXHtmlHref } from "./dom-utils";

export const PREPEND = "aoz-";

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

/**
 * Flattens the whole EPUB spine into a single detached <div> tree (one wrapper
 * per spine item, id `aoz-<idref>`), replaces image references with dummy
 * data-URIs that carry the original path, and derives the chapter sections +
 * total character count. Import-fix handling is always applied at its most
 * thorough ("extended") behavior.
 *
 * @returns {{ element: HTMLDivElement, characters: number, sections: object[] }}
 */
export function generateHtml(data, contents, contentsDirectory) {
  const manifestItems = getManifestItems(contents);
  const fallbackData = new Map();
  let navKey = "";

  // Spine items are usually XHTML documents, but Open Manga Format (OMF) books
  // reference images directly from the spine. Track both so the flattener can
  // synthesize a wrapper for an image-in-spine page.
  const itemIdToImageRef = {};
  const itemIdToHtmlRef = manifestItems.reduce((acc, item) => {
    if (item["@_fallback"]) fallbackData.set(item["@_id"], item["@_fallback"]);
    const mt = item["@_media-type"];
    if (mt === "application/xhtml+xml" || mt === "text/html") {
      acc[item["@_id"]] = item["@_href"];
      if (item["@_properties"] === "nav") navKey = item["@_href"];
    } else if (mt?.startsWith("image/")) {
      itemIdToImageRef[item["@_id"]] = item["@_href"];
    }
    return acc;
  }, {});

  let tocData = { type: 3, content: "" };
  const blobLocations = Object.entries(data).reduce((acc, [key, value]) => {
    const isV2Toc = key.endsWith(".ncx") && !tocData.content;
    if (isV2Toc || navKey === key) {
      tocData = { type: isV2Toc ? 2 : 3, content: value };
    }
    if (value instanceof Blob) acc.push(key);
    return acc;
  }, []);

  const parser = new DOMParser();
  const itemRefs = getSpineItemRefs(contents);
  const sectionData = [];
  const result = document.createElement("div");

  let mainChapters = [];
  let firstChapterMatchIndex = -1;
  const selfClosingContentTagsToFix = [...selfClosingContentTags, "a"];

  // --- Table of contents → main chapters ---------------------------------
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
        const navLabel = elm.querySelector("navLabel text");
        const contentElm = elm.querySelector("content");
        return {
          reference: contentElm.getAttribute("src"),
          charactersWeight: 1,
          label: navLabel.innerText,
        };
      });
    }
  }

  if (mainChapters.length) {
    firstChapterMatchIndex = itemRefs.findIndex((ref) => mainChapters[0].reference.includes(itemIdToHtmlRef[ref["@_idref"].split("/").pop() || ""]));
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
  // in-content links that point at a whole file — e.g. an embedded TOC page —
  // can be resolved to a scroll target.
  const hrefToWrapperId = new Map();

  // --- Flatten each spine item -------------------------------------------
  itemRefs.forEach((item) => {
    let itemIdRef = item["@_idref"];
    let htmlHref = itemIdToHtmlRef[itemIdRef];
    if (!htmlHref && fallbackData.has(itemIdRef)) {
      itemIdRef = fallbackData.get(itemIdRef);
      htmlHref = itemIdToHtmlRef[itemIdRef];
    }
    // Image-in-spine (OMF): the spine item *is* an image with no XHTML wrapper.
    const imageHref = !htmlHref ? itemIdToImageRef[itemIdRef] : null;

    let innerHtml;
    let htmlClass = "";
    let bodyId = "";
    let bodyClass = "";

    if (imageHref) {
      // Synthesize a body holding just the image. The dummy placeholder carries
      // the manifest href (which is also the blob key), so buildReaderHtml swaps
      // it for an object URL at render time — same path as embedded images.
      htmlHref = imageHref; // let TOC / href resolution match the image item
      innerHtml = `<img class="aoz-spine-item-image" alt="" src="${buildDummyImage(imageHref)}" />`;
    } else {
      let contentToParse = data[htmlHref] || "";

      for (const tagMatch of selfClosingContentTagsToFix) {
        const matches = contentToParse.match(new RegExp(`<${tagMatch}[^>]+?>`, "gim")) || [];
        for (const match of matches) {
          if (match.endsWith("/>")) {
            contentToParse = contentToParse.replace(match, `${match.slice(0, -2)}></${tagMatch}>`);
          }
        }
      }

      contentToParse = contentToParse
        .replace(controlCharactersRegex, "")
        .replace(selfClosingTagsRegex, ">")
        .replace(htmlHexEntitiesRegex, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(htmlDecEntitiesRegex, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
        .replace("<!DOCTYPE html []>", "<!DOCTYPE html>")
        .trim();

      let parsedContent = parser.parseFromString(contentToParse, "text/html");
      let body = parsedContent.body;
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

      for (const elm of [...body.querySelectorAll("image,img")]) {
        const attributes = elm.tagName.toLowerCase() === "image" ? elm.getAttributeNames().filter((attr) => attr.endsWith("href")) : ["src"];
        for (const attr of attributes) {
          const value = elm.getAttribute(attr);
          if (value) {
            elm.setAttribute(attr, path.join(path.dirname(htmlHref), value));
          }
        }
      }

      innerHtml = body.innerHTML || "";
      // Both sides are normalized relative to the OPF directory: the image
      // href above is `path.join(dirname(htmlHref), value)` and the blob key is
      // the manifest href. So match the blob key directly — the old
      // `relative(contentsDirectory, …)` indirection mis-resolved to a `../`
      // prefix whenever the OPF sat two or more directories deep (e.g.
      // `OPS/content/`), leaving full-page illustrations unswapped → blank pages.
      blobLocations.forEach((blobLocation) => {
        innerHtml = innerHtml.replaceAll(blobLocation, buildDummyImage(blobLocation));
      });
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
        startCharacter: currentMainChapterIndex ? sectionData[oldMainChapterIndex].startCharacter + sectionData[oldMainChapterIndex].characters : 0,
        characters,
      });
    } else if (currentMainChapter) {
      sectionData[currentMainChapterIndex].characters += characters;
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
 * Rewrites every internal <a> href to a single in-document fragment so the
 * reader can resolve it against the flattened tree. Links with a fragment keep
 * the fragment (the original element id is preserved in the flattened HTML);
 * whole-file links resolve to the target spine item's wrapper id. External
 * (protocol) links are left untouched.
 */
function flattenAnchorHref(el, hrefToWrapperId) {
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
