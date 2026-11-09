"""Run speech models on the local host. No hosted inference APIs are used."""
from __future__ import annotations

import gc
import os
import re
import textwrap
import threading
from pathlib import Path

import numpy as np

MODEL_DIR = Path(__file__).resolve().parents[1] / "models"
KOKORO_MODEL = MODEL_DIR / "kokoro-v1.0.onnx"
KOKORO_VOICES = MODEL_DIR / "voices-v1.0.bin"

KOKORO_VOICES_LIST = [
    {"id": "af_sarah", "name": "Sarah", "detail": "Warm & clear", "language": "English (US)"},
    {"id": "af_bella", "name": "Bella", "detail": "Soft & expressive", "language": "English (US)"},
    {"id": "af_nicole", "name": "Nicole", "detail": "Smooth & elegant", "language": "English (US)"},
    {"id": "af_heart", "name": "Heart", "detail": "Friendly & bright", "language": "English (US)"},
    {"id": "am_adam", "name": "Adam", "detail": "Confident & deep", "language": "English (US)"},
    {"id": "am_michael", "name": "Michael", "detail": "Natural & balanced", "language": "English (US)"},
    {"id": "bf_emma", "name": "Emma", "detail": "British & gentle", "language": "English (UK)"},
    {"id": "bm_george", "name": "George", "detail": "British & refined", "language": "English (UK)"},
]
QWEN_SPEAKERS = ["Ryan", "Aiden", "Vivian", "Serena", "Uncle_Fu", "Dylan", "Eric", "Ono_Anna", "Sohee"]
QWEN_LANGUAGES = ["Auto", "English", "Chinese", "Japanese", "Korean", "German", "French", "Russian", "Portuguese", "Spanish", "Italian"]
EMOTIONS = {
    "neutral": "",
    "happy": "Speak in a joyful, cheerful, uplifting voice.",
    "sad": "Speak softly, with sadness and a melancholy tone.",
    "angry": "Speak with strong frustration and anger.",
    "excited": "Speak with high energy and excitement.",
    "calm": "Speak gently, calmly, slowly and reassuringly.",
    "whisper": "Speak in a quiet, hushed, whispering voice.",
    "dramatic": "Speak in a theatrical, emotionally dramatic manner.",
}

_lock = threading.Lock()
_kokoro = None
_qwen = None
_qwen_kind = None


def _chunks(text: str, max_length: int = 280) -> list[str]:
    """Avoid running Kokoro on unbounded paragraphs in one call."""
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    parts: list[str] = []
    carry = ""
    for sentence in sentences:
        for segment in textwrap.wrap(sentence, width=max_length, break_long_words=True, break_on_hyphens=False) or []:
            candidate = f"{carry} {segment}".strip()
            if len(candidate) > max_length and carry:
                parts.append(carry)
                carry = segment
            else:
                carry = candidate
    if carry:
        parts.append(carry)
    return parts


def generate_preset(text: str, voice: str, speed: float) -> tuple[np.ndarray, int]:
    global _kokoro
    if voice not in {item["id"] for item in KOKORO_VOICES_LIST}:
        raise ValueError("Unknown preset voice")
    if not (0.7 <= speed <= 1.3):
        raise ValueError("Speed must be between 0.7 and 1.3")
    if not KOKORO_MODEL.exists() or not KOKORO_VOICES.exists():
        raise RuntimeError("Kokoro model files missing. Run: python scripts/download_kokoro.py")
    from kokoro_onnx import Kokoro

    with _lock:
        if _kokoro is None:
            _kokoro = Kokoro(str(KOKORO_MODEL), str(KOKORO_VOICES))
        language = "en-gb" if voice.startswith("b") else "en-us"
        wave_parts = []
        sample_rate = 24000
        for part in _chunks(text):
            samples, sample_rate = _kokoro.create(part, voice=voice, speed=speed, lang=language)
            wave_parts.append(np.asarray(samples, dtype=np.float32).reshape(-1))
            wave_parts.append(np.zeros(int(sample_rate * 0.12), dtype=np.float32))
        return np.concatenate(wave_parts), sample_rate


def _load_qwen(kind: str):
    """Keep at most one heavy Qwen model in VRAM/RAM at a time."""
    global _qwen, _qwen_kind
    if kind == _qwen_kind and _qwen is not None:
        return _qwen
    try:
        import torch
        from qwen_tts import Qwen3TTSModel
    except ImportError as exc:
        raise RuntimeError("Advanced voices require: pip install -r requirements-qwen.txt") from exc

    if _qwen is not None:
        del _qwen
        _qwen = None
        _qwen_kind = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    model_id = (
        "Qwen/Qwen3-TTS-12Hz-0.6B-Base"
        if kind == "clone"
        else "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
    )
    use_cuda = torch.cuda.is_available() and os.environ.get("QWEN_DEVICE", "auto").lower() != "cpu"
    device = "cuda:0" if use_cuda else "cpu"
    dtype = torch.bfloat16 if use_cuda else torch.float32
    try:
        _qwen = Qwen3TTSModel.from_pretrained(
            model_id,
            device_map=device,
            dtype=dtype,
            attn_implementation="sdpa",
        )
    except Exception as exc:
        raise RuntimeError(
            f"Could not load {kind} model on {device}. Check free memory or set QWEN_DEVICE=cpu. Details: {exc}"
        ) from exc
    _qwen_kind = kind
    return _qwen


def generate_emotion(text: str, speaker: str, language: str, emotion: str, custom_instruction: str) -> tuple[np.ndarray, int]:
    if speaker not in QWEN_SPEAKERS:
        raise ValueError("Unknown Qwen voice")
    if language not in QWEN_LANGUAGES:
        raise ValueError("Unsupported language")
    if emotion not in EMOTIONS:
        raise ValueError("Unsupported emotion")
    instruction = " ".join(filter(None, [EMOTIONS[emotion], custom_instruction.strip()])).strip()
    with _lock:
        model = _load_qwen("emotion")
        wavs, sample_rate = model.generate_custom_voice(
            text=text, speaker=speaker, language=language, instruct=instruction,
        )
        return np.asarray(wavs[0], dtype=np.float32).reshape(-1), sample_rate


def generate_clone(text: str, language: str, reference_wav: Path, reference_text: str) -> tuple[np.ndarray, int]:
    if language not in QWEN_LANGUAGES:
        raise ValueError("Unsupported language")
    with _lock:
        model = _load_qwen("clone")
        wavs, sample_rate = model.generate_voice_clone(
            text=text,
            language=language,
            ref_audio=str(reference_wav),
            ref_text=reference_text,
        )
        return np.asarray(wavs[0], dtype=np.float32).reshape(-1), sample_rate
