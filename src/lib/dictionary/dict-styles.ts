/**
 * Injects each imported dictionary's custom CSS (its `styles.css`) into the
 * document, scoped to that dictionary so it only styles glosses tagged with the
 * matching `data-aoz-dict` marker — never the rest of the app.
 *
 * Yomitan dictionaries like Jitendex carry no inline styling; their layout
 * (tag badges, cross-reference/example boxes, list markers) lives entirely in
 * `styles.css`, which targets the `data-sc-*` attributes the structured-content
 * renderer emits. The popup renders outside the reader's shadow root, so the
 * sheet is scoped here with `@scope` rather than relying on shadow isolation.
 */

const STYLE_ATTR = "data-aoz-dict-style";

/** The marker attribute the popup puts on a gloss container so scoped CSS applies. */
export const DICT_SCOPE_ATTR = "data-aoz-dict";

/** A `<style>` node holding one dictionary's CSS, scoped to its glosses. */
function styleNode(dictId: string, css: string): HTMLStyleElement {
  const el = document.createElement("style");
  el.setAttribute(STYLE_ATTR, dictId);
  // Limit every rule to descendants of the dict's gloss container. The author's
  // sheet is kept verbatim (it already uses nesting / data-sc-* selectors).
  el.textContent = `@scope ([${DICT_SCOPE_ATTR}="${CSS.escape(dictId)}"]) {\n${css}\n}`;
  return el;
}

/**
 * Re-syncs the injected dictionary stylesheets to match what's imported. Cheap
 * and idempotent: call it on startup and after an import/removal.
 */
export async function syncDictionaryStyles(): Promise<void> {
  let entries: { dictId: string; css: string }[];
  try {
    entries = await window.electronAPI.dictionary.getStyles();
  } catch {
    return; // leave whatever is already injected
  }
  for (const old of document.head.querySelectorAll(`style[${STYLE_ATTR}]`)) old.remove();
  for (const { dictId, css } of entries) {
    if (css.trim()) document.head.appendChild(styleNode(dictId, css));
  }
}
