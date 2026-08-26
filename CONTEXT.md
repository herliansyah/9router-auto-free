# CONTEXT — istilah domain 9router-auto-free

Istilah inti yang dipakai di kode, commit, dan diskusi. Ubah dokumen ini
saat istilah baru dinamai atau makna lama berubah.

## Registry provider
- **Provider record**: satu entri deklaratif di `providers.js` per source
  free-model (`key`, `combo`, `prefixes`, `usageName`, `kind`, aturan kredensia,
  `skipPatterns`, `solo`, `throttleMs`). Satu-satunya tempat menambah provider.
- **Alias / prefix**: ejaan segmen-pertama model-id yang dipetakan ke satu
  provider (`openagentic`/`oa`, `b-ai`/`b.ai`/`bai`). Harus unik lintas record.

## Combo & tier
- **Combo**: grup model bernama di 9router (baris tabel `combos`). Dikelola:
  `my9model-free/-smart/-fast/-cooldown` + satu `<provider>-free` per record.
- **Smart tier**: model dengan skor benchmark >= `SMART_MIN_SCORE` (impor dari
  `update-benchmarks.js`, = lantai tier A) atau varian thinking/reasoning.
- **Fast tier**: anggota super-combo yang bukan smart dan bukan varian thinking.
- **Super-combo**: `my9model-*`. Gate agentic (tools + context window) hanya
  berlaku di sini; combo provider tidak disaring gate.

## Live pre-test & verdict
- **Live pre-test**: uji tiap kandidat lewat endpoint internal 9router sebelum
  ditulis ke combo. Hasilnya diputuskan SEKALI oleh `classifyTestResult()`.
- **Verdict** (`active | quota | dead`):
  - `active` — sehat, masuk ranking normal;
  - `quota`  — hidup tapi kuota upstream habis; dipertahankan,
    diparkir di dasar combo;
  - `dead`   — dibuang dari combo.
- **Parked / cooldown**: encoding persistensi untuk model quota: latencyMs =
  `QUOTA_LATENCY_SENTINEL` (999998). Dibaca hanya lewat `isParkedLatency()`;
  jangan mengeja ulang angkanya.
- **Watchdog refresh**: jalannya tiap jam (--refresh); re-test anggota combo
  yang ada, tak pernah menambah kandidat baru. Menulis tier kosong? Tidak —
  tier kosong dibiarkan; sync harian selalu menulis semua empat super-combo.

## Ranking
- **Signals**: `{ benchmarks, priorities, usageStats }` — saat diinjeksikan ke
  `sortModelsByCodingQuality`, fungsi menjadi murni (tanpa baca file/SQLite).
- **Usage penalty**: penalti reliabilitas dari statistik pemakaian nyata
  (ambang sampel 5; −400 / −800). Benchmark tetap dominan atas latensi.

## Aturan arah dependensi
- `sync.js` → `providers.js` → (tidak ada), `sync.js` → `update-benchmarks.js`.
- `benchmarks.json` dimiliki penulisnya (`update-benchmarks.js`); `sync.js`
  hanya membaca via path yang diekspor module tersebut.
