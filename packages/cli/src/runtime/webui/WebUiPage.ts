import { readCliVersion } from "../CliVersion.js";
import { renderOrbitMark } from "./WebUiBrand.js";

export type WebUiLanguage = "en" | "zh";

interface WebUiCopy {
  documentTitle: string;
  newTask: string;
  currentTask: string;
  diagnostics: string;
  addContext: string;
  commands: string;
  commandSearch: string;
  commandHint: string;
  noCommands: string;
  navigation: string;
  recentTasks: string;
  untitledTask: string;
  localAgent: string;
  privateSession: string;
  workspace: string;
  localOnly: string;
  openNavigation: string;
  collapseNavigation: string;
  connected: string;
  connectionTitle: string;
  connectionBody: string;
  retry: string;
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
  contextPickerTitle: string;
  contextPickerSearch: string;
  contextPickerEmpty: string;
  contextPickerHint: string;
  activeContext: string;
  clearContext: string;
  webSearch: string;
  sendHint: string;
  inspectorTitle: string;
  close: string;
  activity: string;
  settings: string;
  runtime: string;
  noActivity: string;
  clearActivity: string;
  promptCache: string;
  model: string;
  customModel: string;
  apply: string;
  permission: string;
  modeStrict: string;
  modeNormal: string;
  modeAuto: string;
  modePlan: string;
  searchProvider: string;
  searchResults: string;
  webSearchDescription: string;
  theme: string;
  system: string;
  light: string;
  dark: string;
  scrollLatest: string;
  approvalEyebrow: string;
  approvalDeny: string;
  approvalApprove: string;
}

const COPY: Record<WebUiLanguage, WebUiCopy> = {
  en: {
    documentTitle: "Orbit · AI coding workspace",
    newTask: "New task",
    currentTask: "Current task",
    diagnostics: "Diagnostics",
    addContext: "Add context",
    commands: "Commands",
    commandSearch: "Search actions…",
    commandHint: "Navigate with ↑↓ · Enter to run · Esc to close",
    noCommands: "No matching actions",
    navigation: "Workspace",
    recentTasks: "Recent tasks",
    untitledTask: "Untitled task",
    localAgent: "Local agent",
    privateSession: "Private on this device",
    workspace: "Workspace",
    localOnly: "Local session",
    openNavigation: "Open navigation",
    collapseNavigation: "Collapse navigation",
    connected: "Connecting",
    connectionTitle: "Orbit is reconnecting",
    connectionBody:
      "Keep the Orbit terminal open. Reconnection is automatic and your draft stays on this device.",
    retry: "Retry now",
    details: "Details",
    emptyEyebrow: "ORBIT · LOCAL SESSION",
    emptyTitle: "What should we work on?",
    emptyBody: "Ask, plan, build, or verify anything in this workspace.",
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
    contextPickerTitle: "Add file context",
    contextPickerSearch: "Search workspace files…",
    contextPickerEmpty: "No matching workspace files",
    contextPickerHint: "Enter to add · ↑↓ to navigate · Esc to close",
    activeContext: "Active context",
    clearContext: "Clear all",
    webSearch: "Web",
    sendHint: "Enter to send · Shift+Enter for a new line",
    inspectorTitle: "Task details",
    close: "Close",
    activity: "Activity",
    settings: "Settings",
    runtime: "Runtime",
    noActivity: "Activity will appear here while Orbit works.",
    clearActivity: "Clear",
    promptCache: "Prompt cache",
    model: "Model",
    customModel: "Custom model ID",
    apply: "Apply",
    permission: "Permission mode",
    modeStrict: "Strict",
    modeNormal: "Normal",
    modeAuto: "Auto",
    modePlan: "Plan",
    searchProvider: "Search provider",
    searchResults: "Maximum results",
    webSearchDescription: "Use configured search tools when needed.",
    theme: "Appearance",
    system: "System",
    light: "Light",
    dark: "Dark",
    scrollLatest: "Scroll to latest message",
    approvalEyebrow: "PERMISSION REQUIRED",
    approvalDeny: "Deny",
    approvalApprove: "Approve",
  },
  zh: {
    documentTitle: "Orbit · AI 编程工作区",
    newTask: "新建任务",
    currentTask: "当前任务",
    diagnostics: "运行诊断",
    addContext: "添加上下文",
    commands: "命令帮助",
    commandSearch: "搜索操作…",
    commandHint: "↑↓ 选择 · Enter 执行 · Esc 关闭",
    noCommands: "没有匹配的操作",
    navigation: "工作区",
    recentTasks: "最近任务",
    untitledTask: "未命名任务",
    localAgent: "本地智能体",
    privateSession: "仅在本机运行",
    workspace: "工作区",
    localOnly: "本地会话",
    openNavigation: "打开导航",
    collapseNavigation: "收起导航",
    connected: "正在连接",
    connectionTitle: "正在重新连接 Orbit",
    connectionBody:
      "请保持 Orbit 终端运行；页面会自动重连，草稿会继续保存在本机。",
    retry: "立即重试",
    details: "任务详情",
    emptyEyebrow: "ORBIT · 本地会话",
    emptyTitle: "接下来想做什么？",
    emptyBody: "让 Orbit 在当前工作区中分析、规划、实现或验证任务。",
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
    contextPickerTitle: "添加文件上下文",
    contextPickerSearch: "搜索工作区文件…",
    contextPickerEmpty: "没有匹配的工作区文件",
    contextPickerHint: "Enter 添加 · ↑↓ 选择 · Esc 关闭",
    activeContext: "活动上下文",
    clearContext: "全部清空",
    webSearch: "联网",
    sendHint: "Enter 发送 · Shift+Enter 换行",
    inspectorTitle: "任务详情",
    close: "关闭",
    activity: "活动",
    settings: "设置",
    runtime: "运行状态",
    noActivity: "Orbit 工作时，步骤和工具状态会显示在这里。",
    clearActivity: "清空",
    promptCache: "提示词缓存",
    model: "模型",
    customModel: "自定义模型 ID",
    apply: "应用",
    permission: "权限模式",
    modeStrict: "严格",
    modeNormal: "标准",
    modeAuto: "自动",
    modePlan: "规划",
    searchProvider: "搜索服务",
    searchResults: "最大结果数",
    webSearchDescription: "需要时使用已配置的搜索工具。",
    theme: "外观",
    system: "跟随系统",
    light: "浅色",
    dark: "深色",
    scrollLatest: "滚动到最新消息",
    approvalEyebrow: "需要你的确认",
    approvalDeny: "拒绝",
    approvalApprove: "允许",
  },
};

type UiIcon =
  | "add"
  | "chat"
  | "diagnostics"
  | "context"
  | "commands"
  | "menu"
  | "panel"
  | "close"
  | "down"
  | "review"
  | "fix"
  | "explain"
  | "improve";

function renderUiIcon(name: UiIcon): string {
  const paths: Record<UiIcon, string> = {
    add: '<path d="M12 5v14M5 12h14" />',
    chat: '<path d="M6.5 6.5h11v8h-6L8 17.5v-3H6.5z" /><circle cx="9" cy="10.5" r=".7" /><circle cx="12" cy="10.5" r=".7" /><circle cx="15" cy="10.5" r=".7" />',
    diagnostics:
      '<path d="M4.5 12h3l1.7-4 3.1 8 1.7-4h5.5" /><path d="M6 5.5h12v13H6z" />',
    context:
      '<path d="M7 4.5h7l3 3v12H7z" /><path d="M14 4.5v3h3M9.5 12h5M12 9.5v5" />',
    commands:
      '<rect x="4.5" y="5.5" width="15" height="13" rx="2" /><path d="m8 10 2 2-2 2M12.5 14h3.5" />',
    menu: '<path d="M5 7h14M5 12h14M5 17h14" />',
    panel:
      '<rect x="4.5" y="5" width="15" height="14" rx="2" /><path d="M14 5v14" />',
    close: '<path d="m7 7 10 10M17 7 7 17" />',
    down: '<path d="m7 10 5 5 5-5" />',
    review:
      '<circle cx="10.5" cy="10.5" r="5.5" /><path d="m14.7 14.7 4.3 4.3M10.5 8v5M8 10.5h5" />',
    fix: '<path d="M14.5 5.5a4 4 0 0 0-4.8 5.2L5 15.4 8.6 19l4.7-4.7a4 4 0 0 0 5.2-4.8l-2.7 2.7-3-3z" />',
    explain: '<path d="m9 7-5 5 5 5M15 7l5 5-5 5M13 5l-2 14" />',
    improve:
      '<path d="M12 4l1.2 4.1L17 10l-3.8 1.9L12 16l-1.2-4.1L7 10l3.8-1.9zM18 16v4M16 18h4M5 4v3M3.5 5.5h3" />',
  };
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}

function renderComposer(copy: WebUiCopy): string {
  return `<div class="composer-dock" id="composerDock">
    <div class="turn-status" id="turnStatus" role="status" aria-live="polite"></div>
    <section class="approval-panel" id="approvalPanel" aria-live="assertive" aria-labelledby="approvalTitle" hidden>
      <div class="approval-panel-head">
        <span class="approval-mark" aria-hidden="true">!</span>
        <div>
          <span class="approval-eyebrow">${copy.approvalEyebrow}</span>
          <strong id="approvalTitle"></strong>
        </div>
      </div>
      <p class="approval-reason" id="approvalReason"></p>
      <pre class="approval-preview" id="approvalPreview" tabindex="0" hidden></pre>
      <div class="approval-actions">
        <button class="approval-button is-deny" id="denyApprovalButton" type="button">${copy.approvalDeny}</button>
        <button class="approval-button is-approve" id="approveApprovalButton" type="button">${copy.approvalApprove}</button>
      </div>
    </section>
    <form class="composer" id="composer">
      <label class="sr-only" for="prompt">${copy.inputLabel}</label>
      <textarea id="prompt" rows="1" maxlength="100000" autocomplete="off" autofocus placeholder="${copy.inputPlaceholder}"></textarea>
      <section class="context-shelf" id="contextShelf" aria-label="${copy.activeContext}" hidden>
        <div class="context-shelf-header">
          <span>${renderUiIcon("context")}<strong>${copy.activeContext}</strong></span>
          <button id="clearContextButton" type="button">${copy.clearContext}</button>
        </div>
        <div class="context-file-list" id="contextFileList"></div>
      </section>
      <div class="composer-toolbar">
        <div class="composer-tools">
          <button class="composer-chip" id="contextPickerButton" type="button" data-open-context aria-haspopup="dialog" aria-controls="contextPicker" aria-expanded="false">${renderUiIcon("context")}<span>${copy.context}</span><span class="context-chip-count" id="contextChipCount" aria-label="0" hidden>0</span></button>
          <button class="composer-chip" id="searchToggle" type="button" aria-pressed="false"><span class="web-status-dot" aria-hidden="true"></span><span>${copy.webSearch}</span></button>
          <select class="composer-select" id="permissionSelect" aria-label="${copy.permission}">
            <option value="strict">${copy.modeStrict}</option>
            <option value="normal">${copy.modeNormal}</option>
            <option value="auto">${copy.modeAuto}</option>
            <option value="plan">${copy.modePlan}</option>
          </select>
        </div>
        <button class="send-button" id="sendButton" type="submit" aria-label="${copy.inputLabel}"><span id="sendGlyph" aria-hidden="true">↑</span></button>
      </div>
      <section class="context-picker" id="contextPicker" role="dialog" aria-label="${copy.contextPickerTitle}" aria-hidden="true" hidden>
        <div class="context-picker-header">
          <span class="context-picker-icon" aria-hidden="true">${renderUiIcon("context")}</span>
          <strong>${copy.contextPickerTitle}</strong>
          <button class="context-picker-close" id="contextPickerClose" type="button" aria-label="${copy.close}">${renderUiIcon("close")}</button>
        </div>
        <label class="sr-only" for="contextSearch">${copy.contextPickerSearch}</label>
        <div class="context-picker-search">
          <span aria-hidden="true">⌕</span>
          <input id="contextSearch" type="search" maxlength="200" autocomplete="off" placeholder="${copy.contextPickerSearch}" aria-controls="contextResults" aria-autocomplete="list" />
          <kbd>Esc</kbd>
        </div>
        <div class="context-results" id="contextResults" role="listbox"></div>
        <p class="context-empty" id="contextEmpty" role="status">${copy.contextPickerEmpty}</p>
        <p class="context-picker-hint">${copy.contextPickerHint}</p>
      </section>
    </form>
    <p class="composer-hint">${copy.sendHint}</p>
  </div>`;
}

/** Renders the self-contained Orbit application shell. */
export function renderWebUiPage(language: WebUiLanguage): string {
  const copy = COPY[language];
  const version = readCliVersion();
  const suggestions: Array<[UiIcon, string, string]> = [
    ["review", copy.suggestionReview, copy.suggestionReviewBody],
    ["fix", copy.suggestionFix, copy.suggestionFixBody],
    ["explain", copy.suggestionExplain, copy.suggestionExplainBody],
    ["improve", copy.suggestionImprove, copy.suggestionImproveBody],
  ];

  return `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#edf1f0" />
  <title>${copy.documentTitle}</title>
  <link rel="icon" type="image/svg+xml" href="/assets/orbit-mark.svg" />
  <link rel="stylesheet" href="/assets/orbit.css" />
  <script src="/assets/orbit.js" defer></script>
</head>
<body>
  <div class="app-shell" id="appShell">
    <button class="sidebar-backdrop" id="sidebarBackdrop" type="button" aria-label="${copy.close}" tabindex="-1"></button>
    <aside class="sidebar" id="sidebar" aria-label="Orbit">
      <div class="brand-row">
        ${renderOrbitMark("brand-mark")}
        <span class="brand-name">Orbit</span>
        <span class="brand-version">${version}</span>
        <button class="sidebar-collapse-button" id="sidebarCollapseButton" type="button" aria-label="${copy.collapseNavigation}" aria-controls="sidebar" aria-expanded="true">${renderUiIcon("panel")}</button>
      </div>

      <button class="new-task-button" id="newTaskButton" type="button">
        <span class="new-task-icon">${renderUiIcon("add")}</span>
        <span>${copy.newTask}</span>
        <kbd>Ctrl N</kbd>
      </button>

      <div class="nav-section-heading"><span>${copy.navigation}</span><i></i></div>
      <nav class="primary-nav" aria-label="${copy.navigation}">
        <button class="nav-button is-active" id="activeTaskButton" type="button" data-close-sidebar>
          ${renderUiIcon("chat")}
          <span id="activeTaskTitle">${copy.currentTask}</span>
        </button>
        <button class="nav-button" type="button" data-command="/doctor">
          ${renderUiIcon("diagnostics")}
          <span>${copy.diagnostics}</span>
        </button>
        <button class="nav-button" type="button" data-open-context>
          ${renderUiIcon("context")}
          <span>${copy.addContext}</span>
        </button>
        <button class="nav-button" id="commandsButton" type="button">
          ${renderUiIcon("commands")}
          <span>${copy.commands}</span>
        </button>
      </nav>

      <section class="recent-section" id="recentSection" aria-labelledby="recentHeading" hidden>
        <div class="nav-section-heading" id="recentHeading"><span>${copy.recentTasks}</span><i></i></div>
        <div class="recent-sessions" id="recentSessions" aria-label="${copy.recentTasks}"></div>
      </section>

      <div class="sidebar-spacer"></div>
      <div class="agent-card">
        <span class="agent-state"><i></i></span>
        <span><strong>${copy.localAgent}</strong><small>${copy.privateSession}</small></span>
      </div>
      <div class="workspace-card">
        <div class="workspace-icon" aria-hidden="true"><span></span></div>
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
          <button class="icon-button mobile-menu" id="menuButton" type="button" aria-label="${copy.openNavigation}" aria-controls="sidebar" aria-expanded="false">${renderUiIcon("menu")}</button>
          <div class="workspace-heading">
            <strong id="workspaceName">Orbit</strong>
            <span id="workspacePath">${copy.localOnly}</span>
          </div>
        </div>
        <div class="topbar-actions">
          <button class="context-meter" id="contextMeter" type="button" aria-label="${copy.context}" aria-controls="inspector">
            <span class="context-ring" aria-hidden="true"><i></i></span>
            <span class="context-meter-copy"><small>${copy.context}</small><strong id="contextPercent">0%</strong></span>
          </button>
          <button class="command-trigger" id="commandTrigger" type="button" aria-label="${copy.commands}" aria-haspopup="dialog" aria-controls="commandPalette">
            ${renderUiIcon("commands")}
            <span>${copy.commands}</span>
            <kbd>Ctrl K</kbd>
          </button>
          <label class="model-control" title="${copy.model}">
            <span class="sr-only">${copy.model}</span>
            <select id="modelSelect" aria-label="${copy.model}"></select>
          </label>
          <button class="connection-state" id="connectionState" type="button" aria-label="${copy.connected}. ${copy.retry}" title="${copy.retry}">
            <span class="connection-dot"></span>
            <span id="connectionLabel" role="status" aria-live="polite">${copy.connected}</span>
          </button>
          <button class="details-button" id="inspectorButton" type="button" aria-label="${copy.details}" aria-controls="inspector" aria-expanded="false">
            ${renderUiIcon("panel")}
            <span>${copy.details}</span>
          </button>
        </div>
      </header>

      <div class="connection-help" id="connectionHelp" role="alert">
        <span class="connection-help-icon">!</span>
        <span><strong>${copy.connectionTitle}</strong><small>${copy.connectionBody}</small></span>
        <button type="button" id="retryConnection">${copy.retry}</button>
      </div>

      <main class="conversation" id="conversation">
        <div class="message-scroll" id="messageScroll">
          <div class="message-column" id="messages" aria-live="polite"></div>
          <section class="empty-state" id="emptyState">
            <p class="eyebrow">${renderOrbitMark("eyebrow-mark")}<span>${copy.emptyEyebrow}</span></p>
            <h1>${copy.emptyTitle}</h1>
            <p class="empty-description">${copy.emptyBody}</p>
            <div class="empty-composer-slot" id="emptyComposerSlot">
              ${renderComposer(copy)}
            </div>
            <div class="suggestion-grid">
              ${suggestions
                .map(
                  (
                    [icon, title, body],
                    index,
                  ) => `<button class="suggestion-card" type="button" data-suggestion="${index}" title="${body}">
                    <span class="suggestion-icon" aria-hidden="true">${renderUiIcon(icon)}</span>
                    <span class="suggestion-copy"><strong>${title}</strong><small>${body}</small></span>
                  </button>`,
                )
                .join("")}
            </div>
          </section>
        </div>

        <button class="jump-bottom" id="jumpBottom" type="button" aria-label="${copy.scrollLatest}">${renderUiIcon("down")}</button>
        <div class="composer-anchor" id="composerAnchor"></div>
      </main>
    </section>

    <button class="inspector-backdrop" id="inspectorBackdrop" type="button" aria-label="${copy.close}" tabindex="-1" hidden></button>
    <aside class="inspector" id="inspector" role="dialog" aria-modal="true" aria-label="${copy.inspectorTitle}" aria-hidden="true" tabindex="-1" inert>
      <div class="inspector-header">
        <div>
          <span class="inspector-kicker">ORBIT</span>
          <h2>${copy.inspectorTitle}</h2>
        </div>
        <button class="icon-button" id="inspectorClose" type="button" aria-label="${copy.close}">${renderUiIcon("close")}</button>
      </div>
      <div class="inspector-tabs" role="tablist">
        <button class="inspector-tab is-active" id="activityTab" type="button" role="tab" aria-selected="true" aria-controls="activityPanel">${copy.activity}</button>
        <button class="inspector-tab" id="settingsTab" type="button" role="tab" aria-selected="false" aria-controls="settingsPanel" tabindex="-1">${copy.settings}</button>
      </div>

      <div class="inspector-content">
        <section class="tab-panel" id="activityPanel" role="tabpanel" aria-labelledby="activityTab">
          <section class="detail-section">
            <div class="section-heading"><h3>${copy.runtime}</h3><span id="runtimeUpdated">—</span></div>
            <dl class="runtime-grid" id="runtime"></dl>
          </section>
          <section class="detail-section activity-section">
            <div class="section-heading"><h3>${copy.activity}</h3><button class="text-button" id="clearActivity" type="button">${copy.clearActivity}</button></div>
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
              <button type="button" data-mode="strict" aria-pressed="false">${copy.modeStrict}</button>
              <button type="button" data-mode="normal" aria-pressed="false">${copy.modeNormal}</button>
              <button type="button" data-mode="auto" aria-pressed="false">${copy.modeAuto}</button>
              <button type="button" data-mode="plan" aria-pressed="false">${copy.modePlan}</button>
            </div>
          </section>
          <section class="settings-group">
            <div class="setting-row">
              <div><h3>${copy.webSearch}</h3><p>${copy.webSearchDescription}</p></div>
              <label class="switch"><input id="searchEnabled" type="checkbox" aria-label="${copy.webSearch}" /><span class="switch-track" aria-hidden="true"></span></label>
            </div>
            <div class="search-dependencies" id="searchDependencies">
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
            </div>
          </section>
          <section class="settings-group">
            <h3>${copy.theme}</h3>
            <div class="theme-options" id="themeOptions">
              <button type="button" data-theme-value="system" aria-pressed="false">${copy.system}</button>
              <button type="button" data-theme-value="light" aria-pressed="false">${copy.light}</button>
              <button type="button" data-theme-value="dark" aria-pressed="false">${copy.dark}</button>
            </div>
          </section>
        </section>
      </div>
    </aside>

  </div>
  <div class="command-palette" id="commandPalette" aria-hidden="true" hidden>
    <button class="command-palette-backdrop" id="commandPaletteBackdrop" type="button" aria-label="${copy.close}" tabindex="-1"></button>
    <section class="command-palette-dialog" role="dialog" aria-modal="true" aria-labelledby="commandPaletteTitle">
      <h2 class="sr-only" id="commandPaletteTitle">${copy.commands}</h2>
      <label class="command-search" for="commandSearch">
        <span aria-hidden="true">⌘</span>
        <input id="commandSearch" type="search" aria-label="${copy.commandSearch}" aria-controls="commandResults" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="${copy.commandSearch}" />
        <kbd aria-hidden="true">Esc</kbd>
      </label>
      <div class="command-results" id="commandResults" role="listbox"></div>
      <p class="command-empty" id="commandEmpty" hidden>${copy.noCommands}</p>
      <footer class="command-palette-footer">${copy.commandHint}</footer>
    </section>
  </div>
  <div class="toast-region" id="toasts" aria-live="assertive" aria-atomic="true"></div>
</body>
</html>`;
}
