/** Conversation messages, rich content, tools, and empty-state styles. */
export const WEB_UI_CONVERSATION_STYLES = String.raw`
.conversation {
  position: relative;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  overflow: hidden;
}

.message-scroll {
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.message-scroll::-webkit-scrollbar,
.inspector-content::-webkit-scrollbar,
.sidebar::-webkit-scrollbar {
  width: 9px;
}

.message-scroll::-webkit-scrollbar-thumb,
.inspector-content::-webkit-scrollbar-thumb,
.sidebar::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--faint) 35%, transparent);
  border: 3px solid transparent;
  border-radius: 9px;
  background-clip: padding-box;
}

.message-column {
  width: min(var(--content-width), calc(100% - 48px));
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 28px;
  margin: 0 auto;
  padding: 44px 0 40px;
}

.message-column:empty {
  display: none;
}

.message {
  position: relative;
  width: 100%;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 13px;
  animation: message-in 220ms ease-out both;
}

.message.user {
  display: flex;
  justify-content: flex-end;
}

.message-avatar {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  margin-top: 2px;
  color: var(--surface);
  background: var(--ink-strong);
  border-radius: 9px;
  font-size: 11px;
  font-weight: 750;
  letter-spacing: -0.04em;
}

.message-content {
  min-width: 0;
}

.message-role {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
  margin-bottom: 4px;
  color: var(--ink-strong);
  font-size: 12px;
  font-weight: 700;
}

.message-time {
  color: var(--faint);
  font-size: 10px;
  font-weight: 450;
}

.message.user .message-content {
  width: fit-content;
  max-width: min(680px, 82%);
  padding: 10px 14px;
  color: var(--ink-strong);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 16px 16px 4px 16px;
  box-shadow: var(--shadow-sm);
}

.message.user .message-role {
  display: none;
}

.rich-text {
  min-width: 0;
  color: var(--ink);
  font-size: 14px;
  line-height: 1.68;
  overflow-wrap: anywhere;
}

.rich-text > :first-child {
  margin-top: 0;
}

.rich-text > :last-child {
  margin-bottom: 0;
}

.rich-text p {
  margin: 0.72em 0;
}

.rich-text h1,
.rich-text h2,
.rich-text h3 {
  margin: 1.35em 0 0.55em;
  color: var(--ink-strong);
  line-height: 1.28;
  letter-spacing: -0.02em;
}

.rich-text h1 {
  font-size: 21px;
}

.rich-text h2 {
  font-size: 17px;
}

.rich-text h3 {
  font-size: 15px;
}

.rich-text ul,
.rich-text ol {
  margin: 0.72em 0;
  padding-left: 1.5em;
}

.rich-text li {
  margin: 0.32em 0;
  padding-left: 0.2em;
}

.rich-text blockquote {
  margin: 0.9em 0;
  padding: 2px 0 2px 14px;
  color: var(--muted);
  border-left: 3px solid var(--border-strong);
}

.rich-text a {
  color: var(--accent-strong);
  text-decoration-color: color-mix(in srgb, var(--accent) 42%, transparent);
  text-underline-offset: 3px;
}

.rich-text code:not(.code-block code) {
  padding: 2px 5px;
  color: var(--ink-strong);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 5px;
  font: 0.88em/1.5 var(--font-mono);
}

.code-block {
  position: relative;
  margin: 14px 0;
  overflow: hidden;
  color: var(--code-ink);
  background: var(--code);
  border: 1px solid color-mix(in srgb, var(--code-ink) 10%, transparent);
  border-radius: 12px;
  box-shadow: var(--shadow-sm);
}

.code-header {
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 0 13px;
  color: #999b98;
  background: rgba(255, 255, 255, 0.035);
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  font: 10px/1 var(--font-mono);
}

.copy-code {
  height: 25px;
  padding: 0 8px;
  color: #b9bbb7;
  background: transparent;
  border: 0;
  border-radius: 6px;
  font: 10px/1 var(--font-sans);
}

.copy-code:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}

.code-block pre {
  margin: 0;
  padding: 14px 16px 16px;
  overflow: auto;
}

.code-block code {
  display: block;
  min-width: max-content;
  color: inherit;
  font: 12px/1.62 var(--font-mono);
  tab-size: 2;
}

.thinking-block {
  margin: 8px 0 12px;
  color: var(--muted);
  border-left: 2px solid var(--border-strong);
}

.thinking-block summary {
  padding: 4px 10px;
  color: var(--muted);
  cursor: pointer;
  font-size: 12px;
  list-style: none;
}

.thinking-block summary::-webkit-details-marker {
  display: none;
}

.thinking-block summary::before {
  content: "›";
  display: inline-block;
  margin-right: 7px;
  transition: transform 140ms ease;
}

.thinking-block[open] summary::before {
  transform: rotate(90deg);
}

.thinking-body {
  max-height: 260px;
  padding: 5px 12px 9px 27px;
  overflow: auto;
  color: var(--faint);
  font-size: 12px;
  white-space: pre-wrap;
}

.tool-card {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 38px;
  margin: 8px 0;
  padding: 7px 10px;
  color: var(--muted);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 9px;
  font-size: 12px;
}

.tool-status {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--warning);
  box-shadow: 0 0 0 3px var(--warning-soft);
}

.tool-card.is-success .tool-status {
  background: var(--success);
  box-shadow: 0 0 0 3px var(--success-soft);
}

.tool-card.is-error .tool-status {
  background: var(--danger);
  box-shadow: 0 0 0 3px var(--danger-soft);
}

.stream-caret::after {
  content: "";
  display: inline-block;
  width: 6px;
  height: 1.15em;
  margin-left: 3px;
  vertical-align: -0.2em;
  background: var(--accent);
  border-radius: 1px;
  animation: caret 900ms steps(1) infinite;
}

.empty-state {
  width: min(780px, calc(100% - 48px));
  margin: auto;
  padding: 7vh 0 36px;
  text-align: center;
}

.empty-state[hidden] {
  display: none;
}

.empty-orbit {
  width: 52px;
  height: 52px;
  margin: 0 auto 24px;
  border-width: 3px;
}

.empty-orbit::after {
  box-shadow: 0 0 0 5px var(--canvas);
}

.eyebrow {
  margin: 0 0 9px;
  color: var(--accent-strong);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.16em;
}

.empty-state h1 {
  margin: 0;
  color: var(--ink-strong);
  font-size: clamp(28px, 4vw, 42px);
  font-weight: 650;
  letter-spacing: -0.045em;
  line-height: 1.1;
}

.empty-description {
  max-width: 560px;
  margin: 14px auto 28px;
  color: var(--muted);
  font-size: 14px;
}

.suggestion-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  text-align: left;
}

.suggestion-card {
  min-height: 96px;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  grid-template-rows: auto auto;
  column-gap: 9px;
  align-content: center;
  padding: 14px;
  color: var(--ink);
  background: color-mix(in srgb, var(--surface) 70%, transparent);
  border: 1px solid var(--border);
  border-radius: 13px;
  text-align: left;
  box-shadow: var(--shadow-sm);
  transition: background 150ms ease, border-color 150ms ease, transform 150ms ease, box-shadow 150ms ease;
}

.suggestion-card:hover {
  background: var(--surface);
  border-color: var(--border-strong);
  box-shadow: 0 8px 22px rgba(30, 28, 22, 0.06);
  transform: translateY(-2px);
}

.suggestion-index {
  grid-row: 1 / span 2;
  padding-top: 2px;
  color: var(--faint);
  font: 10px/1.3 var(--font-mono);
}

.suggestion-card strong {
  color: var(--ink-strong);
  font-size: 12px;
  font-weight: 680;
}

.suggestion-card > span:last-child {
  margin-top: 3px;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.4;
}

`;
