import { describe, it, expect } from "vitest";
import { resolveCoverHref } from "@/lib/epub/metadata";
import { xmlParser, getManifestItems, getSpineItemRefs, getMetadata, getMetaKey } from "@/lib/epub/opf";

/** Resolve a cover href straight from an OPF string, the way extractEpubMetadata does. */
function coverOf(opf: string) {
  const contents = xmlParser.parse(opf);
  return resolveCoverHref(getManifestItems(contents), getMetadata(contents), getMetaKey(contents), getSpineItemRefs(contents));
}

describe("resolveCoverHref", () => {
  it("uses the EPUB3 cover-image property", () => {
    const opf = `<?xml version="1.0"?>
    <package>
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"></metadata>
      <manifest>
        <item id="c" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
        <item id="p1" href="text/p1.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="p1"/></spine>
    </package>`;
    expect(coverOf(opf)).toBe("images/cover.jpg");
  });

  it("uses the EPUB2 <meta name=cover> id", () => {
    const opf = `<?xml version="1.0"?>
    <package>
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <meta name="cover" content="cov"/>
      </metadata>
      <manifest>
        <item id="cov" href="img/c.png" media-type="image/png"/>
        <item id="p1" href="p1.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="p1"/></spine>
    </package>`;
    expect(coverOf(opf)).toBe("img/c.png");
  });

  it("falls back to the first spine item when it is an image (OMF / fixed-layout)", () => {
    // No cover-image property, no <meta name=cover> — the first spine item is
    // the cover image (Open Manga Format).
    const opf = `<?xml version="1.0"?>
    <package>
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <meta property="omf:version">omf.1.0</meta>
      </metadata>
      <manifest>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="image001" href="images/cover.jpg" media-type="image/jpeg"/>
        <item id="image002" href="images/p01.jpg" media-type="image/jpeg"/>
      </manifest>
      <spine page-progression-direction="rtl">
        <itemref idref="image001"/>
        <itemref idref="image002"/>
      </spine>
    </package>`;
    expect(coverOf(opf)).toBe("images/cover.jpg");
  });

  it("returns null when the first spine item is not an image and no cover is declared", () => {
    const opf = `<?xml version="1.0"?>
    <package>
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"></metadata>
      <manifest>
        <item id="p1" href="text/p1.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="p1"/></spine>
    </package>`;
    expect(coverOf(opf)).toBeNull();
  });
});
