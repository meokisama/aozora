import { contextBridge } from "electron";
import { windowApi } from "./preload/window.js";
import { libraryApi } from "./preload/library.js";
import { statsApi } from "./preload/stats.js";
import { dictionaryApi } from "./preload/dictionary.js";

// Curated `window.electronAPI` surface; add new feature namespaces here.
contextBridge.exposeInMainWorld("electronAPI", {
  window: windowApi,
  library: libraryApi,
  stats: statsApi,
  dictionary: dictionaryApi,
});
