/** Prompt composer, run state, and conversation navigation controls. */
export const WEB_UI_COMPOSER_STYLES = String.raw`
.composer-dock {
  position: relative;
  box-sizing: border-box;
  width: min(var(--composer-width), calc(100% - 32px));
  margin: 0 auto;
  padding: 0 16px calc(12px + env(safe-area-inset-bottom));
  z-index: 10;
}

.composer-anchor {
  display: contents;
}

.empty-composer-slot {
  width: 100%;
  margin-top: 30px;
}

.empty-composer-slot .composer-dock {
  width: 100%;
  padding: 0;
}

.empty-composer-slot .composer {
  border-radius: 16px;
  box-shadow: none;
}

.empty-composer-slot .composer-dock::before {
  display: none;
}

.empty-composer-slot .turn-status {
  justify-content: flex-start;
}

.composer-dock::before {
  content: "";
  position: absolute;
  z-index: -1;
  left: 0;
  right: 0;
  bottom: 0;
  height: 148px;
  background: linear-gradient(to bottom, transparent, var(--canvas) 38%);
  pointer-events: none;
}

.turn-status {
  min-height: 23px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 16px;
  color: var(--muted);
  font-size: 11px;
}

.turn-status.is-working::before {
  content: "";
  width: 7px;
  height: 7px;
  border: 2px solid color-mix(in srgb, var(--accent) 28%, transparent);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 720ms linear infinite;
}

.composer {
  position: relative;
  padding: 13px 13px 10px;
  background: color-mix(in srgb, var(--surface-raised) 96%, transparent);
  border: 1px solid var(--border-strong);
  border-radius: 18px;
  box-shadow: none;
  backdrop-filter: none;
  transition: border-color 160ms ease, background 160ms ease;
}

.composer:focus-within {
  border-color: color-mix(in srgb, var(--accent) 48%, var(--border));
  background: var(--surface-raised);
  box-shadow: none;
}

#prompt {
  display: block;
  width: 100%;
  min-height: 34px;
  max-height: 210px;
  resize: none;
  overflow-y: auto;
  padding: 3px 4px 10px;
  color: var(--ink-strong);
  background: transparent;
  border: 0;
  outline: 0;
  font-size: 14.5px;
  line-height: 1.55;
}

.empty-composer-slot #prompt {
  min-height: clamp(54px, 7vh, 74px);
  font-size: 15px;
}

#prompt::placeholder {
  color: var(--faint);
}

.composer-toolbar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  padding-top: 2px;
}

.composer-tools {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  overflow-x: auto;
  scrollbar-width: none;
}

.composer-tools::-webkit-scrollbar {
  display: none;
}

.composer-chip,
.composer-select-trigger {
  height: 29px;
  flex: 0 0 auto;
  color: var(--muted);
  background: color-mix(in srgb, var(--surface-subtle) 38%, transparent);
  border: 1px solid transparent;
  border-radius: 9px;
  font-size: 11px;
}

.composer-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 9px;
}

.composer-chip .ui-icon {
  width: 14px;
  height: 14px;
}

.web-status-dot {
  width: 6px;
  height: 6px;
  background: var(--faint);
  border-radius: 50%;
}

.composer-chip[aria-pressed="true"] .web-status-dot {
  background: var(--success);
  box-shadow: 0 0 0 3px var(--success-soft);
}

.composer-chip:hover,
.composer-chip[aria-pressed="true"],
.composer-select-trigger:hover,
.composer-select-control.is-open .composer-select-trigger {
  color: var(--ink-strong);
  background: var(--surface-subtle);
  border-color: var(--border);
}

.composer-chip[aria-pressed="true"] {
  color: var(--accent-strong);
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 20%, var(--border));
}

.composer-select-control {
  flex: 0 0 auto;
}

.send-button {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  padding: 0;
  color: var(--surface);
  background: var(--accent-strong);
  border: 0;
  border-radius: 11px;
  font-size: 17px;
  box-shadow: var(--shadow-sm);
  transition: background 140ms ease, transform 140ms ease;
}

.send-button:hover {
  background: color-mix(in srgb, var(--accent-strong) 82%, var(--ink-strong));
  transform: translateY(-1px);
}

.send-button:disabled {
  color: var(--faint);
  background: var(--surface-subtle);
  box-shadow: none;
  cursor: not-allowed;
  transform: none;
}

.send-button.is-stop {
  color: var(--danger);
  background: var(--danger-soft);
  border: 1px solid color-mix(in srgb, var(--danger) 24%, transparent);
  font-size: 11px;
}

.composer-hint {
  margin: 7px 4px 0 0;
  color: var(--faint);
  font-size: 9px;
  text-align: right;
}

.empty-composer-slot .composer-hint {
  text-align: right;
}

.app-shell.is-disconnected .composer {
  border-color: color-mix(in srgb, var(--danger) 22%, var(--border));
  box-shadow: none;
}

.jump-bottom {
  position: absolute;
  left: 50%;
  bottom: 132px;
  z-index: 12;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  padding: 0;
  color: var(--muted);
  background: var(--surface-raised);
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  box-shadow: var(--shadow-md);
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 8px);
  transition: opacity 140ms ease, transform 140ms ease;
}

.jump-bottom.is-visible {
  opacity: 1;
  pointer-events: auto;
  transform: translate(-50%, 0);
}

.jump-bottom .ui-icon {
  width: 15px;
  height: 15px;
}

`;
