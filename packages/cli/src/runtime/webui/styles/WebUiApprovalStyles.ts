/** Inline tool and file-change approval surface. */
export const WEB_UI_APPROVAL_STYLES = String.raw`
.approval-panel {
  position: relative;
  margin: 0 0 10px;
  padding: 15px;
  overflow: hidden;
  color: var(--ink);
  background: color-mix(in srgb, var(--surface-raised) 94%, var(--warning-soft));
  border: 1px solid color-mix(in srgb, var(--warning) 32%, var(--border));
  border-radius: 16px;
  box-shadow: var(--shadow-md);
}

.approval-panel::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--warning);
}

.approval-panel-head {
  display: flex;
  align-items: flex-start;
  gap: 11px;
}

.approval-panel-head > div {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.approval-mark {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  color: color-mix(in srgb, var(--warning) 78%, var(--ink));
  background: var(--warning-soft);
  border-radius: 9px;
  font: 700 13px/1 var(--font-mono);
}

.approval-eyebrow {
  color: var(--muted);
  font: 650 9px/1.35 var(--font-mono);
  letter-spacing: 0.12em;
}

#approvalTitle {
  overflow-wrap: anywhere;
  font-size: 13.5px;
  line-height: 1.35;
}

.approval-reason {
  margin: 11px 0 0 39px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
}

.approval-preview {
  max-height: 220px;
  margin: 12px 0 0;
  padding: 10px 0;
  overflow: auto;
  color: var(--ink);
  background: color-mix(in srgb, var(--canvas) 76%, var(--surface));
  border: 1px solid var(--border);
  border-radius: 11px;
  font: 10.5px/1.52 var(--font-mono);
  white-space: pre;
}

.approval-preview-line {
  display: block;
  min-height: 1.52em;
  padding: 0 11px;
}

.approval-preview-line.is-added {
  color: var(--success);
  background: var(--success-soft);
}

.approval-preview-line.is-deleted {
  color: var(--danger);
  background: var(--danger-soft);
}

.approval-preview-line.is-hunk {
  color: var(--accent-strong);
  background: var(--accent-soft);
}

.approval-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 13px;
}

.approval-button {
  min-width: 76px;
  height: 34px;
  padding: 0 13px;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  font-size: 11.5px;
  font-weight: 650;
}

.approval-button.is-deny {
  color: var(--ink);
  background: var(--surface-raised);
}

.approval-button.is-approve {
  color: var(--surface);
  background: var(--accent-strong);
  border-color: transparent;
}

.approval-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}

.approval-button:disabled {
  opacity: 0.52;
  cursor: wait;
}

@media (max-width: 560px) {
  .approval-panel { padding: 13px; }
  .approval-reason { margin-left: 0; }
  .approval-actions { display: grid; grid-template-columns: 1fr 1fr; }
  .approval-button { width: 100%; }
}
`;
