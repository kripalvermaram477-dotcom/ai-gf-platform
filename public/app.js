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
const loginOverlay = document.getElementById('admin-login-overlay');
const mainApp = document.getElementById('main-app');

// Auth wrapper around fetch
function authFetch(url, options = {}) {
  const token = localStorage.getItem('adminToken');
  const headers = options.headers ? { ...options.headers } : {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['x-admin-token'] = token;
  }
  options.headers = headers;

  return fetch(url, options).then(res => {
    if (res.status === 401 && !url.includes('/api/auth/login')) {
      localStorage.removeItem('adminToken');
      showLoginScreen();
      throw new Error("Session expired. Please login again.");
    }
    return res;
  });
}

function showLoginScreen() {
  loginOverlay.style.display = 'flex';
  mainApp.style.display = 'none';
}

function showMainApp() {
  loginOverlay.style.display = 'none';
  mainApp.style.display = 'block';
}

// Initialize
// Global error handler — never show a black screen
window.addEventListener('error', (e) => {
  try {
    const overlay = document.getElementById('admin-login-overlay');
    if (overlay) overlay.style.display = 'flex';
    const errBox = document.getElementById('login-error-alert');
    if (errBox) {
      errBox.style.display = 'block';
      errBox.textContent = `Page error: ${e.message || 'Unknown'}. Please refresh.`;
    }
  } catch (_) {}
});

document.addEventListener('DOMContentLoaded', async () => {
  try {
    setupAuth();
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
  } catch (setupErr) {
    console.error('Setup error:', setupErr);
    const overlay = document.getElementById('admin-login-overlay');
    if (overlay) overlay.style.display = 'flex';
  }

  // Check auth status
  const token = localStorage.getItem('adminToken');
  if (!token) {
    showLoginScreen();
  } else {
    try {
      const res = await fetch('/api/auth/verify', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.authenticated) {
        localStorage.setItem('authRole', data.role || 'admin');
        showMainApp();
        initApp();
      } else {
        localStorage.removeItem('adminToken');
        showLoginScreen();
      }
    } catch (_) {
      showLoginScreen();
    }
  }
});

async function initApp() {
  applyRoleUi();
  if (currentRole() === 'admin') {
    initLogStream();
    await loadPresets();
    await loadConfig();
    await loadBots();
    loadUsage();
  } else {
    await loadPresets();
    await loadBots();
    loadReferralInfo();
  }
}

async function loadReferralInfo() {
  if (currentRole() !== 'user') return;
  const banner = document.getElementById('referral-banner');
  if (!banner) return;
  try {
    const res = await authFetch('/api/user/me');
    const me = await res.json();
    const until = me.studioAccessUntil ? new Date(me.studioAccessUntil) : null;
    const active = until && until > new Date();
    const daysLeft = active ? Math.ceil((until - new Date()) / 86400000) : 0;
    banner.style.display = 'block';
    const text = document.getElementById('referral-banner-text');
    const code = document.getElementById('referral-banner-code');
    if (text) text.textContent = active
      ? `✅ Persona Studio unlocked — ${daysLeft} day(s) left. Referrals: ${me.referralCount || 0}`
      : `Persona Studio locked. 2 referrals chahiye (5 referrals = 4 days). Aapke referrals: ${me.referralCount || 0}`;
    if (code) code.innerHTML = `Aapka referral code: <strong>${me.referralCode}</strong> · Invite link: <code>${window.location.origin}?ref=${me.referralCode}</code>`;
  } catch (_) {
    banner.style.display = 'none';
  }
}

function applyRoleUi() {
  const role = currentRole();
  document.body.dataset.role = role;

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    const tab = btn.getAttribute('data-tab');
    if (tab === 'settings' || tab === 'logs') {
      btn.style.display = role === 'admin' ? '' : 'none';
    }
  });

  const channelOption = document.querySelector('#broadcast-target option[value="channel"]');
  if (channelOption && role !== 'admin') {
    channelOption.remove();
  }

  const usageCard = document.querySelector('.usage-card');
  if (usageCard) {
    usageCard.style.display = role === 'admin' ? '' : 'none';
  }
}

function setupAuth() {
  const btnLogin = document.getElementById('btn-submit-login');
  const userInput = document.getElementById('login-username');
  const passInput = document.getElementById('login-password');
  const errBox = document.getElementById('login-error-alert');
  const btnLogout = document.getElementById('btn-admin-logout');
  const roleBtns = document.querySelectorAll('.login-role-btn');
  const titleEl = document.getElementById('login-title');
  const subtitleEl = document.getElementById('login-subtitle');
  const hintEl = document.getElementById('login-hint');
  const btnText = document.getElementById('login-btn-text');

  const modes = {
    admin: {
      title: 'Admin Login',
      subtitle: 'Platform owner access',
      btn: '🔐 Login as Admin',
      hint: 'Default admin: <code>admin</code> / <code>admin123</code>'
    },
    user: {
      title: 'User Login',
      subtitle: 'Manage your own bots',
      btn: '👤 Login',
      hint: 'Naya hain? <strong>Register</strong> tab se account banayein.'
    },
    register: {
      title: 'Create Account',
      subtitle: 'Register to run your own bot',
      btn: '✨ Create Account',
      hint: 'Password minimum 6 characters. Username: letters, numbers, _'
    }
  };

  const params = new URLSearchParams(window.location.search);
  const initialMode = params.get('ref') ? 'register' : 'admin';
  let mode = initialMode;

  const setMode = (next) => {
    mode = next;
    roleBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === next));
    titleEl.textContent = modes[next].title;
    subtitleEl.textContent = modes[next].subtitle;
    btnText.textContent = modes[next].btn;
    hintEl.innerHTML = modes[next].hint;
    errBox.style.display = 'none';
    const refGroup = document.getElementById('login-referral-group');
    if (refGroup) refGroup.style.display = next === 'register' ? 'block' : 'none';
  };

  roleBtns.forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));

  if (initialMode !== 'admin') {
    setMode(initialMode);
    const refInput = document.getElementById('login-referral');
    if (refInput && params.get('ref')) refInput.value = params.get('ref');
  }

  const doSubmit = async () => {
    const username = userInput.value.trim();
    const password = passInput.value.trim();
    if (!username || !password) {
      errBox.style.display = 'block';
      errBox.textContent = "Please enter both username and password";
      return;
    }

    const endpoint = mode === 'admin'
      ? '/api/auth/login'
      : mode === 'user'
        ? '/api/user/login'
        : '/api/user/register';

    try {
      const body = { username, password };
      if (mode === 'register') {
        const refInput = document.getElementById('login-referral');
        const ref = refInput ? refInput.value.trim() : '';
        if (ref) body.ref = ref;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (res.ok && data.token) {
        const role = data.role || (mode === 'admin' ? 'admin' : 'user');
        localStorage.setItem('adminToken', data.token);
        localStorage.setItem('authRole', role);
        errBox.style.display = 'none';
        showMainApp();
        initApp();
        showToast(role === 'admin' ? "Welcome back, Admin!" : `Welcome, ${data.account?.username || username}!`, "success");
      } else {
        errBox.style.display = 'block';
        errBox.textContent = data.error || "Login failed";
      }
    } catch (e) {
      errBox.style.display = 'block';
      errBox.textContent = `Network error: ${e.message}`;
    }
  };

  btnLogin.addEventListener('click', doSubmit);
  passInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSubmit();
  });

  btnLogout.addEventListener('click', async () => {
    const token = localStorage.getItem('adminToken');
    if (token) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      }).catch(() => {});
    }
    localStorage.removeItem('adminToken');
    localStorage.removeItem('authRole');
    showLoginScreen();
    showToast("Logged out successfully.", "info");
  });
}

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
      if (tabId === 'settings') loadUsage();
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
    const res = await authFetch('/api/config');
    appState.config = await res.json();

    const keyInput = document.getElementById('settings-gemini-key');
    const modelSelect = document.getElementById('settings-gemini-model');
    const providerSelect = document.getElementById('settings-ai-provider');
    const toggleAutoHeal = document.getElementById('toggle-auto-heal');
    const autoHealLabel = document.getElementById('auto-heal-label');

    if (appState.config.hasGeminiKey) {
      keyInput.placeholder = `Configured (${appState.config.geminiApiKey})`;
    }
    const pollInput = document.getElementById('settings-pollinations-key');
    if (pollInput && appState.config.hasPollinationsKey) {
      pollInput.placeholder = `Configured (${appState.config.pollinationsApiKey})`;
    }
    const copilotIndicator = document.getElementById('copilot-status-indicator');
    if (copilotIndicator) copilotIndicator.textContent = pollinationsEngineLabel();
    if (appState.config.geminiModel) {
      modelSelect.value = appState.config.geminiModel;
    }
    if (appState.config.aiProvider) {
      providerSelect.value = appState.config.aiProvider;
    }
    toggleAutoHeal.checked = Boolean(appState.config.autoHealEnabled);
    autoHealLabel.textContent = toggleAutoHeal.checked ? "ACTIVE" : "OFF";
    autoHealLabel.className = toggleAutoHeal.checked ? "text-green" : "text-sub";
  } catch (err) {
    console.error("Failed to load config:", err);
  }
}

// 2b. AI Usage & Balance dashboard
function formatUsd(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  if (n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function formatMs(ms) {
  const n = Number(ms);
  if (!n) return '—';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`;
}

async function loadUsage(force = false) {
  const balanceEl = document.getElementById('usage-balance');
  if (!balanceEl) return;

  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  try {
    const res = await authFetch(`/api/ai/usage${force ? '?fresh=1' : ''}`);
    const data = await res.json();

    if (!data.configured) {
      balanceEl.textContent = '—';
      balanceEl.className = 'usage-balance';
      setText('usage-key-info', 'No Pollinations key configured');
      ['usage-today-req', 'usage-today-cost', 'usage-avg-ms', 'usage-total-req'].forEach((id) => setText(id, '—'));
      const list = document.getElementById('usage-recent-list');
      if (list) list.innerHTML = '<span class="usage-empty">Add a Pollinations key in the settings below.</span>';
      const hint = document.getElementById('usage-grant-hint');
      if (hint) hint.style.display = 'none';
      return;
    }

    // Balance
    if (data.needsGrant) {
      balanceEl.textContent = '—';
      balanceEl.className = 'usage-balance';
      const hint = document.getElementById('usage-grant-hint');
      if (hint) {
        hint.style.display = 'block';
        hint.innerHTML = data.grantUrl
          ? `Balance dekhne ke liye key ko <strong>usage permission</strong> dein: <a href="${data.grantUrl}" target="_blank" rel="noopener">Grant permission →</a>`
          : 'Balance dekhne ke liye key ko <strong>account:usage</strong> permission chahiye.';
      }
    } else {
      const bal = data.balance;
      balanceEl.textContent = formatUsd(bal);
      balanceEl.className = 'usage-balance';
      if (bal !== null && bal <= 0) balanceEl.classList.add('is-empty');
      else if (bal !== null && bal < 0.5) balanceEl.classList.add('is-low');
      const hint = document.getElementById('usage-grant-hint');
      if (hint) hint.style.display = 'none';
    }

    // Key info
    const key = data.key || {};
    const keyParts = [];
    if (key.name) keyParts.push(`Key: <strong>${key.name}</strong>`);
    keyParts.push(key.expiresAt ? `Expires: ${new Date(key.expiresAt).toLocaleDateString()}` : 'Never expires');
    keyParts.push(key.budget === null || key.budget === undefined ? 'No per-key cap' : `Budget: ${formatUsd(key.budget)}`);
    if (data.accountBalance && typeof data.accountBalance.total === 'number') {
      const ab = data.accountBalance;
      const parts = [`Total ${formatUsd(ab.total)}`];
      if (typeof ab.tier === 'number') parts.push(`Quest ${formatUsd(ab.tier)}`);
      if (typeof ab.paid === 'number') parts.push(`Paid ${formatUsd(ab.paid)}`);
      keyParts.push(parts.join(' · '));
    }
    const keyInfoEl = document.getElementById('usage-key-info');
    if (keyInfoEl) keyInfoEl.innerHTML = keyParts.join('<br>');

    // Today's stats
    const today = data.today || {};
    setText('usage-today-req', today.requests ?? 0);
    setText('usage-today-cost', formatUsd(today.costUsd ?? 0));
    setText('usage-avg-ms', formatMs(today.avgMs));
    setText('usage-total-req', formatUsd(data.total?.costUsd ?? 0));

    // Recent requests
    const list = document.getElementById('usage-recent-list');
    if (list) {
      const items = Array.isArray(data.recent) ? data.recent : [];
      if (!items.length) {
        list.innerHTML = '<span class="usage-empty">Abhi koi usage nahi hai.</span>';
      } else {
        list.innerHTML = items.map((x) => {
          const model = String(x.model || '').split('/').pop();
          const time = String(x.timestamp || '').slice(11, 16);
          return `<div class="usage-recent-item">
            <span class="usage-recent-model">${model || 'request'}</span>
            <span class="usage-recent-meta">
              <span>${time}</span>
              <span>${formatMs(x.ms)}</span>
              <span>${formatUsd(x.costUsd)}</span>
            </span>
          </div>`;
        }).join('');
      }
    }
  } catch (err) {
    console.error('Failed to load AI usage:', err);
    balanceEl.textContent = '—';
  }
}

// 3. Load & Render Bots
async function loadBots() {
  try {
    const res = await authFetch('/api/bots');
    appState.bots = await res.json();

    botsCountBadge.textContent = appState.bots.length;

    const restoreBanner = document.getElementById('local-restore-banner');
    if (appState.bots.length === 0) {
      botsGrid.innerHTML = '';
      noBotsCard.style.display = 'block';

      // Check if browser has backup saved
      const localBackup = localStorage.getItem('ai_gf_bots_backup');
      if (localBackup && restoreBanner) {
        try {
          const parsed = JSON.parse(localBackup);
          if (Array.isArray(parsed) && parsed.length > 0) {
            restoreBanner.style.display = 'flex';
          }
        } catch (_) {}
      }
    } else {
      noBotsCard.style.display = 'none';
      if (restoreBanner) restoreBanner.style.display = 'none';
      // Save local backup in browser
      localStorage.setItem('ai_gf_bots_backup', JSON.stringify(appState.bots));
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
    const res = await authFetch(`/api/bots/${id}/start`, { method: 'POST' });
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
    const res = await authFetch(`/api/bots/${id}/stop`, { method: 'POST' });
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
    const res = await authFetch(`/api/bots/${id}/restart`, { method: 'POST' });
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
    const res = await authFetch(`/api/bots/${id}`, { method: 'DELETE' });
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
    const res = await authFetch(`/api/bots/${botId}/simulate`);
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
    const userDiv = document.createElement('div');
    userDiv.className = 'sim-msg user';
    userDiv.innerHTML = `<div class="msg-bubble">${escapeHtml(text)}</div>`;
    container.appendChild(userDiv);

    const typingDiv = document.createElement('div');
    typingDiv.className = 'sim-msg model';
    typingDiv.innerHTML = `<div class="msg-bubble"><em>typing... ❤️</em></div>`;
    container.appendChild(typingDiv);
    container.scrollTop = container.scrollHeight;

    try {
      const res = await authFetch(`/api/bots/${botId}/simulate`, {
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
      errDiv.innerHTML = `<div class="msg-bubble" style="color:#f87171;">⚠️ ${err.message}</div>`;
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
    await authFetch(`/api/bots/${botId}/simulate`, { method: 'DELETE' });
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

  async function refreshStudioAccess() {
    const banner = document.getElementById('studio-referral-banner');
    const text = document.getElementById('studio-referral-text');
    const codeEl = document.getElementById('studio-referral-code');
    if (currentRole() !== 'user') {
      if (banner) banner.style.display = 'none';
      return true;
    }
    try {
      const res = await authFetch('/api/user/me');
      const me = await res.json();
      const until = me.studioAccessUntil ? new Date(me.studioAccessUntil) : null;
      if (until && until > new Date()) {
        if (banner) banner.style.display = 'none';
        return true;
      }
      if (banner) {
        banner.style.display = 'block';
        if (text) text.textContent = `Persona Studio locked. 2 referrals chahiye (5 referrals = 4 days access). Aapke referrals: ${me.referralCount || 0}`;
        if (codeEl) codeEl.innerHTML = `Aapka referral code: <strong>${me.referralCode}</strong><br>Link: <code>${window.location.origin}?ref=${me.referralCode}</code>`;
      }
      return false;
    } catch (_) {
      return true;
    }
  }
  refreshStudioAccess();

  btnGen.addEventListener('click', async () => {
    const idea = input.value.trim();
    if (!idea) {
      alert("Please enter a character idea first!");
      return;
    }

    if (currentRole() === 'user') {
      const ok = await refreshStudioAccess();
      if (!ok) {
        alert("Persona Studio locked. Pehle 2 referrals lao (5 referrals = 4 days access).");
        return;
      }
    }

    btnGen.textContent = "Crafting Persona...";
    btnGen.disabled = true;

    try {
      const res = await authFetch('/api/ai/craft-persona', {
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
        const engineHint = document.getElementById('studio-engine-hint');
        if (engineHint) {
          engineHint.textContent = data.engine === 'gemini'
            ? '⚡ AI Engine: Google Gemini'
            : '⚡ AI Engine: Pollinations.AI';
        }
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

async function updateBroadcastReach() {
  const select = document.getElementById('broadcast-bot-select');
  const targetSelect = document.getElementById('broadcast-target');
  const estimate = document.getElementById('broadcast-reach-estimate');
  const hint = document.getElementById('broadcast-target-hint');
  const bot = appState.bots.find(b => b.id === select.value);
  const target = targetSelect?.value || 'users';

  if (!bot) return;

  if (target === 'channel') {
    estimate.textContent = '📣 Channel/Group post — saare members ko ek saath milega';
    if (hint) hint.textContent = 'Ek post me poore channel ke members tak message pahunch jayega. Bot ko us channel me admin banana hoga.';
    return;
  }

  if (hint) hint.textContent = 'Telegram bot sirf un users ko message kar sakta hai jinhone /start kiya ho. Neeche actual stored count hai.';
  estimate.textContent = 'Audience load ho raha hai…';

  try {
    const res = await authFetch(`/api/bots/${bot.id}/audience`);
    const data = await res.json();
    const name = bot.settings?.name || bot.id;
    estimate.textContent = `Target Audience: ${data.reachable || 0} users of ${name} (${data.blocked || 0} blocked/unreachable)`;
    if (hint) {
      hint.textContent = data.cloudBackup
        ? 'Telegram bot sirf un users ko message kar sakta hai jinhone /start kiya ho. Audience cloud me backed up hai.'
        : '⚠️ Audience cloud me save nahi ho rahi (GITHUB_TOKEN missing) — redeploy pe chat IDs delete ho sakti hain.';
    }
  } catch (_) {
    estimate.textContent = `Target Audience: ~${bot.stats?.activeUsers || 0} users`;
  }
}

window.setBroadcastText = (text) => {
  document.getElementById('broadcast-message-text').value = text;
};

function setupBroadcast() {
  const select = document.getElementById('broadcast-bot-select');
  const targetSelect = document.getElementById('broadcast-target');
  const channelGroup = document.getElementById('broadcast-channel-group');
  const channelInput = document.getElementById('broadcast-channel-id');

  const syncTargetUi = () => {
    const isChannel = targetSelect.value === 'channel';
    if (channelGroup) channelGroup.style.display = isChannel ? 'block' : 'none';
    updateBroadcastReach();
  };

  select.addEventListener('change', updateBroadcastReach);
  targetSelect.addEventListener('change', syncTargetUi);
  syncTargetUi();

  const btnSend = document.getElementById('btn-send-broadcast');
  const messageInput = document.getElementById('broadcast-message-text');
  const resultBox = document.getElementById('broadcast-result-box');

  btnSend.addEventListener('click', async () => {
    const botId = select.value;
    const message = messageInput.value.trim();
    const target = targetSelect.value;
    const chatId = (channelInput?.value || '').trim();

    if (!botId) {
      alert("Please select a bot first!");
      return;
    }
    if (!message) {
      alert("Please type a message to broadcast!");
      return;
    }
    if (target === 'channel' && !chatId) {
      alert("Channel username ya chat ID daalein (jaise @yourchannel)");
      return;
    }

    const confirmText = target === 'channel'
      ? `Channel/group ${chatId} me ye post bhejein? Saare members dekhenge.`
      : "Ye message sabhi stored bot users ko bhejna hai?";
    if (!confirm(confirmText)) return;

    btnSend.textContent = "Sending...";
    btnSend.disabled = true;

    try {
      const res = await authFetch(`/api/bots/${botId}/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, target, chatId })
      });
      const data = await res.json();

      if (res.ok) {
        resultBox.style.display = 'block';
        if (target === 'channel') {
          resultBox.innerHTML = `✅ <strong>Channel post sent!</strong> ${data.chatId || chatId} ke saare members ko message chala gaya.`;
        } else {
          const skipped = data.skipped ? `, ${data.skipped} skipped` : '';
          resultBox.innerHTML = `✅ <strong>Broadcast Complete!</strong> Delivered to <strong>${data.sent}</strong> users (${data.failed} failed${skipped}).`;
        }
        showToast("Broadcast finished successfully!", "success");
        updateBroadcastReach();
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
    const res = await authFetch(`/api/bots/${botId}/users`);
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
    const res = await authFetch(`/api/bots/${botId}/users/${userId}/history`);
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

    await authFetch(`/api/bots/${botId}/users/${userId}/history`, { method: 'DELETE' });
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
        const res = await authFetch('/api/backup/import', {
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

  const verifySection = document.getElementById('modal-verify-section');
  const verifyInput = document.getElementById('modal-telegram-id');
  const verifyBtn = document.getElementById('btn-verify-telegram');
  const verifyStatus = document.getElementById('modal-verify-status');
  const groupLink = document.getElementById('modal-group-link');
  let telegramVerifiedForUser = false;

  async function refreshVerificationState() {
    const geminiGroup = document.getElementById('modal-gemini-key-group');
    if (currentRole() !== 'user') {
      verifySection.style.display = 'none';
      if (geminiGroup) geminiGroup.style.display = 'none';
      telegramVerifiedForUser = true;
      return true;
    }
    if (geminiGroup) geminiGroup.style.display = 'block';
    try {
      const res = await authFetch('/api/user/me');
      const me = await res.json();
      if (me.groupLink && groupLink) {
        groupLink.href = me.groupLink;
        groupLink.textContent = me.requiredGroup || '@gfopiu';
      }
      if (me.telegramVerified) {
        telegramVerifiedForUser = true;
        verifySection.style.display = 'none';
        return true;
      }
    } catch (_) {}
    telegramVerifiedForUser = false;
    verifySection.style.display = 'block';
    return false;
  }

  if (verifyBtn) {
    verifyBtn.addEventListener('click', async () => {
      const telegramId = verifyInput.value.trim();
      if (!telegramId) {
        verifyStatus.className = 'verify-status err';
        verifyStatus.textContent = 'Telegram user ID daalein.';
        return;
      }
      verifyBtn.disabled = true;
      verifyBtn.textContent = 'Checking…';
      try {
        const res = await authFetch('/api/user/verify-telegram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ telegramId })
        });
        const data = await res.json();
        if (res.ok) {
          telegramVerifiedForUser = true;
          verifyStatus.className = 'verify-status ok';
          verifyStatus.textContent = '✅ Verified! Ab bot connect kar sakte hain.';
          setTimeout(() => { verifySection.style.display = 'none'; }, 1000);
        } else {
          verifyStatus.className = 'verify-status err';
          verifyStatus.textContent = data.error || 'Verification failed';
          if (data.groupLink && groupLink) groupLink.href = data.groupLink;
        }
      } catch (e) {
        verifyStatus.className = 'verify-status err';
        verifyStatus.textContent = e.message;
      } finally {
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Verify';
      }
    });
  }

  window.openAddBotModal = async () => {
    addBotModal.style.display = 'flex';
    document.getElementById('modal-bot-token').value = '';
    document.getElementById('modal-bot-name').value = '';
    if (verifyInput) verifyInput.value = '';
    if (verifyStatus) verifyStatus.textContent = '';
    document.getElementById('modal-bot-token').focus();
    await refreshVerificationState();
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

    if (currentRole() === 'user' && !telegramVerifiedForUser) {
      alert("Pehle Telegram verify karein — group join karke apna user ID daalein.");
      verifySection.style.display = 'block';
      return;
    }

    spinner.style.display = 'inline-block';
    btnSubmit.disabled = true;

    try {
      const modalProviderEl = document.getElementById('modal-bot-provider');
      let aiProvider = modalProviderEl ? modalProviderEl.value : 'pollinations';
      const customSettings = { ...(appState.pendingCustomSettings || {}) };
      if (currentRole() === 'user') {
        const geminiKeyInput = document.getElementById('modal-gemini-key');
        const geminiKey = geminiKeyInput ? geminiKeyInput.value.trim() : '';
        if (!geminiKey) {
          alert("Gemini API Key required. Apna Gemini key daalein (aistudio.google.com/apikey).");
          spinner.style.display = 'none';
          btnSubmit.disabled = false;
          return;
        }
        customSettings.geminiApiKey = geminiKey;
        customSettings.aiProvider = 'gemini';
        aiProvider = 'gemini';
      } else {
        customSettings.aiProvider = aiProvider;
      }
      const res = await authFetch('/api/bots', {
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
        if (data.requiresTelegram) {
          verifySection.style.display = 'block';
          if (data.groupLink && groupLink) groupLink.href = data.groupLink;
        }
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

  const btnAutoRestore = document.getElementById('btn-auto-restore-bots');
  if (btnAutoRestore) {
    btnAutoRestore.addEventListener('click', async () => {
      const localBackup = localStorage.getItem('ai_gf_bots_backup');
      if (!localBackup) return;
      try {
        const parsed = JSON.parse(localBackup);
        btnAutoRestore.disabled = true;
        btnAutoRestore.textContent = "Restoring...";
        for (const b of parsed) {
          if (b.token) {
            await authFetch('/api/bots', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                token: b.token,
                name: b.settings?.name,
                preset: b.settings?.preset || 'sweet_loving',
                autoStart: true,
                customSettings: {
                  ...b.settings,
                  aiProvider: b.aiProvider || 'pollinations'
                }
              })
            });
          }
        }
        showToast("Bots successfully restored from browser memory!", "success");
        await loadBots();
      } catch (e) {
        alert("Restore failed: " + e.message);
      } finally {
        btnAutoRestore.disabled = false;
        btnAutoRestore.textContent = "🔄 1-Click Restore Bots";
      }
    });
  }
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
  const providerEl = document.getElementById('edit-bot-provider');
  if (providerEl) providerEl.value = bot.aiProvider || 'pollinations';
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

    const providerEl = document.getElementById('edit-bot-provider');
    const updates = {
      aiProvider: providerEl ? providerEl.value : 'pollinations',
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
      const res = await authFetch(`/api/bots/${appState.selectedBotId}`, {
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

// 11. AI Bot Copilot (Powered by Pollinations.AI / Gemini)
function syncCopilotSelect() {
  const select = document.getElementById('copilot-target-bot');
  if (!select) return;
  select.innerHTML = '';

  // Allow creating brand new bot persona
  const optNew = document.createElement('option');
  optNew.value = '__new__';
  optNew.textContent = '✨ + Naya Bot Banayein (Create New Bot)';
  select.appendChild(optNew);

  appState.bots.forEach(bot => {
    const opt = document.createElement('option');
    opt.value = bot.id;
    opt.textContent = `🤖 ${bot.settings?.name || bot.id} (${bot.info?.username ? '@' + bot.info.username : bot.status})`;
    select.appendChild(opt);
  });

  if (appState.selectedBotId && appState.bots.some(b => b.id === appState.selectedBotId)) {
    select.value = appState.selectedBotId;
  } else if (appState.bots.length > 0) {
    select.value = appState.bots[0].id;
  } else {
    select.value = '__new__';
  }
}

window.setCopilotPrompt = (text) => {
  const input = document.getElementById('copilot-instruction');
  if (input) {
    input.value = text;
    input.focus();
  }
};

let lastCopilotResult = null;

// Pollinations label depends on whether an API key is configured
function pollinationsEngineLabel() {
  const hasKey = Boolean(appState.config && appState.config.hasPollinationsKey);
  return hasKey
    ? '🌸 Engine: Pollinations.AI (key active — no 45s limit)'
    : '⚠️ Engine: Pollinations.AI free tier (1 reply / 45s — add key in Settings)';
}

function setupCopilot() {
  const btnRun = document.getElementById('btn-run-copilot');
  const spinner = document.getElementById('copilot-spinner');
  const instructionInput = document.getElementById('copilot-instruction');
  const resultBox = document.getElementById('copilot-result');
  const explanationEl = document.getElementById('copilot-explanation');
  const updatedPromptEl = document.getElementById('copilot-updated-prompt');
  const providerSelect = document.getElementById('copilot-provider-select');
  const indicator = document.getElementById('copilot-status-indicator');
  const btnLaunch = document.getElementById('btn-copilot-launch-bot');
  const btnOpenSim = document.getElementById('btn-copilot-open-sim');
  const badgeEl = document.getElementById('copilot-result-badge');

  // Pollinations in Copilot: removed for users; admin keeps all options
  if (providerSelect) {
    if (currentRole() !== 'admin') {
      const pollOpt = providerSelect.querySelector('option[value="pollinations"]');
      if (pollOpt) pollOpt.remove();
      if (providerSelect.value === 'pollinations') providerSelect.value = 'auto';
    }
  }

  if (indicator && providerSelect) {
    const p = providerSelect.value;
    if (p === 'pollinations') indicator.textContent = pollinationsEngineLabel();
    else if (p === 'gemini') indicator.textContent = '⚡ Engine: Google Gemini API';
    else indicator.textContent = '🔄 Engine: Auto (Gemini Primary + Pollinations Fallback)';
  }

  if (providerSelect && indicator) {
    providerSelect.addEventListener('change', () => {
      const p = providerSelect.value;
      if (p === 'pollinations') {
        indicator.textContent = pollinationsEngineLabel();
      } else if (p === 'gemini') {
        indicator.textContent = '⚡ Engine: Google Gemini API';
      } else {
        indicator.textContent = '🔄 Engine: Auto (Gemini Primary + Pollinations Fallback)';
      }
    });
  }

  btnRun.addEventListener('click', async () => {
    const botId = document.getElementById('copilot-target-bot').value;
    const instruction = instructionInput.value.trim();
    const provider = providerSelect ? providerSelect.value : 'pollinations';

    if (!instruction) {
      alert("Kripya AI Copilot ke liye instructions likhein!");
      return;
    }

    spinner.style.display = 'inline-block';
    btnRun.disabled = true;

    try {
      const res = await authFetch('/api/ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId, instruction, provider })
      });
      const data = await res.json();

      if (res.ok) {
        lastCopilotResult = data;
        resultBox.style.display = 'block';
        explanationEl.textContent = data.explanation || "Changes applied successfully!";
        updatedPromptEl.textContent = JSON.stringify(data.updatedSettings, null, 2);

        if (data.isNew) {
          badgeEl.textContent = "✨ Naya Bot Persona Ready!";
          if (btnLaunch) {
            btnLaunch.style.display = 'inline-block';
            btnLaunch.textContent = `🚀 "${data.updatedSettings?.name || 'New Bot'}" Connect Karein`;
          }
          if (btnOpenSim) btnOpenSim.style.display = 'none';
          showToast(`Persona "${data.updatedSettings?.name || 'New Bot'}" Pollinations.AI dwara banaya gaya!`, "success");
        } else {
          badgeEl.textContent = "✅ Bot Settings Updated!";
          if (btnLaunch) btnLaunch.style.display = 'none';
          if (btnOpenSim) {
            btnOpenSim.style.display = 'inline-block';
          }
          showToast(`Bot "${data.targetLabel}" Pollinations.AI dwara update ho gaya!`, "success");
          await loadBots();
        }
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

  if (btnLaunch) {
    btnLaunch.addEventListener('click', () => {
      if (!lastCopilotResult?.updatedSettings) return;
      const s = lastCopilotResult.updatedSettings;
      appState.pendingCustomSettings = {
        name: s.name,
        systemPrompt: s.systemPrompt,
        relationshipVibe: s.relationshipVibe,
        temperature: s.temperature || 0.8,
        emojiUsage: s.emojiUsage || 'moderate',
        language: s.language || 'hinglish',
        aiProvider: 'pollinations'
      };

      if (window.openAddBotModal) window.openAddBotModal();
      document.getElementById('modal-bot-name').value = s.name || '';
      if (s.preset) document.getElementById('modal-bot-preset').value = s.preset;
      const modalProv = document.getElementById('modal-bot-provider');
      if (modalProv) modalProv.value = 'pollinations';
    });
  }

  if (btnOpenSim) {
    btnOpenSim.addEventListener('click', () => {
      const simTabBtn = document.querySelector('[data-tab="simulator"]');
      if (simTabBtn) simTabBtn.click();
    });
  }
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
    diagContent.innerHTML = "<em>Analyzing logs and error states with AI...</em>";
    diagActions.innerHTML = "";

    try {
      const res = await authFetch('/api/ai/diagnose', {
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
    const res = await authFetch('/api/ai/auto-fix', {
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
      await authFetch('/api/config', {
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

// 13. Settings & Security
function setupSettings() {
  const btnSave = document.getElementById('btn-save-settings');
  const keyInput = document.getElementById('settings-gemini-key');
  const modelSelect = document.getElementById('settings-gemini-model');
  const providerSelect = document.getElementById('settings-ai-provider');
  const btnToggleVis = document.getElementById('btn-toggle-key-vis');
  const pollInput = document.getElementById('settings-pollinations-key');
  const btnTogglePollVis = document.getElementById('btn-toggle-poll-vis');
  const btnRefreshUsage = document.getElementById('btn-refresh-usage');

  if (btnRefreshUsage) {
    btnRefreshUsage.addEventListener('click', async () => {
      btnRefreshUsage.disabled = true;
      btnRefreshUsage.textContent = '⏳ Loading…';
      await loadUsage(true);
      btnRefreshUsage.disabled = false;
      btnRefreshUsage.textContent = '🔄 Refresh';
    });
  }

  btnToggleVis.addEventListener('click', () => {
    keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
  });

  if (btnTogglePollVis && pollInput) {
    btnTogglePollVis.addEventListener('click', () => {
      pollInput.type = pollInput.type === 'password' ? 'text' : 'password';
    });
  }

  btnSave.addEventListener('click', async () => {
    const geminiApiKey = keyInput.value.trim();
    const geminiModel = modelSelect.value;
    const aiProvider = providerSelect.value;

    const pollinationsApiKey = pollInput ? pollInput.value.trim() : '';
    const body = { geminiModel, aiProvider };
    if (geminiApiKey) body.geminiApiKey = geminiApiKey;
    if (pollinationsApiKey) body.pollinationsApiKey = pollinationsApiKey;

    try {
      const res = await authFetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        showToast("AI Engine settings saved successfully!", "success");
        keyInput.value = '';
        if (pollInput) pollInput.value = '';
        await loadConfig();
      } else {
        const data = await res.json();
        alert(`Error: ${data.error}`);
      }
    } catch (err) {
      alert(`Network error: ${err.message}`);
    }
  });

  // Admin credentials update
  const btnSaveCreds = document.getElementById('btn-save-admin-creds');
  const userInput = document.getElementById('settings-admin-user');
  const passInput = document.getElementById('settings-admin-pass');

  btnSaveCreds.addEventListener('click', async () => {
    const newUsername = userInput.value.trim();
    const newPassword = passInput.value.trim();

    if (!newPassword || newPassword.length < 4) {
      alert("Password must be at least 4 characters long!");
      return;
    }

    try {
      const res = await authFetch('/api/auth/change-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newUsername, newPassword })
      });
      const data = await res.json();
      if (res.ok) {
        showToast("Admin credentials updated! Please login again.", "success");
        localStorage.removeItem('adminToken');
        setTimeout(() => showLoginScreen(), 1500);
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
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
