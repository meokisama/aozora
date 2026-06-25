// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge } from 'electron';
import { windowApi } from './preload/window.js';
import { libraryApi } from './preload/library.js';
import { statsApi } from './preload/stats.js';
import { dictionaryApi } from './preload/dictionary.js';

// Expose a curated API to the renderer as `window.electronAPI`.
// Add new feature namespaces here, importing each from `./preload/<module>.js`.
contextBridge.exposeInMainWorld('electronAPI', {
  window: windowApi,
  library: libraryApi,
  stats: statsApi,
  dictionary: dictionaryApi,
});
