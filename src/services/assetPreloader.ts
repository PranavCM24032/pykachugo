import { getBadgeUrl, getPokemonArtworkUrl } from './gameBackend';
import type { GameConfig, PuzzleSummary } from '../types/game';

const IMMEDIATE_BOOT_IMAGES = [
  '/assets/img/csi.jpg',
  '/assets/img/auron.png',
  '/assets/img/logo1.png',
  '/assets/img/pykachu.png',
  '/assets/img/go.png',
  '/assets/img/oak.png',
  '/assets/img/pikachu.png',
];

const CORE_LOCAL_IMAGES = [
  '/assets/img/ash-3.png',
  '/assets/img/brock.png',
  '/assets/img/jenny.png',
  '/assets/img/pokeball.svg',
  '/assets/img/poketropy.png',
  '/assets/img/python.png',
  '/assets/img/cpp.svg',
  '/assets/img/grass.png',
  '/assets/img/fire.png',
  '/assets/img/water.png',
  '/assets/img/ground.png',
  '/assets/img/ghost.png',
  '/assets/img/fairy.png',
];

const preloadedImageUrls = new Set<string>();
const preloadedReadyUrls = new Set<string>();
let audioWarmed = false;

function normalizeAssetUrl(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^(https?:\/\/|data:|\/)/i.test(s)) return s;
  return `/${s}`;
}

function isRemoteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function shouldRespectSaveData(): boolean {
  try {
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    return Boolean(nav.connection?.saveData);
  } catch {
    return false;
  }
}

export function isPreloadedImageReady(rawUrl: string): boolean {
  const url = normalizeAssetUrl(rawUrl);
  if (!url) return false;
  if (!isRemoteUrl(url)) return true;
  return preloadedReadyUrls.has(url);
}

function startImageWarm(url: string): void {
  let img: HTMLImageElement | null = new Image();
  img.decoding = 'async';
  if (isRemoteUrl(url)) {
    img.crossOrigin = 'anonymous';
  }
  img.onload = () => {
    preloadedReadyUrls.add(url);
    if (img) {
      img.onload = null;
      img.onerror = null;
      img = null;
    }
  };
  img.onerror = () => {
    preloadedImageUrls.delete(url);
    preloadedReadyUrls.delete(url);
    if (img) {
      img.onload = null;
      img.onerror = null;
      img = null;
    }
  };
  img.src = url;
}

export function preloadSingleImage(rawUrl: string): void {
  const url = normalizeAssetUrl(rawUrl);
  if (!url || preloadedImageUrls.has(url)) return;
  preloadedImageUrls.add(url);

  if (isRemoteUrl(url) && typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (typeof caches !== 'undefined') {
      void caches
        .match(url)
        .then((hit) => {
          if (hit) {
            startImageWarm(url);
          } else {
            preloadedImageUrls.delete(url);
          }
        })
        .catch(() => {
          preloadedImageUrls.delete(url);
        });
    } else {
      preloadedImageUrls.delete(url);
    }
    return;
  }

  startImageWarm(url);
}

function warmCelebrationAudioAsset(): void {
  if (audioWarmed || typeof window === 'undefined' || typeof fetch !== 'function') return;
  audioWarmed = true;
  void fetch('/assets/sound.mp3', { cache: 'force-cache' }).catch(() => {
    audioWarmed = false;
  });
}

/**
 * Warms immediate boot art, local UI assets, and puzzle artwork/badges during idle time
 * so the Pokédex reveal & animations remain instant and intact offline.
 */
export function preloadGameAssets(puzzles: PuzzleSummary[], config: GameConfig | null): void {
  if (typeof window === 'undefined') return;

  IMMEDIATE_BOOT_IMAGES.forEach(preloadSingleImage);

  const localDeferred = new Set<string>(CORE_LOCAL_IMAGES);
  const remoteDeferred = new Set<string>();

  const pushAsset = (raw?: string) => {
    const normalized = normalizeAssetUrl(raw || '');
    if (!normalized) return;
    if (isRemoteUrl(normalized)) remoteDeferred.add(normalized);
    else localDeferred.add(normalized);
  };

  if (config) {
    config.languages?.forEach((lang) => pushAsset(lang.icon));
    config.missionTypes?.forEach((m) => pushAsset(m.icon));
    config.missionGroups?.forEach((g) => {
      g.missions?.forEach((m) => pushAsset(m.icon));
    });
  }

  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  if (online && !shouldRespectSaveData() && Array.isArray(puzzles)) {
    puzzles.forEach((p) => {
      if (p.pokemonId) pushAsset(getPokemonArtworkUrl(p.pokemonId));
      if (p.badgeId) pushAsset(getBadgeUrl(p.badgeId));
    });
  }

  const localQueue = Array.from(localDeferred);
  const remoteQueue = Array.from(remoteDeferred);
  if (localQueue.length === 0 && remoteQueue.length === 0) {
    warmCelebrationAudioAsset();
    return;
  }

  const schedule =
    typeof window.requestIdleCallback === 'function'
      ? (cb: () => void) => window.requestIdleCallback(cb, { timeout: 1500 })
      : (cb: () => void) => window.setTimeout(cb, 300);

  const runQueue = (items: string[], batchSize: number, onDone?: () => void) => {
    if (items.length === 0) {
      onDone?.();
      return;
    }
    let index = 0;
    const loadNextBatch = () => {
      const slice = items.slice(index, index + batchSize);
      slice.forEach(preloadSingleImage);
      index += batchSize;
      if (index < items.length) {
        schedule(loadNextBatch);
      } else {
        onDone?.();
      }
    };
    schedule(loadNextBatch);
  };

  // Load local bundled UI icons first, then delay remote 40-puzzle sprites slightly
  // with smaller batches so 300 concurrent logins prioritize auth & game RPCs first.
  runQueue(localQueue, 6, () => {
    warmCelebrationAudioAsset();
    if (remoteQueue.length > 0) {
      window.setTimeout(() => {
        runQueue(remoteQueue, 3);
      }, 2500);
    }
  });
}

/**
 * On-demand artwork warm-up for ONLY the active puzzle + immediate next 1-3 puzzles.
 */
export function preloadPuzzleFocusAssets(
  current: Pick<PuzzleSummary, 'pokemonId' | 'badgeId'> | null,
  nextTargets: Array<Pick<PuzzleSummary, 'pokemonId' | 'badgeId'>>
): void {
  if (typeof window === 'undefined') return;
  if (current?.pokemonId) preloadSingleImage(getPokemonArtworkUrl(current.pokemonId));
  if (current?.badgeId) preloadSingleImage(getBadgeUrl(current.badgeId));
  nextTargets.slice(0, 3).forEach((n) => {
    if (n.pokemonId) preloadSingleImage(getPokemonArtworkUrl(n.pokemonId));
    if (n.badgeId) preloadSingleImage(getBadgeUrl(n.badgeId));
  });
}
