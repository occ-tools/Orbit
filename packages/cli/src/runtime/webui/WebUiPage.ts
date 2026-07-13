import { readCliVersion } from "../CliVersion.js";

export type WebUiLanguage = "en" | "zh";

interface WebUiCopy {
  documentTitle: string;
  newTask: string;
  currentTask: string;
  diagnostics: string;
  addContext: string;
  commands: string;
  workspace: string;
  localOnly: string;
  openNavigation: string;
  connected: string;
  details: string;
  emptyEyebrow: string;
  emptyTitle: string;
  emptyBody: string;
  suggestionReview: string;
  suggestionReviewBody: string;
  suggestionFix: string;
  suggestionFixBody: string;
  suggestionExplain: string;
  suggestionExplainBody: string;
  suggestionImprove: string;
  suggestionImproveBody: string;
  inputLabel: string;
  inputPlaceholder: string;
  context: string;
  webSearch: string;
  sendHint: string;
  inspectorTitle: string;
  close: string;
  activity: string;
  settings: string;
  runtime: string;
  noActivity: string;
  promptCache: string;
  model: string;
  customModel: string;
  apply: string;
  permission: string;
  searchProvider: string;
  searchResults: string;
  theme: string;
  system: string;
  light: string;
  dark: string;
}

const COPY: Record<WebUiLanguage, WebUiCopy> = {
  en: {
    documentTitle: "Orbit · AI coding workspace",
    newTask: "New task",
    currentTask: "Current task",
    diagnostics: "Diagnostics",
    addContext: "Add context",
    commands: "Commands",
    workspace: "Workspace",
    localOnly: "Local session",
    openNavigation: "Open navigation",
    connected: "Connecting",
    details: "Details",
    emptyEyebrow: "ORBIT WORKSPACE",
    emptyTitle: "What are we building?",
    emptyBody:
      "Ask Orbit to inspect, explain, change, or verify anything in this workspace.",
    suggestionReview: "Review this project",
    suggestionReviewBody: "Find the highest-impact issues and fix them.",
    suggestionFix: "Fix a problem",
    suggestionFixBody: "Diagnose a failing build or unexpected behavior.",
    suggestionExplain: "Explain the code",
    suggestionExplainBody: "Map an unfamiliar flow in plain language.",
    suggestionImprove: "Improve quality",
    suggestionImproveBody: "Optimize performance, safety, and maintainability.",
    inputLabel: "Message Orbit",
    inputPlaceholder: "Ask Orbit to work on this codebase…",
    context: "Context",
    webSearch: "Web",
    sendHint: "Enter to send · Shift+Enter for a new line",
    inspectorTitle: "Task details",
    close: "Close",
    activity: "Activity",
    settings: "Settings",
    runtime: "Runtime",
    noActivity: "Activity will appear here while Orbit works.",
    promptCache: "Prompt cache",
    model: "Model",
    customModel: "Custom model ID",
    apply: "Apply",
    permission: "Permission mode",
    searchProvider: "Search provider",
    searchResults: "Maximum results",
    theme: "Appearance",
    system: "System",
    light: "Light",
    dark: "Dark",
  },
  zh: {
    documentTitle: "Orbit · AI 编程工作区",
    newTask: "新建任务",
    currentTask: "当前任务",
    diagnostics: "运行诊断",
    addContext: "添加上下文",
    commands: "命令帮助",
    workspace: "工作区",
    localOnly: "本地会话",
    openNavigation: "打开导航",
    connected: "正在连接",
    details: "任务详情",
    emptyEyebrow: "ORBIT 工作区",
    emptyTitle: "今天想完成什么？",
    emptyBody: "让 Orbit 检查、解释、修改或验证当前工作区中的任何内容。",
    suggestionReview: "全面审查项目",
    suggestionReviewBody: "找出影响最大的问题并直接修复。",
    suggestionFix: "修复一个问题",
    suggestionFixBody: "诊断构建失败或异常行为。",
    suggestionExplain: "解释代码逻辑",
    suggestionExplainBody: "用清晰语言梳理陌生的代码流程。",
    suggestionImprove: "提升工程质量",
    suggestionImproveBody: "优化性能、安全性与可维护性。",
    inputLabel: "给 Orbit 发送消息",
    inputPlaceholder: "让 Orbit 在这个代码库中完成任务…",
    context: "上下文",
    webSearch: "联网",
    sendHint: "Enter 发送 · Shift+Enter 换行",
    inspectorTitle: "任务详情",
    close: "关闭",
    activity: "活动",
    settings: "设置",
    runtime: "运行状态",
    noActivity: "Orbit 工作时，步骤和工具状态会显示在这里。",
    promptCache: "提示词缓存",
    model: "模型",
    customModel: "自定义模型 ID",
    apply: "应用",
    permission: "权限模式",
    searchProvider: "搜索服务",
    searchResults: "最大结果数",
    theme: "外观",
    system: "跟随系统",
    light: "浅色",
    dark: "深色",
  },
};

/** Renders the self-contained Orbit application shell. */
export function renderWebUiPage(language: WebUiLanguage): string {
  const copy = COPY[language];
  const version = readCliVersion();
  const suggestions = [
    [copy.suggestionReview, copy.suggestionReviewBody],
    [copy.suggestionFix, copy.suggestionFixBody],
    [copy.suggestionExplain, copy.suggestionExplainBody],
    [copy.suggestionImprove, copy.suggestionImproveBody],
  ];

  return `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#f7f6f2" />
  <title>${copy.documentTitle}</title>
  <link rel="stylesheet" href="/assets/orbit.css" />
  <script src="/assets/orbit.js" defer></script>
</head>
<body>
  <div class="app-shell" id="appShell">
    <button class="sidebar-backdrop" id="sidebarBackdrop" type="button" aria-label="${copy.close}" tabindex="-1"></button>
    <aside class="sidebar" id="sidebar" aria-label="Orbit">
      <div class="brand-row">
        <div class="brand-mark" aria-hidden="true"><span></span></div>
        <span class="brand-name">Orbit</span>
        <span class="brand-version">${version}</span>
      </div>

      <button class="new-task-button" type="button" data-command="/chat new">
        <span class="new-task-icon" aria-hidden="true">＋</span>
        <span>${copy.newTask}</span>
        <kbd>Ctrl N</kbd>
      </button>

      <nav class="primary-nav" aria-label="Orbit navigation">
        <button class="nav-button is-active" type="button" data-close-sidebar>
          <span class="nav-glyph" aria-hidden="true">◉</span>
          <span>${copy.currentTask}</span>
        </button>
        <button class="nav-button" type="button" data-command="/doctor">
          <span class="nav-glyph" aria-hidden="true">⌁</span>
          <span>${copy.diagnostics}</span>
        </button>
        <button class="nav-button" type="button" data-fill="/add ">
          <span class="nav-glyph" aria-hidden="true">＋</span>
          <span>${copy.addContext}</span>
        </button>
        <button class="nav-button" type="button" data-command="/help">
          <span class="nav-glyph" aria-hidden="true">?</span>
          <span>${copy.commands}</span>
        </button>
      </nav>

      <div class="sidebar-spacer"></div>
      <div class="workspace-card">
        <div class="workspace-icon" aria-hidden="true">⌘</div>
        <div class="workspace-copy">
          <span class="workspace-label">${copy.workspace}</span>
          <strong id="sidebarWorkspace">—</strong>
          <span id="sidebarSession">${copy.localOnly}</span>
        </div>
      </div>
    </aside>

    <section class="workspace-view">
      <header class="topbar">
        <div class="topbar-start">
          <button class="icon-button mobile-menu" id="menuButton" type="button" aria-label="${copy.openNavigation}" aria-controls="sidebar" aria-expanded="false">☰</button>
          <div class="workspace-heading">
            <strong id="workspaceName">Orbit</strong>
            <span id="workspacePath">${copy.localOnly}</span>
          </div>
        </div>
        <div class="topbar-actions">
          <label class="model-control" title="${copy.model}">
            <span class="sr-only">${copy.model}</span>
            <select id="modelSelect" aria-label="${copy.model}"></select>
          </label>
          <div class="connection-state" id="connectionState" role="status" aria-live="polite">
            <span class="connection-dot"></span>
            <span id="connectionLabel">${copy.connected}</span>
          </div>
          <button class="details-button" id="inspectorButton" type="button" aria-label="${copy.details}" aria-controls="inspector" aria-expanded="false">
            <span aria-hidden="true">◫</span>
            <span>${copy.details}</span>
          </button>
        </div>
      </header>

      <main class="conversation" id="conversation">
        <div class="message-scroll" id="messageScroll">
          <div class="message-column" id="messages" aria-live="polite"></div>
          <section class="empty-state" id="emptyState">
            <div class="empty-orbit" aria-hidden="true"><span></span></div>
            <p class="eyebrow">${copy.emptyEyebrow}</p>
            <h1>${copy.emptyTitle}</h1>
            <p class="empty-description">${copy.emptyBody}</p>
            <div class="suggestion-grid">
              ${suggestions
                .map(
                  (
                    [title, body],
                    index,
                  ) => `<button class="suggestion-card" type="button" data-suggestion="${index}">
                    <span class="suggestion-index">0${index + 1}</span>
                    <strong>${title}</strong>
                    <span>${body}</span>
                  </button>`,
                )
                .join("")}
            </div>
          </section>
        </div>

        <button class="jump-bottom" id="jumpBottom" type="button" aria-label="Scroll to latest message">↓</button>

        <div class="composer-dock">
          <div class="turn-status" id="turnStatus" role="status" aria-live="polite"></div>
          <form class="composer" id="composer">
            <label class="sr-only" for="prompt">${copy.inputLabel}</label>
            <textarea id="prompt" rows="1" maxlength="100000" autocomplete="off" placeholder="${copy.inputPlaceholder}"></textarea>
            <div class="composer-toolbar">
              <div class="composer-tools">
                <button class="composer-chip" type="button" data-fill="/add "><span aria-hidden="true">＋</span>${copy.context}</button>
                <button class="composer-chip" id="searchToggle" type="button" aria-pressed="false"><span aria-hidden="true">◎</span>${copy.webSearch}</button>
                <select class="composer-select" id="permissionSelect" aria-label="${copy.permission}">
                  <option value="strict">Strict</option>
                  <option value="normal">Normal</option>
                  <option value="auto">Auto</option>
                  <option value="plan">Plan</option>
                </select>
              </div>
              <button class="send-button" id="sendButton" type="submit" aria-label="${copy.inputLabel}"><span id="sendGlyph" aria-hidden="true">↑</span></button>
            </div>
          </form>
          <p class="composer-hint">${copy.sendHint}</p>
        </div>
      </main>
    </section>

    <aside class="inspector" id="inspector" aria-label="${copy.inspectorTitle}" aria-hidden="true" inert>
      <div class="inspector-header">
        <div>
          <span class="inspector-kicker">ORBIT</span>
          <h2>${copy.inspectorTitle}</h2>
        </div>
        <button class="icon-button" id="inspectorClose" type="button" aria-label="${copy.close}">×</button>
      </div>
      <div class="inspector-tabs" role="tablist">
        <button class="inspector-tab is-active" id="activityTab" type="button" role="tab" aria-selected="true" aria-controls="activityPanel">${copy.activity}</button>
        <button class="inspector-tab" id="settingsTab" type="button" role="tab" aria-selected="false" aria-controls="settingsPanel">${copy.settings}</button>
      </div>

      <div class="inspector-content">
        <section class="tab-panel" id="activityPanel" role="tabpanel" aria-labelledby="activityTab">
          <section class="detail-section">
            <div class="section-heading"><h3>${copy.runtime}</h3><span id="runtimeUpdated">—</span></div>
            <dl class="runtime-grid" id="runtime"></dl>
          </section>
          <section class="detail-section activity-section">
            <div class="section-heading"><h3>${copy.activity}</h3><button class="text-button" id="clearActivity" type="button">Clear</button></div>
            <div class="activity-list" id="events">
              <p class="activity-empty" id="activityEmpty">${copy.noActivity}</p>
            </div>
          </section>
          <details class="detail-section cache-section">
            <summary>${copy.promptCache}<span id="cacheSummary">—</span></summary>
            <pre id="cache">—</pre>
          </details>
        </section>

        <section class="tab-panel" id="settingsPanel" role="tabpanel" aria-labelledby="settingsTab" hidden>
          <section class="settings-group">
            <h3>${copy.model}</h3>
            <label class="field-label" for="customModel">${copy.customModel}</label>
            <div class="inline-field">
              <input id="customModel" type="text" maxlength="200" placeholder="deepseek-v4-pro" />
              <button class="secondary-button" id="applyModel" type="button">${copy.apply}</button>
            </div>
          </section>
          <section class="settings-group">
            <h3>${copy.permission}</h3>
            <div class="segmented" id="permissionSegments">
              <button type="button" data-mode="strict">Strict</button>
              <button type="button" data-mode="normal">Normal</button>
              <button type="button" data-mode="auto">Auto</button>
              <button type="button" data-mode="plan">Plan</button>
            </div>
          </section>
          <section class="settings-group">
            <div class="setting-row">
              <div><h3>${copy.webSearch}</h3><p>Use configured search tools when needed.</p></div>
              <label class="switch"><input id="searchEnabled" type="checkbox" /><span></span></label>
            </div>
            <label class="field-label" for="searchProvider">${copy.searchProvider}</label>
            <select class="field-control" id="searchProvider">
              <option value="auto">Auto</option>
              <option value="searxng">SearXNG</option>
              <option value="tavily">Tavily</option>
              <option value="bing">Bing</option>
              <option value="duckduckgo">DuckDuckGo</option>
            </select>
            <label class="field-label" for="searchMax">${copy.searchResults}</label>
            <input class="field-control" id="searchMax" type="number" min="1" max="20" />
          </section>
          <section class="settings-group">
            <h3>${copy.theme}</h3>
            <div class="theme-options" id="themeOptions">
              <button type="button" data-theme-value="system">${copy.system}</button>
              <button type="button" data-theme-value="light">${copy.light}</button>
              <button type="button" data-theme-value="dark">${copy.dark}</button>
            </div>
          </section>
        </section>
      </div>
    </aside>

    <div class="toast-region" id="toasts" aria-live="assertive" aria-atomic="true"></div>
  </div>
</body>
</html>`;
}
