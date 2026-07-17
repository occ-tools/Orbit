/** Application shell, navigation, and workspace header styles. */
export const WEB_UI_SHELL_STYLES = String.raw`
.app-shell {
  height: 100vh;
  height: 100dvh;
  display: grid;
  grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
  gap: 8px;
  padding: 8px 8px 8px 0;
  background:
    radial-gradient(circle at 8% 4%, var(--accent-glow), transparent 28%),
    var(--canvas-deep);
  transition: grid-template-columns 210ms cubic-bezier(0.2, 0.75, 0.3, 1), gap 210ms ease, padding 210ms ease;
}

.sidebar {
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 12px 4px;
  color: var(--sidebar-ink);
  background: transparent;
  border-right: 0;
  z-index: 30;
  transition: opacity 150ms ease, transform 210ms cubic-bezier(0.2, 0.75, 0.3, 1);
}

.sidebar-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 25;
  border: 0;
  background: rgba(15, 14, 12, 0.36);
  backdrop-filter: blur(2px);
}

.brand-row {
  height: 46px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 6px;
}

.orbit-mark {
  display: block;
  flex: 0 0 auto;
  color: var(--accent);
  overflow: visible;
}

.brand-mark {
  width: 32px;
  height: 32px;
  padding: 4px;
  color: var(--accent-strong);
  background: color-mix(in srgb, var(--surface-raised) 74%, var(--accent-soft));
  border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--sidebar-border));
  border-radius: 11px;
  box-shadow: var(--shadow-sm), 0 7px 18px var(--accent-glow);
}

.orbit-cat-head,
.orbit-cat-orbit,
.orbit-cat-face {
  vector-effect: non-scaling-stroke;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.orbit-cat-head {
  fill: color-mix(in srgb, currentColor 8%, transparent);
  stroke-width: 2.2;
}

.orbit-cat-orbit {
  opacity: 0.48;
  stroke-width: 1.7;
}

.orbit-cat-face {
  stroke-width: 1.45;
}

.orbit-cat-eye {
  fill: currentColor;
}

.orbit-cat-satellite {
  fill: var(--brand-coral);
  filter: drop-shadow(0 0 5px color-mix(in srgb, var(--brand-coral) 42%, transparent));
}

.brand-name {
  color: var(--sidebar-ink);
  font-size: 17px;
  font-weight: 680;
  letter-spacing: -0.025em;
  white-space: nowrap;
}

.brand-version {
  margin-left: auto;
  padding: 3px 5px;
  color: var(--sidebar-faint);
  background: var(--sidebar-surface);
  border: 1px solid var(--sidebar-border);
  border-radius: 5px;
  font-family: var(--font-mono);
  font-size: 8px;
}

.sidebar-collapse-button {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  padding: 0;
  color: var(--sidebar-faint);
  background: transparent;
  border: 0;
  border-radius: 8px;
}

.sidebar-collapse-button:hover {
  color: var(--sidebar-ink);
  background: var(--sidebar-surface);
}

.sidebar-collapse-button .ui-icon {
  width: 15px;
  height: 15px;
}

.new-task-button {
  height: 44px;
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 0 12px;
  color: var(--sidebar-ink);
  background: color-mix(in srgb, var(--sidebar-active) 86%, var(--accent-soft));
  border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--sidebar-border));
  border-radius: 12px;
  box-shadow: var(--shadow-sm);
  font-weight: 620;
  text-align: left;
  transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
}

.new-task-button:hover {
  background: var(--sidebar-active);
  border-color: color-mix(in srgb, var(--accent) 34%, var(--sidebar-border));
  box-shadow: 0 8px 22px rgba(35, 61, 57, 0.07);
  transform: translateY(-1px);
}

.new-task-button kbd {
  margin-left: auto;
  padding: 2px 5px;
  color: var(--sidebar-faint);
  background: color-mix(in srgb, var(--sidebar-surface) 74%, var(--canvas));
  border: 1px solid var(--sidebar-border);
  border-radius: 5px;
  font: 9px/1.3 var(--font-mono);
}

.new-task-icon {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  color: var(--accent-strong);
  color: var(--surface-raised);
  background: var(--accent-strong);
  border-radius: 6px;
}

.new-task-icon .ui-icon {
  width: 14px;
  height: 14px;
}

.nav-section-heading {
  height: 25px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 10px 2px;
  color: var(--sidebar-faint);
  font: 700 9px/1 var(--font-mono);
  letter-spacing: 0.11em;
  text-transform: uppercase;
}

.nav-section-heading i {
  height: 1px;
  flex: 1;
  background: var(--sidebar-border);
}

.primary-nav {
  min-width: 0;
  display: grid;
  gap: 4px;
  padding: 0 2px;
}

.nav-button {
  min-width: 0;
  width: 100%;
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  color: var(--sidebar-muted);
  background: transparent;
  border: 0;
  border-radius: 10px;
  font-size: 13px;
  text-align: left;
  transition: color 140ms ease, background 140ms ease;
}

.nav-button span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-button:hover,
.nav-button.is-active {
  color: var(--sidebar-ink);
  background: var(--sidebar-active);
}

.nav-button.is-active {
  position: relative;
  font-weight: 620;
  border: 1px solid var(--sidebar-border);
  box-shadow: var(--shadow-sm);
}

.nav-button.is-active::after {
  content: "";
  position: absolute;
  left: -1px;
  width: 2px;
  height: 15px;
  background: var(--accent);
  border-radius: 0 2px 2px 0;
  box-shadow: none;
}

.recent-section {
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  margin-top: 2px;
}

.recent-section[hidden] {
  display: none;
}

.recent-sessions {
  min-height: 0;
  max-height: min(270px, 31vh);
  display: grid;
  gap: 2px;
  overflow-y: auto;
  padding: 2px;
  scrollbar-width: thin;
  scrollbar-color: var(--sidebar-border) transparent;
}

.recent-sessions::-webkit-scrollbar {
  width: 6px;
}

.recent-sessions::-webkit-scrollbar-thumb {
  background: transparent;
  border-radius: 6px;
}

.recent-sessions:hover::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--sidebar-faint) 35%, transparent);
}

.recent-session {
  position: relative;
  min-width: 0;
  display: grid;
  gap: 4px;
  padding: 9px 10px 8px 34px;
  color: var(--sidebar-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 9px;
  text-align: left;
  transition: color 140ms ease, background 140ms ease, border-color 140ms ease;
}

.recent-session::before {
  content: "";
  position: absolute;
  width: 5px;
  height: 5px;
  margin: 6px 0 0 -18px;
  background: var(--sidebar-faint);
  border-radius: 50%;
}

.recent-session:hover {
  color: var(--sidebar-ink);
  background: color-mix(in srgb, var(--sidebar-surface) 78%, transparent);
  border-color: var(--sidebar-border);
}

.recent-session-title,
.recent-session-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-session-title {
  color: inherit;
  font-size: 12px;
  font-weight: 590;
}

.recent-session-meta {
  color: var(--sidebar-faint);
  font: 9px/1.35 var(--font-mono);
}

.recent-session:disabled,
.new-task-button:disabled {
  cursor: wait;
  opacity: 0.55;
}

.ui-icon {
  width: 17px;
  height: 17px;
  flex: 0 0 auto;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.sidebar-spacer {
  min-height: 16px;
  flex: 1 1 auto;
}

.agent-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 10px 8px;
  color: var(--sidebar-muted);
  border-top: 1px solid var(--sidebar-border);
  border-radius: 10px 10px 0 0;
}

.agent-card > span:last-child {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.agent-card strong {
  color: var(--sidebar-ink);
  font-size: 11px;
  font-weight: 620;
}

.agent-card small {
  color: var(--sidebar-faint);
  font-size: 9px;
}

.agent-state {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  background: var(--sidebar-surface);
  border: 1px solid var(--sidebar-border);
  border-radius: 8px;
}

.agent-state i {
  width: 7px;
  height: 7px;
  background: var(--success);
  border-radius: 50%;
  box-shadow: 0 0 0 3px rgba(140, 183, 146, 0.12);
}

.app-shell.is-disconnected .agent-state i {
  background: var(--danger);
  box-shadow: 0 0 0 3px rgba(226, 138, 133, 0.12);
}

.workspace-card {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 10px;
  background: color-mix(in srgb, var(--sidebar-active) 76%, transparent);
  border: 1px solid var(--sidebar-border);
  border-radius: 12px;
  transition: background 140ms ease;
}

.workspace-card:hover {
  background: var(--sidebar-surface);
  border-color: var(--sidebar-border);
}

.workspace-icon {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  color: var(--sidebar-muted);
  background: color-mix(in srgb, var(--sidebar-surface) 72%, var(--accent-soft));
  border: 1px solid var(--sidebar-border);
  border-radius: 8px;
}

.workspace-icon span {
  position: relative;
  width: 14px;
  height: 10px;
  border: 1.5px solid currentColor;
  border-radius: 3px;
}

.workspace-icon span::before {
  content: "";
  position: absolute;
  left: 1px;
  top: -4px;
  width: 6px;
  height: 4px;
  border: 1.5px solid currentColor;
  border-bottom: 0;
  border-radius: 2px 2px 0 0;
}

.workspace-copy {
  min-width: 0;
  display: grid;
  line-height: 1.35;
}

.workspace-copy strong,
.workspace-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-copy strong {
  color: var(--sidebar-ink);
  font-size: 12px;
  font-weight: 650;
}

.workspace-copy > span:last-child,
.workspace-label {
  color: var(--sidebar-faint);
  font-size: 10px;
}

.workspace-label {
  margin-bottom: 2px;
  font-weight: 650;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.workspace-view {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: 58px auto minmax(0, 1fr);
  overflow: hidden;
  background: var(--canvas);
  border: 1px solid color-mix(in srgb, var(--border-strong) 82%, transparent);
  border-radius: 18px;
  box-shadow: 0 18px 54px rgba(25, 43, 39, 0.08), 0 2px 8px rgba(25, 43, 39, 0.035);
}

.topbar {
  grid-row: 1;
  min-width: 0;
  height: 58px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 clamp(16px, 2vw, 28px);
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface-glass) 92%, var(--canvas));
  backdrop-filter: blur(22px) saturate(130%);
  z-index: 15;
}

.topbar-start,
.topbar-actions {
  min-width: 0;
  display: flex;
  align-items: center;
}

.topbar-start {
  gap: 10px;
}

.topbar-actions {
  gap: 8px;
}

.context-meter {
  --context-pct: 0%;
  height: 34px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 9px;
  color: var(--muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 9px;
}

.context-meter:hover {
  color: var(--ink-strong);
  background: color-mix(in srgb, var(--surface-raised) 64%, transparent);
  border-color: var(--border);
}

.context-ring {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  background: conic-gradient(var(--accent) var(--context-pct), var(--surface-hover) 0);
  border-radius: 50%;
}

.context-ring i {
  width: 12px;
  height: 12px;
  background: var(--surface-glass);
  border-radius: 50%;
}

.context-meter.is-warm .context-ring {
  background: conic-gradient(var(--warning) var(--context-pct), var(--surface-hover) 0);
}

.context-meter.is-hot .context-ring {
  background: conic-gradient(var(--danger) var(--context-pct), var(--surface-hover) 0);
}

.context-meter-copy {
  display: grid;
  line-height: 1.05;
  text-align: left;
}

.context-meter-copy small {
  color: var(--faint);
  font-size: 7px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.context-meter-copy strong {
  color: inherit;
  font: 600 9px/1.2 var(--font-mono);
}

.workspace-heading {
  min-width: 0;
  display: grid;
  line-height: 1.22;
}

.workspace-heading strong,
.workspace-heading span {
  max-width: min(32vw, 430px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-heading strong {
  color: var(--ink-strong);
  font-size: 14px;
  font-weight: 680;
}

.workspace-heading span {
  color: var(--faint);
  font: 10px/1.3 var(--font-mono);
}

.icon-button,
.details-button,
.text-button,
.secondary-button {
  border: 0;
}

.icon-button {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  padding: 0;
  color: var(--muted);
  background: transparent;
  border-radius: 9px;
  font-size: 19px;
}

.icon-button:hover {
  color: var(--ink-strong);
  background: var(--surface-hover);
}

.mobile-menu {
  display: none;
}

.mobile-menu .ui-icon,
.details-button .ui-icon {
  width: 16px;
  height: 16px;
}

.model-control {
  position: relative;
  display: block;
}

.model-control::after {
  content: "⌄";
  position: absolute;
  right: 9px;
  top: 50%;
  color: var(--faint);
  pointer-events: none;
  transform: translateY(-56%);
}

.model-control select {
  width: min(196px, 21vw);
  height: 36px;
  padding: 0 26px 0 10px;
  color: var(--muted);
  background: color-mix(in srgb, var(--surface-subtle) 82%, transparent);
  border: 1px solid var(--border);
  border-radius: 10px;
  appearance: none;
  font-size: 12px;
  text-overflow: ellipsis;
  transition: border-color 140ms ease, background 140ms ease;
}

.model-control select:hover {
  color: var(--ink);
  background: var(--surface-hover);
  border-color: var(--border);
}

.connection-state {
  height: 34px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 9px;
  color: var(--faint);
  background: transparent;
  border: 0;
  border-radius: 9px;
  font-size: 11px;
  white-space: nowrap;
}

.connection-state:hover {
  color: var(--ink);
  background: var(--surface-hover);
}

.connection-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--warning);
  box-shadow: 0 0 0 3px var(--warning-soft);
}

.connection-state.is-connected .connection-dot {
  background: var(--success);
  box-shadow: 0 0 0 3px var(--success-soft);
}

.connection-state.is-disconnected .connection-dot {
  background: var(--danger);
  box-shadow: 0 0 0 3px var(--danger-soft);
}

.details-button {
  height: 36px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  color: var(--muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 10px;
  font-size: 12px;
}

.details-button:hover,
.details-button[aria-expanded="true"] {
  color: var(--ink-strong);
  background: var(--surface-hover);
  border-color: var(--border);
}

.workspace-view > .connection-help {
  grid-row: 2;
}

.workspace-view > .conversation {
  grid-row: 3;
}

`;
