import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const CONV_FILE = path.join(DATA_DIR, 'conversations.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

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

const DEFAULT_CONFIG = {
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: "gemini-3.5-flash-lite",
  autoHealEnabled: true,
  maxLogEntries: 200,
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
    this.conversations = readJsonSafe(CONV_FILE, {});
    this.users = readJsonSafe(USERS_FILE, {}); // key: `${botId}:${userId}` -> profile
    this.simulations = {}; // in-memory simulator sessions per bot
    this.recentLogs = [];
  }

  getConfig() {
    return this.config;
  }

  saveConfig() {
    writeJsonSafe(CONFIG_FILE, this.config);
  }

  setGeminiApiKey(key) {
    this.config.geminiApiKey = key.trim();
    this.saveConfig();
  }

  setGeminiModel(model) {
    this.config.geminiModel = model.trim();
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

    // Replace default names in preset prompt with custom name
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

    // Clean up conversation memory & users for this bot
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

    // Update activeUsers count on bot
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

  saveUsersDebounced() {
    if (this._usersTimer) return;
    this._usersTimer = setTimeout(() => {
      this._usersTimer = null;
      writeJsonSafe(USERS_FILE, this.users);
    }, 2000);
  }

  // Conversation history handling
  getConversation(botId, userId) {
    const key = `${botId}:${userId}`;
    if (!this.conversations[key]) {
      this.conversations[key] = [];
    }
    return this.conversations[key];
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
