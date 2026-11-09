"""Self-hosted TTS HTTP API. All synthesis is local to this server."""
from __future__ import annotations

import asyncio
import importlib.util
import io
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from .engines import (
    EMOTIONS, KOKORO_MODEL, KOKORO_VOICES, KOKORO_VOICES_LIST,
    QWEN_LANGUAGES, QWEN_SPEAKERS, generate_clone, generate_emotion, generate_preset,
)

app = FastAPI(title="VoxStudio Local API", version="1.0.0")
MAX_TEXT = 2000
MAX_QWEN_TEXT = 500
MAX_UPLOAD = 12 * 1024 * 1024
ALLOWED_EXTENSIONS = {".wav", ".mp3", ".m4a", ".mp4", ".ogg", ".webm", ".flac", ".aac"}


@app.get("/api/health")
def health():
    return {"status": "ok", "backend": "self-hosted", "inference": "local"}


@app.get("/api/catalog")
def catalog():
    return {
        "voices": KOKORO_VOICES_LIST,
        "speakers": QWEN_SPEAKERS,
        "languages": QWEN_LANGUAGES,
        "emotions": list(EMOTIONS),
        "models": {
            "preset_ready": KOKORO_MODEL.is_file() and KOKORO_VOICES.is_file(),
            "qwen_installed": importlib.util.find_spec("qwen_tts") is not None,
        },
    }


def _decode_reference(data: bytes, filename: str, directory: Path) -> Path:
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(415, "Reference recording must be WAV, MP3, M4A, MP4, OGG, WEBM, FLAC or AAC")
    source = directory / f"reference{suffix}"
    target = directory / "reference.wav"
    source.write_bytes(data)
    try:
        subprocess.run(
            ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
             "-i", str(source), "-ar", "24000", "-ac", "1", "-t", "31", str(target)],
            check=True, timeout=45, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise HTTPException(503, "Install FFmpeg on the server for voice cloning uploads") from exc
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        raise HTTPException(422, "Could not decode your audio recording") from exc
    try:
        info = sf.info(str(target))
    except Exception as exc:
        raise HTTPException(422, "Invalid audio recording") from exc
    if not 2.0 <= info.duration <= 30.0:
        raise HTTPException(422, "Reference audio must be 2–30 seconds long")
    return target


@app.post("/api/generate")
async def generate(
    mode: str = Form("preset"),
    text: str = Form(...),
    voice: str = Form("af_sarah"),
    speed: float = Form(1.0),
    speaker: str = Form("Ryan"),
    language: str = Form("English"),
    emotion: str = Form("neutral"),
    instruction: str = Form(""),
    reference_text: str = Form(""),
    consent: bool = Form(False),
    reference_audio: UploadFile | None = File(None),
):
    text = text.strip()
    if not text or len(text) > MAX_TEXT:
        raise HTTPException(422, f"Text must be 1–{MAX_TEXT} characters")
    if mode not in {"preset", "clone", "emotion"}:
        raise HTTPException(422, "Invalid mode")
    if mode != "preset" and len(text) > MAX_QWEN_TEXT:
        raise HTTPException(422, f"Advanced generation is limited to {MAX_QWEN_TEXT} characters per request")
    if len(instruction) > 250:
        raise HTTPException(422, "Instruction is too long")

    try:
        if mode == "preset":
            wave, sample_rate = await asyncio.to_thread(generate_preset, text, voice, speed)
        elif mode == "emotion":
            wave, sample_rate = await asyncio.to_thread(
                generate_emotion, text, speaker, language, emotion, instruction
            )
        else:
            if not consent:
                raise HTTPException(422, "Confirm you have permission from the voice owner")
            if reference_audio is None or not reference_audio.filename:
                raise HTTPException(422, "Upload a reference audio recording")
            if not reference_text.strip() or len(reference_text) > 600:
                raise HTTPException(422, "Provide the spoken transcript (1–600 characters)")
            with tempfile.TemporaryDirectory(prefix="voxstudio_") as temp_dir:
                data = await reference_audio.read(MAX_UPLOAD + 1)
                if not data or len(data) > MAX_UPLOAD:
                    raise HTTPException(413, "Upload must be smaller than 12 MB")
                wav_path = await asyncio.to_thread(
                    _decode_reference, data, reference_audio.filename, Path(temp_dir)
                )
                wave, sample_rate = await asyncio.to_thread(
                    generate_clone, text, language, wav_path, reference_text.strip()
                )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        # Do not expose internal stack traces to the browser.
        raise HTTPException(500, f"Speech generation failed ({type(exc).__name__}). Check server logs.") from exc

    if not np.isfinite(wave).all() or wave.size == 0:
        raise HTTPException(500, "Model returned invalid audio")
    buffer = io.BytesIO()
    sf.write(buffer, wave, sample_rate, format="WAV", subtype="PCM_16")
    buffer.seek(0)
    return StreamingResponse(
        buffer, media_type="audio/wav",
        headers={
            "Content-Disposition": 'attachment; filename="voice-output.wav"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
