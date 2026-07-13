import { WEB_UI_CLIENT_BINDINGS_SCRIPT } from "./WebUiClientBindings.js";
import { WEB_UI_CLIENT_FOUNDATION_SCRIPT } from "./WebUiClientFoundation.js";
import { WEB_UI_CLIENT_MESSAGES_SCRIPT } from "./WebUiClientMessages.js";
import { WEB_UI_CLIENT_SESSION_SCRIPT } from "./WebUiClientSession.js";

const WEB_UI_CLIENT_PREAMBLE = String.raw`(() => {
  'use strict';

`;

const WEB_UI_CLIENT_EPILOGUE = String.raw`})();
`;

/** Browser-side controller served as a same-origin static asset. */
export const WEB_UI_CLIENT_SCRIPT = [
  WEB_UI_CLIENT_PREAMBLE,
  WEB_UI_CLIENT_FOUNDATION_SCRIPT,
  WEB_UI_CLIENT_MESSAGES_SCRIPT,
  WEB_UI_CLIENT_SESSION_SCRIPT,
  WEB_UI_CLIENT_BINDINGS_SCRIPT,
  WEB_UI_CLIENT_EPILOGUE,
].join("");
