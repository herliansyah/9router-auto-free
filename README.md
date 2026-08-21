# Free Models Sync -> 9router
### (OpenAgentic.id + Kilo.ai + OpenRouter + 9router OpenCode Free)

Otomasi sinkronisasi, **live pre-test validasi**, pemeringkatan kapabilitas koding, dan injeksi model AI gratis harian langsung ke dalam **9router** combos (`my9model-free`, `openagentic-free`, `kilo-free`, `openrouter-free`, dan `opencode-free`).

---

## 🛡️ Fitur Utama: Real-Time Live Pre-Testing

Sebelum model dimasukkan ke dalam combo 9router, script menjalankan **live pre-test** secara paralel (5 worker) ke endpoint internal 9router (`/api/models/test`):

- **Auto-Drop Promo Berakhir (HTTP 401)**: Membuang model yang promo gratisnya sudah habis (misal: `oc/deepseek-v4-flash-free`, `oc/qwen3.6-plus-free`, `oc/minimax-m3-free`, dsb.).
- **Auto-Drop Model Berbayar / Butuh Kredit (HTTP 402)**: Membuang model yang membutuhkan saldo (misal: `kc/stealth/ox-alpha`).
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
4. **9router OpenCode Free (`oc/*`)**:
   - Diambil langsung dari routing node OpenCode di 9router.

---

## 🚫 Pengecualian / Blacklist Model (`exclusions.json`)

Anda dapat mengecualikan model-model tertentu yang kualitasnya jelek/kurang bagus atau model non-coding (TTS, embed, video, dsb.) dengan mendaftarkannya di [exclusions.json](file:///home/ian/openagentic-free-sync/exclusions.json). 

Sistem akan otomatis mencocokkan **ID lengkap** maupun **kata kunci**:

```json
[
  "stealth/ox-alpha",
  "dots-studio/dots-3-note-preview:free",
  "openrouter/free",
  "content-safety",
  "tts",
  "embed",
  "image",
  "flux",
  "wan2",
  "video",
  "lyria"
]
```

Model yang cocok dengan aturan di atas akan **otomatis di-skip sejak awal** sebelum live test dijalankan, sehingga menghemat waktu dan kuota.

---

## 🧠 Pemeringkatan Berbasis Benchmark Valid (`benchmarks.json`)

Skor kapabilitas model ditentukan langsung dari database acuan benchmark empiris software engineering terpercaya (**SWE-bench Verified**, **LiveCodeBench**, **EvalPlus**, dan **Aider Leaderboard**):

1. **Tier S+ / S (Benchmark 75 - 85+)**: `assistant-sonnet-4.5-thinking` (84.0), `claude-sonnet-4.5` (82.5), `deepseek-r1` (76.5).
2. **Tier A+ / A (Benchmark 65 - 74)**: `deepseek-v4` (74.0), `glm-5` (71.0), `step-3.7-flash` (70.0), `qwen3.6-plus` (69.0), `qwen2.5-coder` (68.5).
3. **Tier B+ / B (Benchmark 50 - 64)**: `minimax-m3` (62.5), `minimax-m2.5` (61.0), `nemotron-3-ultra` (58.5), `hy3` (54.0), `mimo-v2.5` (52.0).
4. **Tier C+ / C (Benchmark 40 - 49)**: `laguna-s-2.1` (48.0), `ling-3.0-flash` (47.0), `laguna-xs-2.1` (46.0), `lfm-2.5-2.6b` (44.0), `north-mini-code` (43.0).
5. **Heuristic Fallback**: Model baru yang belum terdaftar di database benchmark otomatis dinilai berdasarkan formula generasi versi dan tag spesialisasi arsitektur.

---

## ⚡ Perintah & Penggunaan

```bash
# Sinkronisasi harian dengan live pre-testing & benchmark ranking
npm run sync

# Jalankan simulasi (Dry Run) tanpa mengubah database
npm run dry-run

# Sinkronisasi cepat tanpa pre-test
node sync.js --skip-test

# Perbarui database benchmark coding
npm run update-benchmarks

# Jalankan Unit Test Self-Check
npm test

# Pasang cron harian otomatis (00:05 WIB)
npm run setup-cron
```

---

## 🔌 Menggunakan Combos di IDE / Tool AI

Endpoint 9router: `http://localhost:20128/v1`

- **`my9model-free`**: Super-combo seluruh model gratis yang terbukti aktif dari semua provider, terurut prioritas koding.
- **`openagentic-free`**: Combo model gratis OpenAgentic.id yang aktif.
- **`kilo-free`**: Combo model gratis Kilo.ai yang aktif.
- **`openrouter-free`**: Combo model gratis OpenRouter yang aktif.
- **`opencode-free`**: Combo model gratis OpenCode (`oc/*`) yang aktif.
