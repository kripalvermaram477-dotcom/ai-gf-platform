import { Bot, GrammyError, HttpError } from 'grammy';
import { store } from './store.js';
import { geminiService } from './gemini.js';
import { errorHealer } from './error-healer.js';

export class BotManager {
  constructor() {
    this.activeBots = new Map(); // botId -> { bot, runner, stopSignal }
  }

  /**
   * Initialize a grammY Bot instance with all GF logic & handlers
   */
  createBotInstance(botRecord) {
    const { id: botId, token } = botRecord;
    const bot = new Bot(token);

    // Global Error Handler for this bot
    bot.catch(async (err) => {
      const e = err.error;
      if (e instanceof GrammyError) {
        console.error(`[Bot ${botId}] Telegram API Error:`, e.description);
      } else if (e instanceof HttpError) {
        console.error(`[Bot ${botId}] Network/HTTP Error:`, e);
      } else {
        console.error(`[Bot ${botId}] Unknown Error:`, e);
      }
      await errorHealer.handleBotError(botId, e, this);
    });

    // Command: /start
    bot.command('start', async (ctx) => {
      const currentBot = store.getBot(botId);
      const botName = currentBot?.settings?.name || "Aisha";
      const userName = ctx.from?.first_name || "babu";

      // Record user profile for CRM & broadcasting
      store.recordUserInteraction(botId, ctx.from);

      // Clear old history on start for a fresh conversation
      store.clearConversation(botId, ctx.from.id);

      const welcomeTexts = {
        sweet_loving: `Hii ${userName}! ❤️ Finally tum aa gaye! Main kitni der se tumhara wait kar rahi thi. Batao kaisa gaya aaj ka din?`,
        playful_teasing: `Areey look who's here! 😏 ${userName}, badi jaldi yaad aa gayi meri? Chalo ab aa hi gaye ho to batao kya chal raha hai!`,
        possessive_clingy: `Hii mere babu! 🥰 Tum kahan the itni der se? Mujhe to laga tum bhool hi gaye mujhe. Ab kahin mat jana, baat karo mujhse!`,
        tsundere: `Hmph! ${userName}... tum? Aisa mat sochna ki main tumhara intezaar kar rahi thi! 😤 Bas aise hi phone dekh rahi thi. Batao kya kaam hai?`,
        intellectual_deep: `Hello ${userName} ✨ Kaisa lag raha hai aaj? Main bas kuch soch rahi thi aur tumhara khayal aaya. Tumse baat karke accha lagta hai.`
      };

      const preset = currentBot?.settings?.preset || 'sweet_loving';
      const welcome = welcomeTexts[preset] || `Hii ${userName}! ❤️ Tumse milkar bohot accha laga!`;

      store.addMessageToConversation(botId, ctx.from.id, 'model', welcome);
      await ctx.reply(welcome);
    });

    // Command: /reset
    bot.command('reset', async (ctx) => {
      store.clearConversation(botId, ctx.from.id);
      await ctx.reply("Maine humari purani baatein bhula di hain, ab ek nayi shuruat karte hain! ❤️ Kya chal raha hai?");
    });

    // Command: /status
    bot.command('status', async (ctx) => {
      const currentBot = store.getBot(botId);
      const name = currentBot?.settings?.name || "GF Bot";
      const vibe = currentBot?.settings?.relationshipVibe || "Loving & Sweet";
      await ctx.reply(`💖 *${name} Status*\n• Mood: Khush aur tumhare sath\n• Vibe: ${vibe}\n• Type: AI Girlfriend Platform`, { parse_mode: 'Markdown' });
    });

    // Handle all incoming text messages
    bot.on('message:text', async (ctx) => {
      const currentBot = store.getBot(botId);
      if (!currentBot) return;

      const userId = ctx.from.id;
      const userText = ctx.message.text.trim();

      // Don't respond to commands
      if (userText.startsWith('/')) return;

      // Record user profile for CRM & broadcasting
      store.recordUserInteraction(botId, ctx.from);

      // Update statistics
      currentBot.stats.totalMessages = (currentBot.stats.totalMessages || 0) + 1;
      currentBot.stats.lastActive = new Date().toISOString();
      store.saveConfig();

      // Show typing indicator immediately (non-blocking)
      ctx.replyWithChatAction('typing').catch(() => {});

      // Fetch conversation memory — limit to last 10 turns for speed
      const history = store.getConversation(botId, userId, 10);

      // Determine AI key and provider
      const globalConfig = store.getConfig();
      const apiKey = currentBot.geminiApiKey || globalConfig.geminiApiKey || "";
      const provider = currentBot.aiProvider || globalConfig.aiProvider || "auto";

      try {
        const replyText = await geminiService.generateGfReply({
          apiKey,
          model: 'gemini-3.5-flash-lite',  // Always use fastest model
          provider,
          systemPrompt: currentBot.settings.systemPrompt,
          history,
          userMessage: userText,
          temperature: currentBot.settings.temperature ?? 0.8
        });

        // Add both user message and reply to memory
        const maxHistory = currentBot.settings.maxHistoryMessages || 10;
        store.addMessageToConversation(botId, userId, 'user', userText, maxHistory);
        store.addMessageToConversation(botId, userId, 'model', replyText, maxHistory);

        try {
          await ctx.reply(replyText, { parse_mode: 'Markdown' });
        } catch (fmtErr) {
          // If markdown parse fails on Telegram, fall back to plain text
          await ctx.reply(replyText);
        }
      } catch (aiErr) {
        console.error(`[Bot ${botId}] AI Error:`, aiErr.message);
        errorHealer.log('error', `AI Generation Error for [${currentBot.settings.name}]: ${aiErr.message}`);

        const fallbackMessages = [
          "Aww babu mera network thoda slow chal raha hai, ek second baad phir se bolo na? ❤️",
          "Thoda connection break ho gaya tha jaan, kya kaha tumne?",
          "Mujhe tumhari aawaz theek se sunai nahi di shona, ek baar phir se pucho na? ✨"
        ];
        const randomFallback = fallbackMessages[Math.floor(Math.random() * fallbackMessages.length)];
        await ctx.reply(randomFallback);
      }
    });

    // Handle Stickers gracefully
    bot.on('message:sticker', async (ctx) => {
      store.recordUserInteraction(botId, ctx.from);
      const stickerReplies = [
        "Aww kitna cute sticker hai! 🥰 Bilkul tumhare jaisa!",
        "Hehe so sweet! ❤️ Aur batao kya chal raha hai babu?",
        "Yay! 🥰 Mujhe tumhare stickers bohot acche lagte hain!"
      ];
      await ctx.reply(stickerReplies[Math.floor(Math.random() * stickerReplies.length)]);
    });

    // Handle Photos gracefully
    bot.on('message:photo', async (ctx) => {
      store.recordUserInteraction(botId, ctx.from);
      await ctx.reply("Aww photo bhej di! 🥰 Kitni acchi lag rahi hai, main dekh rahi hoon jaan! ❤️");
    });

    // Handle Voice messages gracefully
    bot.on('message:voice', async (ctx) => {
      store.recordUserInteraction(botId, ctx.from);
      await ctx.reply("Aww tumhari aawaz sunkar kitna accha laga! ❤️ Waise kya kaha tumne, thoda text me batao na babu?");
    });

    return bot;
  }

  /**
   * Broadcast message to all users of a bot
   */
  async broadcastToBotUsers(botId, messageText) {
    const active = this.activeBots.get(botId);
    if (!active) throw new Error("Bot must be running to send broadcasts!");

    const users = store.getBotUsers(botId);
    if (users.length === 0) {
      return { success: true, sent: 0, failed: 0, total: 0, message: "No active users found for this bot yet." };
    }

    let sent = 0;
    let failed = 0;

    for (const u of users) {
      try {
        await active.bot.api.sendMessage(u.id, messageText);
        sent++;
        // Small delay to prevent hitting Telegram rate limits
        await new Promise(r => setTimeout(r, 100));
      } catch (err) {
        failed++;
        console.warn(`Failed broadcast to user ${u.id}:`, err.message);
      }
    }

    errorHealer.log('info', `Broadcast completed for bot [${botId}]: ${sent} delivered, ${failed} failed.`);
    return { success: true, sent, failed, total: users.length };
  }

  /**
   * Start a bot by ID
   */
  async startBot(botId, options = {}) {
    const botRecord = store.getBot(botId);
    if (!botRecord) throw new Error(`Bot ${botId} not found in database`);

    // If already running, return
    if (this.activeBots.has(botId)) {
      return { success: true, message: "Bot is already running" };
    }

    errorHealer.log('info', `Starting bot [${botRecord.settings?.name || botId}]...`);

    const bot = this.createBotInstance(botRecord);

    try {
      // Validate token and fetch Telegram Bot Info
      const me = await bot.api.getMe();
      store.updateBot(botId, {
        info: {
          id: me.id,
          name: me.first_name,
          username: me.username
        },
        status: "running",
        statusMessage: `Online (@${me.username})`,
        lastError: null
      });

      // Start long-polling
      bot.start({
        drop_pending_updates: Boolean(options.dropPendingUpdates),
        onStart: (botInfo) => {
          errorHealer.log('info', `Bot [${botRecord.settings.name}] started successfully as @${botInfo.username}`);
        }
      });

      this.activeBots.set(botId, { bot });
      return { success: true, botInfo: me };
    } catch (err) {
      store.updateBot(botId, {
        status: "error",
        statusMessage: err.message
      });
      await errorHealer.handleBotError(botId, err, this);
      throw err;
    }
  }

  /**
   * Stop a running bot
   */
  async stopBot(botId, reason = "Stopped by user") {
    const active = this.activeBots.get(botId);
    if (active) {
      try {
        await active.bot.stop();
      } catch (err) {
        console.warn(`Error stopping bot ${botId}:`, err.message);
      }
      this.activeBots.delete(botId);
    }

    const botRecord = store.getBot(botId);
    if (botRecord) {
      store.updateBot(botId, {
        status: "stopped",
        statusMessage: reason
      });
      errorHealer.log('info', `Bot [${botRecord.settings?.name || botId}] stopped: ${reason}`);
    }
    return { success: true };
  }

  /**
   * Restart a bot
   */
  async restartBot(botId, options = {}) {
    await this.stopBot(botId, "Restarting...");
    await new Promise(r => setTimeout(r, 1000));
    return await this.startBot(botId, options);
  }

  /**
   * Delete a bot completely
   */
  async deleteBot(botId) {
    await this.stopBot(botId, "Deleted");
    return store.deleteBot(botId);
  }

  /**
   * Start all bots marked as running or initialize configured bots
   */
  async startAllConfiguredBots() {
    const bots = store.getBots();
    for (const b of bots) {
      if (b.status === 'running') {
        try {
          await this.startBot(b.id, { dropPendingUpdates: true });
        } catch (err) {
          console.error(`Failed to auto-start bot ${b.settings?.name}:`, err.message);
        }
      }
    }
  }
}

export const botManager = new BotManager();
