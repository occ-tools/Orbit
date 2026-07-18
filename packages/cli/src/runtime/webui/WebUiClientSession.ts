import { BUILTIN_SLASH_COMMANDS } from "../SlashCommandCatalog.js";

const WEB_UI_CONTROL_COMMANDS = JSON.stringify(BUILTIN_SLASH_COMMANDS);

/** Runtime status, settings mutations, turn lifecycle, and server-sent events. */
export const WEB_UI_CLIENT_SESSION_SCRIPT = String.raw`  const controlCommands = ${WEB_UI_CONTROL_COMMANDS};

  function formatPermissionMode(value) {
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
      [copy.models, (data.modelRouting === 'auto' ? 'Auto · ' : '') + (data.activeModel || '—')],
      [copy.mode, formatPermissionMode(data.permissions && data.permissions.mode || '') || '—'],
      ...(data.session && data.session.goal ? [[copy.goal, data.session.goal]] : []),
      [language === 'zh' ? '项目记忆' : 'Project memory', String(data.memory && data.memory.count || 0) + (data.memory && data.memory.enabled === false ? (language === 'zh' ? ' · 已暂停' : ' · paused') : '')],
      [language === 'zh' ? '任务计划' : 'Task plan', String(data.plan && data.plan.completed || 0) + ' / ' + String(data.plan && data.plan.count || 0)],
      [copy.messages, metric(data.session && data.session.historyMessages)],
      [copy.tokens, metric(data.session && data.session.inputTokens) + ' / ' + metric(data.session && data.session.outputTokens)],
      [copy.contextWindow, contextUsage],
      [copy.cache, metric(data.session && data.session.cacheReadTokens)],
      [copy.cost, '$' + Number(data.session && data.session.cost || 0).toFixed(4)],
    ];
    const metrics = data.session && data.session.metrics;
    if (metrics) {
      rows.push([
        language === 'zh' ? '工具可靠性' : 'Tool reliability',
        String(metrics.toolRuns - metrics.toolFailures) + ' / ' + String(metrics.toolRuns),
      ]);
      rows.push([
        language === 'zh' ? '文件修改 / 压缩' : 'File changes / compactions',
        String(metrics.filesChanged) + ' / ' + String(metrics.compactions),
      ]);
      rows.push([
        language === 'zh' ? '路由（快速 / 质量）' : 'Routes (fast / quality)',
        String(Number(metrics.fastRoutes || 0)) + ' / ' + String(Number(metrics.qualityRoutes || 0)),
      ]);
    }
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
    renderWorkspaceState(data);
  }

  function renderWorkspaceState(data) {
    const plan = data.plan || {};
    const memory = data.memory || {};
    const render = (container, items, emptyText, kind) => {
      container.replaceChildren();
      if (!items.length) {
        const empty = document.createElement('p');
        empty.className = 'review-empty';
        empty.textContent = emptyText;
        container.append(empty);
        return;
      }
      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'review-row' + (item.status ? ' is-' + item.status : '');
        const marker = document.createElement('span');
        marker.className = 'review-marker';
        marker.textContent = item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '●' : '○';
        const text = document.createElement('span');
        text.className = 'review-text';
        text.textContent = item.text || '';
        text.title = item.text || '';
        row.append(marker, text);
        if (kind === 'memory') {
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'review-action';
          remove.dataset.memoryRemove = item.id;
          remove.textContent = '×';
          remove.title = language === 'zh' ? '删除记忆' : 'Remove memory';
          remove.setAttribute('aria-label', remove.title);
          row.append(remove);
        }
        container.append(row);
      }
    };
    const planItems = Array.isArray(plan.items) ? plan.items : [];
    const memoryItems = Array.isArray(memory.entries) ? memory.entries : [];
    elements.planCount.textContent = String(planItems.length);
    elements.memoryCount.textContent = String(memoryItems.length) + (memory.enabled === false ? (language === 'zh' ? ' · 已暂停' : ' · paused') : '');
    render(elements.planReview, planItems, language === 'zh' ? '当前对话暂无计划步骤。' : 'No plan steps for this chat.', 'plan');
    render(elements.memoryReview, memoryItems, language === 'zh' ? '暂无显式项目记忆。' : 'No explicit project memory.', 'memory');
  }

  function workspaceName(path) {
    const parts = String(path || '').replace(/\\/g, '/').split('/').filter(Boolean);
    return parts[parts.length - 1] || 'Orbit';
  }

  function syncProviderOptions(data) {
    const provider = data.provider || {};
    const current = provider.id || '';
    elements.providerSelect.replaceChildren();
    for (const option of provider.options || []) {
      const node = document.createElement('option');
      node.value = option.id;
      node.textContent = option.label + (option.modelCount ? ' · ' + option.modelCount : '');
      node.title = option.baseUrl || option.id;
      elements.providerSelect.append(node);
    }
    elements.providerSelect.value = current;
    syncSelectControl(elements.providerSelect);
  }

  function syncModelOptions(data) {
    const current = data.modelSelection || data.activeModel || '';
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
    syncSelectControl(elements.modelSelect);
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

  function appendSessionActionIcon(button, action) {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');
    svg.setAttribute('class', 'ui-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(namespace, 'path');
    path.setAttribute('d', {
      archive: 'M5.5 8.5h13v10h-13zM4.5 5h15v3.5h-15zM9.5 12h5',
      restore: 'M8 8H4V4M4.5 8a8 8 0 1 1-.2 7',
      delete: 'M8 7v11M12 7v11M16 7v11M5 5h14M9 5V3h6v2M6.5 5l1 16h9l1-16',
    }[action] || 'M6 12h12');
    svg.append(path);
    button.append(svg);
  }

  function renderSessionNavigation(sessionData) {
    state.sessionData = sessionData || {};
    const sessions = Array.isArray(sessionData && sessionData.recent)
      ? sessionData.recent
      : [];
    const archivedSessions = Array.isArray(sessionData && sessionData.archived)
      ? sessionData.archived
      : [];
    const active = sessions.find((session) => session.active);
    const activeTitle = active && active.title || copy.untitledTask;
    byId('workspaceName').textContent = activeTitle;
    byId('workspaceName').title = activeTitle;
    const query = state.sessionQuery.trim().toLocaleLowerCase();
    const matchingSessions = query
      ? sessions.filter((session) => [session.title, session.model]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase().includes(query)))
      : sessions;
    const visibleSessions = matchingSessions.slice(0, state.sessionLimit);
    const renderList = (container, items, archived) => {
      container.replaceChildren();
      for (const session of items) {
        const isActive = Boolean(session.active);
        const row = document.createElement('div');
        row.className = 'session-row'
          + (archived ? ' is-archived' : '')
          + (isActive ? ' is-active' : '');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'recent-session';
        button.dataset.sessionId = session.id;
        button.setAttribute('aria-label', copy.recentSession + ': ' + (session.title || copy.untitledTask));
        if (isActive) button.setAttribute('aria-current', 'page');
        const title = document.createElement('span');
        title.className = 'recent-session-title';
        title.textContent = session.title || copy.untitledTask;
        const meta = document.createElement('span');
        meta.className = 'recent-session-meta';
        meta.textContent = [relativeSessionTime(session.updatedAt), session.model].filter(Boolean).join(' · ');
        button.append(title, meta);
        row.append(button);
        if (!isActive) {
          const actions = document.createElement('span');
          actions.className = 'session-actions';
          const secondaryAction = document.createElement('button');
          secondaryAction.type = 'button';
          secondaryAction.className = 'session-action';
          secondaryAction.dataset.sessionAction = archived ? 'restore' : 'archive';
          secondaryAction.dataset.sessionId = session.id;
          appendSessionActionIcon(secondaryAction, archived ? 'restore' : 'archive');
          secondaryAction.title = archived ? copy.restoreSession : copy.archiveSession;
          secondaryAction.setAttribute('aria-label', secondaryAction.title);
          const deleteAction = document.createElement('button');
          deleteAction.type = 'button';
          deleteAction.className = 'session-action is-danger';
          deleteAction.dataset.sessionAction = 'delete';
          deleteAction.dataset.sessionId = session.id;
          appendSessionActionIcon(deleteAction, 'delete');
          deleteAction.title = copy.deleteSession;
          deleteAction.setAttribute('aria-label', copy.deleteSession);
          actions.append(secondaryAction, deleteAction);
          row.append(actions);
        }
        container.append(row);
      }
    };
    renderList(elements.recentSessions, visibleSessions, false);
    renderList(elements.archivedSessions, archivedSessions, true);
    elements.sessionSearchField.hidden = sessions.length < 12;
    elements.sessionShowMore.hidden = visibleSessions.length >= matchingSessions.length;
    elements.recentEmpty.textContent = query ? copy.noMatchingChats : copy.noRecentTasks;
    elements.recentEmpty.hidden = matchingSessions.length > 0;
    elements.archivedEmpty.hidden = elements.archivedSessions.childElementCount > 0;
    elements.archiveCount.textContent = String(archivedSessions.length);
    elements.archiveToggle.classList.toggle('has-items', archivedSessions.length > 0);
    const sessionCount = Number(sessionData && sessionData.count || sessions.length + archivedSessions.length);
    elements.projectChatCount.textContent = String(sessionCount);
    elements.projectChatCount.setAttribute('aria-label', String(sessionCount));
  }

  function renderProjectNavigation(projects, currentWorkspace) {
    elements.projectList.replaceChildren();
    const normalizePath = (value) => String(value || '').replace(/\\/g, '/').toLocaleLowerCase();
    const current = normalizePath(currentWorkspace);
    const recentProjects = (Array.isArray(projects) ? projects : [])
      .filter((item) => item.available === true && normalizePath(item.path) !== current)
      .slice(0, 6);
    for (const project of recentProjects) {
      const row = document.createElement('div');
      row.className = 'registered-project';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'registered-project-open';
      button.dataset.projectPath = project.path || '';
      button.setAttribute('aria-label', 'Open project: ' + (project.name || 'Orbit'));
      const icon = document.createElement('span');
      icon.className = 'registered-project-icon project-folder-icon';
      icon.innerHTML = '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v10h-17z"/></svg>';
      const copyNode = document.createElement('span');
      copyNode.className = 'project-copy';
      const name = document.createElement('strong');
      name.textContent = project.name || workspaceName(project.path);
      const path = document.createElement('small');
      path.textContent = project.path || '';
      copyNode.append(name, path);
      button.append(icon, copyNode);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'registered-project-remove';
      remove.dataset.projectAction = 'remove';
      remove.dataset.projectId = project.id || '';
      remove.title = copy.removeProject;
      remove.setAttribute('aria-label', copy.removeProject + ': ' + (project.name || 'Orbit'));
      remove.textContent = '×';
      row.append(button, remove);
      elements.projectList.append(row);
    }
    elements.recentProjectsShell.hidden = elements.projectList.childElementCount === 0;
  }

  async function updateSession(action) {
    if (state.busy) return;
    state.busy = true;
    elements.newTaskButton.disabled = true;
    elements.recentSessions.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    elements.archivedSessions.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try {
      await api('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      });
      const navigates = action.action === 'new' || action.action === 'resume';
      if (navigates) {
        clearActivity();
        await Promise.all([renderMessages(), loadStatus()]);
      } else {
        await loadStatus();
      }
      const notice = {
        new: copy.sessionCreated,
        resume: copy.sessionSwitched,
        archive: copy.sessionArchived,
        restore: copy.sessionRestored,
        delete: copy.sessionDeleted,
      }[action.action] || copy.sessionSwitched;
      showToast(notice, 'success');
      if (navigates) {
        closeSidebar();
        elements.prompt.focus();
      }
    } catch (error) {
      showToast(error.message || String(error), 'error');
    } finally {
      state.busy = false;
      elements.newTaskButton.disabled = false;
      elements.recentSessions.querySelectorAll('button').forEach((button) => { button.disabled = false; });
      elements.archivedSessions.querySelectorAll('button').forEach((button) => { button.disabled = false; });
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
    byId('sidebarSession').textContent = data.workspace || 'local';
    byId('sidebarSession').title = data.workspace || '';
    renderProjectNavigation(data.projects || [], data.workspace);
    renderSessionNavigation(data.session || {});
    elements.runtimeUpdated.textContent = formatTime(data.updatedAt);
    fillRuntime(data);
    syncProviderOptions(data);
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
    syncSelectControl(elements.permissionSelect);
    elements.permissionSegments.querySelectorAll('[data-mode]').forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const webSearch = data.tools && data.tools.webSearch || {};
    elements.searchProvider.value = webSearch.provider || 'auto';
    syncSelectControl(elements.searchProvider);
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
    syncSelectControl(elements.searchProvider);
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
    const request = (async () => {
      await api('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      await loadStatus();
      if (!quiet) showToast(copy.settingsSaved, 'success');
    })();
    state.settingsPromise = request;
    try {
      await request;
    } catch (error) {
      await loadStatus().catch(() => {});
      showToast(error.message || String(error), 'error');
      throw error;
    } finally {
      if (state.settingsPromise === request) state.settingsPromise = null;
    }
  }

  function isControlCommand(value) {
    if (value.startsWith('!')) return true;
    const name = value.split(/\s+/, 1)[0].toLowerCase();
    return controlCommands.includes(name);
  }

  async function submitTurn(prompt, options) {
    const value = String(prompt || '').trim();
    if (!value || state.busy) return;
    if (!state.ready) {
      showToast(copy.waitForConnection, 'warning');
      elements.prompt.focus();
      return;
    }
    if (state.settingsPromise) {
      setBusy(true, copy.settingsSaving);
      try {
        await state.settingsPromise;
      } catch {
        setBusy(false, '');
        elements.prompt.focus();
        return;
      }
      setBusy(false, '');
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
    } else if (event.type === 'model_routing') {
      const lane = payload.lane || 'balanced';
      addActivity((payload.model || copy.models) + ' · ' + lane + ' · ' + (payload.reason || ''), '', 'routing');
    } else if (event.type === 'model_request') {
      setStreamingModel(payload.model || '');
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
    const completedControlCommand =
      state.controlTurnId && state.controlTurnId === state.activeTurnId;
    const completedControlPrompt = state.controlPrompt || 'Command';
    if (completedControlCommand) {
      addActivity(completedControlPrompt + ' · ' + resultLabel, resultKind, 'control');
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
    // Activity keys only coalesce updates within one turn. Keeping them
    // across turns rewrites old model/verification rows with new timestamps
    // and makes the audit trail claim an earlier turn used the new model.
    state.toolRows.clear();
    if (event.message && failed) showToast(event.message, 'error');
    else if (completedControlCommand && !aborted) {
      showToast(completedControlPrompt + ' · ' + copy.done, 'success');
    }
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
