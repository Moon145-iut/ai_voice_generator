# VoxStudio — Self-hosted AI Voice Studio

A **responsive Next.js + FastAPI** web app for speech generation with **no paid/external inference APIs**. It has three engines:

1. **Preset voice synthesis** — Kokoro ONNX, eight English voice presets and speed control. Recommended first run; CPU friendly.
2. **Voice cloning** — Qwen3-TTS-12Hz-0.6B-Base; upload a 2–30 second clip with its transcript and confirm speaker permission.
3. **Emotion-directed voices** — Qwen3-TTS-12Hz-1.7B-CustomVoice; choose a speaker, emotion and optional natural-language instruction.

A browser on any modern phone, tablet or desktop sends requests to **your Next.js frontend**, which proxies them to **your Python backend** on the same host. No model weights are sent to clients and no speech is generated in third-party services. Model downloads require internet initially.

## Requirements

- Python **3.12** recommended (avoid 3.13 for Qwen if your PyTorch environment lacks support).
- Node.js **20.9+**, npm, FFmpeg (required for voice cloning uploads).
- A few GB of disk for advanced models. **Advanced 1.7B speech can run out of memory on a 6GB GPU.** Use CPU with sufficient RAM or deploy a GPU server with more VRAM.
- Windows, Linux or macOS for development (Qwen/Torch installation can be platform-specific). Linux or WSL2 is preferable for CUDA.
- `espeak-ng` may be needed for Kokoro phonemization on some systems: Ubuntu: `sudo apt-get install espeak-ng ffmpeg`; macOS: `brew install espeak-ng ffmpeg`.

## A. Install and run the backend

From the project root:

```bash
cd backend
python3.12 -m venv .venv
```

Activate the venv:

- Windows PowerShell: `.venv\Scripts\Activate.ps1`
- macOS/Linux: `source .venv/bin/activate`

```bash
python -m pip install --upgrade pip
pip install -r requirements.txt
python scripts/download_kokoro.py
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Backend health: `http://127.0.0.1:8000/api/health`. Interactive docs: `http://127.0.0.1:8000/docs`.

### Advanced engines (optional; large downloads)

Stop the backend and then, inside the backend venv:

```bash
pip install -r requirements-qwen.txt
```

To force Qwen to run on CPU:

- Linux/macOS: `export QWEN_DEVICE=cpu`
- Windows PowerShell: `$env:QWEN_DEVICE="cpu"`

Then restart uvicorn. Models download on first request and are cached by Hugging Face. If you want a fully air-gapped runtime, **pre-download the weights** on a connected machine and copy the Hugging Face cache to your server, or modify `model_id` paths in `app/engines.py` to point to local copies.

The backend keeps at most one **Qwen** model loaded at a time; switching between clone and emotional speech will unload/reload models and can be slow. Kokoro is loaded independently. The advanced modes do not share a model because the base and custom-voice Qwen checkpoints support different functions.

## B. Install and run the frontend

Open a **second terminal** from the project root:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000` on the host machine. The UI connects through relative `/backend/*` URLs forwarded by Next.js to `http://127.0.0.1:8000`; you do **not** need to set API URLs in the browser.

For a backend on another server, create `frontend/.env.local`:

```text
BACKEND_URL=http://YOUR_BACKEND_PRIVATE_ADDRESS:8000
```

Restart Next.js after editing `.env.local`.

## C. Open it on your phone or tablet (same Wi-Fi)

1. Keep both terminals running, with the frontend bound to `0.0.0.0` (the included npm script does this).
2. Find your host computer's LAN IPv4 address (`ipconfig` on Windows / `ip addr` on Linux / Network settings on macOS).
3. On the other device open `http://YOUR_LAN_IP:3000` (not `localhost`).
4. Allow inbound TCP 3000 on your host's local firewall only for your trusted LAN. Port 8000 remains on localhost because Next.js proxies API traffic.

LAN HTTP is for development, not a secure public deployment. For internet access, deploy Next.js and FastAPI behind a reverse proxy with HTTPS and a real domain, authentication, quotas, rate limits, anti-abuse measures and upload limits. Installable web-app behavior needs HTTPS outside localhost on most mobile browsers.

## D. Project map

```text
ai-voice-studio/
├── backend/
│   ├── app/
│   │   ├── main.py                 # HTTP endpoints, input validation, audio conversion
│   │   └── engines.py              # Kokoro and Qwen local inference
│   ├── scripts/download_kokoro.py # first-time public model download
│   ├── tests/test_api.py           # basic API tests with mocked generation
│   ├── requirements.txt
│   └── requirements-qwen.txt
└── frontend/
    ├── app/page.tsx               # complete responsive studio UI
    ├── app/globals.css            # responsive visual design
    ├── app/layout.tsx
    ├── app/manifest.ts             # PWA metadata, not offline TTS
    ├── next.config.ts             # safe relative-path backend reverse proxy
    └── package.json
```

## E. API

- `GET /api/health` — local server status.
- `GET /api/catalog` — voices, languages, emotions, model availability.
- `POST /api/generate` — multipart form-data, returning a `audio/wav` download.

Important multipart fields:

| Field | Preset | Emotion | Clone |
|---|---|---|---|
| `mode` | `preset` | `emotion` | `clone` |
| `text` | up to 2,000 chars | up to 500 | up to 500 |
| `voice` | e.g. `af_sarah` | — | — |
| `speed` | 0.7–1.3 | — | — |
| `speaker` | — | `Ryan`, `Serena`, etc. | — |
| `language` | English only | `English`, etc. | `English`, etc. |
| `emotion` | — | `happy`, `sad`, etc. | — |
| `instruction` | — | natural-language direction | — |
| `reference_audio` | — | — | WAV/MP3/M4A/etc., 2–30s, max 12 MB |
| `reference_text` | — | — | exact transcript |
| `consent` | — | — | must be `true` |

Example:

```bash
curl -X POST http://127.0.0.1:8000/api/generate \
  -F mode=preset -F text='Hello from my own voice studio.' \
  -F voice=af_sarah -F speed=1.0 -o voice-output.wav
```

## F. Tests

```bash
cd backend
pip install pytest httpx
python -m pytest -q
```

Tests mock audio inference and do not test the actual model weights/sound quality. Always run a real generation after setup.

## G. Privacy and realistic limits

- Reference audio is converted with FFmpeg inside a temporary directory and deleted after the request. Output audio returns directly in the response. The browser retains recent output URLs only in memory for the current tab/session. No user database is included.
- **No user login, billing, database, job queue, distributed concurrency, persistent library or production authentication is provided.** This is a functional self-hosted developer starter, not a production-ready SaaS. For public deployment add user accounts, durable storage with deletion policies, authentication on endpoints, abuse controls, and a queue backed by Redis/worker processes.
- An upload checkbox cannot prove rights to clone a person. Use only your own voice or voices with clear consent, and add stronger verification and consent records for a publicly available cloning service.
- Emotion instructions are controlled by the model, so named emotions may not be perfectly rendered. Cloning does **not** directly support named emotion controls in this implementation.
- Kokoro supports more languages but the included preset catalog intentionally uses US/UK English voices. Expand voices/language mapping to add international presets.
- Audio is WAV; MP3 output could be added with FFmpeg. The server needs access to downloaded weights but does not make inference calls to external AI providers.
- The frontend uses system fonts and local SVG icons. It does not depend on a remote font CDN, and inference does not use any external AI API.

## Primary upstream model sources

- Kokoro ONNX: https://github.com/thewh1teagle/kokoro-onnx (MIT wrapper; Kokoro weights Apache 2.0)
- Qwen3-TTS: https://github.com/QwenLM/Qwen3-TTS (Apache 2.0)
- Next.js: https://nextjs.org/docs/app/getting-started/installation

Check model licenses and usage terms again before commercial production deployment.
