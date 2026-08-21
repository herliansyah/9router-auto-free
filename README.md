# Free Models Sync -> 9router
### (OpenAgentic.id + Kilo.ai + OpenRouter + Poolside + Gemini + Ollama Cloud + API.airforce + 9router OpenCode Free)

Otomasi sinkronisasi, **live pre-test validasi**, pemeringkatan kapabilitas koding, dan injeksi model AI gratis harian langsung ke dalam **9router** combos (`my9model-free`, `openagentic-free`, `kilo-free`, `openrouter-free`, `poolside-free`, `gemini-free`, `ollama-free`, `airforce-free`, dan `opencode-free`).

---

## 🛡️ Fitur Utama: Real-Time Live Pre-Testing

Sebelum model dimasukkan ke dalam combo 9router, script menjalankan **live pre-test** secara paralel (5 worker) ke endpoint internal 9router (`/api/models/test`):

- **Auto-Drop Promo Berakhir (HTTP 401)**: Membuang model yang promo gratisnya sudah habis (misal: `oc/deepseek-v4-flash-free`, `oc/qwen3.6-plus-free`, `oc/minimax-m3-free`, dsb.).
- **Auto-Drop Model Butuh Subscription / Berbayar (HTTP 403 / 402)**: Membuang model yang membutuhkan langganan berbayar (misal: model pro di Ollama Cloud atau model berbayar di API.airforce seperti `deepseek-v3.2`).
- **Auto-Drop Dead / Timeout / 404**: Membuang model yang tidak merespons atau ID-nya sudah tidak tersedia.
- **Strict Zero-Latency Quota Handling (HTTP 429)**: Membuang model yang kuota hariannya sudah habis (`100/100 quota exceeded` atau upstream rate-limited) agar IDE langsung merespons di percobaan pertama tanpa delay fallback. Model akan otomatis dimasukkan kembali saat kuota direset pada sync jam 00:05 WIB.

Hasilnya, combo di 9router selalu **bersih 100% dan Zero-Latency** dari model mati, berbayar, ataupun yang kuota hariannya sudah habis.

---

## 🌟 Sumber Kandidat Model Gratis

1. **OpenAgentic.id**:
   - Web Landing Page (tier `free` / hero promo) + Catalog API (`/v1/models`) via akun `herliansyah@gmail.com`.
   - Mengambil kandidat model gratis (misal: `openagentic/assistant-sonnet-4.5-thinking`, `openagentic/claude-sonnet-4.5`, `openagentic/glm-5`, dsb.).
2. **Kilo.ai (KiloCode)**:
   - Kilo.ai Gateway API (`https://api.kilo.ai/api/gateway/models`) via token OAuth KiloCode.
   - Mengambil kandidat model berharga 0 / `:free` (misal: `kc/stepfun/step-3.7-flash:free`, `kc/nvidia/nemotron-3-super-120b-a12b:free`, dsb.).
3. **OpenRouter**:
   - OpenRouter API (`https://openrouter.ai/api/v1/models`) via OpenRouter connection di 9router.
   - Mengambil model berharga 0 / `:free` (misal: `openrouter/nvidia/nemotron-3-nano-30b-a3b:free`, `openrouter/liquid/lfm-2.5-2.6b:free`, `openrouter/cohere/north-mini-code:free`, dsb.).
4. **Poolside**:
   - Poolside Inference API (`https://inference.poolside.ai/v1/models`) via Poolside connection di 9router.
   - Mengambil model berharga 0 / `is_free: true` (misal: `poolside/poolside/laguna-s-2.1`, `poolside/poolside/laguna-xs-2.1`).
5. **Google Gemini (Google AI Studio Free Tier)**:
   - Google Generative Language API (`https://generativelanguage.googleapis.com/v1beta/models`) via Gemini API Key di 9router.
   - Mengambil model free-tier (misal: `gemini/gemini-3.7-flash`, `gemini/gemini-3.6-flash`, `gemini/gemini-3.5-flash`, `gemini/gemini-3.5-flash-lite`, `gemini/gemini-3.1-flash-lite`).
6. **Ollama Cloud**:
   - Ollama Cloud API (`https://api.ollama.com/v1/models`) via Ollama connection di 9router.
   - Mengambil model gratis tanpa subscription (misal: `ollama/minimax-m3`, `ollama/gpt-oss:120b`, `ollama/gpt-oss:20b`, `ollama/nemotron-3-ultra`, `ollama/gemma4:31b`).
7. **API.airforce**:
   - API.airforce API (`https://api.airforce/v1/models`) via API.airforce connection di 9router.
   - Mengambil model berlabel `tier: "free"` (misal: `api-airforce/qwen3-30b-a3b-fp8`, `api-airforce/llama-3.3-70b-instruct-fp8-fast`, `api-airforce/devstral-latest`, `api-airforce/codestral-latest`, `api-airforce/gemma-4-26b-a4b-it`).
8. **9router OpenCode Free (`oc/*`)**:
   - Diambil langsung dari routing node OpenCode di 9router.

---

## 🚫 Pengecualian / Blacklist Model & Provider (`exclusions.json`)

Anda dapat mengecualikan provider tertentu atau model-model tertentu yang kualitasnya jelek/kurang bagus, model berukuran kecil (*nano*, *tiny*, *xs*, *lfm*), atau non-coding (TTS, embed, video, dsb.) dengan mendaftarkannya di [exclusions.json](file:///home/ian/openagentic-free-sync/exclusions.json):

```json
{
  "excludedProviders": [
    "api-airforce"
  ],
  "excludedModels": [
    "nano",
    "tiny",
    "laguna-xs",
    "north-mini",
    "lfm",
    "gemma",
    "gpt-oss",
    "stealth/ox-alpha",
    "dots-studio",
    "openrouter/free",
    "content-safety",
    "tts",
    "embed",
    "image",
    "flux",
    "wan2",
    "video",
    "lyria",
    "kilo-auto/free"
  ]
}
```

- **`excludedProviders`**: Provider yang terdaftar di sini (misal: `"api-airforce"`) akan **langsung di-skip total** (tidak di-query dan tidak dimasukkan ke dalam super-combo `my9model-free`).
- Anda juga dapat mengecualikan provider via parameter CLI: `node sync.js --exclude-provider=api-airforce,ollama`.
- **`excludedModels`**: Model yang cocok dengan aturan substring/ID (seperti model *nano*, *tiny*, *xs*, *lfm*, *gemma*, *gpt-oss*, non-coding) akan **otomatis di-skip sejak awal** sebelum live test dijalankan, sehingga super-combo `my9model-free` **hanya diisi oleh model-model frontier & high-tier coding (Tier S/A/B+)**.

---

## 🧠 Pemeringkatan Berbasis Benchmark Valid (`benchmarks.json`)

Skor kapabilitas model dihitung secara empiris dengan mengambil data langsung dari leaderboard coding publik (**EvalPlus HumanEval+ / MBPP+**, **LiveCodeBench**, dan **SWE-bench Verified**):

- **Live Benchmark Updater (`update-benchmarks.js`)**:
  - Mengambil data skor valid secara langsung dari repository resmi [EvalPlus Leaderboard](https://raw.githubusercontent.com/evalplus/evalplus.github.io/main/results.json) (125+ model coding).
  - Menggabungkannya dengan *calibrated baseline* untuk model-model frontier/proprietary (seperti Gemini 3.7 Flash, Claude Sonnet 4.5 Thinking, DeepSeek R1, DeepSeek V4 Flash, GLM-5, Step 3.7 Flash).
  - Menyimpan cache terpadu ke [`benchmarks.json`](file:///home/ian/openagentic-free-sync/benchmarks.json) (150+ model).

- **Tingkatan Skor (Tiering)**:
  1. **Tier S+ / S (Benchmark 75 - 85+)**: `gemini-3.1-pro-preview` (85.0), `assistant-sonnet-4.5-thinking` (84.0), `gemini-3.7-flash` (83.0), `claude-sonnet-4.5` (82.5), `gemini-3.6-flash` (81.0), `gemini-3.5-flash` (79.0), `deepseek-r1` (76.5), `gemini-3.5-flash-lite` (76.0).
  2. **Tier A+ / A (Benchmark 65 - 74)**: `deepseek-v4` (74.0), `gemini-3.1-flash-lite` (74.0), `glm-5` (71.0), `step-3.7-flash` (70.0), `qwen3.6-plus` (69.0), `qwen2.5-coder` (68.5).
  3. **Tier B+ / B (Benchmark 50 - 64)**: `minimax-m3` (62.5), `minimax-m2.5` (61.0), `nemotron-3-ultra` (58.5), `hy3` (54.0), `mimo-v2.5` (52.0).
  4. **Tier C+ / C (Benchmark 40 - 49)**: `laguna-s-2.1` (48.0), `ling-3.0-flash` (47.0), `laguna-xs-2.1` (46.0), `lfm-2.5-2.6b` (44.0), `north-mini-code` (43.0).
  5. **Heuristic Fallback**: Model baru yang belum terdaftar di database benchmark otomatis dinilai berdasarkan formula generasi versi, keluarga arsitektur (Claude/GPT/DeepSeek/Poolside/Gemini/Ollama), ukuran parameter (70B/32B/8B), dan context window.

---

## ⚡ Prioritas Kecepatan Koneksi (Latency Tie-Breaker)

Ketika dua atau lebih model memiliki **skor benchmark yang sama**, sistem secara otomatis mengukur waktu respons riil (*round-trip latency* dalam milidetik) dan **memprioritaskan model dengan koneksi paling cepat di urutan teratas**.

---

## ⚡ Perintah & Penggunaan

```bash
# Sinkronisasi harian dengan live pre-testing, benchmark ranking & latency tie-breaker
npm run sync

# Jalankan simulasi (Dry Run) tanpa mengubah database
npm run dry-run

# Sinkronisasi cepat tanpa pre-test
npm run sync:fast
# atau: node sync.js --skip-test

# Perbarui database benchmark coding secara live dari leaderboard (EvalPlus / SWE-bench)
npm run update-benchmarks

# Sinkronisasi harian sekaligus update benchmark live
node sync.js --live-benchmarks

# Jalankan Unit Test Self-Check
npm test

# Pasang cron harian otomatis (00:05 WIB)
npm run setup-cron
```

---

## 🔌 Menggunakan Combos di IDE / Tool AI

Endpoint 9router: `http://localhost:20128/v1`

- **`my9model-free`**: Super-combo seluruh model gratis aktif dari seluruh provider, terurut prioritas benchmark koding & latensi tercepat.
- **`openagentic-free`**: Combo model gratis OpenAgentic.id yang aktif.
- **`kilo-free`**: Combo model gratis Kilo.ai yang aktif.
- **`openrouter-free`**: Combo model gratis OpenRouter yang aktif.
- **`poolside-free`**: Combo model gratis Poolside yang aktif.
- **`gemini-free`**: Combo model gratis Google Gemini yang aktif.
- **`ollama-free`**: Combo model gratis Ollama Cloud yang aktif.
- **`airforce-free`**: Combo model gratis API.airforce yang aktif (jika tidak di-exclude).
- **`opencode-free`**: Combo model gratis OpenCode (`oc/*`) yang aktif.
