<p align="center">
  <a href="README.md">English</a> | <strong>Bahasa Indonesia</strong>
</p>

# 9router-auto-free

Otomasi cerdas untuk mengumpulkan **100+ model AI coding gratis** dari berbagai provider terkemuka, memvalidasinya dengan **live pre-test** langsung melalui 9router, menyortirnya berdasarkan skor benchmark coding empiris & latensi terendah, lalu menyuntikkannya ke dalam combo 9router (`my9model-free`, `my9model-smart`, `my9model-fast`, `openagentic-free`, `kilo-free`, dll.) — sehingga IDE favorit Anda (Cursor, Claude Code, Cline, VS Code) selalu siap pakai tanpa repot mencari atau menggonta-ganti API key.

> **Catatan Keamanan**: Script ini membaca kredensial provider dari **koneksi yang sudah dikonfigurasi di SQLite 9router Anda**. Tidak ada API key yang disimpan atau dikirim ke luar.

<p align="center">
  <img src="https://raw.githubusercontent.com/herliansyah/9router-auto-free/master/assets/dashboard.png" alt="9router Auto-Free Web Console Dashboard" width="850" />
</p>

---

## 🌐 Web Console & Dashboard Interaktif

9router-auto-free kini dilengkapi dengan **Web Management Console** bawaan (port `20129`) bertema dark mode yang modern:

- **Autentikasi Terintegrasi**: Login menggunakan password yang sama dengan dashboard 9router Anda.
- **Top 5 Leaderboard**: Menampilkan live ranking model gratis dengan kemampuan coding terbaik & latensinya.
- **Provider Catalog & Auto-Sync**: Kelola koneksi provider dan aktifkan/nonaktifkan auto-discovery per-provider.
- **Visual Exclusions & Priorities**: Kelola `exclusions.json` dan `priorities.json` via antarmuka visual atau raw JSON editor.
- **Streaming Terminal CLI**: Jalankan *Sync*, *Dry Run*, *Watchdog Refresh*, dan *Scheduler Setup* dengan live log streaming (SSE).
- **Dukungan Multi-Bahasa**: Switch instan antara **Bahasa Indonesia 🇮🇩** dan **English 🇬🇧**.

```bash
# Menjalankan Web Console
npx 9router-auto-free --web
# Atau jika diinstall lokal: npm run web
```
Akses di browser: `http://localhost:20129`

---

## 🚀 Instalasi & Penggunaan via NPM / NPX

### 1. Tanpa Instalasi (Zero-Install via NPX)

```bash
# Menjalankan Full Daily Sync langsung
npx 9router-auto-free

# Menjalankan Web Console Dashboard
npx 9router-auto-free --web

# Simulasi sync tanpa mengubah database (Dry Run)
npx 9router-auto-free --dry-run

# Watchdog refresh intra-hari (periksa kuota 429)
npx 9router-auto-free --refresh

# Pasang penjadwalan otomatis di sistem Anda
npx 9router-auto-free --setup-cron
```

### 2. Instalasi Global

```bash
npm install -g 9router-auto-free

# Gunakan perintah CLI langsung dari terminal
9router-auto-free
9router-auto-free --web
9router-auto-free --dry-run
```

---

## ⚙️ Cara Kerja (6 Tahap Otomatis)

1. **Kumpul Kandidat**: Scrape & fetch daftar model gratis dari 15+ sumber bawaan & provider dinamis di SQLite.
2. **Filter Exclusions**: Menyaring model non-coding (TTS, embed, video, model terlalu kecil/nano) dan provider di `exclusions.json`.
3. **Live Pre-Test Paralel**: Setiap kandidat dites langsung melalui endpoint internal 9router (`POST /api/models/test`) untuk mengukur latensi & status HTTP asli.
4. **Vonis & Auto-Cooldown**: HTTP 200 diterima; model kuota habis (429) diparkirkan di `my9model-cooldown`; model berbayar/mati dibuang.
5. **Quality Benchmark Ranking**: Model diurutkan berdasarkan skor benchmark coding empiris (EvalPlus, SWE-bench), dikurangi penalti error-rate, dan latensi.
6. **Injeksi Database 9router**: Hasil langsung ditulis ke database SQLite 9router. IDE Anda langsung menikmati daftar model terbaru.

---

## 📦 Combo yang Dikelola

### 🌟 Super Combos Terpadu (Lintas Provider)

| Combo | Deskripsi & Rekomendasi |
|---|---|
| `my9model-free` | **Super combo utama**: Kumpulan seluruh model gratis aktif dari semua provider, diurutkan dari kualitas coding terbaik & latensi tercepat. Sangat direkomendasikan untuk penggunaan harian. |
| `my9model-smart` | **Reasoning & Thinking tier**: Khusus model thinking (Claude 3.7 Sonnet Thinking, Qwen Coder, DeepSeek R1) atau skor benchmark tertinggi. Ideal untuk arsitektur rumit & debugging sulit. |
| `my9model-fast` | **Low Latency tier**: Model super cepat (Groq, Cerebras, Kilo, dll.) dengan respons sub-detik. Cocok untuk inline code completion & autocomplete. |
| `my9model-cooldown` | **Parkiran Quota (429)**: Tempat isolasi sementara model kuota habis. Watchdog otomatis mengembalikannya ke combo utama begitu kuota reset. |

### 🔌 Provider-Specific Combos

| Provider | Prefix | Combo yang Dihasilkan |
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

## 💻 Menggunakan di IDE / AI Coding Tools

Arahkan client OpenAI-Compatible Anda ke endpoint 9router:

- **OpenAI Base URL**: `http://localhost:20128/v1`
- **API Key**: API Key dari dashboard 9router Anda
- **Model Name**: `my9model-free` (atau `my9model-smart`, `my9model-fast`)

### Contoh Quick Setup:
- **Claude Code**:
  ```bash
  claude --model openai/my9model-free
  ```
- **Cursor**:
  - Buka *Settings* &rarr; *Models* &rarr; *OpenAI API*.
  - Masukkan Base URL: `http://localhost:20128/v1` dan Model: `my9model-free`.
- **Aider**:
  ```bash
  export OPENAI_API_BASE=http://localhost:20128/v1
  aider --model openai/my9model-free
  ```

---

## ⏰ Penjadwalan Otomatis (Scheduler)

Jalankan perintah berikut untuk mengaktifkan scheduler harian (00:05 WIB) dan watchdog per-jam (menit :35):

```bash
npx 9router-auto-free --setup-cron
```
*(Di Linux akan otomatis memasang Systemd User Timers; di macOS/Windows/WSL akan memasang crontab).*

---

## 📄 Lisensi & Pembuat

Dibuat oleh **[Herliansyah](https://github.com/herliansyah)**.

Dirilis di bawah lisensi [MIT License](LICENSE).
