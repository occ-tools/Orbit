/** Design tokens, theme variants, and shared browser defaults. */
export const WEB_UI_FOUNDATION_STYLES = String.raw`
:root {
  color-scheme: light;
  --canvas: #f7f6f2;
  --sidebar: #efeee9;
  --surface: #ffffff;
  --surface-raised: #ffffff;
  --surface-subtle: #f3f2ee;
  --surface-hover: #e9e7e1;
  --ink: #24231f;
  --ink-strong: #151512;
  --muted: #6f6d65;
  --faint: #98958b;
  --border: rgba(42, 40, 34, 0.11);
  --border-strong: rgba(42, 40, 34, 0.2);
  --accent: #d96b3b;
  --accent-strong: #b94f25;
  --accent-soft: #f6e7df;
  --success: #3f7b58;
  --success-soft: #e7f1e9;
  --warning: #a66a1f;
  --warning-soft: #f6eddc;
  --danger: #b74e4e;
  --danger-soft: #f7e5e4;
  --code: #1d1f21;
  --code-ink: #e8e8e3;
  --shadow-sm: 0 1px 2px rgba(30, 28, 24, 0.05);
  --shadow-md: 0 12px 36px rgba(34, 30, 22, 0.1), 0 2px 8px rgba(34, 30, 22, 0.05);
  --shadow-lg: 0 24px 64px rgba(26, 23, 18, 0.16), 0 4px 16px rgba(26, 23, 18, 0.07);
  --sidebar-width: 248px;
  --content-width: 900px;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 18px;
  --radius-xl: 24px;
  --font-sans: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", sans-serif;
  --font-mono: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --canvas: #151514;
  --sidebar: #1b1b19;
  --surface: #1d1d1b;
  --surface-raised: #242421;
  --surface-subtle: #272724;
  --surface-hover: #30302c;
  --ink: #deddd7;
  --ink-strong: #f5f4ef;
  --muted: #a09e95;
  --faint: #74726a;
  --border: rgba(241, 238, 226, 0.1);
  --border-strong: rgba(241, 238, 226, 0.18);
  --accent: #e4875f;
  --accent-strong: #f09a72;
  --accent-soft: #3b2922;
  --success: #79ad88;
  --success-soft: #23342a;
  --warning: #d1a45f;
  --warning-soft: #372e20;
  --danger: #df8682;
  --danger-soft: #3b2524;
  --code: #0f1011;
  --code-ink: #e9e8e1;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.18);
  --shadow-md: 0 14px 38px rgba(0, 0, 0, 0.28), 0 2px 8px rgba(0, 0, 0, 0.2);
  --shadow-lg: 0 24px 72px rgba(0, 0, 0, 0.44), 0 4px 18px rgba(0, 0, 0, 0.25);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --canvas: #151514;
    --sidebar: #1b1b19;
    --surface: #1d1d1b;
    --surface-raised: #242421;
    --surface-subtle: #272724;
    --surface-hover: #30302c;
    --ink: #deddd7;
    --ink-strong: #f5f4ef;
    --muted: #a09e95;
    --faint: #74726a;
    --border: rgba(241, 238, 226, 0.1);
    --border-strong: rgba(241, 238, 226, 0.18);
    --accent: #e4875f;
    --accent-strong: #f09a72;
    --accent-soft: #3b2922;
    --success: #79ad88;
    --success-soft: #23342a;
    --warning: #d1a45f;
    --warning-soft: #372e20;
    --danger: #df8682;
    --danger-soft: #3b2524;
    --code: #0f1011;
    --code-ink: #e9e8e1;
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.18);
    --shadow-md: 0 14px 38px rgba(0, 0, 0, 0.28), 0 2px 8px rgba(0, 0, 0, 0.2);
    --shadow-lg: 0 24px 72px rgba(0, 0, 0, 0.44), 0 4px 18px rgba(0, 0, 0, 0.25);
  }
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

body {
  margin: 0;
  background: var(--canvas);
  color: var(--ink);
  font: 14px/1.55 var(--font-sans);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

button,
input,
select,
textarea {
  color: inherit;
  font: inherit;
}

button,
select {
  -webkit-tap-highlight-color: transparent;
}

button {
  cursor: pointer;
}

button:disabled,
select:disabled,
input:disabled,
textarea:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
summary:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 72%, transparent);
  outline-offset: 2px;
}

::selection {
  background: color-mix(in srgb, var(--accent) 28%, transparent);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

`;
