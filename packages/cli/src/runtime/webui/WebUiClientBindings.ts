/** DOM event bindings, accessibility shortcuts, and client bootstrap. */
export const WEB_UI_CLIENT_BINDINGS_SCRIPT = String.raw`  elements.composer.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.busy) stopTurn();
    else submitTurn(elements.prompt.value);
  });

  elements.prompt.addEventListener('input', () => {
    autoSizePrompt();
    if (elements.prompt.value) localStorage.setItem('orbit.webui.draft', elements.prompt.value);
    else localStorage.removeItem('orbit.webui.draft');
  });

  elements.prompt.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !state.busy) {
      event.preventDefault();
      elements.composer.requestSubmit();
    }
  });

  elements.messageScroll.addEventListener('scroll', () => {
    state.stickToBottom = nearBottom();
    elements.jumpBottom.classList.toggle('is-visible', !state.stickToBottom);
  }, { passive: true });

  elements.jumpBottom.addEventListener('click', () => {
    state.stickToBottom = true;
    scrollToBottom(true);
  });

  elements.menuButton.addEventListener('click', () => {
    if (elements.appShell.classList.contains('sidebar-open')) closeSidebar();
    else openSidebar();
  });
  elements.sidebarBackdrop.addEventListener('click', closeSidebar);
  document.querySelectorAll('[data-close-sidebar]').forEach((button) => button.addEventListener('click', closeSidebar));
  if (typeof mobileSidebarQuery.addEventListener === 'function') {
    mobileSidebarQuery.addEventListener('change', syncSidebarInteractivity);
  } else {
    mobileSidebarQuery.addListener(syncSidebarInteractivity);
  }
  syncSidebarInteractivity();

  elements.inspectorButton.addEventListener('click', () => {
    setInspector(!elements.inspector.classList.contains('is-open'));
  });
  elements.inspectorClose.addEventListener('click', () => setInspector(false));
  elements.activityTab.addEventListener('click', () => selectInspectorTab('activity'));
  elements.settingsTab.addEventListener('click', () => selectInspectorTab('settings'));
  byId('clearActivity').addEventListener('click', clearActivity);

  document.querySelectorAll('[data-suggestion]').forEach((button) => {
    button.addEventListener('click', () => {
      const prompt = suggestionPrompts[Number(button.dataset.suggestion)] || '';
      elements.prompt.value = prompt;
      autoSizePrompt();
      elements.prompt.focus();
    });
  });

  document.querySelectorAll('[data-fill]').forEach((button) => {
    button.addEventListener('click', () => {
      if (state.busy) return;
      elements.prompt.value = button.dataset.fill || '';
      autoSizePrompt();
      elements.prompt.focus();
      closeSidebar();
    });
  });

  document.querySelectorAll('[data-command]').forEach((button) => {
    button.addEventListener('click', () => {
      const command = button.dataset.command || '';
      if (command === '/doctor' || command === '/help') {
        setInspector(true, 'activity');
      }
      closeSidebar();
      submitTurn(command);
    });
  });

  elements.modelSelect.addEventListener('change', () => {
    applySettings({ model: elements.modelSelect.value }, true).catch(() => {});
  });

  byId('applyModel').addEventListener('click', () => {
    const model = elements.customModel.value.trim();
    if (!model) return;
    applySettings({ model }).then(() => { elements.customModel.value = ''; }).catch(() => {});
  });

  elements.permissionSelect.addEventListener('change', () => {
    applySettings({ permissionMode: elements.permissionSelect.value }, true).catch(() => {});
  });

  elements.permissionSegments.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => applySettings({ permissionMode: button.dataset.mode }).catch(() => {}));
  });

  elements.searchToggle.addEventListener('click', () => {
    const enabled = elements.searchToggle.getAttribute('aria-pressed') !== 'true';
    applySettings({ webSearchEnabled: enabled }, true).catch(() => {});
  });
  elements.searchEnabled.addEventListener('change', () => {
    applySettings({ webSearchEnabled: elements.searchEnabled.checked }, true).catch(() => {});
  });
  elements.searchProvider.addEventListener('change', () => {
    applySettings({ webSearchProvider: elements.searchProvider.value }, true).catch(() => {});
  });
  elements.searchMax.addEventListener('change', () => {
    applySettings({ webSearchMaxResults: Number(elements.searchMax.value) }, true).catch(() => {});
  });

  document.querySelectorAll('[data-theme-value]').forEach((button) => {
    button.addEventListener('click', () => applyTheme(button.dataset.themeValue));
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setInspector(false);
      closeSidebar();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      if (!state.busy) submitTurn('/chat new');
    }
    if ((event.ctrlKey || event.metaKey) && event.key === ',') {
      event.preventDefault();
      setInspector(true, 'settings');
    }
  });

  window.addEventListener('beforeunload', () => state.eventSource && state.eventSource.close());

  async function initialize() {
    applyTheme(localStorage.getItem('orbit.webui.theme') || 'system');
    const draft = localStorage.getItem('orbit.webui.draft') || '';
    if (draft) {
      elements.prompt.value = draft;
      autoSizePrompt();
    }
    try {
      await bootstrapSession();
      await Promise.all([renderMessages(), loadStatus()]);
      connectEvents();
      state.ready = true;
      setConnection('connected', copy.connected);
      if (draft) showToast(copy.draftRestored);
      elements.prompt.focus();
    } catch (error) {
      setConnection('disconnected', copy.disconnected);
      showToast(error.message || copy.accessExpired, 'error');
      elements.prompt.disabled = true;
      elements.sendButton.disabled = true;
    }
  }

  initialize();
`;
