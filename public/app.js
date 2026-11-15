// State
let appState = {
  bots: [],
  presets: {},
  config: {},
  selectedBotId: null,
  eventSource: null,
  currentStudioPersona: null,
  activeCrmUserId: null
};

// DOM Elements
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');
const botsGrid = document.getElementById('bots-grid');
const noBotsCard = document.getElementById('no-bots-card');
const botsCountBadge = document.getElementById('bots-count-badge');
const addBotModal = document.getElementById('add-bot-modal');
const terminalBody = document.getElementById('terminal-body');
const toastEl = document.getElementById('toast');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupModal();
  setupCustomizer();
  setupCopilot();
  setupSimulator();
  setupStudio();
  setupBroadcast();
  setupCrm();
  setupSettings();
  setupBackupRestore();
  setupAutoHealToggle();
  initLogStream();

  await loadPresets();
  await loadConfig();
  await loadBots();
});

// Toast notification helper
function showToast(message, type = 'info') {
  toastEl.textContent = message;
  toastEl.className = `toast show ${type}`;
  setTimeout(() => {
    toastEl.classList.remove('show');
  }, 3500);
}

// 1. Tab Navigation
function setupTabs() {
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPane = document.getElementById(`tab-${tabId}`);
      if (targetPane) targetPane.classList.add('active');

      if (tabId === 'customizer') syncCustomizerSelect();
      if (tabId === 'copilot') syncCopilotSelect();
      if (tabId === 'simulator') syncSimulatorSelect();
      if (tabId === 'broadcast') syncBroadcastSelect();
      if (tabId === 'users') syncCrmSelect();
      if (tabId === 'bots') loadBots();
    });
  });
}

// 2. Load Presets & Configuration
async function loadPresets() {
  try {
    const res = await fetch('/api/presets');
    appState.presets = await res.json();
    renderPresetButtons();
  } catch (err) {
    console.error("Failed to load presets:", err);
  }
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    appState.config = await res.json();

    const keyInput = document.getElementById('settings-gemini-key');
    const modelSelect = document.getElementById('settings-gemini-model');
    const toggleAutoHeal = document.getElementById('toggle-auto-heal');
    const autoHealLabel = document.getElementById('auto-heal-label');

    if (appState.config.hasGeminiKey) {
      keyInput.placeholder = `Configured (${appState.config.geminiApiKey})`;
    }
    if (appState.config.geminiModel) {
      modelSelect.value = appState.config.geminiModel;
    }
    toggleAutoHeal.checked = Boolean(appState.config.autoHealEnabled);
    autoHealLabel.textContent = toggleAutoHeal.checked ? "ACTIVE" : "OFF";
    autoHealLabel.className = toggleAutoHeal.checked ? "text-green" : "text-sub";
  } catch (err) {
    console.error("Failed to load config:", err);
  }
}

// 3. Load & Render Bots
async function loadBots() {
  try {
    const res = await fetch('/api/bots');
    appState.bots = await res.json();

    botsCountBadge.textContent = appState.bots.length;

    if (appState.bots.length === 0) {
      botsGrid.innerHTML = '';
      noBotsCard.style.display = 'block';
    } else {
      noBotsCard.style.display = 'none';
      renderBotsList();
    }

    syncCustomizerSelect();
    syncCopilotSelect();
    syncSimulatorSelect();
    syncBroadcastSelect();
    syncCrmSelect();
  } catch (err) {
    console.error("Failed to load bots:", err);
  }
}

function renderBotsList() {
  botsGrid.innerHTML = '';
  appState.bots.forEach(bot => {
    const card = document.createElement('div');
    card.className = 'bot-card';

    const isRunning = bot.status === 'running';
    const isError = bot.status === 'error';
    const statusClass = isRunning ? 'running' : (isError ? 'error' : 'stopped');
    const statusLabel = isRunning ? 'Online' : (isError ? 'Error' : 'Offline');

    const totalMsgs = bot.stats?.totalMessages || 0;
    const activeUsers = bot.stats?.activeUsers || 0;
    const usernameDisplay = bot.info?.username ? `@${bot.info.username}` : 'Not connected yet';
    const vibe = bot.settings?.relationshipVibe || 'Loving & Sweet AI Girlfriend';
    const name = bot.settings?.name || bot.info?.name || 'AI GF';

    card.innerHTML = `
      <div class="bot-card-top">
        <div class="bot-avatar-box">
          <div class="bot-avatar">💖</div>
          <div>
            <div class="bot-name">${escapeHtml(name)}</div>
            <div class="bot-username">${escapeHtml(usernameDisplay)}</div>
          </div>
        </div>
        <span class="bot-status-tag ${statusClass}">${statusLabel}</span>
      </div>

      <div class="bot-vibe-box">
        <strong>Vibe:</strong> ${escapeHtml(vibe)}
      </div>

      <div class="bot-stats-row">
        <div class="bot-stats-item">Messages: <strong>${totalMsgs}</strong></div>
        <div class="bot-stats-item">Users: <strong>${activeUsers}</strong></div>
        <div class="bot-stats-item">Status: <strong>${escapeHtml(bot.statusMessage || 'Idle')}</strong></div>
      </div>

      <div class="bot-card-actions">
        ${isRunning 
          ? `<button class="btn btn-secondary btn-sm" onclick="stopBot('${bot.id}')">⏹️ Stop</button>
             <button class="btn btn-secondary btn-sm" onclick="restartBot('${bot.id}')">🔄 Restart</button>`
          : `<button class="btn btn-primary btn-sm" onclick="startBot('${bot.id}')">▶️ Start Bot</button>`
        }
        <button class="btn btn-secondary btn-sm" onclick="openSimulatorFor('${bot.id}')">💬 Test</button>
        <button class="btn btn-secondary btn-sm" onclick="openCustomizerFor('${bot.id}')">⚙️ Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteBot('${bot.id}', '${escapeHtml(name)}')">🗑️</button>
      </div>
    `;

    botsGrid.appendChild(card);
  });
}

// Bot Control Actions
window.startBot = async function(id) {
  try {
    showToast("Starting bot...", "info");
    const res = await fetch(`/api/bots/${id}/start`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showToast("Bot started successfully! Online on Telegram.", "success");
      await loadBots();
    } else {
      showToast(`Failed to start: ${data.error}`, "error");
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
};

window.stopBot = async function(id) {
  try {
    const res = await fetch(`/api/bots/${id}/stop`, { method: 'POST' });
    if (res.ok) {
      showToast("Bot stopped.", "info");
      await loadBots();
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
};

window.restartBot = async function(id) {
  try {
    showToast("Restarting bot...", "info");
    const res = await fetch(`/api/bots/${id}/restart`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showToast("Bot restarted smoothly!", "success");
      await loadBots();
    } else {
      showToast(`Restart failed: ${data.error}`, "error");
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
};

window.deleteBot = async function(id, name) {
  if (!confirm(`Kya aap sach me '${name}' bot ko delete karna chahte hain?`)) return;
  try {
    const res = await fetch(`/api/bots/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast("Bot deleted.", "info");
      await loadBots();
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
};

// 4. LIVE TEST CHAT SIMULATOR
function syncSimulatorSelect() {
  const select = document.getElementById('sim-bot-select');
  select.innerHTML = '';
  appState.bots.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = `${b.settings?.name || b.id} (${b.status})`;
    select.appendChild(opt);
  });
  if (appState.selectedBotId) select.value = appState.selectedBotId;
  loadSimulatorMessages();
}

window.openSimulatorFor = (botId) => {
  appState.selectedBotId = botId;
  const tab = document.querySelector('[data-tab="simulator"]');
  if (tab) tab.click();
};

async function loadSimulatorMessages() {
  const botId = document.getElementById('sim-bot-select').value;
  if (!botId) return;
  try {
    const res = await fetch(`/api/bots/${botId}/simulate`);
    const data = await res.json();
    const container = document.getElementById('simulator-messages');
    container.innerHTML = '';

    if (!data.history || data.history.length === 0) {
      container.innerHTML = `
        <div class="sim-msg model">
          <div class="msg-bubble">Hii! ❤️ Mujhse baat karke dekho, main yahan live test chat ke liye ready hoon!</div>
        </div>
      `;
      return;
    }

    data.history.forEach(m => {
      const div = document.createElement('div');
      div.className = `sim-msg ${m.role === 'model' ? 'model' : 'user'}`;
      div.innerHTML = `<div class="msg-bubble">${escapeHtml(m.parts[0]?.text || '')}</div>`;
      container.appendChild(div);
    });
    container.scrollTop = container.scrollHeight;
  } catch (e) {
    console.error(e);
  }
}

function setupSimulator() {
  const btnSend = document.getElementById('btn-sim-send');
  const input = document.getElementById('sim-input-text');
  const select = document.getElementById('sim-bot-select');
  const container = document.getElementById('simulator-messages');

  select.addEventListener('change', loadSimulatorMessages);

  const sendMessage = async () => {
    const botId = select.value;
    const text = input.value.trim();
    if (!botId || !text) return;

    input.value = '';
    // Append user message immediately
    const userDiv = document.createElement('div');
    userDiv.className = 'sim-msg user';
    userDiv.innerHTML = `<div class="msg-bubble">${escapeHtml(text)}</div>`;
    container.appendChild(userDiv);

    // Typing bubble
    const typingDiv = document.createElement('div');
    typingDiv.className = 'sim-msg model';
    typingDiv.innerHTML = `<div class="msg-bubble"><em>typing... ❤️</em></div>`;
    container.appendChild(typingDiv);
    container.scrollTop = container.scrollHeight;

    try {
      const res = await fetch(`/api/bots/${botId}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      const data = await res.json();
      typingDiv.remove();

      if (res.ok) {
        const replyDiv = document.createElement('div');
        replyDiv.className = 'sim-msg model';
        replyDiv.innerHTML = `<div class="msg-bubble">${escapeHtml(data.reply)}</div>`;
        container.appendChild(replyDiv);
      } else {
        const errDiv = document.createElement('div');
        errDiv.className = 'sim-msg model';
        errDiv.innerHTML = `<div class="msg-bubble" style="color:#f87171;">⚠️ ${escapeHtml(data.error)}</div>`;
        container.appendChild(errDiv);
      }
    } catch (err) {
      typingDiv.remove();
      const errDiv = document.createElement('div');
      errDiv.className = 'sim-msg model';
      errDiv.innerHTML = `<div class="msg-bubble" style="color:#f87171;">⚠️ Network Error: ${err.message}</div>`;
      container.appendChild(errDiv);
    }
    container.scrollTop = container.scrollHeight;
  };

  btnSend.addEventListener('click', sendMessage);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  document.getElementById('btn-clear-simulator').addEventListener('click', async () => {
    const botId = select.value;
    if (!botId) return;
    await fetch(`/api/bots/${botId}/simulate`, { method: 'DELETE' });
    showToast("Simulator chat cleared", "info");
    loadSimulatorMessages();
  });
}

// 5. AI PERSONA STUDIO
window.setStudioIdea = (text) => {
  document.getElementById('studio-idea-input').value = text;
};

function setupStudio() {
  const btnGen = document.getElementById('btn-studio-generate');
  const input = document.getElementById('studio-idea-input');
  const previewBox = document.getElementById('studio-preview-box');
  const resultName = document.getElementById('studio-result-name');
  const resultVibe = document.getElementById('studio-result-vibe');
  const resultPrompt = document.getElementById('studio-result-prompt');
  const btnApply = document.getElementById('btn-studio-apply-to-bot');

  btnGen.addEventListener('click', async () => {
    const idea = input.value.trim();
    if (!idea) {
      alert("Please enter a character idea first!");
      return;
    }

    btnGen.textContent = "Crafting Persona...";
    btnGen.disabled = true;

    try {
      const res = await fetch('/api/ai/craft-persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea })
      });
      const data = await res.json();

      if (res.ok && data.persona) {
        appState.currentStudioPersona = data.persona;
        resultName.textContent = data.persona.name;
        resultVibe.textContent = data.persona.relationshipVibe;
        resultPrompt.value = data.persona.systemPrompt;
        previewBox.style.display = 'block';
        showToast("Persona crafted successfully!", "success");
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      btnGen.textContent = "✨ Generate Persona";
      btnGen.disabled = false;
    }
  });

  btnApply.addEventListener('click', () => {
    if (!appState.currentStudioPersona) return;
    openAddBotModal();
    document.getElementById('modal-bot-name').value = appState.currentStudioPersona.name;
    appState.pendingCustomSettings = {
      relationshipVibe: appState.currentStudioPersona.relationshipVibe,
      systemPrompt: appState.currentStudioPersona.systemPrompt,
      temperature: appState.currentStudioPersona.temperature,
      emojiUsage: appState.currentStudioPersona.emojiUsage,
      language: appState.currentStudioPersona.language
    };
    showToast(`Loaded ${appState.currentStudioPersona.name}'s persona! Paste token and launch.`, "info");
  });
}

// 6. BROADCAST SYSTEM
function syncBroadcastSelect() {
  const select = document.getElementById('broadcast-bot-select');
  select.innerHTML = '';
  appState.bots.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = `${b.settings?.name || b.id} (Audience: ${b.stats?.activeUsers || 0} users)`;
    select.appendChild(opt);
  });
  updateBroadcastReach();
}

function updateBroadcastReach() {
  const select = document.getElementById('broadcast-bot-select');
  const bot = appState.bots.find(b => b.id === select.value);
  const estimate = document.getElementById('broadcast-reach-estimate');
  if (bot) {
    estimate.textContent = `Target Audience: ~${bot.stats?.activeUsers || 0} users who chatted with ${bot.settings?.name}`;
  }
}

window.setBroadcastText = (text) => {
  document.getElementById('broadcast-message-text').value = text;
};

function setupBroadcast() {
  const select = document.getElementById('broadcast-bot-select');
  select.addEventListener('change', updateBroadcastReach);

  const btnSend = document.getElementById('btn-send-broadcast');
  const messageInput = document.getElementById('broadcast-message-text');
  const resultBox = document.getElementById('broadcast-result-box');

  btnSend.addEventListener('click', async () => {
    const botId = select.value;
    const message = messageInput.value.trim();

    if (!botId) {
      alert("Please select a bot first!");
      return;
    }
    if (!message) {
      alert("Please type a message to broadcast!");
      return;
    }

    if (!confirm("Are you sure you want to broadcast this message to all users?")) return;

    btnSend.textContent = "Sending...";
    btnSend.disabled = true;

    try {
      const res = await fetch(`/api/bots/${botId}/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
      const data = await res.json();

      if (res.ok) {
        resultBox.style.display = 'block';
        resultBox.innerHTML = `✅ <strong>Broadcast Complete!</strong> Delivered to <strong>${data.sent}</strong> users (${data.failed} failed).`;
        showToast("Broadcast finished successfully!", "success");
      } else {
        alert(`Broadcast error: ${data.error}`);
      }
    } catch (e) {
      alert(`Network error: ${e.message}`);
    } finally {
      btnSend.textContent = "🚀 Send Broadcast Now";
      btnSend.disabled = false;
    }
  });
}

// 7. USERS CRM
function syncCrmSelect() {
  const select = document.getElementById('crm-bot-select');
  select.innerHTML = '';
  appState.bots.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = b.settings?.name || b.id;
    select.appendChild(opt);
  });
  loadCrmUsers();
}

async function loadCrmUsers() {
  const select = document.getElementById('crm-bot-select');
  const botId = select.value;
  const listContainer = document.getElementById('users-list');
  listContainer.innerHTML = '';

  if (!botId) return;

  try {
    const res = await fetch(`/api/bots/${botId}/users`);
    const users = await res.json();

    if (users.length === 0) {
      listContainer.innerHTML = `<p class="subtle-text" style="padding:16px;">Abhi is bot ke sath kisi user ne chat shuru nahi ki hai.</p>`;
      return;
    }

    users.forEach(u => {
      const item = document.createElement('div');
      item.className = 'user-item';
      const name = `${u.firstName || 'User'} ${u.lastName || ''}`.trim();
      const username = u.username ? `@${u.username}` : `ID: ${u.id}`;
      const lastSeenTime = u.lastSeen ? new Date(u.lastSeen).toLocaleTimeString() : '';

      item.innerHTML = `
        <div class="user-info">
          <div class="user-avatar">${escapeHtml(name[0] || 'U')}</div>
          <div>
            <div class="user-name">${escapeHtml(name)}</div>
            <div class="user-meta">${escapeHtml(username)} • Messages: ${u.messageCount || 1} • Last seen: ${lastSeenTime}</div>
          </div>
        </div>
        <div>
          <button class="btn btn-secondary btn-sm" onclick="viewUserHistory('${botId}', '${u.id}', '${escapeHtml(name)}')">📜 View Chat</button>
        </div>
      `;
      listContainer.appendChild(item);
    });
  } catch (err) {
    console.error(err);
  }
}

window.viewUserHistory = async (botId, userId, userName) => {
  appState.activeCrmUserId = { botId, userId };
  const modal = document.getElementById('user-history-modal');
  const title = document.getElementById('history-modal-title');
  const body = document.getElementById('history-modal-body');

  title.textContent = `Chat History with ${userName}`;
  body.innerHTML = `<em>Loading conversation...</em>`;
  modal.style.display = 'flex';

  try {
    const res = await fetch(`/api/bots/${botId}/users/${userId}/history`);
    const history = await res.json();

    if (history.length === 0) {
      body.innerHTML = `<p class="subtle-text">No message history found for this user.</p>`;
      return;
    }

    body.innerHTML = '';
    history.forEach(m => {
      const p = document.createElement('div');
      p.style.marginBottom = '8px';
      p.innerHTML = `<strong>${m.role === 'user' ? userName : 'Bot'}:</strong> ${escapeHtml(m.parts[0]?.text || '')}`;
      body.appendChild(p);
    });
  } catch (err) {
    body.innerHTML = `Error: ${err.message}`;
  }
};

function setupCrm() {
  document.getElementById('crm-bot-select').addEventListener('change', loadCrmUsers);
  document.getElementById('btn-refresh-users').addEventListener('click', loadCrmUsers);

  document.getElementById('btn-clear-user-memory').addEventListener('click', async () => {
    if (!appState.activeCrmUserId) return;
    if (!confirm("Are you sure you want to clear conversation memory for this user?")) return;
    const { botId, userId } = appState.activeCrmUserId;

    await fetch(`/api/bots/${botId}/users/${userId}/history`, { method: 'DELETE' });
    showToast("User conversation memory cleared!", "info");
    document.getElementById('user-history-modal').style.display = 'none';
  });
}

// 8. Backup & Restore
function setupBackupRestore() {
  const fileInput = document.getElementById('backup-file-input');
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const backupData = JSON.parse(event.target.result);
        const res = await fetch('/api/backup/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(backupData)
        });
        const data = await res.json();
        if (res.ok) {
          alert("Backup successfully restored! Reloading...");
          window.location.reload();
        } else {
          alert(`Restore failed: ${data.error}`);
        }
      } catch (err) {
        alert(`Invalid JSON file: ${err.message}`);
      }
    };
    reader.readAsText(file);
  });
}

// 9. Modal Handling (Add Bot)
function setupModal() {
  const btnOpen = document.getElementById('btn-open-add-bot');
  const btnClose = document.getElementById('btn-close-modal');
  const btnCancel = document.getElementById('btn-cancel-modal');
  const btnSubmit = document.getElementById('btn-submit-add-bot');
  const spinner = document.getElementById('modal-spinner');

  window.openAddBotModal = () => {
    addBotModal.style.display = 'flex';
    document.getElementById('modal-bot-token').value = '';
    document.getElementById('modal-bot-name').value = '';
    document.getElementById('modal-bot-token').focus();
  };

  btnOpen.addEventListener('click', window.openAddBotModal);
  btnClose.addEventListener('click', () => addBotModal.style.display = 'none');
  btnCancel.addEventListener('click', () => addBotModal.style.display = 'none');

  btnSubmit.addEventListener('click', async () => {
    const token = document.getElementById('modal-bot-token').value.trim();
    const name = document.getElementById('modal-bot-name').value.trim();
    const preset = document.getElementById('modal-bot-preset').value;
    const autoStart = document.getElementById('modal-bot-autostart').checked;

    if (!token) {
      alert("Please enter a Telegram Bot Token from @BotFather");
      return;
    }

    spinner.style.display = 'inline-block';
    btnSubmit.disabled = true;

    try {
      const customSettings = appState.pendingCustomSettings || {};
      const res = await fetch('/api/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name: name || undefined, preset, autoStart, customSettings })
      });
      const data = await res.json();

      if (res.ok) {
        appState.pendingCustomSettings = null;
        showToast("Bot successfully connected & configured!", "success");
        addBotModal.style.display = 'none';
        await loadBots();
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (err) {
      alert(`Network error: ${err.message}`);
    } finally {
      spinner.style.display = 'none';
      btnSubmit.disabled = false;
    }
  });

  document.getElementById('btn-refresh-bots').addEventListener('click', loadBots);
}

// 10. Bot Behavior Customizer
function renderPresetButtons() {
  const container = document.getElementById('preset-buttons-container');
  container.innerHTML = '';
  for (const [key, preset] of Object.entries(appState.presets)) {
    const btn = document.createElement('button');
    btn.className = 'chip-btn';
    btn.textContent = preset.name;
    btn.onclick = () => applyPresetToForm(key);
    container.appendChild(btn);
  }
}

function applyPresetToForm(presetKey) {
  const p = appState.presets[presetKey];
  if (!p) return;
  document.getElementById('edit-bot-vibe').value = p.relationshipVibe;
  document.getElementById('edit-bot-prompt').value = p.systemPrompt;
  document.getElementById('edit-bot-temperature').value = p.temperature;
  document.getElementById('temp-display').textContent = p.temperature;
  document.getElementById('edit-bot-emoji').value = p.emojiUsage;
  showToast(`Applied preset: ${p.name}`, "info");
}

function syncCustomizerSelect() {
  const select = document.getElementById('customizer-bot-select');
  select.innerHTML = '';

  if (appState.bots.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '-- Pehle koi bot add karein --';
    select.appendChild(opt);
    return;
  }

  appState.bots.forEach(bot => {
    const opt = document.createElement('option');
    opt.value = bot.id;
    opt.textContent = `${bot.settings?.name || bot.id} (${bot.status})`;
    select.appendChild(opt);
  });

  if (!appState.selectedBotId && appState.bots.length > 0) {
    appState.selectedBotId = appState.bots[0].id;
  }
  select.value = appState.selectedBotId;
  loadBotIntoCustomizer(appState.selectedBotId);
}

function loadBotIntoCustomizer(botId) {
  const bot = appState.bots.find(b => b.id === botId);
  if (!bot) return;

  appState.selectedBotId = botId;
  document.getElementById('edit-bot-name').value = bot.settings?.name || '';
  document.getElementById('edit-bot-language').value = bot.settings?.language || 'hinglish';
  document.getElementById('edit-bot-vibe').value = bot.settings?.relationshipVibe || '';
  document.getElementById('edit-bot-prompt').value = bot.settings?.systemPrompt || '';
  document.getElementById('edit-bot-temperature').value = bot.settings?.temperature ?? 0.8;
  document.getElementById('temp-display').textContent = bot.settings?.temperature ?? 0.8;
  document.getElementById('edit-bot-emoji').value = bot.settings?.emojiUsage || 'moderate';
}

window.openCustomizerFor = (botId) => {
  appState.selectedBotId = botId;
  const customizerTabBtn = document.querySelector('[data-tab="customizer"]');
  if (customizerTabBtn) customizerTabBtn.click();
};

function setupCustomizer() {
  const select = document.getElementById('customizer-bot-select');
  select.addEventListener('change', (e) => {
    loadBotIntoCustomizer(e.target.value);
  });

  const tempRange = document.getElementById('edit-bot-temperature');
  tempRange.addEventListener('input', (e) => {
    document.getElementById('temp-display').textContent = e.target.value;
  });

  document.getElementById('btn-save-customizer').addEventListener('click', async () => {
    if (!appState.selectedBotId) return;

    const updates = {
      settings: {
        name: document.getElementById('edit-bot-name').value.trim(),
        language: document.getElementById('edit-bot-language').value,
        relationshipVibe: document.getElementById('edit-bot-vibe').value.trim(),
        systemPrompt: document.getElementById('edit-bot-prompt').value.trim(),
        temperature: parseFloat(document.getElementById('edit-bot-temperature').value),
        emojiUsage: document.getElementById('edit-bot-emoji').value
      }
    };

    try {
      const res = await fetch(`/api/bots/${appState.selectedBotId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        showToast("Bot personality & settings saved!", "success");
        await loadBots();
      } else {
        const data = await res.json();
        alert(`Failed to save: ${data.error}`);
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  });

  document.getElementById('btn-reset-customizer').addEventListener('click', () => {
    if (appState.selectedBotId) loadBotIntoCustomizer(appState.selectedBotId);
  });
}

// 11. AI Bot Copilot
function syncCopilotSelect() {
  const select = document.getElementById('copilot-target-bot');
  select.innerHTML = '';
  appState.bots.forEach(bot => {
    const opt = document.createElement('option');
    opt.value = bot.id;
    opt.textContent = `${bot.settings?.name || bot.id} (${bot.info?.username ? '@' + bot.info.username : 'Offline'})`;
    select.appendChild(opt);
  });
  if (appState.selectedBotId) select.value = appState.selectedBotId;
}

window.setCopilotPrompt = (text) => {
  document.getElementById('copilot-instruction').value = text;
};

function setupCopilot() {
  const btnRun = document.getElementById('btn-run-copilot');
  const spinner = document.getElementById('copilot-spinner');
  const instructionInput = document.getElementById('copilot-instruction');
  const resultBox = document.getElementById('copilot-result');
  const explanationEl = document.getElementById('copilot-explanation');
  const updatedPromptEl = document.getElementById('copilot-updated-prompt');

  btnRun.addEventListener('click', async () => {
    const botId = document.getElementById('copilot-target-bot').value;
    const instruction = instructionInput.value.trim();

    if (!botId) {
      alert("Please select a target bot first!");
      return;
    }
    if (!instruction) {
      alert("Please type instructions for the AI bot engineer!");
      return;
    }

    spinner.style.display = 'inline-block';
    btnRun.disabled = true;

    try {
      const res = await fetch('/api/ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId, instruction })
      });
      const data = await res.json();

      if (res.ok) {
        resultBox.style.display = 'block';
        explanationEl.textContent = data.explanation || "Changes applied successfully!";
        updatedPromptEl.textContent = JSON.stringify(data.updatedSettings, null, 2);
        showToast("AI Copilot has updated your bot!", "success");
        await loadBots();
      } else {
        alert(`AI Error: ${data.error}`);
      }
    } catch (err) {
      alert(`Network error: ${err.message}`);
    } finally {
      spinner.style.display = 'none';
      btnRun.disabled = false;
    }
  });
}

// 12. Auto-Healer, Live Terminal Logs & AI Diagnose
function initLogStream() {
  if (appState.eventSource) appState.eventSource.close();

  fetch('/api/logs')
    .then(r => r.json())
    .then(logs => {
      terminalBody.innerHTML = '';
      logs.reverse().forEach(appendLogLine);
    })
    .catch(console.error);

  appState.eventSource = new EventSource('/api/logs/stream');
  appState.eventSource.onmessage = (e) => {
    try {
      const entry = JSON.parse(e.data);
      appendLogLine(entry);
    } catch (err) {
      console.error("SSE parse error:", err);
    }
  };

  document.getElementById('btn-clear-logs').addEventListener('click', () => {
    terminalBody.innerHTML = '<div class="log-line info">[VIEW CLEARED]</div>';
  });

  document.getElementById('btn-ai-diagnose').addEventListener('click', async () => {
    const diagCard = document.getElementById('ai-diagnosis-card');
    const diagContent = document.getElementById('diagnosis-content');
    const diagActions = document.getElementById('diagnosis-actions');

    diagCard.style.display = 'block';
    diagContent.innerHTML = "<em>Analyzing logs and error states with Gemini AI...</em>";
    diagActions.innerHTML = "";

    try {
      const res = await fetch('/api/ai/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId: appState.selectedBotId || null })
      });
      const data = await res.json();

      if (res.ok && data.diagnosis) {
        const d = data.diagnosis;
        diagContent.innerHTML = `
          <div style="margin-bottom: 6px;"><strong>Summary:</strong> ${escapeHtml(d.summary)}</div>
          <div style="margin-bottom: 6px;"><strong>Cause:</strong> ${escapeHtml(d.cause)}</div>
          <div><strong>Recommended Fix:</strong> ${escapeHtml(d.fix)}</div>
        `;

        if (d.autoAction && d.autoAction !== 'none') {
          const btn = document.createElement('button');
          btn.className = 'btn btn-primary btn-sm';
          btn.textContent = `⚡ 1-Click Auto-Fix (${d.autoAction})`;
          btn.onclick = async () => {
            await executeAutoFix(appState.selectedBotId, d.autoAction);
          };
          diagActions.appendChild(btn);
        }
      } else {
        diagContent.textContent = data.error || "No critical errors found in recent logs.";
      }
    } catch (err) {
      diagContent.textContent = `Diagnosis failed: ${err.message}`;
    }
  });
}

async function executeAutoFix(botId, action) {
  try {
    showToast(`Executing fix: ${action}...`, "info");
    const res = await fetch('/api/ai/auto-fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botId, action })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message, "success");
      await loadBots();
    } else {
      alert(`Auto-fix failed: ${data.error}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

function appendLogLine(entry) {
  const line = document.createElement('div');
  line.className = `log-line ${entry.type || 'info'}`;
  const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';
  line.textContent = `[${time}] [${(entry.type || 'LOG').toUpperCase()}] ${entry.message}`;

  terminalBody.appendChild(line);
  terminalBody.scrollTop = terminalBody.scrollHeight;
}

function setupAutoHealToggle() {
  const toggle = document.getElementById('toggle-auto-heal');
  const label = document.getElementById('auto-heal-label');

  toggle.addEventListener('change', async () => {
    const isEnabled = toggle.checked;
    label.textContent = isEnabled ? "ACTIVE" : "OFF";
    label.className = isEnabled ? "text-green" : "text-sub";

    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoHealEnabled: isEnabled })
      });
      showToast(`Auto Error-Fix is now ${isEnabled ? 'ENABLED' : 'DISABLED'}`, isEnabled ? 'success' : 'info');
    } catch (e) {
      console.error(e);
    }
  });
}

// 13. Settings
function setupSettings() {
  const btnSave = document.getElementById('btn-save-settings');
  const keyInput = document.getElementById('settings-gemini-key');
  const modelSelect = document.getElementById('settings-gemini-model');
  const btnToggleVis = document.getElementById('btn-toggle-key-vis');

  btnToggleVis.addEventListener('click', () => {
    keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
  });

  btnSave.addEventListener('click', async () => {
    const geminiApiKey = keyInput.value.trim();
    const geminiModel = modelSelect.value;

    const body = { geminiModel };
    if (geminiApiKey) body.geminiApiKey = geminiApiKey;

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        showToast("Settings saved successfully!", "success");
        keyInput.value = '';
        await loadConfig();
      } else {
        const data = await res.json();
        alert(`Error: ${data.error}`);
      }
    } catch (err) {
      alert(`Network error: ${err.message}`);
    }
  });
}

// Helper: Escape HTML
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
