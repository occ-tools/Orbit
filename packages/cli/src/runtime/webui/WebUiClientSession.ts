/** Runtime status, settings mutations, turn lifecycle, and server-sent events. */
export const WEB_UI_CLIENT_SESSION_SCRIPT = String.raw`  function fillRuntime(data) {
    const rows = [
      [copy.models, data.activeModel || '—'],
      [copy.mode, data.permissions && data.permissions.mode || '—'],
      [copy.messages, data.session && data.session.historyMessages || 0],
      [copy.tokens, data.session && data.session.outputTokens || 0],
      [copy.cache, data.session && data.session.cacheReadTokens || 0],
      [copy.cost, '$' + Number(data.session && data.session.cost || 0).toFixed(4)],
    ];
    elements.runtime.replaceChildren();
    for (const row of rows) {
      const wrapper = document.createElement('div');
      wrapper.className = 'runtime-item';
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = row[0];
      dd.textContent = String(row[1]);
      dd.title = String(row[1]);
      wrapper.append(dt, dd);
      elements.runtime.append(wrapper);
    }
  }

  function workspaceName(path) {
    const parts = String(path || '').replace(/\\/g, '/').split('/').filter(Boolean);
    return parts[parts.length - 1] || 'Orbit';
  }

  function syncModelOptions(data) {
    const current = data.activeModel || '';
    elements.modelSelect.replaceChildren();
    for (const option of data.modelOptions || []) {
      const node = document.createElement('option');
      node.value = option.id;
      node.textContent = option.label;
      elements.modelSelect.append(node);
    }
    if (![...elements.modelSelect.options].some((option) => option.value === current)) {
      const custom = document.createElement('option');
      custom.value = current;
      custom.textContent = current || 'custom';
      elements.modelSelect.prepend(custom);
    }
    elements.modelSelect.value = current;
  }

  async function loadStatus() {
    const data = await api('/api/status');
    state.status = data;
    const name = workspaceName(data.workspace);
    byId('workspaceName').textContent = name;
    byId('workspacePath').textContent = data.workspace || '';
    byId('sidebarWorkspace').textContent = name;
    byId('sidebarWorkspace').title = data.workspace || '';
    byId('sidebarSession').textContent = data.session && data.session.activeId || 'local';
    elements.runtimeUpdated.textContent = formatTime(data.updatedAt);
    fillRuntime(data);
    syncModelOptions(data);

    const mode = data.permissions && data.permissions.mode || 'normal';
    elements.permissionSelect.value = mode;
    elements.permissionSegments.querySelectorAll('[data-mode]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.mode === mode);
    });
    const webSearch = data.tools && data.tools.webSearch || {};
    elements.searchEnabled.checked = Boolean(webSearch.enabled);
    elements.searchToggle.setAttribute('aria-pressed', webSearch.enabled ? 'true' : 'false');
    elements.searchProvider.value = webSearch.provider || 'auto';
    elements.searchMax.value = webSearch.maxResults || 8;
    elements.cache.textContent = data.cacheDiagnostics || '—';
    const hitTokens = data.session && data.session.cacheReadTokens || 0;
    elements.cacheSummary.textContent = hitTokens ? String(hitTokens) + ' tokens' : '—';

    if (data.turn && data.turn.active) {
      state.activeTurnId = data.turn.id;
      setBusy(true, copy.working);
      ensureStreamingTurn(data.turn.id);
    } else if (state.busy && !state.submitting) {
      if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
      flushStream();
      state.activeTurnId = null;
      setBusy(false, '');
      await renderMessages();
    }
    return data;
  }

  function reconcileStatus() {
    if (state.statusRefresh) return state.statusRefresh;
    const refresh = loadStatus()
      .catch((error) => showToast(error.message || String(error), 'error'))
      .finally(() => {
        if (state.statusRefresh === refresh) state.statusRefresh = null;
      });
    state.statusRefresh = refresh;
    return refresh;
  }

  function addActivity(message, kind, key) {
    elements.activityEmpty.hidden = true;
    if (key) {
      const existing = key === 'thinking' ? state.currentThinkingRow : state.toolRows.get(key);
      if (existing) {
        existing.querySelector('span').textContent = message;
        existing.className = 'activity-row' + (kind ? ' is-' + kind : '');
        return existing;
      }
    }
    const row = document.createElement('div');
    row.className = 'activity-row' + (kind ? ' is-' + kind : '');
    const text = document.createElement('span');
    text.textContent = message;
    const time = document.createElement('time');
    time.className = 'activity-time';
    time.textContent = formatTime();
    row.append(text, time);
    elements.events.append(row);
    state.activityRows += 1;
    if (key === 'thinking') state.currentThinkingRow = row;
    else if (key) state.toolRows.set(key, row);
    while (state.activityRows > 80) {
      const first = elements.events.querySelector('.activity-row');
      if (!first) break;
      if (state.currentThinkingRow === first) state.currentThinkingRow = null;
      for (const [rowKey, row] of state.toolRows) {
        if (row === first) state.toolRows.delete(rowKey);
      }
      first.remove();
      state.activityRows -= 1;
    }
    return row;
  }

  function clearActivity() {
    elements.events.querySelectorAll('.activity-row').forEach((row) => row.remove());
    elements.activityEmpty.hidden = false;
    state.activityRows = 0;
    state.currentThinkingRow = null;
    state.toolRows.clear();
  }

  async function applySettings(patch, quiet) {
    try {
      await api('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      await loadStatus();
      if (!quiet) showToast(copy.settingsSaved, 'success');
    } catch (error) {
      await loadStatus().catch(() => {});
      showToast(error.message || String(error), 'error');
      throw error;
    }
  }

  async function submitTurn(prompt) {
    const value = String(prompt || '').trim();
    if (!value || state.busy) return;
    const turnId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    const previousDraft = elements.prompt.value;
    state.submitting = true;
    state.activeTurnId = turnId;
    setBusy(true, copy.thinking);
    createStreamingTurn(value, turnId);
    elements.prompt.value = '';
    localStorage.removeItem('orbit.webui.draft');
    autoSizePrompt();
    closeSidebar();
    try {
      const result = await api('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: value, turnId }),
      });
      if (result.turnId) state.activeTurnId = result.turnId;
      state.submitting = false;
    } catch (error) {
      state.submitting = false;
      setBusy(false, '');
      state.activeTurnId = null;
      elements.prompt.value = previousDraft || value;
      localStorage.setItem('orbit.webui.draft', elements.prompt.value);
      autoSizePrompt();
      await renderMessages().catch(() => {});
      showToast(error.message || String(error), 'error');
    }
  }

  async function stopTurn() {
    if (!state.busy || state.stopping) return;
    state.stopping = true;
    setBusy(true, copy.stopping);
    try {
      await api('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnId: state.activeTurnId }),
      });
    } catch (error) {
      state.stopping = false;
      setBusy(true, copy.working);
      showToast(error.message || String(error), 'error');
    }
  }

  function handleOrbitEvent(event) {
    const payload = event.payload || {};
    const belongsToTurn = !event.turnId || !state.activeTurnId || event.turnId === state.activeTurnId;
    if ((event.type === 'model_delta' || event.type === 'thinking_delta') && !belongsToTurn) return;

    if (event.type === 'model_delta' && state.streaming) {
      state.pendingDelta += payload.text || '';
      scheduleStreamFlush();
    } else if (event.type === 'thinking_delta' && state.streaming) {
      state.pendingThinking += payload.text || '';
      addActivity(copy.thinking, '', 'thinking');
      scheduleStreamFlush();
    } else if (event.type === 'model_request') {
      addActivity((payload.model || copy.models) + ' · ' + copy.running, '', 'model');
      setBusy(true, copy.thinking);
    } else if (event.type === 'model_response') {
      addActivity((payload.model || copy.models) + ' · ' + copy.done, 'success', 'model');
    } else if (event.type === 'tool_proposal') {
      const key = 'tool-' + (payload.toolCallId || payload.toolName || Date.now());
      addActivity((payload.toolName || copy.tool) + ' · ' + copy.running, 'warning', key);
      if (state.status && state.status.permissions && state.status.permissions.mode !== 'auto') {
        elements.turnStatus.textContent = copy.terminalApproval;
      }
    } else if (event.type === 'tool_result') {
      const key = 'tool-' + (payload.toolCallId || payload.toolName || '');
      addActivity((payload.toolName || copy.tool) + ' · ' + (payload.error ? copy.error : copy.done), payload.error ? 'error' : 'success', key);
    } else if (event.type === 'verification_started') {
      addActivity('Verification · ' + copy.running, '', 'verification');
    } else if (event.type === 'verification_ended') {
      addActivity('Verification · ' + (payload.success ? copy.done : copy.error), payload.success ? 'success' : 'error', 'verification');
    } else if (event.type === 'cache_update' || event.type === 'cost_update') {
      loadStatus().catch(() => {});
    } else if (event.type === 'warning') {
      addActivity(payload.message || 'Warning', 'warning');
    } else if (event.type === 'error') {
      addActivity(payload.message || copy.error, 'error');
      showToast(payload.message || copy.failed, 'error');
    } else if (event.type === 'info' && payload.message) {
      addActivity(payload.message, '');
    }
  }

  async function finishTurn(event) {
    if (event.turnId && state.activeTurnId && event.turnId !== state.activeTurnId) return;
    if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
    flushStream();
    const status = event.status || (event.ok === false ? 'failed' : 'completed');
    const failed = status === 'failed';
    const aborted = status === 'aborted';
    const activeModel = state.status && state.status.activeModel || copy.models;
    addActivity(
      activeModel + ' · ' + (aborted ? copy.stopped : failed ? copy.error : copy.done),
      aborted ? 'warning' : failed ? 'error' : 'success',
      'model',
    );
    addActivity(
      aborted ? copy.stopped : failed ? copy.failed : copy.completed,
      aborted ? 'warning' : failed ? 'error' : 'success',
    );
    setBusy(false, '');
    state.activeTurnId = null;
    state.currentThinkingRow = null;
    if (event.message && failed) showToast(event.message, 'error');
    await Promise.all([renderMessages(), loadStatus()]).catch((error) => {
      showToast(error.message || String(error), 'error');
    });
    elements.prompt.focus();
  }

  function connectEvents() {
    if (state.eventSource) state.eventSource.close();
    setConnection('connecting', copy.reconnecting);
    const source = new EventSource('/api/events', { withCredentials: true });
    state.eventSource = source;
    source.onopen = () => {
      setConnection('connected', copy.connected);
      void reconcileStatus();
    };
    source.onerror = () => setConnection('disconnected', copy.reconnecting);
    source.onmessage = (message) => {
      let event;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      if (event.kind === 'system') {
        setConnection('connected', copy.connected);
        void reconcileStatus();
      } else if (event.kind === 'heartbeat') {
        setConnection('connected', copy.connected);
      } else if (event.kind === 'turn_started') {
        state.activeTurnId = event.turnId;
        setBusy(true, copy.working);
        ensureStreamingTurn(event.turnId);
        addActivity(copy.working, '');
      } else if (event.kind === 'turn_done') {
        finishTurn(event);
      } else if (event.kind === 'orbit_event') {
        handleOrbitEvent(event);
      }
    };
  }

`;
