# Agent Notes

Operational knowledge recorded by agents working on this repo. Update as things change.

## LLM API (llm.elimelt.com → Ollama)

### Endpoints
- Public: `https://llm.elimelt.com` — both Ollama-native (`/api/chat`) and OpenAI-compatible (`/v1/chat/completions`, `/v1/models`) APIs.
- Internal (from host): `http://172.27.0.11:11434`.
- Model management endpoints (`/api/pull`, `/api/delete`, `/api/copy`, `/api/push`, `/api/create`) are blocked at the edge by Caddy. Manage models via `docker exec ollama ollama pull|rm <model>`.

### CORS / rate limiting (Caddyfile)
- Allowed origins: `https://*.elimelt.com` and `http://localhost:5173` (exact spelling — `127.0.0.1` and other ports do NOT match).
- Requests from allowed origins are exempt from rate limiting; all other traffic is limited to 100 req/min per IP.
- Gotcha: Ollama validates the `Origin` header itself and returns 403 unless `OLLAMA_ORIGINS=*` is set. Origin policy is enforced by Caddy at the edge instead.

### Ollama container tuning (docker-compose.yml)
- `OLLAMA_NUM_PARALLEL=4`: concurrency benchmarks (`infra/scripts/bench_ollama_concurrency.py`) showed throughput plateaus around 4 concurrent requests on the i9-13900HK (CPU-bound).
- `OLLAMA_MAX_QUEUE=20`: rejects excess requests instead of unbounded queueing.
- `OLLAMA_MAX_LOADED_MODELS=2`: requesting a non-resident model triggers a cold load (up to ~13s for 18GB models) and may evict a warm one.
- Memory limit 50G: 26B-class models OOM-killed the container at the old 6G limit.

## Model lineup (as of 2026-08-02)

Chosen to be Pareto-optimal per use case. `gemma3:27b` and `llama3.2:3b` were
deleted as dominated (see benchmarks below).

| Model | Size | Role | Warm 1st content | Decode |
|---|---|---|---|---|
| `gemma2:2b` | 1.6GB | speed / TTS-rewrite | 206ms | 27.4 t/s |
| `gemma4:e4b` | 9.6GB | mid quality, fast cold load (4.4s) | 439ms (`think: false`) | 15.4 t/s |
| `gemma4:26b` | 18GB | best quality-per-second (MoE, 3.8B active) | 448ms (`think: false`) | 16.7 t/s |
| `gpt-oss:20b` | 13.8GB | reasoning / tool calling (MoE, 3.6B active) | 1.5s (`think: "low"`) | 12.8 t/s |
| `qwen2.5-coder:7b` | 4.7GB | code / FIM | 200ms | 11.2 t/s |

### Thinking models — critical gotchas
- `gemma4:*` think **by default**. Pass `"think": false` on `/api/chat` or first content is delayed ~10s (e4b) to ~37s (26b). With a small `num_predict`, the entire budget can be consumed by thinking and no content ever arrives.
- `gpt-oss` cannot disable thinking, only effort: `"think": "low" | "medium" | "high"`. Low ≈ 1.5s to first content; high ≈ 28s.
- The OpenAI `/v1` endpoint has **no way to pass `think`** — gemma4 models think by default there. If a `/v1` client needs gemma4 without thinking, create a Modelfile variant (not yet done; see issues).
- When benchmarking, distinguish *first token* (may be thinking) from *first content*. `infra/scripts/bench_ollama.py` handles this.

### Benchmark/eval scripts (`infra/scripts/`)
- `bench_ollama.py <host> [runs]` — TTFT (first token vs first content), decode/prompt t/s, per think-mode.
- `bench_ollama_concurrency.py` — throughput vs concurrent requests.
- `bench_ollama_prefill.py` — prompt-processing latency vs input length.
- `eval_tts_rewrite.py <host> <models>` — quality eval for the notes→TTS rewrite task (math excerpts from notes.elimelt.com, checks for leftover LaTeX/symbols, preambles, dropped terms).
- `eval_tts_prompts.py` — prompt-variant ablations for the same task.

### Misc findings
- MoE models (`gemma4:26b`, `gpt-oss:20b`) decode at small-model speeds on CPU despite large total size — only active params matter per token.
- Small dense models: optimal `num_thread` is 10–14 on the i9-13900HK.
- `gemma2:2b` passed all automated TTS-rewrite checks but made a semantic error (conflated largest/smallest singular value) that `gemma4:e4b`/`26b` got right. Automated checks don't catch meaning errors.
- `llama3.2:3b` left raw LaTeX in TTS output; `gemma4` spells code identifiers letter-by-letter ("n p dot ...").
