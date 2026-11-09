"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines, ArrowDownToLine, Check, CheckCircle2, ChevronRight,
  CircleHelp, Clock3, CloudUpload, Headphones, Menu, Mic2, Music2,
  Radio, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, WandSparkles,
  Wifi, WifiOff, X, Zap,
} from "lucide-react";

type Mode = "preset" | "emotion" | "clone";
type Voice = { id: string; name: string; detail: string; language: string };
type Catalog = {
  voices: Voice[];
  speakers: string[];
  languages: string[];
  emotions: string[];
  models: { preset_ready: boolean; qwen_installed: boolean };
};
type Track = { id: number; url: string; title: string; mode: Mode; time: string };

const fallbackVoices: Voice[] = [
  { id: "af_sarah", name: "Sarah", detail: "Warm & clear", language: "English (US)" },
  { id: "af_bella", name: "Bella", detail: "Soft & expressive", language: "English (US)" },
  { id: "af_nicole", name: "Nicole", detail: "Smooth & elegant", language: "English (US)" },
  { id: "af_heart", name: "Heart", detail: "Friendly & bright", language: "English (US)" },
  { id: "am_adam", name: "Adam", detail: "Confident & deep", language: "English (US)" },
  { id: "am_michael", name: "Michael", detail: "Natural & balanced", language: "English (US)" },
  { id: "bf_emma", name: "Emma", detail: "British & gentle", language: "English (UK)" },
  { id: "bm_george", name: "George", detail: "British & refined", language: "English (UK)" },
];
const speakers = ["Ryan", "Aiden", "Vivian", "Serena", "Uncle_Fu", "Dylan", "Eric", "Ono_Anna", "Sohee"];
const languages = ["English", "Chinese", "Japanese", "Korean", "German", "French", "Russian", "Portuguese", "Spanish", "Italian", "Auto"];
const emotionItems = [
  { id: "neutral", label: "Neutral", emoji: "◉" },
  { id: "happy", label: "Happy", emoji: "☀" },
  { id: "sad", label: "Sad", emoji: "☁" },
  { id: "excited", label: "Excited", emoji: "✦" },
  { id: "calm", label: "Calm", emoji: "☾" },
  { id: "angry", label: "Angry", emoji: "⚡" },
  { id: "whisper", label: "Whisper", emoji: "♫" },
  { id: "dramatic", label: "Dramatic", emoji: "✧" },
];
const sampleText = "Every great story begins with a voice. Bring your words to life with expressive, natural speech — created entirely on your own AI server.";

const modeDetails: Record<Mode, { heading: string; description: string; engine: string }> = {
  preset: { heading: "Text to speech", description: "Natural narration from a curated library of voices.", engine: "Kokoro · lightweight" },
  emotion: { heading: "Expressive speech", description: "Guide the delivery with emotion and speaking instructions.", engine: "Qwen3 · 1.7B CustomVoice" },
  clone: { heading: "Voice cloning", description: "Create speech in a voice you have permission to use.", engine: "Qwen3 · 0.6B Base" },
};

export default function Home() {
  const [mode, setMode] = useState<Mode>("preset");
  const [text, setText] = useState(sampleText);
  const [voice, setVoice] = useState("af_sarah");
  const [speaker, setSpeaker] = useState("Ryan");
  const [language, setLanguage] = useState("English");
  const [speed, setSpeed] = useState(1);
  const [emotion, setEmotion] = useState("neutral");
  const [instruction, setInstruction] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<Track[]>([]);
  const [current, setCurrent] = useState<Track | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const generatedUrls = useRef<string[]>([]);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetch("/backend/api/health", { cache: "no-store" }),
      fetch("/backend/api/catalog", { cache: "no-store" }),
    ]).then(async ([health, list]) => {
      if (!health.ok || !list.ok) throw new Error("Backend unavailable");
      const data = (await list.json()) as Catalog;
      if (mounted) { setConnected(true); setCatalog(data); }
    }).catch(() => { if (mounted) setConnected(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const urls = generatedUrls.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const activeVoice = useMemo(() => (catalog?.voices ?? fallbackVoices).find(v => v.id === voice), [voice, catalog]);
  const maxChars = mode === "preset" ? 2000 : 500;
  const missingModel = mode === "preset" ? catalog?.models.preset_ready === false : catalog?.models.qwen_installed === false;

  async function handleGenerate() {
    setError("");
    if (!text.trim()) { setError("Enter some text to generate speech."); return; }
    if (text.length > maxChars) { setError(`This mode accepts up to ${maxChars} characters.`); return; }
    if (mode === "clone" && (!referenceFile || !referenceText.trim() || !consent)) {
      setError("Upload a reference recording, add its exact transcript, and confirm permission."); return;
    }
    setGenerating(true);
    try {
      const body = new FormData();
      body.append("mode", mode);
      body.append("text", text);
      body.append("voice", voice);
      body.append("speed", String(speed));
      body.append("speaker", speaker);
      body.append("language", language);
      body.append("emotion", emotion);
      body.append("instruction", instruction);
      body.append("reference_text", referenceText);
      body.append("consent", String(consent));
      if (mode === "clone" && referenceFile) body.append("reference_audio", referenceFile);

      const response = await fetch("/backend/api/generate", { method: "POST", body });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(typeof data?.detail === "string" ? data.detail : `Generation failed (HTTP ${response.status}).`);
      }
      const blob = await response.blob();
      if (blob.size === 0) throw new Error("The server returned an empty audio file.");
      const url = URL.createObjectURL(blob);
      generatedUrls.current.push(url);
      const track: Track = {
        id: Date.now(), url, title: text.trim().slice(0, 63), mode,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setCurrent(track);
      setHistory(previous => [track, ...previous].slice(0, 8));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate audio.");
    } finally {
      setGenerating(false);
    }
  }

  function changeMode(nextMode: Mode) {
    setMode(nextMode);
    setError("");
    setMobileMenu(false);
  }

  return (
    <div className="site-shell">
      {mobileMenu && <button className="mobile-overlay" aria-label="Close navigation" onClick={() => setMobileMenu(false)} />}
      <aside className={`sidebar ${mobileMenu ? "open" : ""}`}>
        <div className="logo-bar"><div className="brand-icon"><AudioLines size={24} strokeWidth={2.6} /></div><span className="brand-name">vox<span>studio</span></span><button className="mobile-close" aria-label="Close menu" onClick={() => setMobileMenu(false)}><X size={19}/></button></div>
        <div className="sidebar-group"><div className="nav-caption">WORKSPACE</div>
          <button className="nav-item active" onClick={() => changeMode("preset")}><AudioLines size={18}/> Voice Studio <span className="nav-dot"/></button>
          <button className="nav-item" onClick={() => changeMode("clone")}><Mic2 size={18}/> Voice Cloning <ChevronRight size={15} className="nav-trail" /></button>
          <button className="nav-item" onClick={() => changeMode("emotion")}><WandSparkles size={18}/> Expressive Voice <ChevronRight size={15} className="nav-trail" /></button>
        </div>
        <div className="sidebar-group secondary-group"><div className="nav-caption">YOUR LIBRARY</div>
          <a href="#results" className="nav-item" onClick={() => setMobileMenu(false)}><Music2 size={18}/> Recent generations <span className="library-count">{history.length}</span></a>
          <a href="#guide" className="nav-item" onClick={() => setMobileMenu(false)}><CircleHelp size={18}/> How it works</a>
        </div>
        <div className="sidebar-spacer"/>
        <div className="sidebar-note"><div className="note-head"><ShieldCheck size={17}/> Your voices, your server</div><p>No external AI inference API. Files are processed on your server.</p></div>
        <div className="sidebar-footer"><div className="server-dot"/><div><strong>Self-hosted edition</strong><small>Open-source AI models</small></div><Zap size={16} className="footer-zap"/></div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left"><button aria-label="Open navigation" className="menu-button" onClick={() => setMobileMenu(true)}><Menu size={22}/></button><span className="breadcrumb">Workspace</span><ChevronRight size={14} className="breadcrumb-chevron"/><span className="breadcrumb-active">Voice Studio</span></div>
          <div className={`connection-state ${connected === false ? "disconnected" : ""}`}>
            {connected === false ? <WifiOff size={14}/> : <Wifi size={14}/>}
            <span>{connected === null ? "Connecting..." : connected ? "Server connected" : "Server offline"}</span>
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading"><div className="eyebrow"><Sparkles size={13}/> AI VOICE WORKSPACE <span className="eyebrow-line"/></div><h1>Make every word <span>sound alive.</span></h1><p>Studio-quality speech, powered by models running on your own hardware.</p></div>

          <div className="mode-switcher" role="tablist" aria-label="Generation mode">
            <button role="tab" aria-selected={mode === "preset"} onClick={() => changeMode("preset")} className={mode === "preset" ? "selected" : ""}><AudioLines size={17}/> Text to speech</button>
            <button role="tab" aria-selected={mode === "emotion"} onClick={() => changeMode("emotion")} className={mode === "emotion" ? "selected" : ""}><WandSparkles size={17}/> Expressive voice</button>
            <button role="tab" aria-selected={mode === "clone"} onClick={() => changeMode("clone")} className={mode === "clone" ? "selected" : ""}><Mic2 size={17}/> Voice cloning</button>
          </div>

          <div className="workspace-grid">
            <section className="primary-col">
              <div className="panel script-panel"><div className="panel-header"><div className="panel-icon"><Settings2 size={18}/></div><div><h2>{modeDetails[mode].heading}</h2><p>{modeDetails[mode].description}</p></div><div className="panel-header-right"><span className="pill-neutral">{modeDetails[mode].engine}</span></div></div>
                <div className="panel-content"><div className="input-label-row"><label htmlFor="script">Your script</label><span className="char-count">{text.length} / {maxChars}</span></div>
                  <textarea id="script" className="script-area" maxLength={2500} placeholder="Enter the words you want to turn into speech..." value={text} onChange={e => setText(e.target.value)}/>
                  <div className="script-foot"><span><CheckCircle2 size={14}/> Paste a script or start typing</span><button className="text-button" onClick={() => setText(sampleText)}>Use sample text</button></div>
                </div>
              </div>

              {mode === "preset" && <div className="panel voices-panel"><div className="panel-header compact"><div className="panel-icon"><Headphones size={18}/></div><div><h2>Choose a voice</h2><p>Find the perfect tone for your message.</p></div><div className="panel-header-right"><span className="count-pill">{(catalog?.voices ?? fallbackVoices).length} voices</span></div></div>
                <div className="voice-grid">{(catalog?.voices ?? fallbackVoices).map((item, i) => <button key={item.id} onClick={() => setVoice(item.id)} className={`voice-card ${voice === item.id ? "chosen" : ""}`} aria-pressed={voice === item.id}>
                  <div className={`avatar avatar-${i % 5}`}>{item.name.charAt(0)}</div><div className="voice-info"><strong>{item.name}</strong><span>{item.detail}</span><small>{item.language}</small></div><span className="voice-check">{voice === item.id && <Check size={13} strokeWidth={3}/>}</span>
                </button>)}</div>
              </div>}

              {mode === "emotion" && <div className="panel"><div className="panel-header compact"><div className="panel-icon"><WandSparkles size={18}/></div><div><h2>Art direction</h2><p>Control how your voice feels and sounds.</p></div></div>
                <div className="panel-content"><div className="input-label-row"><label htmlFor="speaker">Speaker</label></div><select id="speaker" value={speaker} onChange={e => setSpeaker(e.target.value)} className="select-input">{(catalog?.speakers ?? speakers).map(item => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select>
                  <label className="field-label">Emotion</label><div className="emotion-grid">{emotionItems.map(item => <button key={item.id} className={`emotion-card ${emotion === item.id ? "chosen" : ""}`} onClick={() => setEmotion(item.id)} aria-pressed={emotion === item.id}><span>{item.emoji}</span>{item.label}</button>)}</div>
                  <label className="field-label" htmlFor="instruction">Additional direction <span className="optional">optional</span></label><input id="instruction" className="text-input" maxLength={250} placeholder="E.g. Sound like an enthusiastic storyteller..." value={instruction} onChange={e => setInstruction(e.target.value)}/>
                  <p className="field-help">Emotion styles are model instructions, not guaranteed audio transformations.</p>
                </div>
              </div>}

              {mode === "clone" && <div className="panel"><div className="panel-header compact"><div className="panel-icon"><Mic2 size={18}/></div><div><h2>Reference voice</h2><p>Provide a clear 2–30-second recording and its transcript.</p></div></div>
                <div className="panel-content"><label htmlFor="reference" className="upload-box"><CloudUpload size={28}/><strong>{referenceFile ? referenceFile.name : "Choose an audio file"}</strong><span>WAV, MP3, M4A, MP4, OGG, WEBM, FLAC or AAC · up to 12 MB</span><input id="reference" type="file" accept="audio/*,.wav,.mp3,.m4a,.mp4,.ogg,.webm,.flac,.aac" onChange={e => setReferenceFile(e.target.files?.[0] ?? null)}/></label>
                  <label htmlFor="referenceText" className="field-label">Exact words spoken in the recording</label><textarea id="referenceText" className="reference-text" maxLength={600} placeholder="Write what the person says in the uploaded clip..." value={referenceText} onChange={e => setReferenceText(e.target.value)}/>
                  <label className="consent-row"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/><span>I am the speaker or have the speaker’s explicit permission to clone this voice.</span></label>
                </div>
              </div>}

              <div className="generate-panel"><div><div className="generate-panel-title"><Sparkles size={17}/> Ready to create?</div><p>Generate natural speech directly on your server.</p></div><button className="generate-button" disabled={generating} onClick={handleGenerate}>{generating ? <><span className="spinner"/> Generating...</> : <><AudioLines size={18}/> Generate speech <ChevronRight size={17}/></>}</button></div>
              {missingModel && <div className="notice"><CircleHelp size={17}/><span>{mode === "preset" ? "Kokoro weights are not downloaded yet. Run the download script in the README." : "Qwen3-TTS is not installed yet. Install the optional advanced backend requirements."}</span></div>}
              {error && <div className="error-notice" role="alert"><CircleHelp size={17}/><span>{error}</span></div>}
            </section>

            <aside className="controls-col"><div className="panel settings-panel"><div className="panel-header compact"><div className="panel-icon"><SlidersHorizontal size={18}/></div><div><h2>Voice settings</h2><p>Fine-tune your output.</p></div></div>
              <div className="panel-content settings-content">{mode === "preset" ? <><div className="setting-block"><div className="input-label-row"><label htmlFor="speed">Speaking speed</label><span className="value-pill">{speed.toFixed(2)}×</span></div><input id="speed" type="range" min="0.7" max="1.3" step="0.05" value={speed} onChange={e => setSpeed(Number(e.target.value))} /><div className="range-captions"><span>Slower</span><span>Faster</span></div></div><div className="setting-block"><label className="field-label">Selected voice</label><div className="selected-voice"><div className="avatar avatar-1">{activeVoice?.name.charAt(0) ?? "S"}</div><div><strong>{activeVoice?.name ?? "Sarah"}</strong><small>{activeVoice?.detail ?? "Warm & clear"}</small></div><CheckCircle2 size={17}/></div></div><div className="tip"><Zap size={17}/><span>Preset mode is optimized for lower-memory CPU inference.</span></div></> : <><div className="setting-block"><label htmlFor="language" className="field-label">Output language</label><select id="language" className="select-input" value={language} onChange={e => setLanguage(e.target.value)}>{(catalog?.languages ?? languages).map(item => <option key={item} value={item}>{item}</option>)}</select></div><div className="tip"><Zap size={17}/><span>{mode === "clone" ? "Use a clean voice recording with little background noise. Emotion instructions are not available in cloning mode." : "First use may download a multi-gigabyte model. The 1.7B engine needs substantial RAM or GPU memory."}</span></div></>}</div></div>
              <div className="help-panel" id="guide"><div className="help-icon"><Radio size={21}/></div><h3>100% your infrastructure</h3><p>No per-character fees from an AI provider. Your backend processes text and reference audio locally.</p><a href="https://github.com/QwenLM/Qwen3-TTS" target="_blank" rel="noreferrer">About the models <ChevronRight size={15}/></a></div>
            </aside>
          </div>

          <section className="results-section" id="results"><div className="results-title"><div><span className="results-kicker">YOUR OUTPUT</span><h2>Generated audio</h2></div><span className="count-pill">{history.length} this session</span></div>
            {current ? <div className="audio-result"><div className="result-art"><AudioLines size={27}/></div><div className="result-data"><div className="result-heading"><span className="ready-label"><span className="ready-dot"/> Ready to listen</span><span className="result-clock"><Clock3 size={13}/> {current.time}</span></div><strong>{current.title}{current.title.length >= 63 ? "…" : ""}</strong><audio key={current.url} controls preload="metadata" src={current.url} className="audio-control" /></div><a className="download-button" href={current.url} download={`voxstudio-${current.id}.wav`} title="Download WAV"><ArrowDownToLine size={18}/><span>Download</span></a></div>
            : <div className="empty-output"><div className="empty-icon"><Music2 size={26}/></div><strong>Your audio will appear here</strong><span>Enter text, choose your settings, and generate to get started.</span></div>}
            {history.length > 1 && <div className="history-list">{history.slice(1).map(track => <button key={track.id} className="history-item" onClick={() => setCurrent(track)}><Music2 size={15}/><span>{track.title}</span><small>{track.time}</small><ChevronRight size={15}/></button>)}</div>}
          </section>
          <footer className="page-footer"><span>VoxStudio · Independent speech synthesis</span><span><ShieldCheck size={14}/> Your data stays on your server</span></footer>
        </div>
      </main>
    </div>
  );
}
