# Free Models Sync -> 9router
### (OpenAgentic.id + Kilo.ai + OpenRouter + Poolside + Gemini + Ollama Cloud + API.airforce + Bazaarlink + Groq + Cerebras + Mistral + Cloudflare AI + NVIDIA NIM + 9router OpenCode Free)

Otomasi sinkronisasi, **live pre-test validasi**, pemeringkatan kapabilitas koding, dan injeksi model AI gratis harian langsung ke dalam **9router** combos (`my9model-free`, `openagentic-free`, `kilo-free`, `openrouter-free`, `poolside-free`, `gemini-free`, `ollama-free`, `airforce-free`, `bazaarlink-free`, dan `opencode-free`).

---

## 🛡️ Fitur Utama: Real-Time Live Pre-Testing + Watchdog Intra-Hari

Sebelum model dimasukkan ke dalam combo 9router, script menjalankan **live pre-test** secara paralel ke endpoint internal 9router (`/api/models/test`):

- **Auto-Drop Promo Berakhir (HTTP 401)**: Membuang model yang promo gratisnya sudah habis (misal: `oc/deepseek-v4-flash-free`, `oc/qwen3.6-plus-free`, `oc/minimax-m3-free`, dsb.).
- **Auto-Drop Model Butuh Subscription / Berbayar (HTTP 403 / 402)**: Membuang model yang membutuhkan langganan berbayar (misal: model pro di Ollama Cloud atau model berbayar di API.airforce / Bazaarlink).
- **Auto-Drop Dead / Timeout / 404**: Membuang model yang tidak merespons atau ID-nya sudah tidak tersedia.
- **Quota Parking (HTTP 429)**: Model yang kuota hariannya sudah habis **tidak dibuang** — dipindah ke combo `my9model-cooldown` agar combo utama tetap 100% aktif. Begitu kuota upstream reset, watchdog memindahkannya balik otomatis.
- **Retry Transient**: Kegagalan sementara (timeout, network error, HTTP 408/429/5xx) di-retest satu kali sebelum divonis, sehingga satu hiccup jaringan tidak membuang model sehat seharian. Kegagalan definitif (401 promo berakhir / 402 berbayar / 403 subscription / 404 hilang) tetap langsung dibuang.
- **Watchdog Refresh (`--refresh`)**: Re-test ringan tiap jam (:35) tanpa scrape ulang — model mati dibuang permanen, model kuota-habis dipindah ke `my9model-cooldown`, model pulihan otomatis balik ke combo utama & combo providernya. Menutup celah "kuota habis di tengah hari".

Hasilnya, combo di 9router selalu **Zero-Latency** di bagian atas, dan model kuota-habis hanya menyentuh IDE paling akhir sampai kuotanya reset.

## 🔁 Usage Feedback Loop (Reliabilitas Dunia Nyata)

Skor ranking bukan hanya benchmark statis. Script membaca tabel `usageHistory` milik 9router (7 hari terakhir) dan memberi **penalti ranking** pada model dengan error rate tinggi di trafik nyata:

| Error Rate | Sampel Minimum | Penalti |
|---|---|---|
| ≥ 50% | ≥ 5 request | −800 |
| ≥ 25% | ≥ 10 request | −400 |

Benchmark tetap sumber utama; penalti hanya menurunkan model yang terbukti sering gagal di dunia nyata.

## 🧪 Agentic Readiness Gate (Super-Combo)

Super-combo (`my9model-free`, `-smart`, `-fast`) hanya menerima model siap-agentic:

- Metadata eksplisit *tool-calling unsupported* → keluar dari super-combo (tetap ada di combo providernya).
- Context window diketahui < 100.000 token → keluar dari super-combo.

Threshold bisa diubah lewat konstanta `AGENTIC_MIN_CONTEXT` di `sync.js`.

## 🎯 Combo Berdasarkan Use-Case

Selain super-combo, dua combo turunan dibuat otomatis:

- **`my9model-smart`**: model thinking/reasoning dan benchmark ≥ 60 (untuk tugas berat).
- **`my9model-fast`**: model non-thinking di luar tier smart (untuk respons cepat).

Keduanya fallback ke top-5 super-combo supaya tidak pernah kosong.

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
8. **Bazaarlink**:
   - Bazaarlink API (`https://bazaarlink.ai/api/v1/models`) via Bazaarlink connection di 9router.
   - Mengambil model berharga 0 / `:free` (misal: `bazaarlink/qwen/qwen3.7-flash:free`).
9. **9router OpenCode Free (`oc/*`)**:
   - Diambil langsung dari routing node OpenCode di 9router.
10. **Groq**:
   - Groq API (`https://api.groq.com/openai/v1/models`) via koneksi `groq` di 9router.
   - Semua model teks free-tier (rate-limited per model), misal `groq/qwen/qwen3.6-27b`.
11. **Cerebras**:
   - Cerebras API (`https://api.cerebras.ai/v1/models`) via koneksi `cerebras` di 9router.
12. **Mistral (La Plateforme "Free mode")**:
   - Mistral API (`https://api.mistral.ai/v1/models`) via koneksi `mistral` di 9router.
   - Deduplikasi alias otomatis (varian tanggal & nama marketing digabung ke id kanonik `-latest`); model berbayar dibuang oleh live pre-test (402/403).
13. **Cloudflare Workers AI** (opsional):
   - Koneksi native `cloudflare-ai` di 9router (apiKey + `accountId` di `providerSpecificData`); fallback koneksi *openai-compatible* ke `api.cloudflare.com` tetap didukung.
   - Hanya model tanpa harga (terbukti 403 di plan gratis untuk model berbayar) dan tanpa flag `require_workers_paid`.
14. **NVIDIA NIM**:
   - NVIDIA NIM API (`https://integrate.api.nvidia.com/v1/models`) via koneksi native `nvidia` di 9router (API key `nvapi-...` dari build.nvidia.com).
   - Free tier untuk member NVIDIA Developer Program (kredit prototyping & testing): katalog tidak memuat kolom harga, jadi semua kandidat teks (embed/rerank/TTS/vision/guardrail dibuang lewat skip pattern) divalidasi oleh live pre-test — model yang butuh pembayaran atau sudah mati otomatis dibuang.

> Catatan: integrasi GitHub Models **tidak ditambahkan** karena layanan ini sudah di-retire GitHub per 30 Juli 2026 (endpoint `models.github.ai` mengembalikan HTTP 410 permanen).

---

## 🚫 Pengecualian / Blacklist Model & Provider (`exclusions.json`)

Anda dapat mengecualikan provider tertentu atau model-model tertentu yang kualitasnya jelek/kurang bagus, model berukuran kecil (*nano*, *tiny*, *xs*, *lfm*), atau non-coding (TTS, embed, video, dsb.) dengan mendaftarkannya di [exclusions.json](file:///home/ian/9router-auto-free/exclusions.json):

```json
{
  "excludedProviders": [
    "api-airforce",
    "cloudflare"
  ],
  "excludedModels": [
    "nano",
    "tiny",
    "laguna-xs",
    "north-mini",
    "lfm",
    "gemma",
    "gpt-oss",
    "bazaarlink/auto:free",
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

- **`excludedProviders`**: Provider yang terdaftar di sini (misal: `"api-airforce"`, `"cloudflare"` — Cloudflare di-exclude karena cuma menyisakan 4 model LoRA lama di plan gratis) akan **langsung di-skip total** (tidak di-query dan tidak dimasukkan ke dalam super-combo `my9model-free`).
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
  2. **Tier A+ / A (Benchmark 65 - 74)**: `deepseek-v4` (74.0), `gemini-3.1-flash-lite` (74.0), `glm-5` (71.0), `step-3.7-flash` (70.0), `qwen3.7-flash` (70.0), `qwen3.6-plus` (69.0), `qwen2.5-coder` (68.5).
  3. **Tier B+ / B (Benchmark 50 - 64)**: `minimax-m3` (62.5), `minimax-m2.5` (61.0), `nemotron-3-ultra` (58.5), `hy3` (54.0), `mimo-v2.5` (52.0).
  4. **Tier C+ / C (Benchmark 40 - 49)**: `laguna-s-2.1` (48.0), `ling-3.0-flash` (47.0), `laguna-xs-2.1` (46.0), `lfm-2.5-2.6b` (44.0), `north-mini-code` (43.0).
  5. **Heuristic Fallback**: Model baru yang belum terdaftar di database benchmark otomatis dinilai berdasarkan formula generasi versi, keluarga arsitektur (Claude/GPT/DeepSeek/Poolside/Gemini/Ollama), ukuran parameter (70B/32B/8B), dan context window.

---

## 🎯 Prioritas Model Kustom (`priorities.json`)

Anda dapat menentukan sendiri urutan prioritas model favorit di [`priorities.json`](file:///home/ian/9router-auto-free/priorities.json). Nama tidak harus sama persis (cukup *keyword* / *substring* mirip):

```json
[
  "sonnet-4.5",
  "gemini-3.7",
  "deepseek-r1",
  "step-3.7",
  "qwen3.7"
]
```

- **Urutan Ranking**: Model yang cocok dengan item pertama (`"sonnet-4.5"`) akan ditempatkan di posisi paling atas (#1), item kedua di (#2), dst.
- **Latency Prioritization untuk Model Mirip/Setara**: Jika ada beberapa model yang cocok dengan aturan yang sama (misal ada model `gemini-3.7` dari beberapa provider), sistem otomatis menaruh **model dengan latensi tercepat di urutan teratas**.
- **Otomatis Fallback**: Model-model lain yang tidak disebutkan di `priorities.json` tetap diurutkan di bawahnya secara otomatis berdasarkan skor kapabilitas benchmark coding.

---

## ⚡ Prioritas Kecepatan Koneksi (Latency Tie-Breaker)

Ketika dua atau lebih model memiliki **skor benchmark atau prioritas yang sama**, sistem secara otomatis mengukur waktu respons riil (*round-trip latency* dalam milidetik) dan **memprioritaskan model dengan koneksi paling cepat di urutan teratas**.

---

## 🔔 Notifikasi Delta Sync (Opsional)

Setiap sync/watchdog selesai, ringkasan perubahan (model masuk/keluar) bisa dikirim ke Telegram atau Discord. Cukup set environment variable sebelum menjalankan script (atau di unit systemd):

```bash
export TELEGRAM_BOT_TOKEN="123:abc"   # dari @BotFather
export TELEGRAM_CHAT_ID="123456789"   # dari @userinfobot
# dan/atau
export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
```

Tidak diset → notifikasi dilewati diam-diam, sync tetap jalan normal.

## ⚡ Perintah & Penggunaan

```bash
# Sinkronisasi harian dengan live pre-testing, benchmark ranking & latency tie-breaker
npm run sync

# Watchdog intra-hari: re-test anggota combo, parkir kuota-habis di my9model-cooldown, buang model mati
npm run refresh

# Jalankan simulasi (Dry Run) tanpa mengubah database
npm run dry-run

# Perbarui database benchmark coding secara live
# (EvalPlus + SWE-bench Verified + LiveCodeBench; baseline terkalibrasi selalu menang)
npm run update-benchmarks

# Sinkronisasi harian sekaligus update benchmark live
node sync.js --live-benchmarks

# Pasang scheduler otomatis:
#   systemd user timers  - daily 00:05 full sync (Persistent=true, catch-up setelah boot)
#                          hourly :35 watchdog refresh (--refresh)
#                          Monday 04:17 benchmark update
#   fallback crontab     - jika systemd tidak tersedia
npm run setup-cron

# Jalankan Unit Test Self-Check
npm test
```

---

## 🔌 Menggunakan Combos di IDE / Tool AI

Endpoint 9router: `http://localhost:20128/v1`

- **`my9model-free`**: Super-combo **100% model aktif** dari seluruh provider, terurut prioritas benchmark koding & latensi tercepat.
- **`my9model-cooldown`**: Parkiran model yang sedang kuota-habis (429), tetap terurut kualitas. Watchdog memindahkannya balik ke combo utama otomatis begitu lolos re-test — tidak perlu tunggu sync tengah malam.
- Combo per-provider (`openagentic-free`, `groq-free`, dst.) memakai strategi berbeda: **hanya model yang sedang hidup**. Model kuota-habis dikeluarkan agar daftar di IDE selalu 100% bisa dipakai; saat kuotanya reset dan lolos re-test watchdog berikutnya, model masuk lagi otomatis (recovery pool: `candidates-state.json`).
- **`my9model-smart`**: Subset thinking/reasoning & benchmark tinggi dari super-combo.
- **`my9model-fast`**: Subset cepat non-thinking dari super-combo.
- **`openagentic-free`**: Combo model gratis OpenAgentic.id yang aktif.
- **`kilo-free`**: Combo model gratis Kilo.ai yang aktif.
- **`openrouter-free`**: Combo model gratis OpenRouter yang aktif.
- **`poolside-free`**: Combo model gratis Poolside yang aktif.
- **`gemini-free`**: Combo model gratis Google Gemini yang aktif.
- **`ollama-free`**: Combo model gratis Ollama Cloud yang aktif.
- **`airforce-free`**: Combo model gratis API.airforce yang aktif (jika tidak di-exclude).
- **`bazaarlink-free`**: Combo model gratis Bazaarlink yang aktif.
- **`opencode-free`**: Combo model gratis OpenCode (`oc/*`) yang aktif.
- **`groq-free`**: Combo model gratis Groq yang aktif.
- **`cerebras-free`**: Combo model gratis Cerebras yang aktif.
- **`mistral-free`**: Combo model gratis Mistral yang aktif.
- **`cloudflare-free`**: Combo model gratis Cloudflare Workers AI yang aktif (koneksi native `cloudflare-ai`).
- **`nvidia-free`**: Combo model gratis NVIDIA NIM yang aktif (koneksi native `nvidia`).
