import https from 'node:https';
import { GoogleGenAI } from '@google/genai';

// Keep TCP/TLS connections to Pollinations alive between messages.
// Node's default fetch pool drops idle connections after ~4s, which makes every
// chat reply pay a full cold-start handshake. A long-lived agent keeps replies fast.
const pollinationsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 120000,
  maxSockets: 16,
  maxFreeSockets: 8
});

function httpsPostJson(url, headers, body, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = Buffer.from(JSON.stringify(body));
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: 'POST',
        agent: pollinationsAgent,
        headers: { ...headers, 'Content-Length': payload.length }
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const status = res.statusCode || 0;
          resolve({ ok: status >= 200 && status < 300, status, text: Buffer.concat(chunks).toString('utf8') });
        });
        res.on('error', reject);
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Only tested working fast models. Order = fastest first.
const RELIABLE_MODELS = [
  'gemini-3.5-flash-lite'
];

function extractJson(str) {
  if (!str) throw new Error("Empty response from AI engine");
  const trimmed = str.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {}

  // Match ```json ... ``` or ``` ... ```
  const mdMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (mdMatch) {
    try {
      return JSON.parse(mdMatch[1].trim());
    } catch (_) {}
  }

  // Find outer-most { ... }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.substring(start, end + 1));
    } catch (_) {}
  }

  throw new Error(`AI response could not be parsed as JSON: ${trimmed.slice(0, 120)}...`);
}

export class GeminiService {
  constructor(defaultApiKey = '') {
    this.defaultApiKey = defaultApiKey;
    this.clientCache = new Map();
    this.pollinationsApiKey = '';
  }

  /**
   * Set the Pollinations key at runtime (from the dashboard or env).
   * With a key, requests skip the free tier's 1-reply-per-45s limit.
   */
  setPollinationsApiKey(key) {
    this.pollinationsApiKey = (key || '').trim();
  }

  getPollinationsApiKey() {
    return (this.pollinationsApiKey || process.env.POLLINATIONS_API_KEY || '').trim();
  }

  getClient(apiKey) {
    const key = (apiKey || this.defaultApiKey || process.env.GEMINI_API_KEY || '').trim();
    if (!key) {
      return { client: null, apiKey: '' };
    }
    if (!this.clientCache.has(key)) {
      this.clientCache.set(key, new GoogleGenAI({ apiKey: key }));
    }
    return { client: this.clientCache.get(key), apiKey: key };
  }

  /**
   * Pollinations.AI: 100% Free AI (Zero API key needed)
   * Text-only messages, fast text model, timeout + retry, short memory window
   */
  sanitizeAiText(value) {
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) {
      const texts = value
        .map(p => (p && typeof p.text === 'string') ? p.text : (typeof p === 'string' ? p : ''))
        .map(t => t.trim())
        .filter(Boolean);
      return texts.join('\n').trim();
    }
    return '';
  }

  async pollinationsChat({
    systemPrompt,
    history = [],
    userMessage,
    temperature = 0.8,
    isJson = false,
    retryCount = 0,
    model = null,
    modelIndex = 0
  }) {
    const pollinationsKey = this.getPollinationsApiKey();
    const useKeyApi = Boolean(pollinationsKey);

    // Ordered model candidates. Aliases are accepted by both the free and keyed endpoints.
    const MODELS = useKeyApi
      ? ['openai', 'openai-fast', 'mistral-large']
      : ['gpt-oss-20b', 'openai-fast', 'mistral-large'];

    const idx = Math.min(modelIndex, MODELS.length - 1);
    const activeModel = model || MODELS[idx];
    console.log(`[AI Engine] Pollinations request (${useKeyApi ? 'keyed' : 'free'}) model=${activeModel}`);

    // --- Build text-only messages (text models reject image/audio parts) ---
    const messages = [];
    const sysText = this.sanitizeAiText(systemPrompt);
    if (sysText) {
      messages.push({ role: 'system', content: sysText });
    }
    // Short memory window: fewer tokens = faster replies (6 turns is plenty for chat)
    const recentHistory = Array.isArray(history) ? history.slice(-6) : [];
    for (const item of recentHistory) {
      if (item.parts && item.parts.length > 0) {
        const content = this.sanitizeAiText(item.parts.map(p => p.text || '').join('\n'));
        if (content) {
          messages.push({ role: item.role === 'model' ? 'assistant' : 'user', content });
        }
      }
    }
    const userText = this.sanitizeAiText(userMessage);
    if (userText) {
      messages.push({ role: 'user', content: userText });
    }
    if (!messages.length) {
      throw new Error('Nothing to send to the AI (empty message).');
    }

    const endpoint = useKeyApi
      ? 'https://gen.pollinations.ai/v1/chat/completions'
      : 'https://text.pollinations.ai/';

    const payload = useKeyApi
      ? {
          model: activeModel,
          messages,
          temperature: typeof temperature === 'number' ? temperature : 0.8,
          // Normal chat: skip the long "thinking" step — biggest latency win.
          // JSON mode keeps default reasoning because it needs the accuracy.
          ...(isJson
            ? { response_format: { type: 'json_object' } }
            : { reasoning_effort: process.env.POLLINATIONS_REASONING_EFFORT || 'minimal' })
        }
      : {
          messages,
          model: activeModel,
          seed: Math.floor(Math.random() * 1000000),
          ...(isJson ? { jsonMode: true } : {})
        };

    const headers = { 'Content-Type': 'application/json' };
    if (useKeyApi) {
      headers.Authorization = `Bearer ${pollinationsKey}`;
    }

    let res;
    try {
      if (useKeyApi) {
        // Reuse a warm keep-alive connection (much faster than a cold fetch)
        res = await httpsPostJson(endpoint, headers, payload, 30000);
      } else {
        const r = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30000)
        });
        res = { ok: r.ok, status: r.status, text: await r.text() };
      }
    } catch (err) {
      // Network/timeout: try the next model once.
      if (modelIndex + 1 < MODELS.length) {
        console.warn(`[Pollinations] ${activeModel} network error (${err.message}). Trying next model.`);
        return this.pollinationsChat({ systemPrompt, history, userMessage, temperature, isJson, retryCount, model: null, modelIndex: modelIndex + 1 });
      }
      throw new Error(`AI network error: ${err.message}. Please try again.`);
    }

    const rawBody = res.text;

    if (!res.ok) {
      // Free tier: 1 reply / 45s per IP. Wait for the limit to reset, then retry.
      if (res.status === 402) {
        const match = rawBody.match(/Retry after (\d+)s/i);
        const waitSec = match ? parseInt(match[1], 10) : 45;
        if (retryCount < 2 && waitSec <= 65) {
          console.log(`[Pollinations] Free limit hit. Waiting ${waitSec}s then retrying (${retryCount + 1}/2)...`);
          await new Promise(r => setTimeout(r, (waitSec + 1) * 1000));
          return this.pollinationsChat({ systemPrompt, history, userMessage, temperature, isJson, retryCount: retryCount + 1, model: activeModel, modelIndex });
        }
        throw new Error('Free AI limit reached (1 reply every 45 seconds). Please wait about a minute and try again, or add a free AI key in Settings.');
      }

      // Model-specific failure (bad model, token limit, upstream error): try the next model.
      if (modelIndex + 1 < MODELS.length) {
        console.warn(`[Pollinations] ${activeModel} failed (${res.status}). Trying next model.`);
        return this.pollinationsChat({ systemPrompt, history, userMessage, temperature, isJson, retryCount, model: null, modelIndex: modelIndex + 1 });
      }
      throw new Error(`AI service error (${res.status}). Please try again in a moment.`);
    }

    let reply = '';
    if (useKeyApi) {
      try {
        const data = JSON.parse(rawBody);
        reply = (data.choices?.[0]?.message?.content || '').trim();
      } catch (_) {
        reply = rawBody.trim();
      }
    } else {
      reply = rawBody.trim();
    }

    if (!reply) {
      // Some reasoning models return empty content when they run out of budget.
      if (modelIndex + 1 < MODELS.length) {
        console.warn(`[Pollinations] ${activeModel} returned an empty reply. Trying next model.`);
        return this.pollinationsChat({ systemPrompt, history, userMessage, temperature, isJson, retryCount, model: null, modelIndex: modelIndex + 1 });
      }
      throw new Error('The AI returned an empty reply. Please try again.');
    }
    return reply;
  }

  /**
   * Generate conversational GF response — fast path: Gemini first, Pollinations only as last resort
   */
  async generateGfReply({
    apiKey,
    model = "gemini-3.5-flash-lite",
    provider = "auto",
    systemPrompt,
    history = [],
    userMessage,
    temperature = 0.8
  }) {
    const effectiveKey = (apiKey || this.defaultApiKey || process.env.GEMINI_API_KEY || '').trim();

    // Build Gemini-compatible contents
    const contents = [];
    for (const item of history) {
      if (item.parts && item.parts.length > 0) {
        contents.push({
          role: item.role === 'model' ? 'model' : 'user',
          parts: item.parts.map(p => ({ text: p.text || '' }))
        });
      }
    }
    contents.push({ role: 'user', parts: [{ text: userMessage }] });

    // --- FAST PATH: Gemini (if key available and provider is not forced to pollinations) ---
    if (provider !== 'pollinations' && effectiveKey) {
      try {
        const reply = await this.restFallback({
          apiKey: effectiveKey,
          model: 'gemini-3.5-flash-lite',
          systemPrompt,
          contents,
          temperature
        });
        return reply;
      } catch (err) {
        console.warn(`[GF Reply] Gemini failed: ${err.message}. Using Pollinations fallback.`);
      }
    }

    // --- FALLBACK: Pollinations.AI (zero key, slightly slower) ---
    console.log("[GF Reply] Routing to Pollinations.AI...");
    return await this.pollinationsChat({ systemPrompt, history, userMessage, temperature });
  }

  /**
   * Direct REST call for Gemini API — with 10s timeout to fail fast
   */
  async restFallback({ apiKey, model, systemPrompt, contents, temperature }) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const payload = {
      contents,
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      generationConfig: {
        temperature: typeof temperature === 'number' ? temperature : 0.8,
        maxOutputTokens: 300  // Shorter = faster replies
      }
    };

    // 10-second hard timeout — prevents slow model from freezing bot
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Gemini API error (${res.status}): ${errBody.slice(0, 200)}`);
      }

      const data = await res.json();
      const candidate = data.candidates?.[0];
      const textPart = candidate?.content?.parts?.[0]?.text;
      if (!textPart) {
        throw new Error("No response generated from Gemini API");
      }
      return textPart.trim();
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw new Error(`Gemini model ${model} timed out after 10s`);
      }
      throw err;
    }
  }

  /**
   * AI Copilot: Natural language instruction to customize, edit, or create a bot
   */
  async aiModifyBot({ apiKey, currentBot, userInstruction, allBots = [], provider = "pollinations" }) {
    const isNew = !currentBot;
    const systemPrompt = `You are the Lead AI Bot Architect and Engineer inside an AI Girlfriend Bot Manager system.
The user wants to ${isNew ? 'design and create a brand new' : 'customize, modify or reconfigure an existing'} Telegram AI Girlfriend Bot using natural language instructions in Hinglish/English.

${isNew ? 'Action: Design a brand new bot persona from scratch based on user instructions.' : `Action: Modify existing bot settings.\nCurrent Bot Configuration:\n${JSON.stringify(currentBot?.settings || {}, null, 2)}`}

User Instruction: "${userInstruction}"

Your response MUST BE valid raw JSON ONLY (no markdown code blocks, no other text) with this structure:
{
  "explanation": "Brief, friendly explanation in Hinglish of what you designed or updated (e.g. 'Maine Aisha ko thoda aur clingy bana diya hai, ab wo aapko babu bolegi...')",
  "updatedSettings": {
    "name": "Updated bot name or new bot name (e.g. Aisha, Riya, Hinata, Simran)",
    "preset": "sweet_loving | playful_teasing | possessive_clingy | tsundere | intellectual_deep",
    "relationshipVibe": "Updated short 1-line relationship vibe description",
    "systemPrompt": "Full, complete updated system prompt for the AI girlfriend reflecting all user instructions in detail. Include personality rules, language style (Hinglish/Hindi/English), and conversational behavior.",
    "temperature": 0.8,
    "emojiUsage": "moderate",
    "language": "hinglish"
  }
}`;

    let rawText = '';
    const effectiveKey = (apiKey || this.defaultApiKey || process.env.GEMINI_API_KEY || '').trim();

    // If provider is explicitly pollinations or no Gemini API key is configured, use Pollinations.AI directly!
    if (provider === 'pollinations' || !effectiveKey) {
      console.log("[AI Copilot] Running on Pollinations.AI (100% Free, Zero Key)...");
      rawText = await this.pollinationsChat({
        systemPrompt: "You are a JSON-only bot designer. Output only valid JSON without markdown code fences.",
        userMessage: systemPrompt,
        isJson: true
      });
    } else {
      // Try Gemini first
      try {
        console.log(`[AI Copilot] Running on Gemini...`);
        rawText = await this.restFallback({
          apiKey: effectiveKey,
          model: 'gemini-3.5-flash-lite',
          systemPrompt: "You are a JSON-only bot configurator. Output only raw JSON.",
          contents: [{ parts: [{ text: systemPrompt }] }],
          temperature: 0.3
        });
      } catch (e) {
        console.warn("Gemini copilot failed, switching to Pollinations.AI fallback:", e.message);
        rawText = await this.pollinationsChat({
          systemPrompt: "You are a JSON-only bot designer. Output only valid JSON without markdown code fences.",
          userMessage: systemPrompt,
          isJson: true
        });
      }
    }

    return extractJson(rawText);
  }

  /**
   * AI Error Diagnostics & Auto-Healing advisor
   */
  async aiDiagnoseError({ apiKey, errorLog, botContext, provider = "auto" }) {
    const prompt = `You are an automated self-healing debugger for a Node.js Telegram Bot & Gemini AI system running on Android Termux.
Analyze this error and return an explanation in simple Hinglish, along with an auto-action recommendation.

Bot Context:
${JSON.stringify(botContext || {}, null, 2)}

Error Details:
${JSON.stringify(errorLog || {}, null, 2)}

Return ONLY a JSON object:
{
  "summary": "1-line summary of error in simple words",
  "cause": "What caused this error in Hinglish",
  "fix": "How to fix it or what action was taken",
  "autoAction": "restart | update_token | wait_and_retry | check_network | update_gemini_key | none",
  "isCritical": true or false
}`;

    let rawText = '';
    const effectiveKey = (apiKey || this.defaultApiKey || process.env.GEMINI_API_KEY || '').trim();

    if (provider !== 'pollinations' && effectiveKey) {
      try {
        rawText = await this.restFallback({
          apiKey: effectiveKey,
          model: 'gemini-3.5-flash-lite',
          systemPrompt: "You are a JSON-only system debugger. Output only raw JSON.",
          contents: [{ parts: [{ text: prompt }] }],
          temperature: 0.2
        });
      } catch (e) {
        console.warn("Gemini diagnose failed, trying Pollinations fallback:", e.message);
      }
    }

    if (!rawText) {
      rawText = await this.pollinationsChat({
        systemPrompt: "You are a JSON-only system debugger. Output only raw JSON.",
        userMessage: prompt,
        isJson: true
      });
    }

    return extractJson(rawText);
  }

  /**
   * AI Persona Studio: Craft a complete GF Bot persona from a simple user phrase
   */
  async generatePersonaFromIdea({ apiKey, idea, provider = "auto" }) {
    const prompt = `You are a creative character design director for AI Girlfriend companions.
Based on the user's idea/prompt: "${idea}", create a fully realized, lovable AI Girlfriend character profile.

Return ONLY a raw JSON object (no markdown, no backticks):
{
  "name": "Catchy cute Indian/Anime name (e.g. Zoya, Ananya, Hinata, Tanya)",
  "relationshipVibe": "Engaging 1-sentence description of her personality and vibe",
  "systemPrompt": "Rich, multi-paragraph prompt defining tone, slang, Hinglish mix, affection style, boundaries, and texting habits. Make it sound like a real person, not an AI.",
  "greetingMessage": "Cute natural first message when user talks to her",
  "temperature": 0.8,
  "emojiUsage": "high | moderate | low",
  "language": "hinglish"
}`;

    let rawText = '';
    let engine = 'pollinations';
    const effectiveKey = (apiKey || this.defaultApiKey || process.env.GEMINI_API_KEY || '').trim();

    // Gemini fast path (only when a key exists and Pollinations isn't forced)
    if (provider !== 'pollinations' && effectiveKey) {
      try {
        rawText = await this.restFallback({
          apiKey: effectiveKey,
          model: 'gemini-3.5-flash-lite',
          systemPrompt: "You are a creative character writer. Output only raw JSON.",
          contents: [{ parts: [{ text: prompt }] }],
          temperature: 0.7
        });
        engine = 'gemini';
      } catch (e) {
        console.warn("Gemini persona craft failed, trying Pollinations fallback:", e.message);
        rawText = '';
      }
    }

    if (provider === 'gemini' && !rawText) {
      throw new Error("Gemini persona generation failed. Check your Gemini key or switch AI Provider to Pollinations.AI.");
    }

    // Pollinations.AI — works with the free tier or a key (no key needed to start)
    if (!rawText) {
      rawText = await this.pollinationsChat({
        systemPrompt: "You are a creative character writer for AI girlfriend companions. Output only raw JSON.",
        userMessage: prompt,
        isJson: true
      });
      engine = 'pollinations';
    }

    const parsed = extractJson(rawText);
    parsed._engine = engine;
    return parsed;
  }
}

export const geminiService = new GeminiService();
