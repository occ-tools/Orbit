/** Internal entry point for Orbit's loopback-only Web UI runtime. */
export {
  parseWebUiArgs,
  startOrbitWebUi,
  stopOrbitWebUi,
} from "./WebUiServer.js";
export type {
  WebUiHandle,
  WebUiOptions,
  WebUiSettingsPatch,
} from "./WebUiContracts.js";
