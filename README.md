# Free Models Sync -> 9router
### (OpenAgentic.id + Kilo.ai + 9router OpenCode Free)

Otomasi sinkronisasi, pemeringkatan kapabilitas koding, dan injeksi model AI gratis harian langsung ke dalam **9router** combos (`my9model-free`, `openagentic-free`, `kilo-free`, dan `opencode-free`).

---

## 🌟 Sumber Model Gratis

1. **OpenAgentic.id**:
   - Web Landing Page (tier `free` / hero promo) + Catalog API (`/v1/models`) via akun `herliansyah@gmail.com`.
   - Menghasilkan 10 model gratis (misal: `openagentic/assistant-sonnet-4.5-thinking`, `openagentic/claude-sonnet-4.5`, `openagentic/glm-5`, dsb.).
2. **Kilo.ai (KiloCode)**:
   - Kilo.ai Gateway API (`https://api.kilo.ai/api/gateway/models`) via token OAuth KiloCode.
   - Menghasilkan 13 model gratis (misal: `kc/stepfun/step-3.7-flash:free`, `kc/nvidia/nemotron-3.5-lightning:free`, `kc/nvidia/nemotron-3-ultra:free`, dsb.).
3. **9router OpenCode Free (`oc/*`)**:
   - Diambil langsung dari routing node OpenCode di 9router.
   - Menghasilkan 8 model gratis bersih (`oc/deepseek-v4-flash-free`, `oc/qwen3.6-plus-free`, `oc/minimax-m3-free`, `oc/nemotron-3-ultra-free`, `oc/ling-3.0-flash-free`, `oc/mimo-v2.5-free`, `oc/laguna-s-2.1-free`, `oc/north-mini-code-free`).

---

## 🧠 Pemeringkatan Koding (Coding Spec Priority)

Seluruh 31 model gratis digabungkan dan diurutkan secara otomatis dari skor kapabilitas koding tertinggi:

1. `openagentic/assistant-sonnet-4.5-thinking` *(Claude Sonnet 4.5 Thinking)*
2. `openagentic/claude-sonnet-4.5` *(Claude Sonnet 4.5)*
3. `openagentic/glm-5` *(GLM 5)*
4. `oc/deepseek-v4-flash-free` *(DeepSeek V4 Flash Free)*
5. `oc/qwen3.6-plus-free` *(Qwen 3.6 Plus Free)*
6. `kc/stepfun/step-3.7-flash:free` *(StepFun 3.7 Flash Free)*
7. `oc/minimax-m3-free` *(MiniMax M3 Free)*
8. `kc/nvidia/nemotron-3.5-lightning:free` *(Nemotron 3.5 Lightning Free)*
9. `kc/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`
10. `openagentic/minimax-m2.5`
11. `openagentic/nemotron-3-ultra-free`
12. `kc/nvidia/nemotron-3-ultra-550b-a55b:free`
13. `kc/nvidia/nemotron-3-super-120b-a12b:free`
14. `oc/nemotron-3-ultra-free`
15. `oc/ling-3.0-flash-free`
16. `openagentic/hy3-free`
17. `kc/tencent/hy3:free`
18. `kc/dots-studio/dots-3-note-preview:free`
19. `openagentic/mimo-v2.5-free`
20. `oc/mimo-v2.5-free`
21. `kc/liquid/lfm-2.5-2.6b:free`
22. `kc/poolside/laguna-s-2.1:free`
23. `kc/poolside/laguna-xs-2.1:free`
24. `oc/laguna-s-2.1-free`
25. `kc/cohere/north-mini-code:free`
26. `oc/north-mini-code-free`
27. `kc/kilo-auto/free`
28. `openagentic/open-agentic`
29. `kc/openrouter/free`
30. `openagentic/ali-z-image-turbo` *(Image model - urutan akhir)*
31. `openagentic/z-image-turbo-free` *(Image model - urutan akhir)*

---

## ⚡ Perintah & Penggunaan

```bash
# Sinkronisasi sekarang
npm run sync

# Simulasi (Dry Run)
npm run dry-run

# Jalankan Unit Test Self-Check
npm test

# Pasang ulang cron harian (00:05 WIB)
npm run setup-cron
```

---

## 🔌 Menggunakan Combos di IDE / Tool AI

Endpoint 9router: `http://localhost:20128/v1`

- **`my9model-free`**: Super-combo 31 model gratis dari seluruh sumber terurut prioritas koding.
- **`openagentic-free`**: Khusus 10 model gratis OpenAgentic.id.
- **`kilo-free`**: Khusus 13 model gratis Kilo.ai.
- **`opencode-free`**: Khusus 8 model gratis OpenCode (`oc/*`).
