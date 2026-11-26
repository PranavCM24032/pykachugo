import { getCacheConfig, getSyncConfig } from './configService';
import type {
  CachedRegistrationRecord,
  CachedSubmissionRecord,
  CatalogCacheMeta,
  MemeEntry,
  Puzzle,
  PuzzleSummary,
  RegistrationSyncStatus,
  SubmissionSyncStatus,
} from '../types/game';

const STORE_REGISTRATIONS = 'registrations';
const STORE_PUZZLES = 'puzzles';
const STORE_MEMES = 'memes';
const STORE_CATALOG_META = 'catalog_meta';
const STORE_SUBMISSIONS = 'submissions';
const STORE_SESSION_STATE = 'session_state';

interface StoredPuzzleRow extends Puzzle {
  cacheKey: string;
  epoch: number;
  linkidUpper: string;
}

interface StoredMemeRow extends MemeEntry {
  cacheKey: string;
  epoch: number;
  memeidUpper: string;
}

interface StoredSessionStateRow {
  stateKey: string;
  value: unknown;
  updatedAt: number;
}

export interface CacheDiagnostics {
  storageBackend: 'indexeddb' | 'memory-fallback';
  registrationsCount: number;
  puzzlesCount: number;
  memesCount: number;
  pendingSubmissions: number;
  syncingSubmissions: number;
  failedSubmissions: number;
  syncedSubmissions: number;
  estimatedUsageBytes: number | null;
  estimatedQuotaBytes: number | null;
}

// ==========================================
// PURE TYPESCRIPT SHA-256 (OFFLINE VERIFIER)
// Matches PostgreSQL encode(digest(UPPER(TRIM(val)), 'sha256'), 'hex')
// ==========================================
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256NormalizedHex(input: unknown): string {
  const normalized = String(input ?? '').trim().toUpperCase();
  const encoder = new TextEncoder();
  const bytes = encoder.encode(normalized);
  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 =
        ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^
        ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^
        (w[i - 15] >>> 3);
      const s1 =
        ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^
        ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^
        (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((n) => n.toString(16).padStart(8, '0'))
    .join('');
}

// ==========================================
// INDEXEDDB CONNECTION & SAFE FALLBACK
// ==========================================
let dbPromise: Promise<IDBDatabase | null> | null = null;
const memoryFallbackStores = {
  registrations: new Map<string, CachedRegistrationRecord>(),
  puzzles: new Map<string, StoredPuzzleRow>(),
  memes: new Map<string, StoredMemeRow>(),
  catalogMeta: new Map<string, CatalogCacheMeta>(),
  submissions: new Map<string, CachedSubmissionRecord>(),
  sessionState: new Map<string, StoredSessionStateRow>(),
};

function hasIndexedDbSupport(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

export async function openCacheDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDbSupport()) return null;
  if (dbPromise) return dbPromise;

  const { dbName, dbVersion } = getCacheConfig();

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = indexedDB.open(dbName, dbVersion);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(STORE_REGISTRATIONS)) {
          const regStore = db.createObjectStore(STORE_REGISTRATIONS, {
            keyPath: 'registrationId',
          });
          regStore.createIndex('by_tid_epoch', ['tid', 'epoch'], { unique: false });
          regStore.createIndex('by_status', 'status', { unique: false });
          regStore.createIndex('by_updated_at', 'updatedAt', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_PUZZLES)) {
          const puzzleStore = db.createObjectStore(STORE_PUZZLES, { keyPath: 'cacheKey' });
          puzzleStore.createIndex('by_epoch', 'epoch', { unique: false });
          puzzleStore.createIndex('by_epoch_linkid', ['epoch', 'linkidUpper'], { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_MEMES)) {
          const memeStore = db.createObjectStore(STORE_MEMES, { keyPath: 'cacheKey' });
          memeStore.createIndex('by_epoch', 'epoch', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_CATALOG_META)) {
          db.createObjectStore(STORE_CATALOG_META, { keyPath: 'metaKey' });
        }

        if (!db.objectStoreNames.contains(STORE_SUBMISSIONS)) {
          const subStore = db.createObjectStore(STORE_SUBMISSIONS, { keyPath: 'submissionId' });
          subStore.createIndex('by_status', 'status', { unique: false });
          subStore.createIndex('by_dedupe_key', 'dedupeKey', { unique: false });
          subStore.createIndex('by_tid_epoch', ['tid', 'epoch'], { unique: false });
          subStore.createIndex('by_next_retry', 'nextRetryAt', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_SESSION_STATE)) {
          db.createObjectStore(STORE_SESSION_STATE, { keyPath: 'stateKey' });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };

      request.onerror = () => {
        dbPromise = null;
        resolve(null);
      };

      request.onblocked = () => {
        dbPromise = null;
        resolve(null);
      };
    } catch {
      dbPromise = null;
      resolve(null);
    }
  });

  return dbPromise;
}

function idbReq<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function idbTxDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

function toPuzzleSummary(p: Puzzle): PuzzleSummary {
  return {
    id: p.id,
    linkid: p.linkid,
    badgeId: p.badgeId,
    nextPuzzleId: Array.isArray(p.nextPuzzleId) ? p.nextPuzzleId : [],
    requiresStartCode: Boolean(p.requiresStartCode || p.startCodeDigest || p.startCode),
    locationClue: p.locationClue || '',
    level: p.level,
    points: p.points,
    hasHint: p.hasHint,
    hintPenalty: p.hintPenalty,
    tabSwitchPenaltySeconds: p.tabSwitchPenaltySeconds,
    pokemonId: p.pokemonId,
    pokemonName: p.pokemonName,
  };
}

function stripStorageKeysFromPuzzle(row: StoredPuzzleRow): Puzzle {
  const { cacheKey: _ck, epoch: _ep, linkidUpper: _lu, ...rest } = row;
  return rest;
}

function stripStorageKeysFromMeme(row: StoredMemeRow): MemeEntry {
  const { cacheKey: _ck, epoch: _ep, memeidUpper: _mu, ...rest } = row;
  return rest;
}

// ==========================================
// 1. REGISTRATION CACHE (IndexedDB)
// ==========================================
export async function saveRegistrationRecordIdb(
  record: CachedRegistrationRecord
): Promise<CachedRegistrationRecord> {
  const db = await openCacheDb();
  if (!db) {
    memoryFallbackStores.registrations.set(record.registrationId, record);
    return record;
  }

  const tx = db.transaction(STORE_REGISTRATIONS, 'readwrite');
  const store = tx.objectStore(STORE_REGISTRATIONS);
  store.put(record);
  await idbTxDone(tx);
  return record;
}

export async function getRegistrationByIdIdb(
  registrationId: string
): Promise<CachedRegistrationRecord | null> {
  if (!registrationId) return null;
  const db = await openCacheDb();
  if (!db) {
    return memoryFallbackStores.registrations.get(registrationId) || null;
  }
  const tx = db.transaction(STORE_REGISTRATIONS, 'readonly');
  const res = await idbReq<CachedRegistrationRecord | undefined>(
    tx.objectStore(STORE_REGISTRATIONS).get(registrationId)
  );
  return res || null;
}

export async function getLatestRegistrationRecordIdb(
  epoch?: number
): Promise<CachedRegistrationRecord | null> {
  const db = await openCacheDb();
  let all: CachedRegistrationRecord[] = [];
  if (!db) {
    all = Array.from(memoryFallbackStores.registrations.values());
  } else {
    const tx = db.transaction(STORE_REGISTRATIONS, 'readonly');
    all = await idbReq<CachedRegistrationRecord[]>(
      tx.objectStore(STORE_REGISTRATIONS).getAll()
    );
  }

  const filtered =
    typeof epoch === 'number' && epoch > 0 ? all.filter((r) => r.epoch === epoch) : all;
  if (filtered.length === 0) return null;
  filtered.sort((a, b) => b.updatedAt - a.updatedAt);
  return filtered[0];
}

export async function getPendingOrFailedRegistrationsIdb(): Promise<CachedRegistrationRecord[]> {
  const db = await openCacheDb();
  let all: CachedRegistrationRecord[] = [];
  if (!db) {
    all = Array.from(memoryFallbackStores.registrations.values());
  } else {
    const tx = db.transaction(STORE_REGISTRATIONS, 'readonly');
    all = await idbReq<CachedRegistrationRecord[]>(
      tx.objectStore(STORE_REGISTRATIONS).getAll()
    );
  }
  const staleCutoff = Date.now() - 15000;
  return all
    .filter(
      (r) =>
        r.status === 'pending' ||
        r.status === 'failed' ||
        (r.status === 'syncing' && r.updatedAt < staleCutoff)
    )
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function updateRegistrationStatusIdb(
  registrationId: string,
  status: RegistrationSyncStatus,
  patch?: Partial<CachedRegistrationRecord>
): Promise<CachedRegistrationRecord | null> {
  const existing = await getRegistrationByIdIdb(registrationId);
  if (!existing) return null;
  const next: CachedRegistrationRecord = {
    ...existing,
    ...patch,
    status,
    updatedAt: Date.now(),
  };
  return saveRegistrationRecordIdb(next);
}

export async function deleteRegistrationRecordIdb(registrationId: string): Promise<void> {
  if (!registrationId) return;
  const db = await openCacheDb();
  if (!db) {
    memoryFallbackStores.registrations.delete(registrationId);
    return;
  }
  const tx = db.transaction(STORE_REGISTRATIONS, 'readwrite');
  tx.objectStore(STORE_REGISTRATIONS).delete(registrationId);
  await idbTxDone(tx);
}

// ==========================================
// 2. BULK PUZZLE & MEME CATALOG CACHE (IndexedDB)
// ==========================================
export function getCatalogMetaKey(epoch: number): string {
  return `catalog_ep_${Math.max(1, Math.floor(epoch))}`;
}

export async function getCatalogMetaIdb(epoch: number): Promise<CatalogCacheMeta | null> {
  const metaKey = getCatalogMetaKey(epoch);
  const db = await openCacheDb();
  if (!db) {
    return memoryFallbackStores.catalogMeta.get(metaKey) || null;
  }
  const tx = db.transaction(STORE_CATALOG_META, 'readonly');
  const meta = await idbReq<CatalogCacheMeta | undefined>(
    tx.objectStore(STORE_CATALOG_META).get(metaKey)
  );
  return meta || null;
}

export async function hasValidCatalogInIdb(
  epoch: number,
  expectedCatalogVersion?: number
): Promise<boolean> {
  const meta = await getCatalogMetaIdb(epoch);
  if (!meta || !meta.verifiedStorage || meta.puzzleCount <= 0) return false;
  if (Date.now() > meta.expiresAt) return false;
  if (
    typeof expectedCatalogVersion === 'number' &&
    expectedCatalogVersion > 0 &&
    meta.catalogVersion !== expectedCatalogVersion
  ) {
    return false;
  }
  return true;
}

export async function storeBulkCatalogIdb(params: {
  epoch: number;
  catalogVersion: number;
  puzzles: Puzzle[];
  memes: MemeEntry[];
  teamTid: string;
  ttlMs?: number;
}): Promise<{ verified: boolean; puzzleCount: number; meta: CatalogCacheMeta }> {
  const cleanEpoch = Math.max(1, Math.floor(params.epoch));
  const ttlMs = Math.max(30_000, params.ttlMs ?? getCacheConfig().catalogTtlMs);
  const now = Date.now();
  const metaKey = getCatalogMetaKey(cleanEpoch);

  const normalizedPuzzles: StoredPuzzleRow[] = params.puzzles.map((p) => ({
    ...p,
    answerDigest: p.answerDigest || (p.answer ? sha256NormalizedHex(p.answer) : undefined),
    startCodeDigest:
      p.startCodeDigest || (p.startCode ? sha256NormalizedHex(p.startCode) : undefined),
    requiresStartCode: Boolean(
      p.requiresStartCode || p.startCodeDigest || (p.startCode && p.startCode.trim() !== '')
    ),
    cacheKey: `${cleanEpoch}::${p.id}`,
    epoch: cleanEpoch,
    linkidUpper: String(p.linkid || '').trim().toUpperCase(),
  }));

  const normalizedMemes: StoredMemeRow[] = params.memes.map((m) => ({
    ...m,
    memeid: String(m.memeid || '').trim().toUpperCase(),
    cacheKey: `${cleanEpoch}::${String(m.memeid || '').trim().toUpperCase()}`,
    epoch: cleanEpoch,
    memeidUpper: String(m.memeid || '').trim().toUpperCase(),
  }));

  const db = await openCacheDb();
  if (!db) {
    Array.from(memoryFallbackStores.puzzles.keys()).forEach((k) => {
      if (k.startsWith(`${cleanEpoch}::`)) memoryFallbackStores.puzzles.delete(k);
    });
    normalizedPuzzles.forEach((p) => memoryFallbackStores.puzzles.set(p.cacheKey, p));
    Array.from(memoryFallbackStores.memes.keys()).forEach((k) => {
      if (k.startsWith(`${cleanEpoch}::`)) memoryFallbackStores.memes.delete(k);
    });
    normalizedMemes.forEach((m) => memoryFallbackStores.memes.set(m.cacheKey, m));

    const meta: CatalogCacheMeta = {
      metaKey,
      epoch: cleanEpoch,
      catalogVersion: params.catalogVersion,
      puzzleCount: normalizedPuzzles.length,
      memeCount: normalizedMemes.length,
      teamTid: params.teamTid,
      fetchedAt: now,
      expiresAt: now + ttlMs,
      verifiedStorage: true,
    };
    memoryFallbackStores.catalogMeta.set(metaKey, meta);
    return { verified: true, puzzleCount: normalizedPuzzles.length, meta };
  }

  // Single atomic readwrite transaction across puzzles, memes, and catalog_meta
  const tx = db.transaction([STORE_PUZZLES, STORE_MEMES, STORE_CATALOG_META], 'readwrite');
  const pStore = tx.objectStore(STORE_PUZZLES);
  const mStore = tx.objectStore(STORE_MEMES);
  const metaStore = tx.objectStore(STORE_CATALOG_META);

  // Clear stale rows for this epoch via index cursor
  await new Promise<void>((resolve, reject) => {
    const range = IDBKeyRange.only(cleanEpoch);
    const req = pStore.index('by_epoch').openKeyCursor(range);
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        pStore.delete(cursor.primaryKey);
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => reject(req.error);
  });

  await new Promise<void>((resolve, reject) => {
    const range = IDBKeyRange.only(cleanEpoch);
    const req = mStore.index('by_epoch').openKeyCursor(range);
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        mStore.delete(cursor.primaryKey);
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => reject(req.error);
  });

  normalizedPuzzles.forEach((row) => pStore.put(row));
  normalizedMemes.forEach((row) => mStore.put(row));

  const storedCount = await idbReq<number>(
    pStore.index('by_epoch').count(IDBKeyRange.only(cleanEpoch))
  );
  const verified = storedCount === normalizedPuzzles.length;
  const finalMeta: CatalogCacheMeta = {
    metaKey,
    epoch: cleanEpoch,
    catalogVersion: params.catalogVersion,
    puzzleCount: normalizedPuzzles.length,
    memeCount: normalizedMemes.length,
    teamTid: params.teamTid,
    fetchedAt: now,
    expiresAt: now + ttlMs,
    verifiedStorage: verified,
  };
  metaStore.put(finalMeta);
  await idbTxDone(tx);

  return { verified, puzzleCount: storedCount, meta: finalMeta };
}

export async function getPuzzleSummariesIdb(epoch: number): Promise<PuzzleSummary[]> {
  const cleanEpoch = Math.max(1, Math.floor(epoch));
  const db = await openCacheDb();
  let rows: StoredPuzzleRow[] = [];
  if (!db) {
    rows = Array.from(memoryFallbackStores.puzzles.values()).filter((p) => p.epoch === cleanEpoch);
  } else {
    const tx = db.transaction(STORE_PUZZLES, 'readonly');
    rows = await idbReq<StoredPuzzleRow[]>(
      tx.objectStore(STORE_PUZZLES).index('by_epoch').getAll(IDBKeyRange.only(cleanEpoch))
    );
  }
  return rows.map(toPuzzleSummary).sort((a, b) => a.id - b.id);
}

export async function getPuzzleByIdIdb(epoch: number, id: number): Promise<Puzzle | null> {
  const cleanEpoch = Math.max(1, Math.floor(epoch));
  const key = `${cleanEpoch}::${Math.floor(id)}`;
  const db = await openCacheDb();
  if (!db) {
    const hit = memoryFallbackStores.puzzles.get(key);
    return hit ? stripStorageKeysFromPuzzle(hit) : null;
  }
  const tx = db.transaction(STORE_PUZZLES, 'readonly');
  const hit = await idbReq<StoredPuzzleRow | undefined>(tx.objectStore(STORE_PUZZLES).get(key));
  return hit ? stripStorageKeysFromPuzzle(hit) : null;
}

export async function getPuzzleByLinkIdIdb(
  epoch: number,
  linkid: string
): Promise<Puzzle | null> {
  const cleanEpoch = Math.max(1, Math.floor(epoch));
  const upperLink = String(linkid || '').trim().toUpperCase();
  if (!upperLink) return null;

  const db = await openCacheDb();
  if (!db) {
    const hit = Array.from(memoryFallbackStores.puzzles.values()).find(
      (p) => p.epoch === cleanEpoch && p.linkidUpper === upperLink
    );
    return hit ? stripStorageKeysFromPuzzle(hit) : null;
  }
  const tx = db.transaction(STORE_PUZZLES, 'readonly');
  const hit = await idbReq<StoredPuzzleRow | undefined>(
    tx.objectStore(STORE_PUZZLES).index('by_epoch_linkid').get([cleanEpoch, upperLink])
  );
  return hit ? stripStorageKeysFromPuzzle(hit) : null;
}

export async function getPuzzlesByIdsIdb(epoch: number, ids: number[]): Promise<Puzzle[]> {
  if (!ids || ids.length === 0) return [];
  const results = await Promise.all(ids.map((id) => getPuzzleByIdIdb(epoch, id)));
  return results.filter((p): p is Puzzle => Boolean(p));
}

export async function getMemeByIdIdb(epoch: number, memeid: string): Promise<MemeEntry | null> {
  const cleanEpoch = Math.max(1, Math.floor(epoch));
  const upperId = String(memeid || '').trim().toUpperCase();
  if (!upperId) return null;
  const key = `${cleanEpoch}::${upperId}`;
  const db = await openCacheDb();
  if (!db) {
    const hit = memoryFallbackStores.memes.get(key);
    return hit ? stripStorageKeysFromMeme(hit) : null;
  }
  const tx = db.transaction(STORE_MEMES, 'readonly');
  const hit = await idbReq<StoredMemeRow | undefined>(tx.objectStore(STORE_MEMES).get(key));
  return hit ? stripStorageKeysFromMeme(hit) : null;
}

export async function invalidateCatalogCacheIdb(epoch?: number): Promise<void> {
  const db = await openCacheDb();
  if (!db) {
    if (typeof epoch === 'number') {
      memoryFallbackStores.catalogMeta.delete(getCatalogMetaKey(epoch));
    } else {
      memoryFallbackStores.catalogMeta.clear();
    }
    return;
  }
  const tx = db.transaction(STORE_CATALOG_META, 'readwrite');
  const store = tx.objectStore(STORE_CATALOG_META);
  if (typeof epoch === 'number') {
    store.delete(getCatalogMetaKey(epoch));
  } else {
    store.clear();
  }
  await idbTxDone(tx);
}

// ==========================================
// 3. PUZZLE SUBMISSION CACHE & BULK SYNC STORE
// ==========================================
export async function enqueueSubmissionIdb(
  record: CachedSubmissionRecord
): Promise<{ inserted: boolean; record: CachedSubmissionRecord }> {
  const db = await openCacheDb();
  if (!db) {
    for (const existing of memoryFallbackStores.submissions.values()) {
      if (existing.dedupeKey === record.dedupeKey) {
        return { inserted: false, record: existing };
      }
    }
    memoryFallbackStores.submissions.set(record.submissionId, record);
    return { inserted: true, record };
  }

  const tx = db.transaction(STORE_SUBMISSIONS, 'readwrite');
  const store = tx.objectStore(STORE_SUBMISSIONS);
  const dedupeIdx = store.index('by_dedupe_key');
  const existing = await idbReq<CachedSubmissionRecord[]>(
    dedupeIdx.getAll(IDBKeyRange.only(record.dedupeKey))
  );

  if (existing.length > 0) {
    // Allow updating telemetry/event records if same dedupeKey only for non-SOLVE, or reject duplicate SOLVE
    const activeSame = existing.find(
      (e) => e.action === 'SOLVED' || e.status === 'pending' || e.status === 'syncing'
    );
    if (activeSame && record.action === 'SOLVED') {
      await idbTxDone(tx);
      return { inserted: false, record: activeSame };
    }
  }

  store.put(record);
  await idbTxDone(tx);
  return { inserted: true, record };
}

export async function recoverStuckSyncingSubmissionsIdb(): Promise<number> {
  const isLegacySchemaBlocked = (s: CachedSubmissionRecord): boolean => {
    const err = String(s.lastError || '').toLowerCase();
    const hasLegacyCol =
      Boolean(s.supabaseLog && 'submission_id' in s.supabaseLog) ||
      err.includes('submission_id') ||
      err.includes('schema cache');
    return s.status === 'failed' && hasLegacyCol;
  };

  const sanitizeLegacyRecord = (s: CachedSubmissionRecord): CachedSubmissionRecord => {
    if (!s.supabaseLog || !('submission_id' in s.supabaseLog)) return s;
    const { submission_id: _omit, ...cleanLog } = s.supabaseLog;
    return { ...s, supabaseLog: cleanLog };
  };

  const db = await openCacheDb();
  if (!db) {
    let recovered = 0;
    memoryFallbackStores.submissions.forEach((s, key) => {
      if (s.status === 'syncing' || isLegacySchemaBlocked(s)) {
        const clean = sanitizeLegacyRecord(s);
        memoryFallbackStores.submissions.set(key, {
          ...clean,
          status: 'pending',
          retryCount: isLegacySchemaBlocked(s) ? 0 : clean.retryCount,
          nextRetryAt: 0,
          lastError: undefined,
        });
        recovered++;
      }
    });
    return recovered;
  }

  const tx = db.transaction(STORE_SUBMISSIONS, 'readwrite');
  const store = tx.objectStore(STORE_SUBMISSIONS);
  const statusIdx = store.index('by_status');
  const [syncing, failed] = await Promise.all([
    idbReq<CachedSubmissionRecord[]>(statusIdx.getAll(IDBKeyRange.only('syncing'))),
    idbReq<CachedSubmissionRecord[]>(statusIdx.getAll(IDBKeyRange.only('failed'))),
  ]);

  let recovered = 0;
  syncing.forEach((s) => {
    const clean = sanitizeLegacyRecord(s);
    store.put({ ...clean, status: 'pending' as SubmissionSyncStatus });
    recovered++;
  });
  failed.forEach((s) => {
    if (isLegacySchemaBlocked(s)) {
      const clean = sanitizeLegacyRecord(s);
      store.put({
        ...clean,
        status: 'pending' as SubmissionSyncStatus,
        retryCount: 0,
        nextRetryAt: 0,
        lastError: undefined,
      });
      recovered++;
    }
  });
  await idbTxDone(tx);
  return recovered;
}

export async function claimReadySubmissionsBatchIdb(
  batchSize?: number,
  maxRetries?: number
): Promise<CachedSubmissionRecord[]> {
  const syncCfg = getSyncConfig();
  const limit = Math.max(1, batchSize ?? syncCfg.batchSize);
  const retryCap = Math.max(1, maxRetries ?? syncCfg.maxRetries);
  const now = Date.now();

  const db = await openCacheDb();
  if (!db) {
    const ready = Array.from(memoryFallbackStores.submissions.values())
      .filter(
        (s) =>
          (s.status === 'pending' || s.status === 'failed') &&
          s.nextRetryAt <= now &&
          s.retryCount < retryCap
      )
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, limit);
    ready.forEach((s) => {
      memoryFallbackStores.submissions.set(s.submissionId, { ...s, status: 'syncing' });
    });
    return ready.map((s) => ({ ...s, status: 'syncing' as const }));
  }

  const tx = db.transaction(STORE_SUBMISSIONS, 'readwrite');
  const store = tx.objectStore(STORE_SUBMISSIONS);
  const statusIdx = store.index('by_status');

  const [pendingList, failedList] = await Promise.all([
    idbReq<CachedSubmissionRecord[]>(statusIdx.getAll(IDBKeyRange.only('pending'))),
    idbReq<CachedSubmissionRecord[]>(statusIdx.getAll(IDBKeyRange.only('failed'))),
  ]);

  const candidates = [...pendingList, ...failedList]
    .filter((s) => s.nextRetryAt <= now && s.retryCount < retryCap)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, limit);

  const claimed = candidates.map((item) => {
    const next: CachedSubmissionRecord = { ...item, status: 'syncing' };
    store.put(next);
    return next;
  });

  await idbTxDone(tx);
  return claimed;
}

export async function markSubmissionsOutcomeIdb(
  outcomes: Array<{
    submissionId: string;
    ok: boolean;
    error?: string;
    resetToPendingImmediately?: boolean;
  }>
): Promise<void> {
  if (outcomes.length === 0) return;
  const syncCfg = getSyncConfig();
  const now = Date.now();
  const db = await openCacheDb();

  const computeNext = (
    item: CachedSubmissionRecord,
    outcome: { ok: boolean; error?: string; resetToPendingImmediately?: boolean }
  ): CachedSubmissionRecord => {
    if (outcome.ok) {
      return {
        ...item,
        status: 'synced',
        lastError: undefined,
        syncedAt: now,
      };
    }
    if (outcome.resetToPendingImmediately) {
      return {
        ...item,
        status: 'pending',
        nextRetryAt: now,
        lastError: outcome.error,
      };
    }
    const nextRetryCount = item.retryCount + 1;
    const jitter = Math.floor(Math.random() * 400);
    const backoff = Math.min(
      60_000,
      syncCfg.baseBackoffMs * Math.pow(2, Math.max(0, nextRetryCount - 1)) + jitter
    );
    return {
      ...item,
      status: 'failed',
      retryCount: nextRetryCount,
      nextRetryAt: now + backoff,
      lastError: outcome.error || 'Sync failed',
    };
  };

  if (!db) {
    outcomes.forEach((o) => {
      const existing = memoryFallbackStores.submissions.get(o.submissionId);
      if (existing) {
        memoryFallbackStores.submissions.set(o.submissionId, computeNext(existing, o));
      }
    });
    return;
  }

  const tx = db.transaction(STORE_SUBMISSIONS, 'readwrite');
  const store = tx.objectStore(STORE_SUBMISSIONS);
  for (const outcome of outcomes) {
    const existing = await idbReq<CachedSubmissionRecord | undefined>(
      store.get(outcome.submissionId)
    );
    if (existing) {
      store.put(computeNext(existing, outcome));
    }
  }
  await idbTxDone(tx);
}

export async function getSubmissionQueueCountsIdb(): Promise<{
  pending: number;
  syncing: number;
  failed: number;
  synced: number;
  lastError?: string;
}> {
  const db = await openCacheDb();
  let all: CachedSubmissionRecord[] = [];
  if (!db) {
    all = Array.from(memoryFallbackStores.submissions.values());
  } else {
    const tx = db.transaction(STORE_SUBMISSIONS, 'readonly');
    all = await idbReq<CachedSubmissionRecord[]>(tx.objectStore(STORE_SUBMISSIONS).getAll());
  }

  let pending = 0;
  let syncing = 0;
  let failed = 0;
  let synced = 0;
  let lastError: string | undefined;

  for (const item of all) {
    if (item.status === 'pending') pending++;
    else if (item.status === 'syncing') syncing++;
    else if (item.status === 'failed') {
      failed++;
      if (item.lastError) lastError = item.lastError;
    } else if (item.status === 'synced') synced++;
  }

  return { pending, syncing, failed, synced, lastError };
}

/**
 * Safe cache maintenance:
 * - Removes ONLY 'synced' submission records older than syncedSubmissionRetentionMs
 *   or exceeding maxCachedSyncedSubmissions.
 * - NEVER deletes 'pending', 'syncing', or 'failed' submissions.
 * - Cleans stale catalog rows from old superseded epochs.
 */
export async function pruneExpiredSyncedCacheIdb(currentEpoch: number): Promise<number> {
  const cacheCfg = getCacheConfig();
  const cutoff = Date.now() - cacheCfg.syncedSubmissionRetentionMs;
  const maxSynced = cacheCfg.maxCachedSyncedSubmissions;
  let removed = 0;

  const db = await openCacheDb();
  if (!db) {
    const syncedRows = Array.from(memoryFallbackStores.submissions.values())
      .filter((s) => s.status === 'synced')
      .sort((a, b) => (b.syncedAt || b.createdAt) - (a.syncedAt || a.createdAt));
    syncedRows.forEach((row, idx) => {
      const ts = row.syncedAt || row.createdAt;
      if (ts < cutoff || idx >= maxSynced) {
        memoryFallbackStores.submissions.delete(row.submissionId);
        removed++;
      }
    });
    return removed;
  }

  const tx = db.transaction([STORE_SUBMISSIONS, STORE_PUZZLES, STORE_MEMES], 'readwrite');
  const subStore = tx.objectStore(STORE_SUBMISSIONS);
  const syncedRows = await idbReq<CachedSubmissionRecord[]>(
    subStore.index('by_status').getAll(IDBKeyRange.only('synced'))
  );

  syncedRows.sort((a, b) => (b.syncedAt || b.createdAt) - (a.syncedAt || a.createdAt));
  syncedRows.forEach((row, idx) => {
    const ts = row.syncedAt || row.createdAt;
    if (ts < cutoff || idx >= maxSynced) {
      subStore.delete(row.submissionId);
      removed++;
    }
  });

  // Remove puzzle/meme rows belonging to older superseded epochs (never current epoch)
  if (currentEpoch > 1) {
    const pStore = tx.objectStore(STORE_PUZZLES);
    const mStore = tx.objectStore(STORE_MEMES);
    const range = IDBKeyRange.upperBound(currentEpoch - 1);
    await Promise.all([
      new Promise<void>((resolve) => {
        const req = pStore.index('by_epoch').openCursor(range);
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            pStore.delete(cursor.primaryKey);
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = () => resolve();
      }),
      new Promise<void>((resolve) => {
        const req = mStore.index('by_epoch').openCursor(range);
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            mStore.delete(cursor.primaryKey);
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = () => resolve();
      }),
    ]);
  }

  await idbTxDone(tx);
  return removed;
}

// ==========================================
// 4. SESSION STATE & PROGRESS CACHE (IndexedDB)
// ==========================================
export async function getSessionStateIdb<T>(stateKey: string): Promise<T | null> {
  if (!stateKey) return null;
  const db = await openCacheDb();
  if (!db) {
    const hit = memoryFallbackStores.sessionState.get(stateKey);
    return hit ? (hit.value as T) : null;
  }
  const tx = db.transaction(STORE_SESSION_STATE, 'readonly');
  const row = await idbReq<StoredSessionStateRow | undefined>(
    tx.objectStore(STORE_SESSION_STATE).get(stateKey)
  );
  return row ? (row.value as T) : null;
}

export async function setSessionStateIdb<T>(stateKey: string, value: T): Promise<void> {
  if (!stateKey) return;
  const row: StoredSessionStateRow = { stateKey, value, updatedAt: Date.now() };
  const db = await openCacheDb();
  if (!db) {
    memoryFallbackStores.sessionState.set(stateKey, row);
    return;
  }
  const tx = db.transaction(STORE_SESSION_STATE, 'readwrite');
  tx.objectStore(STORE_SESSION_STATE).put(row);
  await idbTxDone(tx);
}

export async function deleteSessionStateIdb(stateKey: string): Promise<void> {
  if (!stateKey) return;
  const db = await openCacheDb();
  if (!db) {
    memoryFallbackStores.sessionState.delete(stateKey);
    return;
  }
  const tx = db.transaction(STORE_SESSION_STATE, 'readwrite');
  tx.objectStore(STORE_SESSION_STATE).delete(stateKey);
  await idbTxDone(tx);
}

export async function clearEpochProgressInIdb(newEpoch: number, clearCatalog = false): Promise<void> {
  const db = await openCacheDb();
  if (!db) {
    Array.from(memoryFallbackStores.sessionState.keys()).forEach((key) => {
      if (key.startsWith('progress:') || key.startsWith('notebook:') || key === 'active_session') {
        memoryFallbackStores.sessionState.delete(key);
      }
    });
    // Never delete unsynced registrations or pending/failed submissions arbitrarily unless epoch reset wipes gameplay
    Array.from(memoryFallbackStores.submissions.values()).forEach((s) => {
      if (s.epoch < newEpoch && s.status === 'synced') {
        memoryFallbackStores.submissions.delete(s.submissionId);
      }
    });
    if (clearCatalog) {
      memoryFallbackStores.puzzles.clear();
      memoryFallbackStores.memes.clear();
      memoryFallbackStores.catalogMeta.clear();
    }
    return;
  }

  const stores = clearCatalog
    ? [STORE_SESSION_STATE, STORE_PUZZLES, STORE_MEMES, STORE_CATALOG_META]
    : [STORE_SESSION_STATE];
  const tx = db.transaction(stores, 'readwrite');
  const sStore = tx.objectStore(STORE_SESSION_STATE);
  await new Promise<void>((resolve) => {
    const req = sStore.openKeyCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        const key = String(cursor.primaryKey);
        if (key.startsWith('progress:') || key.startsWith('notebook:') || key === 'active_session') {
          sStore.delete(cursor.primaryKey);
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => resolve();
  });

  if (clearCatalog) {
    tx.objectStore(STORE_PUZZLES).clear();
    tx.objectStore(STORE_MEMES).clear();
    tx.objectStore(STORE_CATALOG_META).clear();
  }
  await idbTxDone(tx);
}

export async function getCacheDiagnosticsIdb(): Promise<CacheDiagnostics> {
  const db = await openCacheDb();
  let estimate: StorageEstimate | null = null;
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      estimate = await navigator.storage.estimate();
    }
  } catch {
    estimate = null;
  }

  if (!db) {
    const subCounts = await getSubmissionQueueCountsIdb();
    return {
      storageBackend: 'memory-fallback',
      registrationsCount: memoryFallbackStores.registrations.size,
      puzzlesCount: memoryFallbackStores.puzzles.size,
      memesCount: memoryFallbackStores.memes.size,
      pendingSubmissions: subCounts.pending,
      syncingSubmissions: subCounts.syncing,
      failedSubmissions: subCounts.failed,
      syncedSubmissions: subCounts.synced,
      estimatedUsageBytes: estimate?.usage ?? null,
      estimatedQuotaBytes: estimate?.quota ?? null,
    };
  }

  const tx = db.transaction(
    [STORE_REGISTRATIONS, STORE_PUZZLES, STORE_MEMES, STORE_SUBMISSIONS],
    'readonly'
  );
  const [regCount, puzCount, memeCount, subCounts] = await Promise.all([
    idbReq<number>(tx.objectStore(STORE_REGISTRATIONS).count()),
    idbReq<number>(tx.objectStore(STORE_PUZZLES).count()),
    idbReq<number>(tx.objectStore(STORE_MEMES).count()),
    getSubmissionQueueCountsIdb(),
  ]);

  return {
    storageBackend: 'indexeddb',
    registrationsCount: regCount,
    puzzlesCount: puzCount,
    memesCount: memeCount,
    pendingSubmissions: subCounts.pending,
    syncingSubmissions: subCounts.syncing,
    failedSubmissions: subCounts.failed,
    syncedSubmissions: subCounts.synced,
    estimatedUsageBytes: estimate?.usage ?? null,
    estimatedQuotaBytes: estimate?.quota ?? null,
  };
}
