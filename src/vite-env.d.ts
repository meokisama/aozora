/// <reference types="vite/client" />

// Globals injected by @electron-forge/plugin-vite at build time. The renderer's
// main.ts loads either the dev-server URL or the bundled index.html via these.
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;
