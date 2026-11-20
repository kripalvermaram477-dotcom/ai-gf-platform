import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { store, PERSONALITY_PRESETS } from './lib/store.js';
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
  const pKey = cfg.pollinationsApiKey || process.env.POLLINATIONS_API_KEY || '';
  if (pKey) {
    geminiService.setPollinationsApiKey(pKey);
    console.log('[AI] Pollinations key loaded — 45s free limit disabled.');
  } else {
    console.warn('[AI] No Pollinations key found. Free tier limit applies (1 reply / 45s). Add it in Settings or set POLLINATIONS_API_KEY in Render.');
  }
}

// True if a Pollinations key is active from the dashboard config or Render env
function pollinationsKeyActive() {
  const cfgKey = (store.getConfig().pollinationsApiKey || '').trim();
  const envKey = (process.env.POLLINATIONS_API_KEY || '').trim();
  return Boolean(cfgKey || envKey);
}

function activePollinationsKey() {
  return (store.getConfig().pollinationsApiKey || process.env.POLLINATIONS_API_KEY || '').trim();
}

// ================= AUTH MIDDLEWARE =================
app.use((req, res, next) => {
  // Public routes that don't need authentication
  if (
    !req.path.startsWith('/api') ||
    req.path === '/api/auth/login' ||
    req.path === '/api/auth/verify' ||
    req.path === '/api/status' ||
    req.path === '/api/presets'
  ) {
    return next();
  }

  const authHeader = req.headers.authorization || req.headers['x-admin-token'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  if (store.validateToken(token)) {
    return next();
  }

  return res.status(401).json({ error: "Unauthorized. Please login with Admin credentials." });
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
  const token = req.headers['x-admin-token'] || req.headers.authorization?.slice(7);
  res.json({ authenticated: store.validateToken(token) });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-admin-token'] || req.headers.authorization?.slice(7);
  store.logoutAdmin(token);
  res.json({ success: true });
});

app.post('/api/auth/change-credentials', (req, res) => {
  const { newUsername, newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: "Password must be at least 4 characters long" });
  }
  store.changeAdminCredentials(newUsername, newPassword);
  errorHealer.log('info', "Admin credentials updated.");
  res.json({ success: true, message: "Credentials updated successfully" });
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
    memoryUsage: process.memoryUsage()
  });
});

// 2. Global Configuration
app.get('/api/config', (req, res) => {
  const config = store.getConfig();
  res.json({
    geminiApiKey: config.geminiApiKey ? `${config.geminiApiKey.substring(0, 6)}...${config.geminiApiKey.slice(-4)}` : '',
    hasGeminiKey: Boolean(config.geminiApiKey),
    pollinationsApiKey: activePollinationsKey() ? `${activePollinationsKey().substring(0, 5)}...${activePollinationsKey().slice(-4)}` : '',
    hasPollinationsKey: pollinationsKeyActive(),
    geminiModel: config.geminiModel || 'gemini-3.5-flash-lite',
    aiProvider: config.aiProvider || 'auto',
    autoHealEnabled: config.autoHealEnabled
  });
});

app.post('/api/config', (req, res) => {
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

// 3. Personality Presets
app.get('/api/presets', (req, res) => {
  res.json(PERSONALITY_PRESETS);
});

// 4. List all Bots
app.get('/api/bots', (req, res) => {
  res.json(store.getBots());
});

// 5. Add a new Bot (Token only or token + settings)
app.post('/api/bots', async (req, res) => {
  try {
    const { token, name, preset = 'sweet_loving', autoStart = true, customSettings = {} } = req.body;
    if (!token || typeof token !== 'string' || !token.includes(':')) {
      return res.status(400).json({ error: "Invalid Telegram Bot Token format. Tokens look like '123456789:ABCdef-GHIjkl...'" });
    }

    const newBot = store.addBot({ token, name, preset, customSettings });
    errorHealer.log('info', `Added new bot [${newBot.settings.name}]`);

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
app.get('/api/bots/:id', (req, res) => {
  const bot = store.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: "Bot not found" });
  res.json(bot);
});

// 7. Update Bot Settings
app.put('/api/bots/:id', async (req, res) => {
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
app.delete('/api/bots/:id', async (req, res) => {
  try {
    const removed = await botManager.deleteBot(req.params.id);
    errorHealer.log('info', `Deleted bot [${removed.settings?.name || req.params.id}]`);
    res.json({ success: true, removed });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 9. Start Bot
app.post('/api/bots/:id/start', async (req, res) => {
  try {
    const result = await botManager.startBot(req.params.id, { dropPendingUpdates: true });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Stop Bot
app.post('/api/bots/:id/stop', async (req, res) => {
  try {
    const result = await botManager.stopBot(req.params.id, req.body.reason || "Stopped via Dashboard");
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Restart Bot
app.post('/api/bots/:id/restart', async (req, res) => {
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
app.post('/api/bots/:id/simulate', async (req, res) => {
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

app.get('/api/bots/:id/simulate', (req, res) => {
  res.json({ history: store.getSimulatorHistory(req.params.id) });
});

app.delete('/api/bots/:id/simulate', (req, res) => {
  store.clearSimulatorHistory(req.params.id);
  res.json({ success: true, message: "Simulator history cleared" });
});

// 16. User CRM & Chat History
app.get('/api/bots/:id/users', (req, res) => {
  const users = store.getBotUsers(req.params.id);
  res.json(users);
});

app.get('/api/bots/:id/users/:userId/history', (req, res) => {
  const history = store.getConversation(req.params.id, req.params.userId);
  res.json(history);
});

app.delete('/api/bots/:id/users/:userId/history', (req, res) => {
  store.clearConversation(req.params.id, req.params.userId);
  res.json({ success: true, message: "User conversation history cleared" });
});

// 17. Broadcast Message to All Bot Users
app.post('/api/bots/:id/broadcast', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Broadcast message cannot be empty" });
    }
    const result = await botManager.broadcastToBotUsers(req.params.id, message.trim());
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

// 19. Backup & Restore
app.get('/api/backup/export', (req, res) => {
  const backup = store.exportBackup();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="telegram-ai-gf-backup-${Date.now()}.json"`);
  res.send(JSON.stringify(backup, null, 2));
});

app.post('/api/backup/import', (req, res) => {
  try {
    store.importBackup(req.body);
    errorHealer.log('info', 'System backup successfully imported and restored.');
    res.json({ success: true, message: "Backup successfully restored!" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 15. Logs and SSE Log Streaming
app.get('/api/logs', (req, res) => {
  res.json(store.getRecentLogs(100));
});

app.get('/api/logs/stream', (req, res) => {
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
