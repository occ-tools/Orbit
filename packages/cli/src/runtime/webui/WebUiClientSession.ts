/** Runtime status, settings mutations, turn lifecycle, and server-sent events. */
export const WEB_UI_CLIENT_SESSION_SCRIPT = String.raw`  function formatPermissionMode(value) {
    return {
      strict: copy.modeStrict,
      normal: copy.modeNormal,
      auto: copy.modeAuto,
      plan: copy.modePlan,
    }[value] || value;
  }

  function fillRuntime(data) {
    const context = data.context || {};
    const metric = (value) => Number(value || 0).toLocaleString();
    const contextUsage = context.maxContextTokens
      ? metric(context.estimatedHistoryTokens) + ' / ' + metric(context.maxContextTokens)
      : '—';
    const rows = [
      [copy.models, data.activeModel || '—'],
      [copy.mode, formatPermissionMode(data.permissions && data.permissions.mode || '') || '—'],
      [copy.messages, metric(data.session && data.session.historyMessages)],
      [copy.tokens, metric(data.session && data.session.inputTokens) + ' / ' + metric(data.session && data.session.outputTokens)],
      [copy.contextWindow, contextUsage],
      [copy.cache, metric(data.session && data.session.cacheReadTokens)],
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
    const compactAt = Number(context.compactAtTokens || 0);
    const estimated = Number(context.estimatedHistoryTokens || 0);
    const usagePercent = compactAt > 0 ? Math.max(0, (estimated / compactAt) * 100) : 0;
    const ringPercent = Math.min(100, usagePercent);
    elements.contextMeter.style.setProperty('--context-pct', ringPercent + '%');
    elements.contextPercent.textContent = Math.round(usagePercent) + '%';
    elements.contextMeter.classList.toggle('is-warm', usagePercent >= 72 && usagePercent < 90);
    elements.contextMeter.classList.toggle('is-hot', usagePercent >= 90);
    const meterLimit = compactAt || Number(context.maxContextTokens || 0);
    const meterDetail = estimated.toLocaleString() + ' / ' + meterLimit.toLocaleString() + ' tokens';
    elements.contextMeter.title = meterDetail;
    elements.contextMeter.setAttribute('aria-label', copy.contextWindow + ': ' + meterDetail);
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

  function relativeSessionTime(value) {
    const timestamp = Date.parse(value || '');
    if (!Number.isFinite(timestamp)) return '';
    const delta = Math.max(0, Date.now() - timestamp);
    const minutes = Math.floor(delta / 60000);
    if (minutes < 1) return language === 'zh' ? '刚刚' : 'now';
    if (minutes < 60) return language === 'zh' ? minutes + ' 分钟' : minutes + 'm';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return language === 'zh' ? hours + ' 小时' : hours + 'h';
    const days = Math.floor(hours / 24);
    return language === 'zh' ? days + ' 天' : days + 'd';
  }

  function renderSessionNavigation(sessionData) {
    const sessions = Array.isArray(sessionData && sessionData.recent)
      ? sessionData.recent
      : [];
    const active = sessions.find((session) => session.active);
    const activeTitle = active && active.title || copy.untitledTask;
    elements.activeTaskTitle.textContent = activeTitle;
    elements.activeTaskTitle.title = activeTitle;
    byId('workspaceName').textContent = activeTitle;
    byId('workspaceName').title = activeTitle;
    elements.recentSessions.replaceChildren();
    for (const session of sessions.filter((candidate) => !candidate.active)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'recent-session';
      button.dataset.sessionId = session.id;
      button.setAttribute('aria-label', copy.recentSession + ': ' + (session.title || copy.untitledTask));
      const title = document.createElement('span');
      title.className = 'recent-session-title';
      title.textContent = session.title || copy.untitledTask;
      const meta = document.createElement('span');
      meta.className = 'recent-session-meta';
      meta.textContent = [relativeSessionTime(session.updatedAt), session.model].filter(Boolean).join(' · ');
      button.append(title, meta);
      elements.recentSessions.append(button);
    }
    elements.recentSection.hidden = elements.recentSessions.childElementCount === 0;
  }

  async function updateSession(action) {
    if (state.busy) return;
    state.busy = true;
    elements.newTaskButton.disabled = true;
    elements.recentSessions.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try {
      await api('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      });
      clearActivity();
      await Promise.all([renderMessages(), loadStatus()]);
      showToast(action.action === 'new' ? copy.sessionCreated : copy.sessionSwitched, 'success');
      closeSidebar();
      elements.prompt.focus();
    } catch (error) {
      showToast(error.message || String(error), 'error');
    } finally {
      state.busy = false;
      elements.newTaskButton.disabled = false;
      elements.recentSessions.querySelectorAll('button').forEach((button) => { button.disabled = false; });
    }
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
    renderSessionNavigation(data.session || {});
    elements.runtimeUpdated.textContent = formatTime(data.updatedAt);
    fillRuntime(data);
    syncModelOptions(data);
    const contextCount = Number(data.context && data.context.relevantFiles || 0);
    elements.contextChipCount.textContent = String(contextCount);
    elements.contextChipCount.hidden = contextCount === 0;
    elements.contextChipCount.setAttribute('aria-label', String(contextCount));
    elements.contextPickerButton.setAttribute(
      'aria-label',
      copy.context + (contextCount ? ' · ' + contextCount : ''),
    );
    renderContextShelf(data.context || {});
    renderPendingApproval(data.approval);

    const mode = data.permissions && data.permissions.mode || 'normal';
    elements.permissionSelect.value = mode;
    elements.permissionSegments.querySelectorAll('[data-mode]').forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const webSearch = data.tools && data.tools.webSearch || {};
    elements.searchProvider.value = webSearch.provider || 'auto';
    elements.searchMax.value = webSearch.maxResults || 8;
    syncSearchSettings(Boolean(webSearch.enabled));
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

  function syncSearchSettings(enabled) {
    elements.searchEnabled.checked = enabled;
    elements.searchToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    const disabled = !enabled || state.busy;
    elements.searchDependencies.classList.toggle('is-disabled', !enabled);
    elements.searchDependencies.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    elements.searchProvider.disabled = disabled;
    elements.searchMax.disabled = disabled;
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

  function isControlCommand(value) {
    if (value.startsWith('!')) return true;
    const name = value.split(/\s+/, 1)[0].toLowerCase();
    return [
      '/help', '/status', '/doctor', '/config', '/model', '/chat', '/commit',
      '/exit', '/quit', '/rollback', '/compact', '/clear', '/add', '/drop',
      '/mode', '/copy', '/run', '/update', '/webui',
    ].includes(name);
  }

  async function submitTurn(prompt, options) {
    const value = String(prompt || '').trim();
    if (!value || state.busy) return;
    if (!state.ready) {
      showToast(copy.waitForConnection, 'warning');
      elements.prompt.focus();
      return;
    }
    closeContextPicker({ skipRestore: true });
    const turnId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    const previousDraft = elements.prompt.value;
    const restoreDraft = String(options && options.restoreDraft || '');
    const controlCommand = isControlCommand(value);
    state.submitting = true;
    state.activeTurnId = turnId;
    state.controlTurnId = controlCommand ? turnId : null;
    state.controlPrompt = controlCommand ? value : '';
    state.externalTurn = false;
    setBusy(true, copy.thinking);
    if (controlCommand) {
      addActivity(value + ' · ' + copy.running, '', 'control');
    } else {
      createStreamingTurn(value, turnId);
    }
    elements.prompt.value = '';
    writeLocalStorage('orbit.webui.draft', '');
    autoSizePrompt();
    updateSendButtonState();
    closeSidebar();
    try {
      const result = await api('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: value, turnId }),
      });
      if (result.turnId) state.activeTurnId = result.turnId;
      if (restoreDraft) {
        elements.prompt.value = restoreDraft;
        writeLocalStorage('orbit.webui.draft', restoreDraft);
        autoSizePrompt();
        updateSendButtonState();
      }
      state.submitting = false;
      void reconcileStatus();
    } catch (error) {
      state.submitting = false;
      setBusy(false, '');
      state.activeTurnId = null;
      state.controlTurnId = null;
      state.controlPrompt = '';
      elements.prompt.value = previousDraft || value;
      writeLocalStorage('orbit.webui.draft', elements.prompt.value);
      autoSizePrompt();
      updateSendButtonState();
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

    if (event.type === 'ui_turn_started' && payload.source === 'terminal') {
      if (state.busy) return;
      const turnId = payload.turnId || 'terminal-' + Date.now();
      state.activeTurnId = turnId;
      state.externalTurn = true;
      state.controlTurnId = null;
      setBusy(true, copy.working);
      createStreamingTurn(payload.prompt || '', turnId);
      addActivity(copy.terminalTurn + ' · ' + copy.running, '', 'external');
    } else if (event.type === 'ui_turn_completed' && payload.source === 'terminal') {
      if (!state.externalTurn || payload.turnId !== state.activeTurnId) return;
      void finishTurn({
        turnId: payload.turnId,
        status: payload.status,
        message: payload.message,
      });
    } else if (event.type === 'model_delta' && state.streaming) {
      state.pendingDelta += payload.text || '';
      scheduleStreamFlush();
    } else if (event.type === 'thinking_delta' && state.streaming) {
      state.pendingThinking += payload.text || '';
      addActivity(copy.thinking, '', 'thinking');
      setStreamingProgress(copy.thinking, 'running');
      scheduleStreamFlush();
    } else if (event.type === 'model_request') {
      addActivity((payload.model || copy.models) + ' · ' + copy.running, '', 'model');
      setStreamingProgress((payload.model || copy.models) + ' · ' + copy.running, 'running');
      setBusy(true, copy.thinking);
    } else if (event.type === 'model_response') {
      addActivity((payload.model || copy.models) + ' · ' + copy.done, 'success', 'model');
      setStreamingProgress((payload.model || copy.models) + ' · ' + copy.done, 'success');
    } else if (event.type === 'tool_proposal') {
      const key = 'tool-' + (payload.toolCallId || payload.toolName || Date.now());
      addActivity((payload.toolName || copy.tool) + ' · ' + copy.running, 'warning', key);
      setStreamingProgress((payload.toolName || copy.tool) + ' · ' + copy.running, 'warning');
      upsertStreamingTool(payload, 'running');
    } else if (event.type === 'web_approval_requested') {
      addActivity(copy.approvalRequired, 'warning', 'approval');
      setBusy(true, copy.approvalRequired);
      void reconcileStatus();
    } else if (event.type === 'web_approval_resolved') {
      addActivity(payload.approved ? copy.approvalApproved : copy.approvalDenied, payload.approved ? 'success' : 'warning', 'approval');
      void reconcileStatus();
    } else if (event.type === 'tool_result') {
      const key = 'tool-' + (payload.toolCallId || payload.toolName || '');
      addActivity((payload.toolName || copy.tool) + ' · ' + (payload.error ? copy.error : copy.done), payload.error ? 'error' : 'success', key);
      setStreamingProgress(
        (payload.toolName || copy.tool) + ' · ' + (payload.error ? copy.error : copy.done),
        payload.error ? 'error' : 'success',
      );
      upsertStreamingTool(payload, payload.error ? 'error' : 'success');
    } else if (event.type === 'verification_started') {
      addActivity('Verification · ' + copy.running, '', 'verification');
      setStreamingProgress('Verification · ' + copy.running, 'running');
    } else if (event.type === 'verification_ended') {
      addActivity('Verification · ' + (payload.success ? copy.done : copy.error), payload.success ? 'success' : 'error', 'verification');
      setStreamingProgress(
        'Verification · ' + (payload.success ? copy.done : copy.error),
        payload.success ? 'success' : 'error',
      );
    } else if (event.type === 'cache_update' || event.type === 'cost_update') {
      loadStatus().catch(() => {});
    } else if (event.type === 'warning') {
      addActivity(payload.message || 'Warning', 'warning');
      setStreamingProgress(payload.message || 'Warning', 'warning');
    } else if (event.type === 'error') {
      addActivity(payload.message || copy.error, 'error');
      setStreamingProgress(payload.message || copy.error, 'error');
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
    const resultKind = aborted ? 'warning' : failed ? 'error' : 'success';
    const resultLabel = aborted ? copy.stopped : failed ? copy.error : copy.done;
    if (state.controlTurnId && state.controlTurnId === state.activeTurnId) {
      addActivity((state.controlPrompt || 'Command') + ' · ' + resultLabel, resultKind, 'control');
    } else if (state.externalTurn) {
      addActivity(copy.terminalTurn + ' · ' + resultLabel, resultKind, 'external');
    } else {
      addActivity(activeModel + ' · ' + resultLabel, resultKind, 'model');
    }
    addActivity(
      aborted ? copy.stopped : failed ? copy.failed : copy.completed,
      aborted ? 'warning' : failed ? 'error' : 'success',
    );
    setBusy(false, '');
    state.activeTurnId = null;
    state.controlTurnId = null;
    state.controlPrompt = '';
    state.externalTurn = false;
    state.currentThinkingRow = null;
    if (event.message && failed) showToast(event.message, 'error');
    await Promise.all([renderMessages(), loadStatus()]).catch((error) => {
      showToast(error.message || String(error), 'error');
    });
    elements.prompt.focus();
  }

  function connectEvents() {
    if (state.shuttingDown) return;
    if (state.eventRetryTimer) {
      window.clearTimeout(state.eventRetryTimer);
      state.eventRetryTimer = 0;
    }
    if (state.eventSource) state.eventSource.close();
    setConnection('connecting', copy.reconnecting);
    const eventUrl = state.useBearerTransport && webSessionToken
      ? '/api/events?access_token=' + encodeURIComponent(webSessionToken)
      : '/api/events';
    const source = new EventSource(eventUrl, { withCredentials: true });
    state.eventSource = source;
    source.onopen = () => {
      state.eventRetryAttempt = 0;
      state.ready = true;
      updateSendButtonState();
      setConnection('connected', copy.connected);
      void reconcileStatus();
    };
    source.onerror = () => {
      if (state.eventSource !== source) return;
      state.ready = false;
      updateSendButtonState();
      source.close();
      state.eventSource = null;
      const retryAttempt = state.eventRetryAttempt;
      setConnection(
        retryAttempt < 2 ? 'connecting' : 'disconnected',
        retryAttempt < 2 ? copy.reconnecting : copy.disconnected,
      );
      const delay = Math.min(8000, 500 * Math.pow(2, state.eventRetryAttempt));
      state.eventRetryAttempt = Math.min(state.eventRetryAttempt + 1, 5);
      state.eventRetryTimer = window.setTimeout(async () => {
        state.eventRetryTimer = 0;
        try {
          await recoverSessionCookie();
        } catch {}
        connectEvents();
      }, delay);
    };
    source.onmessage = (message) => {
      let event;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      if (event.kind === 'system') {
        state.ready = true;
        updateSendButtonState();
        setConnection('connected', copy.connected);
        void reconcileStatus();
      } else if (event.kind === 'heartbeat') {
        state.ready = true;
        updateSendButtonState();
        setConnection('connected', copy.connected);
      } else if (event.kind === 'turn_started') {
        state.activeTurnId = event.turnId;
        setBusy(true, copy.working);
        if (state.controlTurnId !== event.turnId) {
          ensureStreamingTurn(event.turnId);
          addActivity(copy.working, '');
        }
      } else if (event.kind === 'turn_done') {
        finishTurn(event);
      } else if (event.kind === 'orbit_event') {
        handleOrbitEvent(event);
      }
    };
  }

`;
