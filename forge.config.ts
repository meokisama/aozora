import type { ForgeConfig } from "@electron-forge/shared-types";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: "assets/app",
    executableName: "aozora",
    ignore: (file) => {
      if (!file) return false;
      if (file.startsWith("/.vite")) return false;
      if (file === "/node_modules") return false;
      if (/^\/node_modules\/(better-sqlite3|bindings|file-uri-to-path)(\/|$)/.test(file)) return false;
      return true;
    },
    appCopyright: "Copyright © 2026 Meoki",
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        productName: "Aozora",
        executableName: "aozora",
        loadingGif: "./src/assets/loading.gif",
        setupIcon: "assets/app.ico",
        iconUrl: "https://cloud.meoki.vn/aozora.ico",
        authors: "Meoki",
        description:
          "Desktop EPUB reader for Japanese light novels & manga — tategaki, furigana mode, full-text search, hover dictionary and reading stats.",
      },
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"],
      config: {},
    },
    {
      name: "@electron-forge/maker-deb",
      platforms: ["linux"],
      config: {
        options: {
          icon: "assets/app.png",
          productName: "Aozora",
          executableName: "aozora",
          maintainer: "Meoki",
          description:
            "Desktop EPUB reader for Japanese light novels & manga — tategaki, furigana mode, full-text search, hover dictionary and reading stats.",
        },
      },
    },
    {
      name: "@electron-forge/maker-rpm",
      config: {
        options: {
          productName: "Aozora",
          executableName: "aozora",
          maintainer: "Meoki",
          description:
            "Desktop EPUB reader for Japanese light novels & manga — tategaki, furigana mode, full-text search, hover dictionary and reading stats.",
        },
      },
    },
  ],
  plugins: [
    // Unpacks native .node modules (better-sqlite3) out of the asar archive.
    {
      name: "@electron-forge/plugin-auto-unpack-natives",
      config: {},
    },
    {
      name: "@electron-forge/plugin-vite",
      config: {
        // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
        // If you are familiar with Vite configuration, it will look really familiar.
        build: [
          {
            // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
            entry: "src/main.ts",
            config: "vite.main.config.ts",
            target: "main",
          },
          {
            // Dictionary-import utility process, forked from the main process so a
            // heavy import never blocks the UI. Emitted next to main.js.
            entry: "src/main/services/dictionary-import.worker.ts",
            config: "vite.worker.config.ts",
            target: "main",
          },
          {
            entry: "src/preload.ts",
            config: "vite.preload.config.ts",
            target: "preload",
          },
        ],
        renderer: [
          {
            name: "main_window",
            config: "vite.renderer.config.ts",
          },
        ],
      },
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
