import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getMuted,
  initAudio,
  pauseBgmForLockdown,
  playSound,
  prewarmCelebrationAudio,
  resumeBgmAfterLockdown,
  toggleBgm,
  toggleMute,
} from './services/audio';
import { getGameConfig, getGameplayConfig } from './services/configService';
import {
  authenticateTeamCredentials,
  clearGameStateLocal,
  computeLocalUnlocked,
  deletePuzzleNotebookEntry,
  extractUniversalScanCode,
  fetchServerGameEpoch,
  flushPendingSubmissions,
  generateSessionId,
  getCachedMemeById,
  getCachedNextPuzzles,
  getCachedPuzzleById,
  getCachedPuzzleByLinkId,
  getDeepLinkCodeFromLocation,
  getHintUsedLocal,
  getLeadPuzzleIds,
  getPuzzleNotebook,
  getPuzzleQuestion,
  getRememberedTeamInfo,
  getSavedGameState,
  getSyncStatusSnapshot,
  getTeamScoreStateLocal,
  hydrateSessionFromIndexedDb,
  isPuzzleAllowed,
  isStartingPuzzle,
  isValidEmail,
  normalizeEmail,
  notepadBumpLocal,
  notepadStartLocal,
  puzzleGateMessage,
  puzzleHasHint,
  readCachedCatalogSummaries,
  recordPuzzleEventToDb,
  recordPuzzleSolveToDb,
  retrieveAndCacheCatalogOnScan,
  saveGameStateLocal,
  saveHintUsedLocal,
  saveRegistrationDraftLocal,
  saveRememberedTeamInfo,
  saveTeamScoreStateLocal,
  standardizeString,
  startOutboxSyncLoop,
  submitAndSyncRegistration,
  subscribeSyncStatus,
  updateTeamCurrentPuzzleInDb,
  verifyPuzzleAnswer,
  verifyPuzzleStartCode,
  wipeAllLocalGameStorage,
} from './services/gameBackend';
import { preloadGameAssets, preloadPuzzleFocusAssets } from './services/assetPreloader';
import {
  HINT_SETTINGS,
  STORAGE_KEYS,
  type LanguageCode,
  type MemeEntry,
  type Puzzle,
  type PuzzleSummary,
  type StepId,
  type SyncStatusSummary,
  type ToastMessage,
} from './types/game';
import { LoaderSplash } from './components/LoaderSplash';
import { ToastContainer } from './components/ToastContainer';
import { PenaltyOverlay } from './components/PenaltyOverlay';
import { SignOutOverlay } from './components/SignOutOverlay';
import { CameraGuideOverlay } from './components/CameraGuideOverlay';
import { MemePlayerOverlay } from './components/MemePlayerOverlay';
import { Step0Rules } from './components/Step0Rules';
import { Step1Login } from './components/Step1Login';
import { Step2Scanner } from './components/Step2Scanner';
import { StartCodeStep } from './components/StartCodeStep';
import { Step3Puzzle } from './components/Step3Puzzle';
import { PortraitLockOverlay } from './components/PortraitLockOverlay';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallButton } from './components/PWAInstallButton';
import { AppIcon } from './components/AppIcon';

const loadStep4Success = () => import('./components/Step4Success');
const Step4Success = lazy(() => loadStep4Success().then((m) => ({ default: m.Step4Success })));
const AdminDashboard = lazy(() =>
  import('./components/AdminDashboard').then((m) => ({ default: m.AdminDashboard }))
);

function checkIsAdminRoute(): boolean {
  const path = window.location.pathname.toLowerCase().replace(/\/+$/, '');
  const hash = window.location.hash.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  return path.endsWith('/admin') || hash === '#admin' || params.get('admin') === '1';
}

export default function App() {
  const [isAdminRoute, setIsAdminRoute] = useState<boolean>(checkIsAdminRoute);

  useEffect(() => {
    const syncRoute = () => setIsAdminRoute(checkIsAdminRoute());
    window.addEventListener('popstate', syncRoute);
    window.addEventListener('hashchange', syncRoute);
    return () => {
      window.removeEventListener('popstate', syncRoute);
      window.removeEventListener('hashchange', syncRoute);
    };
  }, []);

  // Best-effort privacy blackout for screenshot shortcuts and app focus loss.
  useEffect(() => {
    let restoreTimer: number | null = null;
    const blackout = (duration = 0) => {
      document.documentElement.classList.add('screenshot-blackout-active');
      if (restoreTimer !== null) window.clearTimeout(restoreTimer);
      restoreTimer = duration > 0
        ? window.setTimeout(() => {
            document.documentElement.classList.remove('screenshot-blackout-active');
            restoreTimer = null;
          }, duration)
        : null;
    };
    const restore = () => {
      if (document.hidden) return;
      if (restoreTimer !== null) window.clearTimeout(restoreTimer);
      restoreTimer = window.setTimeout(() => {
        document.documentElement.classList.remove('screenshot-blackout-active');
        restoreTimer = null;
      }, 350);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'PrintScreen' && event.code !== 'PrintScreen' && event.key !== 'Snapshot') return;
      event.preventDefault();
      blackout(1600);
    };
    const onBlur = () => blackout();
    const onVisibilityChange = () => (document.hidden ? blackout() : restore());

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', restore);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', restore);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (restoreTimer !== null) window.clearTimeout(restoreTimer);
      document.documentElement.classList.remove('screenshot-blackout-active');
    };
  }, []);

  useEffect(() => {
    if (window.location.protocol !== 'https:') return;
    const currentUrl = window.location.origin + window.location.pathname;
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canonical) canonical.href = currentUrl;
    const ogUrl = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
    if (ogUrl) ogUrl.content = currentUrl;
  }, [isAdminRoute]);

  if (isAdminRoute) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-[#030712]" />}>
        <AdminDashboard />
      </Suspense>
    );
  }

  return <PokedexGameApp />;
}

const PokedexGameApp: React.FC = () => {
  // Static config (never fetched from Supabase) & lightweight navigation index
  const config = useMemo(() => getGameConfig(), []);
  const gameplayConfig = useMemo(() => getGameplayConfig(), []);
  const [puzzleSummaries, setPuzzleSummaries] = useState<PuzzleSummary[]>([]);
  const catalogVersionRef = useRef<number>(1);
  const [booted, setBooted] = useState(false);

  // Sync status summary (for silent outbox flush, login progress bar & beforeunload guard)
  const [syncSummary, setSyncSummary] = useState<SyncStatusSummary>(getSyncStatusSnapshot);
  const [syncBarPhase, setSyncBarPhase] = useState<'idle' | 'syncing' | 'completing'>('idle');
  const [syncBarProgress, setSyncBarProgress] = useState(0);
  const loginSyncTokenRef = useRef(0);
  const syncHideTimerRef = useRef<number | null>(null);

  // UI & Flow State
  const [currentStep, setCurrentStep] = useState<StepId>(0);
  const [isCrtOn, setIsCrtOn] = useState(true);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [signOutVisible, setSignOutVisible] = useState(false);
  const [cameraGuideState, setCameraGuideState] = useState<{
    visible: boolean;
    reason: 'inapp' | 'permission';
  }>({ visible: false, reason: 'permission' });
  const [activeMeme, setActiveMeme] = useState<MemeEntry | null>(null);

  // Team & Session State
  const [currentTeam, setCurrentTeam] = useState('');
  const [currentTeamTid, setCurrentTeamTid] = useState('');
  const [currentMissionLevel, setCurrentMissionLevel] = useState('');
  const [currentLanguage, setCurrentLanguage] = useState<LanguageCode>('PYTHON');
  const [sessionId, setSessionId] = useState<string>(() => generateSessionId());
  const [epoch, setEpoch] = useState<number>(() =>
    Math.max(1, Number(localStorage.getItem(STORAGE_KEYS.gameEpoch) || 1))
  );

  // Progress State
  const [score, setScore] = useState(0);
  const [solvedIds, setSolvedIds] = useState<number[]>([]);
  const [unlockedIds, setUnlockedIds] = useState<number[]>([]);
  const [hintsUsedIds, setHintsUsedIds] = useState<number[]>([]);
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const tabSwitchCountRef = useRef(0);

  // Active Puzzle (only active puzzle + immediate next cards loaded into RAM from IndexedDB)
  const [currentPuzzle, setCurrentPuzzle] = useState<Puzzle | null>(null);
  const [nextPuzzles, setNextPuzzles] = useState<Puzzle[]>([]);
  const [urlLockedPuzzle, setUrlLockedPuzzle] = useState<Puzzle | null>(null);
  const pendingDeepLinkRef = useRef<{ linkId: string; memeId: string; rawSlug: string } | null>(null);

  // Form fields (Step 1)
  const [formEmail, setFormEmail] = useState('');
  const [formSecurityKey, setFormSecurityKey] = useState('');
  const [formLanguage, setFormLanguage] = useState<LanguageCode>('PYTHON');
  const [formMissionLevel, setFormMissionLevel] = useState('');
  const [regFeedback, setRegFeedback] = useState<{
    message: string;
    type: 'error' | 'success' | 'info';
  } | null>(null);
  const [regShakeField, setRegShakeField] = useState<'email' | 'teamSecurityKey' | null>(null);
  const [isRegSubmitting, setIsRegSubmitting] = useState(false);

  // Startcode form
  const [unlockCode, setUnlockCode] = useState('');
  const [unlockFeedback, setUnlockFeedback] = useState<{
    message: string;
    type: 'error' | 'success' | 'info';
  } | null>(null);
  const [unlockShake, setUnlockShake] = useState(false);

  // Step 3 Puzzle Terminal
  const [puzzleStartMs, setPuzzleStartMs] = useState<number>(Date.now());
  const [answerValue, setAnswerValue] = useState('');
  const [answerShake, setAnswerShake] = useState(false);
  const pendingHintResumeRef = useRef(false);
  const answerLockedRef = useRef(false);
  const answerInputRef = useRef<HTMLInputElement | null>(null);

  // Step 4 Reveal
  const [revealKey, setRevealKey] = useState(0);
  const [screenGlow, setScreenGlow] = useState(false);
  const [screenGlitch, setScreenGlitch] = useState(false);

  // Penalty (Officer Jenny)
  const [penaltyVisible, setPenaltyVisible] = useState(false);
  const [penaltySeconds, setPenaltySeconds] = useState(15);
  const [penaltyTotalSeconds, setPenaltyTotalSeconds] = useState(15);
  const [penaltyRingIteration, setPenaltyRingIteration] = useState(0);
  const [penaltyScreenActive, setPenaltyScreenActive] = useState(true);
  const [penaltyResetCount, setPenaltyResetCount] = useState(0);
  const penaltyVisibleRef = useRef(false);
  const penaltyRemainingMsRef = useRef<number>(15000);
  const penaltyLastTickMsRef = useRef<number | null>(null);
  const wasAwayRef = useRef<boolean>(false);
  const penaltyOnFinishRef = useRef<(() => void) | null>(null);

  // Hint System (Brock)
  const [hintRequestOpen, setHintRequestOpen] = useState(false);
  const [hintPenaltyOpen, setHintPenaltyOpen] = useState(false);
  const [hintPenaltySeconds, setHintPenaltySeconds] = useState<number>(HINT_SETTINGS.defaultPenalty);
  const [hintPenaltyRingIteration, setHintPenaltyRingIteration] = useState(0);
  const [hintScreenActive, setHintScreenActive] = useState(true);
  const [hintFocusLost, setHintFocusLost] = useState(false);
  const [hintDisplayOpen, setHintDisplayOpen] = useState(false);

  const hintRequestTimeoutRef = useRef<number | null>(null);
  const hintPenaltyIntervalRef = useRef<number | null>(null);
  const hintPenaltyActiveRef = useRef(false);
  const hintMalpracticeRunningRef = useRef(false);
  const hintSecondsRef = useRef<number>(HINT_SETTINGS.defaultPenalty);
  const regShakeTimerRef = useRef<number | null>(null);
  const unlockShakeTimerRef = useRef<number | null>(null);
  const answerShakeTimerRef = useRef<number | null>(null);
  const glitchTimerRef = useRef<number | null>(null);

  // Hardware & DOM Refs
  const screenRef = useRef<HTMLDivElement | null>(null);
  const celebrationCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const powerTimerRef = useRef<number | null>(null);
  const powerLongPressedRef = useRef(false);
  const aux1Ref = useRef<HTMLDivElement | null>(null);
  const aux2Ref = useRef<HTMLDivElement | null>(null);

  const isLoggedIn = Boolean(currentTeam && currentTeam.trim() !== '');
  const teamKey = currentTeamTid || currentTeam;
  const currentTeamTidRef = useRef(currentTeamTid);
  currentTeamTidRef.current = currentTeamTid;
  tabSwitchCountRef.current = tabSwitchCount;

  const solvedSet = useMemo(() => new Set<number>(solvedIds.map(Number)), [solvedIds]);
  const unlockedSet = useMemo(() => new Set<number>(unlockedIds.map(Number)), [unlockedIds]);
  const hintsUsedSet = useMemo(() => new Set<number>(hintsUsedIds.map(Number)), [hintsUsedIds]);

  const showToast = useCallback(
    (message: string, type: 'info' | 'success' | 'error' = 'info') => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev, { id, message, type }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3000);
    },
    []
  );

  // Subscribe to Tier 2 outbox state for safe unload guard
  useEffect(() => {
    return subscribeSyncStatus(setSyncSummary);
  }, []);

  // Surface offline-ready readiness once SW finishes precaching
  useEffect(() => {
    const onOfflineReady = () => {
      showToast('App cached for offline play!', 'success');
    };
    window.addEventListener('pykachu:offline-ready', onOfflineReady);
    return () => window.removeEventListener('pykachu:offline-ready', onOfflineReady);
  }, [showToast]);

  const clearSyncBarTimers = useCallback(() => {
    if (syncHideTimerRef.current !== null) {
      window.clearTimeout(syncHideTimerRef.current);
      syncHideTimerRef.current = null;
    }
  }, []);

  const startSyncBar = useCallback(
    (initialProgress: number) => {
      clearSyncBarTimers();
      setSyncBarPhase('syncing');
      setSyncBarProgress(Math.max(0.05, Math.min(0.95, initialProgress)));
    },
    [clearSyncBarTimers]
  );

  const advanceSyncBar = useCallback(
    (nextProgress: number) => {
      clearSyncBarTimers();
      setSyncBarPhase('syncing');
      setSyncBarProgress((prev) => Math.max(prev, Math.min(0.95, nextProgress)));
    },
    [clearSyncBarTimers]
  );

  const completeSyncBar = useCallback(() => {
    clearSyncBarTimers();
    setSyncBarPhase('completing');
    setSyncBarProgress(1);
    syncHideTimerRef.current = window.setTimeout(() => {
      syncHideTimerRef.current = null;
      setSyncBarPhase('idle');
      setSyncBarProgress(0);
    }, 340);
  }, [clearSyncBarTimers]);

  const resetSyncBar = useCallback(() => {
    clearSyncBarTimers();
    setSyncBarPhase('idle');
    setSyncBarProgress(0);
  }, [clearSyncBarTimers]);

  useEffect(() => {
    return () => clearSyncBarTimers();
  }, [clearSyncBarTimers]);

  useEffect(() => {
    if (currentStep !== 1) {
      resetSyncBar();
    }
  }, [currentStep, resetSyncBar]);

  useEffect(() => {
    if (!booted) return;
    return startOutboxSyncLoop();
  }, [booted]);

  // Re-warm UI assets and celebration audio automatically if device reconnects online
  useEffect(() => {
    if (!booted) return;
    const handleReconnect = () => {
      preloadGameAssets([], config);
      if (currentPuzzle) {
        const nextTargets = (currentPuzzle.nextPuzzleId || [])
          .map((nid) => puzzleSummaries.find((s) => Number(s.id) === Number(nid)))
          .filter((s): s is PuzzleSummary => Boolean(s));
        preloadPuzzleFocusAssets(currentPuzzle, nextTargets);
      }
      prewarmCelebrationAudio();
    };
    window.addEventListener('online', handleReconnect);
    return () => window.removeEventListener('online', handleReconnect);
  }, [booted, puzzleSummaries, currentPuzzle, config]);

  // Pause active BGM cleanly while a blocking Officer Jenny penalty or YouTube meme overlay is showing
  useEffect(() => {
    if (penaltyVisible || Boolean(activeMeme)) {
      pauseBgmForLockdown();
    } else {
      resumeBgmAfterLockdown();
    }
  }, [penaltyVisible, activeMeme]);

  // Persist minimal gameState on change only while logged in (never overwrite saved session on initial logout/boot)
  useEffect(() => {
    if (!booted || !isLoggedIn) return;
    saveGameStateLocal({
      currentStep,
      currentTeam,
      currentTeamTid,
      currentMissionLevel,
      currentLanguage,
      sessionId,
      tabSwitchCount,
      currentPuzzleId: currentPuzzle ? currentPuzzle.id : null,
    });
  }, [
    booted,
    isLoggedIn,
    currentStep,
    currentTeam,
    currentTeamTid,
    currentMissionLevel,
    currentLanguage,
    sessionId,
    tabSwitchCount,
    currentPuzzle,
  ]);

  // Boot app: instant local hydration from static config + IndexedDB (zero Supabase puzzle queries until scan)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const localEpoch = Math.max(1, Number(localStorage.getItem(STORAGE_KEYS.gameEpoch) || 1));
        const [{ rememberedTeam, savedState, latestRegistration }, cachedCatalog] = await Promise.all([
          hydrateSessionFromIndexedDb(localEpoch),
          readCachedCatalogSummaries(localEpoch),
        ]);
        if (cancelled) return;

        initAudio();

        const loadedSummaries = cachedCatalog?.summaries || [];
        if (cachedCatalog && loadedSummaries.length > 0) {
          setPuzzleSummaries(loadedSummaries);
          catalogVersionRef.current = cachedCatalog.catalogVersion;
        }

        const schedulePreload = () => {
          preloadGameAssets(cachedCatalog && loadedSummaries.length > 0 ? loadedSummaries : [], config);
        };
        if (typeof window.requestIdleCallback === 'function') {
          window.requestIdleCallback(schedulePreload, { timeout: 1000 });
        } else {
          window.setTimeout(schedulePreload, 0);
        }

        const deepLink = getDeepLinkCodeFromLocation();
        if (deepLink.linkId || deepLink.memeId || deepLink.rawSlug) {
          pendingDeepLinkRef.current = deepLink;
          if (cachedCatalog && (deepLink.memeId || deepLink.rawSlug)) {
            const memeId = deepLink.memeId || deepLink.rawSlug;
            const cachedMeme = await getCachedMemeById(localEpoch, memeId);
            if (cachedMeme && !cancelled) {
              pendingDeepLinkRef.current = null;
              window.setTimeout(() => {
                if (!cancelled) setActiveMeme(cachedMeme);
              }, 50);
            }
          }
          if (cachedCatalog && (deepLink.linkId || deepLink.rawSlug)) {
            const linkCode = deepLink.linkId || deepLink.rawSlug;
            const cachedDeepPuzzle = await getCachedPuzzleByLinkId(localEpoch, linkCode);
            if (cachedDeepPuzzle && isStartingPuzzle(cachedDeepPuzzle) && !cancelled) {
              setUrlLockedPuzzle(cachedDeepPuzzle);
            }
          }
        }

        const defaultLang = (config.languages?.[0]?.value as LanguageCode) || 'PYTHON';
        const defaultMission = config.missionGroups?.[0]?.missions?.[0]?.value || 'L1_GRASS';
        const legacyMappings: Record<string, string> = {
          L2_CHARIZARD: 'L2_GHOST',
          L2_GRENINJA: 'L2_FAIRY',
        };

        if (latestRegistration) {
          setFormEmail(latestRegistration.email || '');
          setFormLanguage(latestRegistration.language || defaultLang);
          const mappedMission =
            legacyMappings[latestRegistration.mission] || latestRegistration.mission;
          setFormMissionLevel(mappedMission || defaultMission);
        } else if (rememberedTeam) {
          setFormEmail(rememberedTeam.email || '');
          setFormLanguage(rememberedTeam.language || defaultLang);
          const mappedMission =
            legacyMappings[rememberedTeam.mission] || rememberedTeam.mission;
          setFormMissionLevel(mappedMission || defaultMission);
        } else {
          setFormLanguage(defaultLang);
          setFormMissionLevel(defaultMission);
        }

        // Seamless cache-first session recovery across browser refresh (Step 2 / 3 / 4 / startcode)
        if (
          savedState.currentTeam &&
          savedState.currentTeamTid &&
          (savedState.currentStep === 2 ||
            savedState.currentStep === 3 ||
            savedState.currentStep === 4 ||
            savedState.currentStep === 'startcode')
        ) {
          const tid = savedState.currentTeamTid;
          const teamScoreState = getTeamScoreStateLocal(tid);
          const restoredUnlocked = Array.from(
            new Set([
              ...teamScoreState.unlocked,
              ...computeLocalUnlocked(loadedSummaries, teamScoreState.solved),
            ])
          ).sort((a, b) => a - b);

          setCurrentTeam(savedState.currentTeam);
          setCurrentTeamTid(tid);
          setCurrentMissionLevel(
            legacyMappings[savedState.currentMissionLevel || ''] ||
              savedState.currentMissionLevel ||
              defaultMission
          );
          setCurrentLanguage((savedState.currentLanguage as LanguageCode) || defaultLang);
          if (savedState.sessionId) setSessionId(savedState.sessionId);
          setTabSwitchCount(Number(savedState.tabSwitchCount || 0));
          setScore(teamScoreState.score);
          setSolvedIds(teamScoreState.solved);
          setUnlockedIds(restoredUnlocked);
          setHintsUsedIds(teamScoreState.hintsUsed);

          if ((savedState.currentStep === 3 || savedState.currentStep === 4) && savedState.currentPuzzleId) {
            const restoredPuzzle = await getCachedPuzzleById(localEpoch, Number(savedState.currentPuzzleId));
            if (restoredPuzzle && !cancelled) {
              setCurrentPuzzle(restoredPuzzle);
              setCurrentStep(savedState.currentStep);
            } else if (!cancelled) {
              setCurrentStep(2);
            }
          } else if (savedState.currentStep === 'startcode' && savedState.currentPuzzleId) {
            const locked = await getCachedPuzzleById(localEpoch, Number(savedState.currentPuzzleId));
            if (locked && !cancelled) {
              setUrlLockedPuzzle(locked);
              setCurrentStep('startcode');
            } else if (!cancelled) {
              setCurrentStep(2);
            }
          } else if (!cancelled) {
            setCurrentStep(2);
          }
        }
      } catch (err) {
        console.error('[Startup] Failed to hydrate IndexedDB session:', err);
      } finally {
        if (!cancelled) setBooted(true);
      }
    })();

    const onVisChange = () => {
      document.documentElement.classList.toggle('page-hidden', document.hidden);
    };
    document.addEventListener('visibilitychange', onVisChange);

    try {
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (o: string) => Promise<void>;
      };
      if (orientation && typeof orientation.lock === 'function') {
        orientation.lock('portrait-primary').catch(() => {});
      }
    } catch {
      // ignore unsupported orientation lock
    }

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisChange);
    };
  }, [config]);

  // Save valid registration draft into IndexedDB without calling Supabase on input changes
  useEffect(() => {
    if (!booted || currentStep !== 1) return;
    const timer = window.setTimeout(() => {
      void saveRegistrationDraftLocal({
        email: formEmail,
        language: formLanguage,
        mission: formMissionLevel,
        sessionId,
        epoch,
        hasSecurityKey: Boolean(formSecurityKey.trim()),
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [booted, currentStep, formEmail, formLanguage, formMissionLevel, formSecurityKey, sessionId, epoch]);

  // Keep unlockedIds synced with current lead puzzles whenever summaries/solvedIds update
  useEffect(() => {
    if (!booted || puzzleSummaries.length === 0) return;
    setUnlockedIds((prev) => {
      const computed = computeLocalUnlocked(puzzleSummaries, solvedIds);
      const merged = Array.from(new Set([...prev, ...computed])).sort((a, b) => a - b);
      if (merged.length === prev.length && merged.every((v, i) => v === prev[i])) return prev;
      return merged;
    });
  }, [booted, puzzleSummaries, solvedIds]);

  // Load ONLY the 1-3 immediate next destination cards from IndexedDB when active puzzle changes
  useEffect(() => {
    if (!currentPuzzle) {
      setNextPuzzles([]);
      return;
    }
    let cancelled = false;
    void getCachedNextPuzzles(epoch, currentPuzzle).then((cards) => {
      if (!cancelled) setNextPuzzles(cards);
    });
    return () => {
      cancelled = true;
    };
  }, [epoch, currentPuzzle]);

  // Warm Step 4 Three.js chunk gently while player is on Step 3 (celebration audio only for final puzzle)
  useEffect(() => {
    if (currentStep !== 3) return;
    const isFinalPuzzle =
      Boolean(currentPuzzle) &&
      (!Array.isArray(currentPuzzle?.nextPuzzleId) || currentPuzzle.nextPuzzleId.length === 0);
    const schedule =
      typeof window.requestIdleCallback === 'function'
        ? (cb: () => void) => window.requestIdleCallback(cb, { timeout: 1200 })
        : (cb: () => void) => window.setTimeout(cb, 350);
    const id = schedule(() => {
      void loadStep4Success();
      if (isFinalPuzzle) prewarmCelebrationAudio();
    });
    return () => {
      if (typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(id as number);
      } else {
        window.clearTimeout(id as number);
      }
    };
  }, [currentStep, currentPuzzle]);

  // Cleanup helpers for Hint + Penalty
  const clearPenalty = useCallback(() => {
    penaltyVisibleRef.current = false;
    wasAwayRef.current = false;
    penaltyRemainingMsRef.current = 15000;
    penaltyLastTickMsRef.current = null;
    setPenaltyVisible(false);
    setPenaltySeconds(15);
    setPenaltyTotalSeconds(15);
    setPenaltyResetCount(0);
    setPenaltyScreenActive(true);
    penaltyOnFinishRef.current = null;
  }, []);

  const cleanupHintSystem = useCallback(() => {
    if (hintPenaltyIntervalRef.current !== null) {
      window.clearInterval(hintPenaltyIntervalRef.current);
      hintPenaltyIntervalRef.current = null;
    }
    if (hintRequestTimeoutRef.current !== null) {
      window.clearTimeout(hintRequestTimeoutRef.current);
      hintRequestTimeoutRef.current = null;
    }
    hintPenaltyActiveRef.current = false;
    hintMalpracticeRunningRef.current = false;
    pendingHintResumeRef.current = false;
    setHintRequestOpen(false);
    setHintPenaltyOpen(false);
    setHintDisplayOpen(false);
    setHintFocusLost(false);
    setHintScreenActive(true);
  }, []);

  // Stop hint/penalty timers whenever leaving Step 3
  useEffect(() => {
    if (currentStep !== 3) {
      cleanupHintSystem();
      clearPenalty();
    }
  }, [currentStep, cleanupHintSystem, clearPenalty]);

  const recordTabSwitchPenalty = useCallback(() => {
    const nextTabs = tabSwitchCountRef.current + 1;
    tabSwitchCountRef.current = nextTabs;
    setTabSwitchCount(nextTabs);

    if (teamKey && currentPuzzle) {
      const nb = notepadBumpLocal(teamKey, 'tabswitch', currentPuzzle);
      void recordPuzzleEventToDb({
        tid: currentTeamTid,
        teamName: currentTeam,
        mission: currentMissionLevel,
        language: currentLanguage,
        sessionId,
        action: 'PENALTY_TRIGGERED',
        status: 'ACTIVE',
        puzzleId: currentPuzzle.id,
        linkid: currentPuzzle.linkid,
        level: currentPuzzle.level,
        wrongAttempts: nb?.wrongAttempts ?? 0,
        tabSwitches: nb?.tabSwitches ?? nextTabs,
        hintUsed: hintsUsedSet.has(currentPuzzle.id),
        scanCount: nb?.scanCount ?? 0,
        totalScore: score,
        unlocked: unlockedIds,
        epoch,
        updateProgressFields: { tabSwitches: nextTabs },
      });
    }
  }, [
    teamKey,
    currentPuzzle,
    currentTeamTid,
    currentTeam,
    currentMissionLevel,
    currentLanguage,
    sessionId,
    hintsUsedSet,
    score,
    unlockedIds,
    epoch,
  ]);

  // Blocking Officer Jenny Penalty (ticks ONLY on active screen; resets + re-penalizes on repeat switch)
  const triggerJennyPenalty = useCallback(
    (onFinish?: () => void) => {
      const activeNow =
        !document.hidden && (typeof document.hasFocus !== 'function' || document.hasFocus());

      const penaltyDurationSeconds = Math.max(
        0,
        Math.floor(Number(currentPuzzle?.tabSwitchPenaltySeconds ?? 15))
      );

      if (penaltyDurationSeconds === 0) {
        recordTabSwitchPenalty();
        playSound('penalty');
        if (onFinish) onFinish();
        return;
      }

      penaltyRemainingMsRef.current = penaltyDurationSeconds * 1000;
      penaltyLastTickMsRef.current = null;
      setPenaltySeconds(penaltyDurationSeconds);
      setPenaltyTotalSeconds(penaltyDurationSeconds);
      setPenaltyRingIteration((n) => n + 1);
      setPenaltyScreenActive(activeNow);

      if (penaltyVisibleRef.current) {
        if (!penaltyOnFinishRef.current && onFinish) {
          penaltyOnFinishRef.current = onFinish;
        }
        setPenaltyResetCount((c) => c + 1);
        playSound('penalty');
        recordTabSwitchPenalty();
        showToast('Tab switch during penalty! Penalty added & timer reset.', 'error');
        return;
      }

      penaltyVisibleRef.current = true;
      penaltyOnFinishRef.current = onFinish || null;
      setPenaltyResetCount(0);
      setPenaltyVisible(true);
      playSound('penalty');
      recordTabSwitchPenalty();
    },
    [currentPuzzle, recordTabSwitchPenalty, showToast]
  );

  // Active-screen-only countdown tick for Officer Jenny Penalty
  useEffect(() => {
    if (!penaltyVisible || !penaltyScreenActive) {
      penaltyLastTickMsRef.current = null;
      return;
    }

    penaltyLastTickMsRef.current = Date.now();
    const id = window.setInterval(() => {
      if (document.hidden || (typeof document.hasFocus === 'function' && !document.hasFocus())) {
        penaltyLastTickMsRef.current = null;
        setPenaltyScreenActive(false);
        return;
      }

      const now = Date.now();
      const last = penaltyLastTickMsRef.current ?? now;
      const delta = Math.max(0, now - last);
      penaltyLastTickMsRef.current = now;

      const nextMs = Math.max(0, penaltyRemainingMsRef.current - delta);
      penaltyRemainingMsRef.current = nextMs;
      const nextSec = Math.ceil(nextMs / 1000);
      setPenaltySeconds(nextSec);

      if (nextMs <= 0) {
        window.clearInterval(id);
        penaltyVisibleRef.current = false;
        penaltyLastTickMsRef.current = null;
        wasAwayRef.current = false;
        setPenaltyVisible(false);
        setPenaltyResetCount(0);
        playSound('penaltyComplete');
        const cb = penaltyOnFinishRef.current;
        penaltyOnFinishRef.current = null;
        if (cb) cb();
      }
    }, 200);

    return () => {
      window.clearInterval(id);
      penaltyLastTickMsRef.current = null;
    };
  }, [penaltyVisible, penaltyScreenActive]);

  // Complete Brock Hint Countdown -> Reveal Hint
  const completeHintCountdown = useCallback(() => {
    if (hintPenaltyIntervalRef.current !== null) {
      window.clearInterval(hintPenaltyIntervalRef.current);
      hintPenaltyIntervalRef.current = null;
    }
    hintPenaltyActiveRef.current = false;
    setHintPenaltyOpen(false);
    setHintDisplayOpen(true);
    playSound('hintReveal');
    showToast('Hint unlocked!', 'success');

    if (currentPuzzle) {
      const pid = Number(currentPuzzle.id);
      const nextHints = Array.from(new Set([...hintsUsedIds, pid]));
      const firstUse = !hintsUsedIds.includes(pid);
      setHintsUsedIds(nextHints);
      if (currentTeam) saveHintUsedLocal(currentTeam, pid);
      if (teamKey) {
        saveTeamScoreStateLocal(teamKey, {
          score,
          solved: solvedIds,
          unlocked: unlockedIds,
          hintsUsed: nextHints,
        });
        if (firstUse) {
          notepadBumpLocal(teamKey, 'hint', currentPuzzle);
        }
        const nb = getPuzzleNotebook(teamKey)[String(pid)];
        void recordPuzzleEventToDb({
          tid: currentTeamTid,
          teamName: currentTeam,
          mission: currentMissionLevel,
          language: currentLanguage,
          sessionId,
          action: 'HINT_USED',
          status: 'ACTIVE',
          puzzleId: pid,
          linkid: currentPuzzle.linkid,
          level: currentPuzzle.level,
          wrongAttempts: nb?.wrongAttempts ?? 0,
          tabSwitches: nb?.tabSwitches ?? 0,
          hintUsed: true,
          scanCount: nb?.scanCount ?? 0,
          totalScore: score,
          unlocked: unlockedIds,
          epoch,
          updateProgressFields: { hintsUsed: nextHints },
        });
      }
    }
  }, [
    currentPuzzle,
    hintsUsedIds,
    currentTeam,
    teamKey,
    score,
    solvedIds,
    unlockedIds,
    currentTeamTid,
    currentMissionLevel,
    currentLanguage,
    sessionId,
    epoch,
    showToast,
  ]);

  const startBrockCountdown = useCallback(
    (isReset = false) => {
      if (!currentPuzzle) return;
      const total =
        currentPuzzle.hintPenalty && currentPuzzle.hintPenalty > 0
          ? currentPuzzle.hintPenalty
          : HINT_SETTINGS.defaultPenalty;

      const activeNow =
        !document.hidden && (typeof document.hasFocus !== 'function' || document.hasFocus());
      hintPenaltyActiveRef.current = true;
      hintSecondsRef.current = total;
      setHintPenaltySeconds(total);
      setHintPenaltyRingIteration((n) => n + 1);
      setHintPenaltyOpen(true);
      setHintFocusLost(isReset);
      setHintScreenActive(activeNow);

      if (hintPenaltyIntervalRef.current !== null) {
        window.clearInterval(hintPenaltyIntervalRef.current);
      }
      hintPenaltyIntervalRef.current = window.setInterval(() => {
        if (!hintPenaltyActiveRef.current) return;
        if (document.hidden || (typeof document.hasFocus === 'function' && !document.hasFocus())) {
          setHintScreenActive(false);
          return;
        }
        setHintScreenActive(true);
        hintSecondsRef.current -= 1;
        setHintPenaltySeconds(hintSecondsRef.current);
        if (hintSecondsRef.current <= 0) {
          completeHintCountdown();
        }
      }, 1000);

      playSound(isReset ? 'penaltyReset' : 'hintStart');
    },
    [currentPuzzle, completeHintCountdown]
  );

  // Tab monitoring on Step 3 (triggers Officer Jenny penalty, re-penalizes on repeat switch, & coordinates Brock)
  useEffect(() => {
    if (currentStep !== 3 || !isLoggedIn) return;

    let blurTimer: number | null = null;

    const handleViolation = () => {
      if (penaltyVisibleRef.current) {
        triggerJennyPenalty();
        return;
      }

      if (hintPenaltyActiveRef.current) {
        if (hintMalpracticeRunningRef.current) return;
        hintMalpracticeRunningRef.current = true;
        pendingHintResumeRef.current = true;
        if (hintPenaltyIntervalRef.current !== null) {
          window.clearInterval(hintPenaltyIntervalRef.current);
          hintPenaltyIntervalRef.current = null;
        }
        triggerJennyPenalty(() => {
          hintMalpracticeRunningRef.current = false;
          if (pendingHintResumeRef.current && hintPenaltyActiveRef.current) {
            pendingHintResumeRef.current = false;
            startBrockCountdown(true);
          }
        });
      } else {
        triggerJennyPenalty(() => {
          window.requestAnimationFrame(() => {
            answerInputRef.current?.focus();
          });
        });
      }
    };

    const markReturned = () => {
      if (blurTimer !== null) {
        window.clearTimeout(blurTimer);
        blurTimer = null;
      }
      if (!document.hidden && (typeof document.hasFocus !== 'function' || document.hasFocus())) {
        wasAwayRef.current = false;
        setPenaltyScreenActive(true);
        setHintScreenActive(true);
      }
    };

    const handleLeave = () => {
      setPenaltyScreenActive(false);
      setHintScreenActive(false);
      if (wasAwayRef.current) return;
      wasAwayRef.current = true;
      handleViolation();
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        handleLeave();
      } else {
        markReturned();
      }
    };

    const onBlur = () => {
      setPenaltyScreenActive(false);
      setHintScreenActive(false);
      if (blurTimer !== null) window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(() => {
        blurTimer = null;
        if (document.hidden || !document.hasFocus()) {
          handleLeave();
        } else {
          markReturned();
        }
      }, 90);
    };

    const onFocus = () => {
      markReturned();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      if (blurTimer !== null) window.clearTimeout(blurTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [currentStep, isLoggedIn, startBrockCountdown, triggerJennyPenalty]);

  // Idle Notebook Watchdog (uses static gameplay policy timings from config.json)
  useEffect(() => {
    if (!isLoggedIn || !teamKey) return;
    const id = window.setInterval(() => {
      const nb = getPuzzleNotebook(teamKey);
      const now = Date.now();
      Object.values(nb).forEach((entry) => {
        if (!entry.dirty || entry.solvedAt) return;
        if (currentStep === 3 && currentPuzzle && Number(entry.puzzleId) === Number(currentPuzzle.id)) {
          return;
        }
        if (now - entry.lastActivityAt >= gameplayConfig.idleAbandonMs) {
          void recordPuzzleEventToDb({
            tid: currentTeamTid,
            teamName: currentTeam,
            mission: currentMissionLevel,
            language: currentLanguage,
            sessionId,
            action: 'PUZZLE_ABANDONED',
            status: 'ABANDONED',
            puzzleId: entry.puzzleId,
            linkid: entry.linkid,
            level: entry.level,
            wrongAttempts: entry.wrongAttempts,
            tabSwitches: entry.tabSwitches,
            hintUsed: entry.hintsUsed > 0,
            scanCount: entry.scanCount,
            totalScore: score,
            unlocked: unlockedIds,
            epoch,
          });
          deletePuzzleNotebookEntry(teamKey, entry.puzzleId);
        }
      });
    }, gameplayConfig.idleWatchdogMs);
    return () => window.clearInterval(id);
  }, [
    isLoggedIn,
    teamKey,
    currentStep,
    currentPuzzle,
    currentTeamTid,
    currentTeam,
    currentMissionLevel,
    currentLanguage,
    sessionId,
    score,
    unlockedIds,
    epoch,
    gameplayConfig.idleAbandonMs,
    gameplayConfig.idleWatchdogMs,
  ]);

  // Warn before unload if serving a penalty or if pending IndexedDB submissions remain unsynced
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const hasUnsynced = syncSummary.pendingCount + syncSummary.failedCount > 0;
      if (penaltyVisible || hintPenaltyOpen || hasUnsynced) {
        e.preventDefault();
        e.returnValue =
          hasUnsynced
            ? 'You have unsynchronized puzzle submissions saved locally. Stay or sync before closing?'
            : 'You are currently serving a penalty. Are you sure you want to leave?';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [penaltyVisible, hintPenaltyOpen, syncSummary.pendingCount, syncSummary.failedCount]);

  // Activate a puzzle and preload only active + immediate next puzzle artwork cleanly
  const activatePuzzle = useCallback(
    (puzzle: Puzzle) => {
      setCurrentPuzzle(puzzle);
      setPuzzleStartMs(Date.now());
      setAnswerValue('');
      answerLockedRef.current = false;

      const nextTargets = (puzzle.nextPuzzleId || [])
        .map((nid) => puzzleSummaries.find((s) => Number(s.id) === Number(nid)))
        .filter((s): s is PuzzleSummary => Boolean(s));
      preloadPuzzleFocusAssets(puzzle, nextTargets);

      const activeKey = currentTeamTid || currentTeam;
      if (activeKey) {
        notepadStartLocal(activeKey, puzzle);
        void updateTeamCurrentPuzzleInDb(activeKey, puzzle.id);
      }

      window.requestAnimationFrame(() => {
        answerInputRef.current?.focus();
      });
    },
    [puzzleSummaries, currentTeamTid, currentTeam]
  );

  // Step 1: Explicit Registration Submit & Supabase Sync
  const performRegistrationLogin = async () => {
    const emailInput = normalizeEmail(formEmail);
    const secKey = formSecurityKey.trim();

    if (!formMissionLevel || !formLanguage) {
      setRegFeedback({
        message: 'Game options are unavailable. Refresh and try again.',
        type: 'error',
      });
      return;
    }

    if (!emailInput || !secKey) {
      setRegFeedback({
        message: 'Email ID and security key are required!',
        type: 'error',
      });
      if (regShakeTimerRef.current !== null) window.clearTimeout(regShakeTimerRef.current);
      setRegShakeField(!emailInput ? 'email' : 'teamSecurityKey');
      regShakeTimerRef.current = window.setTimeout(() => {
        regShakeTimerRef.current = null;
        setRegShakeField(null);
      }, 500);
      playSound('error');
      return;
    }

    if (!isValidEmail(emailInput)) {
      setRegFeedback({
        message: 'Please enter a valid Email ID.',
        type: 'error',
      });
      if (regShakeTimerRef.current !== null) window.clearTimeout(regShakeTimerRef.current);
      setRegShakeField('email');
      regShakeTimerRef.current = window.setTimeout(() => {
        regShakeTimerRef.current = null;
        setRegShakeField(null);
      }, 500);
      playSound('error');
      return;
    }

    setRegFeedback(null);
    setIsRegSubmitting(true);
    const loginToken = ++loginSyncTokenRef.current;
    startSyncBar(0.22);

    try {
      const auth = await authenticateTeamCredentials(emailInput, secKey);
      if (loginToken !== loginSyncTokenRef.current) return;
      if (!auth.ok || !auth.team) {
        resetSyncBar();
        const isInvalidKey = auth.reason === 'INVALID_KEY';
        const isAuthUnavailable = auth.reason === 'UNAVAILABLE';
        setRegFeedback({
          message: isAuthUnavailable
            ? 'Could not reach the sign-in server. Check your connection and try again.'
            : isInvalidKey
              ? 'Invalid email ID or security key!'
              : 'Email ID not registered. Check your email and try again.',
          type: 'error',
        });
        if (regShakeTimerRef.current !== null) window.clearTimeout(regShakeTimerRef.current);
        setRegShakeField(isAuthUnavailable ? null : isInvalidKey ? 'teamSecurityKey' : 'email');
        regShakeTimerRef.current = window.setTimeout(() => {
          regShakeTimerRef.current = null;
          setRegShakeField(null);
        }, 500);
        playSound('error');
        return;
      }

      const resolvedTeamName = auth.team.team;
      const resolvedTid = auth.team.tid;
      const prevRemembered = getRememberedTeamInfo();
      const prevKey = prevRemembered ? prevRemembered.tid || prevRemembered.teamName : '';
      const isDifferentTeam = !prevKey || prevKey !== resolvedTid;

      let nextSessionId = sessionId;
      if (isDifferentTeam) {
        nextSessionId = generateSessionId();
        setSessionId(nextSessionId);
        clearGameStateLocal();
      }

      advanceSyncBar(0.52);

      const hasPendingDeepLink = Boolean(
        pendingDeepLinkRef.current &&
          (pendingDeepLinkRef.current.linkId ||
            pendingDeepLinkRef.current.memeId ||
            pendingDeepLinkRef.current.rawSlug)
      );
      let navigatedOptimistically = false;

      let settledTasks = 0;
      const bumpLoginTask = () => {
        if (loginToken !== loginSyncTokenRef.current) return;
        settledTasks += 1;
        if (settledTasks === 1) {
          advanceSyncBar(0.8);
        }
      };

      const applyTeamSession = (
        targetEpoch: number,
        progress: {
          score: number;
          solved: number[];
          unlocked: number[];
          hintsUsed: number[];
          tabSwitches: number;
        }
      ) => {
        setEpoch(targetEpoch);
        setCurrentTeam(resolvedTeamName);
        setCurrentTeamTid(resolvedTid);
        setCurrentMissionLevel(formMissionLevel);
        setCurrentLanguage(formLanguage);
        setScore(progress.score);
        setSolvedIds(progress.solved);
        setUnlockedIds(progress.unlocked);
        setHintsUsedIds(progress.hintsUsed);
        setTabSwitchCount(progress.tabSwitches);
      };

      const regPromise = submitAndSyncRegistration({
        tid: resolvedTid,
        teamName: resolvedTeamName,
        email: emailInput,
        mission: formMissionLevel,
        language: formLanguage,
        sessionId: nextSessionId,
        puzzles: puzzleSummaries,
        epoch,
        onLocalReady: !hasPendingDeepLink
          ? ({ epoch: localEpochReady, teamProgress }) => {
              if (loginToken !== loginSyncTokenRef.current) return;
              navigatedOptimistically = true;
              applyTeamSession(localEpochReady, teamProgress);
              saveRememberedTeamInfo({
                email: emailInput,
                teamName: resolvedTeamName,
                tid: resolvedTid,
                mission: formMissionLevel,
                language: formLanguage,
              });
              saveTeamScoreStateLocal(resolvedTid, {
                score: teamProgress.score,
                solved: teamProgress.solved,
                unlocked: teamProgress.unlocked,
                hintsUsed: teamProgress.hintsUsed,
              });
              cleanupHintSystem();
              clearPenalty();
              playSound('powerUp');
              setIsRegSubmitting(false);

              if (!isDifferentTeam) {
                const saved = getSavedGameState();
                if (saved.currentStep === 'startcode' && urlLockedPuzzle) {
                  setCurrentStep('startcode');
                  return;
                }
                if (saved.currentStep === 3 && saved.currentPuzzleId) {
                  void getCachedPuzzleById(localEpochReady, Number(saved.currentPuzzleId)).then(
                    (restored) => {
                      if (loginToken !== loginSyncTokenRef.current) return;
                      const solvedS = new Set<number>(teamProgress.solved.map(Number));
                      const unlockedS = new Set<number>(teamProgress.unlocked.map(Number));
                      if (restored && isPuzzleAllowed(restored, solvedS, unlockedS, puzzleSummaries)) {
                        activatePuzzle(restored);
                        setCurrentStep(3);
                        return;
                      }
                      setCurrentStep(2);
                    }
                  );
                  return;
                }
              }
              setCurrentStep(2);
            }
          : undefined,
      }).finally(bumpLoginTask);

      const catalogPromise = retrieveAndCacheCatalogOnScan({
        tid: resolvedTid,
        sessionId: nextSessionId,
        epoch,
      })
        .catch(() => null)
        .finally(bumpLoginTask);

      const [regResult, catalogResult] = await Promise.all([regPromise, catalogPromise]);

      if (loginToken !== loginSyncTokenRef.current) return;

      completeSyncBar();
      resetSyncBar();

      const effectiveEpoch = Math.max(regResult.epoch, catalogResult?.epoch || regResult.epoch);
      if (catalogResult && catalogResult.epoch > regResult.epoch) {
        wipeAllLocalGameStorage(catalogResult.epoch);
      }

      const activeSummaries = catalogResult?.summaries || puzzleSummaries;
      if (catalogResult) {
        setPuzzleSummaries(catalogResult.summaries);
        catalogVersionRef.current = catalogResult.catalogVersion;
        if (catalogResult.source !== 'indexeddb') {
          preloadGameAssets(catalogResult.summaries, config);
        }
      }

      applyTeamSession(effectiveEpoch, regResult.teamProgress);

      if (navigatedOptimistically) {
        if (effectiveEpoch > epoch) {
          setCurrentPuzzle(null);
          setUrlLockedPuzzle(null);
          setCurrentStep(2);
        }
        saveTeamScoreStateLocal(resolvedTid, {
          score: regResult.teamProgress.score,
          solved: regResult.teamProgress.solved,
          unlocked: regResult.teamProgress.unlocked,
          hintsUsed: regResult.teamProgress.hintsUsed,
        });
        return;
      }

      saveRememberedTeamInfo({
        email: emailInput,
        teamName: resolvedTeamName,
        tid: resolvedTid,
        mission: formMissionLevel,
        language: formLanguage,
      });
      saveTeamScoreStateLocal(resolvedTid, {
        score: regResult.teamProgress.score,
        solved: regResult.teamProgress.solved,
        unlocked: regResult.teamProgress.unlocked,
        hintsUsed: regResult.teamProgress.hintsUsed,
      });

      cleanupHintSystem();
      clearPenalty();
      playSound('powerUp');

      const deepLink = pendingDeepLinkRef.current;
      if (deepLink && (deepLink.linkId || deepLink.memeId || deepLink.rawSlug)) {
        try {
          const targetMemeCode = deepLink.memeId || deepLink.rawSlug;
          if (deepLink.memeId && targetMemeCode) {
            const deepMeme = await getCachedMemeById(effectiveEpoch, targetMemeCode);
            if (deepMeme) {
              pendingDeepLinkRef.current = null;
              setActiveMeme(deepMeme);
              setCurrentStep(2);
              return;
            }
          }

          const targetCode = deepLink.linkId || deepLink.rawSlug;
          const deepPuzzle = targetCode
            ? await getCachedPuzzleByLinkId(effectiveEpoch, targetCode)
            : null;
          pendingDeepLinkRef.current = null;

          if (deepPuzzle) {
            const solvedS = new Set<number>(regResult.teamProgress.solved.map(Number));
            const unlockedS = new Set<number>([
              ...regResult.teamProgress.unlocked.map(Number),
              ...Array.from(getLeadPuzzleIds(activeSummaries)),
            ]);
            if (isPuzzleAllowed(deepPuzzle, solvedS, unlockedS, activeSummaries)) {
              if (isStartingPuzzle(deepPuzzle)) {
                setUrlLockedPuzzle(deepPuzzle);
                setCurrentStep('startcode');
              } else {
                activatePuzzle(deepPuzzle);
                setCurrentStep(3);
              }
              return;
            }
            showToast(puzzleGateMessage(deepPuzzle, activeSummaries, null), 'error');
            setCurrentStep(2);
            return;
          }

          if (deepLink.rawSlug) {
            const fallbackMeme = await getCachedMemeById(effectiveEpoch, deepLink.rawSlug);
            if (fallbackMeme) {
              setActiveMeme(fallbackMeme);
              setCurrentStep(2);
              return;
            }
          }
        } catch {
          pendingDeepLinkRef.current = null;
        }
      }

      if (!isDifferentTeam) {
        const saved = getSavedGameState();
        if (saved.currentStep === 'startcode' && urlLockedPuzzle) {
          setCurrentStep('startcode');
          return;
        }
        if (saved.currentStep === 3 && saved.currentPuzzleId) {
          const restored = await getCachedPuzzleById(effectiveEpoch, Number(saved.currentPuzzleId));
          const solvedS = new Set<number>(regResult.teamProgress.solved.map(Number));
          const unlockedS = new Set<number>(regResult.teamProgress.unlocked.map(Number));
          const summariesForCheck =
            activeSummaries.length > 0
              ? activeSummaries
              : (await readCachedCatalogSummaries(effectiveEpoch))?.summaries || activeSummaries;
          if (restored && isPuzzleAllowed(restored, solvedS, unlockedS, summariesForCheck)) {
            activatePuzzle(restored);
            setCurrentStep(3);
            return;
          }
        }
      }

      setCurrentStep(2);
    } catch (err) {
      resetSyncBar();
      const msg = err instanceof Error ? err.message : 'Authentication failed.';
      setRegFeedback({ message: msg, type: 'error' });
      playSound('error');
    } finally {
      setIsRegSubmitting(false);
    }
  };

  const handleStep1Submit = (e: React.FormEvent) => {
    e.preventDefault();
    void performRegistrationLogin();
  };

  // Step 2: QR Scan / Manual Entry Handler (Cache-first IndexedDB + Single Bulk Retrieval on Miss/Expiry)
  const handleScanResult = useCallback(
    (rawCode: string) => {
      const code = extractUniversalScanCode(rawCode);
      if (!code) {
        showToast('❌ Invalid Signal - Access Denied', 'error');
        playSound('error');
        return;
      }

      void (async () => {
        try {
          const catalog = await retrieveAndCacheCatalogOnScan({
            tid: currentTeamTid || 'GUEST',
            sessionId,
            epoch,
          });

          if (catalog.epoch > epoch) {
            wipeAllLocalGameStorage(catalog.epoch);
            setEpoch(catalog.epoch);
          }
          setPuzzleSummaries(catalog.summaries);
          catalogVersionRef.current = catalog.catalogVersion;
          if (catalog.source !== 'indexeddb') {
            preloadGameAssets(catalog.summaries, config);
          }

          // 1. Check meme library directly from IndexedDB
          const matchedMeme = await getCachedMemeById(catalog.epoch, code);
          if (matchedMeme) {
            playSound('success');
            setActiveMeme(matchedMeme);
            return;
          }

          // 2. Check puzzle catalog directly from IndexedDB (by_epoch_linkid index)
          const matchedPuzzle = await getCachedPuzzleByLinkId(catalog.epoch, code);
          if (!matchedPuzzle) {
            showToast('❌ Invalid Signal - Access Denied', 'error');
            playSound('error');
            return;
          }

          // 3. Enforce unlock graph progression using lightweight summaries
          const effectiveUnlocked = new Set<number>([
            ...Array.from(unlockedSet),
            ...Array.from(getLeadPuzzleIds(catalog.summaries)),
          ]);
          if (!isPuzzleAllowed(matchedPuzzle, solvedSet, effectiveUnlocked, catalog.summaries)) {
            if (teamKey) notepadBumpLocal(teamKey, 'scan', matchedPuzzle);
            const gateMsg = puzzleGateMessage(matchedPuzzle, catalog.summaries, currentPuzzle);
            showToast(gateMsg, 'error');
            playSound('error');
            void recordPuzzleEventToDb({
              tid: currentTeamTid,
              teamName: currentTeam,
              mission: currentMissionLevel,
              language: currentLanguage,
              sessionId,
              action: 'QR_BLOCKED',
              status: 'BLOCKED',
              puzzleId: matchedPuzzle.id,
              linkid: matchedPuzzle.linkid,
              level: matchedPuzzle.level,
              totalScore: score,
              unlocked: Array.from(effectiveUnlocked).sort((a, b) => a - b),
              epoch: catalog.epoch,
            });
            return;
          }

          if (teamKey) notepadBumpLocal(teamKey, 'scan', matchedPuzzle);

          if (isStartingPuzzle(matchedPuzzle)) {
            setUrlLockedPuzzle(matchedPuzzle);
            setUnlockCode('');
            setUnlockFeedback(null);
            playSound('success');
            setCurrentStep('startcode');
          } else {
            activatePuzzle(matchedPuzzle);
            playSound('success');
            setCurrentStep(3);
          }
        } catch (err) {
          const msg =
            err instanceof Error
              ? err.message
              : 'Unable to retrieve puzzles while offline without cache.';
          showToast(msg, 'error');
          playSound('error');
        }
      })();
    },
    [
      currentTeamTid,
      sessionId,
      epoch,
      config,
      unlockedSet,
      solvedSet,
      teamKey,
      currentPuzzle,
      showToast,
      currentTeam,
      currentMissionLevel,
      currentLanguage,
      score,
      activatePuzzle,
    ]
  );

  // Startcode verification (100% local via SHA-256 digest in IndexedDB, 0 DB calls on failure)
  const handleUnlockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = standardizeString(unlockCode);
    if (!code) {
      setUnlockFeedback({ message: 'Enter start key', type: 'error' });
      return;
    }

    const requestedPuzzle =
      urlLockedPuzzle && isStartingPuzzle(urlLockedPuzzle) ? urlLockedPuzzle : null;

    if (requestedPuzzle && verifyPuzzleStartCode(requestedPuzzle, code)) {
      setUnlockFeedback(null);
      activatePuzzle(requestedPuzzle);
      setCurrentStep(3);
      playSound('success');
      return;
    }

    setUnlockFeedback({ message: 'Incorrect key', type: 'error' });
    if (unlockShakeTimerRef.current !== null) window.clearTimeout(unlockShakeTimerRef.current);
    setUnlockShake(true);
    unlockShakeTimerRef.current = window.setTimeout(() => {
      unlockShakeTimerRef.current = null;
      setUnlockShake(false);
    }, 500);
    playSound('error');
  };

  // Step 3: Local Answer Verification (0 DB calls on wrong attempts) -> Capture exact timestamp on match & send full solve payload
  const handleSubmitAnswer = (e: React.FormEvent) => {
    e.preventDefault();
    if (answerLockedRef.current || penaltyVisibleRef.current) return;

    const raw = answerValue.trim();
    if (!raw) {
      showToast('INPUT REQUIRED', 'error');
      return;
    }
    if (!currentPuzzle) {
      showToast('NO PUZZLE LOADED', 'error');
      return;
    }

    if (!verifyPuzzleAnswer(currentPuzzle, raw)) {
      playSound('error');
      showToast('DECRYPTION FAILED', 'error');
      if (glitchTimerRef.current !== null) window.clearTimeout(glitchTimerRef.current);
      setScreenGlitch(true);
      glitchTimerRef.current = window.setTimeout(() => {
        glitchTimerRef.current = null;
        setScreenGlitch(false);
      }, 400);
      setAnswerValue('');
      if (answerShakeTimerRef.current !== null) window.clearTimeout(answerShakeTimerRef.current);
      setAnswerShake(true);
      answerShakeTimerRef.current = window.setTimeout(() => {
        answerShakeTimerRef.current = null;
        setAnswerShake(false);
      }, 500);
      if (teamKey) {
        notepadBumpLocal(teamKey, 'wrong', currentPuzzle);
      }
      return;
    }

    const solvedAt = Date.now();
    answerLockedRef.current = true;
    const pid = Number(currentPuzzle.id);
    const repeat = solvedSet.has(pid);
    const isEnd =
      !Array.isArray(currentPuzzle.nextPuzzleId) || currentPuzzle.nextPuzzleId.length === 0;
    const pointsDelta = repeat ? -(currentPuzzle.points || 0) : currentPuzzle.points || 0;
    const newScore = score + pointsDelta;
    const nextSolved = repeat ? solvedIds.slice() : [...solvedIds, pid];
    const nextUnlocked = computeLocalUnlocked(puzzleSummaries, nextSolved);
    const nbEntry = teamKey ? getPuzzleNotebook(teamKey)[String(pid)] || null : null;

    setScore(newScore);
    setSolvedIds(nextSolved);
    setUnlockedIds(nextUnlocked);

    if (teamKey) {
      saveTeamScoreStateLocal(teamKey, {
        score: newScore,
        solved: nextSolved,
        unlocked: nextUnlocked,
        hintsUsed: hintsUsedIds,
      });
      deletePuzzleNotebookEntry(teamKey, pid);
    }

    playSound('victory');
    showToast(
      repeat ? `REPEATED SOLVE: ${pointsDelta} pts` : `SIGNAL DECRYPTED! +${pointsDelta} pts`,
      repeat ? 'info' : 'success'
    );

    if (!isEnd) {
      setScreenGlow(true);
      window.setTimeout(() => setScreenGlow(false), 2000);
    }

    void recordPuzzleSolveToDb({
      tid: currentTeamTid,
      teamName: currentTeam,
      mission: currentMissionLevel,
      language: currentLanguage,
      sessionId,
      puzzle: currentPuzzle,
      submittedAnswer: raw,
      repeat,
      pointsDelta,
      newScore,
      solved: nextSolved,
      unlocked: nextUnlocked,
      hintsUsed: hintsUsedIds,
      tabSwitchesTotal: tabSwitchCount,
      notebook: nbEntry,
      epoch,
      solvedAt,
    });

    setRevealKey((k) => k + 1);
    setCurrentStep(4);
    playSound('hologram');
  };

  // Hint Request Handlers
  const handleRequestHint = () => {
    if (!currentPuzzle) return;
    const pid = Number(currentPuzzle.id);
    const alreadyPaid =
      hintsUsedSet.has(pid) || (currentTeam ? getHintUsedLocal(currentTeam, pid) : false);
    if (alreadyPaid) {
      setHintDisplayOpen(true);
      return;
    }
    if (!puzzleHasHint(currentPuzzle)) {
      showToast('No hint available for this puzzle.', 'info');
      return;
    }
    setHintRequestOpen(true);
    if (hintRequestTimeoutRef.current !== null) {
      window.clearTimeout(hintRequestTimeoutRef.current);
    }
    hintRequestTimeoutRef.current = window.setTimeout(() => {
      setHintRequestOpen(false);
      showToast('Hint request timed out', 'error');
    }, HINT_SETTINGS.hintRequestTimeout * 1000);
  };

  const handleConfirmHintRequest = () => {
    if (hintRequestTimeoutRef.current !== null) {
      window.clearTimeout(hintRequestTimeoutRef.current);
      hintRequestTimeoutRef.current = null;
    }
    setHintRequestOpen(false);
    startBrockCountdown(false);
  };

  const handleCancelHintRequest = () => {
    if (hintRequestTimeoutRef.current !== null) {
      window.clearTimeout(hintRequestTimeoutRef.current);
      hintRequestTimeoutRef.current = null;
    }
    cleanupHintSystem();
    playSound('error');
  };

  // Step 4 -> Scan Next Signal (uses cached IndexedDB dataset)
  const handleContinueToQRScan = () => {
    const isEnd =
      currentPuzzle &&
      (!Array.isArray(currentPuzzle.nextPuzzleId) || currentPuzzle.nextPuzzleId.length === 0);
    if (isEnd) {
      showToast('🎉 CONGRATULATIONS! You have completed all puzzles!', 'success');
      playSound('victory');
      return;
    }
    setUnlockCode('');
    setUrlLockedPuzzle(null);
    setCurrentStep(2);
  };

  // Logout (silently flush pending outbox in background)
  const handleConfirmSignOut = () => {
    setSignOutVisible(false);
    playSound('click');
    if ('vibrate' in navigator) navigator.vibrate(40);

    if (teamKey && currentPuzzle && !solvedSet.has(Number(currentPuzzle.id))) {
      const nb = getPuzzleNotebook(teamKey)[String(currentPuzzle.id)];
      if (nb && nb.dirty) {
        void recordPuzzleEventToDb({
          tid: currentTeamTid,
          teamName: currentTeam,
          mission: currentMissionLevel,
          language: currentLanguage,
          sessionId,
          action: 'PUZZLE_ABANDONED',
          status: 'ABANDONED',
          puzzleId: currentPuzzle.id,
          linkid: currentPuzzle.linkid,
          level: currentPuzzle.level,
          wrongAttempts: nb.wrongAttempts,
          tabSwitches: nb.tabSwitches,
          hintUsed: nb.hintsUsed > 0,
          scanCount: nb.scanCount,
          totalScore: score,
          unlocked: unlockedIds,
          epoch,
        });
        deletePuzzleNotebookEntry(teamKey, currentPuzzle.id);
      }
    }

    void flushPendingSubmissions(true);

    loginSyncTokenRef.current += 1;
    resetSyncBar();
    cleanupHintSystem();
    clearPenalty();
    answerLockedRef.current = false;

    setCurrentTeam('');
    setCurrentTeamTid('');
    setCurrentMissionLevel('');
    setSessionId(generateSessionId());
    setCurrentPuzzle(null);
    setUrlLockedPuzzle(null);
    setTabSwitchCount(0);
    setScore(0);
    setSolvedIds([]);
    setUnlockedIds([]);
    setHintsUsedIds([]);
    clearGameStateLocal();

    showToast('Trainer signed out.', 'success');
    setCurrentStep(0);
  };

  // Hardware Aux & Power Button Controls
  const handleAuxClick = (btnId: 1 | 2) => {
    if ('vibrate' in navigator) navigator.vibrate(20);

    const el = btnId === 1 ? aux1Ref.current : aux2Ref.current;
    if (el) {
      el.style.background = 'white';
      window.setTimeout(() => {
        if (el) el.style.background = '';
      }, 60);
    }

    if (btnId === 1) {
      const muted = toggleMute();
      if (!muted) playSound('ok', 0.25);
      showToast(muted ? 'Audio Suspended' : 'Audio Active', muted ? 'error' : 'success');
    } else {
      const playing = toggleBgm();
      playSound(playing ? 'ok' : 'cancel', 0.24);
      showToast(playing ? 'BGM Active' : 'BGM Suspended', playing ? 'success' : 'info');
    }
  };

  const toggleCrtPower = () => {
    setIsCrtOn((prev) => {
      const next = !prev;
      playSound(next ? 'powerUp' : 'cancel', 0.28);
      return next;
    });
  };

  const handlePowerTap = () => {
    if (isLoggedIn) {
      if (!signOutVisible) {
        setSignOutVisible(true);
        playSound('toggle', 0.25);
      }
    } else {
      playSound('toggle', 0.25);
      showToast('Trainer sign-in required', 'info');
      setCurrentStep(1);
    }
  };

  const clearPowerPress = () => {
    if (powerTimerRef.current !== null) {
      window.clearTimeout(powerTimerRef.current);
      powerTimerRef.current = null;
    }
  };

  // Re-check server epoch gently whenever logged in & returning to Step 2
  useEffect(() => {
    if (!isLoggedIn || currentStep !== 2) return;
    fetchServerGameEpoch()
      .then((serverEpoch) => {
        if (serverEpoch > epoch) {
          wipeAllLocalGameStorage(serverEpoch);
          setEpoch(serverEpoch);
          setScore(0);
          setSolvedIds([]);
          setUnlockedIds(computeLocalUnlocked(puzzleSummaries, []));
          setHintsUsedIds([]);
          setTabSwitchCount(0);
          setCurrentPuzzle(null);
          setNextPuzzles([]);
          setUrlLockedPuzzle(null);
          showToast('New game epoch started by admin!', 'info');
        }
      })
      .catch(() => {});
  }, [isLoggedIn, currentStep, epoch, puzzleSummaries, showToast]);

  // Derived HUD strings
  const hudLevel =
    isLoggedIn && currentMissionLevel
      ? (currentMissionLevel.split('_')[0] || 'L1').replace('L', '').padStart(2, '0')
      : '00';
  const hudType =
    isLoggedIn && currentMissionLevel
      ? currentMissionLevel.split('_')[1] || 'NORMAL'
      : 'SYS';
  const hudTeamName = isLoggedIn
    ? currentTeam.length > 20
      ? `${currentTeam.substring(0, 20)}...`
      : currentTeam
    : 'NO TEAM';

  return (
    <div className="pokedex-viewport bg-[#050810] font-mono overflow-x-hidden touch-manipulation">
      <div className="pokedex-shell flex flex-col">
        {/* Top Header Section */}
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 sm:gap-3 mb-2 sm:mb-4 px-1.5 sm:px-2 pt-1 flex-shrink-0">
          {/* Blue Camera Orb */}
          <div className="justify-self-start w-[clamp(44px,11vmin,64px)] h-[clamp(44px,11vmin,64px)] rounded-full flex items-center justify-center relative flex-shrink-0">
            <div className="absolute -inset-1 bg-blue-400/30 rounded-full blur-sm"></div>
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-400 via-blue-500 to-blue-600 border-2 sm:border-[3px] md:border-4 border-white shadow-[inset_0_-4px_8px_rgba(0,0,0,0.3),inset_0_4px_8px_rgba(255,255,255,0.2),0_4px_12px_rgba(0,0,0,0.4)] overflow-hidden">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-transparent via-blue-300/20 to-transparent"></div>
              <div className="absolute top-[12%] left-[12%] w-[22%] h-[22%] bg-gradient-to-br from-white to-blue-100 rounded-full opacity-70"></div>
              <div className="absolute top-[8%] right-[14%] w-[16%] h-[16%] bg-gradient-to-br from-white/60 to-transparent rounded-full blur-[1px]"></div>
              <div className="absolute inset-[16%] border border-white/30 rounded-full"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-[14%] h-[14%] bg-white/40 rounded-full blur-[1px]"></div>
              </div>
            </div>
          </div>

          {/* Center Brand Lockup */}
          <div className="brand-lockup justify-self-center flex-shrink-0 text-center flex flex-col justify-center items-center">
            <div className="brand-mark-row">
              <img
                src="/assets/img/pykachu.png"
                alt="Pykachu"
                className="brand-pykachu select-none pointer-events-none"
              />
              <img
                src="/assets/img/go.png"
                alt="Go"
                className="brand-go select-none pointer-events-none"
              />
            </div>
            <p className="brand-tagline text-[10px] sm:text-xs md:text-sm text-slate-200 font-medium text-center">
              Decode Code. Capture Pikachu.
            </p>
          </div>

          {/* Red/Yellow/Green Status LEDs */}
          <div className="justify-self-end flex gap-1 sm:gap-1.5 pt-1 sm:pt-1.5 flex-shrink-0">
            <div className="w-[clamp(9px,2.2vmin,14px)] h-[clamp(9px,2.2vmin,14px)] rounded-full relative">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-red-500 via-red-600 to-red-700 border border-red-900/80"></div>
              <div className="absolute inset-0 rounded-full shadow-[inset_0_1px_2px_rgba(255,255,255,0.3),inset_0_-1px_2px_rgba(0,0,0,0.5)]"></div>
              <div className="absolute top-[15%] left-[15%] w-[35%] h-[35%] bg-white/60 rounded-full blur-[0.5px]"></div>
              <div
                className="absolute inset-0 rounded-full bg-red-500/30 blur-[1px] animate-pulse"
                style={{ animationDuration: '2s' }}
              ></div>
            </div>

            <div className="w-[clamp(9px,2.2vmin,14px)] h-[clamp(9px,2.2vmin,14px)] rounded-full relative">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-yellow-300 via-yellow-400 to-yellow-500 border border-yellow-700/80"></div>
              <div className="absolute inset-0 rounded-full shadow-[inset_0_1px_2px_rgba(255,255,255,0.4),inset_0_-1px_2px_rgba(0,0,0,0.4)]"></div>
              <div className="absolute top-[15%] left-[15%] w-[35%] h-[35%] bg-white/70 rounded-full blur-[0.5px]"></div>
              <div
                className="absolute inset-0 rounded-full bg-yellow-400/30 blur-[1px] animate-pulse"
                style={{ animationDuration: '2.5s', animationDelay: '0.5s' }}
              ></div>
            </div>

            <div className="w-[clamp(9px,2.2vmin,14px)] h-[clamp(9px,2.2vmin,14px)] rounded-full relative">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-green-400 via-green-500 to-green-600 border border-green-800/80"></div>
              <div className="absolute inset-0 rounded-full shadow-[inset_0_1px_2px_rgba(255,255,255,0.3),inset_0_-1px_2px_rgba(0,0,0,0.5)]"></div>
              <div className="absolute top-[15%] left-[15%] w-[35%] h-[35%] bg-white/60 rounded-full blur-[0.5px]"></div>
              <div
                className="absolute inset-0 rounded-full bg-green-500/30 blur-[1px] animate-pulse"
                style={{ animationDuration: '3s', animationDelay: '1s' }}
              ></div>
            </div>
          </div>
        </div>

        {/* Main CRT Display Area */}
        <div className="crt-container flex-1 min-h-0">
          <div
            ref={screenRef}
            id="screen"
            className={`crt-screen overflow-y-auto scrollable relative${
              currentStep === 0 || currentStep === 1 || currentStep === 2 ? ' is-white-glow' : ''
            }${currentStep === 4 ? ' is-step4' : ''}${
              screenGlow ? ' premium-glow' : ''
            }${screenGlitch ? ' glitch-active' : ''}`}
            style={
              isCrtOn
                ? { opacity: 1 }
                : { filter: 'brightness(0) contrast(2)', opacity: 0.1 }
            }
          >
            <ToastContainer toasts={toasts} />

            <canvas
              ref={celebrationCanvasRef}
              id="celebrationCanvas"
              className="absolute inset-0 w-full h-full pointer-events-none z-[100]"
            ></canvas>

            <LoaderSplash booted={booted} />

            {/* Full-Width Minimal Internal Status HUD */}
            <div className="internal-status-bar">
              <div
                id="statusLvl"
                className={`status-item ${isLoggedIn ? 'is-filled' : 'is-empty'} !p-0 !gap-1`}
              >
                <AppIcon name="analytics" className="text-xs sm:text-sm" />
                <span id="teamLevelDisplay" className="status-val text-[10px] sm:text-[11px]">
                  {hudLevel}
                </span>
              </div>

              <div className="status-divider"></div>

              <div
                id="statusTeam"
                className={`status-item ${isLoggedIn ? 'is-filled' : 'is-empty'} !p-0 !gap-1`}
              >
                <AppIcon name={isLoggedIn ? 'verified_user' : 'shield_person'} className="text-sm sm:text-base" />
                <span id="teamNameInput" className="team-val font-bold text-[10px] sm:text-[11px]">
                  {hudTeamName}
                </span>
              </div>

              <div className="status-divider"></div>

              <div
                id="statusType"
                className={`status-item ${isLoggedIn ? 'is-filled' : 'is-empty'} !p-0 !gap-1`}
              >
                <span id="teamTypeDisplay" className="status-val text-[10px] sm:text-[11px]">
                  {hudType}
                </span>
                <AppIcon name="dynamic_form" className="text-xs sm:text-sm" />
              </div>

              {currentStep === 1 && (
                <div className="hud-sync-track" aria-hidden="true">
                  <div
                    className={`hud-sync-bar${
                      syncBarPhase === 'syncing'
                        ? ' is-syncing'
                        : syncBarPhase === 'completing'
                          ? ' is-completing'
                          : ''
                    }`}
                    style={{
                      transform: `scaleX(${syncBarPhase === 'idle' ? 0 : syncBarProgress})`,
                      opacity: syncBarPhase === 'idle' ? 0 : 1,
                    }}
                  />
                </div>
              )}
            </div>

            <Step0Rules
              active={currentStep === 0}
              onAccept={() => setCurrentStep(1)}
            />

            <Step1Login
              active={currentStep === 1}
              email={formEmail}
              onEmailChange={setFormEmail}
              securityKey={formSecurityKey}
              onSecurityKeyChange={setFormSecurityKey}
              language={formLanguage}
              onLanguageChange={setFormLanguage}
              missionLevel={formMissionLevel}
              onMissionLevelChange={setFormMissionLevel}
              config={config}
              feedback={regFeedback}
              shakeField={regShakeField}
              isSubmitting={isRegSubmitting}
              onSubmit={handleStep1Submit}
            />

            <Step2Scanner
              active={currentStep === 2}
              onScanResult={handleScanResult}
              onShowToast={showToast}
              onOpenCameraGuide={(reason) =>
                setCameraGuideState({ visible: true, reason })
              }
            />

            <StartCodeStep
              active={currentStep === 'startcode'}
              lockedPuzzle={urlLockedPuzzle}
              unlockCode={unlockCode}
              onUnlockCodeChange={setUnlockCode}
              feedback={unlockFeedback}
              shakeInput={unlockShake}
              onSubmit={handleUnlockSubmit}
              onBack={() => setCurrentStep(2)}
            />

            <Step3Puzzle
              active={currentStep === 3}
              puzzle={currentPuzzle}
              language={currentLanguage}
              questionText={getPuzzleQuestion(currentPuzzle, currentLanguage)}
              puzzleStartMs={puzzleStartMs}
              answerValue={answerValue}
              onAnswerChange={setAnswerValue}
              onSubmitAnswer={handleSubmitAnswer}
              shakeAnswer={answerShake}
              answerInputRef={answerInputRef}
              hasHint={puzzleHasHint(currentPuzzle)}
              hintRequestOpen={hintRequestOpen}
              hintPenaltyOpen={hintPenaltyOpen}
              hintPenaltySeconds={hintPenaltySeconds}
              hintPenaltyRingIteration={hintPenaltyRingIteration}
              hintScreenActive={hintScreenActive}
              hintFocusLost={hintFocusLost}
              hintDisplayOpen={hintDisplayOpen}
              hintText={
                currentPuzzle && typeof currentPuzzle.hint === 'string'
                  ? currentPuzzle.hint
                  : ''
              }
              onRequestHint={handleRequestHint}
              onConfirmHintRequest={handleConfirmHintRequest}
              onCancelHintRequest={handleCancelHintRequest}
              onCloseHintPopup={() => setHintDisplayOpen(false)}
            />

            <Suspense fallback={null}>
              {currentStep === 4 && (
                <Step4Success
                  active
                  puzzle={currentPuzzle}
                  nextPuzzles={nextPuzzles}
                  missionLevel={currentMissionLevel}
                  revealKey={revealKey}
                  isLoggedIn={isLoggedIn}
                  celebrationCanvasRef={celebrationCanvasRef}
                  screenRef={screenRef}
                  onContinueToQRScan={handleContinueToQRScan}
                />
              )}
            </Suspense>

            <PenaltyOverlay
              visible={penaltyVisible}
              seconds={penaltySeconds}
              totalSeconds={penaltyTotalSeconds}
              ringIteration={penaltyRingIteration}
              screenActive={penaltyScreenActive}
              resetCount={penaltyResetCount}
              onInteract={() => {
                if (!document.hidden) {
                  wasAwayRef.current = false;
                  setPenaltyScreenActive(true);
                  setHintScreenActive(true);
                }
              }}
            />

            <MemePlayerOverlay
              meme={activeMeme}
              onClose={() => setActiveMeme(null)}
              onShowToast={showToast}
            />

            <SignOutOverlay
              visible={signOutVisible}
              teamName={currentTeam}
              onConfirm={handleConfirmSignOut}
              onCancel={() => {
                setSignOutVisible(false);
                showToast('Stay in battle, trainer!', 'info');
              }}
            />

            <CameraGuideOverlay
              visible={cameraGuideState.visible}
              reason={cameraGuideState.reason}
              onClose={() =>
                setCameraGuideState((prev) => ({ ...prev, visible: false }))
              }
              onShowToast={showToast}
            />
          </div>
        </div>

        {/* Compact Auxiliary Interface */}
        <div
          className="flex justify-between items-center mt-2 px-2 flex-shrink-0 gap-2"
          style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom, 8px))' }}
        >
          <div className="flex gap-2">
            <div
              ref={aux1Ref}
              id="aux-btn-1"
              className="pokedex-button-bar w-10 h-3 sm:w-12 sm:h-3.5 bg-slate-800 rounded-full shadow-lg cursor-pointer hover:bg-slate-700 active:translate-y-0.5 transition-all min-h-[20px]"
              onClick={() => handleAuxClick(1)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleAuxClick(1);
                }
              }}
              role="button"
              aria-label={`Audio toggle button (${getMuted() ? 'muted' : 'active'})`}
              tabIndex={0}
            ></div>
            <div
              ref={aux2Ref}
              id="aux-btn-2"
              className="pokedex-button-bar w-10 h-3 sm:w-12 sm:h-3.5 bg-slate-800 rounded-full shadow-lg cursor-pointer hover:bg-slate-700 active:translate-y-0.5 transition-all min-h-[20px]"
              onClick={() => handleAuxClick(2)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleAuxClick(2);
                }
              }}
              role="button"
              aria-label="BGM toggle button"
              tabIndex={0}
            ></div>
          </div>

          <div className="flex items-center justify-center gap-1.5 min-w-0">
            <OfflineIndicator />
            <PWAInstallButton />
          </div>

          <div
            id="power-button"
            className="pokedex-button-alt w-8 h-8 sm:w-9 sm:h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center cursor-pointer group min-h-[32px] min-w-[32px]"
            role="button"
            aria-label="Sign in/out status (hold for power)"
            tabIndex={0}
            onPointerDown={(e) => {
              if (e.pointerType === 'mouse' && e.button !== 0) return;
              powerLongPressedRef.current = false;
              clearPowerPress();
              powerTimerRef.current = window.setTimeout(() => {
                powerLongPressedRef.current = true;
                toggleCrtPower();
              }, 650);
            }}
            onPointerUp={() => {
              clearPowerPress();
              if (powerLongPressedRef.current) {
                powerLongPressedRef.current = false;
                return;
              }
              handlePowerTap();
            }}
            onPointerCancel={clearPowerPress}
            onPointerLeave={clearPowerPress}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              handlePowerTap();
            }}
          >
            <div className="w-5 h-5 sm:w-5.5 sm:h-5.5 md:w-6 md:h-6 rounded-full bg-slate-900 shadow-inner flex items-center justify-center group-active:scale-95 transition-transform">
              <div
                id="power-led"
                className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full ${
                  isLoggedIn ? 'session-on' : 'session-idle'
                } transition-all`}
              ></div>
            </div>
          </div>
        </div>
      </div>

      <PortraitLockOverlay />
    </div>
  );
};
