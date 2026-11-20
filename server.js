import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { store, PERSONALITY_PRESETS, DEFAULT_POLLINATIONS_KEY } from './lib/store.js';
import { geminiService } from './lib/gemini.js';
import { errorHealer } from './lib/error-healer.js';
import { botManager } from './lib/bot-manager.js';

dotenv.config();

// ================= GLOBAL CRASH GUARDS =================
// Ensure server NEVER dies from unhandled exceptions or rejected promises
process.on('uncaughtException', (err) => {
  console.error('[CRASH GUARD] Uncaught Exception caught safely:', err.message);
  try {
    errorHealer.log('error', `[Crash Guard] Caught uncaughtException: ${err.message}`, { stack: err.stack });
  } catch (_) {}
});

process.on('unhandledRejection', (reason) => {
  console.error('[CRASH GUARD] Unhandled Rejection caught safely:', reason);
  try {
    errorHealer.log('error', `[Crash Guard] Caught unhandledRejection: ${reason?.message || String(reason)}`);
  } catch (_) {}
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Set initial Gemini key if in env
if (process.env.GEMINI_API_KEY && !store.getConfig().geminiApiKey) {
  store.setGeminiApiKey(process.env.GEMINI_API_KEY);
}

// Load the Pollinations key (env or dashboard) into the AI engine at startup
{
  const cfg = store.getConfig();
  const pKey = cfg.pollinationsApiKey || process.env.POLLINATIONS_API_KEY || DEFAULT_POLLINATIONS_KEY || '';
  if (pKey) {
    geminiService.setPollinationsApiKey(pKey);
    console.log('[AI] Pollinations key loaded — 45s free limit disabled.');
  } else {
    console.warn('[AI] No Pollinations key found. Free tier limit applies (1 reply / 45s). Add it in Settings or set POLLINATIONS_API_KEY in Render.');
  }
}

// True if a Pollinations key is active from the dashboard config or Render env
function pollinationsKeyActive() {
  return Boolean(activePollinationsKey());
}

function activePollinationsKey() {
  return (store.getConfig().pollinationsApiKey || process.env.POLLINATIONS_API_KEY || DEFAULT_POLLINATIONS_KEY || '').trim();
}

// ================= AUTH MIDDLEWARE =================
const PUBLIC_API_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/verify',
  '/api/status',
  '/api/presets',
  '/api/user/register',
  '/api/user/login'
]);

function readAuth(req) {
  const authHeader = req.headers.authorization || req.headers['x-admin-token'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  return store.getTokenPayload(token);
}

function requireAdmin(req, res, next) {
  if (req.auth && req.auth.role === 'admin') return next();
  return res.status(403).json({ error: "Admin access required" });
}

function botAccess(req, res, next) {
  const bot = store.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: "Bot not found" });
  const isAdmin = req.auth?.role === 'admin';
  const isOwner = req.auth?.role === 'user' && (bot.owner || 'admin') === req.auth.username;
  if (!isAdmin && !isOwner) {
    return res.status(403).json({ error: "You do not have access to this bot" });
  }
  req.bot = bot;
  next();
}

app.use((req, res, next) => {
  // Public routes that don't need authentication
  if (!req.path.startsWith('/api') || PUBLIC_API_PATHS.has(req.path)) {
    return next();
  }

  req.auth = readAuth(req);
  if (req.auth) {
    return next();
  }

  return res.status(401).json({ error: "Unauthorized. Please login again." });
});

// ================= AUTH ROUTES =================
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }
  const result = store.verifyAdmin(username.trim(), password.trim());
  if (result.success) {
    errorHealer.log('info', `Admin logged in successfully (${username})`);
    return res.json(result);
  }
  res.status(401).json({ error: result.error });
});

app.get('/api/auth/verify', (req, res) => {
  const payload = readAuth(req);
  if (!payload) return res.json({ authenticated: false });
  res.json({
    authenticated: true,
    role: payload.role,
    username: payload.username
  });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-admin-token'] || req.headers.authorization?.slice(7);
  store.logoutAdmin(token);
  res.json({ success: true });
});

app.post('/api/auth/change-credentials', requireAdmin, (req, res) => {
  const { newUsername, newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: "Password must be at least 4 characters long" });
  }
  store.changeAdminCredentials(newUsername, newPassword);
  errorHealer.log('info', "Admin credentials updated.");
  res.json({ success: true, message: "Credentials updated successfully" });
});

// ================= USER ACCOUNT ROUTES =================
app.post('/api/user/register', async (req, res) => {
  try {
    const { username, password, ref } = req.body;
    const account = await store.registerUser({ username, password, ref });
    const token = store.issueAdminToken(account.username, 30, 'user');
    errorHealer.log('info', `New user registered: ${account.username}`);
    res.json({ success: true, token, role: 'user', account });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/user/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }
  const result = store.authenticateUser(username, password);
  if (!result.success) {
    return res.status(401).json({ error: result.error });
  }
  const token = store.issueAdminToken(result.account.username, 30, 'user');
  res.json({ success: true, token, role: 'user', account: result.account });
});

app.get('/api/user/me', (req, res) => {
  if (req.auth?.role !== 'user') {
    return res.status(403).json({ error: "User account required" });
  }
  const account = store.publicAccount(req.auth.username);
  if (!account) return res.status(404).json({ error: "Account not found" });
  res.json({
    ...account,
    requiredGroup: store.getConfig().requiredGroup || '@gfopiu',
    groupLink: `https://t.me/${(store.getConfig().requiredGroup || '@gfopiu').replace(/^@/, '')}`
  });
});

// ================= TELEGRAM GROUP VERIFICATION =================
async function checkGroupMembership(userId) {
  const group = store.getConfig().requiredGroup || '@gfopiu';
  const bots = store.getBots();
  let lastError = null;

  for (const b of bots) {
    if (!b.token) continue;
    try {
      const url = `https://api.telegram.org/bot${b.token}/getChatMember?chat_id=${encodeURIComponent(group)}&user_id=${encodeURIComponent(userId)}`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.ok) {
        const status = data.result?.status;
        return {
          ok: true,
          member: ['creator', 'administrator', 'member'].includes(status),
          status,
          group,
          verifiedBy: b.info?.username || b.id
        };
      }
      lastError = data.description || `HTTP ${response.status}`;
    } catch (err) {
      lastError = err.message;
    }
  }
  return { ok: false, error: lastError || 'No bot available to verify membership', group };
}

app.post('/api/user/verify-telegram', async (req, res) => {
  if (req.auth?.role !== 'user') {
    return res.status(403).json({ error: "User account required" });
  }

  const telegramId = String(req.body.telegramId || '').trim();
  if (!/^\d{5,20}$/.test(telegramId)) {
    return res.status(400).json({ error: "Valid numeric Telegram user ID required" });
  }

  const result = await checkGroupMembership(telegramId);
  const group = result.group || '@gfopiu';
  const groupLink = `https://t.me/${group.replace(/^@/, '')}`;

  if (!result.ok) {
    return res.status(502).json({ error: `Verification unavailable: ${result.error}` });
  }

  if (!result.member) {
    return res.status(403).json({
      error: `Aapne abhi ${group} join nahi kiya hai. Pehle join karein, phir Verify dabayein.`,
      requiresTelegram: true,
      groupLink
    });
  }

  const account = await store.setAccountTelegram(req.auth.username, {
    userId: telegramId,
    displayName: req.body.name || null
  });
  errorHealer.log('info', `User ${req.auth.username} verified via Telegram (${telegramId})`);

  res.json({ success: true, account, groupLink });
});

// ================= API ROUTES =================

// 1. Overall System Status
app.get('/api/status', (req, res) => {
  const bots = store.getBots();
  const runningBots = bots.filter(b => b.status === 'running').length;
  const config = store.getConfig();

  res.json({
    online: true,
    uptime: Math.floor(process.uptime()),
    runningBots,
    totalBots: bots.length,
    autoHealEnabled: config.autoHealEnabled,
    geminiConfigured: Boolean(config.geminiApiKey),
    pollinationsConfigured: pollinationsKeyActive(),
    githubConfigured: store.isCloudStorageConfigured(),
    memoryUsage: process.memoryUsage()
  });
});

// 2. Global Configuration
app.get('/api/config', requireAdmin, (req, res) => {
  const config = store.getConfig();
  res.json({
    geminiApiKey: config.geminiApiKey ? `${config.geminiApiKey.substring(0, 6)}...${config.geminiApiKey.slice(-4)}` : '',
    hasGeminiKey: Boolean(config.geminiApiKey),
    pollinationsApiKey: activePollinationsKey() ? `${activePollinationsKey().substring(0, 5)}...${activePollinationsKey().slice(-4)}` : '',
    hasPollinationsKey: pollinationsKeyActive(),
    geminiModel: config.geminiModel || 'gemini-3.5-flash-lite',
    aiProvider: config.aiProvider || 'auto',
    autoHealEnabled: config.autoHealEnabled,
    github: store.getCloudStorageDiagnostics()
  });
});

app.post('/api/config', requireAdmin, (req, res) => {
  const { geminiApiKey, pollinationsApiKey, geminiModel, aiProvider, autoHealEnabled } = req.body;
  if (geminiApiKey !== undefined && geminiApiKey !== '') {
    store.setGeminiApiKey(geminiApiKey);
    errorHealer.log('info', 'Gemini API Key updated.');
  }
  if (pollinationsApiKey !== undefined && pollinationsApiKey !== '') {
    store.setPollinationsApiKey(pollinationsApiKey);
    geminiService.setPollinationsApiKey(pollinationsApiKey);
    errorHealer.log('info', 'Pollinations API Key updated.');
  }
  if (geminiModel !== undefined) {
    store.setGeminiModel(geminiModel);
  }
  if (aiProvider !== undefined) {
    store.setAiProvider(aiProvider);
    errorHealer.log('info', `AI Provider set to: ${aiProvider}`);
  }
  if (autoHealEnabled !== undefined) {
    store.setAutoHeal(autoHealEnabled);
    errorHealer.log('info', `Auto-Heal mode ${autoHealEnabled ? 'ENABLED' : 'DISABLED'}.`);
  }
  res.json({ success: true, message: 'Settings saved successfully' });
});

// 2b. Force cloud backup (bots + broadcast audience) and report the result
app.post('/api/cloud/sync', requireAdmin, async (req, res) => {
  try {
    const bots = await store.syncBotsToGitHub();
    const users = await store.syncUsersToGitHub(true);
    const accounts = await store.syncAccountsToGitHub(true);
    res.json({
      configured: store.isCloudStorageConfigured(),
      bots,
      users,
      accounts
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Personality Presets
app.get('/api/presets', (req, res) => {
  res.json(PERSONALITY_PRESETS);
});

// 4. List all Bots (users only see their own bots)
app.get('/api/bots', (req, res) => {
  const bots = store.getBots();
  if (req.auth?.role === 'admin') {
    return res.json(bots);
  }
  res.json(bots.filter(b => (b.owner || 'admin') === req.auth?.username));
});

// 5. Add a new Bot (Token only or token + settings)
app.post('/api/bots', async (req, res) => {
  try {
    const { token, name, preset = 'sweet_loving', autoStart = true, customSettings = {} } = req.body;
    if (!token || typeof token !== 'string' || !token.includes(':')) {
      return res.status(400).json({ error: "Invalid Telegram Bot Token format. Tokens look like '123456789:ABCdef-GHIjkl...'" });
    }

    const role = req.auth?.role || 'user';
    if (role === 'user') {
      const account = store.publicAccount(req.auth.username);
      if (!account) return res.status(401).json({ error: "Account not found" });
      if (!account.telegramVerified) {
        const group = store.getConfig().requiredGroup || '@gfopiu';
        return res.status(403).json({
          error: `Bot connect karne se pehle Telegram group join karke verify karein (${group}).`,
          requiresTelegram: true,
          groupLink: `https://t.me/${group.replace(/^@/, '')}`
        });
      }
    }

    const newBot = await store.addBot({
      token,
      name,
      preset,
      customSettings,
      owner: role === 'admin' ? 'admin' : req.auth.username
    });
    errorHealer.log('info', `Added new bot [${newBot.settings.name}] for ${newBot.owner}`);

    let startResult = null;
    if (autoStart) {
      try {
        startResult = await botManager.startBot(newBot.id, { dropPendingUpdates: true });
      } catch (err) {
        errorHealer.log('warn', `Bot created but failed to start immediately: ${err.message}`);
      }
    }

    res.json({
      success: true,
      bot: store.getBot(newBot.id),
      started: Boolean(startResult)
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 6. Get single Bot
app.get('/api/bots/:id', botAccess, (req, res) => {
  const bot = store.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: "Bot not found" });
  res.json(bot);
});

// 7. Update Bot Settings
app.put('/api/bots/:id', botAccess, async (req, res) => {
  try {
    const bot = store.updateBot(req.params.id, req.body);
    errorHealer.log('info', `Settings updated for bot [${bot.settings.name}]`);

    // If bot is currently running and prompt/settings were updated, it auto-picks up without restart
    res.json({ success: true, bot });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 8. Delete Bot
app.delete('/api/bots/:id', botAccess, async (req, res) => {
  try {
    const removed = await botManager.deleteBot(req.params.id);
    errorHealer.log('info', `Deleted bot [${removed.settings?.name || req.params.id}]`);
    res.json({ success: true, removed });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 9. Start Bot
app.post('/api/bots/:id/start', botAccess, async (req, res) => {
  try {
    const result = await botManager.startBot(req.params.id, { dropPendingUpdates: true });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Stop Bot
app.post('/api/bots/:id/stop', botAccess, async (req, res) => {
  try {
    const result = await botManager.stopBot(req.params.id, req.body.reason || "Stopped via Dashboard");
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Restart Bot
app.post('/api/bots/:id/restart', botAccess, async (req, res) => {
  try {
    const result = await botManager.restartBot(req.params.id, { dropPendingUpdates: true });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. AI Bot Copilot: Modify bot or craft new bot persona using natural language instructions
app.post('/api/ai/copilot', async (req, res) => {
  try {
    const { botId, instruction, provider = 'pollinations' } = req.body;
    if (!instruction || !instruction.trim()) {
      return res.status(400).json({ error: "Instruction cannot be empty" });
    }

    const isNew = !botId || botId === '__new__';
    const currentBot = isNew ? null : store.getBot(botId);
    if (!isNew && req.auth?.role === 'user' && (currentBot?.owner || 'admin') !== req.auth.username) {
      return res.status(403).json({ error: "You do not have access to this bot" });
    }
    const globalConfig = store.getConfig();
    const apiKey = currentBot?.geminiApiKey || globalConfig.geminiApiKey || '';

    if (provider === 'gemini' && !apiKey) {
      return res.status(400).json({ error: "Gemini API Key missing. Please switch to Pollinations.AI (Free) or configure Gemini key." });
    }

    const targetLabel = isNew ? "Naya Bot Persona" : (currentBot?.settings?.name || botId);
    errorHealer.log('ai', `AI Copilot [${provider.toUpperCase()}] executing for ${targetLabel}: "${instruction}"`);

    const result = await geminiService.aiModifyBot({
      apiKey,
      currentBot,
      userInstruction: instruction,
      allBots: store.getBots(),
      provider
    });

    // If targeting an existing bot, auto-apply the updated settings
    if (!isNew && currentBot && result.updatedSettings) {
      store.updateBot(botId, {
        settings: {
          ...currentBot.settings,
          ...result.updatedSettings
        }
      });
      errorHealer.log('info', `AI Copilot applied updates to [${currentBot.settings.name}]: ${result.explanation}`);
    }

    res.json({
      success: true,
      isNew,
      targetLabel,
      explanation: result.explanation,
      updatedSettings: result.updatedSettings,
      bot: !isNew && botId ? store.getBot(botId) : null
    });
  } catch (err) {
    console.error("AI Copilot Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 13. AI Diagnose & Auto-Fix
app.post('/api/ai/diagnose', async (req, res) => {
  try {
    const { botId, errorLog } = req.body;
    const currentBot = botId ? store.getBot(botId) : null;
    const globalConfig = store.getConfig();
    const apiKey = currentBot?.geminiApiKey || globalConfig.geminiApiKey || '';

    const logToDiagnose = errorLog || currentBot?.lastError || store.getRecentLogs(5).find(l => l.type === 'error') || { message: "Unknown error" };

    const diagnosis = await geminiService.aiDiagnoseError({
      apiKey,
      errorLog: logToDiagnose,
      botContext: currentBot ? { id: currentBot.id, name: currentBot.settings?.name, status: currentBot.status } : null,
      provider: globalConfig.aiProvider || 'auto'
    });

    res.json({
      success: true,
      diagnosis,
      targetBot: currentBot?.settings?.name || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. Execute Auto-Fix Action
app.post('/api/ai/auto-fix', async (req, res) => {
  try {
    const { botId, action } = req.body;
    const bot = store.getBot(botId);
    if (!bot) return res.status(404).json({ error: "Bot not found" });

    errorHealer.log('heal', `Executing fix action '${action}' for [${bot.settings.name}]...`);

    if (action === 'restart' || action === 'drop_pending' || action === 'wait_and_retry') {
      await botManager.restartBot(botId, { dropPendingUpdates: true });
      return res.json({ success: true, message: `Bot [${bot.settings.name}] restarted cleanly with pending updates cleared.` });
    }

    if (action === 'stop') {
      await botManager.stopBot(botId, "Stopped by Auto-Fix");
      return res.json({ success: true, message: `Bot [${bot.settings.name}] stopped safely.` });
    }

    res.json({ success: true, message: `Action '${action}' acknowledged.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 15. In-Dashboard Live Bot Simulator (Test chat with your bot without telegram)
app.post('/api/bots/:id/simulate', botAccess, async (req, res) => {
  try {
    const { id: botId } = req.params;
    const { message } = req.body;
    const bot = store.getBot(botId);
    if (!bot) return res.status(404).json({ error: "Bot not found" });

    const globalConfig = store.getConfig();
    const apiKey = bot.geminiApiKey || globalConfig.geminiApiKey || "";
    const provider = bot.aiProvider || globalConfig.aiProvider || "auto";

    const history = store.getSimulatorHistory(botId);
    store.addSimulatorMessage(botId, 'user', message);

    const reply = await geminiService.generateGfReply({
      apiKey,
      model: globalConfig.geminiModel || 'gemini-3.5-flash-lite',
      provider,
      systemPrompt: bot.settings.systemPrompt,
      history,
      userMessage: message,
      temperature: bot.settings.temperature ?? 0.8
    });

    store.addSimulatorMessage(botId, 'model', reply);
    res.json({ success: true, reply, history: store.getSimulatorHistory(botId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bots/:id/simulate', botAccess, (req, res) => {
  res.json({ history: store.getSimulatorHistory(req.params.id) });
});

app.delete('/api/bots/:id/simulate', botAccess, (req, res) => {
  store.clearSimulatorHistory(req.params.id);
  res.json({ success: true, message: "Simulator history cleared" });
});

// 16. User CRM & Chat History
app.get('/api/bots/:id/users', botAccess, (req, res) => {
  const users = store.getBotUsers(req.params.id);
  res.json(users);
});

app.get('/api/bots/:id/users/:userId/history', botAccess, (req, res) => {
  const history = store.getConversation(req.params.id, req.params.userId);
  res.json(history);
});

app.delete('/api/bots/:id/users/:userId/history', botAccess, (req, res) => {
  store.clearConversation(req.params.id, req.params.userId);
  res.json({ success: true, message: "User conversation history cleared" });
});

// 17. Broadcast Message to All Bot Users or to a Channel/Group
app.post('/api/bots/:id/broadcast', botAccess, async (req, res) => {
  try {
    const { message, target = 'users', chatId } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Broadcast message cannot be empty" });
    }

    if (target === 'channel') {
      if (req.auth?.role !== 'admin') {
        return res.status(403).json({ error: "Channel/group broadcast is admin-only" });
      }
      const destination = String(chatId || '').trim();
      if (!destination) {
        return res.status(400).json({ error: "Channel username or chat ID required (e.g. @yourchannel)" });
      }
      const result = await botManager.broadcastToChat(req.params.id, destination, message.trim());
      return res.json(result);
    }

    const result = await botManager.broadcastToBotUsers(req.params.id, message.trim());
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 17b. Broadcast audience info (how many stored users are reachable)
app.get('/api/bots/:id/audience', botAccess, (req, res) => {
  const audience = store.getAudience(req.params.id);
  res.json({
    ...audience,
    cloudBackup: store.isCloudStorageConfigured(),
    telegramLimit: 'A bot can only message users who pressed /start at least once.'
  });
});

// 18. AI Persona Studio: Craft Persona from 1-line Idea
app.post('/api/ai/craft-persona', async (req, res) => {
  try {
    const { idea } = req.body;
    if (!idea || !idea.trim()) {
      return res.status(400).json({ error: "Please provide a character concept or idea" });
    }
    const globalConfig = store.getConfig();
    const apiKey = globalConfig.geminiApiKey || '';
    const provider = globalConfig.aiProvider || 'auto';

    // Users must earn referrals to unlock Persona Studio
    if (req.auth?.role === 'user') {
      const account = store.publicAccount(req.auth.username);
      const until = account?.studioAccessUntil ? new Date(account.studioAccessUntil) : null;
      if (!until || until < new Date()) {
        return res.status(403).json({
          error: "Persona Studio unlock karne ke liye 2 referrals chahiye (5 referrals = 4 days access).",
          requiresReferral: true,
          referralCount: account?.referralCount || 0,
          studioAccessUntil: account?.studioAccessUntil || null
        });
      }
    }

    // Gemini-only mode needs a key; Pollinations works with or without one.
    if (provider === 'gemini' && !apiKey) {
      return res.status(400).json({
        error: "Gemini-only mode is selected but no Gemini key is set. Switch AI Provider to 'Pollinations.AI' or 'Auto' in Settings."
      });
    }

    const persona = await geminiService.generatePersonaFromIdea({ apiKey, idea: idea.trim(), provider });
    const engine = persona._engine || (provider === 'gemini' ? 'gemini' : 'pollinations');
    delete persona._engine;
    res.json({ success: true, persona, engine });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 18b. AI latency probe (diagnostics)
app.get('/api/ai/latency', requireAdmin, async (req, res) => {
  try {
    const t0 = Date.now();
    const reply = await geminiService.pollinationsChat({
      systemPrompt: 'Reply with exactly one word.',
      userMessage: 'hi'
    });
    res.json({
      ms: Date.now() - t0,
      reply,
      keyed: Boolean(geminiService.getPollinationsApiKey()),
      meta: geminiService.lastRequestMeta || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 18c. AI usage & balance dashboard (Pollinations key)
let aiUsageCache = { at: 0, data: null };

app.get('/api/ai/usage', requireAdmin, async (req, res) => {
  const key = activePollinationsKey();
  if (!key) {
    return res.json({ configured: false });
  }
  if (!req.query.fresh && aiUsageCache.data && Date.now() - aiUsageCache.at < 30000) {
    return res.json(aiUsageCache.data);
  }

  const headers = { Authorization: `Bearer ${key}` };
  const result = {
    configured: true,
    key: null,
    balance: null,
    accountBalance: null,
    needsGrant: false,
    grantUrl: null,
    today: null,
    total: null,
    recent: []
  };

  // Key identity (no extra permission needed)
  try {
    const kr = await fetch('https://gen.pollinations.ai/account/key', { headers });
    if (kr.ok) {
      const k = await kr.json();
      result.key = {
        name: k.name || null,
        type: k.type || null,
        valid: Boolean(k.valid),
        expiresAt: k.expiresAt || null,
        budget: k.pollenBudget ?? null
      };
    }
  } catch (_) {}

  // Balance (needs account:usage; gracefully report if missing)
  try {
    const br = await fetch('https://gen.pollinations.ai/account/balance', { headers });
    const b = await br.json().catch(() => null);
    if (br.ok && b) {
      result.balance = typeof b.balance === 'number' ? b.balance : null;
      result.accountBalance = b.accountBalance || null;
    } else if (br.status === 403) {
      result.needsGrant = true;
      result.grantUrl = b?.error?.fixUrl || b?.fixUrl || null;
    }
  } catch (_) {}

  // Per-key usage history (no extra permission needed)
  try {
    const ur = await fetch('https://gen.pollinations.ai/account/key/usage', { headers });
    if (ur.ok) {
      const u = await ur.json().catch(() => null);
      const list = Array.isArray(u?.usage) ? u.usage : [];
      const todayStr = new Date().toISOString().slice(0, 10);
      const today = list.filter((x) => String(x.timestamp || '').startsWith(todayStr));
      const sum = (arr, field) => arr.reduce((a, x) => a + (Number(x[field]) || 0), 0);
      result.today = {
        requests: today.length,
        costUsd: sum(today, 'cost_usd'),
        avgMs: today.length ? Math.round(sum(today, 'response_time_ms') / today.length) : 0,
        tokensIn: sum(today, 'input_text_tokens'),
        tokensOut: sum(today, 'output_text_tokens')
      };
      result.total = { requests: list.length, costUsd: sum(list, 'cost_usd') };
      result.recent = list.slice(0, 6).map((x) => ({
        timestamp: x.timestamp,
        model: x.model,
        costUsd: Number(x.cost_usd) || 0,
        ms: Number(x.response_time_ms) || 0
      }));
    }
  } catch (_) {}

  aiUsageCache = { at: Date.now(), data: result };
  res.json(result);
});

// 19. Backup & Restore
app.get('/api/backup/export', requireAdmin, (req, res) => {
  const backup = store.exportBackup();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="telegram-ai-gf-backup-${Date.now()}.json"`);
  res.send(JSON.stringify(backup, null, 2));
});

app.post('/api/backup/import', requireAdmin, (req, res) => {
  try {
    store.importBackup(req.body);
    errorHealer.log('info', 'System backup successfully imported and restored.');
    res.json({ success: true, message: "Backup successfully restored!" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 15. Logs and SSE Log Streaming
app.get('/api/logs', requireAdmin, (req, res) => {
  res.json(store.getRecentLogs(100));
});

app.get('/api/logs/stream', requireAdmin, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial ping
  res.write(`data: ${JSON.stringify({ type: 'info', message: 'Connected to Live Error & Activity Stream', timestamp: new Date().toISOString() })}\n\n`);

  // Unsubscribe when connection closes
  const unsubscribe = errorHealer.subscribe((logEntry) => {
    res.write(`data: ${JSON.stringify(logEntry)}\n\n`);
  });

  req.on('close', () => {
    unsubscribe();
  });
});

// 404 handler for API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: `API route ${req.method} ${req.originalUrl} not found` });
});

// Fallback index.html for SPA routes
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'), (err) => {
    if (err && !res.headersSent) {
      res.status(200).send("AI GF Platform");
    }
  });
});

// Start Server explicitly on 0.0.0.0 for reliable Android browser access
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Telegram AI GF Bot Platform & Web Manager is LIVE!`);
  console.log(`📡 URL (Localhost): http://localhost:${PORT}`);
  console.log(`📱 URL (Android IP): http://127.0.0.1:${PORT}`);
  console.log(`======================================================\n`);

  errorHealer.log('info', `Server started on port ${PORT}. Ready to manage AI GF bots.`);

  // Auto-start previously running bots
  try {
    await botManager.startAllConfiguredBots();
  } catch (e) {
    console.error("Auto-start error:", e.message);
  }

  // Check again after 3 seconds in case bots were synced from GitHub cloud storage
  setTimeout(async () => {
    try {
      await botManager.startAllConfiguredBots();
    } catch (_) {}
  }, 3500);

  // Anti-Sleep Keep-Alive Engine for Render Cloud (prevents 15-minute sleep)
  const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
  if (RENDER_EXTERNAL_URL) {
    console.log(`[Anti-Sleep] Keep-alive worker started for ${RENDER_EXTERNAL_URL}`);
    setInterval(() => {
      fetch(`${RENDER_EXTERNAL_URL}/api/status`)
        .then(r => r.json())
        .then(() => console.log('[Anti-Sleep] Ping ok - Render kept awake 24/7'))
        .catch(err => console.warn('[Anti-Sleep] Ping error:', err.message));
    }, 9 * 60 * 1000); // 9 minutes
  }
});
