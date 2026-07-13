/** Localization, DOM references, shared state, and shell-level browser helpers. */
export const WEB_UI_CLIENT_FOUNDATION_SCRIPT = String.raw`  const byId = (id) => document.getElementById(id);
  const language = document.documentElement.lang === 'zh' ? 'zh' : 'en';
  const copy = language === 'zh'
    ? {
        connected: '已连接',
        reconnecting: '正在重连',
        disconnected: '连接断开',
        ready: '准备就绪',
        thinking: 'Orbit 正在思考…',
        sendAction: '发送消息',
        stopAction: '停止生成',
        stopping: '正在停止…',
        stopped: '已停止生成',
        working: '正在处理任务…',
        failed: '任务失败',
        completed: '任务已完成',
        copied: '已复制代码',
        copy: '复制',
        copiedShort: '已复制',
        reasoning: '思考过程',
        tool: '工具',
        running: '运行中',
        done: '完成',
        error: '失败',
        noReply: 'Orbit 未返回文字内容。',
        accessExpired: 'WebUI 访问凭据无效，请在终端重新运行 /webui。',
        settingsSaved: '设置已更新',
        nothingRunning: '当前没有正在运行的任务。',
        terminalApproval: '此工具可能需要在终端确认权限。',
        models: '模型',
        mode: '权限',
        messages: '消息',
        tokens: '输出',
        cache: '缓存读取',
        cost: '费用',
        user: '你',
        assistant: 'Orbit',
        draftRestored: '已恢复上次未发送的内容',
      }
    : {
        connected: 'Connected',
        reconnecting: 'Reconnecting',
        disconnected: 'Disconnected',
        ready: 'Ready',
        thinking: 'Orbit is thinking…',
        sendAction: 'Send message',
        stopAction: 'Stop generating',
        stopping: 'Stopping…',
        stopped: 'Generation stopped',
        working: 'Working on your task…',
        failed: 'Task failed',
        completed: 'Task complete',
        copied: 'Code copied',
        copy: 'Copy',
        copiedShort: 'Copied',
        reasoning: 'Reasoning',
        tool: 'Tool',
        running: 'Running',
        done: 'Done',
        error: 'Failed',
        noReply: 'Orbit returned no text.',
        accessExpired: 'Web UI access expired. Run /webui again in Orbit.',
        settingsSaved: 'Settings updated',
        nothingRunning: 'Nothing is currently running.',
        terminalApproval: 'This tool may require approval in the terminal.',
        models: 'Model',
        mode: 'Mode',
        messages: 'Messages',
        tokens: 'Output',
        cache: 'Cache read',
        cost: 'Cost',
        user: 'You',
        assistant: 'Orbit',
        draftRestored: 'Restored your unsent draft',
      };

  const suggestionPrompts = language === 'zh'
    ? [
        '全面审查这个项目，找出影响最大的问题并直接修复，最后运行完整验证。',
        '诊断当前项目中最可能导致构建失败或运行异常的问题，并完成修复。',
        '先阅读项目结构，然后用清晰的语言解释核心架构、数据流和主要入口。',
        '全面优化当前项目的性能、安全性和可维护性，并用测试验证所有改动。',
      ]
    : [
        'Review this entire project, fix the highest-impact issues, and run full verification.',
        'Diagnose the most likely build or runtime failure in this project and fix it.',
        'Inspect the project, then explain its architecture, data flow, and main entry points.',
        'Improve this project\'s performance, security, and maintainability, then verify every change.',
      ];

  const elements = {
    appShell: byId('appShell'),
    sidebar: byId('sidebar'),
    sidebarBackdrop: byId('sidebarBackdrop'),
    menuButton: byId('menuButton'),
    inspector: byId('inspector'),
    inspectorButton: byId('inspectorButton'),
    inspectorClose: byId('inspectorClose'),
    activityTab: byId('activityTab'),
    settingsTab: byId('settingsTab'),
    activityPanel: byId('activityPanel'),
    settingsPanel: byId('settingsPanel'),
    messageScroll: byId('messageScroll'),
    messages: byId('messages'),
    emptyState: byId('emptyState'),
    jumpBottom: byId('jumpBottom'),
    composer: byId('composer'),
    prompt: byId('prompt'),
    sendButton: byId('sendButton'),
    sendGlyph: byId('sendGlyph'),
    turnStatus: byId('turnStatus'),
    connectionState: byId('connectionState'),
    connectionLabel: byId('connectionLabel'),
    modelSelect: byId('modelSelect'),
    customModel: byId('customModel'),
    permissionSelect: byId('permissionSelect'),
    permissionSegments: byId('permissionSegments'),
    searchToggle: byId('searchToggle'),
    searchEnabled: byId('searchEnabled'),
    searchProvider: byId('searchProvider'),
    searchMax: byId('searchMax'),
    events: byId('events'),
    activityEmpty: byId('activityEmpty'),
    runtime: byId('runtime'),
    cache: byId('cache'),
    cacheSummary: byId('cacheSummary'),
    runtimeUpdated: byId('runtimeUpdated'),
    toasts: byId('toasts'),
  };

  const state = {
    ready: false,
    busy: false,
    submitting: false,
    stopping: false,
    activeTurnId: null,
    streaming: null,
    streamingTurnId: null,
    streamText: '',
    pendingDelta: '',
    pendingThinking: '',
    animationFrame: 0,
    stickToBottom: true,
    eventSource: null,
    status: null,
    activityRows: 0,
    currentThinkingRow: null,
    toolRows: new Map(),
    statusRefresh: null,
  };

  const mobileSidebarQuery = window.matchMedia('(max-width: 780px)');
  let sidebarReturnFocus = null;
  let inspectorReturnFocus = null;

  const tokenFromHash = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  if (location.hash) {
    history.replaceState(null, document.title, location.pathname + location.search);
  }

  function setConnection(kind, label) {
    elements.connectionState.classList.toggle('is-connected', kind === 'connected');
    elements.connectionState.classList.toggle('is-disconnected', kind === 'disconnected');
    elements.connectionLabel.textContent = label;
  }

  function showToast(message, kind) {
    const toast = document.createElement('div');
    toast.className = 'toast' + (kind ? ' is-' + kind : '');
    const body = document.createElement('div');
    body.textContent = String(message || '');
    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.addEventListener('click', () => toast.remove());
    toast.append(document.createElement('span'), body, close);
    elements.toasts.append(toast);
    window.setTimeout(() => toast.remove(), kind === 'error' ? 8000 : 3600);
  }

  async function bootstrapSession() {
    if (!tokenFromHash) return;
    const response = await fetch('/api/bootstrap', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Authorization: 'Bearer ' + tokenFromHash },
    });
    if (!response.ok) throw new Error(copy.accessExpired);
  }

  async function api(url, options) {
    const request = options || {};
    const response = await fetch(url, {
      ...request,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(request.headers || {}),
      },
    });
    let data = {};
    const type = response.headers.get('content-type') || '';
    if (type.includes('application/json')) {
      data = await response.json();
    }
    if (!response.ok || data.ok === false) {
      const error = new Error(data.message || data.error || response.statusText || 'Request failed');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function applyTheme(theme) {
    if (theme === 'dark' || theme === 'light') {
      document.documentElement.dataset.theme = theme;
    } else {
      delete document.documentElement.dataset.theme;
      theme = 'system';
    }
    localStorage.setItem('orbit.webui.theme', theme);
    document.querySelectorAll('[data-theme-value]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.themeValue === theme);
    });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#151514' : '#f7f6f2';
  }

  function autoSizePrompt() {
    elements.prompt.style.height = 'auto';
    elements.prompt.style.height = Math.min(elements.prompt.scrollHeight, 210) + 'px';
  }

  function syncSidebarInteractivity() {
    const hidden = mobileSidebarQuery.matches && !elements.appShell.classList.contains('sidebar-open');
    elements.sidebar.inert = hidden;
    if (hidden) elements.sidebar.setAttribute('aria-hidden', 'true');
    else elements.sidebar.removeAttribute('aria-hidden');
  }

  function closeSidebar() {
    const wasOpen = elements.appShell.classList.contains('sidebar-open');
    elements.appShell.classList.remove('sidebar-open');
    elements.menuButton.setAttribute('aria-expanded', 'false');
    syncSidebarInteractivity();
    if (wasOpen && sidebarReturnFocus && sidebarReturnFocus.isConnected) {
      sidebarReturnFocus.focus();
    }
    sidebarReturnFocus = null;
  }

  function openSidebar() {
    if (!elements.appShell.classList.contains('sidebar-open')) {
      sidebarReturnFocus = document.activeElement;
    }
    elements.appShell.classList.add('sidebar-open');
    elements.menuButton.setAttribute('aria-expanded', 'true');
    syncSidebarInteractivity();
    const firstControl = elements.sidebar.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (firstControl) firstControl.focus();
  }

  function setInspector(open, tab) {
    const wasOpen = elements.inspector.classList.contains('is-open');
    if (open && !wasOpen) inspectorReturnFocus = document.activeElement;
    elements.inspector.classList.toggle('is-open', open);
    elements.inspector.setAttribute('aria-hidden', open ? 'false' : 'true');
    elements.inspector.inert = !open;
    elements.inspectorButton.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open && tab) selectInspectorTab(tab);
    if (open && !wasOpen) {
      elements.inspectorClose.focus();
    } else if (!open && wasOpen) {
      const returnTarget = inspectorReturnFocus && inspectorReturnFocus.isConnected
        ? inspectorReturnFocus
        : elements.inspectorButton;
      inspectorReturnFocus = null;
      returnTarget.focus();
    }
  }

  function selectInspectorTab(tab) {
    const settings = tab === 'settings';
    elements.activityTab.classList.toggle('is-active', !settings);
    elements.activityTab.setAttribute('aria-selected', settings ? 'false' : 'true');
    elements.settingsTab.classList.toggle('is-active', settings);
    elements.settingsTab.setAttribute('aria-selected', settings ? 'true' : 'false');
    elements.activityPanel.hidden = settings;
    elements.settingsPanel.hidden = !settings;
  }

  function nearBottom() {
    const distance = elements.messageScroll.scrollHeight - elements.messageScroll.scrollTop - elements.messageScroll.clientHeight;
    return distance < 110;
  }

  function scrollToBottom(force) {
    if (!force && !state.stickToBottom) return;
    elements.messageScroll.scrollTop = elements.messageScroll.scrollHeight;
    elements.jumpBottom.classList.remove('is-visible');
  }

  function setBusy(busy, label) {
    state.busy = busy;
    if (!busy) state.stopping = false;
    elements.sendButton.classList.toggle('is-stop', busy);
    elements.sendGlyph.textContent = busy ? '■' : '↑';
    elements.sendButton.setAttribute('aria-label', busy ? copy.stopAction : copy.sendAction);
    document.querySelectorAll(
      '#modelSelect, #permissionSelect, #searchToggle, #settingsPanel input, #settingsPanel select, #settingsPanel button:not([data-theme-value])',
    ).forEach((control) => { control.disabled = busy; });
    elements.turnStatus.classList.toggle('is-working', busy);
    elements.turnStatus.textContent = label || (busy ? copy.thinking : '');
  }

  function setEmptyState() {
    const hasMessages = elements.messages.childElementCount > 0;
    elements.emptyState.hidden = hasMessages;
  }

  function formatTime(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

`;
