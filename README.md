# Free Models Sync -> 9router
### (OpenAgentic.id + Kilo.ai + 9router OpenCode Free)

Otomasi sinkronisasi, **live pre-test validasi**, pemeringkatan kapabilitas koding, dan injeksi model AI gratis harian langsung ke dalam **9router** combos (`my9model-free`, `openagentic-free`, `kilo-free`, dan `opencode-free`).

---

## 🛡️ Fitur Utama: Real-Time Live Pre-Testing

Sebelum model dimasukkan ke dalam combo 9router, script menjalankan **live pre-test** secara paralel (5 worker) ke endpoint internal 9router (`/api/models/test`):

- **Auto-Drop Promo Berakhir (HTTP 401)**: Membuang model yang promo gratisnya sudah habis (misal: `oc/deepseek-v4-flash-free`, `oc/qwen3.6-plus-free`, `oc/minimax-m3-free`, dsb.).
- **Auto-Drop Model Berbayar / Butuh Kredit (HTTP 402)**: Membuang model yang membutuhkan saldo (misal: `kc/stealth/ox-alpha`).
- **Auto-Drop Dead / Timeout / 404**: Membuang model yang tidak merespons atau ID-nya sudah tidak tersedia.
- **Strict Zero-Latency Quota Handling (HTTP 429)**: Membuang model yang kuota hariannya sudah habis (`100/100 quota exceeded`) agar IDE langsung merespons di percobaan pertama tanpa delay fallback. Model akan otomatis dimasukkan kembali saat kuota direset pada sync jam 00:05 WIB.

Hasilnya, combo di 9router selalu **bersih 100% dan Zero-Latency** dari model mati, berbayar, ataupun yang kuota hariannya sudah habis.

---

## 🌟 Sumber Kandidat Model Gratis

1. **OpenAgentic.id**:
   - Web Landing Page (tier `free` / hero promo) + Catalog API (`/v1/models`) via akun `herliansyah@gmail.com`.
   - Mengambil kandidat model gratis (misal: `openagentic/assistant-sonnet-4.5-thinking`, `openagentic/claude-sonnet-4.5`, `openagentic/glm-5`, dsb.).
2. **Kilo.ai (KiloCode)**:
   - Kilo.ai Gateway API (`https://api.kilo.ai/api/gateway/models`) via token OAuth KiloCode.
   - Mengambil kandidat model berharga 0 / `:free` (misal: `kc/stepfun/step-3.7-flash:free`, `kc/nvidia/nemotron-3-super-120b-a12b:free`, dsb.).
3. **9router OpenCode Free (`oc/*`)**:
   - Diambil langsung dari routing node OpenCode di 9router.

---

## 🧠 Pemeringkatan Koding (Coding Spec Priority)

Seluruh model gratis yang lolos uji validasi diurutkan secara otomatis dari skor kapabilitas koding tertinggi:

1. **Tier S (Claude & Frontier Reasoning)**: `assistant-sonnet-4.5-thinking`, `claude-sonnet-4.5`, `glm-5`, dsb.
2. **Tier A (High Coding & Flash Specs)**: `step-3.7-flash`, `nemotron-3-super`, `minimax-m2.5`, dsb.
3. **Tier B (Standard Free LLMs)**: `hy3`, `dots-3-note-preview`, `mimo-v2.5`, `laguna-s-2.1`, `lfm-2.5-2.6b`, dsb.
4. **Tier C (Auto & Router Fallbacks)**: `kilo-auto/free`, `openrouter/free`, `open-agentic`.
5. **Tier Non-Coding (Image/Media)**: Ditempatkan di urutan terbawah (`z-image-turbo-free`).

---

## ⚡ Perintah & Penggunaan

```bash
# Sinkronisasi harian dengan live pre-testing
npm run sync

# Jalankan simulasi (Dry Run) tanpa mengubah database
npm run dry-run

# Sinkronisasi cepat tanpa pre-test
node sync.js --skip-test

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
- **`opencode-free`**: Combo model gratis OpenCode (`oc/*`) yang aktif.
