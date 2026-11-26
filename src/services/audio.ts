export type SoundName =
  | 'click'
  | 'ok'
  | 'cancel'
  | 'toggle'
  | 'keystroke'
  | 'scanFound'
  | 'materialize'
  | 'success'
  | 'error'
  | 'victory'
  | 'scanStart'
  | 'penaltyReset'
  | 'hintStart'
  | 'hintReveal'
  | 'submit'
  | 'powerUp'
  | 'victoryLong'
  | 'hologram'
  | 'pokeballDrop'
  | 'pokeballOpen'
  | 'pokemonBounce'
  | 'pokemonHop'
  | 'finalCelebration'
  | 'penalty'
  | 'penaltyComplete'
  | string;

const CATCH_FEMALE_VOICE_NAMES = [
  'female', 'zira', 'susan', 'hazel', 'catherine', 'linda', 'heera',
  'victoria', 'samantha', 'karen', 'moira', 'fiona', 'tessa', 'stephanie',
  'alva', 'ayanda', 'agnes', 'allison', 'ava', 'helena', 'jennifer', 'kathy',
  'siri', 'cortana', 'sonia', 'aria', 'jenny', 'hoda', 'martha', 'nicky',
  'libby', 'sara', 'natasha', 'xiaoxiao', 'ting-ting', 'yuna', 'zhiyu',
  'google us english', 'google uk english female', 'joanna', 'amy', 'emma', 'michelle',
  'swara', 'lekha', 'kalpana', 'neerja', 'aditi', 'kajal', 'ananya',
  'claire', 'serena', 'kate', 'veena', 'monica', 'laura', 'anna', 'nora',
  'maisie', 'abbie', 'bella', 'sonia', 'hollie', 'charlotte', 'clara',
];

const CATCH_MALE_VOICE_NAMES = [
  'male', 'google uk english male', 'david', 'mark', 'guy', 'george', 'james', 'daniel', 'richard',
  'fred', 'liam', 'thomas', 'ravi', 'prabhat', 'rishi',
  'brian', 'andrew', 'eddie', 'matthew', 'steven', 'paul', 'peter', 'sean',
  'lee', 'aaron', 'charles', 'william', 'alex', 'oliver', 'ryan', 'tom',
  'chris', 'christopher', 'eric', 'steffan', 'davis', 'tony', 'jason', 'brandon', 'jacob',
  'arthur', 'bruce', 'gordon', 'henry', 'roger', 'yannick', 'malcolm', 'jamie', 'evan', 'nathan',
  'reed', 'rocko', 'eddy', 'grandpa', 'ralph', 'junior',
];

const CATCH_FEMALE_VETO = -10000;
const CATCH_VOICE_STORE_KEY = 'pykachu.catchVoice.v3';
const CELEBRATION_TOTAL_SECONDS = 15;
const CELEBRATION_LEAD = 0.08;
const CELEBRATION_FADE_IN = 0.25;
const CELEBRATION_AUDIO_URL = '/assets/sound.mp3';
const BGM_URL = 'https://play.pokemonshowdown.com/audio/music/battle-trainer.mp3';

let audioContext: AudioContext | null = null;
let isMutedState = false;
let soundEnabled = true;
let audioInitialized = false;
let lastUiSoundKey = '';
let lastUiSoundTime = 0;

let catchVoice: SpeechSynthesisVoice | null = null;
let catchVoiceChecked = false;
let catchVoiceIsMale = false;
let catchSpeakTimer: ReturnType<typeof setTimeout> | null = null;
let catchRevealTimer: ReturnType<typeof setTimeout> | null = null;
let speechUnlocked = false;

const celebrationNoiseBuffers = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();
let celebrationAudioBuffer: AudioBuffer | null = null;
let celebrationAudioPromise: Promise<AudioBuffer | null> | null = null;
let celebrationAudioFailed = false;
let celebrationAudioEl: HTMLAudioElement | null = null;
let celebrationRenderedBuffer: AudioBuffer | null = null;
let celebrationRenderPromise: Promise<AudioBuffer | null> | null = null;

let bgMusicEl: HTMLAudioElement | null = null;
let bgMusicPausedByLockdown = false;
let bgMusicDesiredActive = false;
let synthBgmTimer: ReturnType<typeof setInterval> | null = null;
let synthBgmStep = 0;

function scoreCatchVoice(v: SpeechSynthesisVoice): number {
  const name = (v.name || '').toLowerCase();
  const lang = (v.lang || '').toLowerCase();
  if (CATCH_FEMALE_VOICE_NAMES.some((k) => name.includes(k))) return CATCH_FEMALE_VETO;

  let score = 0;
  if (name.includes('male')) score += 600;
  if (CATCH_MALE_VOICE_NAMES.some((k) => name.includes(k))) score += 350;
  if (/^en[-_]?/i.test(lang)) score += 40;
  if (/^en[-_]us/i.test(lang)) score += 12;
  else if (/^en[-_]gb/i.test(lang)) score += 10;
  else if (/^en[-_](au|ca|in)/i.test(lang)) score += 6;
  if (name.includes('natural')) score += 20;
  if (name.includes('google')) score += 12;
  if (v.localService) score += 4;
  if (/espeak|-x-[a-z]+#/.test(name)) score -= 80;
  return score;
}

function isMaleLabelledVoice(v: SpeechSynthesisVoice | null): boolean {
  const name = (v?.name || '').toLowerCase();
  if (CATCH_FEMALE_VOICE_NAMES.some((k) => name.includes(k))) return false;
  return name.includes('male') || CATCH_MALE_VOICE_NAMES.some((k) => name.includes(k));
}

function readStoredCatchVoiceName(): string {
  try {
    return window.localStorage.getItem(CATCH_VOICE_STORE_KEY) || '';
  } catch {
    return '';
  }
}

function storeCatchVoiceName(voice: SpeechSynthesisVoice | null): void {
  try {
    if (voice && voice.name) window.localStorage.setItem(CATCH_VOICE_STORE_KEY, voice.name);
  } catch {
    // ignore private mode
  }
}

function pickCatchVoice(
  voices: SpeechSynthesisVoice[]
): { voice: SpeechSynthesisVoice | null; isMale: boolean } | null {
  if (!voices || !voices.length) return null;
  const english = voices.filter((v) => /^en([-_]|$)/i.test(v.lang || ''));
  const pool = english.length ? english : voices;

  const stored = readStoredCatchVoiceName().toLowerCase();
  if (stored) {
    const remembered = pool.find((v) => (v.name || '').toLowerCase() === stored && !CATCH_FEMALE_VOICE_NAMES.some((k) => stored.includes(k)));
    if (remembered) {
      return {
        voice: remembered,
        isMale: isMaleLabelledVoice(remembered),
      };
    }
  }

  const ranked = pool
    .map((v, i) => ({ v, i, s: scoreCatchVoice(v) }))
    .filter((e) => e.s !== CATCH_FEMALE_VETO)
    .sort((a, b) => b.s - a.s || a.i - b.i);

  if (ranked.length) {
    const voice = ranked[0].v;
    return {
      voice,
      isMale: isMaleLabelledVoice(voice),
    };
  }

  const fallback = pool[0] || null;
  return { voice: fallback, isMale: isMaleLabelledVoice(fallback) };
}

function refreshCatchVoice(): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || !voices.length) return;

  const picked = pickCatchVoice(voices);
  if (!picked) return;

  catchVoice = picked.voice;
  catchVoiceIsMale = picked.isMale;
  catchVoiceChecked = !!catchVoice;

  if (catchVoice && catchVoiceIsMale) {
    storeCatchVoiceName(catchVoice);
  } else if (readStoredCatchVoiceName()) {
    try {
      window.localStorage.removeItem(CATCH_VOICE_STORE_KEY);
    } catch {
      // ignore
    }
  }
}

function playWhosThatPokemonMysterySting(): void {
  if (!soundEnabled || isMutedState || !audioContext) return;
  try {
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    const ctx = audioContext;
    const now = ctx.currentTime;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    master.gain.setValueAtTime(0.18, now + 0.72);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 1.05);

    // Classic 90s TV broadcast warmth
    const tv = ctx.createBiquadFilter();
    tv.type = 'bandpass';
    tv.frequency.value = 1450;
    tv.Q.value = 0.75;
    tv.connect(master);
    master.connect(ctx.destination);

    // Snappy brass stab helper (detuned sawtooth pair + punchy lowpass)
    const brassHit = (freq: number, at: number, dur: number, level: number) => {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1100, at);
      lp.frequency.exponentialRampToValueAtTime(3200, at + 0.045);
      lp.frequency.exponentialRampToValueAtTime(1600, at + dur);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(level, at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);

      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      o1.type = 'sawtooth';
      o2.type = 'square';
      o1.frequency.value = freq;
      o2.frequency.value = freq * 1.005;
      o1.connect(lp);
      o2.connect(lp);
      lp.connect(g);
      g.connect(tv);
      o1.start(at);
      o2.start(at);
      o1.stop(at + dur + 0.02);
      o2.stop(at + dur + 0.02);
    };

    // Punchy "Who's That Pokémon?" / "Kaun Hai Yeh Pokémon?" motif:
    // Ba-da-da-DUM! (D4 -> E4 -> F#4 -> A4!)
    brassHit(293.66, now, 0.11, 0.28);
    brassHit(329.63, now + 0.12, 0.11, 0.28);
    brassHit(369.99, now + 0.24, 0.12, 0.32);
    brassHit(440.0, now + 0.39, 0.38, 0.42);
    brassHit(587.33, now + 0.39, 0.38, 0.24);

    // Snare + bass punch under the sting
    const nLen = 0.12;
    const nBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * nLen), ctx.sampleRate);
    const nd = nBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    [0, 0.39].forEach((offset, idx) => {
      const src = ctx.createBufferSource();
      src.buffer = nBuf;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1800;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(idx === 1 ? 0.22 : 0.14, now + offset);
      ng.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.11);
      src.connect(hp);
      hp.connect(ng);
      ng.connect(tv);
      src.start(now + offset);
    });
  } catch (e) {
    console.warn('Mystery sting failed:', e);
  }
}

function playPokemonRevealFanfare(): void {
  if (!soundEnabled || isMutedState || !audioContext) return;
  try {
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    const ctx = audioContext;
    const now = ctx.currentTime;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
    master.gain.setValueAtTime(0.18, now + 0.85);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 1.45);

    const tv = ctx.createBiquadFilter();
    tv.type = 'bandpass';
    tv.frequency.value = 1550;
    tv.Q.value = 0.8;
    tv.connect(master);
    master.connect(ctx.destination);

    // Triumphant "It's [Pokemon]! / Yeh Hai [Pokemon]!" brass resolve (D5 -> G5!)
    const hitNote = (freq: number, at: number, dur: number, level: number, type: OscillatorType = 'sawtooth') => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(level, at + 0.014);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(g);
      g.connect(tv);
      osc.start(at);
      osc.stop(at + dur + 0.02);
    };

    hitNote(587.33, now, 0.12, 0.25);
    hitNote(659.25, now + 0.12, 0.12, 0.26);
    // Final bright major triumph chord
    [783.99, 987.77, 1174.66, 1567.98].forEach((freq, idx) => {
      hitNote(freq, now + 0.25, 0.65, idx === 0 ? 0.28 : 0.18, idx % 2 === 0 ? 'sawtooth' : 'triangle');
    });

    // Sparkle cascade on reveal
    [1318.51, 1567.98, 1975.53, 2349.32, 2637.02].forEach((freq, idx) => {
      hitNote(freq, now + 0.28 + idx * 0.075, 0.22, 0.08, 'sine');
    });
  } catch (e) {
    console.warn('Reveal fanfare failed:', e);
  }
}

function unlockCatchVoice(): void {
  if (typeof window === 'undefined' || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
  if (speechUnlocked) return;
  speechUnlocked = true;
  try {
    const warm = new SpeechSynthesisUtterance(' ');
    warm.volume = 0;
    window.speechSynthesis.speak(warm);
  } catch {
    // ignore
  }
}

let catchVoiceCleanup: (() => void) | null = null;

export function clearPendingCatchSpeech(): void {
  if (catchVoiceCleanup) {
    const cleanup = catchVoiceCleanup;
    catchVoiceCleanup = null;
    cleanup();
  }
  if (catchSpeakTimer) {
    clearTimeout(catchSpeakTimer);
    catchSpeakTimer = null;
  }
  if (catchRevealTimer) {
    clearTimeout(catchRevealTimer);
    catchRevealTimer = null;
  }
}

export function stopCatchVoice(): void {
  clearPendingCatchSpeech();
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
}

function formatPokemonSpeechName(raw: string): string {
  if (!raw) return 'one';
  const cleaned = String(raw).trim().replace(/[-_]+/g, ' ');
  return cleaned
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function speakCatch(pokemonName: string, announce = true): void {
  if (!soundEnabled || isMutedState) return;
  clearPendingCatchSpeech();

  // Stage 1: "Who's That Pokémon?" / "Kaun Hai Yeh Pokémon?" mystery brass TV sting (at silhouette)
  playWhosThatPokemonMysterySting();

  const name = String(pokemonName || '').trim();
  const line = name ? formatPokemonSpeechName(name) : 'Pikachu';

  if (!announce || typeof window === 'undefined' || !window.speechSynthesis || !window.SpeechSynthesisUtterance) {
    // Still play Stage 2 reveal brass fanfare when the full-color Pokémon emerges
    catchRevealTimer = setTimeout(() => {
      playPokemonRevealFanfare();
    }, 980);
    return;
  }

  const scheduleRevealAnnouncement = () => {
    const triggerReveal = () => {
      catchRevealTimer = null;
      playPokemonRevealFanfare();
      if (!soundEnabled || isMutedState) return;
      try {
        const synth = window.speechSynthesis;
        if (synth.paused) {
          try {
            synth.resume();
          } catch {
            // ignore
          }
        }
        const pitchVal = catchVoiceIsMale ? 0.92 : 0.6;
        const rateVal = catchVoiceIsMale ? 1.08 : 1.04;
        const langTag =
          catchVoice && /^en/i.test(catchVoice.lang || '') ? catchVoice.lang : 'en-US';

        const utter = new SpeechSynthesisUtterance(`Gotcha! You caught ${line}!`);
        if (catchVoice) utter.voice = catchVoice;
        utter.lang = langTag;
        utter.pitch = pitchVal;
        utter.rate = rateVal;
        utter.volume = 1.0;
        synth.speak(utter);
      } catch (e) {
        console.warn('Catch announcement failed:', e);
      }
    };

    // Wait ~950ms for the "Who's That Pokémon?" mystery brass sting to finish on the silhouette,
    // then hit the reveal fanfare + "Gotcha! You caught <Pokemon>!" as the Pokémon emerges in color
    catchRevealTimer = setTimeout(triggerReveal, 950);
  };

  refreshCatchVoice();

  if (!catchVoice) {
    let scheduled = false;
    let voiceWaitTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanupVoiceWait = () => {
      if (voiceWaitTimer) {
        clearTimeout(voiceWaitTimer);
        voiceWaitTimer = null;
      }
      if (typeof window.speechSynthesis.removeEventListener === 'function') {
        window.speechSynthesis.removeEventListener('voiceschanged', once);
      }
    };
    const once = () => {
      if (scheduled) return;
      scheduled = true;
      if (catchVoiceCleanup === cleanupVoiceWait) catchVoiceCleanup = null;
      cleanupVoiceWait();
      refreshCatchVoice();
      scheduleRevealAnnouncement();
    };
    catchVoiceCleanup = cleanupVoiceWait;
    voiceWaitTimer = setTimeout(once, 400);
    catchSpeakTimer = voiceWaitTimer;
    if (typeof window.speechSynthesis.addEventListener === 'function') {
      window.speechSynthesis.addEventListener('voiceschanged', once, { once: true });
    }
  } else {
    scheduleRevealAnnouncement();
  }
}

export function initAudio(): () => void {
  if (audioInitialized) return () => {};
  audioInitialized = true;

  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioContext = new AudioCtx();

    if (!catchVoiceChecked) refreshCatchVoice();
    if (typeof window !== 'undefined' && window.speechSynthesis && typeof window.speechSynthesis.addEventListener === 'function') {
      window.speechSynthesis.addEventListener('voiceschanged', refreshCatchVoice);
    }

    const unlockAudio = () => {
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
      }
      unlockCatchVoice();
    };

    document.addEventListener('pointerdown', unlockAudio, { passive: true });
    document.addEventListener('touchstart', unlockAudio, { passive: true });
    document.addEventListener('keydown', unlockAudio, { passive: true });

    return () => {
      document.removeEventListener('pointerdown', unlockAudio);
      document.removeEventListener('touchstart', unlockAudio);
      document.removeEventListener('keydown', unlockAudio);
      if (typeof window !== 'undefined' && window.speechSynthesis && typeof window.speechSynthesis.removeEventListener === 'function') {
        window.speechSynthesis.removeEventListener('voiceschanged', refreshCatchVoice);
      }
    };
  } catch (e) {
    console.warn('Web Audio API not supported:', e);
    soundEnabled = false;
    return () => {};
  }
}

function noiseCache(ctx: BaseAudioContext): Map<string, AudioBuffer> {
  let cache = celebrationNoiseBuffers.get(ctx);
  if (!cache) {
    cache = new Map();
    celebrationNoiseBuffers.set(ctx, cache);
  }
  return cache;
}

function getCelebrationNoiseBuffer(ctx: BaseAudioContext, seconds: number, tag: string): AudioBuffer {
  const cache = noiseCache(ctx);
  const key = `${tag}:${seconds}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  cache.set(key, buf);
  return buf;
}

function buildClapBuffer(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * 0.035));
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const fc = 2100;
  const f = 2 * Math.sin((Math.PI * fc) / sr);
  const damp = 1.1;
  let low = 0;
  let band = 0;
  for (let i = 0; i < len; i++) {
    const x = Math.random() * 2 - 1;
    const high = x - low - damp * band;
    band += f * high;
    low += f * band;
    const t = i / len;
    const env = t < 0.03 ? t / 0.03 : Math.pow(1 - (t - 0.03) / 0.97, 2.6);
    d[i] = band * env;
  }
  return buf;
}

function getCelebrationClap(ctx: BaseAudioContext): AudioBuffer {
  const cache = noiseCache(ctx);
  const key = 'clap:2100:35ms';
  const hit = cache.get(key);
  if (hit) return hit;
  const buf = buildClapBuffer(ctx);
  cache.set(key, buf);
  return buf;
}

function loadCelebrationAudio(): Promise<AudioBuffer | null> {
  if (celebrationAudioPromise) return celebrationAudioPromise;
  if (!audioContext) return Promise.resolve(null);
  const ctx = audioContext;
  celebrationAudioPromise = fetch(CELEBRATION_AUDIO_URL)
    .then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.arrayBuffer();
    })
    .then((data) => ctx.decodeAudioData(data))
    .then((buf) => {
      celebrationAudioBuffer = buf;
      celebrationAudioFailed = false;
      return buf;
    })
    .catch((err) => {
      console.warn('Celebration track failed to load; using synth cue:', err);
      celebrationAudioFailed = true;
      celebrationAudioPromise = null;
      return null;
    });
  return celebrationAudioPromise;
}

function scheduleFinalCelebrationSting(ctx: BaseAudioContext, startTime: number, volume: number): void {
  const master = ctx.createGain();
  master.gain.value = Math.max(0, Math.min(1, volume ?? 1));
  master.connect(ctx.destination);

  const t0 = startTime + 0.02;
  master.gain.setValueAtTime(1, t0);
  master.gain.setValueAtTime(1, t0 + 13.6);
  master.gain.linearRampToValueAtTime(0, t0 + CELEBRATION_TOTAL_SECONDS);

  const cannonPop = (at: number, level: number) => {
    const crack = ctx.createBufferSource();
    crack.buffer = getCelebrationNoiseBuffer(ctx, 0.3, 'crack');
    const crackHp = ctx.createBiquadFilter();
    crackHp.type = 'highpass';
    crackHp.frequency.value = 1800;
    const crackG = ctx.createGain();
    crackG.gain.setValueAtTime(0.0001, at);
    crackG.gain.exponentialRampToValueAtTime(0.5 * level, at + 0.004);
    crackG.gain.exponentialRampToValueAtTime(0.001, at + 0.14);
    crack.connect(crackHp);
    crackHp.connect(crackG);
    crackG.connect(master);
    crack.start(at);
    crack.stop(at + 0.2);

    const pop = ctx.createOscillator();
    const popG = ctx.createGain();
    pop.type = 'sine';
    pop.frequency.setValueAtTime(190, at);
    pop.frequency.exponentialRampToValueAtTime(52, at + 0.18);
    popG.gain.setValueAtTime(0.0001, at);
    popG.gain.exponentialRampToValueAtTime(0.42 * level, at + 0.006);
    popG.gain.exponentialRampToValueAtTime(0.001, at + 0.22);
    pop.connect(popG);
    popG.connect(master);
    pop.start(at);
    pop.stop(at + 0.24);
  };
  cannonPop(t0, 1);
  cannonPop(t0 + 0.4, 0.42);
  cannonPop(t0 + 0.8, 0.46);
  cannonPop(t0 + 1.2, 0.62);

  const crowdSwell = (startAt: number, peakAt: number, holdUntil: number, endAt: number, peak: number) => {
    const cheerG = ctx.createGain();
    cheerG.gain.setValueAtTime(0.0001, startAt);
    cheerG.gain.exponentialRampToValueAtTime(peak, peakAt);
    cheerG.gain.setValueAtTime(peak, holdUntil);
    cheerG.gain.exponentialRampToValueAtTime(0.001, endAt);
    cheerG.connect(master);

    const cheerLfo = ctx.createOscillator();
    const cheerLfoG = ctx.createGain();
    cheerLfo.type = 'sine';
    cheerLfo.frequency.value = 5.5;
    cheerLfoG.gain.value = 0.09;
    cheerLfo.connect(cheerLfoG);
    cheerLfo.start(startAt);
    cheerLfo.stop(endAt + 0.1);

    [
      [420, 1.0, 0.9],
      [1050, 0.85, 0.6],
      [2400, 1.4, 0.32],
    ].forEach(([fc, q, lvl], i) => {
      const src = ctx.createBufferSource();
      src.buffer = getCelebrationNoiseBuffer(ctx, Math.ceil(endAt - startAt + 0.4), 'crowd');
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = fc;
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = lvl;
      src.connect(bp);
      bp.connect(g);
      g.connect(cheerG);
      if (i === 1) cheerLfoG.connect(g.gain);
      src.start(startAt + i * 0.013);
      src.stop(endAt + 0.1);
    });
  };
  crowdSwell(t0 + 0.05, t0 + 0.6, t0 + 1.3, t0 + 2.6, 0.3);
  crowdSwell(t0 + 13.35, t0 + 13.6, t0 + 13.9, t0 + 14.9, 0.26);

  const clapBuf = getCelebrationClap(ctx);
  const applauseG = ctx.createGain();
  applauseG.gain.value = 0.9;
  applauseG.connect(master);

  const clapBuses: GainNode[] = [];
  for (let i = 0; i < 8; i++) {
    const bus = ctx.createGain();
    bus.gain.value = 0.22 + i * 0.11;
    bus.connect(applauseG);
    clapBuses.push(bus);
  }

  let grain = 0;
  let cursor = t0 + 0.15;
  const applauseEnd = t0 + 14.2;
  while (cursor < applauseEnd) {
    const progress = (cursor - t0) / 14.2;
    const finale = cursor > t0 + 12.6;
    const gap = finale ? 0.022 : 0.012 + progress * 0.075;
    cursor += gap + Math.random() * 0.03;
    const src = ctx.createBufferSource();
    src.buffer = clapBuf;
    src.playbackRate.value = 0.85 + Math.random() * 0.45;
    src.connect(clapBuses[grain % clapBuses.length]);
    src.start(cursor);
    grain++;
  }

  const fanfare: Array<[number, number, number]> = [
    [523.25, 0.2, 0.3], [523.25, 0.5, 0.16], [523.25, 0.66, 0.16],
    [783.99, 0.82, 0.42], [659.25, 1.24, 0.3], [783.99, 1.54, 0.3],
    [1046.5, 1.84, 1.3],
    [880.0, 3.3, 0.34], [783.99, 3.64, 0.3], [659.25, 3.94, 0.3],
    [587.33, 4.24, 0.46], [659.25, 4.7, 0.3], [783.99, 5.0, 0.7],
    [1046.5, 5.85, 0.34], [987.77, 6.19, 0.26], [1046.5, 6.45, 0.34],
    [880.0, 6.79, 0.3], [783.99, 7.09, 0.3], [1046.5, 7.39, 0.9],
    [880.0, 8.6, 0.34], [1046.5, 8.94, 0.3], [1174.66, 9.24, 0.3],
    [1318.51, 9.54, 0.4], [1174.66, 10.14, 0.26], [1318.51, 10.4, 0.26],
    [1396.91, 10.66, 0.34], [1318.51, 11.14, 0.3], [1046.5, 11.44, 0.3],
    [1174.66, 11.74, 0.3], [1318.51, 12.04, 0.66], [1567.98, 12.84, 0.62],
    [1318.51, 13.5, 1.45],
  ];

  const brassG = ctx.createGain();
  brassG.gain.value = 0.34;
  brassG.connect(master);

  const playBrassNote = (freq: number, at: number, dur: number, level: number) => {
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, at);
    lp.frequency.linearRampToValueAtTime(2400, at + 0.09);
    lp.frequency.linearRampToValueAtTime(1500, at + dur);
    lp.Q.value = 1.1;

    const a = ctx.createOscillator();
    const b = ctx.createOscillator();
    a.type = 'sawtooth';
    b.type = 'sawtooth';
    a.frequency.value = freq;
    b.frequency.value = freq * 1.006;

    if (dur >= 0.6) {
      const vib = ctx.createOscillator();
      const vibG = ctx.createGain();
      vib.type = 'sine';
      vib.frequency.value = 5.2;
      vibG.gain.setValueAtTime(0, at);
      vibG.gain.linearRampToValueAtTime(freq * 0.006, at + Math.min(0.35, dur * 0.5));
      vib.connect(vibG);
      vibG.connect(a.frequency);
      vibG.connect(b.frequency);
      vib.start(at);
      vib.stop(at + dur + 0.05);
    }

    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + 0.035);
    g.gain.exponentialRampToValueAtTime(level * 0.72, at + Math.min(0.22, dur * 0.6));
    g.gain.setValueAtTime(level * 0.72, at + dur - 0.09);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    a.connect(lp);
    b.connect(lp);
    lp.connect(g);
    g.connect(brassG);
    a.start(at);
    b.start(at);
    a.stop(at + dur + 0.02);
    b.stop(at + dur + 0.02);
  };

  fanfare.forEach(([f, at, dur]) => playBrassNote(f, t0 + at, dur, 0.5));
  [
    [261.63, 0.26],
    [659.25, 0.3],
    [783.99, 0.28],
    [1046.5, 0.24],
    [1318.51, 0.18],
  ].forEach(([f, lvl]) => playBrassNote(f, t0 + 13.5, 1.45, lvl));

  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 4800;
  tone.Q.value = 0.4;
  const toneG = ctx.createGain();
  toneG.gain.value = 0.62;
  tone.connect(toneG);
  toneG.connect(master);

  const pluck = (freq: number, at: number, level: number, decay: number) => {
    const burst = ctx.createBufferSource();
    burst.buffer = getCelebrationNoiseBuffer(ctx, 0.02, 'pick');
    const delay = ctx.createDelay(0.05);
    delay.delayTime.value = 1 / freq;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.setValueAtTime(Math.min(5200, freq * 11), at);
    damp.frequency.exponentialRampToValueAtTime(Math.max(420, freq * 3), at + decay);
    const fb = ctx.createGain();
    fb.gain.setValueAtTime(0.965, at);
    fb.gain.exponentialRampToValueAtTime(0.001, at + decay);
    const out = ctx.createGain();
    out.gain.value = level;
    burst.connect(delay);
    delay.connect(damp);
    damp.connect(fb);
    fb.connect(delay);
    delay.connect(out);
    out.connect(tone);
    burst.start(at);
    burst.stop(at + 0.02);
  };

  const strum = (freqs: number[], at: number, level: number, decay: number) => {
    freqs.forEach((f, i) => pluck(f, at + i * 0.014, level, decay));
  };

  strum([130.81, 196.0, 261.63], t0, 0.15, 1.6);
  pluck(196.0, t0 + 0.4, 0.12, 1.1);
  pluck(261.63, t0 + 0.8, 0.12, 1.1);
  strum([329.63, 392.0], t0 + 1.2, 0.16, 1.2);
  const arp = [261.63, 329.63, 392.0, 523.25];
  let arpStep = 0;
  for (let s = 1.5; s <= 9; s += 1.5) pluck(arp[arpStep++ % arp.length], t0 + s, 0.09, 1.0);
  const run = [261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88, 523.25];
  run.forEach((f, i) => pluck(f, t0 + 5.85 + i * 0.12, 0.1 + i * 0.02, 0.9));
  run.forEach((f, i) => pluck(f, t0 + 12.84 + i * 0.12, 0.11 + i * 0.022, 0.9));
  strum([130.81, 164.81, 196.0, 261.63, 329.63, 392.0], t0 + 13.5, 0.11, 1.8);

  const cymbal = (startAt: number, peakAt: number, peak: number, decayEnd: number) => {
    const cym = ctx.createBufferSource();
    cym.buffer = getCelebrationNoiseBuffer(ctx, Math.ceil(decayEnd - startAt + 0.2), 'cymbal');
    const cymHp = ctx.createBiquadFilter();
    cymHp.type = 'highpass';
    cymHp.frequency.value = 5200;
    const cymG = ctx.createGain();
    cymG.gain.setValueAtTime(0.0001, startAt);
    cymG.gain.exponentialRampToValueAtTime(peak, peakAt);
    cymG.gain.exponentialRampToValueAtTime(0.001, decayEnd);
    cym.connect(cymHp);
    cymHp.connect(cymG);
    cymG.connect(master);
    cym.start(startAt);
    cym.stop(decayEnd + 0.1);
  };
  cymbal(t0 + 1.2, t0 + 1.3, 0.07, t0 + 3.2);
  cymbal(t0 + 13.35, t0 + 13.5, 0.16, t0 + CELEBRATION_TOTAL_SECONDS);
}

function renderCelebrationBuffer(): Promise<AudioBuffer | null> {
  if (celebrationRenderPromise) return celebrationRenderPromise;
  const OfflineCtor =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!OfflineCtor || !audioContext) {
    celebrationRenderPromise = Promise.resolve(null);
    return celebrationRenderPromise;
  }
  try {
    const sampleRate = audioContext.sampleRate || 44100;
    const length = Math.ceil(sampleRate * (CELEBRATION_TOTAL_SECONDS + 0.1));
    const offline = new OfflineCtor(1, length, sampleRate);
    scheduleFinalCelebrationSting(offline, 0, 1);
    celebrationRenderPromise = offline
      .startRendering()
      .then((buf) => {
        celebrationRenderedBuffer = buf;
        return buf;
      })
      .catch(() => null);
  } catch {
    celebrationRenderPromise = Promise.resolve(null);
  }
  return celebrationRenderPromise;
}

export function prewarmCelebrationAudio(): void {
  if (!soundEnabled || !audioContext) return;
  try {
    void loadCelebrationAudio().then((buf) => {
      if (!buf) {
        getCelebrationClap(audioContext!);
        getCelebrationNoiseBuffer(audioContext!, 0.3, 'crack');
        getCelebrationNoiseBuffer(audioContext!, 0.02, 'pick');
        getCelebrationNoiseBuffer(audioContext!, 3, 'crowd');
        getCelebrationNoiseBuffer(audioContext!, 2, 'crowd');
        getCelebrationNoiseBuffer(audioContext!, 3, 'cymbal');
        getCelebrationNoiseBuffer(audioContext!, 2, 'cymbal');
        void renderCelebrationBuffer();
      }
    });
  } catch {
    // skip
  }
}

export function getAudioContextTime(): number | null {
  return audioContext ? audioContext.currentTime : null;
}

export function isAudioClockRunning(): boolean {
  return Boolean(audioContext && audioContext.state === 'running');
}

export function getCelebrationDuration(): number | null {
  if (celebrationAudioBuffer) return celebrationAudioBuffer.duration;
  if (celebrationRenderedBuffer) return CELEBRATION_TOTAL_SECONDS;
  return null;
}

function playCelebrationBuffer(buf: AudioBuffer, startTime: number, volume: number): void {
  if (!audioContext) return;
  const src = audioContext.createBufferSource();
  src.buffer = buf;
  const g = audioContext.createGain();
  const vol = Math.max(0, Math.min(1, volume));
  g.gain.setValueAtTime(0, startTime);
  g.gain.linearRampToValueAtTime(vol, startTime + CELEBRATION_FADE_IN);
  src.connect(g);
  g.connect(audioContext.destination);
  src.start(startTime);
}

function startCelebrationAudioElement(volume: number): boolean {
  try {
    if (!celebrationAudioEl) {
      celebrationAudioEl = new Audio(CELEBRATION_AUDIO_URL);
      celebrationAudioEl.preload = 'auto';
    }
    const el = celebrationAudioEl;
    el.volume = Math.max(0, Math.min(1, volume));
    try {
      el.currentTime = 0;
    } catch {
      // ignore
    }
    const played = el.play();
    if (played && typeof played.catch === 'function') {
      played.catch(() => {
        if (!audioContext) return;
        try {
          const t = audioContext.currentTime + CELEBRATION_LEAD;
          if (celebrationRenderedBuffer) {
            playCelebrationBuffer(celebrationRenderedBuffer, t, volume);
          } else {
            scheduleFinalCelebrationSting(audioContext, t, volume);
          }
        } catch {
          // ignore
        }
      });
    }
    return true;
  } catch {
    return false;
  }
}

export function playFinalCelebration(volume = 1): number | null {
  if (!soundEnabled || isMutedState || !audioContext) return null;
  try {
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    const startTime = audioContext.currentTime + CELEBRATION_LEAD;

    if (celebrationAudioBuffer) {
      playCelebrationBuffer(celebrationAudioBuffer, startTime, volume);
      return startTime;
    }

    if (!celebrationAudioFailed && startCelebrationAudioElement(volume)) {
      return startTime;
    }

    if (celebrationRenderedBuffer) {
      playCelebrationBuffer(celebrationRenderedBuffer, startTime, volume);
    } else {
      scheduleFinalCelebrationSting(audioContext, startTime, volume);
    }
    return startTime;
  } catch {
    return null;
  }
}

export function playSound(soundName: SoundName, volume = 0.3): void {
  if (!soundEnabled || isMutedState) return;
  if (!audioContext) initAudio();
  if (!audioContext) return;

  const safeSoundName = String(soundName || 'click');

  // Guard against accidental double triggers (e.g., pointerdown + click on the same UI action)
  if (
    safeSoundName === 'click' ||
    safeSoundName === 'ok' ||
    safeSoundName === 'cancel' ||
    safeSoundName === 'toggle' ||
    safeSoundName === 'submit'
  ) {
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (safeSoundName === lastUiSoundKey && nowMs - lastUiSoundTime < 45) {
      return;
    }
    lastUiSoundKey = safeSoundName;
    lastUiSoundTime = nowMs;
  }

  if (safeSoundName.startsWith('http') || safeSoundName.endsWith('.mp3') || safeSoundName.endsWith('.ogg')) {
    try {
      const audio = new Audio(safeSoundName);
      audio.volume = volume;
      audio.play().catch(() => {});
      return;
    } catch {
      return;
    }
  }

  try {
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    const ctx = audioContext;
    const sfxMaster = ctx.createGain();
    const clampedVol = Math.max(0.02, Math.min(1, Number.isFinite(volume) ? volume : 0.3));
    sfxMaster.gain.value = Math.min(2.2, clampedVol / 0.3);
    sfxMaster.connect(ctx.destination);

    const createOsc = (freq: number, type: OscillatorType, startTime: number, duration: number, gain: number) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, startTime);
      g.gain.setValueAtTime(Math.max(0.0001, gain), startTime);
      g.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      osc.connect(g);
      g.connect(sfxMaster);
      osc.start(startTime);
      osc.stop(startTime + duration + 0.01);
    };

    const now = ctx.currentTime;

    switch (safeSoundName) {
      case 'click': {
        // Tactile Pokédex micro-switch tap + crystal blip
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(620, now);
        osc.frequency.exponentialRampToValueAtTime(980, now + 0.032);
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.11, now + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
        osc.connect(g);
        g.connect(sfxMaster);
        osc.start(now);
        osc.stop(now + 0.065);
        createOsc(1320, 'sine', now + 0.008, 0.04, 0.045);
        break;
      }
      case 'ok': {
        // Classic bright two-note Pokédex "OK / Confirm" chime (E5 -> B5)
        createOsc(659.25, 'triangle', now, 0.065, 0.12);
        createOsc(659.25, 'sine', now, 0.065, 0.06);
        createOsc(987.77, 'triangle', now + 0.052, 0.13, 0.14);
        createOsc(1975.53, 'sine', now + 0.052, 0.09, 0.035);
        break;
      }
      case 'cancel': {
        // Gentle downward two-note Pokédex "Back / Cancel" chirp (D5 -> G4)
        createOsc(587.33, 'sine', now, 0.055, 0.09);
        createOsc(392.0, 'triangle', now + 0.045, 0.1, 0.1);
        break;
      }
      case 'toggle': {
        // Crisp switch / dropdown toggle tick
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(540, now);
        osc.frequency.exponentialRampToValueAtTime(860, now + 0.028);
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.09, now + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
        osc.connect(g);
        g.connect(sfxMaster);
        osc.start(now);
        osc.stop(now + 0.055);
        break;
      }
      case 'keystroke': {
        // Whisper-soft terminal key tick with tiny organic pitch shift
        const jitter = 0.96 + Math.random() * 0.08;
        createOsc(1080 * jitter, 'sine', now, 0.024, 0.035);
        createOsc(520 * jitter, 'triangle', now, 0.018, 0.025);
        break;
      }
      case 'scanFound': {
        // Pokédex radar lock-on ping
        createOsc(1046.5, 'sine', now, 0.055, 0.11);
        createOsc(1318.51, 'triangle', now + 0.055, 0.11, 0.13);
        createOsc(1567.98, 'sine', now + 0.11, 0.14, 0.09);
        break;
      }
      case 'materialize': {
        // Energy particles coalescing into glowing silhouette -> reveal shimmer
        const sweep = ctx.createOscillator();
        const sweepG = ctx.createGain();
        sweep.type = 'sine';
        sweep.frequency.setValueAtTime(340, now);
        sweep.frequency.exponentialRampToValueAtTime(1240, now + 0.72);
        sweepG.gain.setValueAtTime(0.0001, now);
        sweepG.gain.exponentialRampToValueAtTime(0.1, now + 0.18);
        sweepG.gain.exponentialRampToValueAtTime(0.0001, now + 0.78);
        sweep.connect(sweepG);
        sweepG.connect(sfxMaster);
        sweep.start(now);
        sweep.stop(now + 0.8);

        [880, 1108.73, 1318.51, 1760].forEach((freq, i) => {
          createOsc(freq, 'sine', now + 0.1 + i * 0.13, 0.34, 0.065);
        });
        break;
      }
      case 'success':
        createOsc(523.25, 'sine', now, 0.4, 0.1);
        createOsc(659.25, 'sine', now + 0.1, 0.4, 0.08);
        createOsc(783.99, 'sine', now + 0.2, 0.4, 0.05);
        createOsc(1046.5, 'sine', now + 0.3, 0.5, 0.1);
        break;
      case 'error': {
        createOsc(110, 'square', now, 0.3, 0.15);
        createOsc(115, 'square', now, 0.3, 0.1);
        const noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
        const noiseData = noiseBuf.getChannelData(0);
        for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;
        const noiseSrc = ctx.createBufferSource();
        noiseSrc.buffer = noiseBuf;
        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.05, now);
        noiseGain.gain.linearRampToValueAtTime(0, now + 0.2);
        noiseSrc.connect(noiseGain);
        noiseGain.connect(sfxMaster);
        noiseSrc.start(now);
        break;
      }
      case 'victory':
        [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) => {
          createOsc(f, 'sine', now + i * 0.1, 0.6, 0.15 - i * 0.02);
        });
        break;
      case 'scanStart':
        for (let i = 0; i < 5; i++) {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.frequency.setValueAtTime(200 + i * 100, now + i * 0.1);
          osc.frequency.exponentialRampToValueAtTime(800 + i * 100, now + i * 0.1 + 0.2);
          g.gain.setValueAtTime(0.05, now + i * 0.1);
          g.gain.linearRampToValueAtTime(0, now + i * 0.1 + 0.2);
          osc.connect(g);
          g.connect(sfxMaster);
          osc.start(now + i * 0.1);
          osc.stop(now + i * 0.1 + 0.2);
        }
        break;
      case 'penaltyReset':
        createOsc(80, 'square', now, 0.4, 0.2);
        createOsc(60, 'square', now + 0.1, 0.5, 0.15);
        break;
      case 'hintStart':
        for (let i = 0; i < 8; i++) {
          createOsc(1000 + Math.random() * 500, 'sine', now + i * 0.05, 0.1, 0.03);
        }
        break;
      case 'hintReveal':
        createOsc(880, 'sine', now, 0.2, 0.1);
        createOsc(1760, 'sine', now + 0.1, 0.3, 0.05);
        break;
      case 'submit':
        // Punchy terminal data transmission chirp
        createOsc(440, 'triangle', now, 0.06, 0.12);
        createOsc(659.25, 'sine', now + 0.04, 0.09, 0.11);
        break;
      case 'powerUp': {
        const oscP = ctx.createOscillator();
        const gP = ctx.createGain();
        oscP.frequency.setValueAtTime(140, now);
        oscP.frequency.exponentialRampToValueAtTime(1180, now + 0.85);
        gP.gain.setValueAtTime(0.0001, now);
        gP.gain.exponentialRampToValueAtTime(0.18, now + 0.18);
        gP.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
        oscP.connect(gP);
        gP.connect(sfxMaster);
        oscP.start(now);
        oscP.stop(now + 0.92);
        break;
      }
      case 'victoryLong':
        [523.25, 523.25, 523.25, 523.25, 415.3, 466.16, 523.25, 466.16, 523.25].forEach((f, i) => {
          createOsc(f, 'square', now + i * 0.15, 0.1, 0.1);
        });
        break;
      case 'hologram': {
        createOsc(880, 'sine', now, 0.05, 0.3);
        createOsc(1760, 'sine', now + 0.05, 0.05, 0.2);
        const oscH = ctx.createOscillator();
        const gH = ctx.createGain();
        oscH.type = 'sawtooth';
        oscH.frequency.setValueAtTime(440, now);
        oscH.frequency.exponentialRampToValueAtTime(880, now + 0.5);
        gH.gain.setValueAtTime(0.1, now);
        gH.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
        oscH.connect(gH);
        gH.connect(sfxMaster);
        oscH.start(now);
        oscH.stop(now + 0.5);
        break;
      }
      case 'pokeballDrop': {
        const tImpact = now;

        // Deep heavy sub-weight impact thud (fast 4ms attack so it feels physical)
        const thud = ctx.createOscillator();
        const thudG = ctx.createGain();
        const thudLp = ctx.createBiquadFilter();
        thud.type = 'sine';
        thud.frequency.setValueAtTime(145, tImpact);
        thud.frequency.exponentialRampToValueAtTime(42, tImpact + 0.22);
        thudLp.type = 'lowpass';
        thudLp.frequency.value = 380;
        thudLp.Q.value = 0.7;
        thudG.gain.setValueAtTime(0.0001, tImpact);
        thudG.gain.exponentialRampToValueAtTime(0.36, tImpact + 0.004);
        thudG.gain.exponentialRampToValueAtTime(0.001, tImpact + 0.25);
        thud.connect(thudLp);
        thudLp.connect(thudG);
        thudG.connect(sfxMaster);
        thud.start(tImpact);
        thud.stop(tImpact + 0.27);

        // Solid metallic-ceramic shell knock against the stage deck
        const shell = ctx.createOscillator();
        const shellG = ctx.createGain();
        const shellLp = ctx.createBiquadFilter();
        shell.type = 'triangle';
        shell.frequency.setValueAtTime(320, tImpact);
        shell.frequency.exponentialRampToValueAtTime(88, tImpact + 0.065);
        shellLp.type = 'lowpass';
        shellLp.frequency.value = 920;
        shellG.gain.setValueAtTime(0.0001, tImpact);
        shellG.gain.exponentialRampToValueAtTime(0.22, tImpact + 0.003);
        shellG.gain.exponentialRampToValueAtTime(0.001, tImpact + 0.085);
        shell.connect(shellLp);
        shellLp.connect(shellG);
        shellG.connect(sfxMaster);
        shell.start(tImpact);
        shell.stop(tImpact + 0.1);

        // Short damped floor-contact burst
        const airLen = 0.1;
        const airBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * airLen), ctx.sampleRate);
        const airData = airBuf.getChannelData(0);
        for (let i = 0; i < airData.length; i++) airData[i] = Math.random() * 2 - 1;
        const air = ctx.createBufferSource();
        air.buffer = airBuf;
        const airBp = ctx.createBiquadFilter();
        airBp.type = 'bandpass';
        airBp.frequency.setValueAtTime(620, tImpact);
        airBp.frequency.exponentialRampToValueAtTime(190, tImpact + 0.09);
        airBp.Q.value = 0.9;
        const airG = ctx.createGain();
        airG.gain.setValueAtTime(0.0001, tImpact);
        airG.gain.exponentialRampToValueAtTime(0.11, tImpact + 0.004);
        airG.gain.exponentialRampToValueAtTime(0.001, tImpact + 0.095);
        air.connect(airBp);
        airBp.connect(airG);
        airG.connect(sfxMaster);
        air.start(tImpact);
        break;
      }
      case 'pokemonHop': {
        // Light upward hop puff as the Pokémon jumps off the pedestal
        const hop = ctx.createOscillator();
        const hopG = ctx.createGain();
        hop.type = 'sine';
        hop.frequency.setValueAtTime(210, now);
        hop.frequency.exponentialRampToValueAtTime(360, now + 0.075);
        hopG.gain.setValueAtTime(0.0001, now);
        hopG.gain.exponentialRampToValueAtTime(0.075, now + 0.012);
        hopG.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);
        hop.connect(hopG);
        hopG.connect(sfxMaster);
        hop.start(now);
        hop.stop(now + 0.095);
        break;
      }
      case 'pokemonBounce': {
        // Cushioned stage pad landing thump + soft springy rebound
        const padThump = ctx.createOscillator();
        const padThumpG = ctx.createGain();
        padThump.type = 'sine';
        padThump.frequency.setValueAtTime(155, now);
        padThump.frequency.exponentialRampToValueAtTime(56, now + 0.13);
        padThumpG.gain.setValueAtTime(0.0001, now);
        padThumpG.gain.exponentialRampToValueAtTime(0.24, now + 0.005);
        padThumpG.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
        padThump.connect(padThumpG);
        padThumpG.connect(sfxMaster);
        padThump.start(now);
        padThump.stop(now + 0.17);

        // Soft elastic stage spring tone
        const spring = ctx.createOscillator();
        const springG = ctx.createGain();
        const springLp = ctx.createBiquadFilter();
        spring.type = 'triangle';
        spring.frequency.setValueAtTime(260, now);
        spring.frequency.exponentialRampToValueAtTime(135, now + 0.045);
        spring.frequency.exponentialRampToValueAtTime(205, now + 0.11);
        springLp.type = 'lowpass';
        springLp.frequency.value = 980;
        springG.gain.setValueAtTime(0.0001, now);
        springG.gain.exponentialRampToValueAtTime(0.11, now + 0.006);
        springG.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
        spring.connect(springLp);
        springLp.connect(springG);
        springG.connect(sfxMaster);
        spring.start(now);
        spring.stop(now + 0.13);
        break;
      }
      case 'pokeballOpen': {
        const click = ctx.createOscillator();
        const clickG = ctx.createGain();
        click.type = 'sine';
        click.frequency.setValueAtTime(760, now);
        click.frequency.exponentialRampToValueAtTime(320, now + 0.09);
        clickG.gain.setValueAtTime(0.0001, now);
        clickG.gain.exponentialRampToValueAtTime(0.12, now + 0.012);
        clickG.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
        click.connect(clickG);
        clickG.connect(sfxMaster);
        click.start(now);
        click.stop(now + 0.1);

        const t2 = now + 0.15;
        const nLen = 0.28;
        const noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * nLen), ctx.sampleRate);
        const nd = noiseBuf.getChannelData(0);
        for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        const noiseSrc = ctx.createBufferSource();
        noiseSrc.buffer = noiseBuf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(2400, t2);
        bp.frequency.exponentialRampToValueAtTime(450, t2 + 0.27);
        bp.Q.value = 1.1;
        const nG = ctx.createGain();
        nG.gain.setValueAtTime(0.0001, t2);
        nG.gain.exponentialRampToValueAtTime(0.16, t2 + 0.03);
        nG.gain.exponentialRampToValueAtTime(0.001, t2 + 0.29);
        noiseSrc.connect(bp);
        bp.connect(nG);
        nG.connect(sfxMaster);
        noiseSrc.start(t2);

        const pop = ctx.createOscillator();
        const popG = ctx.createGain();
        pop.type = 'sine';
        pop.frequency.setValueAtTime(190, t2);
        pop.frequency.exponentialRampToValueAtTime(55, t2 + 0.12);
        popG.gain.setValueAtTime(0.0001, t2);
        popG.gain.exponentialRampToValueAtTime(0.2, t2 + 0.02);
        popG.gain.exponentialRampToValueAtTime(0.001, t2 + 0.2);
        pop.connect(popG);
        popG.connect(sfxMaster);
        pop.start(t2);
        pop.stop(t2 + 0.22);

        const t3 = now + 0.35;
        const hum = ctx.createOscillator();
        const humG = ctx.createGain();
        hum.type = 'sine';
        hum.frequency.setValueAtTime(240, t3);
        hum.frequency.exponentialRampToValueAtTime(1150, t3 + 0.65);
        const lfo = ctx.createOscillator();
        const lfoG = ctx.createGain();
        lfo.frequency.setValueAtTime(19, t3);
        lfoG.gain.setValueAtTime(5, t3);
        lfoG.gain.exponentialRampToValueAtTime(95, t3 + 0.55);
        lfo.connect(lfoG);
        lfoG.connect(hum.frequency);
        lfo.start(t3);
        lfo.stop(t3 + 0.68);
        humG.gain.setValueAtTime(0.0001, t3);
        humG.gain.exponentialRampToValueAtTime(0.14, t3 + 0.14);
        humG.gain.exponentialRampToValueAtTime(0.001, t3 + 0.68);
        hum.connect(humG);
        humG.connect(sfxMaster);
        hum.start(t3);
        hum.stop(t3 + 0.72);

        const snLen = 0.5;
        const sBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * snLen), ctx.sampleRate);
        const sd = sBuf.getChannelData(0);
        for (let i = 0; i < sd.length; i++) sd[i] = Math.random() * 2 - 1;
        const sSrc = ctx.createBufferSource();
        sSrc.buffer = sBuf;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.setValueAtTime(7000, t3);
        const sG = ctx.createGain();
        sG.gain.setValueAtTime(0.0001, t3);
        sG.gain.exponentialRampToValueAtTime(0.028, t3 + 0.05);
        sG.gain.exponentialRampToValueAtTime(0.001, t3 + 0.45);
        sSrc.connect(hp);
        hp.connect(sG);
        sG.connect(sfxMaster);
        sSrc.start(t3);

        [1320, 1760, 2200].forEach((f, k) => {
          const ch = ctx.createOscillator();
          const chG = ctx.createGain();
          const t = t3 + 0.02 + k * 0.13;
          ch.type = 'sine';
          ch.frequency.setValueAtTime(f, t);
          chG.gain.setValueAtTime(0.0001, t);
          chG.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
          chG.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
          ch.connect(chG);
          chG.connect(sfxMaster);
          ch.start(t);
          ch.stop(t + 0.26);
        });

        const t4 = now + 0.65;
        const thud = ctx.createOscillator();
        const thudG = ctx.createGain();
        thud.type = 'sine';
        thud.frequency.setValueAtTime(120, t4);
        thud.frequency.exponentialRampToValueAtTime(38, t4 + 0.42);
        thudG.gain.setValueAtTime(0.0001, t4);
        thudG.gain.exponentialRampToValueAtTime(0.26, t4 + 0.05);
        thudG.gain.exponentialRampToValueAtTime(0.001, t4 + 0.5);
        thud.connect(thudG);
        thudG.connect(sfxMaster);
        thud.start(t4);
        thud.stop(t4 + 0.55);

        const cry = ctx.createOscillator();
        const crySub = ctx.createOscillator();
        const cryG = ctx.createGain();
        cry.type = 'sawtooth';
        cry.frequency.setValueAtTime(180, t4);
        cry.frequency.exponentialRampToValueAtTime(520, t4 + 0.55);
        crySub.type = 'square';
        crySub.frequency.setValueAtTime(90, t4);
        crySub.frequency.exponentialRampToValueAtTime(260, t4 + 0.55);
        cryG.gain.setValueAtTime(0.0001, t4);
        cryG.gain.exponentialRampToValueAtTime(0.16, t4 + 0.06);
        cryG.gain.setValueAtTime(0.12, t4 + 0.3);
        cryG.gain.exponentialRampToValueAtTime(0.001, t4 + 0.8);
        const cryLFO = ctx.createOscillator();
        const cryLfoG = ctx.createGain();
        cryLFO.frequency.setValueAtTime(28, t4);
        cryLfoG.gain.setValueAtTime(14, t4);
        cryLFO.connect(cryLfoG);
        cryLfoG.connect(cry.frequency);
        cryLFO.start(t4);
        cryLFO.stop(t4 + 0.85);
        cry.connect(cryG);
        crySub.connect(cryG);
        cryG.connect(sfxMaster);
        cry.start(t4);
        crySub.start(t4);
        cry.stop(t4 + 0.85);
        crySub.stop(t4 + 0.85);

        const an = ctx.createOscillator();
        const anG = ctx.createGain();
        an.type = 'triangle';
        an.frequency.setValueAtTime(880, t4);
        an.frequency.exponentialRampToValueAtTime(1320, t4 + 0.25);
        anG.gain.setValueAtTime(0.0001, t4);
        anG.gain.exponentialRampToValueAtTime(0.05, t4 + 0.02);
        anG.gain.exponentialRampToValueAtTime(0.001, t4 + 0.3);
        an.connect(anG);
        anG.connect(sfxMaster);
        an.start(t4);
        an.stop(t4 + 0.32);
        break;
      }
      case 'penalty':
        createOsc(880, 'square', now, 0.14, 0.14);
        createOsc(620, 'square', now + 0.15, 0.16, 0.14);
        createOsc(880, 'square', now + 0.32, 0.14, 0.12);
        break;
      case 'penaltyComplete':
        createOsc(523.25, 'triangle', now, 0.15, 0.12);
        createOsc(659.25, 'triangle', now + 0.1, 0.15, 0.12);
        createOsc(783.99, 'triangle', now + 0.2, 0.25, 0.14);
        break;
      case 'finalCelebration':
        playFinalCelebration(volume);
        break;
    }

    if ('vibrate' in navigator) {
      if (['ok', 'success', 'victory', 'powerUp', 'penaltyComplete', 'scanFound'].includes(safeSoundName)) {
        navigator.vibrate(35);
      } else if (['click', 'toggle'].includes(safeSoundName)) {
        navigator.vibrate(10);
      } else if (['error', 'penalty'].includes(safeSoundName)) {
        navigator.vibrate([50, 50, 50]);
      }
    }
  } catch {
    // ignore audio errors
  }
}

// Chiptune 8-bit battle loop used automatically when offline or remote BGM is unreachable
const SYNTH_BGM_LEAD = [
  329.63, 392.0, 440.0, 493.88, 523.25, 493.88, 440.0, 392.0,
  349.23, 440.0, 493.88, 587.33, 523.25, 493.88, 440.0, 392.0,
];
const SYNTH_BGM_BASS = [
  164.81, 164.81, 196.0, 196.0, 220.0, 220.0, 196.0, 196.0,
  174.61, 174.61, 196.0, 196.0, 164.81, 164.81, 146.83, 196.0,
];

function stopSynthBgm(): void {
  if (synthBgmTimer !== null) {
    clearInterval(synthBgmTimer);
    synthBgmTimer = null;
  }
}

function startSynthBgm(): void {
  if (synthBgmTimer !== null || !audioContext || !soundEnabled || isMutedState) return;
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
  const playBeat = () => {
    if (!audioContext || !soundEnabled || isMutedState || !bgMusicDesiredActive || bgMusicPausedByLockdown) {
      stopSynthBgm();
      return;
    }
    try {
      const ctx = audioContext;
      const idx = synthBgmStep % SYNTH_BGM_LEAD.length;
      synthBgmStep += 1;
      const now = ctx.currentTime;

      const lead = ctx.createOscillator();
      const leadGain = ctx.createGain();
      lead.type = 'square';
      lead.frequency.setValueAtTime(SYNTH_BGM_LEAD[idx], now);
      leadGain.gain.setValueAtTime(0.0001, now);
      leadGain.gain.exponentialRampToValueAtTime(0.025, now + 0.015);
      leadGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);
      lead.connect(leadGain);
      leadGain.connect(ctx.destination);
      lead.start(now);
      lead.stop(now + 0.18);

      const bass = ctx.createOscillator();
      const bassGain = ctx.createGain();
      bass.type = 'triangle';
      bass.frequency.setValueAtTime(SYNTH_BGM_BASS[idx], now);
      bassGain.gain.setValueAtTime(0.0001, now);
      bassGain.gain.exponentialRampToValueAtTime(0.032, now + 0.015);
      bassGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      bass.connect(bassGain);
      bassGain.connect(ctx.destination);
      bass.start(now);
      bass.stop(now + 0.19);
    } catch {
      // ignore scheduler glitch
    }
  };
  playBeat();
  synthBgmTimer = setInterval(playBeat, 200);
}

function startActiveBgm(): void {
  if (isMutedState || !bgMusicDesiredActive || bgMusicPausedByLockdown) return;
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (isOffline) {
    if (typeof caches !== 'undefined') {
      void caches
        .match(BGM_URL)
        .then((hit) => {
          if (!bgMusicDesiredActive || isMutedState || bgMusicPausedByLockdown) return;
          if (!hit) {
            startSynthBgm();
            return;
          }
          if (!bgMusicEl) {
            bgMusicEl = new Audio(BGM_URL);
            bgMusicEl.loop = true;
            bgMusicEl.volume = 0.15;
            bgMusicEl.addEventListener('error', () => {
              if (bgMusicDesiredActive && !isMutedState && !bgMusicPausedByLockdown) {
                startSynthBgm();
              }
            });
          }
          bgMusicEl
            .play()
            .then(() => stopSynthBgm())
            .catch(() => {
              if (bgMusicDesiredActive && !isMutedState && !bgMusicPausedByLockdown) {
                startSynthBgm();
              }
            });
        })
        .catch(() => startSynthBgm());
    } else {
      startSynthBgm();
    }
    return;
  }
  if (!bgMusicEl) {
    bgMusicEl = new Audio(BGM_URL);
    bgMusicEl.loop = true;
    bgMusicEl.volume = 0.15;
    bgMusicEl.addEventListener('error', () => {
      if (bgMusicDesiredActive && !isMutedState && !bgMusicPausedByLockdown) {
        startSynthBgm();
      }
    });
  }
  bgMusicEl
    .play()
    .then(() => {
      stopSynthBgm();
    })
    .catch(() => {
      if (bgMusicDesiredActive && !isMutedState && !bgMusicPausedByLockdown) {
        startSynthBgm();
      }
    });
}

function stopActiveBgm(): void {
  if (bgMusicEl && !bgMusicEl.paused) {
    bgMusicEl.pause();
  }
  stopSynthBgm();
}

export function getMuted(): boolean {
  return isMutedState;
}

export function toggleMute(): boolean {
  isMutedState = !isMutedState;
  if (isMutedState) {
    stopActiveBgm();
  } else if (bgMusicDesiredActive && !bgMusicPausedByLockdown) {
    startActiveBgm();
  }
  return isMutedState;
}

export function toggleBgm(): boolean {
  if (!bgMusicDesiredActive) {
    bgMusicDesiredActive = true;
    bgMusicPausedByLockdown = false;
    startActiveBgm();
    return true;
  } else {
    bgMusicDesiredActive = false;
    bgMusicPausedByLockdown = false;
    stopActiveBgm();
    return false;
  }
}

export function pauseBgmForLockdown(): void {
  if (bgMusicDesiredActive) {
    bgMusicPausedByLockdown = true;
    stopActiveBgm();
  }
}

export function resumeBgmAfterLockdown(): void {
  if (bgMusicPausedByLockdown) {
    bgMusicPausedByLockdown = false;
    if (bgMusicDesiredActive && !isMutedState) {
      startActiveBgm();
    }
  }
}
