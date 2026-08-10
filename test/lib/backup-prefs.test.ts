// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { applyPrefs, dumpPrefs } from "@/lib/backup-prefs";

describe("backup prefs", () => {
  beforeEach(() => localStorage.clear());

  it("dumps only the app's own keys", () => {
    localStorage.setItem("aozora-reader-settings", '{"fontSize":21}');
    localStorage.setItem("aozora-anki", '{"deck":"Mining"}');
    localStorage.setItem("theme", "dark"); // next-themes, not ours
    expect(dumpPrefs()).toEqual({
      "aozora-reader-settings": '{"fontSize":21}',
      "aozora-anki": '{"deck":"Mining"}',
    });
  });

  it("replaces existing prefs rather than merging over them", () => {
    localStorage.setItem("aozora-reader-settings", '{"fontSize":40}');
    localStorage.setItem("aozora-tts", '{"speed":2}');
    applyPrefs({ "aozora-reader-settings": '{"fontSize":21}' });
    expect(localStorage.getItem("aozora-reader-settings")).toBe('{"fontSize":21}');
    expect(localStorage.getItem("aozora-tts")).toBeNull();
  });

  it("leaves foreign keys alone and refuses to write them", () => {
    localStorage.setItem("theme", "dark");
    applyPrefs({ "aozora-anki": "{}", evil: "payload" });
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(localStorage.getItem("evil")).toBeNull();
  });

  it("round-trips", () => {
    const prefs = { "aozora-reader-settings": '{"fontSize":21}', "aozora-stats-prefs": '{"goal":3600}' };
    applyPrefs(prefs);
    expect(dumpPrefs()).toEqual(prefs);
  });
});
