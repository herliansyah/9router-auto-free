<p align="center">
  <strong>English</strong> | <a href="README.id.md">Bahasa Indonesia</a>
</p>

# 9router-auto-free

Automated intelligent system that aggregates **100+ free AI coding models** from top providers, validates them via **live pre-tests** directly through 9router, ranks them by empirical coding benchmarks & latency, and injects them into ready-to-use 9router combos (`my9model-free`, `my9model-smart`, `my9model-fast`, `openagentic-free`, `kilo-free`, etc.) — allowing Cursor, Claude Code, Cline, and your IDEs to always use active, high-quality, and lowest-latency free AI models without key management headaches.

> **Security Note**: This script reads provider credentials from **connections already configured in your 9router SQLite database**. No API keys are stored in or transmitted by this repository.

---

## 🌐 Modern Interactive Web Management Console

9router-auto-free includes a built-in dark-themed **Web Management Console** on port `20129`:

- **Unified Authentication**: Login using the same password as your 9router dashboard.
- **Top 5 Leaderboard**: Real-time ranking of top free coding models with benchmark scores & latencies.
- **Provider Catalog & Auto-Sync**: Manage provider connections and toggle auto-discovery per provider.
- **Visual Exclusions & Priorities**: Manage `exclusions.json` and `priorities.json` with tag-based UI or raw JSON editor.
- **Real-Time Streaming CLI Console**: Execute *Sync*, *Dry Run*, *Watchdog Refresh*, and *Scheduler Setup* with live SSE log streaming.
- **Full Bilingual Support**: Instant toggle between **English 🇬🇧** and **Bahasa Indonesia 🇮🇩**.

```bash
# Start the Web Console
npx 9router-auto-free --web
# Or locally: npm run web
```
Access in your browser: `http://localhost:20129`

---

## 🚀 Installation & Usage via NPM / NPX

### 1. Zero-Install (via NPX)

```bash
# Run Full Daily Sync immediately
npx 9router-auto-free

# Launch Web Console Dashboard
npx 9router-auto-free --web

# Simulate sync without modifying SQLite database (Dry Run)
npx 9router-auto-free --dry-run

# Intra-day watchdog refresh (check quota & HTTP 429 status)
npx 9router-auto-free --refresh

# Setup automated daily & hourly scheduling
npx 9router-auto-free --setup-cron
```

### 2. Global Installation

```bash
npm install -g 9router-auto-free

# Run commands directly from terminal
9router-auto-free
9router-auto-free --web
9router-auto-free --dry-run
```

---

## ⚙️ How It Works (6-Stage Automated Pipeline)

1. **Scrape & Discover**: Fetches candidate free model lists across 15+ built-in providers and active dynamic SQLite connections.
2. **Exclusions Filter**: Discards non-coding models (TTS, embeddings, vision-only, nano models) and blacklisted providers.
3. **Parallel Live Pre-Test**: Tests each model candidate through 9router's internal endpoints (`POST /api/models/test`) to measure real HTTP status and latency.
4. **Verdict & Auto-Cooldown**: HTTP 200 models pass; rate-limited (429) models are parked in `my9model-cooldown`; dead models are pruned.
5. **Coding Quality Ranking**: Ranks models by empirical benchmarks (EvalPlus, SWE-bench), adjusted by usage reliability penalties and latency.
6. **SQLite Injection**: Writes the ranked model lists directly to 9router SQLite database. Your IDE immediately benefits from fresh models.

---

## 📦 Managed Combos

### 🌟 Unified Super Combos (Cross-Provider)

| Combo | Description & Recommendation |
|---|---|
| `my9model-free` | **Main super combo**: Comprehensive pool of all active free models across all providers, ranked with top coding capability and lowest latency first. Best for daily programming. |
| `my9model-smart` | **High reasoning & thinking tier**: Dedicated to thinking models (Claude 3.7 Sonnet Thinking, Qwen Coder, DeepSeek R1) or highest coding benchmarks. Best for complex architectures & tough debugging. |
| `my9model-fast` | **Ultra-low latency tier**: Lightning-fast models (Groq, Cerebras, Kilo, etc.) with sub-second response times. Perfect for autocomplete and inline code completions. |
| `my9model-cooldown` | **Rate-limit quarantine (429)**: Holding area for models whose daily quota is exhausted. The hourly watchdog automatically restores them once quotas reset. |

### 🔌 Provider-Specific Combos

| Provider | Prefix | Output Combo |
|---|---|---|
| **OpenAgentic.id** | `openagentic` | `openagentic-free` |
| **Kilo.ai (KiloCode)** | `kc` | `kilo-free` |
| **OpenRouter** | `openrouter` | `openrouter-free` |
| **Google Gemini** | `gemini` | `gemini-free` |
| **Groq** | `groq` | `groq-free` |
| **Cerebras** | `cerebras` | `cerebras-free` |
| **Mistral AI** | `mistral` | `mistral-free` |
| **Cloudflare Workers AI** | `cloudflare-ai` | `cloudflare-free` |
| **Poolside** | `poolside` | `poolside-free` |
| **Ollama Cloud** | `ollama` | `ollama-free` |
| **API.airforce** | `api-airforce` | `airforce-free` |
| **Bazaarlink** | `bazaarlink` | `bazaarlink-free` |
| **B.ai** | `b-ai` | `b.ai-free` |
| **NVIDIA NIM** | `nvidia` | `nvidia-free` |
| **9router OpenCode** | `oc` | `opencode-free` |
| **Dynamic OpenAI Nodes** | `<prefix>` | `<prefix>-free` |

---

## 💻 Connecting to IDEs & AI Coding Tools

Point your OpenAI-Compatible client to 9router:

- **OpenAI Base URL**: `http://localhost:20128/v1`
- **API Key**: API Key from your 9router Dashboard
- **Model Name**: `my9model-free` (or `my9model-smart`, `my9model-fast`)

### Quick Setup Examples:
- **Claude Code**:
  ```bash
  claude --model openai/my9model-free
  ```
- **Cursor**:
  - Open *Settings* &rarr; *Models* &rarr; *OpenAI API*.
  - Set Base URL to `http://localhost:20128/v1` and Model to `my9model-free`.
- **Aider**:
  ```bash
  export OPENAI_API_BASE=http://localhost:20128/v1
  aider --model openai/my9model-free
  ```

---

## ⏰ Automated Scheduling

Enable the automated daily sync (00:05) and hourly quota watchdog (:35) with:

```bash
npx 9router-auto-free --setup-cron
```
*(On Linux it automatically installs Systemd User Timers; on macOS/Windows/WSL it installs crontab).*

---

## 📄 License & Author

Created by **[Herliansyah](https://github.com/herliansyah)**.

Licensed under the [MIT License](LICENSE).
