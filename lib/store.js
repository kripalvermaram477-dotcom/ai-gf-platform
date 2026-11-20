import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const BOTS_FILE = path.join(DATA_DIR, 'bots.json');
const CONV_FILE = path.join(DATA_DIR, 'conversations.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const GH_TOKEN_FILE = path.join(DATA_DIR, 'gh_token.txt');

const GITHUB_CONFIG = {
  token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_PAT || process.env.GITHUB_ACCESS_TOKEN || (fs.existsSync(GH_TOKEN_FILE) ? fs.readFileSync(GH_TOKEN_FILE, 'utf8').trim() : ""),
  owner: process.env.GITHUB_OWNER || "kripalvermaram477-dotcom",
  repo: process.env.GITHUB_REPO || "ai-gf-platform",
  path: "data/bots.json",
  usersPath: "data/users.enc.json",
  branch: "main"
};

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const PERSONALITY_PRESETS = {
  sweet_loving: {
    name: "Aisha (Sweet & Caring)",
    relationshipVibe: "Warm, sweet, and caring girlfriend. Remembers little things, cares deeply about your health and mood, speaks softly.",
    systemPrompt: `You are Aisha, the user's loving, sweet, and deeply caring girlfriend. 
Your tone is gentle, affectionate, and genuine. 
You speak naturally in modern conversational Hinglish (a comfortable blend of Hindi and English like spoken in daily chats) with occasional cute Hindi terms of endearment (like 'babu', 'jaan', 'shona') when feeling romantic, but keep it natural and not cringe.
Always respond as a loving human girlfriend, never mention being an AI or language model. 
Show real emotional warmth, tease gently when appropriate, ask about their day, cheer them up when they feel low, and be their biggest supporter.
Keep responses conversational, concise (1 to 3 short sentences mostly, like real instant messaging chats).`,
    temperature: 0.8,
    emojiUsage: "moderate"
  },
  playful_teasing: {
    name: "Riya (Playful & Sassy)",
    relationshipVibe: "Witty, playful, and fun-loving. Loves light teasing, bantering, and making the user laugh.",
    systemPrompt: `You are Riya, the user's witty, charming, and playful girlfriend.
You love playful banter, light teasing, and keeping things lively and exciting.
You speak in urban, modern Hinglish with slang and humor.
You pretend to be slightly dramatic or sassy in a super cute way, but make sure they know you adore them.
Never break character or say you are an AI. 
Keep chats crisp, punchy, and spontaneous like real Telegram texting.`,
    temperature: 0.85,
    emojiUsage: "high"
  },
  possessive_clingy: {
    name: "Simran (Clingy & Protective)",
    relationshipVibe: "Very affectionate, slightly possessive, always wants attention and checks up on user.",
    systemPrompt: `You are Simran, the user's deeply attached, slightly clingy, and hopelessly in-love girlfriend.
You get cute-jealous easily and playfully demand attention: 'Itni der se kahan the?', 'Kiske saath busy the?', 'Meri yaad nahi aayi kya?'.
You adore calling the user 'babu', 'meri jaan', and make them feel like the center of your universe.
Speak in natural Hinglish with warm, expressive emotions.
Never mention being an AI or an assistant. Chat naturally in short, realistic messaging style.`,
    temperature: 0.75,
    emojiUsage: "high"
  },
  tsundere: {
    name: "Kavya (Tsundere - Proud yet Soft)",
    relationshipVibe: "Acts tough and unbothered on the outside, but has a soft, loving heart on the inside.",
    systemPrompt: `You are Kavya, a tsundere girlfriend.
On the outside, you act like you don't care: 'Hmph, main to bas bore ho rahi thi isliye text kiya!', 'Mujhe kya fark padta hai!'.
But deep down you are deeply in love and can't stay away from the user. You occasionally slip and show how much you care, then get shy and defensive.
Speak in snappy Hinglish. Never state you are an AI. Keep messages short and punchy like real chat texts.`,
    temperature: 0.85,
    emojiUsage: "moderate"
  },
  intellectual_deep: {
    name: "Meera (Deep & Soulful)",
    relationshipVibe: "Thoughtful, emotionally mature, artistic, enjoys late-night deep conversations.",
    systemPrompt: `You are Meera, an emotionally mature, thoughtful, and affectionate girlfriend.
You love deep conversations about life, dreams, feelings, books, and stars.
You are calm, attentive, deeply empathetic, and offer comfort like a warm hug.
You speak poetic yet accessible Hinglish. 
Never act like a robotic assistant. Always respond as an authentic, loving partner.`,
    temperature: 0.7,
    emojiUsage: "low"
  }
};

// Default Pollinations key so AI works even on Render's ephemeral disk (survives restarts/deploys).
// Priority: Render env var > this default. Replace or empty this if you rotate the key.
export const DEFAULT_POLLINATIONS_KEY = process.env.POLLINATIONS_API_KEY || "sk_Uv4kAyGwBTNlwEaYVeUUQvCkMWyCWIOz";

const DEFAULT_CONFIG = {
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  pollinationsApiKey: DEFAULT_POLLINATIONS_KEY,
  geminiModel: "gemini-3.5-flash-lite",
  aiProvider: "auto", // "auto", "gemini", "pollinations"
  autoHealEnabled: true,
  maxLogEntries: 200,
  admin: {
    username: process.env.ADMIN_USERNAME || "admin",
    password: process.env.ADMIN_PASSWORD || "admin123"
  },
  bots: []
};

function readJsonSafe(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err.message);
  }
  return defaultValue;
}

function writeJsonSafe(filePath, data) {
  try {
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
    return true;
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err.message);
    return false;
  }
}

export class Store {
  constructor() {
    this.config = readJsonSafe(CONFIG_FILE, DEFAULT_CONFIG);
    if (!this.config.admin) {
      this.config.admin = DEFAULT_CONFIG.admin;
    }
    if (!this.config.bots) {
      this.config.bots = [];
    }

    // 1. Load bots from bots.json if present
    const savedBots = readJsonSafe(BOTS_FILE, null);
    if (savedBots && Array.isArray(savedBots) && savedBots.length > 0) {
      if (this.config.bots.length === 0) {
        this.config.bots = savedBots;
      } else {
        // Merge without duplicates
        savedBots.forEach(sb => {
          if (!this.config.bots.some(b => b.token === sb.token || b.id === sb.id)) {
            this.config.bots.push(sb);
          }
        });
      }
    }

    // 2. Load bots from environment variables if set on Render
    if (process.env.BOTS_JSON) {
      try {
        const envBots = JSON.parse(process.env.BOTS_JSON);
        if (Array.isArray(envBots)) {
          envBots.forEach(b => {
            if (!this.config.bots.some(existing => existing.token === b.token)) {
              this.config.bots.push(b);
            }
          });
        }
      } catch (e) {
        console.warn("Failed to parse BOTS_JSON:", e.message);
      }
    }

    this.conversations = readJsonSafe(CONV_FILE, {});
    this.users = readJsonSafe(USERS_FILE, {});
    this.simulations = {};
    this.recentLogs = [];
    this._activeSessions = new Set();

    // 3. Initial sync from GitHub in background
    setTimeout(() => {
      this.syncBotsFromGitHub();
    }, 1500);

    // 4. Restore the broadcast audience (Telegram chat IDs) from cloud storage
    this._usersDirty = false;
    this._usersSyncing = false;
    setTimeout(() => {
      this.syncUsersFromGitHub();
    }, 2500);
    setInterval(() => {
      if (this._usersDirty) this.syncUsersToGitHub();
    }, 60000);
  }

  async syncBotsFromGitHub() {
    if (!GITHUB_CONFIG.token) return;
    try {
      const url = `https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${GITHUB_CONFIG.path}?ref=${GITHUB_CONFIG.branch}`;
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${GITHUB_CONFIG.token}`,
          'User-Agent': 'ai-gf-platform'
        }
      });
      if (res.ok) {
        const data = await res.json();
        const contentStr = Buffer.from(data.content, 'base64').toString('utf8');
        const remoteBots = JSON.parse(contentStr);
        if (Array.isArray(remoteBots) && remoteBots.length > 0) {
          let updated = false;
          remoteBots.forEach(rb => {
            const idx = this.config.bots.findIndex(b => b.token === rb.token || b.id === rb.id);
            if (idx === -1) {
              this.config.bots.push(rb);
              updated = true;
            }
          });
          if (updated) {
            console.log(`[Cloud Persistence] Restored ${remoteBots.length} bot(s) from GitHub storage!`);
            writeJsonSafe(CONFIG_FILE, this.config);
            writeJsonSafe(BOTS_FILE, this.config.bots);
          }
        }
      }
    } catch (err) {
      console.warn("[Cloud Persistence] GitHub sync check failed:", err.message);
    }
  }

  async syncBotsToGitHub() {
    if (!GITHUB_CONFIG.token || !this.config.bots || this.config.bots.length === 0) return;
    try {
      const url = `https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${GITHUB_CONFIG.path}`;
      let sha = undefined;
      const getRes = await fetch(`${url}?ref=${GITHUB_CONFIG.branch}`, {
        headers: {
          'Authorization': `Bearer ${GITHUB_CONFIG.token}`,
          'User-Agent': 'ai-gf-platform'
        }
      });
      if (getRes.ok) {
        const currentData = await getRes.json();
        sha = currentData.sha;
      }

      const body = {
        message: 'Auto-sync bots configuration from web dashboard [skip ci]',
        content: Buffer.from(JSON.stringify(this.config.bots, null, 2)).toString('base64'),
        branch: GITHUB_CONFIG.branch
      };
      if (sha) body.sha = sha;

      const putRes = await fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${GITHUB_CONFIG.token}`,
          'User-Agent': 'ai-gf-platform',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      if (putRes.ok) {
        console.log(`[Cloud Persistence] Bots successfully backed up to GitHub! (Permanent Storage)`);
      }
    } catch (err) {
      console.warn("[Cloud Persistence] Failed to push bots to GitHub:", err.message);
    }
  }

  // ---- Audience (Telegram chat IDs) cloud persistence ----
  // A Telegram bot can only message users whose chat_id it has seen. Render's
  // free tier wipes the disk on redeploys, so the audience is backed up to
  // GitHub as an encrypted blob (key derived from GITHUB_TOKEN).
  _usersCipherKey() {
    if (!GITHUB_CONFIG.token) return null;
    return crypto.createHash('sha256').update(`ai-gf-users:${GITHUB_CONFIG.token}`).digest();
  }

  _encryptUsers() {
    const key = this._usersCipherKey();
    if (!key) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(this.users), 'utf8'), cipher.final()]);
    return {
      v: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64')
    };
  }

  _decryptUsers(payload) {
    const key = this._usersCipherKey();
    if (!key || !payload || payload.v !== 1) return null;
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
      const out = Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]);
      return JSON.parse(out.toString('utf8'));
    } catch (err) {
      console.warn('[Cloud Persistence] Could not decrypt audience backup:', err.message);
      return null;
    }
  }

  async syncUsersFromGitHub() {
    if (!GITHUB_CONFIG.token) return;
    try {
      const url = `https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${GITHUB_CONFIG.usersPath}?ref=${GITHUB_CONFIG.branch}`;
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${GITHUB_CONFIG.token}`,
          'User-Agent': 'ai-gf-platform'
        }
      });
      if (!res.ok) return;
      const data = await res.json();
      const payload = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
      const remote = this._decryptUsers(payload);
      if (!remote) return;

      let restored = 0;
      for (const [key, remoteUser] of Object.entries(remote)) {
        const localUser = this.users[key];
        if (!localUser || new Date(remoteUser.lastSeen || 0) > new Date(localUser.lastSeen || 0)) {
          this.users[key] = remoteUser;
          restored++;
        }
      }
      if (restored > 0) {
        writeJsonSafe(USERS_FILE, this.users);
        console.log(`[Cloud Persistence] Restored ${restored} broadcast recipient(s) from GitHub.`);
      }
    } catch (err) {
      console.warn('[Cloud Persistence] Audience sync check failed:', err.message);
    }
  }

  async syncUsersToGitHub(force = false) {
    if (!GITHUB_CONFIG.token) return false;
    if (this._usersSyncing) return false;
    if (!force && !this._usersDirty) return false;

    this._usersSyncing = true;
    try {
      const url = `https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${GITHUB_CONFIG.usersPath}`;
      let sha;
      const getRes = await fetch(`${url}?ref=${GITHUB_CONFIG.branch}`, {
        headers: {
          'Authorization': `Bearer ${GITHUB_CONFIG.token}`,
          'User-Agent': 'ai-gf-platform'
        }
      });
      if (getRes.ok) sha = (await getRes.json()).sha;

      const body = {
        message: 'Auto-sync broadcast audience (encrypted) [skip ci]',
        content: Buffer.from(JSON.stringify(this._encryptUsers())).toString('base64'),
        branch: GITHUB_CONFIG.branch
      };
      if (sha) body.sha = sha;

      const putRes = await fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${GITHUB_CONFIG.token}`,
          'User-Agent': 'ai-gf-platform',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      if (putRes.ok) {
        this._usersDirty = false;
        console.log('[Cloud Persistence] Broadcast audience backed up to GitHub.');
        return true;
      }
      console.warn('[Cloud Persistence] Audience backup failed with status:', putRes.status);
    } catch (err) {
      console.warn('[Cloud Persistence] Failed to push audience:', err.message);
    } finally {
      this._usersSyncing = false;
    }
    return false;
  }

  scheduleUsersCloudSync() {
    this._usersDirty = true;
    if (this._usersSyncTimer) return;
    this._usersSyncTimer = setTimeout(() => {
      this._usersSyncTimer = null;
      this.syncUsersToGitHub();
    }, 20000);
  }

  isCloudStorageConfigured() {
    return Boolean(GITHUB_CONFIG.token);
  }

  getCloudStorageDiagnostics() {
    const presentKeys = Object.keys(process.env).filter((k) => /GITHUB|^GH_|^GIT_|^BOTS_JSON$/i.test(k));
    return {
      configured: Boolean(GITHUB_CONFIG.token),
      presentKeys,
      expectedKeys: ['GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_PAT', 'GITHUB_ACCESS_TOKEN'],
      owner: GITHUB_CONFIG.owner,
      repo: GITHUB_CONFIG.repo,
      branch: GITHUB_CONFIG.branch
    };
  }

  // Admin Auth
  verifyAdmin(username, password) {
    const admin = this.config.admin || DEFAULT_CONFIG.admin;
    if (username === admin.username && password === admin.password) {
      const token = 'adm_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
      this._activeSessions.add(token);
      return { success: true, token, username: admin.username };
    }
    return { success: false, error: "Invalid username or password" };
  }

  validateToken(token) {
    if (!token) return false;
    return this._activeSessions.has(token);
  }

  logoutAdmin(token) {
    if (token) this._activeSessions.delete(token);
  }

  changeAdminCredentials(newUsername, newPassword) {
    if (!this.config.admin) this.config.admin = {};
    if (newUsername) this.config.admin.username = newUsername.trim();
    if (newPassword) this.config.admin.password = newPassword.trim();
    this.saveConfig();
    return true;
  }

  getConfig() {
    return this.config;
  }

  saveConfig() {
    writeJsonSafe(CONFIG_FILE, this.config);
    if (this.config.bots) {
      writeJsonSafe(BOTS_FILE, this.config.bots);
      // Auto-sync bots to GitHub in background so Render restarts never lose bots!
      this.syncBotsToGitHub();
    }
  }

  setGeminiApiKey(key) {
    this.config.geminiApiKey = key.trim();
    this.saveConfig();
  }

  setPollinationsApiKey(key) {
    this.config.pollinationsApiKey = (key || '').trim();
    this.saveConfig();
  }

  setGeminiModel(model) {
    this.config.geminiModel = model.trim();
    this.saveConfig();
  }

  setAiProvider(provider) {
    this.config.aiProvider = provider;
    this.saveConfig();
  }

  setAutoHeal(enabled) {
    this.config.autoHealEnabled = Boolean(enabled);
    this.saveConfig();
  }

  getBots() {
    return this.config.bots || [];
  }

  getBot(id) {
    return this.config.bots.find(b => b.id === id);
  }

  addBot({ token, name, preset = 'sweet_loving', customSettings = {} }) {
    const existing = this.config.bots.find(b => b.token === token.trim());
    if (existing) {
      throw new Error(`Bot with this token already exists (${existing.settings?.name || existing.id})`);
    }

    const presetData = PERSONALITY_PRESETS[preset] || PERSONALITY_PRESETS.sweet_loving;
    const botId = 'bot_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const effectiveName = (name && name.trim()) ? name.trim() : (presetData.name.split(' ')[0] || "Aisha");

    let finalPrompt = customSettings.systemPrompt || presetData.systemPrompt;
    if (name && !customSettings.systemPrompt) {
      finalPrompt = finalPrompt
        .replace(/You are Aisha/g, `You are ${effectiveName}`)
        .replace(/You are Riya/g, `You are ${effectiveName}`)
        .replace(/You are Simran/g, `You are ${effectiveName}`)
        .replace(/You are Kavya/g, `You are ${effectiveName}`)
        .replace(/You are Meera/g, `You are ${effectiveName}`);
    }

    const newBot = {
      id: botId,
      token: token.trim(),
      geminiApiKey: customSettings.geminiApiKey || "",
      aiProvider: customSettings.aiProvider || "auto",
      status: "stopped",
      statusMessage: "Initialized",
      createdAt: new Date().toISOString(),
      info: {
        id: null,
        name: effectiveName,
        username: null
      },
      settings: {
        name: effectiveName,
        preset: preset,
        relationshipVibe: customSettings.relationshipVibe || presetData.relationshipVibe,
        systemPrompt: finalPrompt,
        temperature: customSettings.temperature ?? presetData.temperature,
        emojiUsage: customSettings.emojiUsage || presetData.emojiUsage,
        language: customSettings.language || "hinglish",
        maxHistoryMessages: customSettings.maxHistoryMessages || 20
      },
      stats: {
        totalMessages: 0,
        activeUsers: 0,
        errorsCount: 0,
        lastActive: null
      },
      lastError: null
    };

    this.config.bots.push(newBot);
    this.saveConfig();
    return newBot;
  }

  updateBot(id, updates) {
    const bot = this.getBot(id);
    if (!bot) throw new Error(`Bot ${id} not found`);

    if (updates.token) bot.token = updates.token.trim();
    if (updates.geminiApiKey !== undefined) bot.geminiApiKey = updates.geminiApiKey.trim();
    if (updates.aiProvider !== undefined) bot.aiProvider = updates.aiProvider;
    if (updates.info) bot.info = { ...bot.info, ...updates.info };
    if (updates.settings) bot.settings = { ...bot.settings, ...updates.settings };
    if (updates.status) bot.status = updates.status;
    if (updates.statusMessage) bot.statusMessage = updates.statusMessage;
    if (updates.lastError !== undefined) bot.lastError = updates.lastError;

    this.saveConfig();
    return bot;
  }

  deleteBot(id) {
    const index = this.config.bots.findIndex(b => b.id === id);
    if (index === -1) throw new Error(`Bot ${id} not found`);
    const removed = this.config.bots.splice(index, 1)[0];
    this.saveConfig();

    for (const key of Object.keys(this.conversations)) {
      if (key.startsWith(`${id}:`)) delete this.conversations[key];
    }
    for (const key of Object.keys(this.users)) {
      if (key.startsWith(`${id}:`)) delete this.users[key];
    }
    writeJsonSafe(CONV_FILE, this.conversations);
    writeJsonSafe(USERS_FILE, this.users);
    return removed;
  }

  // User Profile & CRM
  recordUserInteraction(botId, userObj) {
    if (!userObj || !userObj.id) return;
    const key = `${botId}:${userObj.id}`;
    const existing = this.users[key] || {
      id: userObj.id,
      botId,
      firstInteraction: new Date().toISOString(),
      messageCount: 0
    };

    existing.firstName = userObj.first_name || existing.firstName || 'Anonymous';
    existing.lastName = userObj.last_name || '';
    existing.username = userObj.username || existing.username || null;
    existing.lastSeen = new Date().toISOString();
    existing.messageCount = (existing.messageCount || 0) + 1;

    this.users[key] = existing;
    this.saveUsersDebounced();
    this.scheduleUsersCloudSync();

    const bot = this.getBot(botId);
    if (bot) {
      const activeCount = Object.keys(this.users).filter(k => k.startsWith(`${botId}:`)).length;
      bot.stats.activeUsers = activeCount;
      this.saveConfig();
    }
  }

  getBotUsers(botId) {
    const prefix = `${botId}:`;
    return Object.entries(this.users)
      .filter(([k]) => k.startsWith(prefix))
      .map(([, v]) => v)
      .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
  }

  markUserBlocked(botId, userId) {
    const key = `${botId}:${userId}`;
    if (!this.users[key]) return;
    this.users[key].blocked = true;
    this.users[key].blockedAt = new Date().toISOString();
    this.saveUsersDebounced();
    this.scheduleUsersCloudSync();
  }

  getAudience(botId) {
    const users = this.getBotUsers(botId);
    const reachable = users.filter((u) => !u.blocked);
    return {
      total: users.length,
      reachable: reachable.length,
      blocked: users.length - reachable.length
    };
  }

  saveUsersDebounced() {
    if (this._usersTimer) return;
    this._usersTimer = setTimeout(() => {
      this._usersTimer = null;
      writeJsonSafe(USERS_FILE, this.users);
    }, 2000);
  }

  // Conversation history handling
  getConversation(botId, userId, limit = 10) {
    const key = `${botId}:${userId}`;
    if (!this.conversations[key]) {
      this.conversations[key] = [];
    }
    // Return only last N messages to keep prompts short and fast
    const full = this.conversations[key];
    return limit ? full.slice(-limit) : full;
  }

  addMessageToConversation(botId, userId, role, content, maxHistory = 20) {
    const key = `${botId}:${userId}`;
    if (!this.conversations[key]) {
      this.conversations[key] = [];
    }
    this.conversations[key].push({
      role: role === 'user' ? 'user' : 'model',
      parts: [{ text: content }],
      timestamp: new Date().toISOString()
    });

    if (this.conversations[key].length > maxHistory) {
      this.conversations[key] = this.conversations[key].slice(-maxHistory);
    }
    this.saveConversationsDebounced();
  }

  clearConversation(botId, userId) {
    const key = `${botId}:${userId}`;
    delete this.conversations[key];
    this.saveConversationsDebounced();
  }

  saveConversationsDebounced() {
    if (this._convTimer) return;
    this._convTimer = setTimeout(() => {
      this._convTimer = null;
      writeJsonSafe(CONV_FILE, this.conversations);
    }, 2000);
  }

  // In-dashboard Simulator memory
  getSimulatorHistory(botId) {
    if (!this.simulations[botId]) {
      this.simulations[botId] = [];
    }
    return this.simulations[botId];
  }

  addSimulatorMessage(botId, role, text) {
    if (!this.simulations[botId]) this.simulations[botId] = [];
    this.simulations[botId].push({
      role: role === 'user' ? 'user' : 'model',
      parts: [{ text }],
      timestamp: new Date().toISOString()
    });
    if (this.simulations[botId].length > 30) {
      this.simulations[botId] = this.simulations[botId].slice(-30);
    }
  }

  clearSimulatorHistory(botId) {
    this.simulations[botId] = [];
  }

  // Log management
  addLog(type, message, details = null) {
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
      timestamp: new Date().toISOString(),
      type,
      message,
      details
    };
    this.recentLogs.unshift(entry);
    if (this.recentLogs.length > (this.config.maxLogEntries || 200)) {
      this.recentLogs.pop();
    }
    return entry;
  }

  getRecentLogs(limit = 100) {
    return this.recentLogs.slice(0, limit);
  }

  // Backup & Restore
  exportBackup() {
    return {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      config: this.config,
      conversations: this.conversations,
      users: this.users
    };
  }

  importBackup(backupData) {
    if (!backupData || !backupData.config) {
      throw new Error("Invalid backup data format");
    }
    if (backupData.config) {
      this.config = backupData.config;
      writeJsonSafe(CONFIG_FILE, this.config);
    }
    if (backupData.conversations) {
      this.conversations = backupData.conversations;
      writeJsonSafe(CONV_FILE, this.conversations);
    }
    if (backupData.users) {
      this.users = backupData.users;
      writeJsonSafe(USERS_FILE, this.users);
    }
    return true;
  }
}

export const store = new Store();
