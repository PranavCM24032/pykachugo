export type LanguageCode = 'PYTHON' | 'CPP';
export type FirestoreLanguage = 'PYTHON' | 'C++';
export type StepId = 0 | 1 | 2 | 'startcode' | 3 | 4;

export interface PuzzleSummary {
  id: number;
  linkid: string;
  badgeId?: number;
  nextPuzzleId: number[];
  requiresStartCode?: boolean;
  locationClue: string;
  level: number;
  points: number;
  hasHint?: boolean;
  hintPenalty?: number;
  tabSwitchPenaltySeconds?: number;
  pokemonId: number;
  pokemonName: string;
}

export interface Puzzle extends PuzzleSummary {
  questionPython: string;
  questionCpp: string;
  answer: string;
  answerDigest?: string;
  startCode?: string;
  startCodeDigest?: string;
  hint?: string | boolean;
  hintUsed?: boolean;
  isCustom?: boolean;
}

export interface TeamEntry {
  team: string;
  securityKey: string;
  tid: string;
  email?: string;
  emails?: string[];
  team_members: string[];
  isCustom?: boolean;
}

export interface AdminCredential {
  email: string;
  password: string;
}

export interface MemeEntry {
  memeid: string;
  ytlink: string;
  starttime: number;
  endtime: number;
  isCustom?: boolean;
}

export interface SelectOption {
  value: string;
  label: string;
  icon?: string;
}

export interface MissionGroup {
  label: string;
  level: string;
  labelClass?: string;
  missions: SelectOption[];
}

export interface GameConfig {
  languages: SelectOption[];
  missionTypes: SelectOption[];
  missionGroups: MissionGroup[];
}

export interface PuzzleNotebookEntry {
  puzzleId: number;
  linkid: string;
  level: number | string;
  startedAt: number;
  unlockedAt: number | null;
  scanCount: number;
  wrongAttempts: number;
  hintsUsed: number;
  tabSwitches: number;
  solvedAt: number | null;
  dirty: boolean;
  lastActivityAt: number;
  pendingEventId?: string;
}

export interface ToastMessage {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

export interface ConfirmDialogOptions {
  title?: string;
  message?: string;
  icon?: string;
  iconClass?: string;
  titleClass?: string;
  accentClass?: string;
  primaryClass?: string;
  primaryIcon?: string;
  okText?: string;
  cancelText?: string;
}

export type PuzzleEventAction =
  | 'REGISTRATION'
  | 'SUMMARY'
  | 'SOLVED'
  | 'PUZZLE_ABANDONED'
  | 'WRONG_ATTEMPT'
  | 'HINT_USED'
  | 'PENALTY_TRIGGERED'
  | 'QR_SCANNED'
  | 'QR_BLOCKED'
  | 'PUZZLE_UNLOCKED'
  | 'UNLOCK_FAILED';

export type PuzzleEventStatus =
  | 'REGISTERED'
  | 'ACTIVE'
  | 'SOLVED'
  | 'REPEAT_SOLVE'
  | 'UNSOLVED'
  | 'ABANDONED'
  | 'BLOCKED';

export interface TeamProgressDoc {
  tid: string;
  teamName: string;
  email?: string;
  mission: string;
  language: FirestoreLanguage;
  sessionId: string;
  score: number;
  solved: number[];
  unlocked: number[];
  hintsUsed: number[];
  currentPuzzle: number;
  tabSwitches: number;
  epoch: number;
  registeredAt?: string;
  updatedAt?: string;
}

export interface PuzzleLogDoc {
  id?: string;
  tid: string;
  teamName: string;
  email?: string;
  mission: string;
  language: FirestoreLanguage;
  level: 'REG' | 'L1' | 'L2' | 'L3';
  sessionId: string;
  action: PuzzleEventAction;
  puzzleId: number;
  linkid: string;
  status: PuzzleEventStatus;
  wrongAttempts: number;
  tabSwitches: number;
  hintUsed: boolean;
  scanCount: number;
  pointsEarned: number;
  pointsLost: number;
  points: number;
  totalScore: number;
  unlockedPuzzles: string;
  epoch: number;
  clientTimestamp: string;
  createdAt?: string;
}

export const STORAGE_KEYS = {
  hintState: 'pykachuHintState',
  gameState: 'pykachuGameState',
  teamInfo: 'pykachuTeam',
  scoreState: 'pykachuScoreState',
  gameEpoch: 'pykachuGameEpoch',
  puzzleNotebook: 'pykachuPuzzleNotebook',
  catalogCache: 'pykachuCatalogCache_v1',
  teamsCache: 'pykachuTeamsCache_v1',
  localCatalogOverrides: 'pykachuLocalCatalogOverrides_v1',
  localLogs: 'pykachuLocalTelemetryLogs_v1',
  localTeamProgress: 'pykachuLocalTeamProgress_v1',
  pendingSyncQueue: 'pykachuPendingSyncQueue_v1',
  adminsCache: 'pykachuAdminsCache_v1',
  adminSessionKey: 'pykachuAdminSessionKey',
} as const;

export const HINT_SETTINGS = {
  defaultPenalty: 60,
  hintRequestTimeout: 30,
  tabSwitchResetsPenalty: true,
} as const;

export type RegistrationSyncStatus = 'draft' | 'pending' | 'syncing' | 'synced' | 'failed';
export type SubmissionSyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export interface CachedRegistrationRecord {
  registrationId: string;
  tid: string;
  teamName: string;
  email: string;
  language: LanguageCode;
  mission: string;
  sessionId: string;
  epoch: number;
  isValidated: boolean;
  status: RegistrationSyncStatus;
  retryCount: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  syncedAt?: number;
}

export interface CachedSubmissionRecord {
  submissionId: string;
  dedupeKey: string;
  kind: 'SOLVE' | 'EVENT';
  action: PuzzleEventAction;
  tid: string;
  teamName: string;
  email?: string;
  mission: string;
  language: FirestoreLanguage;
  sessionId: string;
  epoch: number;
  puzzleId: number;
  linkid: string;
  level: number;
  levelTag: 'REG' | 'L1' | 'L2' | 'L3';
  submittedAnswer?: string;
  repeat: boolean;
  pointsDelta: number;
  newScore: number;
  solved: number[];
  unlocked: number[];
  hintsUsed: number[];
  tabSwitchesTotal: number;
  wrongAttempts: number;
  tabSwitches: number;
  hintUsed: boolean;
  scanCount: number;
  logId?: string;
  statusValue: PuzzleEventStatus | '';
  progressPatch?: Partial<{
    hintsUsed: number[];
    tabSwitches: number;
    currentPuzzle: number;
  }>;
  supabaseLog?: Record<string, unknown>;
  supabaseProgress?: TeamProgressDoc;
  status: SubmissionSyncStatus;
  retryCount: number;
  nextRetryAt: number;
  lastError?: string;
  createdAt: number;
  syncedAt?: number;
}

export interface CatalogCacheMeta {
  metaKey: string;
  epoch: number;
  catalogVersion: number;
  puzzleCount: number;
  memeCount: number;
  teamTid: string;
  fetchedAt: number;
  expiresAt: number;
  verifiedStorage: boolean;
}

export interface SyncStatusSummary {
  online: boolean;
  pendingCount: number;
  syncingCount: number;
  failedCount: number;
  syncedCount: number;
  catalogSyncing: boolean;
  registrationStatus: RegistrationSyncStatus | null;
  registrationError?: string;
  lastSyncError?: string;
  lastSyncedAt?: number;
}

