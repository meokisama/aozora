// Ambient declarations for third-party modules that ship no types.

// path-browserify mirrors Node's `path` API, so reuse those types verbatim.
declare module "path-browserify" {
  import path from "path";
  export default path;
}

// Sets a boolean flag for Squirrel.Windows install/update lifecycle events.
declare module "electron-squirrel-startup" {
  const started: boolean;
  export default started;
}
