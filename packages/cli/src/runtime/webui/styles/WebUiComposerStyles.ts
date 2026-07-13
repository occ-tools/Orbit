/** Prompt composer, run state, and conversation navigation controls. */
export const WEB_UI_COMPOSER_STYLES = String.raw`
.composer-dock {
  position: relative;
  width: min(calc(var(--content-width) + 32px), calc(100% - 32px));
  margin: 0 auto;
  padding: 0 16px calc(12px + env(safe-area-inset-bottom));
  z-index: 10;
}

.composer-dock::before {
  content: "";
  position: absolute;
  z-index: -1;
  left: -10vw;
  right: -10vw;
  bottom: 0;
  height: 124px;
  background: linear-gradient(to bottom, transparent, var(--canvas) 34%);
  pointer-events: none;
}

.turn-status {
  min-height: 23px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 13px;
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
  padding: 12px 12px 9px;
  background: var(--surface-raised);
  border: 1px solid var(--border-strong);
  border-radius: 18px;
  box-shadow: var(--shadow-md);
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

.composer:focus-within {
  border-color: color-mix(in srgb, var(--accent) 48%, var(--border));
  box-shadow: 0 16px 42px rgba(34, 30, 22, 0.12), 0 0 0 3px color-mix(in srgb, var(--accent) 9%, transparent);
}

#prompt {
  display: block;
  width: 100%;
  min-height: 28px;
  max-height: 210px;
  resize: none;
  overflow-y: auto;
  padding: 2px 3px 8px;
  color: var(--ink-strong);
  background: transparent;
  border: 0;
  outline: 0;
  font-size: 14px;
  line-height: 1.55;
}

#prompt::placeholder {
  color: var(--faint);
}

.composer-toolbar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 10px;
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
.composer-select {
  height: 30px;
  flex: 0 0 auto;
  color: var(--muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: 11px;
}

.composer-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
}

.composer-chip:hover,
.composer-chip[aria-pressed="true"],
.composer-select:hover {
  color: var(--ink-strong);
  background: var(--surface-subtle);
  border-color: var(--border);
}

.composer-chip[aria-pressed="true"] {
  color: var(--accent-strong);
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 20%, var(--border));
}

.composer-select {
  padding: 0 6px;
  outline: 0;
}

.send-button {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  padding: 0;
  color: var(--surface);
  background: var(--ink-strong);
  border: 0;
  border-radius: 10px;
  font-size: 17px;
  box-shadow: var(--shadow-sm);
  transition: background 140ms ease, transform 140ms ease;
}

.send-button:hover {
  background: var(--accent-strong);
  transform: translateY(-1px);
}

.send-button.is-stop {
  color: var(--danger);
  background: var(--danger-soft);
  border: 1px solid color-mix(in srgb, var(--danger) 24%, transparent);
  font-size: 11px;
}

.composer-hint {
  margin: 7px 0 0;
  color: var(--faint);
  font-size: 9px;
  text-align: center;
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

`;
