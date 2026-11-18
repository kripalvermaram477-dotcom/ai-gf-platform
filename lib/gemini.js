import { GoogleGenAI } from '@google/genai';

const RELIABLE_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-flash-latest',
  'gemini-2.5-pro',
  'gemini-2.5-flash'
];

export class GeminiService {
  constructor(defaultApiKey = '') {
    this.defaultApiKey = defaultApiKey;
    this.clientCache = new Map();
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
   * Pollinations.AI: 100% Free Unlimited AI (Zero API key needed)
   */
  async pollinationsChat({ systemPrompt, history = [], userMessage, temperature = 0.8, isJson = false }) {
    console.log("[AI Engine] Querying Pollinations.AI (Free Unlimited)...");
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    for (const item of history) {
      if (item.parts && item.parts.length > 0) {
        messages.push({
          role: item.role === 'model' ? 'assistant' : 'user',
          content: item.parts.map(p => p.text || '').join('\n')
        });
      }
    }
    messages.push({ role: 'user', content: userMessage });

    const payload = {
      messages,
      model: 'openai',
      seed: Math.floor(Math.random() * 1000000)
    };
    if (isJson) {
      payload.jsonMode = true;
    }

    const res = await fetch('https://text.pollinations.ai/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Pollinations API error (${res.status}): ${errBody}`);
    }

    const text = await res.text();
    return text.trim() || '❤️';
  }

  /**
   * Generate conversational GF response for a Telegram message with model cascading & Pollinations fallback
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

    // If provider is explicitly pollinations or no Gemini key is provided, use Pollinations
    if (provider === 'pollinations' || !effectiveKey) {
      return await this.pollinationsChat({ systemPrompt, history, userMessage, temperature });
    }

    // Build contents array compatible with Gemini
    const contents = [];
    for (const item of history) {
      if (item.parts && item.parts.length > 0) {
        contents.push({
          role: item.role === 'model' ? 'model' : 'user',
          parts: item.parts.map(p => ({ text: p.text || '' }))
        });
      }
    }
    contents.push({
      role: 'user',
      parts: [{ text: userMessage }]
    });

    // Try Gemini models first
    const modelsToTry = [model, ...RELIABLE_MODELS.filter(m => m !== model)];
    for (const currentModel of modelsToTry) {
      try {
        return await this.restFallback({
          apiKey: effectiveKey,
          model: currentModel,
          systemPrompt,
          contents,
          temperature
        });
      } catch (err) {
        console.warn(`[Gemini Fallback] Model ${currentModel} failed: ${err.message}. Trying next...`);
      }
    }

    // If all Gemini models fail (rate limit, quota exceeded), automatically fallback to Pollinations.AI!
    console.warn("[Gemini Fallback] All Gemini models exhausted. Switching to Pollinations.AI 100% Free fallback!");
    return await this.pollinationsChat({ systemPrompt, history, userMessage, temperature });
  }

  /**
   * Direct REST call for Gemini API
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
        maxOutputTokens: 600
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Gemini API error (${res.status}): ${errBody}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const textPart = candidate?.content?.parts?.[0]?.text;
    if (!textPart) {
      throw new Error("No response generated from Gemini API");
    }
    return textPart.trim();
  }

  /**
   * AI Copilot: Natural language instruction to customize or reconfigure a bot
   */
  async aiModifyBot({ apiKey, currentBot, userInstruction, allBots = [] }) {
    const systemPrompt = `You are the Lead AI Bot Architect and Engineer inside an AI Girlfriend Bot Manager system.
The user wants to customize or modify their bot's behavior, personality, or configuration using natural language instructions in Hinglish/English.
You need to analyze the user's instruction and current bot settings, and output a JSON object describing the modified settings and a warm, clear explanation in Hinglish.

Current Bot Configuration:
${JSON.stringify(currentBot?.settings || {}, null, 2)}

User Instruction: "${userInstruction}"

Your response MUST BE valid raw JSON ONLY (no markdown code blocks, no other text) with this structure:
{
  "explanation": "Brief explanation in Hinglish of what you updated (e.g. 'Maine Aisha ko thoda aur clingy bana diya hai, ab wo aapko babu bolegi...')",
  "updatedSettings": {
    "name": "Updated bot name or current name",
    "relationshipVibe": "Updated short vibe description",
    "systemPrompt": "Full, complete updated system prompt for the AI girlfriend reflecting all user instructions",
    "temperature": 0.8,
    "emojiUsage": "moderate | high | low",
    "language": "hinglish | hindi | english"
  }
}`;

    let rawText = '';
    const effectiveKey = (apiKey || this.defaultApiKey || process.env.GEMINI_API_KEY || '').trim();

    if (effectiveKey) {
      try {
        rawText = await this.restFallback({
          apiKey: effectiveKey,
          model: 'gemini-3.5-flash-lite',
          systemPrompt: "You are a JSON-only bot configurator. Output only raw JSON.",
          contents: [{ parts: [{ text: systemPrompt }] }],
          temperature: 0.3
        });
      } catch (e) {
        console.warn("Gemini copilot failed, trying Pollinations fallback:", e.message);
      }
    }

    if (!rawText) {
      rawText = await this.pollinationsChat({
        systemPrompt: "You are a JSON-only bot configurator. Output only raw JSON.",
        userMessage: systemPrompt,
        isJson: true
      });
    }

    let cleaned = rawText.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();
    return JSON.parse(cleaned);
  }

  /**
   * AI Error Diagnostics & Auto-Healing advisor
   */
  async aiDiagnoseError({ apiKey, errorLog, botContext }) {
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

    if (effectiveKey) {
      try {
        rawText = await this.restFallback({
          apiKey: effectiveKey,
          model: 'gemini-3.5-flash-lite',
          systemPrompt: "You are a JSON-only system debugger. Output only raw JSON.",
          contents: [{ parts: [{ text: prompt }] }],
          temperature: 0.2
        });
      } catch (e) {
        console.warn("Gemini diagnose failed, trying Pollinations:", e.message);
      }
    }

    if (!rawText) {
      rawText = await this.pollinationsChat({
        systemPrompt: "You are a JSON-only system debugger. Output only raw JSON.",
        userMessage: prompt,
        isJson: true
      });
    }

    let cleaned = rawText.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();
    return JSON.parse(cleaned);
  }

  /**
   * AI Persona Studio: Craft a complete GF Bot persona from a simple user phrase
   */
  async generatePersonaFromIdea({ apiKey, idea }) {
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
    const effectiveKey = (apiKey || this.defaultApiKey || process.env.GEMINI_API_KEY || '').trim();

    if (effectiveKey) {
      try {
        rawText = await this.restFallback({
          apiKey: effectiveKey,
          model: 'gemini-3.5-flash-lite',
          systemPrompt: "You are a creative character writer. Output only raw JSON.",
          contents: [{ parts: [{ text: prompt }] }],
          temperature: 0.7
        });
      } catch (e) {
        console.warn("Gemini persona craft failed, trying Pollinations:", e.message);
      }
    }

    if (!rawText) {
      rawText = await this.pollinationsChat({
        systemPrompt: "You are a creative character writer. Output only raw JSON.",
        userMessage: prompt,
        isJson: true
      });
    }

    let cleaned = rawText.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();
    return JSON.parse(cleaned);
  }
}

export const geminiService = new GeminiService();
