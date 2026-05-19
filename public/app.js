const authPanel = document.querySelector('#auth-panel');
const chatPanel = document.querySelector('#chat-panel');
const loginForm = document.querySelector('#login-form');
const passwordInput = document.querySelector('#password');
const authError = document.querySelector('#auth-error');
const statusStrip = document.querySelector('#status-strip');
const conversationListEl = document.querySelector('#conversation-list');
const newConversationButton = document.querySelector('#new-conversation-button');
const messagesEl = document.querySelector('#messages');
const noticeEl = document.querySelector('#notice');
const chatForm = document.querySelector('#chat-form');
const messageInput = document.querySelector('#message-input');
const sendButton = document.querySelector('#send-button');
const logoutButton = document.querySelector('#logout-button');
const commandButtons = [...document.querySelectorAll('[data-command]')];
const assistantLabel = '学姐';
const assistantBubbleRevealTimers = [];

let pending = false;
let currentState = null;
let optimisticMessages = [];
let assistantBubbleRevealToken = 0;

boot().catch((error) => {
  showNotice(error instanceof Error ? error.message : String(error), true);
});

async function boot() {
  const session = await api('/api/session');
  if (session.authenticated) {
    await showChat();
    return;
  }
  showAuth();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  authError.textContent = '';

  try {
    await api('/api/login', {
      method: 'POST',
      body: { password: passwordInput.value },
    });
    passwordInput.value = '';
    await showChat();
  } catch (error) {
    authError.textContent = '口令不对，或者服务器暂时不可用。';
  }
});

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text || pending) {
    return;
  }
  await sendText(text);
});

logoutButton.addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  showAuth();
});

newConversationButton.addEventListener('click', async () => {
  if (pending) {
    return;
  }
  await createConversation();
});

for (const button of commandButtons) {
  button.addEventListener('click', async () => {
    if (pending) {
      return;
    }
    const text = button.dataset.command;
    if (!text) {
      return;
    }
    await sendText(text);
  });
}

async function showChat() {
  const payload = await api('/api/bootstrap');
  renderState(payload.state);
  authPanel.classList.add('hidden');
  chatPanel.classList.remove('hidden');
  messageInput.focus();
}

function showAuth() {
  clearAssistantBubbleReveal();
  currentState = null;
  optimisticMessages = [];
  chatPanel.classList.add('hidden');
  authPanel.classList.remove('hidden');
  passwordInput.focus();
}

async function sendText(text) {
  const shouldOptimisticallyRender = !text.startsWith('/');
  const draftText = messageInput.value;

  setPending(true);

  if (shouldOptimisticallyRender) {
    messageInput.value = '';
    optimisticMessages = [{
      id: `optimistic-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
      model: null,
    }];
    rerenderMessages();
    clearNotice();
  }

  try {
    const payload = await api('/api/chat', {
      method: 'POST',
      body: { text, conversationId: currentState?.currentConversationId },
    });
    optimisticMessages = [];
    renderState(payload.state, {
      animateAssistantMessageId: payload.persisted ? payload.state.messages.at(-1)?.id ?? null : null,
    });
    if (!payload.persisted && payload.reply) {
      showNotice(payload.reply, false);
    } else {
      clearNotice();
    }
    if (!shouldOptimisticallyRender) {
      messageInput.value = '';
    }
    messageInput.focus();
  } catch (error) {
    if (shouldOptimisticallyRender) {
      optimisticMessages = [];
      messageInput.value = draftText;
      rerenderMessages();
    }
    showNotice(error instanceof Error ? error.message : '发送失败', true);
  } finally {
    setPending(false);
  }
}

async function createConversation() {
  setPending(true);
  clearNotice();
  optimisticMessages = [];

  try {
    const payload = await api('/api/conversations', {
      method: 'POST',
    });
    renderState(payload.state);
    messageInput.value = '';
    messageInput.focus();
  } catch (error) {
    showNotice(error instanceof Error ? error.message : '新建对话失败', true);
  } finally {
    setPending(false);
  }
}

async function selectConversation(conversationId) {
  if (pending || conversationId === currentState?.currentConversationId) {
    return;
  }

  setPending(true);
  clearNotice();
  optimisticMessages = [];

  try {
    const payload = await api('/api/conversations/select', {
      method: 'POST',
      body: { conversationId },
    });
    renderState(payload.state);
    messageInput.focus();
  } catch (error) {
    showNotice(error instanceof Error ? error.message : '切换对话失败', true);
  } finally {
    setPending(false);
  }
}

function setPending(next) {
  pending = next;
  sendButton.disabled = next;
  newConversationButton.disabled = next;
  for (const button of commandButtons) {
    button.disabled = next;
  }
  rerenderConversationList();
}

function renderState(state, options = {}) {
  currentState = state;
  statusStrip.innerHTML = [
    badge(state.currentConversationTitle || '新对话'),
    badge(`Mode ${state.mode}`),
    badge(`${state.messageCount} messages`),
    badge(`${state.summaryCount} summaries`),
    badge(`summary to #${state.summaryUntil}`),
  ].join('');

  rerenderConversationList();
  rerenderMessages(options);
}

function rerenderConversationList() {
  conversationListEl.innerHTML = '';

  const conversations = currentState?.conversations ?? [];
  if (!conversations.length) {
    const empty = document.createElement('div');
    empty.className = 'conversation-empty';
    empty.textContent = '还没有对话。先新建一个。';
    conversationListEl.append(empty);
    return;
  }

  for (const conversation of conversations) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'conversation-item';
    if (conversation.id === currentState?.currentConversationId) {
      item.classList.add('active');
    }
    item.disabled = pending;
    item.addEventListener('click', () => {
      void selectConversation(conversation.id);
    });

    const top = document.createElement('div');
    top.className = 'conversation-item-top';

    const title = document.createElement('strong');
    title.className = 'conversation-title';
    title.textContent = conversation.title;

    const time = document.createElement('span');
    time.className = 'conversation-time';
    time.textContent = formatTime(conversation.updatedAt);

    top.append(title, time);

    const preview = document.createElement('p');
    preview.className = 'conversation-preview';
    preview.textContent = conversation.preview;

    const meta = document.createElement('span');
    meta.className = 'conversation-meta';
    meta.textContent = `${conversation.messageCount} 条消息`;

    item.append(top, preview, meta);
    conversationListEl.append(item);
  }
}

function rerenderMessages(options = {}) {
  const messages = expandMessagesForDisplay([
    ...(currentState?.messages ?? []),
    ...optimisticMessages,
  ]);
  const animateAssistantMessageId = options.animateAssistantMessageId === null || options.animateAssistantMessageId === undefined
    ? null
    : String(options.animateAssistantMessageId);

  clearAssistantBubbleReveal();
  messagesEl.innerHTML = '';
  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '这个对话还没有消息。直接发第一句就行。';
    messagesEl.append(empty);
    return;
  }

  const revealMessages = animateAssistantMessageId
    ? messages.filter((message) => message.role === 'assistant' && message.messageId === animateAssistantMessageId)
    : [];
  const shouldAnimate = Boolean(revealMessages.length);

  for (const message of shouldAnimate
    ? messages.filter((entry) => !(entry.role === 'assistant' && entry.messageId === animateAssistantMessageId))
    : messages) {
    messagesEl.append(renderMessageBubble(message));
  }

  if (!shouldAnimate) {
    scrollMessagesToBottom();
    return;
  }

  revealAssistantBubbles(revealMessages);
}

function expandMessagesForDisplay(messages) {
  return messages.flatMap((message) => {
    if (message.role !== 'assistant') {
      return [{ ...message, messageId: String(message.id), isContinuation: false }];
    }

    const segments = splitAssistantMessage(message.content);
    return segments.map((content, index) => ({
      ...message,
      id: `${message.id}-${index}`,
      messageId: String(message.id),
      content,
      isContinuation: index > 0,
    }));
  });
}

function renderMessageBubble(message) {
  const item = document.createElement('article');
  item.className = `bubble ${message.role === 'user' ? 'user' : 'assistant'}`;

  if (!message.isContinuation) {
    const meta = document.createElement('div');
    meta.className = 'bubble-meta';
    meta.textContent = message.role === 'user'
      ? `你 · ${formatTime(message.createdAt)}`
      : `${assistantLabel} · ${formatTime(message.createdAt)}`;
    item.append(meta);
  } else {
    item.classList.add('continuation');
  }

  const body = document.createElement('p');
  body.className = 'bubble-body';
  body.textContent = message.content;

  item.append(body);
  return item;
}

function revealAssistantBubbles(messages) {
  const revealToken = ++assistantBubbleRevealToken;
  let offsetMs = 0;

  for (const message of messages) {
    const timerId = window.setTimeout(() => {
      if (revealToken !== assistantBubbleRevealToken) {
        return;
      }

      const item = renderMessageBubble(message);
      item.classList.add('bubble-enter');
      messagesEl.append(item);
      scrollMessagesToBottom();
    }, offsetMs);

    assistantBubbleRevealTimers.push(timerId);
    offsetMs += bubbleRevealIntervalMs(message.content);
  }
}

function clearAssistantBubbleReveal() {
  assistantBubbleRevealToken += 1;

  while (assistantBubbleRevealTimers.length) {
    window.clearTimeout(assistantBubbleRevealTimers.pop());
  }
}

function bubbleRevealIntervalMs(content) {
  const visibleLength = content.replace(/\s+/g, '').length;
  return clamp(220 + visibleLength * 35, 260, 1800);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function scrollMessagesToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function splitAssistantMessage(content) {
  return content
    .split(/\n+/)
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return [];
      }

      const segments = trimmed.match(/[^。！？!?]+[。！？!?]?/g) ?? [trimmed];
      return segments
        .map((segment) => segment.trim())
        .filter(Boolean);
    });
}

function showNotice(text, isError) {
  noticeEl.textContent = text;
  noticeEl.classList.remove('hidden');
  noticeEl.classList.toggle('error', Boolean(isError));
}

function clearNotice() {
  noticeEl.textContent = '';
  noticeEl.classList.add('hidden');
  noticeEl.classList.remove('error');
}

function badge(text) {
  return `<span class="badge">${escapeHtml(text)}</span>`;
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      showAuth();
      throw new Error('请重新登录。');
    }
    throw new Error(payload.error || '请求失败');
  }

  return payload;
}
