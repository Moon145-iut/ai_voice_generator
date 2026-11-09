"""Download the public Kokoro model once. Afterwards TTS runs offline."""
from pathlib import Path
from urllib.request import urlretrieve

DEST = Path(__file__).resolve().parents[1] / "models"
DEST.mkdir(exist_ok=True)
BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1"
for name in ("kokoro-v1.0.onnx", "voices-v1.0.bin"):
    target = DEST / name
    if target.exists() and target.stat().st_size > 1000:
        print(f"Already exists: {target}")
        continue
    print(f"Downloading {name} ...")
    partial = DEST / (name + ".part")
    try:
        urlretrieve(f"{BASE}/{name}", partial)
        partial.replace(target)
    except Exception:
        partial.unlink(missing_ok=True)
        raise
    print(f"Saved: {target}")
print("Kokoro ready.")
