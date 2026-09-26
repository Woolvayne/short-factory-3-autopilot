/**
 * Narration engine — zwei Wege, automatisch gewählt:
 *
 *   1. **Eingebauter Server** (`npm start` auf dem Pi/Heimserver): Der Browser
 *      POSTet an `/api/tts`, das Edge-Read-Aloud-Relay spricht — neurale
 *      Stimmen + ECHTE Wort-Timings (Karaoke-Captions tickgenau), kostenlos.
 *   2. **Rein statische Seite** (kein Server erreichbar): Die App spricht den
 *      freien Web-TTS-Endpunkt von StreamElements direkt an (kein API-Key) und
 *      schätzt die Wort-Timings aus der gemessenen Audio-Dauer. Tempo ±40 %
 *      wird offline in die Datei gebrannt (OfflineAudioContext).
 *
 * Die Außenwelt sieht in beiden Fällen dasselbe: `synthesizeSpeech(text,
 * voice, rate, pitch) → { audio, words, duration }` — der Renderer bleibt
 * unverändert.
 */

import { probeBackend } from "./relay";

const TTS_ENDPOINT = "/api/tts";

export interface WordTs {
  text: string;
  offset: number;   // seconds from the start of the returned audio
  duration: number; // seconds
}

export interface Cue {
  text: string;
  start: number;
  end: number;
}

export interface TtsResult {
  /** MP3 (Server) bzw. PCM-WAV (Browser-Fallback) — `decodeAudioData` frisst beides */
  audio: ArrayBuffer;
  words: WordTs[];
  /** voice duration incl. tail padding, seconds */
  duration: number;
}

/* ------------------------------------------------------------------ */
/*  Weg 1 — Server-Relay /api/tts (Edge Read-Aloud, echte Timings)      */
/* ------------------------------------------------------------------ */

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function synthesizeViaRelay(
  text: string,
  voice: string,
  rate: number,
  pitch: number
): Promise<TtsResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 75_000);
  try {
    const res = await fetch(TTS_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice, rate, pitch }),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.audioBase64) {
      throw new Error(
        typeof data?.error === "string"
          ? data.error
          : `TTS relay failed (HTTP ${res.status ?? "?"})`
      );
    }

    const audio = base64ToArrayBuffer(data.audioBase64 as string);
    if (audio.byteLength === 0) throw new Error("TTS relay returned no audio");

    const words: WordTs[] = (Array.isArray(data.words) ? data.words : []).map(
      (w: { text?: string; offset?: number; duration?: number }) => ({
        text: String(w?.text ?? ""),
        offset: Number(w?.offset ?? 0),
        duration: Number(w?.duration ?? 0),
      })
    );

    const last = words[words.length - 1];
    return {
      audio,
      words,
      duration: last ? last.offset + last.duration + 0.7 : 4,
    };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("TTS relay timed out after 75s");
    }
    throw e instanceof Error ? e : new Error(String(e));
  } finally {
    window.clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/*  Weg 2 — Browser-Engine (freier Web-TTS, geschätzte Timings)          */
/* ------------------------------------------------------------------ */

const BROWSER_TTS_BASE = "https://api.streamelements.com/kappa/v2/speech";

export interface TtsVoice {
  id: string;
  label: string;
}

/** Stimmen der Browser-Engine (kein Key nötig). */
export const BROWSER_TTS_VOICES: TtsVoice[] = [
  { id: "Matthew", label: "Matthew · US male" },
  { id: "Brian", label: "Brian · British male, warm" },
  { id: "Justin", label: "Justin · US male, young" },
  { id: "Joey", label: "Joey · US male, casual" },
  { id: "Russell", label: "Russell · Australian male" },
  { id: "Kendra", label: "Kendra · US female, warm" },
  { id: "Joanna", label: "Joanna · US female, narration" },
  { id: "Kimberly", label: "Kimberly · US female, casual" },
  { id: "Ivy", label: "Ivy · US female, bright" },
  { id: "Salli", label: "Salli · US female, clear" },
  { id: "Amy", label: "Amy · British female" },
  { id: "Emma", label: "Emma · British female, calm" },
];

/** Alte/Server-Stimmen-IDs → nächstliegende Stimme der Browser-Engine. */
const FALLBACK_VOICE_MAP: Record<string, string> = {
  "en-US-AndrewNeural": "Matthew",
  "en-US-ChristopherNeural": "Matthew",
  "en-US-GuyNeural": "Justin",
  "en-US-BrianNeural": "Brian",
  "en-US-SteffanNeural": "Joey",
  "en-US-JennyNeural": "Kimberly",
  "en-US-AriaNeural": "Joanna",
  "en-US-MichelleNeural": "Amy",
  "en-GB-RyanNeural": "Brian",
  "en-GB-SoniaNeural": "Amy",
  "en-AU-NatashaNeural": "Salli",
  "en-IE-ConnorNeural": "Justin",
};

const mapBrowserVoice = (voice: string): string =>
  BROWSER_TTS_VOICES.some((v) => v.id === voice)
    ? voice
    : (FALLBACK_VOICE_MAP[voice] ?? "Matthew");

let sharedCtx: AudioContext | null = null;

/** Lazily created decode context — `decodeAudioData` works while suspended. */
function decodeCtx(): AudioContext {
  if (sharedCtx) return sharedCtx;
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  sharedCtx = new AC();
  return sharedCtx;
}

const AnyOffline: typeof OfflineAudioContext | undefined =
  typeof OfflineAudioContext !== "undefined"
    ? OfflineAudioContext
    : (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
        .webkitOfflineAudioContext;

/** Sprech-Tempo neu rendern (tape-style) — für den Browser-Fallback. */
async function stretchBuffer(buffer: AudioBuffer, ratePercent: number): Promise<AudioBuffer> {
  const ratio = Math.min(1.4, Math.max(0.6, 1 + ratePercent / 100));
  if (Math.abs(ratio - 1) < 0.001 || !AnyOffline) return buffer;
  const rate = Math.max(44100, buffer.sampleRate);
  const length = Math.max(1, Math.ceil((buffer.duration / ratio) * rate));
  const oc = new AnyOffline(1, length, rate);
  const src = oc.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = ratio;
  src.connect(oc.destination);
  src.start(0);
  return oc.startRendering();
}

/** PCM 16-bit WAV (mono) — überall dekodierbar. */
function encodeWavPcm16(source: AudioBuffer): ArrayBuffer {
  const length = source.length;
  const mix = new Float32Array(length);
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    const data = source.getChannelData(ch);
    if (ch === 0) mix.set(data);
    else {
      for (let i = 0; i < length; i++) mix[i] += data[i];
    }
  }
  const scale = 1 / source.numberOfChannels;
  const sampleRate = source.sampleRate;
  const bytesPerSample = 2;
  const dataSize = length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, mix[i] * scale));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

/**
 * Verteilt die gemessene Audio-Dauer proportional auf die Wörter — Gewicht aus
 * Buchstabenzahl, Grundsprechpause pro Wort, Extra-Pausen an Komma/Punkt.
 */
export function estimateWordTimings(text: string, totalDuration: number): WordTs[] {
  const tokens = text.match(/\S+/g) ?? [];
  if (!tokens.length || totalDuration <= 0) return [];
  const weights = tokens.map((tok) => {
    const letters = (tok.match(/[\p{L}\p{N}]/gu) ?? []).length;
    let w = Math.max(1, letters) + 2.2;
    if (/[,;:]$/.test(tok)) w += 2.6;
    if (/[.!?…]["'”)\]]*$/.test(tok)) w += 5.5;
    return w;
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  const leadIn = Math.min(0.09, totalDuration * 0.03);
  const speakable = Math.max(totalDuration - leadIn - 0.12, tokens.length * 0.05);
  const out: WordTs[] = [];
  let t = leadIn;
  for (let i = 0; i < tokens.length; i++) {
    const duration = (weights[i] / sum) * speakable;
    out.push({ text: tokens[i], offset: t, duration });
    t += duration;
  }
  return out;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchBrowserVoiceMp3(text: string, voice: string, timeoutMs = 30_000): Promise<ArrayBuffer> {
  const url = `${BROWSER_TTS_BASE}?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(
    text.slice(0, 2900)
  )}`;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, mode: "cors" });
    if (res.status === 429) {
      throw new Error(
        "Die freie Stimmen-Engine ist kurz ausgelastet (HTTP 429) — gleich noch einmal versuchen."
      );
    }
    if (!res.ok) throw new Error(`Voice-Engine meldet HTTP ${res.status}`);
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    const buf = await res.arrayBuffer();
    if (!buf.byteLength) throw new Error("Voice-Engine lieferte kein Audio");
    if (type && !type.includes("audio") && !type.includes("octet-stream")) {
      throw new Error(`Voice-Engine lieferte ${type} statt Audio`);
    }
    return buf;
  } finally {
    window.clearTimeout(timer);
  }
}

async function synthesizeInBrowser(
  text: string,
  voice: string,
  rate: number,
  pitch: number
): Promise<TtsResult> {
  void pitch; /* die Browser-Engine kann kein Pitch — Server-Engine schon */
  const engineVoice = mapBrowserVoice(voice);

  let lastError: unknown = null;
  let mp3: ArrayBuffer | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      mp3 = await fetchBrowserVoiceMp3(text, engineVoice);
      break;
    } catch (e) {
      lastError = e;
      await wait(900 * (attempt + 1));
    }
  }
  if (!mp3) {
    throw lastError instanceof Error
      ? lastError
      : new Error("Voice-Engine nicht erreichbar — bitte Internet-Verbindung prüfen.");
  }

  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx().decodeAudioData(mp3.slice(0));
  } catch {
    throw new Error("Das Voice-Audio ließ sich nicht dekodieren.");
  }

  const naturalDuration = decoded.duration;
  const rendered = await stretchBuffer(decoded, rate);
  const wav = encodeWavPcm16(rendered);
  const ratio = rendered.duration > 0 ? naturalDuration / rendered.duration : 1;
  const words = estimateWordTimings(text, naturalDuration).map((w) => ({
    text: w.text,
    offset: w.offset * ratio,
    duration: w.duration * ratio,
  }));
  const last = words[words.length - 1];

  return {
    audio: wav,
    words,
    duration: last ? last.offset + last.duration + 0.7 : Math.max(rendered.duration, 4),
  };
}

/* ------------------------------------------------------------------ */
/*  Öffentliche API                                                      */
/* ------------------------------------------------------------------ */

/**
 * Spricht `text` mit `voice` ein. Mit eingebautem Server über das Edge-Relay
 * (echte Wort-Timings), sonst direkt aus dem Browser (geschätzte Timings).
 */
export async function synthesizeSpeech(
  text: string,
  voice: string,
  rate = 0,
  pitch = 0
): Promise<TtsResult> {
  if (await probeBackend()) return synthesizeViaRelay(text, voice, rate, pitch);
  return synthesizeInBrowser(text, voice, rate, pitch);
}

/* ------------------------------------------------------------------ */
/*  Caption cues (unverändert)                                           */
/* ------------------------------------------------------------------ */

/** group word boundaries into caption cues of N words (default 3) */
export function buildCues(words: WordTs[], maxEnd: number, perCue = 3): Cue[] {
  const usable = words.filter((w) => w.text && w.offset < maxEnd);
  if (!usable.length) return [];
  const size = Math.max(1, Math.min(6, Math.round(perCue)));
  const groups: WordTs[][] = [];
  for (let i = 0; i < usable.length; i += size) groups.push(usable.slice(i, i + size));
  /* avoid a lonely trailing word when grouping 2+ */
  if (size > 1 && groups.length > 1 && groups[groups.length - 1].length === 1) {
    const last = groups.pop()!;
    groups[groups.length - 1].push(...last);
  }
  return groups.map((g) => ({
    text: g.map((w) => w.text).join(" "),
    start: g[0].offset,
    end: Math.min(g[g.length - 1].offset + g[g.length - 1].duration, maxEnd),
  }));
}

export const cueAt = (cues: Cue[], t: number): Cue | undefined =>
  cues.find((c) => t >= c.start - 0.04 && t < c.end + 0.12);
