import { store } from './store.js';

export class ErrorHealer {
  constructor() {
    this.restartAttempts = new Map(); // botId -> { count, lastAttempt }
    this.listeners = new Set();
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  broadcast(entry) {
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch (err) {
        console.error("Listener error:", err);
      }
    }
  }

  log(type, message, details = null) {
    const entry = store.addLog(type, message, details);
    console.log(`[${type.toUpperCase()}] ${message}`);
    this.broadcast(entry);
    return entry;
  }

  /**
   * Handle Bot Runtime Error with Self-Healing Logic
   */
  async handleBotError(botId, error, botManager) {
    const bot = store.getBot(botId);
    const botName = bot?.settings?.name || botId;
    const errMsg = error?.message || String(error);
    const errCode = error?.error_code || error?.status || null;

    this.log('error', `Error in Bot [${botName}]: ${errMsg}`, {
      botId,
      code: errCode,
      stack: error?.stack
    });

    if (bot) {
      store.updateBot(botId, {
        lastError: {
          message: errMsg,
          code: errCode,
          timestamp: new Date().toISOString()
        }
      });
    }

    const config = store.getConfig();
    if (!config.autoHealEnabled) {
      this.log('warn', `Auto-heal disabled. Bot [${botName}] kept in current state.`);
      return { healed: false, reason: "Auto-heal disabled" };
    }

    // 1. Invalid Token (401 Unauthorized)
    if (errMsg.includes('401') || errMsg.includes('Unauthorized') || errCode === 401) {
      this.log('heal', `Self-Heal [${botName}]: Token is invalid/revoked. Stopping bot to avoid Telegram bans.`);
      await botManager.stopBot(botId, "Invalid Telegram Bot Token (401 Unauthorized)");
      return { healed: true, action: "stopped", reason: "Invalid Token" };
    }

    // 2. Conflict: 409 Another instance running
    if (errMsg.includes('409') || errMsg.includes('Conflict') || errCode === 409) {
      this.log('heal', `Self-Heal [${botName}]: Detected 409 Conflict (duplicate getUpdates). Cleaning up previous connection and restarting in 3s...`);
      await botManager.stopBot(botId, "Resolving 409 Conflict");
      await new Promise(r => setTimeout(r, 3000));
      await botManager.startBot(botId, { dropPendingUpdates: true });
      this.log('heal', `Self-Heal [${botName}]: Restarted cleanly with dropPendingUpdates.`);
      return { healed: true, action: "restart_conflict", reason: "409 Conflict resolved" };
    }

    // 3. Network Drop (Termux WiFi/Data switch, timeout)
    if (errMsg.includes('ETIMEDOUT') || errMsg.includes('ECONNRESET') || errMsg.includes('ENOTFOUND') || errMsg.includes('fetch failed')) {
      this.log('heal', `Self-Heal [${botName}]: Network connection dropped on Termux. Waiting 5s before reconnecting...`);
      await new Promise(r => setTimeout(r, 5000));
      try {
        await botManager.restartBot(botId);
        this.log('heal', `Self-Heal [${botName}]: Successfully reconnected after network drop.`);
        return { healed: true, action: "reconnected", reason: "Network recovery" };
      } catch (retryErr) {
        this.log('error', `Self-Heal [${botName}]: Reconnect attempt failed: ${retryErr.message}`);
      }
    }

    // 4. Rate Limit (429 Too Many Requests)
    if (errMsg.includes('429') || errCode === 429) {
      const waitSeconds = error?.parameters?.retry_after || 10;
      this.log('heal', `Self-Heal [${botName}]: Rate limited. Backing off for ${waitSeconds}s...`);
      await new Promise(r => setTimeout(r, waitSeconds * 1000));
      await botManager.restartBot(botId);
      return { healed: true, action: "backed_off_and_restarted", reason: "Rate limit handled" };
    }

    // 5. Generic Crash Recovery with Rate Limiter
    const attempt = this.restartAttempts.get(botId) || { count: 0, firstAttempt: Date.now() };
    const now = Date.now();

    // Reset counter if more than 3 minutes passed since first restart attempt
    if (now - attempt.firstAttempt > 180000) {
      attempt.count = 0;
      attempt.firstAttempt = now;
    }

    attempt.count += 1;
    this.restartAttempts.set(botId, attempt);

    if (attempt.count > 5) {
      this.log('warn', `Self-Heal [${botName}]: Bot crashed ${attempt.count} times in 3 minutes. Pausing auto-restart to prevent spam. Check logs.`);
      await botManager.stopBot(botId, "Crashed repeatedly (Needs manual inspection)");
      return { healed: false, reason: "Excessive crashes" };
    }

    const backoffMs = Math.min(attempt.count * 2000, 10000);
    this.log('heal', `Self-Heal [${botName}]: Auto-restarting in ${backoffMs / 1000}s (Attempt ${attempt.count}/5)...`);
    await new Promise(r => setTimeout(r, backoffMs));

    try {
      await botManager.startBot(botId);
      this.log('heal', `Self-Heal [${botName}]: Bot successfully resurrected.`);
      return { healed: true, action: "auto_restart", reason: "Crash recovery" };
    } catch (e) {
      this.log('error', `Self-Heal [${botName}]: Auto-restart attempt failed: ${e.message}`);
      return { healed: false, reason: e.message };
    }
  }
}

export const errorHealer = new ErrorHealer();
