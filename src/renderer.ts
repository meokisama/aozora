import "@fontsource/ibm-plex-sans/300.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "./index.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";

const root = createRoot(document.getElementById("root")!);
root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
