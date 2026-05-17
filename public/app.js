const authPanel = document.querySelector('#auth-panel');
const chatPanel = document.querySelector('#chat-panel');
const loginForm = document.querySelector('#login-form');
const passwordInput = document.querySelector('#password');
const authError = document.querySelector('#auth-error');
const statusStrip = document.querySelector('#status-strip');
const messagesEl = document.querySelector('#messages');
const noticeEl = document.querySelector('#notice');
const chatForm = document.querySelector('#chat-form');
const messageInput = document.querySelector('#message-input');
const sendButton = document.querySelector('#send-button');
const logoutButton = document.querySelector('#logout-button');
const commandButtons = [...document.querySelectorAll('[data-command]')];
const assistantLabel = '学姐';

let pending = false;
let currentState = null;
let optimisticMessages = [];

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
  chatPanel.classList.add('hidden');
  authPanel.classList.remove('hidden');
  passwordInput.focus();
}

async function sendText(text) {
  const shouldOptimisticallyRender = !text.startsWith('/');
  const draftText = messageInput.value;

  pending = true;
  sendButton.disabled = true;
  for (const button of commandButtons) {
    button.disabled = true;
  }

  if (shouldOptimisticallyRender) {
    messageInput.value = '';
    optimisticMessages = [
      {
        id: `optimistic-${Date.now()}`,
        role: 'user',
        content: text,
        createdAt: new Date().toISOString(),
        model: null,
      },
    ];
    rerenderMessages();
    clearNotice();
  }

  try {
    const payload = await api('/api/chat', {
      method: 'POST',
      body: { text },
    });
    optimisticMessages = [];
    renderState(payload.state);
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
    pending = false;
    sendButton.disabled = false;
    for (const button of commandButtons) {
      button.disabled = false;
    }
  }
}

function renderState(state) {
  currentState = state;
  statusStrip.innerHTML = [
    badge(`Mode ${state.mode}`),
    badge(`${state.messageCount} messages`),
    badge(`${state.summaryCount} summaries`),
    badge(`summary to #${state.summaryUntil}`),
  ].join('');

  rerenderMessages();
}

function rerenderMessages() {
  const messages = expandMessagesForDisplay([
    ...(currentState?.messages ?? []),
    ...optimisticMessages,
  ]);

  messagesEl.innerHTML = '';
  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '还没有历史消息。直接发第一句就行。';
    messagesEl.append(empty);
    return;
  }

  for (const message of messages) {
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
    messagesEl.append(item);
  }

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function expandMessagesForDisplay(messages) {
  return messages.flatMap((message) => {
    if (message.role !== 'assistant') {
      return [{ ...message, isContinuation: false }];
    }

    const segments = splitAssistantMessage(message.content);
    return segments.map((content, index) => ({
      ...message,
      id: `${message.id}-${index}`,
      content,
      isContinuation: index > 0,
    }));
  });
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
