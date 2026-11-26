import rawConfig from '../../data/config.json';
import type { GameConfig, MissionGroup, SelectOption } from '../types/game';

export interface CachePolicyConfig {
  readonly dbName: string;
  readonly dbVersion: number;
  readonly catalogTtlMs: number;
  readonly metaCheckMinIntervalMs: number;
  readonly syncedSubmissionRetentionMs: number;
  readonly maxCachedSyncedSubmissions: number;
}

export interface SyncPolicyConfig {
  readonly batchSize: number;
  readonly syncIntervalMs: number;
  readonly maxRetries: number;
  readonly baseBackoffMs: number;
}

export interface GameplayPolicyConfig {
  readonly defaultHintPenaltySec: number;
  readonly hintRequestTimeoutSec: number;
  readonly idleAbandonMs: number;
  readonly idleWatchdogMs: number;
}

export interface StaticAppConfig {
  readonly appName: string;
  readonly schemaVersion: number;
  readonly game: GameConfig;
  readonly cache: CachePolicyConfig;
  readonly sync: SyncPolicyConfig;
  readonly gameplay: GameplayPolicyConfig;
}

function validateAndFreezeConfig(input: typeof rawConfig): StaticAppConfig {
  const languages = (input.languages || []) as SelectOption[];
  const missionTypes = (input.missionTypes || []) as SelectOption[];
  const missionGroups = (input.missionGroups || []) as MissionGroup[];

  if (languages.length === 0 || missionGroups.length === 0) {
    throw new Error('Invalid local configuration: languages and missionGroups are required.');
  }

  const game: GameConfig = Object.freeze({
    languages: Object.freeze(languages.map((l) => Object.freeze({ ...l }))) as SelectOption[],
    missionTypes: Object.freeze(missionTypes.map((m) => Object.freeze({ ...m }))) as SelectOption[],
    missionGroups: Object.freeze(
      missionGroups.map((g) =>
        Object.freeze({
          ...g,
          missions: Object.freeze((g.missions || []).map((m) => Object.freeze({ ...m }))) as SelectOption[],
        })
      )
    ) as MissionGroup[],
  });

  const cache: CachePolicyConfig = Object.freeze({
    dbName: String(input.cache?.dbName || 'pykachu_go_cache'),
    dbVersion: Math.max(1, Number(input.cache?.dbVersion || 1)),
    catalogTtlMs: Math.max(30_000, Number(input.cache?.catalogTtlMs || 1_800_000)),
    metaCheckMinIntervalMs: Math.max(5_000, Number(input.cache?.metaCheckMinIntervalMs || 20_000)),
    syncedSubmissionRetentionMs: Math.max(60_000, Number(input.cache?.syncedSubmissionRetentionMs || 3_600_000)),
    maxCachedSyncedSubmissions: Math.max(10, Number(input.cache?.maxCachedSyncedSubmissions || 50)),
  });

  const sync: SyncPolicyConfig = Object.freeze({
    batchSize: Math.max(1, Math.min(50, Number(input.sync?.batchSize || 10))),
    syncIntervalMs: Math.max(2_000, Number(input.sync?.syncIntervalMs || 8_000)),
    maxRetries: Math.max(1, Number(input.sync?.maxRetries || 5)),
    baseBackoffMs: Math.max(500, Number(input.sync?.baseBackoffMs || 1_500)),
  });

  const gameplay: GameplayPolicyConfig = Object.freeze({
    defaultHintPenaltySec: Math.max(5, Number(input.gameplay?.defaultHintPenaltySec || 60)),
    hintRequestTimeoutSec: Math.max(5, Number(input.gameplay?.hintRequestTimeoutSec || 30)),
    idleAbandonMs: Math.max(10_000, Number(input.gameplay?.idleAbandonMs || 60_000)),
    idleWatchdogMs: Math.max(5_000, Number(input.gameplay?.idleWatchdogMs || 20_000)),
  });

  return Object.freeze({
    appName: String(input.appName || 'Pykachu Go'),
    schemaVersion: Math.max(1, Number(input.schemaVersion || 1)),
    game,
    cache,
    sync,
    gameplay,
  });
}

const STATIC_APP_CONFIG: StaticAppConfig = validateAndFreezeConfig(rawConfig);

export function getStaticAppConfig(): StaticAppConfig {
  return STATIC_APP_CONFIG;
}

export function getGameConfig(): GameConfig {
  return STATIC_APP_CONFIG.game;
}

export function getCacheConfig(): CachePolicyConfig {
  return STATIC_APP_CONFIG.cache;
}

export function getSyncConfig(): SyncPolicyConfig {
  return STATIC_APP_CONFIG.sync;
}

export function getGameplayConfig(): GameplayPolicyConfig {
  return STATIC_APP_CONFIG.gameplay;
}
