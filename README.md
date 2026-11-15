# 💖 Telegram AI Girlfriend Platform & Web Manager

Termux (Android) ke liye optimized Multi-Bot Telegram AI Girlfriend Management system with Self-Healing error handling aur AI Copilot.

## 🚀 Quick Start

1. Terminal me project directory me jayein:
   ```bash
   cd /data/user/0/com.termux/files/home/.gemini/antigravity-cli/scratch/telegram-ai-gf-manager
   ```

2. Server start karein:
   ```bash
   pnpm start
   ```

3. Apne mobile browser me open karein:
   ```
   http://localhost:3000
   ```

---

## ✨ Features

- **Multi-Bot Support**: Ek hi dashboard se alag alag Telegram AI bots connect aur simultaneously run karein.
- **Easy Connect**: Sirf Telegram BotFather ka token paste karein, bot connect ho jayega.
- **Personality Presets**:
  - Aisha: Sweet, loving & caring (Hinglish)
  - Riya: Playful, sassy & teasing
  - Simran: Clingy, protective & loves attention (babu, shona)
  - Kavya: Tsundere (Secretly loves you)
  - Meera: Deep, soulful & late night talks
- **AI Bot Copilot**: Natural language me instruction dein (e.g. *"Aisha ko bolo ki wo mujhe babu bulaye aur jealous ho"*), Gemini AI bot ke prompts automatically update kar dega.
- **Auto Error-Fix Engine**:
  - Automatically resolves Telegram 409 conflict errors (duplicate polling).
  - Handles 401 invalid token errors gracefully.
  - Recovers from mobile network disconnections with auto-reconnect.
  - Live real-time error log streamer with **1-Click AI Diagnosis & Fix**.
