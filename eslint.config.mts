import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores([".vite/", "out/", "dist/", "ttsu/", "bibi/", "yomitan/"]),

  { files: ["**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"], plugins: { js }, extends: ["js/recommended"] },
  tseslint.configs.recommended,

  // Node: main + preload + root config files
  {
    files: ["src/main/**", "src/preload/**", "*.{ts,mts,cts}", "vite*.config.ts"],
    languageOptions: { globals: globals.node },
  },
  // Browser: renderer
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/main/**", "src/preload/**"],
    languageOptions: { globals: globals.browser },
  },

  pluginReact.configs.flat.recommended,
  pluginReact.configs.flat["jsx-runtime"], // React 19: disable react-in-jsx-scope
  { settings: { react: { version: "19" } } },
]);
