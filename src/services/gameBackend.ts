import {
  STORAGE_KEYS,
  type AdminCredential,
  type CachedRegistrationRecord,
  type CachedSubmissionRecord,
  type FirestoreLanguage,
  type GameConfig,
  type LanguageCode,
  type MemeEntry,
  type Puzzle,
  type PuzzleEventAction,
  type PuzzleEventStatus,
  type PuzzleNotebookEntry,
  type PuzzleSummary,
  type StepId,
  type SyncStatusSummary,
  type TeamEntry,
  type TeamProgressDoc,
} from '../types/game';
import { getCacheConfig, getGameConfig, getSyncConfig } from './configService';
import {
  claimReadySubmissionsBatchIdb,
  clearEpochProgressInIdb,
  deleteRegistrationRecordIdb,
  deleteSessionStateIdb,
  enqueueSubmissionIdb,
  getCacheDiagnosticsIdb,
  getCatalogMetaIdb,
  getLatestRegistrationRecordIdb,
  getMemeByIdIdb,
  getPendingOrFailedRegistrationsIdb,
  getPuzzleByIdIdb,
  getPuzzleByLinkIdIdb,
  getPuzzleSummariesIdb,
  getPuzzlesByIdsIdb,
  getRegistrationByIdIdb,
  getSessionStateIdb,
  getSubmissionQueueCountsIdb,
  hasValidCatalogInIdb,
  invalidateCatalogCacheIdb,
  markSubmissionsOutcomeIdb,
  openCacheDb,
  pruneExpiredSyncedCacheIdb,
  recoverStuckSyncingSubmissionsIdb,
  saveRegistrationRecordIdb,
  setSessionStateIdb,
  sha256NormalizedHex,
  storeBulkCatalogIdb,
  updateRegistrationStatusIdb,
  type CacheDiagnostics,
} from './localCacheDb';
import { getSupabaseClient, hasSupabaseBackend } from './supabaseClient';

export { getCacheDiagnosticsIdb, hasSupabaseBackend, sha256NormalizedHex };
export type { CacheDiagnostics };

// ==========================================
// CONNECTIVITY & TIMEOUT HELPERS
// ==========================================
export function isBrowserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export function hasRemoteBackend(): boolean {
  return hasSupabaseBackend();
}

async function withPromiseTimeout<T>(
  promise: PromiseLike<T>,
  timeoutMs = 5000,
  label = 'Remote request'
): Promise<T> {
  let timerId = 0;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<never>((_, reject) => {
        timerId = window.setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timerId) window.clearTimeout(timerId);
  }
}

const UNAVAILABLE_RPCS_STORAGE_KEY = 'pykachu_unavailable_rpcs';
const unavailableRpcs = new Set<string>((() => {
  try {
    const raw = sessionStorage.getItem(UNAVAILABLE_RPCS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
})());

function markRpcUnavailable(rpcName: string): void {
  unavailableRpcs.add(rpcName);
  try {
    sessionStorage.setItem(UNAVAILABLE_RPCS_STORAGE_KEY, JSON.stringify(Array.from(unavailableRpcs)));
  } catch {
    // ignore storage errors
  }
}

function isRpcMissingError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code || '').toUpperCase();
  const msg = String(error.message || '').toLowerCase();
  return (
    code === 'PGRST202' ||
    msg.includes('could not find the function') ||
    (msg.includes('function public.') && msg.includes('does not exist'))
  );
}

// ==========================================
// LIVE SYNC STATUS EMITTER (TIER 2 -> TIER 1)
// ==========================================
type SyncStatusListener = (summary: SyncStatusSummary) => void;
const syncListeners = new Set<SyncStatusListener>();
const activeRegistrationSyncIds = new Set<string>();
let activeCatalogSyncCount = 0;

let lastKnownSyncSummary: SyncStatusSummary = {
  online: isBrowserOnline(),
  pendingCount: 0,
  syncingCount: 0,
  failedCount: 0,
  syncedCount: 0,
  catalogSyncing: false,
  registrationStatus: null,
};

async function computeSyncStatusSummary(): Promise<SyncStatusSummary> {
  const localEpoch = Math.max(1, Number(localStorage.getItem(STORAGE_KEYS.gameEpoch) || 1));
  const [counts, latestReg] = await Promise.all([
    getSubmissionQueueCountsIdb(),
    getLatestRegistrationRecordIdb(localEpoch),
  ]);

  const summary: SyncStatusSummary = {
    online: isBrowserOnline(),
    pendingCount: counts.pending,
    syncingCount: counts.syncing,
    failedCount: counts.failed,
    syncedCount: counts.synced,
    catalogSyncing: activeCatalogSyncCount > 0,
    registrationStatus: latestReg?.status ?? null,
    registrationError: latestReg?.lastError,
    lastSyncError: counts.lastError || latestReg?.lastError,
    lastSyncedAt:
      latestReg?.syncedAt ?? (counts.synced > 0 ? lastKnownSyncSummary.lastSyncedAt : undefined),
  };
  lastKnownSyncSummary = summary;
  return summary;
}

export async function refreshSyncStatus(): Promise<SyncStatusSummary> {
  const next = await computeSyncStatusSummary();
  syncListeners.forEach((listener) => {
    try {
      listener(next);
    } catch {
      // ignore subscriber render errors
    }
  });
  return next;
}

export function getSyncStatusSnapshot(): SyncStatusSummary {
  return lastKnownSyncSummary;
}

export function subscribeSyncStatus(listener: SyncStatusListener): () => void {
  syncListeners.add(listener);
  listener(lastKnownSyncSummary);
  void refreshSyncStatus();
  return () => {
    syncListeners.delete(listener);
  };
}

// ==========================================
// STRING & PUZZLE HELPERS
// ==========================================
export function standardizeString(str: unknown): string {
  return String(str ?? '').trim().toUpperCase();
}

export function generateSessionId(): string {
  return `SES_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
}

export function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

export function toFirestoreLanguage(lang: LanguageCode | string): FirestoreLanguage {
  return standardizeString(lang) === 'CPP' || standardizeString(lang) === 'C++' ? 'C++' : 'PYTHON';
}

export function fromFirestoreLanguage(lang: string): LanguageCode {
  return standardizeString(lang) === 'C++' || standardizeString(lang) === 'CPP' ? 'CPP' : 'PYTHON';
}

export function isStartingPuzzle(puzzle: Pick<PuzzleSummary, 'requiresStartCode'> & { startCode?: string } | null | undefined): boolean {
  if (!puzzle) return false;
  return Boolean(puzzle.requiresStartCode || (puzzle.startCode && String(puzzle.startCode).trim() !== ''));
}

export function getLeadPuzzleIds(puzzles: PuzzleSummary[]): Set<number> {
  const leads = new Set<number>();
  if (!Array.isArray(puzzles) || puzzles.length === 0) return leads;

  const activeIds = new Set<number>();
  const targetedIds = new Set<number>();

  puzzles.forEach((p) => {
    const id = Number(p.id);
    if (id > 0) activeIds.add(id);
    if (isStartingPuzzle(p)) leads.add(id);
  });

  puzzles.forEach((p) => {
    (p.nextPuzzleId || []).forEach((rawNext) => {
      const nextId = Number(rawNext);
      if (activeIds.has(nextId) && nextId !== Number(p.id)) {
        targetedIds.add(nextId);
      }
    });
  });

  puzzles.forEach((p) => {
    const id = Number(p.id);
    if (id > 0 && !targetedIds.has(id)) {
      leads.add(id);
    }
  });

  if (leads.size === 0) {
    const minId = Math.min(...Array.from(activeIds));
    if (Number.isFinite(minId) && minId > 0) leads.add(minId);
  }

  return leads;
}

export function isHintValid(hint: unknown): boolean {
  if (hint === null || hint === undefined) return false;
  if (typeof hint === 'boolean') return hint === true;
  if (typeof hint === 'string') {
    const lower = hint.toLowerCase().trim();
    return lower !== 'none' && lower !== 'false' && lower !== '' && lower !== 'null';
  }
  return false;
}

export function puzzleHasHint(puzzle: Partial<Puzzle> | null | undefined): boolean {
  if (!puzzle) return false;
  if (puzzle.hasHint === true) return true;
  return isHintValid(puzzle.hint);
}

export function getPuzzleQuestion(puzzle: Puzzle | null, language: LanguageCode): string {
  if (!puzzle) return '';
  if (language === 'CPP') return puzzle.questionCpp || puzzle.questionPython || '';
  return puzzle.questionPython || puzzle.questionCpp || '';
}

export function getPokemonArtworkUrl(pokemonId: number | string | undefined): string {
  const id = Number(pokemonId);
  if (!id || Number.isNaN(id)) return '/assets/img/pikachu.png';
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/${id}.png`;
}

export function getBadgeUrl(badgeId: number | string | undefined): string {
  const id = Number(badgeId);
  if (!id || Number.isNaN(id)) return '';
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/badges/${id}.png`;
}

export function computeLocalUnlocked(puzzles: PuzzleSummary[], solvedIds: number[]): number[] {
  const byId = new Map<number, PuzzleSummary>();
  const allowed = getLeadPuzzleIds(puzzles);
  puzzles.forEach((p) => {
    byId.set(Number(p.id), p);
  });
  solvedIds.forEach((rawId) => {
    const p = byId.get(Number(rawId));
    if (!p) return;
    allowed.add(Number(p.id));
    (p.nextPuzzleId || []).forEach((n) => allowed.add(Number(n)));
  });
  return Array.from(allowed).sort((a, b) => a - b);
}

export function isPuzzleAllowed(
  puzzle: PuzzleSummary | null | undefined,
  solvedIds: Set<number>,
  unlockedIds: Set<number>,
  allPuzzles?: PuzzleSummary[]
): boolean {
  if (!puzzle) return false;
  if (isStartingPuzzle(puzzle)) return true;
  const id = Number(puzzle.id);
  if (solvedIds.has(id) || unlockedIds.has(id)) return true;
  if (allPuzzles && allPuzzles.length > 0) {
    return getLeadPuzzleIds(allPuzzles).has(id);
  }
  return false;
}

export function puzzleGateMessage(
  puzzle: PuzzleSummary | null | undefined,
  puzzles: PuzzleSummary[],
  currentPuzzle: PuzzleSummary | null
): string {
  if (!puzzle) return '❌ Invalid Signal - Access Denied';
  const activeIds = new Set(puzzles.map((p) => Number(p.id)));
  const prereqs = puzzles.filter(
    (p) =>
      activeIds.has(Number(p.id)) &&
      Array.isArray(p.nextPuzzleId) &&
      p.nextPuzzleId.some((n) => Number(n) === Number(puzzle.id))
  );
  if (prereqs.length > 0) {
    if (!currentPuzzle) {
      return `🔒 Locked! Solve P${prereqs[0].id} (${prereqs[0].linkid}) first.`;
    }
    return '🔒 Out of sequence! Finish your current puzzle first.';
  }
  return currentPuzzle
    ? '🔒 Locked! Finish your current puzzle first.'
    : '🔒 Locked! Scan the starting QR first.';
}

export function getNextPuzzles<T extends PuzzleSummary>(puzzles: T[], puzzle: PuzzleSummary | null): T[] {
  if (!puzzle || !Array.isArray(puzzle.nextPuzzleId)) return [];
  return puzzle.nextPuzzleId
    .map((id) => puzzles.find((p) => Number(p.id) === Number(id)))
    .filter((p): p is T => Boolean(p));
}

export function verifyPuzzleAnswer(puzzle: Puzzle | null, rawInput: string): boolean {
  if (!puzzle) return false;
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return false;
  if (puzzle.answerDigest) {
    return sha256NormalizedHex(trimmed) === puzzle.answerDigest;
  }
  return standardizeString(trimmed) === standardizeString(puzzle.answer);
}

export function verifyPuzzleStartCode(puzzle: Puzzle | null, rawCode: string): boolean {
  if (!puzzle || !isStartingPuzzle(puzzle)) return false;
  const trimmed = String(rawCode || '').trim();
  if (!trimmed) return false;
  if (puzzle.startCodeDigest) {
    return sha256NormalizedHex(trimmed) === puzzle.startCodeDigest;
  }
  return standardizeString(trimmed) === standardizeString(puzzle.startCode);
}

export function extractUniversalScanCode(rawCode: string): string {
  let code = standardizeString(rawCode);
  if (rawCode.includes('?')) {
    try {
      const url = new URL(rawCode.trim(), window.location.origin);
      const params = new URLSearchParams(
        url.search || (url.hash.includes('?') ? url.hash.slice(url.hash.indexOf('?')) : '')
      );
      let extracted = '';
      params.forEach((val, key) => {
        const k = key.toLowerCase();
        if (!extracted && (k === 'linkid' || k === 'memid')) {
          extracted = val;
        }
      });
      if (extracted) code = standardizeString(extracted);
    } catch {
      // ignore malformed URL
    }
  } else if (code.includes('/')) {
    const seg = code.split('/').filter(Boolean).pop();
    if (seg) code = seg;
  }
  return code;
}

export function getDeepLinkCodeFromLocation(): { linkId: string; memeId: string; rawSlug: string } {
  const params = new URLSearchParams(window.location.search);
  const linkId = standardizeString(params.get('linkid'));
  const memeId = standardizeString(params.get('memid'));
  let rawSlug = '';
  if (!linkId && !memeId) {
    const seg = (window.location.pathname || '').split('/').filter(Boolean).pop();
    if (seg && standardizeString(seg) !== 'ADMIN') {
      rawSlug = standardizeString(seg);
    }
  }
  return { linkId, memeId, rawSlug };
}

export function resolveUniversalLink(
  puzzles: Puzzle[],
  memes: MemeEntry[]
): { puzzle: Puzzle | null; meme: MemeEntry | null } {
  const { linkId, memeId, rawSlug } = getDeepLinkCodeFromLocation();
  let resolvedLink = linkId;
  let resolvedMeme = memeId;
  if (!resolvedLink && !resolvedMeme && rawSlug) {
    if (memes.some((m) => standardizeString(m.memeid) === rawSlug)) resolvedMeme = rawSlug;
    else if (puzzles.some((p) => standardizeString(p.linkid) === rawSlug)) resolvedLink = rawSlug;
  }
  const puzzle = resolvedLink
    ? puzzles.find((p) => standardizeString(p.linkid) === resolvedLink) || null
    : null;
  const meme = resolvedMeme
    ? memes.find((m) => standardizeString(m.memeid) === resolvedMeme) || null
    : null;
  return { puzzle, meme };
}

// ==========================================
// STATIC CONFIG & LOCAL OVERRIDES
// ==========================================
export const DEFAULT_GAME_CONFIG: GameConfig = getGameConfig();

function normalizeLoadedPuzzle(raw: Partial<Puzzle>, isCustom = false): Puzzle {
  const id = Math.max(1, Math.floor(Number(raw.id || 1)));
  const rawHint = typeof raw.hint === 'string' ? raw.hint.trim() : raw.hint;
  const hasHintFlag =
    typeof raw.hasHint === 'boolean' ? raw.hasHint : isHintValid(rawHint);
  const startCodeVal = raw.startCode ? String(raw.startCode).trim() : undefined;
  const answerVal = String(raw.answer ?? '');
  return {
    id,
    linkid: String(raw.linkid || `P${id}`).trim(),
    badgeId: raw.badgeId && Number(raw.badgeId) > 0 ? Number(raw.badgeId) : undefined,
    questionPython: String(raw.questionPython || ''),
    questionCpp: String(raw.questionCpp || ''),
    answer: answerVal,
    answerDigest: raw.answerDigest || (answerVal ? sha256NormalizedHex(answerVal) : undefined),
    nextPuzzleId: Array.isArray(raw.nextPuzzleId)
      ? raw.nextPuzzleId.map(Number).filter((n) => !Number.isNaN(n) && n > 0)
      : [],
    startCode: startCodeVal,
    startCodeDigest:
      raw.startCodeDigest || (startCodeVal ? sha256NormalizedHex(startCodeVal) : undefined),
    requiresStartCode: Boolean(raw.requiresStartCode || raw.startCodeDigest || startCodeVal),
    locationClue: String(raw.locationClue || ''),
    level: Math.max(1, Math.floor(Number(raw.level || 1))),
    points: Math.max(0, Number(raw.points ?? 10)),
    hint: isHintValid(rawHint) ? rawHint : undefined,
    hasHint: hasHintFlag,
    hintPenalty: raw.hintPenalty !== undefined ? Number(raw.hintPenalty) : 60,
    tabSwitchPenaltySeconds: raw.tabSwitchPenaltySeconds !== undefined
      ? Math.max(0, Math.floor(Number(raw.tabSwitchPenaltySeconds)))
      : 15,
    pokemonId: Math.max(0, Math.floor(Number(raw.pokemonId ?? 25))),
    pokemonName: String(raw.pokemonName || 'Pikachu'),
    isCustom,
  };
}

interface LocalCatalogOverrides {
  teamsUpsert: Record<string, TeamEntry>;
  teamsDelete: string[];
  memesUpsert: Record<string, MemeEntry>;
  memesDelete: string[];
  puzzlesUpsert: Record<string, Puzzle>;
  puzzlesDelete: number[];
  catalogVersion: number;
}

function readLocalOverrides(): LocalCatalogOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.localCatalogOverrides);
    if (raw) {
      const p = JSON.parse(raw) as Partial<LocalCatalogOverrides>;
      return {
        teamsUpsert: p.teamsUpsert || {},
        teamsDelete: Array.isArray(p.teamsDelete) ? p.teamsDelete : [],
        memesUpsert: p.memesUpsert || {},
        memesDelete: Array.isArray(p.memesDelete) ? p.memesDelete : [],
        puzzlesUpsert: p.puzzlesUpsert || {},
        puzzlesDelete: Array.isArray(p.puzzlesDelete) ? p.puzzlesDelete.map(Number) : [],
        catalogVersion: Math.max(1, Number(p.catalogVersion || 1)),
      };
    }
  } catch {
    // ignore
  }
  return {
    teamsUpsert: {},
    teamsDelete: [],
    memesUpsert: {},
    memesDelete: [],
    puzzlesUpsert: {},
    puzzlesDelete: [],
    catalogVersion: 1,
  };
}

function writeLocalOverrides(next: LocalCatalogOverrides): void {
  try {
    localStorage.setItem(STORAGE_KEYS.localCatalogOverrides, JSON.stringify(next));
  } catch {
    // ignore
  }
}

async function fetchJsonSafe<T>(path: string, fallback: T, timeoutMs = 2500): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, { signal: controller.signal });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  } finally {
    window.clearTimeout(timer);
  }
}

function mapSupabaseTeamRow(row: Record<string, unknown>): TeamEntry {
  const tid = String(row.tid || '').trim().toUpperCase();
  const team = String(row.team || '').trim();
  const emails = extractTeamEmails({
    email: row.email ? String(row.email) : undefined,
    emails: Array.isArray(row.emails) ? row.emails.map(String) : undefined,
    team_members: Array.isArray(row.team_members) ? row.team_members.map(String) : undefined,
  });
  return {
    tid,
    team,
    email: emails[0] || undefined,
    emails,
    securityKey: String(row.security_key ?? row.securityKey ?? ''),
    team_members: Array.isArray(row.team_members) ? row.team_members.map(String) : [],
    isCustom: true,
  };
}

function toSupabaseTeamRow(entry: TeamEntry): Record<string, unknown> {
  const tid = String(entry.tid || '').trim().toUpperCase();
  const emails = extractTeamEmails(entry).slice(0, 12);
  return {
    tid,
    team: String(entry.team || '').trim().slice(0, 60),
    email: emails[0] || null,
    emails,
    security_key: String(entry.securityKey || '').trim().slice(0, 64),
    team_members: (entry.team_members || []).map(String).filter(Boolean).slice(0, 12),
    updated_at: new Date().toISOString(),
  };
}

function mapSupabasePuzzleRow(row: Record<string, unknown>, includeSecrets = false): Puzzle {
  return normalizeLoadedPuzzle(
    {
      id: Number(row.id),
      linkid: String(row.linkid || ''),
      badgeId: row.badge_id !== null && row.badge_id !== undefined ? Number(row.badge_id) : undefined,
      questionPython: String(row.question_python ?? ''),
      questionCpp: String(row.question_cpp ?? ''),
      answer: includeSecrets ? String(row.answer ?? '') : '',
      answerDigest: row.answer_digest
        ? String(row.answer_digest)
        : row.answer
          ? sha256NormalizedHex(row.answer)
          : undefined,
      nextPuzzleId: Array.isArray(row.next_puzzle_id) ? row.next_puzzle_id.map(Number) : [],
      startCode: includeSecrets && row.start_code ? String(row.start_code) : undefined,
      startCodeDigest: row.start_code_digest
        ? String(row.start_code_digest)
        : row.start_code
          ? sha256NormalizedHex(row.start_code)
          : undefined,
      requiresStartCode:
        typeof row.requires_start_code === 'boolean'
          ? row.requires_start_code
          : Boolean(row.start_code || row.start_code_digest),
      locationClue: String(row.location_clue ?? ''),
      level: Number(row.level ?? 1),
      points: Number(row.points ?? 10),
      hint: row.hint ? String(row.hint) : undefined,
      hasHint: typeof row.has_hint === 'boolean' ? row.has_hint : undefined,
      hintPenalty: row.hint_penalty !== null && row.hint_penalty !== undefined ? Number(row.hint_penalty) : 60,
      tabSwitchPenaltySeconds: row.tab_switch_penalty_seconds !== null && row.tab_switch_penalty_seconds !== undefined
        ? Number(row.tab_switch_penalty_seconds)
        : 15,
      pokemonId: Number(row.pokemon_id ?? 25),
      pokemonName: String(row.pokemon_name ?? 'Pikachu'),
    },
    true
  );
}

function toSupabasePuzzleRow(puzzle: Puzzle): Record<string, unknown> {
  const cleanStartCode = puzzle.startCode ? String(puzzle.startCode).trim() : '';
  return {
    id: Math.max(1, Math.floor(Number(puzzle.id))),
    linkid: String(puzzle.linkid || '').trim().toUpperCase(),
    badge_id: puzzle.badgeId && Number(puzzle.badgeId) > 0 ? Math.floor(Number(puzzle.badgeId)) : null,
    question_python: String(puzzle.questionPython || ''),
    question_cpp: String(puzzle.questionCpp || ''),
    answer: String(puzzle.answer ?? ''),
    next_puzzle_id: Array.isArray(puzzle.nextPuzzleId)
      ? puzzle.nextPuzzleId.map(Number).filter((n) => !Number.isNaN(n) && n > 0)
      : [],
    start_code: cleanStartCode || null,
    requires_start_code: Boolean(cleanStartCode),
    location_clue: String(puzzle.locationClue || ''),
    level: Math.max(1, Math.floor(Number(puzzle.level || 1))),
    points: Math.max(0, Number(puzzle.points ?? 10)),
    hint: puzzle.hint && typeof puzzle.hint === 'string' ? puzzle.hint : null,
    has_hint: Boolean(puzzle.hasHint),
    hint_penalty: puzzle.hintPenalty !== undefined ? Number(puzzle.hintPenalty) : 60,
    tab_switch_penalty_seconds: puzzle.tabSwitchPenaltySeconds !== undefined
      ? Math.max(0, Math.floor(Number(puzzle.tabSwitchPenaltySeconds)))
      : 15,
    pokemon_id: Math.max(0, Math.floor(Number(puzzle.pokemonId ?? 25))),
    pokemon_name: String(puzzle.pokemonName || 'Pikachu'),
    updated_at: new Date().toISOString(),
  };
}

function mapSupabaseMemeRow(row: Record<string, unknown>): MemeEntry {
  return {
    memeid: String(row.memeid || '').trim().toUpperCase(),
    ytlink: String(row.ytlink || '').trim(),
    starttime: Number(row.starttime || 0),
    endtime: Number(row.endtime || 0),
    isCustom: true,
  };
}

function toSupabaseMemeRow(meme: MemeEntry): Record<string, unknown> {
  return {
    memeid: String(meme.memeid || '').trim().toUpperCase(),
    ytlink: String(meme.ytlink || '').trim(),
    starttime: Math.max(0, Math.floor(Number(meme.starttime || 0))),
    endtime: Math.max(0, Math.floor(Number(meme.endtime || 0))),
    updated_at: new Date().toISOString(),
  };
}

// ==========================================
// TEAM AUTHENTICATION & ADMIN CATALOG LOADER
// ==========================================
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(raw: string): boolean {
  return EMAIL_REGEX.test(String(raw || '').trim());
}

export function normalizeEmail(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

export function extractTeamEmails(entry: Partial<TeamEntry>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const pushEmail = (candidate: unknown) => {
    String(candidate ?? '')
      .split(/[,;\n\r\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .forEach((email) => {
        if (EMAIL_REGEX.test(email) && !seen.has(email)) {
          seen.add(email);
          out.push(email);
        }
      });
  };
  pushEmail(entry.email);
  if (Array.isArray(entry.emails)) entry.emails.forEach(pushEmail);
  if (Array.isArray(entry.team_members)) {
    entry.team_members.forEach((m) => {
      if (typeof m === 'string' && m.includes('@')) pushEmail(m);
    });
  }
  return out;
}

let teamsMemoryCache: TeamEntry[] | null = null;
let teamsByEmailLowerCache = new Map<string, TeamEntry>();
let teamsLoadInFlight: Promise<TeamEntry[]> | null = null;
const teamAuthRefreshInFlight = new Set<string>();

function rebuildTeamsIndex(teams: TeamEntry[]): void {
  teamsMemoryCache = teams;
  teamsByEmailLowerCache = new Map();
  teams.forEach((t) => {
    extractTeamEmails(t).forEach((email) => {
      teamsByEmailLowerCache.set(email, t);
    });
  });
}

function mergeBaseTeamsWithOverrides(baseTeams: Partial<TeamEntry>[]): TeamEntry[] {
  const overrides = readLocalOverrides();
  const deletedSet = new Set(overrides.teamsDelete.map((s) => s.toUpperCase()));
  const mergedMap = new Map<string, TeamEntry>();

  baseTeams.forEach((t) => {
    const tid = String(t.tid || '').trim().toUpperCase();
    const team = String(t.team || '').trim();
    if (!tid || !team || deletedSet.has(tid)) return;
    const emails = extractTeamEmails(t);
    mergedMap.set(tid, {
      tid,
      team,
      email: emails[0] || undefined,
      emails,
      securityKey: String(t.securityKey || ''),
      team_members: Array.isArray(t.team_members) ? t.team_members.map(String) : [],
      isCustom: false,
    });
  });

  Object.values(overrides.teamsUpsert).forEach((t) => {
    const tid = String(t.tid || '').trim().toUpperCase();
    if (!tid || deletedSet.has(tid)) return;
    const emails = extractTeamEmails(t);
    mergedMap.set(tid, {
      ...t,
      tid,
      email: emails[0] || undefined,
      emails,
      isCustom: true,
    });
  });

  return Array.from(mergedMap.values()).sort((a, b) =>
    a.tid.localeCompare(b.tid, undefined, { numeric: true })
  );
}

export async function loadMergedTeams(): Promise<TeamEntry[]> {
  if (teamsLoadInFlight) return teamsLoadInFlight;
  teamsLoadInFlight = (async () => {
    try {
      const supabaseClient = isBrowserOnline() ? getSupabaseClient() : null;
      const fetchAllRemoteTeams = async () => {
        if (!supabaseClient) return null;
        const PAGE_SIZE = 1000;
        const rows: Record<string, unknown>[] = [];
        for (let page = 0; page < 20; page++) {
          const from = page * PAGE_SIZE;
          const res = await withPromiseTimeout(
            supabaseClient
              .from('teams')
              .select('tid, team, email, emails, security_key, team_members')
              .order('tid', { ascending: true })
              .range(from, from + PAGE_SIZE - 1),
            2500,
            'Supabase teams'
          );
          if (res.error) return null;
          const chunk = (res.data || []) as Record<string, unknown>[];
          rows.push(...chunk);
          if (chunk.length < PAGE_SIZE) break;
        }
        return rows;
      };

      const [remoteRowsRaw, fetchedTeams] = await Promise.all([
        fetchAllRemoteTeams().catch(() => null),
        fetchJsonSafe<Partial<TeamEntry>[]>('/data/teams.json', []),
      ]);

      const remoteRows =
        Array.isArray(remoteRowsRaw) && remoteRowsRaw.length > 0
          ? remoteRowsRaw.map((row) => mapSupabaseTeamRow(row)).filter((t) => Boolean(t.tid && t.team))
          : [];

      const cachedIdbTeams = (await getSessionStateIdb<TeamEntry[]>('teams_fallback')) || [];
      const hasAuthoritativeRemote = remoteRows.length > 0;
      const baseSource: Partial<TeamEntry>[] = hasAuthoritativeRemote
        ? remoteRows
        : fetchedTeams.length > 0
          ? fetchedTeams
          : cachedIdbTeams;

      const sorted = hasAuthoritativeRemote
        ? remoteRows.sort((a, b) => a.tid.localeCompare(b.tid, undefined, { numeric: true }))
        : mergeBaseTeamsWithOverrides(baseSource);

      if (sorted.length > 0) {
        void setSessionStateIdb('teams_fallback', sorted);
        rebuildTeamsIndex(sorted);
      }
      return teamsMemoryCache || sorted;
    } finally {
      teamsLoadInFlight = null;
    }
  })();
  return teamsLoadInFlight;
}

export function authenticateTeamLocal(emailInput: string): TeamEntry | null {
  const cleanEmail = normalizeEmail(emailInput);
  if (!cleanEmail || !teamsMemoryCache || teamsMemoryCache.length === 0) return null;
  return teamsByEmailLowerCache.get(cleanEmail) || null;
}

async function authenticateTeamFromLocal(emailInput: string): Promise<TeamEntry | null> {
  const cleanEmail = normalizeEmail(emailInput);
  if (!cleanEmail) return null;

  const cachedHit = authenticateTeamLocal(cleanEmail);
  if (cachedHit) return cachedHit;

  const [fetchedTeams, cachedTeams] = await Promise.all([
    fetchJsonSafe<Partial<TeamEntry>[]>('/data/teams.json', []),
    getSessionStateIdb<TeamEntry[]>('teams_fallback'),
  ]);
  const teams = mergeBaseTeamsWithOverrides(
    fetchedTeams.length > 0 ? fetchedTeams : cachedTeams || []
  );
  if (teams.length > 0) rebuildTeamsIndex(teams);
  return authenticateTeamLocal(cleanEmail);
}

/**
 * Authoritative Team Authentication:
 * - Online: Prefers server-side `authenticate_team` RPC (validates key in PostgreSQL without leaking roster keys)
 * - Fallback / Offline: Uses IndexedDB cached team auth verifier or `/data/teams.json`
 */
export async function authenticateTeamCredentials(
  emailInput: string,
  securityKeyInput: string
): Promise<{
  ok: boolean;
  reason?: 'NOT_FOUND' | 'INVALID_KEY' | 'UNAVAILABLE';
  team?: { tid: string; team: string; email: string };
}> {
  const cleanEmail = normalizeEmail(emailInput);
  const cleanKey = String(securityKeyInput || '').trim();
  if (!cleanEmail || !cleanKey) return { ok: false, reason: 'NOT_FOUND' };

  const keyDigest = sha256NormalizedHex(cleanKey);
  const authCacheKey = `auth_team:${cleanEmail}`;

  // 1. Instant IndexedDB verifier hit when key digest matches (0ms network wait on repeat/cached logins)
  const cachedAuth = await getSessionStateIdb<{
    tid: string;
    team: string;
    email: string;
    keyDigest: string;
    verifiedAt?: number;
  }>(authCacheKey);

  const client = isBrowserOnline() ? getSupabaseClient() : null;

  if (cachedAuth && cachedAuth.tid && cachedAuth.team && cachedAuth.keyDigest === keyDigest) {
    if (
      client &&
      Date.now() - (cachedAuth.verifiedAt || 0) > 300_000 &&
      !teamAuthRefreshInFlight.has(authCacheKey)
    ) {
      teamAuthRefreshInFlight.add(authCacheKey);
      void withPromiseTimeout(
        client.rpc('authenticate_team', { p_email: cleanEmail, p_security_key: cleanKey }),
        2200,
        'Background authenticate_team refresh'
      )
        .then((rpcRes) => {
          if (rpcRes.error && isRpcMissingError(rpcRes.error)) {
            return;
          }
          const payload = rpcRes.data as { authorized?: boolean; tid?: string; team?: string } | null;
          if (payload?.authorized && payload.tid && payload.team) {
            void setSessionStateIdb(authCacheKey, {
              tid: payload.tid,
              team: payload.team,
              email: cleanEmail,
              keyDigest,
              verifiedAt: Date.now(),
            }).catch(() => {});
          } else if (payload?.authorized === false) {
            void deleteSessionStateIdb(authCacheKey).catch(() => {});
          }
        })
        .catch(() => {})
        .finally(() => teamAuthRefreshInFlight.delete(authCacheKey));
    }
    return {
      ok: true,
      team: { tid: cachedAuth.tid, team: cachedAuth.team, email: cleanEmail },
    };
  }

  // 2. Online: use one authoritative RPC request; transient failures must not fan out
  // into a second RPC, direct key-bearing query, or full roster download.
  let useLocalFallback = !client;
  if (client) {
    try {
      const rpcRes = await withPromiseTimeout(
        client.rpc('authenticate_team', {
          p_email: cleanEmail,
          p_security_key: cleanKey,
        }),
        4500,
        'Supabase authenticate_team RPC'
      );

      if (rpcRes.error) {
        if (isRpcMissingError(rpcRes.error)) {
          useLocalFallback = true;
        } else {
          return { ok: false, reason: 'UNAVAILABLE' };
        }
      } else if (rpcRes.data && typeof rpcRes.data === 'object') {
        const payload = rpcRes.data as {
          authorized?: boolean;
          reason?: string;
          tid?: string;
          team?: string;
          email?: string;
        };
        if (payload.authorized && payload.tid && payload.team) {
          void setSessionStateIdb(authCacheKey, {
            tid: payload.tid,
            team: payload.team,
            email: cleanEmail,
            keyDigest,
            verifiedAt: Date.now(),
          }).catch(() => {});
          return {
            ok: true,
            team: { tid: payload.tid, team: payload.team, email: cleanEmail },
          };
        }
        if (payload.reason === 'INVALID_KEY') {
          return { ok: false, reason: 'INVALID_KEY' };
        }
        if (payload.reason === 'NOT_FOUND') {
          return { ok: false, reason: 'NOT_FOUND' };
        }
        return { ok: false, reason: 'UNAVAILABLE' };
      } else {
        return { ok: false, reason: 'UNAVAILABLE' };
      }
    } catch {
      return { ok: false, reason: 'UNAVAILABLE' };
    }
  }

  // If offline and cached entry existed with a different key, reject immediately
  if (!client && cachedAuth && cachedAuth.tid && cachedAuth.team) {
    return { ok: false, reason: 'INVALID_KEY' };
  }

  if (!useLocalFallback) return { ok: false, reason: 'UNAVAILABLE' };

  // 3. Offline / pre-RPC fallback uses cached local roster data only.
  const foundTeam = await authenticateTeamFromLocal(cleanEmail);
  if (!foundTeam) {
    return { ok: false, reason: 'UNAVAILABLE' };
  }
  if (standardizeString(cleanKey) !== standardizeString(foundTeam.securityKey)) {
    return { ok: false, reason: 'INVALID_KEY' };
  }
  void setSessionStateIdb(authCacheKey, {
    tid: foundTeam.tid,
    team: foundTeam.team,
    email: cleanEmail,
    keyDigest,
    verifiedAt: Date.now(),
  }).catch(() => {});
  return {
    ok: true,
    team: { tid: foundTeam.tid, team: foundTeam.team, email: cleanEmail },
  };
}

// ==========================================
// TIER 3 META & BULK PUZZLE CATALOG CACHE (INDEXEDDB)
// Static config ALWAYS comes from configService.ts (never Supabase!)
// ==========================================
let lastMetaCheckAt = 0;

export function getLocalGameMeta(): {
  epoch: number;
  catalogVersion: number;
  catalogInitialized: boolean;
} {
  const localEpoch = Math.max(1, Number(localStorage.getItem(STORAGE_KEYS.gameEpoch) || 1));
  const localOverrides = readLocalOverrides();
  return {
    epoch: localEpoch,
    catalogVersion: localOverrides.catalogVersion,
    catalogInitialized: true,
  };
}

export async function fetchGameMeta(): Promise<{
  epoch: number;
  catalogVersion: number;
  catalogInitialized: boolean;
}> {
  const localMeta = getLocalGameMeta();
  const supabaseClient = isBrowserOnline() ? getSupabaseClient() : null;
  if (supabaseClient) {
    try {
      const res = await withPromiseTimeout(
        supabaseClient.from('game_meta').select('epoch, catalog_version').eq('id', 1).maybeSingle(),
        2200,
        'Supabase game_meta'
      );
      if (!res.error && res.data) {
        const remoteEpoch = Number(res.data.epoch || 1);
        const remoteCatalogVer = Number(res.data.catalog_version || 1);
        return {
          epoch: Math.max(
            localMeta.epoch,
            Number.isFinite(remoteEpoch) && remoteEpoch >= 1 ? Math.floor(remoteEpoch) : 1
          ),
          catalogVersion: Math.max(
            localMeta.catalogVersion,
            Number.isFinite(remoteCatalogVer) && remoteCatalogVer >= 1
              ? Math.floor(remoteCatalogVer)
              : 1
          ),
          catalogInitialized: true,
        };
      }
    } catch {
      // fall through cleanly
    }
  }
  return localMeta;
}

export async function fetchServerGameEpoch(force = false): Promise<number> {
  const minInterval = getCacheConfig().metaCheckMinIntervalMs;
  if (!force && lastMetaCheckAt > 0 && Date.now() - lastMetaCheckAt < minInterval) {
    return getLocalGameMeta().epoch;
  }
  lastMetaCheckAt = Date.now();
  const meta = await fetchGameMeta();
  return meta.epoch;
}

/**
 * Hydrates ONLY lightweight navigation summaries from IndexedDB if valid and unexpired.
 * Never makes a Supabase request on cold boot if cache is missing (waits for authorized QR scan or explicit sync)
 * or if cache is still fresh.
 */
export async function readCachedCatalogSummaries(epoch?: number): Promise<{
  summaries: PuzzleSummary[];
  epoch: number;
  catalogVersion: number;
  isValid: boolean;
} | null> {
  const targetEpoch = Math.max(
    1,
    Math.floor(epoch ?? Number(localStorage.getItem(STORAGE_KEYS.gameEpoch) || 1))
  );
  const meta = await getCatalogMetaIdb(targetEpoch);
  if (!meta || !meta.verifiedStorage || meta.puzzleCount <= 0) return null;
  const summaries = await getPuzzleSummariesIdb(targetEpoch);
  if (summaries.length === 0) return null;
  return {
    summaries,
    epoch: meta.epoch,
    catalogVersion: meta.catalogVersion,
    isValid: Date.now() <= meta.expiresAt,
  };
}

/**
 * QR Scan & Bulk Puzzle Retrieval (Section 4):
 * 1. Validates authorized team/session.
 * 2. Checks IndexedDB cache version + TTL (with throttled meta-version check).
 * 3. If valid -> returns cache-first IndexedDB summaries (0 puzzle DB queries!).
 * 4. If stale/missing -> retrieves ALL required puzzles & memes in ONE logical bulk operation
 *    using selective columns/digests, stores in IndexedDB, and verifies readback.
 */
const catalogFetchInFlight = new Map<
  number,
  Promise<{
    summaries: PuzzleSummary[];
    epoch: number;
    catalogVersion: number;
    source: 'indexeddb' | 'supabase' | 'local-fallback';
    verifiedStorage: boolean;
  }>
>();

export async function retrieveAndCacheCatalogOnScan(params: {
  tid: string;
  sessionId: string;
  epoch: number;
  forceRefresh?: boolean;
}): Promise<{
  summaries: PuzzleSummary[];
  epoch: number;
  catalogVersion: number;
  source: 'indexeddb' | 'supabase' | 'local-fallback';
  verifiedStorage: boolean;
}> {
  const cleanTid = String(params.tid || '').trim().toUpperCase();
  if (!cleanTid) {
    throw new Error('Authorized team session required before retrieving puzzles.');
  }

  const cacheCfg = getCacheConfig();
  const targetEpoch = Math.max(1, Math.floor(params.epoch || 1));
  const expectedVersion: number | undefined = undefined;
  const now = Date.now();
  const existingMeta = await getCatalogMetaIdb(targetEpoch);

  // True 0ms Cache-First path: if valid catalog already lives in IndexedDB, return immediately
  // and check game_meta version silently in the background without blocking QR scan UX!
  if (!params.forceRefresh && existingMeta && (await hasValidCatalogInIdb(targetEpoch))) {
    const summaries = await getPuzzleSummariesIdb(targetEpoch);
    if (summaries.length > 0) {
      if (isBrowserOnline() && now - lastMetaCheckAt >= cacheCfg.metaCheckMinIntervalMs) {
        lastMetaCheckAt = now;
        void fetchGameMeta()
          .then((meta) => {
            if (meta.epoch > targetEpoch || meta.catalogVersion > existingMeta.catalogVersion) {
              void retrieveAndCacheCatalogOnScan({
                tid: cleanTid,
                sessionId: params.sessionId,
                epoch: meta.epoch,
                forceRefresh: true,
              });
            }
          })
          .catch(() => {});
      }
      return {
        summaries,
        epoch: existingMeta.epoch,
        catalogVersion: existingMeta.catalogVersion,
        source: 'indexeddb',
        verifiedStorage: existingMeta.verifiedStorage,
      };
    }
  }

  // Offline fallback: read existing IndexedDB or hydrate from SW-precached local JSON bundle
  if (!isBrowserOnline()) {
    const offlineSummaries = await getPuzzleSummariesIdb(targetEpoch);
    if (offlineSummaries.length > 0) {
      return {
        summaries: offlineSummaries,
        epoch: targetEpoch,
        catalogVersion: existingMeta?.catalogVersion || 1,
        source: 'indexeddb',
        verifiedStorage: Boolean(existingMeta?.verifiedStorage),
      };
    }

    const [rawPuzzles, rawMemes] = await Promise.all([
      fetchJsonSafe<Partial<Puzzle>[]>('/data/puzzle.json', []),
      fetchJsonSafe<Partial<MemeEntry>[]>('/data/meme.json', []),
    ]);
    const localPuzzles = rawPuzzles.map((p) => normalizeLoadedPuzzle(p, false));
    if (localPuzzles.length > 0) {
      const localMemes: MemeEntry[] = rawMemes
        .map((m) => ({
          memeid: String(m.memeid || '').trim().toUpperCase(),
          ytlink: String(m.ytlink || '').trim(),
          starttime: Number(m.starttime || 0),
          endtime: Number(m.endtime || 0),
        }))
        .filter((m) => Boolean(m.memeid && m.ytlink));

      const storeResult = await storeBulkCatalogIdb({
        epoch: targetEpoch,
        catalogVersion: existingMeta?.catalogVersion || 1,
        puzzles: localPuzzles,
        memes: localMemes,
        teamTid: cleanTid,
        ttlMs: cacheCfg.catalogTtlMs,
      });
      const localSummaries = await getPuzzleSummariesIdb(targetEpoch);
      if (localSummaries.length > 0) {
        return {
          summaries: localSummaries,
          epoch: targetEpoch,
          catalogVersion: existingMeta?.catalogVersion || 1,
          source: 'local-fallback',
          verifiedStorage: storeResult.verified,
        };
      }
    }

    throw new Error('Offline with no cached puzzle dataset. Reconnect and scan again.');
  }

  if (!params.forceRefresh) {
    const inFlight = catalogFetchInFlight.get(targetEpoch);
    if (inFlight) return inFlight;
  }

  lastMetaCheckAt = now;
  activeCatalogSyncCount += 1;
  void refreshSyncStatus();

  const runFetch = (async () => {
    try {
      // ONE logical bulk retrieval from Supabase (selective columns + digests)
      const supabaseClient = getSupabaseClient();
      let fetchedPuzzles: Puzzle[] = [];
      let fetchedMemes: MemeEntry[] = [];
      let resolvedEpoch = targetEpoch;
      let resolvedVersion = expectedVersion || 1;
      let source: 'supabase' | 'local-fallback' = 'supabase';
      let catalogRpcMissing = false;
      let catalogRpcSucceeded = false;
      let catalogRpcFailed = false;

      if (supabaseClient) {
        // 1st choice: Single authorized RPC returning selective columns + answer_digest + memes
        try {
            const rpcRes = await withPromiseTimeout(
              supabaseClient.rpc('get_authorized_puzzle_catalog', {
                p_tid: cleanTid,
                p_session_id: params.sessionId || '',
              }),
              3500,
              'Supabase bulk puzzle catalog RPC'
            );

            if (!rpcRes.error && rpcRes.data && typeof rpcRes.data === 'object') {
              catalogRpcSucceeded = true;
              const data = rpcRes.data as {
                epoch?: number;
                catalogVersion?: number;
                puzzles?: Record<string, unknown>[];
                memes?: Record<string, unknown>[];
              };
              resolvedEpoch = Math.max(resolvedEpoch, Number(data.epoch || 1));
              resolvedVersion = Math.max(resolvedVersion, Number(data.catalogVersion || 1));
              if (Array.isArray(data.puzzles) && data.puzzles.length > 0) {
                fetchedPuzzles = data.puzzles.map((p) => normalizeLoadedPuzzle(p as Partial<Puzzle>, true));
              }
              if (Array.isArray(data.memes)) {
                fetchedMemes = data.memes
                  .map((m) => ({
                    memeid: String(m.memeid || '').trim().toUpperCase(),
                    ytlink: String(m.ytlink || '').trim(),
                    starttime: Number(m.starttime || 0),
                    endtime: Number(m.endtime || 0),
                    isCustom: true,
                  }))
                  .filter((m) => Boolean(m.memeid && m.ytlink));
              }
            } else if (rpcRes.error) {
              if (isRpcMissingError(rpcRes.error)) {
                catalogRpcMissing = true;
              } else {
                catalogRpcFailed = true;
                console.warn('[Catalog] Authorized catalog RPC failed:', rpcRes.error);
              }
            }
        } catch (rpcErr) {
          catalogRpcFailed = true;
          console.warn('[Catalog] Authorized catalog RPC failed:', rpcErr);
        }
      }

      // Fallback to local JSON bundle ONLY if DB returned nothing (e.g. fresh local setup)
      if (fetchedPuzzles.length === 0) {
        source = 'local-fallback';
        const [rawPuzzles, rawMemes] = await Promise.all([
          fetchJsonSafe<Partial<Puzzle>[]>('/data/puzzle.json', []),
          fetchJsonSafe<Partial<MemeEntry>[]>('/data/meme.json', []),
        ]);
        fetchedPuzzles = rawPuzzles.map((p) => normalizeLoadedPuzzle(p, false));
        fetchedMemes = rawMemes
          .map((m) => ({
            memeid: String(m.memeid || '').trim().toUpperCase(),
            ytlink: String(m.ytlink || '').trim(),
            starttime: Number(m.starttime || 0),
            endtime: Number(m.endtime || 0),
          }))
          .filter((m) => Boolean(m.memeid && m.ytlink));
      }

      if (fetchedPuzzles.length === 0) {
        if (supabaseClient && catalogRpcMissing) {
          throw new Error('Supabase catalog setup is incomplete. Run supabase/schema.sql, then supabase/seed.sql.');
        }
        if (supabaseClient && catalogRpcSucceeded) {
          throw new Error('The Supabase puzzle catalog is empty. Run supabase/seed.sql, then retry.');
        }
        if (supabaseClient && catalogRpcFailed) {
          throw new Error('Could not load the puzzle catalog from Supabase. Check the connection and try again.');
        }
        throw new Error('No puzzle catalog is available. Add puzzle rows to Supabase and retry.');
      }

      // Persist into IndexedDB and verify storage readback
      const storeResult = await storeBulkCatalogIdb({
        epoch: resolvedEpoch,
        catalogVersion: resolvedVersion,
        puzzles: fetchedPuzzles,
        memes: fetchedMemes,
        teamTid: cleanTid,
        ttlMs: cacheCfg.catalogTtlMs,
      });

      if (!storeResult.verified) {
        throw new Error('Failed to verify puzzle catalog storage in IndexedDB.');
      }

      // Release heavyweight puzzle array references immediately after IndexedDB persistence;
      // return ONLY lightweight PuzzleSummary[] for navigation graph checks
      const summaries = await getPuzzleSummariesIdb(resolvedEpoch);
      return {
        summaries,
        epoch: resolvedEpoch,
        catalogVersion: resolvedVersion,
        source,
        verifiedStorage: storeResult.verified,
      };
    } finally {
      catalogFetchInFlight.delete(targetEpoch);
      activeCatalogSyncCount = Math.max(0, activeCatalogSyncCount - 1);
      void refreshSyncStatus();
    }
  })();

  catalogFetchInFlight.set(targetEpoch, runFetch);
  return runFetch;
}

// Cache-first single-item lookups (ZERO Supabase requests)
export async function getCachedPuzzleById(epoch: number, id: number): Promise<Puzzle | null> {
  return getPuzzleByIdIdb(epoch, id);
}

export async function getCachedPuzzleByLinkId(
  epoch: number,
  linkid: string
): Promise<Puzzle | null> {
  return getPuzzleByLinkIdIdb(epoch, linkid);
}

export async function getCachedNextPuzzles(
  epoch: number,
  puzzle: Puzzle | PuzzleSummary | null
): Promise<Puzzle[]> {
  if (!puzzle || !Array.isArray(puzzle.nextPuzzleId) || puzzle.nextPuzzleId.length === 0) {
    return [];
  }
  return getPuzzlesByIdsIdb(epoch, puzzle.nextPuzzleId);
}

export async function getCachedMemeById(epoch: number, memeid: string): Promise<MemeEntry | null> {
  return getMemeByIdIdb(epoch, memeid);
}

// Admin Studio Catalog Loader (Admin-only; loads full editable objects via secure RPC first)
export async function loadAdminCatalog(adminKey?: string): Promise<{
  puzzles: Puzzle[];
  teams: TeamEntry[];
  memes: MemeEntry[];
  config: GameConfig;
  catalogInitialized: boolean;
}> {
  const overrides = readLocalOverrides();
  const supabaseClient = isBrowserOnline() ? getSupabaseClient() : null;
  const adminCreds = getStoredAdminCredentials(adminKey);

  if (supabaseClient && adminCreds && !unavailableRpcs.has('admin_get_catalog')) {
    try {
      const rpcRes = await withPromiseTimeout(
        supabaseClient.rpc('admin_get_catalog', {
          p_email: adminCreds.email,
          p_password: adminCreds.password,
        }),
        6000,
        'Supabase admin_get_catalog RPC'
      );
      if (!rpcRes.error && rpcRes.data && typeof rpcRes.data === 'object') {
        const payload = rpcRes.data as {
          teams?: Record<string, unknown>[];
          puzzles?: Record<string, unknown>[];
          memes?: Record<string, unknown>[];
        };
        const remoteTeams = Array.isArray(payload.teams)
          ? payload.teams
              .map((row) => mapSupabaseTeamRow(row))
              .filter((t) => Boolean(t.tid && t.team))
              .sort((a, b) => a.tid.localeCompare(b.tid, undefined, { numeric: true }))
          : [];
        const remoteMemes = Array.isArray(payload.memes)
          ? payload.memes
              .map((row) => mapSupabaseMemeRow(row))
              .filter((m) => Boolean(m.memeid && m.ytlink))
              .sort((a, b) => a.memeid.localeCompare(b.memeid, undefined, { numeric: true }))
          : [];
        const remotePuzzles = Array.isArray(payload.puzzles)
          ? payload.puzzles
              .map((row) => mapSupabasePuzzleRow(row, true))
              .filter((p) => Boolean(p.id && p.linkid))
              .sort((a, b) => a.id - b.id)
          : [];

        if (remoteTeams.length > 0) {
          rebuildTeamsIndex(remoteTeams);
        }

        if (remoteTeams.length > 0 || remotePuzzles.length > 0 || remoteMemes.length > 0) {
          return {
            puzzles: remotePuzzles,
            teams: remoteTeams,
            memes: remoteMemes,
            config: getGameConfig(),
            catalogInitialized: true,
          };
        }
      }
      if (rpcRes.error) {
        if (isRpcMissingError(rpcRes.error)) {
          markRpcUnavailable('admin_get_catalog');
        } else {
          throw new Error(rpcRes.error.message);
        }
      }
    } catch (err) {
      if (err instanceof Error && /unauthorized/i.test(err.message)) {
        throw err;
      }
    }
  }

  const [rawMemes, rawPuzzles, teams, remoteMemesRes, remotePuzzlesRes] = await Promise.all([
    fetchJsonSafe<Partial<MemeEntry>[] | null>('/data/meme.json', null),
    fetchJsonSafe<Partial<Puzzle>[] | null>('/data/puzzle.json', null),
    loadMergedTeams(),
    supabaseClient
      ? withPromiseTimeout(
          supabaseClient.from('memes').select('memeid,ytlink,starttime,endtime'),
          4000,
          'Supabase admin memes'
        ).catch(() => null)
      : Promise.resolve(null),
    supabaseClient
      ? withPromiseTimeout(
          supabaseClient
            .from('puzzles')
            .select(
              'id,linkid,badge_id,question_python,question_cpp,answer,next_puzzle_id,start_code,requires_start_code,location_clue,level,points,hint,has_hint,hint_penalty,tab_switch_penalty_seconds,pokemon_id,pokemon_name'
            ),
          4000,
          'Supabase admin puzzles'
        ).catch(() => null)
      : Promise.resolve(null),
  ]);

  const remoteMemes =
    remoteMemesRes && !remoteMemesRes.error && Array.isArray(remoteMemesRes.data)
      ? remoteMemesRes.data
          .map((row) => mapSupabaseMemeRow(row as Record<string, unknown>))
          .filter((m) => Boolean(m.memeid && m.ytlink))
      : [];

  const memeSource = remoteMemes.length > 0 ? remoteMemes : (rawMemes ?? []);
  const deletedMemes = new Set(overrides.memesDelete.map((m) => m.toUpperCase()));
  const memesMap = new Map<string, MemeEntry>();
  memeSource.forEach((m) => {
    const memeid = String(m.memeid || '').trim().toUpperCase();
    const ytlink = String(m.ytlink || '').trim();
    if (!memeid || !ytlink) return;
    if (remoteMemes.length === 0 && deletedMemes.has(memeid)) return;
    memesMap.set(memeid, {
      memeid,
      ytlink,
      starttime: Number(m.starttime || 0),
      endtime: Number(m.endtime || 0),
      isCustom: Boolean(m.isCustom),
    });
  });

  const remotePuzzles =
    remotePuzzlesRes && !remotePuzzlesRes.error && Array.isArray(remotePuzzlesRes.data)
      ? remotePuzzlesRes.data
          .map((row) => mapSupabasePuzzleRow(row as Record<string, unknown>, true))
          .filter((p) => Boolean(p.id && p.linkid))
      : [];

  const puzzleSource = remotePuzzles.length > 0 ? remotePuzzles : (rawPuzzles ?? []);
  const deletedPuzzles = new Set(overrides.puzzlesDelete);
  const puzzlesMap = new Map<number, Puzzle>();
  puzzleSource.forEach((p) => {
    const norm = normalizeLoadedPuzzle(p, Boolean(p.isCustom));
    if (remotePuzzles.length === 0 && deletedPuzzles.has(norm.id)) return;
    puzzlesMap.set(norm.id, norm);
  });

  return {
    puzzles: Array.from(puzzlesMap.values()).sort((a, b) => a.id - b.id),
    teams,
    memes: Array.from(memesMap.values()).sort((a, b) =>
      a.memeid.localeCompare(b.memeid, undefined, { numeric: true })
    ),
    config: getGameConfig(),
    catalogInitialized: true,
  };
}

// ==========================================
// SESSION, NOTEBOOK & PROGRESS CACHE (IndexedDB + Fast Memory Map)
// ==========================================
export interface RememberedTeamInfo {
  email?: string;
  teamName: string;
  tid: string;
  mission: string;
  language: LanguageCode;
}

export interface SavedGameState {
  currentStep: StepId;
  currentTeam: string;
  currentTeamTid: string;
  currentMissionLevel: string;
  currentLanguage: LanguageCode;
  sessionId: string;
  tabSwitchCount: number;
  currentPuzzleId: number | null;
}

let activeRememberedTeam: RememberedTeamInfo | null = null;
let activeSavedGameState: Partial<SavedGameState> = {};
const activeProgressMap = new Map<string, TeamProgressDoc>();
const activeNotebookMap = new Map<string, Record<string, PuzzleNotebookEntry>>();
const activeHintMap = new Set<string>();

export async function hydrateSessionFromIndexedDb(epoch: number): Promise<{
  rememberedTeam: RememberedTeamInfo | null;
  savedState: Partial<SavedGameState>;
  latestRegistration: CachedRegistrationRecord | null;
  recoveredSubmissions: number;
}> {
  await openCacheDb();
  void recoverStuckSyncingSubmissionsIdb().then((count) => {
    if (count > 0) void refreshSyncStatus();
  });

  const [remembered, saved, latestReg, storedHints] = await Promise.all([
    getSessionStateIdb<RememberedTeamInfo>('remembered_team'),
    getSessionStateIdb<Partial<SavedGameState>>('active_session'),
    getLatestRegistrationRecordIdb(epoch),
    getSessionStateIdb<string[]>('hint_used_keys'),
  ]);

  if (remembered) activeRememberedTeam = remembered;
  if (saved) activeSavedGameState = saved;
  if (Array.isArray(storedHints)) {
    storedHints.forEach((k) => activeHintMap.add(k));
  }

  if (remembered?.tid) {
    const tidKey = remembered.tid.toUpperCase();
    const [prog, nb] = await Promise.all([
      getSessionStateIdb<TeamProgressDoc>(`progress:${tidKey}`),
      getSessionStateIdb<Record<string, PuzzleNotebookEntry>>(`notebook:${tidKey}`),
    ]);
    if (prog && prog.epoch === epoch) {
      activeProgressMap.set(tidKey, prog);
    }
    if (nb) {
      activeNotebookMap.set(tidKey, nb);
    }
  }

  void refreshSyncStatus();
  return {
    rememberedTeam: activeRememberedTeam,
    savedState: activeSavedGameState,
    latestRegistration: latestReg,
    recoveredSubmissions: 0,
  };
}

export function getRememberedTeamInfo(): RememberedTeamInfo | null {
  return activeRememberedTeam;
}

export function saveRememberedTeamInfo(info: RememberedTeamInfo): void {
  activeRememberedTeam = info;
  void setSessionStateIdb('remembered_team', info);
}

export function getSavedGameState(): Partial<SavedGameState> {
  return activeSavedGameState;
}

export function saveGameStateLocal(state: SavedGameState): void {
  activeSavedGameState = state;
  void setSessionStateIdb('active_session', state);
}

export function clearGameStateLocal(): void {
  activeSavedGameState = {};
  void deleteSessionStateIdb('active_session');
}

export function getTeamScoreStateLocal(teamKey: string): {
  score: number;
  solved: number[];
  unlocked: number[];
  hintsUsed: number[];
} {
  const prog = activeProgressMap.get(teamKey.toUpperCase());
  if (!prog) return { score: 0, solved: [], unlocked: [], hintsUsed: [] };
  return {
    score: Number(prog.score || 0),
    solved: Array.isArray(prog.solved) ? prog.solved.map(Number) : [],
    unlocked: Array.isArray(prog.unlocked) ? prog.unlocked.map(Number) : [],
    hintsUsed: Array.isArray(prog.hintsUsed) ? prog.hintsUsed.map(Number) : [],
  };
}

export function saveTeamScoreStateLocal(
  teamKey: string,
  state: { score: number; solved: number[]; unlocked: number[]; hintsUsed: number[] }
): void {
  if (!teamKey) return;
  const cleanTid = teamKey.toUpperCase();
  const prev = activeProgressMap.get(cleanTid);
  if (prev) {
    const next: TeamProgressDoc = {
      ...prev,
      score: state.score,
      solved: state.solved,
      unlocked: state.unlocked,
      hintsUsed: state.hintsUsed,
      updatedAt: new Date().toISOString(),
    };
    activeProgressMap.set(cleanTid, next);
    void setSessionStateIdb(`progress:${cleanTid}`, next);
  }
}

export function getHintUsedLocal(teamName: string, puzzleId: number): boolean {
  return activeHintMap.has(`${teamName}_${puzzleId}`);
}

export function saveHintUsedLocal(teamName: string, puzzleId: number): void {
  if (!teamName || !puzzleId) return;
  activeHintMap.add(`${teamName}_${puzzleId}`);
  void setSessionStateIdb('hint_used_keys', Array.from(activeHintMap));
}

export function getPuzzleNotebook(teamKey: string): Record<string, PuzzleNotebookEntry> {
  return activeNotebookMap.get(teamKey.toUpperCase()) || {};
}

export function savePuzzleNotebook(
  teamKey: string,
  notebook: Record<string, PuzzleNotebookEntry>
): void {
  const cleanTid = teamKey.toUpperCase();
  activeNotebookMap.set(cleanTid, notebook);
  void setSessionStateIdb(`notebook:${cleanTid}`, notebook);
}

export function deletePuzzleNotebookEntry(teamKey: string, puzzleId: number): void {
  const nb = { ...getPuzzleNotebook(teamKey) };
  delete nb[String(puzzleId)];
  savePuzzleNotebook(teamKey, nb);
}

export function createNotebookEntry(
  notebook: Record<string, PuzzleNotebookEntry>,
  puzzle: PuzzleSummary
): PuzzleNotebookEntry {
  const entry: PuzzleNotebookEntry = {
    puzzleId: puzzle.id,
    linkid: puzzle.linkid,
    level: puzzle.level,
    startedAt: Date.now(),
    unlockedAt: null,
    scanCount: 0,
    wrongAttempts: 0,
    hintsUsed: 0,
    tabSwitches: 0,
    solvedAt: null,
    dirty: false,
    lastActivityAt: Date.now(),
  };
  notebook[String(puzzle.id)] = entry;
  return entry;
}

export function notepadStartLocal(teamKey: string, puzzle: PuzzleSummary | null): void {
  if (!teamKey || !puzzle) return;
  const nb = { ...getPuzzleNotebook(teamKey) };
  const key = String(puzzle.id);
  const n = nb[key] ? { ...nb[key] } : createNotebookEntry(nb, puzzle);
  n.unlockedAt = n.unlockedAt || Date.now();
  n.lastActivityAt = Date.now();
  n.dirty = true;
  nb[key] = n;
  savePuzzleNotebook(teamKey, nb);
}

export function notepadBumpLocal(
  teamKey: string,
  field: 'scan' | 'wrong' | 'hint' | 'tabswitch',
  puzzle: PuzzleSummary | null
): PuzzleNotebookEntry | null {
  if (!teamKey || !puzzle) return null;
  const nb = { ...getPuzzleNotebook(teamKey) };
  const key = String(puzzle.id);
  const n = nb[key] ? { ...nb[key] } : createNotebookEntry(nb, puzzle);
  if (field === 'scan') n.scanCount += 1;
  else if (field === 'wrong') n.wrongAttempts += 1;
  else if (field === 'hint') n.hintsUsed += 1;
  else if (field === 'tabswitch') n.tabSwitches += 1;
  n.lastActivityAt = Date.now();
  n.dirty = true;
  nb[key] = n;
  savePuzzleNotebook(teamKey, nb);
  return n;
}

export function wipeAllLocalGameStorage(newEpoch?: number, includeCatalogOverrides = false): void {
  activeSavedGameState = {};
  activeProgressMap.clear();
  activeNotebookMap.clear();
  activeHintMap.clear();
  if (includeCatalogOverrides) {
    activeRememberedTeam = null;
    teamsMemoryCache = null;
    teamsByEmailLowerCache.clear();
    localStorage.removeItem(STORAGE_KEYS.localCatalogOverrides);
  }
  const targetEpoch = typeof newEpoch === 'number' && newEpoch >= 1 ? newEpoch : 1;
  localStorage.setItem(STORAGE_KEYS.gameEpoch, String(targetEpoch));
  void clearEpochProgressInIdb(targetEpoch, includeCatalogOverrides);
  void refreshSyncStatus();
}

export function wipeLocalSolvedDataOnly(newEpoch?: number): void {
  activeNotebookMap.clear();
  activeHintMap.clear();
  activeProgressMap.forEach((doc, key) => {
    activeProgressMap.set(key, {
      ...doc,
      score: 0,
      solved: [],
      unlocked: [],
      hintsUsed: [],
      currentPuzzle: 0,
      tabSwitches: 0,
      epoch: typeof newEpoch === 'number' && newEpoch >= 1 ? newEpoch : doc.epoch,
      updatedAt: new Date().toISOString(),
    });
  });
  const targetEpoch =
    typeof newEpoch === 'number' && newEpoch >= 1
      ? newEpoch
      : Math.max(1, Number(localStorage.getItem(STORAGE_KEYS.gameEpoch) || 1));
  localStorage.setItem(STORAGE_KEYS.gameEpoch, String(targetEpoch));
  void clearEpochProgressInIdb(targetEpoch, false);
  void refreshSyncStatus();
}

// ==========================================
// SECTION 3: REGISTRATION CACHE SYSTEM (IndexedDB-first, Explicit Sync)
// ==========================================
function buildRegistrationId(tidOrDraft: string, epoch: number): string {
  const clean = String(tidOrDraft || 'draft').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
  return `reg_${clean}_ep${Math.max(1, Math.floor(epoch))}`;
}

/**
 * Validates and persists registration form draft locally into IndexedDB.
 * NEVER sends registration data to Supabase on input changes!
 */
export async function saveRegistrationDraftLocal(params: {
  email: string;
  language: LanguageCode;
  mission: string;
  sessionId: string;
  epoch: number;
  hasSecurityKey: boolean;
}): Promise<CachedRegistrationRecord | null> {
  const cleanEmail = normalizeEmail(params.email);
  const valid = isValidEmail(cleanEmail) && Boolean(params.language) && Boolean(params.mission);
  if (!valid) return null;

  const existing = await getLatestRegistrationRecordIdb(params.epoch);
  // Do not overwrite an already-pending/failed/synced team registration record with a plain draft
  if (
    existing &&
    existing.email === cleanEmail &&
    (existing.status === 'synced' ||
      existing.status === 'syncing' ||
      existing.status === 'pending' ||
      existing.status === 'failed')
  ) {
    if (existing.language !== params.language || existing.mission !== params.mission) {
      const updated = await saveRegistrationRecordIdb({
        ...existing,
        language: params.language,
        mission: params.mission,
        updatedAt: Date.now(),
      });
      await refreshSyncStatus();
      return updated;
    }
    return existing;
  }

  const now = Date.now();
  const draftId = buildRegistrationId(`DRAFT_${sha256NormalizedHex(cleanEmail).slice(0, 10)}`, params.epoch);
  const record: CachedRegistrationRecord = {
    registrationId: draftId,
    tid: existing?.email === cleanEmail ? existing.tid : '',
    teamName: existing?.email === cleanEmail ? existing.teamName : '',
    email: cleanEmail,
    language: params.language,
    mission: params.mission,
    sessionId: params.sessionId,
    epoch: Math.max(1, Math.floor(params.epoch || 1)),
    isValidated: params.hasSecurityKey && valid,
    status: 'draft',
    retryCount: 0,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await saveRegistrationRecordIdb(record);
  await refreshSyncStatus();
  return record;
}

function buildSupabaseProgressRow(progress: TeamProgressDoc): Record<string, unknown> {
  return {
    tid: String(progress.tid || '').trim().toUpperCase(),
    team_name: String(progress.teamName || '').trim(),
    email: progress.email ? normalizeEmail(progress.email) : null,
    mission: String(progress.mission || ''),
    language: String(progress.language || 'PYTHON'),
    session_id: String(progress.sessionId || ''),
    score: Number(progress.score || 0),
    solved: Array.isArray(progress.solved) ? progress.solved.map(Number) : [],
    unlocked: Array.isArray(progress.unlocked) ? progress.unlocked.map(Number) : [],
    hints_used: Array.isArray(progress.hintsUsed) ? progress.hintsUsed.map(Number) : [],
    current_puzzle: Math.max(0, Math.floor(Number(progress.currentPuzzle || 0))),
    tab_switches: Math.max(0, Math.floor(Number(progress.tabSwitches || 0))),
    epoch: Math.max(1, Math.floor(Number(progress.epoch || 1))),
    registered_at: progress.registeredAt || new Date().toISOString(),
    updated_at: progress.updatedAt || new Date().toISOString(),
  };
}

function toLevelTag(levelNum: number | string | undefined): 'REG' | 'L1' | 'L2' | 'L3' {
  const raw = String(levelNum ?? '').toUpperCase().trim();
  if (raw === 'REG') return 'REG';
  if (raw === 'L1' || raw === '1') return 'L1';
  if (raw === 'L2' || raw === '2') return 'L2';
  if (raw === 'L3' || raw === '3') return 'L3';
  const digits = raw.replace(/\D/g, '');
  if (digits === '2') return 'L2';
  if (digits === '3') return 'L3';
  return 'L1';
}

function toNumericLevel(levelNum: number | string | undefined, mission?: string): number {
  const tag = toLevelTag(levelNum || mission);
  if (tag === 'L2') return 2;
  if (tag === 'L3') return 3;
  return 1;
}

async function dispatchRegistrationRecordToSupabase(
  reg: CachedRegistrationRecord,
  teamProgress: TeamProgressDoc
): Promise<{
  epoch: number;
  teamState: Partial<TeamProgressDoc> | null;
}> {
  const client = getSupabaseClient();
  if (!client || !isBrowserOnline()) {
    throw new Error('Offline — registration saved locally in IndexedDB and queued for sync.');
  }

  // 1. Prefer idempotent PostgreSQL RPC (skip if known unmigrated)
  if (!unavailableRpcs.has('sync_registration_record')) {
    try {
      const rpcRes = await withPromiseTimeout(
        client.rpc('sync_registration_record', {
          p_registration_id: reg.registrationId,
          p_tid: reg.tid,
          p_team_name: reg.teamName,
          p_email: reg.email,
          p_mission: reg.mission,
          p_language: toFirestoreLanguage(reg.language),
          p_session_id: reg.sessionId,
          p_client_epoch: reg.epoch,
        }),
        3500,
        'Supabase sync_registration_record RPC'
      );

      if (!rpcRes.error && rpcRes.data && typeof rpcRes.data === 'object') {
        lastMetaCheckAt = Date.now();
        const data = rpcRes.data as {
          epoch?: number;
          teamState?: {
            score?: number;
            solved?: number[];
            unlocked?: number[];
            hintsUsed?: number[];
            tabSwitches?: number;
            currentPuzzle?: number;
          };
        };
        return {
          epoch: Math.max(1, Math.floor(Number(data.epoch || reg.epoch))),
          teamState: data.teamState || null,
        };
      }
      if (rpcRes.error) {
        if (isRpcMissingError(rpcRes.error)) {
          markRpcUnavailable('sync_registration_record');
        } else {
          throw new Error(rpcRes.error.message);
        }
      }
    } catch (err) {
      if (!unavailableRpcs.has('sync_registration_record')) {
        throw err;
      }
    }
  }

  // 2. Fallback (if RPC not yet installed in Supabase SQL Editor)
  const [metaRes, progRes] = await withPromiseTimeout(
    Promise.all([
      client.from('game_meta').select('epoch').eq('id', 1).maybeSingle(),
      client.from('team_progress').select('*').eq('tid', reg.tid).maybeSingle(),
    ]),
    3500,
    'Supabase registration fallback check'
  );
  if (metaRes.error) throw new Error(metaRes.error.message);
  if (progRes.error) throw new Error(progRes.error.message);

  const remoteEpoch = Math.max(1, Math.floor(Number(metaRes.data?.epoch || reg.epoch)));
  const remoteProgRow = progRes.data as Record<string, unknown> | null;
  const remoteSameEpoch =
    remoteProgRow && Number(remoteProgRow.epoch || 1) === remoteEpoch
      ? {
          score: Number(remoteProgRow.score || 0),
          solved: Array.isArray(remoteProgRow.solved) ? remoteProgRow.solved.map(Number) : [],
          unlocked: Array.isArray(remoteProgRow.unlocked) ? remoteProgRow.unlocked.map(Number) : [],
          hintsUsed: Array.isArray(remoteProgRow.hints_used)
            ? remoteProgRow.hints_used.map(Number)
            : [],
          tabSwitches: Number(remoteProgRow.tab_switches || 0),
          currentPuzzle: Number(remoteProgRow.current_puzzle || 0),
        }
      : null;

  const nowIso = new Date().toISOString();
  const ops: PromiseLike<{ error: { message: string } | null }>[] = [];

  if (!remoteSameEpoch) {
    ops.push(
      client
        .from('team_progress')
        .upsert(buildSupabaseProgressRow({ ...teamProgress, epoch: remoteEpoch }), {
          onConflict: 'tid',
        })
    );
  } else {
    ops.push(
      client
        .from('team_progress')
        .update({
          team_name: reg.teamName,
          email: reg.email,
          mission: reg.mission,
          language: toFirestoreLanguage(reg.language),
          session_id: reg.sessionId,
          updated_at: nowIso,
        })
        .eq('tid', reg.tid)
    );
  }

  ops.push(
    client.from('puzzle_logs').upsert(
      {
        id: `reg_${reg.tid}`,
        action: 'REGISTRATION',
        level: 'REG',
        tid: reg.tid,
        team_name: reg.teamName,
        email: reg.email,
        mission: reg.mission,
        language: toFirestoreLanguage(reg.language),
        session_id: reg.sessionId,
        puzzle_id: 0,
        linkid: '',
        status: 'REGISTERED',
        total_score: remoteSameEpoch?.score ?? teamProgress.score,
        unlocked_puzzles: (remoteSameEpoch?.unlocked ?? teamProgress.unlocked).join(','),
        solved_puzzles: (remoteSameEpoch?.solved ?? teamProgress.solved).join(','),
        epoch: remoteEpoch,
        client_timestamp: nowIso,
        last_active: nowIso,
        registered_at: teamProgress.registeredAt || nowIso,
      },
      { onConflict: 'id' }
    )
  );

  const results = await withPromiseTimeout(Promise.all(ops), 6000, 'Supabase registration upsert');
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);

  return { epoch: remoteEpoch, teamState: remoteSameEpoch };
}

/**
 * Explicit Registration Submission & Sync (Section 3):
 * 1. Validates fields & authenticates team.
 * 2. Saves validated registration in IndexedDB with unique registrationId ('pending').
 * 3. Sends registration to Supabase on button click ('syncing').
 * 4. Waits for explicit DB confirmation -> updates IndexedDB to 'synced' (or 'failed' while preserving local data!).
 */
export async function submitAndSyncRegistration(params: {
  tid: string;
  teamName: string;
  email: string;
  mission: string;
  language: LanguageCode;
  sessionId: string;
  puzzles: PuzzleSummary[];
  epoch: number;
  onLocalReady?: (local: { epoch: number; teamProgress: TeamProgressDoc }) => void;
}): Promise<{
  epoch: number;
  registration: CachedRegistrationRecord;
  teamProgress: TeamProgressDoc;
  synced: boolean;
  syncError?: string;
}> {
  const cleanTid = params.tid.trim().toUpperCase().slice(0, 32);
  const cleanTeam = params.teamName.trim().slice(0, 60);
  const cleanEmail = normalizeEmail(params.email).slice(0, 120);
  const cleanMission = params.mission.trim().slice(0, 40);
  const fsLang = toFirestoreLanguage(params.language);
  const localEpoch = Math.max(1, Math.floor(params.epoch || 1));
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  localStorage.setItem(STORAGE_KEYS.gameEpoch, String(localEpoch));

  const registrationId = buildRegistrationId(cleanTid, localEpoch);
  const existingReg = await getRegistrationByIdIdb(registrationId);

  const starterUnlocked = computeLocalUnlocked(params.puzzles, []);
  const storedProg = await getSessionStateIdb<TeamProgressDoc>(`progress:${cleanTid}`);
  const sameEpochProg = storedProg && storedProg.epoch === localEpoch ? storedProg : null;

  const solved = sameEpochProg?.solved || [];
  const hintsUsed = sameEpochProg?.hintsUsed || [];
  const unlocked = Array.from(
    new Set([
      ...starterUnlocked,
      ...computeLocalUnlocked(params.puzzles, solved),
      ...(sameEpochProg?.unlocked || []),
    ])
  ).sort((a, b) => a - b);

  let teamProgress: TeamProgressDoc = {
    tid: cleanTid,
    teamName: cleanTeam,
    email: cleanEmail,
    mission: cleanMission,
    language: fsLang,
    sessionId: params.sessionId,
    score: sameEpochProg?.score ?? 0,
    solved,
    unlocked,
    hintsUsed,
    currentPuzzle: sameEpochProg?.currentPuzzle ?? 0,
    tabSwitches: sameEpochProg?.tabSwitches ?? 0,
    epoch: localEpoch,
    registeredAt: sameEpochProg?.registeredAt || nowIso,
    updatedAt: nowIso,
  };

  activeProgressMap.set(cleanTid, teamProgress);
  await setSessionStateIdb(`progress:${cleanTid}`, teamProgress);

  // Persist pending registration in IndexedDB BEFORE attempting network call
  let regRecord: CachedRegistrationRecord = {
    registrationId,
    tid: cleanTid,
    teamName: cleanTeam,
    email: cleanEmail,
    language: params.language,
    mission: cleanMission,
    sessionId: params.sessionId,
    epoch: localEpoch,
    isValidated: true,
    status: 'pending',
    retryCount: existingReg?.retryCount ?? 0,
    createdAt: existingReg?.createdAt ?? now,
    updatedAt: now,
    syncedAt: existingReg?.syncedAt,
  };
  await saveRegistrationRecordIdb(regRecord);
  await refreshSyncStatus();
  params.onLocalReady?.({ epoch: localEpoch, teamProgress });

  if (!hasRemoteBackend() || !isBrowserOnline()) {
    regRecord =
      (await updateRegistrationStatusIdb(registrationId, 'failed', {
        lastError: 'Offline — registration saved locally in IndexedDB.',
      })) || regRecord;
    await refreshSyncStatus();
    return {
      epoch: localEpoch,
      registration: regRecord,
      teamProgress,
      synced: false,
      syncError: regRecord.lastError,
    };
  }

  // Transition to 'syncing' and wait for explicit DB confirmation
  regRecord = (await updateRegistrationStatusIdb(registrationId, 'syncing')) || regRecord;
  await refreshSyncStatus();
  activeRegistrationSyncIds.add(registrationId);

  try {
    const remoteResult = await dispatchRegistrationRecordToSupabase(regRecord, teamProgress);
    const effectiveEpoch = Math.max(1, remoteResult.epoch);
    const rState = remoteResult.teamState;

    if (effectiveEpoch > localEpoch) {
      localStorage.setItem(STORAGE_KEYS.gameEpoch, String(effectiveEpoch));
      const rSolved = Array.isArray(rState?.solved) ? rState.solved.map(Number) : [];
      const rHints = Array.isArray(rState?.hintsUsed) ? rState.hintsUsed.map(Number) : [];
      teamProgress = {
        ...teamProgress,
        epoch: effectiveEpoch,
        score: typeof rState?.score === 'number' ? rState.score : 0,
        solved: rSolved,
        unlocked: Array.from(
          new Set([...starterUnlocked, ...computeLocalUnlocked(params.puzzles, rSolved)])
        ).sort((a, b) => a - b),
        hintsUsed: rHints,
        tabSwitches: typeof rState?.tabSwitches === 'number' ? rState.tabSwitches : 0,
        currentPuzzle: typeof rState?.currentPuzzle === 'number' ? rState.currentPuzzle : 0,
        updatedAt: new Date().toISOString(),
      };
    } else if (rState) {
      const rSolved = Array.isArray(rState.solved) ? rState.solved.map(Number) : [];
      const rHints = Array.isArray(rState.hintsUsed) ? rState.hintsUsed.map(Number) : [];
      const mergedSolved = Array.from(new Set([...teamProgress.solved, ...rSolved])).sort(
        (a, b) => a - b
      );
      const mergedHints = Array.from(new Set([...teamProgress.hintsUsed, ...rHints])).sort(
        (a, b) => a - b
      );
      const mergedUnlocked = Array.from(
        new Set([
          ...teamProgress.unlocked,
          ...starterUnlocked,
          ...computeLocalUnlocked(params.puzzles, mergedSolved),
        ])
      ).sort((a, b) => a - b);

      teamProgress = {
        ...teamProgress,
        score:
          typeof rState.score === 'number' && rSolved.length >= teamProgress.solved.length
            ? Math.max(teamProgress.score, rState.score)
            : teamProgress.score,
        solved: mergedSolved,
        unlocked: mergedUnlocked,
        hintsUsed: mergedHints,
        tabSwitches:
          typeof rState.tabSwitches === 'number'
            ? Math.max(teamProgress.tabSwitches, rState.tabSwitches)
            : teamProgress.tabSwitches,
        currentPuzzle:
          typeof rState.currentPuzzle === 'number' && rState.currentPuzzle > 0
            ? teamProgress.currentPuzzle || rState.currentPuzzle
            : teamProgress.currentPuzzle,
        updatedAt: new Date().toISOString(),
      };
    }

    activeProgressMap.set(cleanTid, teamProgress);
    await setSessionStateIdb(`progress:${cleanTid}`, teamProgress);

    const syncedAt = Date.now();
    if (effectiveEpoch !== localEpoch) {
      const finalRegistrationId = buildRegistrationId(cleanTid, effectiveEpoch);
      const existingFinal = await getRegistrationByIdIdb(finalRegistrationId);
      regRecord = await saveRegistrationRecordIdb({
        ...regRecord,
        registrationId: finalRegistrationId,
        epoch: effectiveEpoch,
        status: 'synced',
        lastError: undefined,
        createdAt: existingFinal?.createdAt ?? regRecord.createdAt,
        updatedAt: syncedAt,
        syncedAt,
      });
      await deleteRegistrationRecordIdb(registrationId);
    } else {
      regRecord =
        (await updateRegistrationStatusIdb(registrationId, 'synced', {
          epoch: effectiveEpoch,
          lastError: undefined,
          syncedAt,
        })) || regRecord;
    }
    await refreshSyncStatus();

    return {
      epoch: effectiveEpoch,
      registration: regRecord,
      teamProgress,
      synced: true,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Database sync failed';
    regRecord =
      (await updateRegistrationStatusIdb(registrationId, 'failed', {
        retryCount: regRecord.retryCount + 1,
        lastError: errMsg,
      })) || regRecord;
    await refreshSyncStatus();

    return {
      epoch: localEpoch,
      registration: regRecord,
      teamProgress,
      synced: false,
      syncError: errMsg,
    };
  } finally {
    activeRegistrationSyncIds.delete(registrationId);
  }
}

export async function retryPendingRegistrations(): Promise<{
  attempted: number;
  synced: number;
}> {
  if (!hasRemoteBackend() || !isBrowserOnline()) return { attempted: 0, synced: 0 };
  const pendingRegs = await getPendingOrFailedRegistrationsIdb();
  const actionable = pendingRegs.filter(
    (r) =>
      Boolean(r.tid && r.teamName && r.isValidated) &&
      !activeRegistrationSyncIds.has(r.registrationId)
  );
  let synced = 0;

  for (const reg of actionable) {
    activeRegistrationSyncIds.add(reg.registrationId);
    try {
      await updateRegistrationStatusIdb(reg.registrationId, 'syncing');
      await refreshSyncStatus();
      const prog =
        activeProgressMap.get(reg.tid.toUpperCase()) ||
        (await getSessionStateIdb<TeamProgressDoc>(`progress:${reg.tid.toUpperCase()}`)) || {
          tid: reg.tid,
          teamName: reg.teamName,
          email: reg.email,
          mission: reg.mission,
          language: toFirestoreLanguage(reg.language),
          sessionId: reg.sessionId,
          score: 0,
          solved: [],
          unlocked: [],
          hintsUsed: [],
          currentPuzzle: 0,
          tabSwitches: 0,
          epoch: reg.epoch,
          registeredAt: new Date(reg.createdAt).toISOString(),
          updatedAt: new Date().toISOString(),
        };

      try {
        const remoteRes = await dispatchRegistrationRecordToSupabase(reg, prog);
        const effectiveEpoch = Math.max(1, remoteRes.epoch);
        const syncedAt = Date.now();
        if (effectiveEpoch !== reg.epoch) {
          const finalRegistrationId = buildRegistrationId(reg.tid, effectiveEpoch);
          await saveRegistrationRecordIdb({
            ...reg,
            registrationId: finalRegistrationId,
            epoch: effectiveEpoch,
            status: 'synced',
            lastError: undefined,
            updatedAt: syncedAt,
            syncedAt,
          });
          await deleteRegistrationRecordIdb(reg.registrationId);
        } else {
          await updateRegistrationStatusIdb(reg.registrationId, 'synced', {
            lastError: undefined,
            syncedAt,
          });
        }
        synced++;
      } catch (err) {
        await updateRegistrationStatusIdb(reg.registrationId, 'failed', {
          retryCount: reg.retryCount + 1,
          lastError: err instanceof Error ? err.message : 'Registration sync retry failed',
        });
      }
    } finally {
      activeRegistrationSyncIds.delete(reg.registrationId);
    }
  }

  if (actionable.length > 0) {
    await refreshSyncStatus();
  }
  return { attempted: actionable.length, synced };
}

// ==========================================
// SECTION 5: PUZZLE SUBMISSION CACHE & CONTROLLED BULK SYNC
// ==========================================
let flushInFlight = false;
let batchRetryTimerId: number | null = null;
let eventFlushTimerId: number | null = null;
let consecutiveBatchFailures = 0;

function scheduleDelayedRetryIfNeeded(): void {
  if (batchRetryTimerId !== null) return;
  const syncCfg = getSyncConfig();
  const expFactor = Math.min(8, Math.pow(2, consecutiveBatchFailures));
  const jitter = 0.75 + Math.random() * 0.65;
  const delayMs = Math.min(45000, Math.round(syncCfg.baseBackoffMs * expFactor * jitter));
  batchRetryTimerId = window.setTimeout(() => {
    batchRetryTimerId = null;
    void flushPendingSubmissions();
  }, delayMs);
}

function scheduleCoalescedEventFlush(): void {
  if (!hasRemoteBackend() || !isBrowserOnline()) return;
  if (eventFlushTimerId !== null) return;
  const jitterMs = Math.floor(Math.random() * 700);
  eventFlushTimerId = window.setTimeout(() => {
    eventFlushTimerId = null;
    void flushPendingSubmissions();
  }, 1800 + jitterMs);
}

async function dispatchSubmissionBatchToSupabase(
  batch: CachedSubmissionRecord[]
): Promise<Array<{ submissionId: string; ok: boolean; error?: string }>> {
  const client = getSupabaseClient();
  if (!client) {
    return batch.map((b) => ({
      submissionId: b.submissionId,
      ok: false,
      error: 'Supabase client unavailable',
    }));
  }

  // Coalesce redundant same-logId EVENT records within the same batch window so
  // repeated wrong scans/tab-switches don't contend on the same puzzle_logs row lock.
  const latestEventByLogId = new Map<string, CachedSubmissionRecord>();
  const supersededEventWinners = new Map<string, string>();
  const compactedBatch: CachedSubmissionRecord[] = [];
  for (let i = batch.length - 1; i >= 0; i--) {
    const item = batch[i];
    if (item.kind === 'EVENT' && item.logId) {
      const winner = latestEventByLogId.get(item.logId);
      if (winner) {
        supersededEventWinners.set(item.submissionId, winner.submissionId);
        continue;
      }
      latestEventByLogId.set(item.logId, item);
    }
    compactedBatch.push(item);
  }
  compactedBatch.reverse();

  // 1. Prefer authoritative PostgreSQL RPC `sync_submission_batch` (handles server answer check + per-item outcomes)
  const rpcPayload = compactedBatch.map((b) => ({
    submissionId: b.submissionId,
    action: b.action,
    tid: b.tid,
    teamName: b.teamName,
    mission: b.mission,
    language: b.language,
    sessionId: b.sessionId,
    epoch: b.epoch,
    puzzleId: b.puzzleId,
    linkid: b.linkid,
    levelTag: b.levelTag,
    submittedAnswer: b.submittedAnswer || '',
    repeat: b.repeat,
    wrongAttempts: b.wrongAttempts,
    tabSwitches: b.tabSwitches,
    tabSwitchesTotal: b.tabSwitchesTotal,
    hintUsed: b.hintUsed,
    scanCount: b.scanCount,
    totalScore: b.newScore,
    unlockedPuzzles: b.unlocked.join(','),
    logId: b.logId || '',
    status: b.statusValue || 'UNSOLVED',
    progressPatch: b.progressPatch || null,
    clientTimestamp: new Date(b.createdAt).toISOString(),
  }));

  if (!unavailableRpcs.has('sync_submission_batch')) {
    try {
      const rpcRes = await withPromiseTimeout(
        client.rpc('sync_submission_batch', { p_submissions: rpcPayload }),
        10000,
        'Supabase sync_submission_batch RPC'
      );

      if (!rpcRes.error && Array.isArray(rpcRes.data)) {
        const outcomeMap = new Map<string, { ok: boolean; error?: string }>();
        (rpcRes.data as Array<{ submissionId?: string; ok?: boolean; error?: string }>).forEach(
          (row) => {
            if (row.submissionId) {
              outcomeMap.set(row.submissionId, {
                ok: Boolean(row.ok),
                error: row.error ? String(row.error) : undefined,
              });
            }
          }
        );
        return batch.map((b) => {
          const targetId = supersededEventWinners.get(b.submissionId) || b.submissionId;
          return {
            submissionId: b.submissionId,
            ok: outcomeMap.get(targetId)?.ok ?? false,
            error: outcomeMap.get(targetId)?.error ?? 'Missing server confirmation',
          };
        });
      }

      if (rpcRes.error) {
        if (isRpcMissingError(rpcRes.error)) {
          markRpcUnavailable('sync_submission_batch');
        } else {
          throw new Error(rpcRes.error.message);
        }
      }
    } catch (err) {
      if (err instanceof Error && !err.message.toLowerCase().includes('function')) {
        return batch.map((b) => ({
          submissionId: b.submissionId,
          ok: false,
          error: err.message,
        }));
      }
    }
  }

  // 2. Fallback (if RPC not yet installed in Supabase SQL Editor): bulk upsert with partial-failure isolation
  const progMetaByTid = new Map<
    string,
    { createdAt: number; solvedCount: number; row: Record<string, unknown> }
  >();
  const logEntryById = new Map<
    string,
    { cleanLogRow: Record<string, unknown>; owners: string[]; isSolve: boolean; createdAt: number }
  >();
  const unkeyedLogs: Array<{ cleanLogRow: Record<string, unknown>; owners: string[] }> = [];

  batch.forEach((b) => {
    if (b.supabaseProgress) {
      const tidKey = b.tid.toUpperCase();
      const solvedCount = Array.isArray(b.supabaseProgress.solved)
        ? b.supabaseProgress.solved.length
        : 0;
      const prev = progMetaByTid.get(tidKey);
      if (
        !prev ||
        b.createdAt > prev.createdAt ||
        (b.createdAt === prev.createdAt && solvedCount >= prev.solvedCount)
      ) {
        progMetaByTid.set(tidKey, {
          createdAt: b.createdAt,
          solvedCount,
          row: buildSupabaseProgressRow(b.supabaseProgress),
        });
      }
    }
    if (b.supabaseLog) {
      const { submission_id: _omitSubId, ...cleanLogRow } = b.supabaseLog;
      const logId = cleanLogRow.id ? String(cleanLogRow.id) : '';
      const isSolve =
        b.action === 'SOLVED' ||
        b.statusValue === 'SOLVED' ||
        b.statusValue === 'REPEAT_SOLVE';
      if (!logId) {
        unkeyedLogs.push({ cleanLogRow, owners: [b.submissionId] });
      } else {
        const existing = logEntryById.get(logId);
        if (!existing) {
          logEntryById.set(logId, {
            cleanLogRow,
            owners: [b.submissionId],
            isSolve,
            createdAt: b.createdAt,
          });
        } else {
          existing.owners.push(b.submissionId);
          const shouldReplace =
            b.createdAt > existing.createdAt ||
            (b.createdAt === existing.createdAt && isSolve && !existing.isSolve);
          if (shouldReplace) {
            existing.cleanLogRow = cleanLogRow;
            existing.isSolve = isSolve;
            existing.createdAt = b.createdAt;
          }
        }
      }
    }
  });

  const progRows = Array.from(progMetaByTid.values()).map((entry) => entry.row);
  const mergedLogEntries = [...Array.from(logEntryById.values()), ...unkeyedLogs];
  const logRows = mergedLogEntries.map((entry) => entry.cleanLogRow);
  const logRowOwners = mergedLogEntries.map((entry) => entry.owners);

  const outcomes = new Map<string, { ok: boolean; error?: string }>();
  batch.forEach((b) => outcomes.set(b.submissionId, { ok: true }));

  if (progRows.length > 0) {
    const pRes = await withPromiseTimeout(
      client.from('team_progress').upsert(progRows, { onConflict: 'tid' }),
      8000,
      'Supabase batch team_progress'
    );
    if (pRes.error) {
      return batch.map((b) => ({
        submissionId: b.submissionId,
        ok: false,
        error: pRes.error!.message,
      }));
    }
  }

  if (logRows.length > 0) {
    const lRes = await withPromiseTimeout(
      client.from('puzzle_logs').upsert(logRows, { onConflict: 'id' }),
      8000,
      'Supabase batch puzzle_logs'
    );
    if (lRes.error) {
      // Partial-batch isolation: try individual rows so one bad row doesn't block valid rows
      for (let i = 0; i < logRows.length; i++) {
        const single = await withPromiseTimeout(
          client.from('puzzle_logs').upsert(logRows[i], { onConflict: 'id' }),
          5000,
          'Supabase single row isolation'
        );
        if (single.error) {
          logRowOwners[i].forEach((ownerId) => {
            outcomes.set(ownerId, { ok: false, error: single.error!.message });
          });
        }
      }
    }
  }

  return batch.map((b) => ({
    submissionId: b.submissionId,
    ok: outcomes.get(b.submissionId)?.ok ?? false,
    error: outcomes.get(b.submissionId)?.error,
  }));
}

export async function flushPendingSubmissions(ignoreRetryBackoff = false): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  if (!hasRemoteBackend() || flushInFlight || !isBrowserOnline()) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  flushInFlight = true;
  let totalProcessed = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;

  try {
    // 1. Always ensure pending registrations sync before puzzle submissions
    await retryPendingRegistrations();

    const syncCfg = getSyncConfig();
    if (ignoreRetryBackoff) {
      await recoverStuckSyncingSubmissionsIdb();
    }

    // Drain controlled batches (up to 5 batches per cycle so UI/network remain smooth)
    for (let round = 0; round < 5; round++) {
      const batch = await claimReadySubmissionsBatchIdb(
        syncCfg.batchSize,
        syncCfg.maxRetries
      );
      if (batch.length === 0) break;

      await refreshSyncStatus();

      let outcomes: Array<{ submissionId: string; ok: boolean; error?: string }>;
      try {
        outcomes = await dispatchSubmissionBatchToSupabase(batch);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Network error during batch sync';
        outcomes = batch.map((b) => ({
          submissionId: b.submissionId,
          ok: false,
          error: errMsg,
        }));
      }

      await markSubmissionsOutcomeIdb(outcomes);
      totalProcessed += outcomes.length;
      const okCount = outcomes.filter((o) => o.ok).length;
      totalSucceeded += okCount;
      totalFailed += outcomes.length - okCount;

      if (okCount === 0) {
        // Entire batch failed (likely offline/transient backend) -> stop and back off with jitter
        consecutiveBatchFailures = Math.min(5, consecutiveBatchFailures + 1);
        scheduleDelayedRetryIfNeeded();
        break;
      }
      consecutiveBatchFailures = 0;
    }

    const currentEpoch = Math.max(1, Number(localStorage.getItem(STORAGE_KEYS.gameEpoch) || 1));
    await pruneExpiredSyncedCacheIdb(currentEpoch);
    await refreshSyncStatus();
  } finally {
    flushInFlight = false;
  }

  return { processed: totalProcessed, succeeded: totalSucceeded, failed: totalFailed };
}

export function startOutboxSyncLoop(): () => void {
  const syncCfg = getSyncConfig();
  let stopped = false;
  let loopTimerId: number | null = null;

  const scheduleNext = (delayMs: number) => {
    if (stopped) return;
    if (loopTimerId !== null) window.clearTimeout(loopTimerId);
    loopTimerId = window.setTimeout(() => {
      loopTimerId = null;
      if (stopped) return;
      void flushPendingSubmissions().finally(() => {
        const jitter = Math.floor((Math.random() - 0.5) * 8000);
        scheduleNext(Math.max(5000, syncCfg.syncIntervalMs + jitter));
      });
    }, delayMs);
  };

  const handleOnline = () => {
    void refreshSyncStatus();
    // Spread reconnect bursts across 300-2800ms across 300 devices
    window.setTimeout(() => {
      if (!stopped) void flushPendingSubmissions(true);
    }, 300 + Math.floor(Math.random() * 2500));
  };
  const handleOffline = () => {
    void refreshSyncStatus();
  };

  scheduleNext(1200 + Math.floor(Math.random() * 2600));

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  return () => {
    stopped = true;
    if (loopTimerId !== null) {
      window.clearTimeout(loopTimerId);
      loopTimerId = null;
    }
    if (batchRetryTimerId !== null) {
      window.clearTimeout(batchRetryTimerId);
      batchRetryTimerId = null;
    }
    if (eventFlushTimerId !== null) {
      window.clearTimeout(eventFlushTimerId);
      eventFlushTimerId = null;
    }
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}

export async function recordPuzzleSolveToDb(params: {
  tid: string;
  teamName: string;
  mission: string;
  language: LanguageCode;
  sessionId: string;
  puzzle: Puzzle;
  submittedAnswer: string;
  repeat: boolean;
  pointsDelta: number;
  newScore: number;
  solved: number[];
  unlocked: number[];
  hintsUsed: number[];
  tabSwitchesTotal: number;
  notebook?: PuzzleNotebookEntry | null;
  epoch: number;
  solvedAt?: number;
}): Promise<void> {
  if (!params.tid) return;
  const cleanTid = params.tid.trim().toUpperCase().slice(0, 32);
  const now = typeof params.solvedAt === 'number' && params.solvedAt > 0 ? params.solvedAt : Date.now();
  const nowIso = new Date(now).toISOString();
  const fsLang = toFirestoreLanguage(params.language);
  const pointsEarned = params.repeat ? 0 : Math.max(0, params.puzzle.points || 0);
  const pointsLost = params.repeat ? Math.max(0, params.puzzle.points || 0) : 0;
  const wrongAttempts = Math.max(0, Math.floor(params.notebook?.wrongAttempts ?? 0));
  const puzzleTabSwitches = Math.max(0, Math.floor(params.notebook?.tabSwitches ?? 0));
  const scanCount = Math.max(0, Math.floor(params.notebook?.scanCount ?? 0));
  const hintUsed = Boolean(
    (params.notebook?.hintsUsed ?? 0) > 0 || params.hintsUsed.includes(Number(params.puzzle.id))
  );
  const levelTag = toLevelTag(params.puzzle.level);
  const puzzleLevel = toNumericLevel(params.puzzle.level, params.mission);

  // Deterministic submissionId & dedupeKey for first solves prevents duplicate DB rows
  const submissionId = params.repeat
    ? `sub_${cleanTid}_ep${params.epoch}_p${params.puzzle.id}_rep_${now}_${Math.random().toString(36).slice(2, 6)}`
    : `sub_${cleanTid}_ep${params.epoch}_p${params.puzzle.id}_solve`;
  const dedupeKey = params.repeat
    ? `repeat::${cleanTid}::${params.epoch}::${params.puzzle.id}::${now}`
    : `solve::${cleanTid}::${params.epoch}::${params.puzzle.id}`;

  const existingProg = activeProgressMap.get(cleanTid);
  const nextProgress: TeamProgressDoc = {
    tid: cleanTid,
    teamName: params.teamName,
    email: existingProg?.email,
    mission: params.mission,
    language: fsLang,
    sessionId: params.sessionId,
    score: params.newScore,
    solved: params.solved,
    unlocked: params.unlocked,
    hintsUsed: params.hintsUsed,
    currentPuzzle: params.puzzle.id,
    tabSwitches: params.tabSwitchesTotal,
    epoch: params.epoch,
    registeredAt: existingProg?.registeredAt || nowIso,
    updatedAt: nowIso,
  };

  activeProgressMap.set(cleanTid, nextProgress);
  await setSessionStateIdb(`progress:${cleanTid}`, nextProgress);

  const anchorId = params.repeat
    ? `${levelTag}_${cleanTid}_P${params.puzzle.id}_repeat_${submissionId}`
    : `${levelTag}_${cleanTid}_P${params.puzzle.id}`;

  const supabaseLog: Record<string, unknown> = {
    id: anchorId,
    action: 'SUMMARY',
    level: levelTag,
    tid: cleanTid,
    team_name: params.teamName,
    email: existingProg?.email || null,
    mission: params.mission,
    language: fsLang,
    session_id: params.sessionId,
    puzzle_id: params.puzzle.id,
    linkid: String(params.puzzle.linkid || ''),
    status: params.repeat ? 'REPEAT_SOLVE' : 'SOLVED',
    wrong_attempts: wrongAttempts,
    tab_switches: puzzleTabSwitches,
    hint_used: hintUsed,
    scan_count: scanCount,
    points_earned: pointsEarned,
    points_lost: pointsLost,
    points: params.pointsDelta,
    total_score: params.newScore,
    unlocked_puzzles: params.unlocked.join(','),
    solved_puzzles: params.solved.join(','),
    epoch: params.epoch,
    client_timestamp: nowIso,
    last_active: nowIso,
    registered_at: existingProg?.registeredAt || nowIso,
  };

  const record: CachedSubmissionRecord = {
    submissionId,
    dedupeKey,
    kind: 'SOLVE',
    action: 'SOLVED',
    tid: cleanTid,
    teamName: params.teamName.trim().slice(0, 60),
    email: existingProg?.email,
    mission: params.mission.trim().slice(0, 40),
    language: fsLang,
    sessionId: params.sessionId.trim().slice(0, 64),
    epoch: params.epoch,
    puzzleId: params.puzzle.id,
    linkid: String(params.puzzle.linkid || ''),
    level: puzzleLevel,
    levelTag,
    submittedAnswer: params.submittedAnswer,
    repeat: params.repeat,
    pointsDelta: params.pointsDelta,
    newScore: params.newScore,
    solved: params.solved,
    unlocked: params.unlocked,
    hintsUsed: params.hintsUsed,
    tabSwitchesTotal: params.tabSwitchesTotal,
    wrongAttempts,
    tabSwitches: puzzleTabSwitches,
    hintUsed,
    scanCount,
    logId: anchorId,
    statusValue: params.repeat ? 'REPEAT_SOLVE' : 'SOLVED',
    supabaseLog,
    supabaseProgress: nextProgress,
    status: 'pending',
    retryCount: 0,
    nextRetryAt: now,
    createdAt: now,
  };

  await enqueueSubmissionIdb(record);
  await refreshSyncStatus();

  if (hasRemoteBackend() && isBrowserOnline()) {
    void flushPendingSubmissions(true);
  }
}

export async function recordPuzzleEventToDb(params: {
  tid: string;
  teamName: string;
  mission: string;
  language: LanguageCode;
  sessionId: string;
  action: PuzzleEventAction;
  status: PuzzleEventStatus;
  puzzleId?: number;
  linkid?: string;
  level?: number | string;
  wrongAttempts?: number;
  tabSwitches?: number;
  hintUsed?: boolean;
  scanCount?: number;
  totalScore: number;
  unlocked: number[];
  hintsUsedList?: number[];
  teamTabSwitches?: number;
  epoch: number;
  updateProgressFields?: Partial<{
    hintsUsed: number[];
    tabSwitches: number;
    currentPuzzle: number;
  }>;
}): Promise<void> {
  if (!params.tid) return;
  const cleanTid = params.tid.trim().toUpperCase().slice(0, 32);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const fsLang = toFirestoreLanguage(params.language);
  const puzzleId = Math.max(0, Math.floor(params.puzzleId ?? 0));
  const wrongAttempts = Math.max(0, Math.floor(params.wrongAttempts ?? 0));
  const tabSwitches = Math.max(0, Math.floor(params.tabSwitches ?? 0));
  const hintUsed = Boolean(params.hintUsed);
  const puzzleLevel = toNumericLevel(params.level, params.mission);
  const levelTag = toLevelTag(puzzleLevel);

  let latestProgress = activeProgressMap.get(cleanTid) || null;
  if (params.updateProgressFields && latestProgress) {
    latestProgress = {
      ...latestProgress,
      hintsUsed: params.updateProgressFields.hintsUsed ?? latestProgress.hintsUsed,
      tabSwitches: params.updateProgressFields.tabSwitches ?? latestProgress.tabSwitches,
      currentPuzzle: params.updateProgressFields.currentPuzzle ?? latestProgress.currentPuzzle,
      updatedAt: nowIso,
    };
    activeProgressMap.set(cleanTid, latestProgress);
    await setSessionStateIdb(`progress:${cleanTid}`, latestProgress);
  }

  const submissionId = generateEventId();
  const anchorId =
    puzzleId > 0 ? `${levelTag}_${cleanTid}_P${puzzleId}` : `evt_${cleanTid}_${submissionId}`;
  const dedupeKey = `event::${cleanTid}::${params.epoch}::${params.action}::${puzzleId}::${wrongAttempts}::${tabSwitches}::${hintUsed}`;

  const supabaseLog: Record<string, unknown> = {
    id: anchorId,
    action: 'SUMMARY',
    level: levelTag,
    tid: cleanTid,
    team_name: params.teamName,
    email: latestProgress?.email || null,
    mission: params.mission,
    language: fsLang,
    session_id: params.sessionId,
    puzzle_id: puzzleId,
    linkid: String(params.linkid || ''),
    status: params.status === 'UNSOLVED' ? 'UNSOLVED' : '',
    wrong_attempts: wrongAttempts,
    tab_switches: tabSwitches,
    hint_used: hintUsed,
    scan_count: Math.max(0, Math.floor(params.scanCount ?? 0)),
    points_earned: 0,
    points_lost: 0,
    points: 0,
    total_score: params.totalScore,
    unlocked_puzzles: params.unlocked.join(','),
    epoch: params.epoch,
    client_timestamp: nowIso,
    last_active: nowIso,
    registered_at: latestProgress?.registeredAt || nowIso,
  };

  const record: CachedSubmissionRecord = {
    submissionId,
    dedupeKey,
    kind: 'EVENT',
    action: params.action,
    tid: cleanTid,
    teamName: params.teamName.trim().slice(0, 60),
    email: latestProgress?.email,
    mission: params.mission.trim().slice(0, 40),
    language: fsLang,
    sessionId: params.sessionId.trim().slice(0, 64),
    epoch: params.epoch,
    puzzleId,
    linkid: String(params.linkid || ''),
    level: puzzleLevel,
    levelTag,
    repeat: false,
    pointsDelta: 0,
    newScore: params.totalScore,
    solved: latestProgress?.solved || [],
    unlocked: params.unlocked,
    hintsUsed: latestProgress?.hintsUsed || [],
    tabSwitchesTotal: latestProgress?.tabSwitches || tabSwitches,
    wrongAttempts,
    tabSwitches,
    hintUsed,
    scanCount: Math.max(0, Math.floor(params.scanCount ?? 0)),
    logId: anchorId,
    statusValue: params.status === 'UNSOLVED' ? 'UNSOLVED' : '',
    progressPatch: params.updateProgressFields,
    supabaseLog,
    supabaseProgress: latestProgress || undefined,
    status: 'pending',
    retryCount: 0,
    nextRetryAt: now,
    createdAt: now,
  };

  await enqueueSubmissionIdb(record);
  await refreshSyncStatus();

  scheduleCoalescedEventFlush();
}

let currentPuzzleDebounceTimer: number | null = null;

export async function updateTeamCurrentPuzzleInDb(tid: string, puzzleId: number): Promise<void> {
  if (!tid) return;
  const cleanTid = tid.trim().toUpperCase().slice(0, 32);
  const cleanPid = Math.max(0, Math.floor(puzzleId));
  const nowIso = new Date().toISOString();
  const existing = activeProgressMap.get(cleanTid);
  const sessionId = existing?.sessionId || '';
  if (existing) {
    const next = { ...existing, currentPuzzle: cleanPid, updatedAt: nowIso };
    activeProgressMap.set(cleanTid, next);
    void setSessionStateIdb(`progress:${cleanTid}`, next);
  }
  const client = isBrowserOnline() ? getSupabaseClient() : null;
  if (!client) return;

  if (currentPuzzleDebounceTimer !== null) {
    window.clearTimeout(currentPuzzleDebounceTimer);
  }
  currentPuzzleDebounceTimer = window.setTimeout(() => {
    currentPuzzleDebounceTimer = null;
    if (!isBrowserOnline()) return;

    if (!unavailableRpcs.has('set_team_current_puzzle') && sessionId) {
      void withPromiseTimeout(
        client.rpc('set_team_current_puzzle', {
          p_tid: cleanTid,
          p_session_id: sessionId,
          p_puzzle_id: cleanPid,
        }),
        3500,
        'Supabase set_team_current_puzzle RPC'
      )
        .then((res) => {
          if (res.error && isRpcMissingError(res.error)) {
            markRpcUnavailable('set_team_current_puzzle');
          }
        })
        .catch(() => {
          // ignore transient offline update error
        });
      return;
    }

    if (unavailableRpcs.has('set_team_current_puzzle')) {
      void withPromiseTimeout(
        client
          .from('team_progress')
          .update({ current_puzzle: cleanPid, updated_at: nowIso })
          .eq('tid', cleanTid),
        3500,
        'Supabase update current_puzzle'
      ).catch(() => {
        // ignore transient offline update error
      });
    }
  }, 1500);
}

// ==========================================
// ADMIN AUTHENTICATION (Server-Side RPC First) + TELEMETRY
// ==========================================
function getStoredAdminCredentials(passwordOverride?: string): { email: string; password: string } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEYS.adminSessionKey);
    if (raw) {
      const parsed = JSON.parse(raw) as { email?: string; password?: string };
      const email = normalizeEmail(parsed?.email);
      const password = String(passwordOverride || parsed?.password || '').trim();
      if (email && password) return { email, password };
    }
  } catch {
    // ignore storage read error
  }
  return null;
}

const ADMIN_VERIFICATION_CACHE_TTL_MS = 60_000;
const adminVerificationInFlight = new Map<string, Promise<boolean>>();

export async function verifyAdminCredentials(
  adminEmail: string,
  adminPassword: string,
  allowRecentVerifiedCache = false
): Promise<boolean> {
  const cleanEmail = normalizeEmail(adminEmail);
  const cleanPass = String(adminPassword || '').trim();
  if (!cleanEmail || !isValidEmail(cleanEmail) || !cleanPass) return false;

  const digest = sha256NormalizedHex(`${cleanEmail}::${cleanPass}`);
  const cacheKey = `admin_verified:${cleanEmail}`;
  if (allowRecentVerifiedCache) {
    const cached = await getSessionStateIdb<{ digest?: string; at?: number }>(cacheKey);
    if (
      cached?.digest === digest &&
      Number.isFinite(cached.at) &&
      Date.now() - Number(cached.at) <= ADMIN_VERIFICATION_CACHE_TTL_MS
    ) {
      return true;
    }
  }

  const requestKey = `${cleanEmail}:${digest}`;
  const existingRequest = adminVerificationInFlight.get(requestKey);
  if (existingRequest) return existingRequest;

  const verification = (async () => {
    const client = isBrowserOnline() ? getSupabaseClient() : null;
    if (!client) {
      const localAdmins = await fetchJsonSafe<AdminCredential[]>('/data/admin.json', []);
      return localAdmins.some(
        (entry) =>
          normalizeEmail(entry.email) === cleanEmail &&
          String(entry.password || '').trim() === cleanPass
      );
    }

    let rpcRes: { data: unknown; error: { code?: string; message?: string } | null };
    try {
      rpcRes = await withPromiseTimeout(
        client.rpc('verify_admin_login', {
          p_email: cleanEmail,
          p_password: cleanPass,
        }),
        4000,
        'Supabase verify_admin_login RPC'
      );
    } catch {
      throw new Error('Could not reach the admin sign-in server. Check your connection and try again.');
    }

    if (rpcRes.error) {
      if (isRpcMissingError(rpcRes.error)) {
        throw new Error('Admin sign-in is unavailable. Apply the current Supabase schema and reload.');
      }
      throw new Error('Could not reach the admin sign-in server. Check your connection and try again.');
    }
    if (typeof rpcRes.data !== 'boolean') {
      throw new Error('The admin sign-in server returned an invalid response. Please try again.');
    }

    if (rpcRes.data) {
      void setSessionStateIdb(cacheKey, { digest, at: Date.now() }).catch(() => {});
    }
    return rpcRes.data;
  })();

  adminVerificationInFlight.set(requestKey, verification);
  try {
    return await verification;
  } finally {
    if (adminVerificationInFlight.get(requestKey) === verification) {
      adminVerificationInFlight.delete(requestKey);
    }
  }
}

export interface NormalizedAdminLogRow {
  id: string;
  action: string;
  level: string;
  tid: string;
  teamName: string;
  email?: string;
  mission: string;
  language: string;
  sessionId: string;
  puzzleId: number;
  linkid: string;
  status: string;
  wrongAttempts: number;
  tabSwitches: number;
  hintUsed: boolean;
  scanCount: number;
  pointsEarned: number;
  pointsLost: number;
  points: number;
  totalScore: number;
  unlockedPuzzles: string;
  solvedPuzzles?: string;
  timestamp: string;
  lastActive: string;
  registeredAt: string;
}

function normalizeRemoteAdminRow(raw: Record<string, unknown>, idx: number): NormalizedAdminLogRow {
  const action = String(raw.action || 'SUMMARY').toUpperCase();
  const ts = String(
    raw.timestamp ??
      raw.client_timestamp ??
      raw.registeredAt ??
      raw.registered_at ??
      raw.lastActive ??
      raw.last_active ??
      ''
  );
  const pts = Number(raw.points ?? 0) || 0;
  const rawPtsEarned = raw.pointsEarned ?? raw.points_earned;
  const rawPtsLost = raw.pointsLost ?? raw.points_lost;
  const rawPid = raw.puzzleId ?? raw.puzzle_id;
  return {
    id: String(raw.id || `${action}_${raw.tid || idx}_${rawPid || 0}_${idx}`),
    action,
    level: action === 'REGISTRATION' ? 'REG' : toLevelTag(raw.level as string | number | undefined),
    tid: String(raw.tid || ''),
    teamName: String(raw.teamName ?? raw.team_name ?? ''),
    email: raw.email ? normalizeEmail(raw.email) : undefined,
    mission: String(raw.mission || ''),
    language: String(raw.language || 'PYTHON'),
    sessionId: String(raw.sessionId ?? raw.session_id ?? ''),
    puzzleId: Number(rawPid || 0) || 0,
    linkid: String(raw.linkid || ''),
    status: String(raw.status || (action === 'REGISTRATION' ? 'REGISTERED' : 'UNSOLVED')),
    wrongAttempts: Number(raw.wrongAttempts ?? raw.wrong_attempts ?? 0) || 0,
    tabSwitches: Number(raw.tabSwitches ?? raw.tab_switches ?? 0) || 0,
    hintUsed: Boolean(raw.hintUsed ?? raw.hint_used),
    scanCount: Number(raw.scanCount ?? raw.scan_count ?? 0) || 0,
    pointsEarned: rawPtsEarned !== undefined ? Number(rawPtsEarned) || 0 : pts > 0 ? pts : 0,
    pointsLost: rawPtsLost !== undefined ? Number(rawPtsLost) || 0 : pts < 0 ? Math.abs(pts) : 0,
    points: pts,
    totalScore: Number(raw.totalScore ?? raw.total_score ?? 0) || 0,
    unlockedPuzzles: String(raw.unlockedPuzzles ?? raw.unlocked_puzzles ?? ''),
    solvedPuzzles: String(raw.solvedPuzzles ?? raw.solved_puzzles ?? ''),
    timestamp: ts,
    lastActive: String(raw.lastActive ?? raw.last_active ?? ts),
    registeredAt: String(raw.registeredAt ?? raw.registered_at ?? ts),
  };
}

let lastAdminDeltaEpoch = 0;
let lastAdminDeltaCursorIso: string | null = null;

function extractMaxActivityIso(rows: Record<string, unknown>[]): string | null {
  let maxMs = 0;
  let maxIso: string | null = null;
  for (const r of rows) {
    const candidate = String(r.last_active || r.created_at || r.client_timestamp || '');
    if (!candidate) continue;
    const ms = Date.parse(candidate);
    if (!Number.isNaN(ms) && ms > maxMs) {
      maxMs = ms;
      maxIso = new Date(ms).toISOString();
    }
  }
  return maxIso;
}

export interface AdminTeamProgressRow {
  tid: string;
  teamName: string;
  email: string;
  mission: string;
  language: string;
  sessionId: string;
  score: number;
  solved: number[];
  unlocked: number[];
  hintsUsed: number[];
  currentPuzzle: number;
  tabSwitches: number;
  epoch: number;
  registeredAt: string;
  updatedAt: string;
}

const ADMIN_LOG_SELECT_COLUMNS =
  'id,action,level,tid,team_name,email,mission,language,session_id,puzzle_id,linkid,status,wrong_attempts,tab_switches,hint_used,scan_count,points_earned,points_lost,points,total_score,unlocked_puzzles,solved_puzzles,client_timestamp,last_active,registered_at,created_at';

const ADMIN_PROGRESS_SELECT_COLUMNS =
  'tid,team_name,email,mission,language,session_id,score,solved,unlocked,hints_used,current_puzzle,tab_switches,epoch,registered_at,updated_at';

function normalizeAdminProgressRow(raw: Record<string, unknown>): AdminTeamProgressRow {
  return {
    tid: String(raw.tid || '').trim().toUpperCase(),
    teamName: String(raw.team_name || ''),
    email: raw.email ? normalizeEmail(raw.email) : '',
    mission: String(raw.mission || ''),
    language: String(raw.language || 'PYTHON'),
    sessionId: String(raw.session_id || ''),
    score: Number(raw.score || 0) || 0,
    solved: Array.isArray(raw.solved) ? raw.solved.map(Number) : [],
    unlocked: Array.isArray(raw.unlocked) ? raw.unlocked.map(Number) : [],
    hintsUsed: Array.isArray(raw.hints_used) ? raw.hints_used.map(Number) : [],
    currentPuzzle: Number(raw.current_puzzle || 0) || 0,
    tabSwitches: Number(raw.tab_switches || 0) || 0,
    epoch: Number(raw.epoch || 1) || 1,
    registeredAt: String(raw.registered_at || ''),
    updatedAt: String(raw.updated_at || ''),
  };
}

export function subscribeAdminRealtime(onChange: () => void): () => void {
  const supabaseClient = isBrowserOnline() ? getSupabaseClient() : null;
  if (!supabaseClient) return () => {};

  // Leading + trailing 5s throttle prevents 300 active teams from flooding fetchAdminLogs
  const MIN_GAP_MS = 5000;
  let lastTriggerAt = 0;
  let throttleTimer: number | null = null;
  let pendingWhileHidden = false;

  const fireChange = () => {
    if (typeof document !== 'undefined' && document.hidden) {
      pendingWhileHidden = true;
      return;
    }
    pendingWhileHidden = false;
    lastTriggerAt = Date.now();
    onChange();
  };

  const trigger = () => {
    if (typeof document !== 'undefined' && document.hidden) {
      pendingWhileHidden = true;
      return;
    }
    const now = Date.now();
    const elapsed = now - lastTriggerAt;
    if (elapsed >= MIN_GAP_MS) {
      if (throttleTimer !== null) {
        window.clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      fireChange();
      return;
    }
    if (throttleTimer === null) {
      throttleTimer = window.setTimeout(() => {
        throttleTimer = null;
        fireChange();
      }, MIN_GAP_MS - elapsed);
    }
  };

  const handleVisibility = () => {
    if (!document.hidden && pendingWhileHidden) {
      pendingWhileHidden = false;
      trigger();
    }
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibility);
  }

  const channel = supabaseClient
    .channel(`admin-live-${Date.now()}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'puzzle_logs' },
      trigger
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'team_progress' },
      trigger
    )
    .subscribe();

  return () => {
    if (throttleTimer !== null) window.clearTimeout(throttleTimer);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibility);
    }
    void supabaseClient.removeChannel(channel);
  };
}

export async function fetchAdminLogs(
  adminKey: string,
  sinceRow = 2
): Promise<{
  epoch: number;
  logs: NormalizedAdminLogRow[];
  teamProgress: AdminTeamProgressRow[];
  nextSinceRow: number;
  fullSnapshot: boolean;
}> {
  const supabaseClient = isBrowserOnline() ? getSupabaseClient() : null;
  if (supabaseClient) {
    try {
      const localEpoch = Math.max(1, Number(localStorage.getItem(STORAGE_KEYS.gameEpoch) || 1));
      const adminCreds = getStoredAdminCredentials(adminKey);

      const metaRes = await withPromiseTimeout(
        supabaseClient.from('game_meta').select('epoch').eq('id', 1).maybeSingle(),
        4000,
        'Supabase admin meta check'
      );
      if (metaRes.error) throw new Error(metaRes.error.message);
      const remoteEpoch = Math.max(localEpoch, Math.floor(Number(metaRes.data?.epoch || localEpoch)));

      const needsFullSnapshot =
        sinceRow <= 2 || !lastAdminDeltaCursorIso || lastAdminDeltaEpoch !== remoteEpoch;

      const cursorMs = Date.parse(lastAdminDeltaCursorIso || '');
      const overlapIso = Number.isNaN(cursorMs)
        ? new Date(Date.now() - 10000).toISOString()
        : new Date(Math.max(0, cursorMs - 4000)).toISOString();

      const PAGE_SIZE = 1000;
      const MAX_PAGES = 100;

      // 1. Prefer authenticated SECURITY DEFINER RPC (works even when direct table SELECT is locked by RLS)
      if (adminCreds && !unavailableRpcs.has('admin_fetch_logs')) {
        try {
          let rpcEpoch = remoteEpoch;
          let rpcProgress: AdminTeamProgressRow[] = [];
          const collectedRpcLogs: Record<string, unknown>[] = [];
          let usedRpc = false;

          for (let page = 0; page < MAX_PAGES; page++) {
            const rpcRes = await withPromiseTimeout(
              supabaseClient.rpc('admin_fetch_logs', {
                p_email: adminCreds.email,
                p_password: adminCreds.password,
                p_since_iso: needsFullSnapshot ? null : overlapIso,
                p_offset: page * PAGE_SIZE,
                p_limit: PAGE_SIZE,
              }),
              10000,
              'Supabase admin_fetch_logs RPC'
            );

            if (rpcRes.error) {
              if (isRpcMissingError(rpcRes.error)) {
                markRpcUnavailable('admin_fetch_logs');
                break;
              }
              throw new Error(rpcRes.error.message);
            }

            usedRpc = true;
            const payload = (rpcRes.data || {}) as {
              epoch?: number;
              teamProgress?: Record<string, unknown>[];
              logs?: Record<string, unknown>[];
            };
            rpcEpoch = Math.max(remoteEpoch, Math.floor(Number(payload.epoch || remoteEpoch)));
            if (page === 0 && Array.isArray(payload.teamProgress)) {
              rpcProgress = payload.teamProgress
                .map(normalizeAdminProgressRow)
                .filter((r) => Boolean(r.tid));
            }
            const chunk = Array.isArray(payload.logs) ? payload.logs : [];
            collectedRpcLogs.push(...chunk);
            if (chunk.length < PAGE_SIZE) break;
          }

          if (usedRpc) {
            const maxIso = extractMaxActivityIso(collectedRpcLogs);
            if (needsFullSnapshot) {
              lastAdminDeltaEpoch = rpcEpoch;
              lastAdminDeltaCursorIso = maxIso || new Date().toISOString();
            } else if (maxIso) {
              lastAdminDeltaCursorIso = maxIso;
            }
            const logs = collectedRpcLogs.map((r, i) => normalizeRemoteAdminRow(r, i));
            return {
              epoch: rpcEpoch,
              logs,
              teamProgress: rpcProgress,
              nextSinceRow: needsFullSnapshot
                ? Math.max(3, logs.length + 2)
                : Math.max(3, sinceRow + logs.length),
              fullSnapshot: needsFullSnapshot,
            };
          }
        } catch (rpcErr) {
          if (rpcErr instanceof Error && /unauthorized/i.test(rpcErr.message)) {
            throw rpcErr;
          }
        }
      }

      // 2. Fallback (legacy pre-lockdown schema): epoch-indexed query on team_progress + puzzle_logs
      const progressRes = await withPromiseTimeout(
        supabaseClient
          .from('team_progress')
          .select(ADMIN_PROGRESS_SELECT_COLUMNS)
          .eq('epoch', remoteEpoch)
          .order('updated_at', { ascending: false })
          .limit(500),
        5000,
        'Supabase admin team_progress'
      );

      const teamProgress = (!progressRes.error && Array.isArray(progressRes.data)
        ? (progressRes.data as Record<string, unknown>[])
            .map(normalizeAdminProgressRow)
            .filter((r) => Boolean(r.tid))
        : []);

      const collected: Record<string, unknown>[] = [];

      if (needsFullSnapshot) {
        for (let page = 0; page < MAX_PAGES; page++) {
          const from = page * PAGE_SIZE;
          const logsRes = await withPromiseTimeout(
            supabaseClient
              .from('puzzle_logs')
              .select(ADMIN_LOG_SELECT_COLUMNS)
              .eq('epoch', remoteEpoch)
              .order('last_active', { ascending: true })
              .order('id', { ascending: true })
              .range(from, from + PAGE_SIZE - 1),
            10000,
            'Supabase admin logs snapshot'
          );
          if (logsRes.error) throw new Error(logsRes.error.message);
          const chunk = (logsRes.data || []) as Record<string, unknown>[];
          collected.push(...chunk);
          if (chunk.length < PAGE_SIZE) break;
        }

        const maxIso = extractMaxActivityIso(collected) || new Date().toISOString();
        lastAdminDeltaEpoch = remoteEpoch;
        lastAdminDeltaCursorIso = maxIso;

        const logs = collected.map((r, i) => normalizeRemoteAdminRow(r, i));
        return {
          epoch: remoteEpoch,
          logs,
          teamProgress,
          nextSinceRow: Math.max(3, logs.length + 2),
          fullSnapshot: true,
        };
      }

      for (let page = 0; page < MAX_PAGES; page++) {
        const from = page * PAGE_SIZE;
        const deltaRes = await withPromiseTimeout(
          supabaseClient
            .from('puzzle_logs')
            .select(ADMIN_LOG_SELECT_COLUMNS)
            .eq('epoch', remoteEpoch)
            .gte('last_active', overlapIso)
            .order('last_active', { ascending: true })
            .order('id', { ascending: true })
            .range(from, from + PAGE_SIZE - 1),
          8000,
          'Supabase admin logs delta'
        );
        if (deltaRes.error) throw new Error(deltaRes.error.message);
        const chunk = (deltaRes.data || []) as Record<string, unknown>[];
        collected.push(...chunk);
        if (chunk.length < PAGE_SIZE) break;
      }

      const maxIso = extractMaxActivityIso(collected);
      if (maxIso) lastAdminDeltaCursorIso = maxIso;

      const deltaLogs = collected.map((r, i) => normalizeRemoteAdminRow(r, i));
      return {
        epoch: remoteEpoch,
        logs: deltaLogs,
        teamProgress,
        nextSinceRow: Math.max(3, sinceRow + deltaLogs.length),
        fullSnapshot: false,
      };
    } catch (err) {
      if (err instanceof Error && /unauthorized/i.test(err.message)) {
        throw err;
      }
      console.warn('[Supabase] Admin fetch fallback:', err);
    }
  }

  const localEpoch = Math.max(1, Number(localStorage.getItem(STORAGE_KEYS.gameEpoch) || 1));
  return {
    epoch: localEpoch,
    logs: [],
    teamProgress: [],
    nextSinceRow: 2,
    fullSnapshot: true,
  };
}

export async function adminResetAllData(
  adminKey: string,
  clearCustomCatalog = false
): Promise<number> {
  lastAdminDeltaEpoch = 0;
  lastAdminDeltaCursorIso = null;
  const curEpoch = Math.max(1, Number(localStorage.getItem(STORAGE_KEYS.gameEpoch) || 1));
  let nextEpoch = Math.min(1000000, curEpoch + 1);

  const supabaseClient = isBrowserOnline() ? getSupabaseClient() : null;
  const adminCreds = getStoredAdminCredentials(adminKey);
  if (supabaseClient) {
    let handledViaRpc = false;
    if (adminCreds && !unavailableRpcs.has('admin_reset_all_data')) {
      try {
        const rpcRes = await withPromiseTimeout(
          supabaseClient.rpc('admin_reset_all_data', {
            p_email: adminCreds.email,
            p_password: adminCreds.password,
            p_clear_catalog: clearCustomCatalog,
          }),
          10000,
          'Supabase admin_reset_all_data RPC'
        );
        if (!rpcRes.error && typeof rpcRes.data === 'number') {
          nextEpoch = Math.max(nextEpoch, Math.floor(rpcRes.data));
          handledViaRpc = true;
        } else if (rpcRes.error) {
          if (isRpcMissingError(rpcRes.error)) {
            markRpcUnavailable('admin_reset_all_data');
          } else {
            throw new Error(rpcRes.error.message);
          }
        }
      } catch (err) {
        if (err instanceof Error && /unauthorized/i.test(err.message)) {
          throw err;
        }
        console.warn('[Supabase] Reset RPC error:', err);
      }
    }

    if (!handledViaRpc) {
      try {
        const metaRes = await withPromiseTimeout(
          supabaseClient.from('game_meta').select('epoch').eq('id', 1).maybeSingle(),
          4000,
          'Supabase reset meta'
        );
        const remoteEpoch = Number(metaRes.data?.epoch || curEpoch);
        nextEpoch = Math.min(1000000, Math.max(nextEpoch, Math.floor(remoteEpoch) + 1));

        const ops: PromiseLike<{ error: { message: string } | null }>[] = [
          supabaseClient.from('puzzle_logs').delete().neq('id', ''),
          supabaseClient.from('team_progress').delete().neq('tid', ''),
          supabaseClient.from('team_registrations').delete().neq('registration_id', ''),
          supabaseClient
            .from('game_meta')
            .upsert({ id: 1, epoch: nextEpoch, updated_at: new Date().toISOString() }, { onConflict: 'id' }),
        ];
        if (clearCustomCatalog) {
          ops.push(supabaseClient.from('teams').delete().neq('tid', ''));
          ops.push(supabaseClient.from('memes').delete().neq('memeid', ''));
          ops.push(supabaseClient.from('puzzles').delete().gt('id', 0));
        }
        await withPromiseTimeout(Promise.all(ops), 10000, 'Supabase reset');
      } catch (err) {
        console.warn('[Supabase] Reset error:', err);
      }
    }
  }

  wipeAllLocalGameStorage(nextEpoch, clearCustomCatalog);
  return nextEpoch;
}

export async function adminNewStartSolvedOnly(
  adminKey: string,
  currentPuzzles: Puzzle[] = []
): Promise<number> {
  lastAdminDeltaEpoch = 0;
  lastAdminDeltaCursorIso = null;
  const curEpoch = Math.max(1, Number(localStorage.getItem(STORAGE_KEYS.gameEpoch) || 1));
  let nextEpoch = Math.min(1000000, curEpoch + 1);

  const supabaseClient = isBrowserOnline() ? getSupabaseClient() : null;
  const adminCreds = getStoredAdminCredentials(adminKey);
  if (supabaseClient) {
    let handledViaRpc = false;
    if (adminCreds && !unavailableRpcs.has('admin_new_start_solved_only')) {
      try {
        const rpcRes = await withPromiseTimeout(
          supabaseClient.rpc('admin_new_start_solved_only', {
            p_email: adminCreds.email,
            p_password: adminCreds.password,
          }),
          10000,
          'Supabase admin_new_start_solved_only RPC'
        );
        if (!rpcRes.error && typeof rpcRes.data === 'number') {
          nextEpoch = Math.max(nextEpoch, Math.floor(rpcRes.data));
          handledViaRpc = true;
        } else if (rpcRes.error) {
          if (isRpcMissingError(rpcRes.error)) {
            markRpcUnavailable('admin_new_start_solved_only');
          } else {
            throw new Error(rpcRes.error.message);
          }
        }
      } catch (err) {
        if (handledViaRpc === false && err instanceof Error && !isRpcMissingError({ message: err.message })) {
          throw err;
        }
      }
    }

    if (!handledViaRpc) {
      try {
        const [metaRes, remotePuzzlesRes] = await withPromiseTimeout(
          Promise.all([
            supabaseClient.from('game_meta').select('epoch').eq('id', 1).maybeSingle(),
            currentPuzzles.length === 0
              ? supabaseClient
                  .from('puzzles')
                  .select(
                    'id,linkid,next_puzzle_id,requires_start_code,start_code,level,points,pokemon_id,pokemon_name,location_clue'
                  )
              : Promise.resolve({ data: null, error: null }),
          ]),
          4500,
          'Supabase new start meta'
        );

        const remoteEpoch = Number(metaRes.data?.epoch || curEpoch);
        nextEpoch = Math.min(1000000, Math.max(nextEpoch, Math.floor(remoteEpoch) + 1));

        const effectivePuzzles: PuzzleSummary[] =
          currentPuzzles.length > 0
            ? currentPuzzles
            : Array.isArray(remotePuzzlesRes?.data)
              ? (remotePuzzlesRes.data as Record<string, unknown>[]).map((r) =>
                  mapSupabasePuzzleRow(r, false)
                )
              : [];
        const starterUnlocked = computeLocalUnlocked(effectivePuzzles, []);
        const nowIso = new Date().toISOString();

        const ops = await withPromiseTimeout(
          Promise.all([
            supabaseClient.from('puzzle_logs').delete().neq('action', 'REGISTRATION'),
            supabaseClient
              .from('puzzle_logs')
              .update({
                epoch: nextEpoch,
                total_score: 0,
                solved_puzzles: '',
                unlocked_puzzles: starterUnlocked.join(','),
                last_active: nowIso,
              })
              .eq('action', 'REGISTRATION'),
            supabaseClient
              .from('team_progress')
              .update({
                score: 0,
                solved: [],
                unlocked: starterUnlocked,
                hints_used: [],
                current_puzzle: 0,
                tab_switches: 0,
                epoch: nextEpoch,
                updated_at: nowIso,
              })
              .neq('tid', ''),
            supabaseClient
              .from('game_meta')
              .upsert({ id: 1, epoch: nextEpoch, updated_at: nowIso }, { onConflict: 'id' }),
          ]),
          10000,
          'Supabase new start'
        );
        const failed = ops.find((r) => r.error);
        if (failed?.error) throw new Error(failed.error.message);
      } catch (err) {
        console.warn('[Supabase] New Start error:', err);
        throw err instanceof Error ? err : new Error('Failed to clear solved data in Supabase.');
      }
    }
  }

  wipeLocalSolvedDataOnly(nextEpoch);
  return nextEpoch;
}

async function bumpSupabaseCatalogVersion(localVersion: number): Promise<number> {
  const client = isBrowserOnline() ? getSupabaseClient() : null;
  if (!client) return localVersion;
  try {
    const curRes = await withPromiseTimeout(
      client.from('game_meta').select('catalog_version').eq('id', 1).maybeSingle(),
      3500,
      'Supabase read catalog version'
    );
    const remoteVer = Number(curRes.data?.catalog_version || 0);
    const nextVersion = Math.max(localVersion, remoteVer + 1);
    await withPromiseTimeout(
      client
        .from('game_meta')
        .upsert(
          { id: 1, catalog_version: nextVersion, updated_at: new Date().toISOString() },
          { onConflict: 'id' }
        ),
      4000,
      'Supabase catalog version bump'
    );
    const currentOverrides = readLocalOverrides();
    if (nextVersion > currentOverrides.catalogVersion) {
      currentOverrides.catalogVersion = nextVersion;
      writeLocalOverrides(currentOverrides);
    }
    return nextVersion;
  } catch {
    return localVersion;
  }
}

// ==========================================
// ADMIN CREATOR STUDIO (SUPABASE + IDB INVALIDATION)
// ==========================================
export function sanitizeCatalogId(raw: string, maxLen: number): string {
  return String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLen);
}

export async function adminUpsertTeams(entries: TeamEntry[], adminKey: string): Promise<number> {
  if (!entries.length) return 0;
  const overrides = readLocalOverrides();
  const delSet = new Set(overrides.teamsDelete.map((d) => d.toUpperCase()));
  const validNormalized: TeamEntry[] = [];
  entries.forEach((e) => {
    const tid = sanitizeCatalogId(String(e.tid || '').toUpperCase(), 32);
    const team = String(e.team || '').trim().slice(0, 60);
    const securityKey = String(e.securityKey || '').trim().slice(0, 64);
    const emails = extractTeamEmails(e).slice(0, 12);
    if (!tid || !team || !securityKey) return;
    delSet.delete(tid);
    const cleanEntry: TeamEntry = {
      tid,
      team,
      email: emails[0] || undefined,
      emails,
      securityKey,
      team_members: (e.team_members || []).map(String).filter(Boolean).slice(0, 12),
      isCustom: true,
    };
    overrides.teamsUpsert[tid] = cleanEntry;
    validNormalized.push(cleanEntry);
  });
  overrides.teamsDelete = Array.from(delSet);
  overrides.catalogVersion += 1;
  writeLocalOverrides(overrides);

  const client = isBrowserOnline() ? getSupabaseClient() : null;
  const adminCreds = getStoredAdminCredentials(adminKey);
  if (client && validNormalized.length > 0) {
    let syncedViaRpc = false;
    if (adminCreds && !unavailableRpcs.has('admin_upsert_teams')) {
      let rpcWorked = true;
      for (let i = 0; i < validNormalized.length; i += 200) {
        const chunk = validNormalized.slice(i, i + 200).map(toSupabaseTeamRow);
        const rpcRes = await withPromiseTimeout(
          client.rpc('admin_upsert_teams', {
            p_email: adminCreds.email,
            p_password: adminCreds.password,
            p_rows: chunk,
          }),
          10000,
          'Supabase admin_upsert_teams RPC'
        );
        if (rpcRes.error) {
          if (isRpcMissingError(rpcRes.error)) {
            markRpcUnavailable('admin_upsert_teams');
            rpcWorked = false;
            break;
          }
          throw new Error(rpcRes.error.message);
        }
      }
      syncedViaRpc = rpcWorked;
    }

    if (!syncedViaRpc) {
      for (let i = 0; i < validNormalized.length; i += 200) {
        const chunk = validNormalized.slice(i, i + 200).map(toSupabaseTeamRow);
        const { error } = await withPromiseTimeout(
          client.from('teams').upsert(chunk, { onConflict: 'tid' }),
          10000,
          'Supabase upsert teams'
        );
        if (error) throw new Error(error.message);
      }
      await bumpSupabaseCatalogVersion(overrides.catalogVersion);
    }
  }

  await invalidateCatalogCacheIdb();
  await loadMergedTeams();
  return validNormalized.length;
}

export async function adminDeleteTeamCatalog(tid: string, adminKey: string): Promise<void> {
  const cleanTid = sanitizeCatalogId(tid.toUpperCase(), 32);
  if (!cleanTid) return;
  const overrides = readLocalOverrides();
  delete overrides.teamsUpsert[cleanTid];
  if (!overrides.teamsDelete.includes(cleanTid)) {
    overrides.teamsDelete.push(cleanTid);
  }
  overrides.catalogVersion += 1;
  writeLocalOverrides(overrides);

  const client = isBrowserOnline() ? getSupabaseClient() : null;
  const adminCreds = getStoredAdminCredentials(adminKey);
  if (client) {
    let handledViaRpc = false;
    if (adminCreds && !unavailableRpcs.has('admin_delete_team')) {
      const rpcRes = await withPromiseTimeout(
        client.rpc('admin_delete_team', {
          p_email: adminCreds.email,
          p_password: adminCreds.password,
          p_tid: cleanTid,
        }),
        6000,
        'Supabase admin_delete_team RPC'
      );
      if (!rpcRes.error) {
        handledViaRpc = true;
      } else if (isRpcMissingError(rpcRes.error)) {
        markRpcUnavailable('admin_delete_team');
      } else {
        throw new Error(rpcRes.error.message);
      }
    }
    if (!handledViaRpc) {
      const { error } = await withPromiseTimeout(
        client.from('teams').delete().eq('tid', cleanTid),
        6000,
        'Supabase delete team'
      );
      if (error) throw new Error(error.message);
      await bumpSupabaseCatalogVersion(overrides.catalogVersion);
    }
  }

  await invalidateCatalogCacheIdb();
  await loadMergedTeams();
}

export async function adminUpsertMemes(entries: MemeEntry[], adminKey: string): Promise<number> {
  if (!entries.length) return 0;
  const overrides = readLocalOverrides();
  const delSet = new Set(overrides.memesDelete.map((d) => d.toUpperCase()));
  const validNormalized: MemeEntry[] = [];
  entries.forEach((e) => {
    const memeid = sanitizeCatalogId(String(e.memeid || '').toUpperCase(), 32);
    const ytlink = String(e.ytlink || '').trim().slice(0, 512);
    if (!memeid || ytlink.length < 5) return;
    const start = Math.max(0, Number(e.starttime || 0));
    const end = Math.max(0, Number(e.endtime || 0));
    delSet.delete(memeid);
    const cleanEntry: MemeEntry = {
      memeid,
      ytlink,
      starttime: start,
      endtime: end > 0 && end < start ? start : end,
      isCustom: true,
    };
    overrides.memesUpsert[memeid] = cleanEntry;
    validNormalized.push(cleanEntry);
  });
  overrides.memesDelete = Array.from(delSet);
  overrides.catalogVersion += 1;
  writeLocalOverrides(overrides);

  const client = isBrowserOnline() ? getSupabaseClient() : null;
  const adminCreds = getStoredAdminCredentials(adminKey);
  if (client && validNormalized.length > 0) {
    let handledViaRpc = false;
    if (adminCreds && !unavailableRpcs.has('admin_upsert_memes')) {
      const rpcRes = await withPromiseTimeout(
        client.rpc('admin_upsert_memes', {
          p_email: adminCreds.email,
          p_password: adminCreds.password,
          p_rows: validNormalized.map(toSupabaseMemeRow),
        }),
        8000,
        'Supabase admin_upsert_memes RPC'
      );
      if (!rpcRes.error) {
        handledViaRpc = true;
      } else if (isRpcMissingError(rpcRes.error)) {
        markRpcUnavailable('admin_upsert_memes');
      } else {
        throw new Error(rpcRes.error.message);
      }
    }
    if (!handledViaRpc) {
      const { error } = await withPromiseTimeout(
        client.from('memes').upsert(validNormalized.map(toSupabaseMemeRow), { onConflict: 'memeid' }),
        8000,
        'Supabase upsert memes'
      );
      if (error) throw new Error(error.message);
      await bumpSupabaseCatalogVersion(overrides.catalogVersion);
    }
  }

  await invalidateCatalogCacheIdb();
  return validNormalized.length;
}

export async function adminDeleteMemeCatalog(memeid: string, adminKey: string): Promise<void> {
  const cleanId = sanitizeCatalogId(memeid.toUpperCase(), 32);
  if (!cleanId) return;
  const overrides = readLocalOverrides();
  delete overrides.memesUpsert[cleanId];
  if (!overrides.memesDelete.includes(cleanId)) {
    overrides.memesDelete.push(cleanId);
  }
  overrides.catalogVersion += 1;
  writeLocalOverrides(overrides);

  const client = isBrowserOnline() ? getSupabaseClient() : null;
  const adminCreds = getStoredAdminCredentials(adminKey);
  if (client) {
    let handledViaRpc = false;
    if (adminCreds && !unavailableRpcs.has('admin_delete_meme')) {
      const rpcRes = await withPromiseTimeout(
        client.rpc('admin_delete_meme', {
          p_email: adminCreds.email,
          p_password: adminCreds.password,
          p_memeid: cleanId,
        }),
        6000,
        'Supabase admin_delete_meme RPC'
      );
      if (!rpcRes.error) {
        handledViaRpc = true;
      } else if (isRpcMissingError(rpcRes.error)) {
        markRpcUnavailable('admin_delete_meme');
      } else {
        throw new Error(rpcRes.error.message);
      }
    }
    if (!handledViaRpc) {
      const { error } = await withPromiseTimeout(
        client.from('memes').delete().eq('memeid', cleanId),
        6000,
        'Supabase delete meme'
      );
      if (error) throw new Error(error.message);
      await bumpSupabaseCatalogVersion(overrides.catalogVersion);
    }
  }

  await invalidateCatalogCacheIdb();
}

export async function adminUpsertPuzzles(entries: Puzzle[], adminKey: string): Promise<number> {
  if (!entries.length) return 0;
  const overrides = readLocalOverrides();
  const delSet = new Set(overrides.puzzlesDelete);
  const validNormalized: Puzzle[] = [];
  entries.forEach((e) => {
    const norm = normalizeLoadedPuzzle(e, true);
    if (!norm.id || !norm.linkid || !norm.answer) return;
    delSet.delete(norm.id);
    overrides.puzzlesUpsert[String(norm.id)] = norm;
    validNormalized.push(norm);
  });
  overrides.puzzlesDelete = Array.from(delSet);
  overrides.catalogVersion += 1;
  writeLocalOverrides(overrides);

  const client = isBrowserOnline() ? getSupabaseClient() : null;
  const adminCreds = getStoredAdminCredentials(adminKey);
  if (client && validNormalized.length > 0) {
    let syncedViaRpc = false;
    if (adminCreds && !unavailableRpcs.has('admin_upsert_puzzles')) {
      let rpcWorked = true;
      for (let i = 0; i < validNormalized.length; i += 100) {
        const chunk = validNormalized.slice(i, i + 100).map(toSupabasePuzzleRow);
        const rpcRes = await withPromiseTimeout(
          client.rpc('admin_upsert_puzzles', {
            p_email: adminCreds.email,
            p_password: adminCreds.password,
            p_rows: chunk,
          }),
          10000,
          'Supabase admin_upsert_puzzles RPC'
        );
        if (rpcRes.error) {
          if (isRpcMissingError(rpcRes.error)) {
            markRpcUnavailable('admin_upsert_puzzles');
            rpcWorked = false;
            break;
          }
          throw new Error(rpcRes.error.message);
        }
      }
      syncedViaRpc = rpcWorked;
    }

    if (!syncedViaRpc) {
      for (let i = 0; i < validNormalized.length; i += 100) {
        const chunk = validNormalized.slice(i, i + 100).map(toSupabasePuzzleRow);
        const { error } = await withPromiseTimeout(
          client.from('puzzles').upsert(chunk, { onConflict: 'id' }),
          10000,
          'Supabase upsert puzzles'
        );
        if (error) throw new Error(error.message);
      }
      await bumpSupabaseCatalogVersion(overrides.catalogVersion);
    }
  }

  await invalidateCatalogCacheIdb();
  return validNormalized.length;
}

export async function adminDeletePuzzleCatalog(id: number, adminKey: string): Promise<void> {
  const pid = Math.floor(Number(id));
  if (!pid || Number.isNaN(pid)) return;
  const overrides = readLocalOverrides();
  delete overrides.puzzlesUpsert[String(pid)];
  if (!overrides.puzzlesDelete.includes(pid)) {
    overrides.puzzlesDelete.push(pid);
  }
  overrides.catalogVersion += 1;
  writeLocalOverrides(overrides);

  const client = isBrowserOnline() ? getSupabaseClient() : null;
  const adminCreds = getStoredAdminCredentials(adminKey);
  if (client) {
    let handledViaRpc = false;
    if (adminCreds && !unavailableRpcs.has('admin_delete_puzzle')) {
      const rpcRes = await withPromiseTimeout(
        client.rpc('admin_delete_puzzle', {
          p_email: adminCreds.email,
          p_password: adminCreds.password,
          p_id: pid,
        }),
        6000,
        'Supabase admin_delete_puzzle RPC'
      );
      if (!rpcRes.error) {
        handledViaRpc = true;
      } else if (isRpcMissingError(rpcRes.error)) {
        markRpcUnavailable('admin_delete_puzzle');
      } else {
        throw new Error(rpcRes.error.message);
      }
    }
    if (!handledViaRpc) {
      const { error } = await withPromiseTimeout(
        client.from('puzzles').delete().eq('id', pid),
        6000,
        'Supabase delete puzzle'
      );
      if (error) throw new Error(error.message);
      await bumpSupabaseCatalogVersion(overrides.catalogVersion);
    }
  }

  await invalidateCatalogCacheIdb();
}

export async function adminSyncAllCatalogToSupabase(
  teams: TeamEntry[],
  memes: MemeEntry[],
  puzzles: Puzzle[]
): Promise<{ teams: number; memes: number; puzzles: number }> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase anon key (VITE_SUPABASE_ANON_KEY) is not configured yet.');
  }
  if (!isBrowserOnline()) {
    throw new Error('Internet connection required to push catalog to Supabase.');
  }

  const adminCreds = getStoredAdminCredentials();
  let syncedTeams = 0;
  let syncedMemes = 0;
  let syncedPuzzles = 0;

  // Prefer authenticated SECURITY DEFINER RPCs when installed
  if (adminCreds && !unavailableRpcs.has('admin_upsert_teams')) {
    syncedTeams = await adminUpsertTeams(teams, adminCreds.password);
    syncedMemes = await adminUpsertMemes(memes, adminCreds.password);
    syncedPuzzles = await adminUpsertPuzzles(puzzles, adminCreds.password);
    await invalidateCatalogCacheIdb();
    return { teams: syncedTeams, memes: syncedMemes, puzzles: syncedPuzzles };
  }

  for (let i = 0; i < teams.length; i += 200) {
    const chunk = teams.slice(i, i + 200).map(toSupabaseTeamRow);
    const { error } = await withPromiseTimeout(
      client.from('teams').upsert(chunk, { onConflict: 'tid' }),
      12000,
      'Supabase push teams'
    );
    if (error) throw new Error(error.message);
    syncedTeams += chunk.length;
  }

  if (memes.length > 0) {
    const { error } = await withPromiseTimeout(
      client.from('memes').upsert(memes.map(toSupabaseMemeRow), { onConflict: 'memeid' }),
      10000,
      'Supabase push memes'
    );
    if (error) throw new Error(error.message);
    syncedMemes = memes.length;
  }

  for (let i = 0; i < puzzles.length; i += 100) {
    const chunk = puzzles.slice(i, i + 100).map(toSupabasePuzzleRow);
    const { error } = await withPromiseTimeout(
      client.from('puzzles').upsert(chunk, { onConflict: 'id' }),
      12000,
      'Supabase push puzzles'
    );
    if (error) throw new Error(error.message);
    syncedPuzzles += chunk.length;
  }

  const localAdmins = await fetchJsonSafe<AdminCredential[]>('/data/admin.json', []);
  if (localAdmins.length > 0) {
    try {
      await withPromiseTimeout(
        client.from('admins').upsert(
          localAdmins.map((a) => ({
            email: normalizeEmail(a.email),
            password: String(a.password || '').trim(),
            updated_at: new Date().toISOString(),
          })),
          { onConflict: 'email' }
        ),
        8000,
        'Supabase push admins'
      );
    } catch {
      // admins table is intentionally locked down via RLS in hardened deployments
    }
  }

  const localMeta = getLocalGameMeta();
  await bumpSupabaseCatalogVersion(localMeta.catalogVersion + 1);
  await invalidateCatalogCacheIdb();
  return { teams: syncedTeams, memes: syncedMemes, puzzles: syncedPuzzles };
}
