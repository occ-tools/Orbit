/** Toast notifications and shared motion definitions. */
export const WEB_UI_FEEDBACK_STYLES = String.raw`
.toast-region {
  position: fixed;
  z-index: 100;
  right: 18px;
  bottom: calc(18px + env(safe-area-inset-bottom));
  width: min(360px, calc(100vw - 36px));
  display: grid;
  gap: 8px;
  pointer-events: none;
}

.toast {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto;
  align-items: start;
  gap: 10px;
  padding: 12px;
  color: var(--ink);
  background: var(--surface-raised);
  border: 1px solid var(--border-strong);
  border-radius: 11px;
  box-shadow: var(--shadow-lg);
  pointer-events: auto;
  animation: toast-in 180ms ease-out both;
}

.toast::before {
  content: "";
  width: 7px;
  height: 7px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--accent);
}

.toast.is-error::before {
  background: var(--danger);
}

.toast.is-success::before {
  background: var(--success);
}

.toast button {
  padding: 0;
  color: var(--faint);
  background: transparent;
  border: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes caret {
  0%, 48% { opacity: 1; }
  49%, 100% { opacity: 0; }
}

@keyframes breathe {
  0%, 100% { opacity: 0.45; transform: scale(0.88); }
  50% { opacity: 1; transform: scale(1); }
}

@keyframes message-in {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes toast-in {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

`;
