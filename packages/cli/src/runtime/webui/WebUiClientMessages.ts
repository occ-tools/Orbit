/** Rich-text, message history, and streaming response rendering. */
export const WEB_UI_CLIENT_MESSAGES_SCRIPT = String.raw`  function appendInline(parent, text) {
    const pattern = /(\u0060[^\u0060\n]+\u0060|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > cursor) parent.append(document.createTextNode(text.slice(cursor, match.index)));
      const token = match[0];
      if (token.startsWith('\u0060')) {
        const code = document.createElement('code');
        code.textContent = token.slice(1, -1);
        parent.append(code);
      } else if (token.startsWith('**')) {
        const strong = document.createElement('strong');
        strong.textContent = token.slice(2, -2);
        parent.append(strong);
      } else {
        const split = token.lastIndexOf('](');
        const link = document.createElement('a');
        link.textContent = token.slice(1, split);
        link.href = token.slice(split + 2, -1);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        parent.append(link);
      }
      cursor = match.index + token.length;
    }
    if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)));
  }

  function renderPlainBlocks(parent, text) {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    let paragraph = [];
    let list = null;
    let listType = '';

    const flushParagraph = () => {
      if (!paragraph.length) return;
      const node = document.createElement('p');
      paragraph.forEach((line, index) => {
        if (index) node.append(document.createElement('br'));
        appendInline(node, line);
      });
      parent.append(node);
      paragraph = [];
    };

    const flushList = () => {
      if (list) parent.append(list);
      list = null;
      listType = '';
    };

    for (const line of lines) {
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      const bullet = line.match(/^\s*[-*]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      const quote = line.match(/^>\s?(.*)$/);
      if (!line.trim()) {
        flushParagraph();
        flushList();
      } else if (heading) {
        flushParagraph();
        flushList();
        const node = document.createElement('h' + heading[1].length);
        appendInline(node, heading[2]);
        parent.append(node);
      } else if (bullet || ordered) {
        flushParagraph();
        const nextType = bullet ? 'ul' : 'ol';
        if (!list || listType !== nextType) {
          flushList();
          list = document.createElement(nextType);
          listType = nextType;
        }
        const item = document.createElement('li');
        appendInline(item, (bullet || ordered)[1]);
        list.append(item);
      } else if (quote) {
        flushParagraph();
        flushList();
        const node = document.createElement('blockquote');
        appendInline(node, quote[1]);
        parent.append(node);
      } else {
        flushList();
        paragraph.push(line);
      }
    }
    flushParagraph();
    flushList();
  }

  function createCodeBlock(languageName, codeText) {
    const root = document.createElement('div');
    root.className = 'code-block';
    const header = document.createElement('div');
    header.className = 'code-header';
    const languageLabel = document.createElement('span');
    languageLabel.textContent = languageName || 'text';
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'copy-code';
    copyButton.textContent = copy.copy;
    copyButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(codeText);
        copyButton.textContent = copy.copiedShort;
        showToast(copy.copied, 'success');
        window.setTimeout(() => { copyButton.textContent = copy.copy; }, 1600);
      } catch (error) {
        showToast(String(error), 'error');
      }
    });
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = codeText;
    pre.append(code);
    header.append(languageLabel, copyButton);
    root.append(header, pre);
    return root;
  }

  function renderRichText(container, value) {
    container.replaceChildren();
    const text = String(value || '');
    const fence = /\u0060\u0060\u0060([^\n\u0060]*)\n?([\s\S]*?)\u0060\u0060\u0060/g;
    let cursor = 0;
    let match;
    while ((match = fence.exec(text)) !== null) {
      if (match.index > cursor) renderPlainBlocks(container, text.slice(cursor, match.index));
      container.append(createCodeBlock(match[1].trim(), match[2].replace(/\n$/, '')));
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) renderPlainBlocks(container, text.slice(cursor));
    if (!text) container.textContent = '';
  }

  function createThinkingBlock(text, open) {
    const details = document.createElement('details');
    details.className = 'thinking-block';
    details.open = Boolean(open);
    const summary = document.createElement('summary');
    summary.textContent = copy.reasoning;
    const body = document.createElement('div');
    body.className = 'thinking-body';
    body.textContent = text || copy.thinking;
    details.append(summary, body);
    return { root: details, body };
  }

  function createToolCard(block) {
    const root = document.createElement('div');
    const isError = Boolean(block.isError);
    const isDone = block.status === 'success' || block.type === 'tool_result';
    root.className = 'tool-card' + (isError ? ' is-error' : isDone ? ' is-success' : '');
    const status = document.createElement('span');
    status.className = 'tool-status';
    const label = document.createElement('strong');
    label.textContent = block.name || copy.tool;
    const detail = document.createElement('span');
    detail.textContent = isError ? copy.error : isDone ? copy.done : copy.running;
    root.append(status, label, detail);
    return root;
  }

  function createMessage(message, streaming) {
    const role = message.role === 'user' ? 'user' : 'assistant';
    const root = document.createElement('article');
    root.className = 'message ' + role;
    root.dataset.messageId = message.id || '';
    let content;
    if (role === 'assistant') {
      const avatar = document.createElement('div');
      avatar.className = 'message-avatar';
      avatar.textContent = 'O';
      content = document.createElement('div');
      content.className = 'message-content';
      const roleLine = document.createElement('div');
      roleLine.className = 'message-role';
      const name = document.createElement('span');
      name.textContent = copy.assistant;
      const time = document.createElement('span');
      time.className = 'message-time';
      time.textContent = formatTime(message.createdAt);
      roleLine.append(name, time);
      content.append(roleLine);
      root.append(avatar, content);
    } else {
      content = document.createElement('div');
      content.className = 'message-content';
      root.append(content);
    }

    let textBody = null;
    let thinkingBody = null;
    const blocks = Array.isArray(message.blocks) && message.blocks.length
      ? message.blocks
      : [{ type: 'text', text: message.text || '' }];
    for (const block of blocks) {
      if (block.type === 'text' && block.text) {
        const body = document.createElement('div');
        body.className = 'rich-text' + (streaming ? ' stream-caret' : '');
        if (streaming) body.textContent = block.text;
        else renderRichText(body, block.text);
        content.append(body);
        textBody = body;
      } else if (block.type === 'thinking') {
        const thinking = createThinkingBlock(block.text || '', false);
        content.append(thinking.root);
        thinkingBody = thinking.body;
      } else if (block.type === 'tool') {
        content.append(createToolCard(block));
      }
    }
    if (!textBody && streaming) {
      textBody = document.createElement('div');
      textBody.className = 'rich-text stream-caret';
      content.append(textBody);
    }
    return { root, content, textBody, thinkingBody };
  }

  async function renderMessages() {
    const data = await api('/api/messages');
    elements.messages.replaceChildren();
    for (const message of data.messages || []) {
      if (!message.text && (!message.blocks || !message.blocks.length)) continue;
      elements.messages.append(createMessage(message, false).root);
    }
    state.streaming = null;
    state.streamingTurnId = null;
    setEmptyState();
    state.stickToBottom = true;
    scrollToBottom(true);
  }

  function createStreamingTurn(prompt, turnId) {
    if (prompt) {
      elements.messages.append(createMessage({
        id: 'optimistic-user-' + turnId,
        role: 'user',
        text: prompt,
        createdAt: new Date().toISOString(),
      }, false).root);
    }
    const streaming = createMessage({
      id: 'streaming-' + turnId,
      role: 'assistant',
      text: '',
      createdAt: new Date().toISOString(),
    }, true);
    elements.messages.append(streaming.root);
    state.streaming = streaming;
    state.streamingTurnId = turnId;
    state.streamText = '';
    state.pendingDelta = '';
    state.pendingThinking = '';
    setEmptyState();
    state.stickToBottom = true;
    scrollToBottom(true);
  }

  function ensureStreamingTurn(turnId) {
    if (state.streaming && state.streamingTurnId === turnId) return;
    if (state.streaming) state.streaming.root.remove();
    createStreamingTurn('', turnId);
  }

  function flushStream() {
    state.animationFrame = 0;
    if (!state.streaming) return;
    if (state.pendingDelta) {
      state.streamText += state.pendingDelta;
      state.pendingDelta = '';
      state.streaming.textBody.textContent = state.streamText;
    }
    if (state.pendingThinking) {
      if (!state.streaming.thinkingBody) {
        const thinking = createThinkingBlock('', false);
        state.streaming.content.insertBefore(thinking.root, state.streaming.textBody);
        state.streaming.thinkingBody = thinking.body;
      }
      state.streaming.thinkingBody.textContent += state.pendingThinking;
      state.pendingThinking = '';
    }
    scrollToBottom(false);
  }

  function scheduleStreamFlush() {
    if (!state.animationFrame) state.animationFrame = requestAnimationFrame(flushStream);
  }

`;
