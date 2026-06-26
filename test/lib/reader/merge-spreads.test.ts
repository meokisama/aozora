// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mergeSpreadSections } from "@/lib/reader/merge-spreads";

function container(ids: string[]) {
  const el = document.createElement("div");
  el.innerHTML = ids.map((id: string) => `<div id="${id}"><span id="inner-${id}">x</span></div>`).join("");
  return el;
}

describe("mergeSpreadSections", () => {
  it("merges a pair into one .aoz-spread section, opener first", () => {
    const el = container(["aoz-p-001", "aoz-p-002", "aoz-p-003"]);
    mergeSpreadSections(el, [["aoz-p-001", "aoz-p-002"]], "rtl");

    const kids = Array.from(el.children);
    expect(kids).toHaveLength(2); // [spread(001+002), 003]
    const spread = kids[0];
    expect(spread.classList.contains("aoz-spread")).toBe(true);
    expect(spread.classList.contains("aoz-no-text")).toBe(true);
    expect((spread as HTMLElement).dataset.ppd).toBe("rtl");
    expect(Array.from(spread.children).map((c) => c.id)).toEqual(["aoz-p-001", "aoz-p-002"]);
    expect(kids[1].id).toBe("aoz-p-003");
  });

  it("keeps the original wrapper ids resolvable for TOC/href jumps", () => {
    const el = container(["aoz-p-001", "aoz-p-002"]);
    mergeSpreadSections(el, [["aoz-p-001", "aoz-p-002"]], "rtl");
    expect(el.querySelector("#aoz-p-002")).toBeTruthy();
    expect(el.querySelector("#inner-aoz-p-002")).toBeTruthy();
  });

  it("preserves spine position (spread sits where the opener was)", () => {
    const el = container(["aoz-text", "aoz-p-001", "aoz-p-002", "aoz-tail"]);
    mergeSpreadSections(el, [["aoz-p-001", "aoz-p-002"]], "ltr");
    const ids = Array.from(el.children).map((c) => c.id);
    expect(ids).toEqual(["aoz-text", "aoz-spread-p-001", "aoz-tail"]);
  });

  it("is a no-op without pairs", () => {
    const el = container(["a", "b"]);
    mergeSpreadSections(el, null, "rtl");
    expect(el.children).toHaveLength(2);
    mergeSpreadSections(el, [], "rtl");
    expect(el.children).toHaveLength(2);
  });

  it("skips a pair whose members are missing", () => {
    const el = container(["aoz-p-001"]);
    mergeSpreadSections(el, [["aoz-p-001", "aoz-p-002"]], "rtl");
    // closer absent → no merge, original left intact
    expect(el.querySelector(".aoz-spread")).toBeNull();
    expect(el.children).toHaveLength(1);
  });
});
