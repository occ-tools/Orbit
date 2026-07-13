/** Application shell, navigation, and workspace header styles. */
export const WEB_UI_SHELL_STYLES = String.raw`
.app-shell {
  height: 100vh;
  height: 100dvh;
  display: grid;
  grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
  background: var(--canvas);
}

.sidebar {
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 12px 14px;
  background: var(--sidebar);
  border-right: 1px solid var(--border);
  z-index: 30;
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
  height: 38px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 8px;
}

.brand-mark,
.empty-orbit {
  position: relative;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border: 2px solid var(--ink-strong);
  border-radius: 50%;
}

.brand-mark {
  width: 24px;
  height: 24px;
}

.brand-mark::after,
.empty-orbit::after {
  content: "";
  position: absolute;
  width: 30%;
  height: 30%;
  border-radius: 50%;
  background: var(--accent);
  transform: translate(88%, -88%);
  box-shadow: 0 0 0 3px var(--sidebar);
}

.brand-mark span,
.empty-orbit span {
  width: 34%;
  height: 34%;
  border-radius: 50%;
  background: var(--ink-strong);
}

.brand-name {
  color: var(--ink-strong);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.brand-version {
  margin-left: auto;
  color: var(--faint);
  font-family: var(--font-mono);
  font-size: 10px;
}

.new-task-button {
  height: 42px;
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 0 11px;
  color: var(--ink-strong);
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: 11px;
  box-shadow: var(--shadow-sm);
  font-weight: 600;
  text-align: left;
  transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
}

.new-task-button:hover {
  border-color: var(--border-strong);
  box-shadow: 0 5px 16px rgba(30, 28, 22, 0.07);
  transform: translateY(-1px);
}

.new-task-button kbd {
  margin-left: auto;
  padding: 2px 5px;
  color: var(--faint);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 5px;
  font: 9px/1.3 var(--font-mono);
}

.new-task-icon {
  color: var(--accent-strong);
  font-size: 18px;
  font-weight: 400;
}

.primary-nav {
  display: grid;
  gap: 3px;
}

.nav-button {
  width: 100%;
  min-height: 38px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  color: var(--muted);
  background: transparent;
  border: 0;
  border-radius: 9px;
  text-align: left;
  transition: color 140ms ease, background 140ms ease;
}

.nav-button:hover,
.nav-button.is-active {
  color: var(--ink-strong);
  background: color-mix(in srgb, var(--surface) 72%, transparent);
}

.nav-button.is-active {
  font-weight: 600;
}

.nav-glyph {
  width: 17px;
  color: var(--faint);
  font-family: var(--font-mono);
  font-size: 13px;
  text-align: center;
}

.nav-button.is-active .nav-glyph {
  color: var(--accent);
}

.sidebar-spacer {
  min-height: 16px;
  flex: 1 1 auto;
}

.workspace-card {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px;
  border-radius: 11px;
  transition: background 140ms ease;
}

.workspace-card:hover {
  background: color-mix(in srgb, var(--surface) 60%, transparent);
}

.workspace-icon {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  color: var(--muted);
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-family: var(--font-mono);
  font-size: 12px;
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
  color: var(--ink-strong);
  font-size: 12px;
  font-weight: 650;
}

.workspace-copy > span:last-child,
.workspace-label {
  color: var(--faint);
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
  grid-template-rows: 58px minmax(0, 1fr);
  background: var(--canvas);
}

.topbar {
  min-width: 0;
  height: 58px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 20px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--canvas) 88%, transparent);
  backdrop-filter: blur(18px);
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
  font-size: 13px;
  font-weight: 650;
}

.workspace-heading span {
  color: var(--faint);
  font-size: 10px;
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
  font-size: 16px;
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
  width: min(220px, 24vw);
  height: 34px;
  padding: 0 26px 0 10px;
  color: var(--muted);
  background: var(--surface-subtle);
  border: 1px solid transparent;
  border-radius: 9px;
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
  height: 32px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 9px;
  color: var(--faint);
  font-size: 11px;
  white-space: nowrap;
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
  height: 34px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  color: var(--muted);
  background: transparent;
  border-radius: 9px;
  font-size: 12px;
}

.details-button:hover,
.details-button[aria-expanded="true"] {
  color: var(--ink-strong);
  background: var(--surface-hover);
}

`;
