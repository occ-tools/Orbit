/** DOM event bindings, accessibility shortcuts, and client bootstrap. */
export const WEB_UI_CLIENT_BINDINGS_SCRIPT = String.raw`  elements.composer.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.busy) stopTurn();
    else submitTurn(elements.prompt.value);
  });
  elements.denyApprovalButton.addEventListener('click', () => void respondToApproval(false));
  elements.approveApprovalButton.addEventListener('click', () => void respondToApproval(true));

  elements.prompt.addEventListener('input', () => {
    autoSizePrompt();
    writeLocalStorage('orbit.webui.draft', elements.prompt.value);
    updateSendButtonState();
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
    toggleNavigation();
  });
  elements.sidebarCollapseButton.addEventListener('click', () => setDesktopSidebarCollapsed(true));
  elements.sidebarBackdrop.addEventListener('click', closeSidebar);
  document.querySelectorAll('[data-close-sidebar]').forEach((button) => button.addEventListener('click', closeSidebar));
  if (typeof mobileSidebarQuery.addEventListener === 'function') {
    mobileSidebarQuery.addEventListener('change', syncSidebarInteractivity);
  } else {
    mobileSidebarQuery.addListener(syncSidebarInteractivity);
  }
  const syncSystemTheme = () => {
    if (readLocalStorage('orbit.webui.theme', 'system') === 'system') applyTheme('system');
  };
  if (typeof systemThemeQuery.addEventListener === 'function') {
    systemThemeQuery.addEventListener('change', syncSystemTheme);
  } else {
    systemThemeQuery.addListener(syncSystemTheme);
  }
  syncSidebarInteractivity();

  elements.inspectorButton.addEventListener('click', () => {
    setInspector(!elements.inspector.classList.contains('is-open'));
  });
  elements.contextMeter.addEventListener('click', () => setInspector(true, 'activity'));
  elements.inspectorClose.addEventListener('click', () => setInspector(false));
  elements.inspectorBackdrop.addEventListener('click', () => setInspector(false));
  elements.inspector.addEventListener('keydown', trapInspectorFocus);
  elements.connectionState.addEventListener('click', () => {
    if (!state.ready) void initialize();
  });
  byId('retryConnection').addEventListener('click', () => void initialize());
  elements.activityTab.addEventListener('click', () => selectInspectorTab('activity'));
  elements.settingsTab.addEventListener('click', () => selectInspectorTab('settings'));
  elements.activityTab.addEventListener('keydown', handleInspectorTabKeydown);
  elements.settingsTab.addEventListener('keydown', handleInspectorTabKeydown);
  byId('clearActivity').addEventListener('click', clearActivity);

  document.querySelectorAll('[data-suggestion]').forEach((button) => {
    button.addEventListener('click', () => {
      const prompt = suggestionPrompts[Number(button.dataset.suggestion)] || '';
      setComposerValue(prompt);
    });
  });

  document.querySelectorAll('[data-fill]').forEach((button) => {
    button.addEventListener('click', () => {
      if (state.busy) return;
      setComposerValue(button.dataset.fill || '');
      closeSidebar();
    });
  });

  document.querySelectorAll('[data-open-context]').forEach((button) => {
    button.addEventListener('click', () => {
      openContextPicker();
      closeSidebar();
    });
  });

  elements.contextPickerClose.addEventListener('click', () => closeContextPicker());
  elements.clearContextButton.addEventListener('click', clearContextFiles);
  elements.contextSearch.addEventListener('input', queueContextPickerRefresh);
  elements.contextSearch.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveContextPickerSelection(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveContextPickerSelection(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setContextPickerBoundary(false);
    } else if (event.key === 'End') {
      event.preventDefault();
      setContextPickerBoundary(true);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      addContextFile(contextPickerSelection);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeContextPicker();
    }
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

  elements.newTaskButton.addEventListener('click', () => {
    closeContextPicker({ skipRestore: true });
    void updateSession({ action: 'new' });
  });
  elements.recentSessions.addEventListener('click', (event) => {
    const button = event.target.closest('[data-session-id]');
    if (!button || state.busy) return;
    void updateSession({ action: 'resume', sessionId: button.dataset.sessionId });
  });
  elements.commandsButton.addEventListener('click', openCommandPalette);
  elements.commandTrigger.addEventListener('click', openCommandPalette);
  elements.commandPaletteBackdrop.addEventListener('click', closeCommandPalette);
  elements.commandSearch.addEventListener('input', () => {
    paletteSelection = 0;
    renderCommandPalette();
  });
  elements.commandSearch.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      movePaletteSelection(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      movePaletteSelection(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      paletteSelection = 0;
      syncPaletteSelection();
    } else if (event.key === 'End') {
      event.preventDefault();
      paletteSelection = Math.max(0, paletteActions.length - 1);
      syncPaletteSelection();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      executePaletteAction(paletteSelection);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeCommandPalette();
    }
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
      if (!elements.contextPicker.hidden) {
        closeContextPicker();
        return;
      }
      if (!elements.commandPalette.hidden) {
        closeCommandPalette();
        return;
      }
      setInspector(false);
      closeSidebar();
    }
    if ((event.ctrlKey || event.metaKey) && ['k', 'p'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      if (elements.commandPalette.hidden) openCommandPalette();
      else closeCommandPalette();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      if (!state.busy) void updateSession({ action: 'new' });
    }
    if ((event.ctrlKey || event.metaKey) && event.key === ',') {
      event.preventDefault();
      setInspector(true, 'settings');
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      toggleNavigation();
    }
  });

  window.addEventListener('beforeunload', () => {
    state.shuttingDown = true;
    if (state.eventRetryTimer) window.clearTimeout(state.eventRetryTimer);
    if (state.connectionNoticeTimer) window.clearTimeout(state.connectionNoticeTimer);
    if (state.eventSource) state.eventSource.close();
  });

  async function initialize() {
    if (state.initializing) return;
    state.initializing = true;
    state.ready = false;
    state.useBearerTransport = false;
    setConnection('connecting', copy.reconnecting);
    elements.sendButton.disabled = true;
    applyTheme(readLocalStorage('orbit.webui.theme', 'system'));
    elements.appShell.classList.toggle(
      'sidebar-collapsed',
      readLocalStorage('orbit.webui.sidebar', 'expanded') === 'collapsed',
    );
    syncSidebarInteractivity();
    const draft = readLocalStorage('orbit.webui.draft', '');
    if (draft) {
      elements.prompt.value = draft;
      autoSizePrompt();
      updateSendButtonState();
    }
    try {
      await bootstrapSession();
      await Promise.all([renderMessages(), loadStatus()]);
      connectEvents();
      if (draft) showToast(copy.draftRestored);
      elements.prompt.focus();
    } catch (error) {
      if (state.eventSource) {
        state.eventSource.close();
        state.eventSource = null;
      }
      setConnection('disconnected', copy.disconnected);
      showToast(error.status === 401 ? copy.accessExpired : error.message || copy.accessExpired, 'error');
      updateSendButtonState();
    } finally {
      state.initializing = false;
    }
  }

  initialize();
`;
