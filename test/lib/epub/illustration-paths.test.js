// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { xmlParser } from "@/lib/epub/opf";
import { generateHtml, PREPEND } from "@/lib/epub/generate-html";

function opf(htmlHref, imgHref) {
  return xmlParser.parse(`<?xml version="1.0"?>
<package>
  <manifest>
    <item id="p1" href="${htmlHref}" media-type="application/xhtml+xml"/>
    <item id="i1" href="${imgHref}" media-type="image/jpeg"/>
  </manifest>
  <spine><itemref idref="p1"/></spine>
</package>`);
}

// Classic JP LN full-page illustration: SVG wrapper + <image xlink:href>.
function svgPage(ref) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body><div class="illust">
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="100%" height="100%" viewBox="0 0 1127 1600" preserveAspectRatio="xMidYMid meet">
<image width="1127" height="1600" xlink:href="${ref}"/>
</svg>
</div></body></html>`;
}

function imgPage(ref) {
  return `<html><body><div class="illust"><img src="${ref}"/></div></body></html>`;
}

function swappedHref(data, contents, contentsDir) {
  const { element } = generateHtml(data, contents, contentsDir);
  const node = element.querySelector(`#${PREPEND}p1 image, #${PREPEND}p1 img`);
  if (!node) return null;
  return node.getAttribute("href") || node.getAttribute("xlink:href") || node.getAttribute("src");
}

// Illustration src/xlink:href must be swapped for the dummy placeholder carrying
// the blob key, regardless of how deep the OPF sits. Image-only pages used to go
// blank when the OPF lived two or more directories deep (e.g. `OPS/content/`)
// because the blob key was mis-resolved with a spurious `../` prefix and never
// matched. Both the normalized href and the blob key are relative to the OPF
// directory, so they are matched directly now.
describe("illustration path resolution across OPF directory depths", () => {
  const CASES = [
    { name: "OPF at root, svg", dir: ".", html: "xhtml/p.xhtml", img: "image/i.jpg", ref: "../image/i.jpg", page: svgPage },
    { name: "OPF 1 level deep, svg", dir: "OEBPS", html: "xhtml/p.xhtml", img: "image/i.jpg", ref: "../image/i.jpg", page: svgPage },
    { name: "OPF 2 levels deep, svg", dir: "OPS/content", html: "xhtml/p.xhtml", img: "image/i.jpg", ref: "../image/i.jpg", page: svgPage },
    { name: "OPF 2 levels deep, img", dir: "item/standard", html: "xhtml/p.xhtml", img: "image/i.jpg", ref: "../image/i.jpg", page: imgPage },
    { name: "image beside the xhtml", dir: "OEBPS", html: "p.xhtml", img: "i.jpg", ref: "i.jpg", page: imgPage },
    { name: "deeply nested xhtml", dir: "OEBPS", html: "text/sub/p.xhtml", img: "images/i.jpg", ref: "../../images/i.jpg", page: imgPage },
  ];

  for (const c of CASES) {
    it(c.name, () => {
      const data = {
        [c.html]: c.page(c.ref),
        [c.img]: new Blob(["x"], { type: "image/jpeg" }),
      };
      expect(swappedHref(data, opf(c.html, c.img), c.dir)).toContain(`aoz:${c.img}`);
    });
  }
});
