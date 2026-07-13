/** Viewport adaptations and reduced-motion accessibility overrides. */
export const WEB_UI_RESPONSIVE_STYLES = String.raw`
@media (max-width: 980px) {
  :root {
    --sidebar-width: 218px;
  }

  .connection-state span:last-child,
  .details-button span:last-child {
    display: none;
  }

  .details-button {
    width: 34px;
    justify-content: center;
    padding: 0;
  }
}

@media (max-width: 780px) {
  .app-shell {
    grid-template-columns: minmax(0, 1fr);
  }

  .sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    width: min(280px, calc(100vw - 54px));
    box-shadow: var(--shadow-lg);
    transform: translateX(-105%);
    transition: transform 210ms cubic-bezier(0.2, 0.75, 0.3, 1);
  }

  .app-shell.sidebar-open .sidebar {
    transform: translateX(0);
  }

  .app-shell.sidebar-open .sidebar-backdrop {
    display: block;
  }

  .mobile-menu {
    display: grid;
  }

  .model-control select {
    width: min(190px, 35vw);
  }

  .message-column {
    width: min(var(--content-width), calc(100% - 32px));
    padding-top: 32px;
  }

  .empty-state {
    width: min(680px, calc(100% - 32px));
  }
}

@media (max-width: 560px) {
  .workspace-view {
    grid-template-rows: 54px minmax(0, 1fr);
  }

  .topbar {
    height: 54px;
    padding: 0 10px;
  }

  .workspace-heading span,
  .connection-state,
  .brand-version {
    display: none;
  }

  .workspace-heading strong {
    max-width: 24vw;
  }

  .model-control select {
    width: min(150px, 38vw);
  }

  .message-column {
    width: calc(100% - 24px);
    gap: 23px;
    padding: 24px 0 28px;
  }

  .message {
    grid-template-columns: 28px minmax(0, 1fr);
    gap: 9px;
  }

  .message-avatar {
    width: 27px;
    height: 27px;
    border-radius: 8px;
    font-size: 10px;
  }

  .message.user .message-content {
    max-width: 92%;
  }

  .empty-state {
    width: calc(100% - 24px);
    padding-top: 4vh;
  }

  .empty-orbit {
    width: 44px;
    height: 44px;
    margin-bottom: 19px;
  }

  .empty-description {
    margin-bottom: 22px;
  }

  .suggestion-grid {
    grid-template-columns: 1fr;
    gap: 7px;
  }

  .suggestion-card {
    min-height: 72px;
    padding: 10px 12px;
  }

  .suggestion-card:nth-child(n + 4) {
    display: none;
  }

  .composer-dock {
    width: 100%;
    padding-inline: 10px;
    padding-bottom: calc(8px + env(safe-area-inset-bottom));
  }

  .composer {
    padding: 10px 9px 8px;
    border-radius: 16px;
  }

  .composer-hint {
    display: none;
  }

  .composer-chip {
    padding: 0 6px;
  }

  .jump-bottom {
    bottom: 112px;
  }

  .inspector {
    inset: 0;
    width: 100%;
    border: 0;
    border-radius: 0;
    transform: translateY(104%);
  }

  .inspector.is-open {
    transform: translateY(0);
  }

  .toast-region {
    right: 10px;
    bottom: calc(10px + env(safe-area-inset-bottom));
    width: calc(100vw - 20px);
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;
