# 9router-auto-free

Otomasi harian untuk mengumpulkan **model AI gratis** dari 15 sumber provider, memvalidasinya dengan **live pre-test** langsung melalui 9router, mengurutkannya berdasarkan kapabilitas coding, lalu menyuntikkannya ke dalam combo 9router (`my9model-free`, `openagentic-free`, `kilo-free`, dll.) — sehingga IDE atau tool AI Anda selalu mendapat daftar model gratis yang benar-benar aktif, berkualitas, dan tercepat.

> Script ini membaca kredensial provider dari **koneksi yang sudah dikonfigurasi di 9router**. Tidak ada API key yang disimpan di repositori ini.

---

## Cara Kerja

Setiap siklus sinkronisasi menjalankan enam tahap:

1. **Kumpul kandidat** — scrape/fetch daftar model gratis dari 15 sumber (lihat [Sumber Model Gratis](#sumber-model-gratis)).
2. **Filter blacklist** — kandidat dicek terhadap `exclusions.json` dan flag `--exclude-provider`.
3. **Live pre-test paralel** — setiap kandidat dites langsung melalui endpoint internal 9router (`POST /api/models/test`) dengan pengukuran latensi riil.
4. **Vonis** — model valid diterima; model kuota-habis (429) diparkirkan; model mati/berbayar/promo-habis dibuang; kegagalan transient di-retest sekali.
5. **Ranking** — skor benchmark coding dikurangi penalti error-rate trafik nyata, di-tie-break dengan latensi, dan diutamakan oleh `priorities.json`.
6. **Injeksi combo** — hasil ditulis ke database 9router; pool kandidat disimpan ke `candidates-state.json` sebagai bahan recovery watchdog.

---

## Fitur Utama

### Validasi Live Pre-Test

Model tidak langsung masuk combo — semuanya diverifikasi hidup terlebih dahulu:

| Hasil Test | Perlakuan |
|---|---|
| HTTP 200 | Diterima ke combo, latensi dicatat |
| HTTP 429 / tanda *quota exceeded* | Diparkir ke `my9model-cooldown` (tidak dibuang), balik otomatis saat kuota reset |
| HTTP 401 (promo berakhir), 402 (berbayar), 403 (subscription), 404 (hilang), timeout definitif | Dibuang |
| Transient (timeout, network error, HTTP 408/425/429/5xx) | Di-retest satu kali sebelum divonis — satu hiccup jaringan tidak membuang model sehat |

### Watchdog Intra-Hari (`--refresh`)

Re-test ringan tiap jam (menit :35) **tanpa scrape ulang** untuk menutup celah "kuota habis di tengah hari":

- Model sehat → tetap di ranking, latensi disegarkan.
- Model kuota-habis → dipindah ke dasar `my9model-cooldown`.
- Model yang pulih → otomatis kembali ke combo utama & combo providernya (recovery pool: `candidates-state.json`).
- Model mati permanen (promo berakhir/berbayar/hilang) → dibuang.

### Feedback Loop Usage Nyata

Skor ranking bukan hanya benchmark statis. Script membaca tabel `usageHistory` milik 9router (7 hari terakhir) dan memberi **penalti ranking** pada model dengan error-rate tinggi di trafik nyata:

| Error Rate | Sampel Minimum | Penalti |
|---|---|---|
| >= 50% | >= 5 request | -800 |
| >= 25% | >= 5 request | -400 |

Benchmark tetap sumber utama; penalti hanya menurunkan model yang terbukti sering gagal di dunia nyata.

### Agentic Readiness Gate (Super-Combo)

Super-combo (`my9model-free`, `-smart`, `-fast`) hanya menerima model siap-agentic:

- Metadata eksplisit *tool-calling unsupported* → keluar dari super-combo (tetap ada di combo providernya).
- Context window diketahui < 100.000 token → keluar dari super-combo.

Threshold dapat diubah lewat konstanta `AGENTIC_MIN_CONTEXT` di `sync.js`.

### Combo Turunan `smart` / `fast`

- **`my9model-smart`**: model thinking/reasoning, atau benchmark >= 60 (untuk tugas berat).
- **`my9model-fast`**: model non-thinking di luar tier smart (untuk respons cepat).
- Keduanya fallback ke top-5 super-combo supaya tidak pernah kosong.

---

## Sumber Model Gratis

| # | Provider | Cara Ambil | Kriteria Gratis | Contoh ID |
|---|---|---|---|---|
| 1 | OpenAgentic.id | Web landing page (tier `free` + hero promo) dan Catalog API `/v1/models` via koneksi `openagentic` | Tier free / harga 0 | `openagentic/assistant-sonnet-4.5-thinking` |
| 2 | Kilo.ai (KiloCode) | Gateway API `api.kilo.ai/api/gateway/models` via token OAuth | Harga 0 / `:free` | `kc/nvidia/nemotron-3-super-120b-a12b:free` |
| 3 | OpenRouter | API `openrouter.ai/api/v1/models` | Harga 0 / `:free` | `openrouter/z-ai/glm-5.2:free` |
| 4 | Poolside | Inference API `inference.poolside.ai/v1/models` | Harga 0 / `is_free: true` | `poolside/poolside/laguna-s-2.1` |
| 5 | Google Gemini | Generative Language API `v1beta/models` via Gemini API Key | Free-tier AI Studio | `gemini/gemini-3.1-pro-preview` |
| 6 | Ollama Cloud | API `api.ollama.com/v1/models` | Tanpa subscription | `ollama/minimax-m3` |
| 7 | Groq | API `api.groq.com/openai/v1/models` | Semua model teks free-tier (rate-limited per model) | `groq/qwen/qwen3.6-27b` |
| 8 | Bazaarlink | API `bazaarlink.ai/api/v1/models` | Harga 0 / `:free` | `bazaarlink/qwen/qwen3.7-flash:free` |
| 9 | 9router OpenCode | Routing node OpenCode di 9router | Model `oc/*` gratis | `oc/laguna-s-2.1-free` |
| 10 | Cerebras | API `api.cerebras.ai/v1/models` | Free-tier | - |
| 11 | NVIDIA NIM | API `integrate.api.nvidia.com/v1/models` via koneksi native `nvidia` (key `nvapi-...` dari build.nvidia.com) | Kredit prototyping NVIDIA Developer Program; katalog tanpa kolom harga sehingga semua kandidat teks divalidasi live (embed/rerank/TTS/vision/guardrail dibuang lewat skip pattern) | `nvidia/meta/llama-3.1-70b-instruct` |
| 12 | Mistral La Plateforme | API `api.mistral.ai/v1/models` via koneksi `mistral` | Mode free; deduplikasi alias otomatis ke id kanonik `-latest`; model berbayar dibuang oleh live pre-test | `mistral/devstral-latest` |
| 13 | Cloudflare Workers AI | Koneksi native `cloudflare-ai` di 9router (fallback koneksi *openai-compatible*) | Hanya model tanpa harga dan tanpa flag `require_workers_paid` | `cloudflare-ai/@cf/meta/llama-3.1-8b-instruct` |
| 14 | API.airforce | API `api.airforce/v1/models` via koneksi `api-airforce` | Model berlabel `tier: "free"` | `api-airforce/llama-3.3-70b-instruct-fp8-fast` |
| 15 | B.ai | API `api.b.ai/v1/models` — koneksi *openai-compatible* di 9router dengan baseUrl `https://api.b.ai/v1` (fallback koneksi native `b.ai`) | Free-tier (filter live pre-test); non-coding di-skip | `b-ai/hy3` |

Tujuh provider dinonaktifkan secara default melalui [`exclusions.json`](exclusions.json): **API.airforce** (rate limit ketat 1 req/detik di plan gratis), **Cloudflare** (plan gratis hanya menyisakan sedikit model LoRA lama), **Mistral** (mayoritas katalog sudah berbayar), **NVIDIA NIM**, **Groq**, **Bazaarlink**, dan **Cerebras**. Hapus entri mereka di `excludedProviders` bila ingin mengaktifkan kembali.

> Catatan: integrasi GitHub Models **tidak ditambahkan** karena layanan ini sudah di-retire GitHub per 30 Juli 2026 (endpoint `models.github.ai` mengembalikan HTTP 410 permanen).

---

## Combo yang Dikelola

Semua combo di bawah ditulis ulang setiap sync (dan di-refresh watchdog); combo lain milik pengguna tidak disentuh.

| Combo | Isi |
|---|---|
| `my9model-free` | Super-combo lintas provider — 100% model aktif, urut skor coding & latensi |
| `my9model-smart` | Subset thinking/reasoning & benchmark tinggi dari super-combo |
| `my9model-fast` | Subset non-thinking tercepat dari super-combo |
| `my9model-cooldown` | Parkiran model kuota-habis (429); watchdog memindahkan balik saat lolos re-test |
| `openagentic-free` | Model gratis OpenAgentic.id yang aktif |
| `kilo-free` | Model gratis Kilo.ai yang aktif |
| `openrouter-free` | Model gratis OpenRouter yang aktif |
| `poolside-free` | Model gratis Poolside yang aktif |
| `gemini-free` | Model gratis Google Gemini yang aktif |
| `ollama-free` | Model gratis Ollama Cloud yang aktif |
| `opencode-free` | Model gratis OpenCode (`oc/*`) yang aktif |
| `groq-free` | Model gratis Groq yang aktif (jika tidak di-exclude) |
| `cerebras-free` | Model gratis Cerebras yang aktif (jika tidak di-exclude) |
| `mistral-free` | Model gratis Mistral yang aktif (jika tidak di-exclude) |
| `airforce-free` | Model gratis API.airforce yang aktif (jika tidak di-exclude) |
| `bazaarlink-free` | Model gratis Bazaarlink yang aktif (jika tidak di-exclude) |
| `b.ai-free` | Model gratis B.ai yang aktif (jika tidak di-exclude) |
| `cloudflare-free` | Model gratis Cloudflare Workers AI yang aktif (jika tidak di-exclude) |
| `nvidia-free` | Model gratis NVIDIA NIM yang aktif (jika tidak di-exclude) |

Combo per-provider hanya memuat model yang **sedang hidup** — model kuota-habis dikeluarkan agar daftar di IDE selalu bisa dipakai, lalu masuk lagi otomatis begitu kuota reset dan lolos re-test watchdog.

---

## Konfigurasi

### Blacklist Provider & Model (`exclusions.json`)

Anda dapat mengecualikan provider tertentu, atau model-model dengan kualitas kurang bagus, ukuran kecil (*nano*, *tiny*, *xs*, *lfm*), maupun non-coding (TTS, embed, video, dsb.). Aturan model berupa substring/ID dan dievaluasi **sebelum** live test, sehingga menghemat panggilan test:

```json
{
  "excludedProviders": [
    "api-airforce",
    "cloudflare",
    "mistral",
    "nvidia",
    "groq",
    "bazaarlink",
    "cerebras"
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

- **`excludedProviders`**: provider yang terdaftar di-skip total — tidak di-query dan tidak masuk super-combo.
- **`excludedModels`**: model yang cocok dengan aturan substring/ID otomatis di-skip sejak awal.
- Format lama (array polos berisi string `"provider:nama"` dan nama model) tetap didukung.
- Eksklusi provider juga bisa lewat CLI tanpa mengubah file: `node sync.js --exclude-provider=api-airforce,ollama`.

### Prioritas Model Kustom (`priorities.json`)

Tentukan sendiri urutan model favorit. Nama tidak harus persis — cukup *keyword*/substring yang mirip:

```json
[
  "0x-alpha",
  "ox-alpha",
  "hy3",
  "laguna",
  "longcat"
]
```

- Model yang cocok dengan item pertama ditempatkan di posisi #1, item kedua di #2, dst.
- Jika beberapa model cocok dengan aturan yang sama, **latensi tercepat** menempati urutan teratas dalam kelompok itu.
- Model lain tetap diurutkan otomatis di bawahnya berdasarkan skor benchmark coding.

---

## Pemeringkatan Kapabilitas Coding

Skor model dihitung empiris dari leaderboard coding publik, bukan tebakan statis.

### Database Benchmark (`benchmarks.json`)

Perintah `update-benchmarks.js` menggabungkan tiga sumber resmi ke satu cache terpadu (350+ model):

| Sumber | Data Diambil |
|---|---|
| [EvalPlus Leaderboard](https://github.com/evalplus/evalplus.github.io) | HumanEval+ (bobot 60%) + MBPP+ (bobot 40%) |
| [SWE-bench Verified](https://www.swebench.com/) | Resolved rate per model dari leaderboard resmi |
| [LiveCodeBench](https://livecodebench.github.io/) | Rata-rata pass@1 (model dengan >= 20 soal terekam) |

Hasil gabungan ditulis ke [`benchmarks.json`](benchmarks.json). *Calibrated baseline* untuk model frontier/proprietary (Gemini, Claude Sonnet, DeepSeek, GLM, Step, dll.) **selalu menang** pada nilai skor; sumber live hanya mengisi model yang belum tercakup. Label tier sendiri **tidak pernah diketik manual** — setiap kali database ditulis, semua tier dihitung ulang dari skornya lewat `determineTier()`, sehingga label selalu konsisten dengan skala di atas.

### Formula Skor

- Skor benchmark dikali 100, ditambah bonus: `thinking`/`reasoning` (+400), `flash`/`lightning` (+150).
- Model baru yang belum terdaftar dinilai lewat **heuristic fallback**: keluarga arsitektur (Claude/GPT/DeepSeek/Gemini/Qwen/GLM/poolside, dll.), generasi versi, dan modifier coding/thinking.
- Label tier pada database mengikuti skala: **S** (>= 80), **A+** (70-79), **A** (60-69), **B+** (50-59), **B** (45-49), **C+** (< 45).

### Tie-Breaker Latensi

Ketika dua atau lebih model memiliki skor atau prioritas setara, sistem mengukur waktu respons riil (*round-trip*) dari live pre-test dan menempatkan koneksi tercepat di urutan atas. Model kuota-habis ditandai sentinel latensi khusus sehingga selalu berada di dasar combo.

---

## Prasyarat

- **Node.js >= 18** (memakai `fetch` global dan `AbortSignal.timeout`).
- **9router** terinstall dan berjalan di `http://localhost:20128`, beserta modul global `better-sqlite3` (biasanya terpasang bersama 9router).
- **Koneksi provider aktif** di 9router (OpenAgentic, KiloCode, OpenRouter, Gemini, dst.) — kredensial dibaca read-only dari database 9router.
- Tidak ada dependency lokal yang perlu di-install (`package.json` bebas dependency runtime); `npm install` opsional.

---

## Perintah & Penggunaan

```bash
# Sinkronisasi harian: scrape + live pre-test + ranking + injeksi combo
npm run sync

# Watchdog intra-hari: re-test anggota combo, parkir kuota-habis, buang model mati
npm run refresh

# Simulasi (dry run) tanpa mengubah database 9router
npm run dry-run

# Perbarui database benchmark coding secara live
# (EvalPlus + SWE-bench Verified + LiveCodeBench; calibrated baseline selalu menang)
npm run update-benchmarks

# Sinkronisasi harian sekaligus update benchmark live
node sync.js --live-benchmarks

# Pasang scheduler otomatis (systemd user timers, fallback crontab)
npm run setup-cron

# Unit test self-check (integrasi live; butuh 9router & jaringan)
npm test
```

Flag tambahan pada `sync.js`:

| Flag | Fungsi |
|---|---|
| `--refresh` / `--watchdog` | Mode watchdog intra-hari (tanpa discovery model baru) |
| `--dry-run` | Simulasi penuh, tanpa tulis database |
| `--live-benchmarks` / `--update-benchmarks` | Update benchmark sebelum sync |
| `--setup-cron` / `--setup-scheduler` | Install scheduler |
| `--exclude-provider=a,b` | Skip provider tertentu hanya untuk sesi ini |

---

## Penjadwalan Otomatis

`npm run setup-cron` memasang tiga job dengan preferensi **systemd user timers** (Persistent=true, catch-up otomatis setelah boot) dan **crontab** sebagai fallback:

| Jadwal | Job |
|---|---|
| Harian 00:05 | Full sync (scrape + live test + injeksi) |
| Tiap jam menit :35 | Watchdog refresh (`--refresh`) |
| Senin 04:17 | Update benchmark |

---

## Notifikasi Delta Sync (Opsional)

Ringkasan perubahan (model masuk/keluar) setiap sync/watchdog dapat dikirim ke Telegram dan/atau Discord:

```bash
export TELEGRAM_BOT_TOKEN="123:abc"   # dari @BotFather
export TELEGRAM_CHAT_ID="123456789"   # dari @userinfobot
# dan/atau
export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
```

Variabel tidak diset → notifikasi dilewati diam-diam, sync tetap berjalan normal.

---

## Menggunakan Combo di IDE / Tool AI

Arahkan client OpenAI-compatible Anda ke endpoint 9router:

```
http://localhost:20128/v1
```

lalu pilih nama combo sebagai model (mis. `my9model-free`). Lihat daftar lengkap di [Combo yang Dikelola](#combo-yang-dikelola).

---

## Struktur Proyek

```
9router-auto-free/
├── sync.js                 # Script utama: scrape, live test, ranking, injeksi, watchdog, scheduler
├── providers.js            # Registry provider: satu record per source free-model (tabel lain diturunkan dari sini)
├── update-benchmarks.js    # Penggabung benchmark live (EvalPlus + SWE-bench + LiveCodeBench)
├── test.js                 # Self-check integrasi (butuh 9router berjalan + akses jaringan)
├── benchmarks.json         # Cache database benchmark (di-generate, di-commit)
├── exclusions.json         # Blacklist provider & model (milik pengguna)
├── priorities.json         # Urutan prioritas model kustom (milik pengguna)
└── candidates-state.json   # Pool kandidat sync terakhir untuk recovery watchdog (gitignored)
```

---

## Lisensi

MIT — lihat field `license` di [`package.json`](package.json).
