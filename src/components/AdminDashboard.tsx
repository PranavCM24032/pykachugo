import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Award,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Database,
  Download,
  ExternalLink,
  Film,
  Layers,
  LogOut,
  Pause,
  Play,
  Puzzle as PuzzleIcon,
  QrCode,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import {
  adminResetAllData,
  fetchAdminLogs,
  isValidEmail,
  loadAdminCatalog,
  subscribeAdminRealtime,
  verifyAdminCredentials,
  type AdminTeamProgressRow,
  type NormalizedAdminLogRow,
} from '../services/gameBackend';
import { CustomSelect } from './CustomSelect';
import { AdminCreatorPanel, type CreatorMode } from './AdminCreatorPanel';
import { useDialogFocus } from '../hooks/useDialogFocus';
import {
  STORAGE_KEYS,
  type GameConfig,
  type MemeEntry,
  type Puzzle,
  type TeamEntry,
} from '../types/game';

type AdminTab = 'REG' | 'LB' | 'L1' | 'L2' | 'L3' | 'CREATE';
interface SecurityFilter {
  hint: boolean;
  malpractice: boolean;
}

interface LevelRecord {
  lastActive: string;
  tid: string;
  teamName: string;
  mission: string;
  puzzleId: number;
  status: string;
  wrongAttempts: number;
  tabSwitches: number;
  hintUsed: boolean;
  timestamp: string;
  pointsEarned: number;
  pointsLost: number;
  points?: number;
  hasPointData: boolean;
  totalScore: number;
  unlockedPuzzles: string;
}

interface TeamMapRecord {
  name: string;
  teamName: string;
  email: string;
  tid: string;
  registered: boolean;
  regTime: string;
  language: string;
  sessionId: string;
  mission: string;
  levels: {
    L1: LevelRecord[];
    L2: LevelRecord[];
    L3: LevelRecord[];
  };
}

function missionMatchesFilter(mission: string, typeFilter: string): boolean {
  if (!typeFilter || typeFilter === 'ALL') return true;
  const m = String(mission || '').trim().toUpperCase();
  if (!m || m === 'UNASSIGNED' || m === 'UNKNOWN') return false;
  if (m === typeFilter) return true;
  return m.split(/[\s_]+/).includes(typeFilter);
}

function matchesLevel(missionStr: string, targetLvl: string): boolean {
  if (!missionStr) return false;
  const m = missionStr.toUpperCase();
  const lvl = targetLvl.toUpperCase();
  const num = lvl.replace('L', '');
  return m.includes(lvl) || m.includes(`LEVEL_${num}`) || m.includes(`LEVEL ${num}`);
}

function formatTime(ts: string): string {
  if (!ts) return '-';
  const d = new Date(ts);
  return !Number.isNaN(d.getTime())
    ? d.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : ts;
}

const TAB_META: Record<
  AdminTab,
  {
    label: string;
    shortLabel: string;
    section: 'LIVE' | 'DATA';
    description: string;
  }
> = {
  REG: {
    label: 'Registrations',
    shortLabel: 'Registrations',
    section: 'LIVE',
    description: 'Teams that have joined and locked their language & mission.',
  },
  LB: {
    label: 'Leaderboard',
    shortLabel: 'Leaderboard',
    section: 'LIVE',
    description: 'Live rankings sorted by net points and solve telemetry.',
  },
  L1: {
    label: 'Level 1 Activity',
    shortLabel: 'Level 1',
    section: 'LIVE',
    description: 'Elemental sector puzzle attempts, hints, and solve status.',
  },
  L2: {
    label: 'Level 2 Activity',
    shortLabel: 'Level 2',
    section: 'LIVE',
    description: 'Elite sector puzzle attempts, hints, and solve status.',
  },
  L3: {
    label: 'Level 3 Activity',
    shortLabel: 'Level 3',
    section: 'LIVE',
    description: 'Ultimate sector puzzle attempts and final captures.',
  },
  CREATE: {
    label: 'Catalog Studio',
    shortLabel: 'Catalog',
    section: 'DATA',
    description: 'Manage teams, puzzles, memes, Excel imports, and Supabase sync.',
  },
};

export const AdminDashboard: React.FC = () => {
  const [adminSession, setAdminSession] = useState<{ email: string; password: string }>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEYS.adminSessionKey);
      if (!raw) return { email: '', password: '' };
      const parsed = JSON.parse(raw) as { email?: string; password?: string };
      return {
        email: String(parsed?.email || ''),
        password: String(parsed?.password || ''),
      };
    } catch {
      return { email: '', password: '' };
    }
  });
  const adminKey = adminSession.password;
  const [adminEmailInput, setAdminEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string>('');

  const [teams, setTeams] = useState<TeamEntry[]>([]);
  const [memes, setMemes] = useState<MemeEntry[]>([]);
  const [puzzles, setPuzzles] = useState<Puzzle[]>([]);
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [liveLogs, setLiveLogs] = useState<NormalizedAdminLogRow[]>([]);
  const [teamProgressRows, setTeamProgressRows] = useState<AdminTeamProgressRow[]>([]);

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdatedText, setLastUpdatedText] = useState('Syncing...');
  const [systemStatusText, setSystemStatusText] = useState('Connected');
  const [systemStateKind, setSystemStateKind] = useState<'ok' | 'paused' | 'error'>('ok');

  const [activeTab, setActiveTab] = useState<AdminTab>('REG');
  const [creatorMode, setCreatorMode] = useState<CreatorMode>('TEAM');
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [levelFilter, setLevelFilter] = useState('ALL');
  const [securityFilter, setSecurityFilter] = useState<SecurityFilter>({ hint: false, malpractice: false });

  const [confirmMode, setConfirmMode] = useState<
    'none' | 'new_start' | 'reset_1' | 'reset_2'
  >('none');
  const [clearCustomCatalog, setClearCustomCatalog] = useState(false);
  const [resetPasswordInput, setResetPasswordInput] = useState('');
  const [resetPasswordError, setResetPasswordError] = useState('');
  const [resetting, setResetting] = useState(false);
  const [tablePage, setTablePage] = useState(1);
  const ROWS_PER_PAGE = 100;

  const nextSinceRowRef = useRef<number>(2);
  const lastPollEpochRef = useRef<number>(0);
  const pollInFlightRef = useRef<boolean>(false);
  const resetGenRef = useRef<number>(0);
  const confirmDialogRef = useRef<HTMLDivElement | null>(null);
  const confirmCancelButtonRef = useRef<HTMLButtonElement | null>(null);

  useDialogFocus(
    confirmMode !== 'none',
    confirmDialogRef,
    () => {
      if (resetting) return;
      setClearCustomCatalog(false);
      setResetPasswordInput('');
      setResetPasswordError('');
      setConfirmMode('none');
    },
    confirmCancelButtonRef
  );

  const reloadCatalog = useCallback(
    async (keyOverride?: string) => {
      const key = keyOverride ?? adminKey;
      const data = await loadAdminCatalog(key);
      setTeams(data.teams);
      setMemes(data.memes);
      setPuzzles(data.puzzles);
      setConfig(data.config);
    },
    [adminKey]
  );

  // Verify stored session credentials once on mount
  useEffect(() => {
    let cancelled = false;
    const savedEmail = adminSession.email.trim().toLowerCase();
    const savedPass = adminSession.password.trim();
    if (!savedEmail || !savedPass) {
      setIsAdmin(false);
      setAuthChecking(false);
      return;
    }
    setAuthChecking(true);
    verifyAdminCredentials(savedEmail, savedPass, true)
      .then((ok) => {
        if (cancelled) return;
        setIsAdmin(ok);
        if (!ok) {
          try {
            sessionStorage.removeItem(STORAGE_KEYS.adminSessionKey);
          } catch {
            // ignore
          }
          setAdminSession({ email: '', password: '' });
        }
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      })
      .finally(() => {
        if (!cancelled) setAuthChecking(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load catalog when authenticated
  useEffect(() => {
    if (!isAdmin || !adminKey) return;
    reloadCatalog(adminKey).catch((err) => {
      console.warn('Admin failed loading catalog:', err);
    });
  }, [isAdmin, adminKey, reloadCatalog]);

  // Differential delta log polling + Supabase Realtime push with 15s fallback
  useEffect(() => {
    if (!isAdmin || !adminKey) return;
    let cancelled = false;

    const pollOnce = async (forceWhileHidden = false) => {
      if (pollInFlightRef.current) return;
      if (!forceWhileHidden && typeof document !== 'undefined' && document.hidden) return;
      pollInFlightRef.current = true;
      const pollResetGen = resetGenRef.current;
      try {
        const res = await fetchAdminLogs(adminKey, nextSinceRowRef.current);
        if (cancelled || pollResetGen !== resetGenRef.current) return;

        const epochChanged =
          lastPollEpochRef.current !== 0 && res.epoch !== lastPollEpochRef.current;
        lastPollEpochRef.current = res.epoch;

        if (res.fullSnapshot) {
          nextSinceRowRef.current = Math.max(2, res.nextSinceRow);
          setLiveLogs(res.logs);
          setTeamProgressRows(res.teamProgress);
        } else if (epochChanged) {
          nextSinceRowRef.current = 2;
          const fresh = await fetchAdminLogs(adminKey, 2);
          if (cancelled || pollResetGen !== resetGenRef.current) return;
          nextSinceRowRef.current = Math.max(2, fresh.nextSinceRow);
          setLiveLogs(fresh.logs);
          setTeamProgressRows(fresh.teamProgress);
        } else {
          nextSinceRowRef.current = Math.max(3, res.nextSinceRow);
          if (res.logs.length > 0 || res.teamProgress.length > 0) {
            setTeamProgressRows(res.teamProgress);
          }
          if (res.logs.length > 0) {
            setLiveLogs((prev) => {
              if (prev.length === 0) return res.logs;
              const next = [...prev];
              const idxById = new Map<string, number>();
              next.forEach((item, i) => idxById.set(item.id, i));
              let changed = false;
              res.logs.forEach((incoming) => {
                const existingIdx = idxById.get(incoming.id);
                if (existingIdx !== undefined) {
                  next[existingIdx] = incoming;
                  changed = true;
                } else {
                  idxById.set(incoming.id, next.length);
                  next.push(incoming);
                  changed = true;
                }
              });
              return changed ? next : prev;
            });
          }
        }

        setLastUpdatedText(
          `Updated ${new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}`
        );
        setSystemStatusText('Connected');
        setSystemStateKind('ok');
      } catch (err) {
        if (cancelled) return;
        console.warn('Admin polling error:', err);
        const isAuthError = err instanceof Error && /unauthorized/i.test(err.message);
        setLastUpdatedText(isAuthError ? 'Credential mismatch' : 'Retrying...');
        setSystemStatusText(isAuthError ? 'Auth mismatch' : 'Offline');
        setSystemStateKind('error');
      } finally {
        pollInFlightRef.current = false;
      }
    };

    void pollOnce(true);
    if (!autoRefresh) return () => { cancelled = true; };

    const unsubscribeRealtime = subscribeAdminRealtime(() => {
      void pollOnce();
    });

    const handleVisibility = () => {
      if (!document.hidden) {
        void pollOnce();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    const intervalId = window.setInterval(() => {
      void pollOnce();
    }, 12000);

    return () => {
      cancelled = true;
      unsubscribeRealtime();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearInterval(intervalId);
    };
  }, [isAdmin, adminKey, autoRefresh]);

  const { puzzleLinkById, puzzleLevelById, puzzlePointsById } = useMemo(() => {
    const linkMap: Record<number, string> = {};
    const levelMap: Record<number, 'L1' | 'L2' | 'L3'> = {};
    const ptsMap: Record<number, number> = {};
    puzzles.forEach((p) => {
      const pid = Number(p.id);
      if (pid > 0) {
        if (p.linkid) linkMap[pid] = p.linkid;
        const numLvl = Number(p.level || 1);
        levelMap[pid] = numLvl === 2 ? 'L2' : numLvl === 3 ? 'L3' : 'L1';
        ptsMap[pid] = Number(p.points || 0);
      }
    });
    return { puzzleLinkById: linkMap, puzzleLevelById: levelMap, puzzlePointsById: ptsMap };
  }, [puzzles]);

  const typeSelectOptions = useMemo(() => {
    const base = [{ value: 'ALL', label: 'All Types' }];
    if (config?.missionTypes) {
      return [...base, ...config.missionTypes];
    }
    return base;
  }, [config]);

  const levelSelectOptions = useMemo(() => {
    const base = [{ value: 'ALL', label: 'All Levels' }];
    if (config?.missionGroups) {
      const items = config.missionGroups.map((g) => ({
        value: g.level,
        label: g.label.replace(/:.*/, '').trim(),
      }));
      return [...base, ...items];
    }
    return base;
  }, [config]);

  // Build unified team map with O(1) TID + Name indexing
  const { teamMap, totalSolved, registeredCount, flaggedTabCount } = useMemo(() => {
    const map: Record<string, TeamMapRecord> = {};
    const byTidMap = new Map<string, TeamMapRecord>();

    teams.forEach((t) => {
      const name = String(t.team || '').trim().toUpperCase();
      if (!name) return;
      const emailSummary =
        t.emails && t.emails.length > 0 ? t.emails.join(', ') : t.email || '';
      const rec: TeamMapRecord = {
        name,
        teamName: t.team,
        email: emailSummary,
        tid: t.tid || '',
        registered: false,
        regTime: '',
        language: '',
        sessionId: '',
        mission: 'UNASSIGNED',
        levels: { L1: [], L2: [], L3: [] },
      };
      map[name] = rec;
      const normTid = String(t.tid || '').trim().toUpperCase();
      if (normTid) byTidMap.set(normTid, rec);
    });

    // O(1) per-team puzzle tracking sets so merging 300 teams x 40 puzzles is linear
    const seenPuzzleIdsByTeam = new Map<TeamMapRecord, Set<number>>();
    const solvedPuzzleIdsByTeam = new Map<TeamMapRecord, Set<number>>();

    liveLogs.forEach((log) => {
      const name = String(log.teamName || '').trim().toUpperCase();
      if (!name || name === 'UNKNOWN' || name === 'NO TEAM') return;

      const normTid = String(log.tid || '').trim().toUpperCase();
      let t = (normTid ? byTidMap.get(normTid) : undefined) || map[name] || null;
      if (!t) {
        t = {
          name,
          teamName: log.teamName || name,
          email: log.email || '',
          tid: log.tid || '',
          registered: false,
          regTime: '',
          language: '',
          sessionId: log.sessionId || '',
          mission: log.mission || 'UNKNOWN',
          levels: { L1: [], L2: [], L3: [] },
        };
        map[name] = t;
        if (normTid) byTidMap.set(normTid, t);
      }

      if (log.tid && !t.tid) {
        t.tid = log.tid;
        if (normTid) byTidMap.set(normTid, t);
      }
      if (log.email) {
        t.email = log.email;
      }
      if (log.mission && (t.mission === 'UNASSIGNED' || t.mission === 'UNKNOWN')) {
        t.mission = log.mission;
      }
      if (log.sessionId && !t.sessionId) t.sessionId = log.sessionId;

      if (log.action === 'REGISTRATION') {
        t.registered = true;
        t.regTime = log.registeredAt || log.lastActive || log.timestamp || '';
        t.language = log.language || t.language || 'PYTHON';
        if (log.email) t.email = log.email;
        if (log.mission) t.mission = log.mission;
      } else if (log.action === 'SUMMARY' && log.level) {
        const lvl = log.level.toUpperCase() as 'L1' | 'L2' | 'L3';
        if (lvl === 'L1' || lvl === 'L2' || lvl === 'L3') {
          const pid = Number(log.puzzleId || 0);
          const status = log.status || 'ACTIVE';
          t.levels[lvl].push({
            lastActive: log.lastActive || log.timestamp || '',
            tid: log.tid || t.tid || '',
            teamName: log.teamName || t.teamName,
            mission: log.mission || t.mission,
            puzzleId: pid,
            status,
            wrongAttempts: Number(log.wrongAttempts || 0),
            tabSwitches: Number(log.tabSwitches || 0),
            hintUsed: Boolean(log.hintUsed),
            timestamp: log.timestamp || '',
            pointsEarned: Number(log.pointsEarned || 0),
            pointsLost: Number(log.pointsLost || 0),
            points: Number(log.points || 0),
            hasPointData: true,
            totalScore: Number(log.totalScore || 0),
            unlockedPuzzles: log.unlockedPuzzles || '',
          });
          if (pid > 0) {
            let seen = seenPuzzleIdsByTeam.get(t);
            if (!seen) {
              seen = new Set<number>();
              seenPuzzleIdsByTeam.set(t, seen);
            }
            seen.add(pid);
            if (status === 'SOLVED' || status === 'REPEAT_SOLVE') {
              let solvedSet = solvedPuzzleIdsByTeam.get(t);
              if (!solvedSet) {
                solvedSet = new Set<number>();
                solvedPuzzleIdsByTeam.set(t, solvedSet);
              }
              solvedSet.add(pid);
            }
          }
        }
      }
    });

    // Merge authoritative team_progress snapshot so active & solved teams appear immediately
    teamProgressRows.forEach((prog) => {
      const normTid = String(prog.tid || '').trim().toUpperCase();
      const name = String(prog.teamName || '').trim().toUpperCase();
      let t = (normTid ? byTidMap.get(normTid) : undefined) || (name ? map[name] : undefined) || null;
      if (!t && name) {
        t = {
          name,
          teamName: prog.teamName || name,
          email: prog.email || '',
          tid: prog.tid || '',
          registered: true,
          regTime: prog.registeredAt || prog.updatedAt || '',
          language: prog.language || 'PYTHON',
          sessionId: prog.sessionId || '',
          mission: prog.mission || 'UNASSIGNED',
          levels: { L1: [], L2: [], L3: [] },
        };
        map[name] = t;
        if (normTid) byTidMap.set(normTid, t);
      }
      if (!t) return;

      t.registered = true;
      if (!t.regTime) t.regTime = prog.registeredAt || prog.updatedAt || '';
      if (prog.language) t.language = prog.language;
      if (prog.email) t.email = prog.email;
      if (prog.sessionId && !t.sessionId) t.sessionId = prog.sessionId;
      if (prog.mission && (t.mission === 'UNASSIGNED' || t.mission === 'UNKNOWN')) {
        t.mission = prog.mission;
      }

      const fallbackLvl: 'L1' | 'L2' | 'L3' = matchesLevel(t.mission, 'L3')
        ? 'L3'
        : matchesLevel(t.mission, 'L2')
          ? 'L2'
          : 'L1';
      const unlockedStr = prog.unlocked.join(',');
      const solvedSetProg = new Set<number>(prog.solved.map(Number));
      const hintsUsedSetProg = new Set<number>(prog.hintsUsed.map(Number));
      const teamSolvedSet = solvedPuzzleIdsByTeam.get(t);
      const teamSeenSet = seenPuzzleIdsByTeam.get(t);

      prog.solved.forEach((pidRaw) => {
        const pid = Number(pidRaw);
        if (!pid) return;
        const lvl = puzzleLevelById[pid] || fallbackLvl;
        if (!teamSolvedSet || !teamSolvedSet.has(pid)) {
          const pts = puzzlePointsById[pid] || 0;
          t!.levels[lvl].push({
            lastActive: prog.updatedAt || prog.registeredAt || '',
            tid: prog.tid || t!.tid || '',
            teamName: prog.teamName || t!.teamName,
            mission: prog.mission || t!.mission,
            puzzleId: pid,
            status: 'SOLVED',
            wrongAttempts: 0,
            tabSwitches: prog.tabSwitches,
            hintUsed: hintsUsedSetProg.has(pid),
            timestamp: prog.updatedAt || prog.registeredAt || '',
            pointsEarned: pts,
            pointsLost: 0,
            points: pts,
            hasPointData: pts > 0,
            totalScore: prog.score,
            unlockedPuzzles: unlockedStr,
          });
        }
      });

      if (prog.currentPuzzle > 0 && !solvedSetProg.has(prog.currentPuzzle)) {
        const pid = prog.currentPuzzle;
        const lvl = puzzleLevelById[pid] || fallbackLvl;
        if (!teamSeenSet || !teamSeenSet.has(pid)) {
          t.levels[lvl].push({
            lastActive: prog.updatedAt || prog.registeredAt || '',
            tid: prog.tid || t.tid || '',
            teamName: prog.teamName || t.teamName,
            mission: prog.mission || t.mission,
            puzzleId: pid,
            status: 'ACTIVE',
            wrongAttempts: 0,
            tabSwitches: prog.tabSwitches,
            hintUsed: hintsUsedSetProg.has(pid),
            timestamp: prog.updatedAt || prog.registeredAt || '',
            pointsEarned: 0,
            pointsLost: 0,
            points: 0,
            hasPointData: false,
            totalScore: prog.score,
            unlockedPuzzles: unlockedStr,
          });
        }
      }
    });

    let solvedCount = 0;
    let regTotal = 0;
    let tabTeams = 0;
    Object.values(map).forEach((t) => {
      if (t.registered) regTotal++;
      let hasTabSwitch = false;
      (['L1', 'L2', 'L3'] as const).forEach((l) => {
        t.levels[l].forEach((r) => {
          if (r.status === 'SOLVED') solvedCount++;
          if ((r.tabSwitches || 0) > 0) hasTabSwitch = true;
        });
      });
      if (hasTabSwitch) tabTeams++;
    });

    return {
      teamMap: map,
      totalSolved: solvedCount,
      registeredCount: regTotal,
      flaggedTabCount: tabTeams,
    };
  }, [teams, liveLogs, teamProgressRows, puzzleLevelById, puzzlePointsById]);

  const normalizedSearch = searchTerm.trim().toLowerCase();

  const filteredStandardTeams = useMemo(() => {
    let list = Object.values(teamMap);
    if (normalizedSearch) {
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(normalizedSearch) ||
          String(t.email || '').toLowerCase().includes(normalizedSearch) ||
          String(t.tid || '').toLowerCase().includes(normalizedSearch)
      );
    }

    if (activeTab === 'REG') {
      list = list.filter((t) => t.registered);
    } else if (activeTab === 'L1' || activeTab === 'L2' || activeTab === 'L3') {
      list = list.filter(
        (t) =>
          t.levels[activeTab].length > 0 || matchesLevel(t.mission, activeTab)
      );
    }

    if (levelFilter !== 'ALL') {
      const lvlKey = levelFilter as 'L1' | 'L2' | 'L3';
      list = list.filter(
        (t) =>
          (t.levels[lvlKey] && t.levels[lvlKey].length > 0) ||
          matchesLevel(t.mission, levelFilter)
      );
    }

    if (typeFilter !== 'ALL') {
      list = list.filter((t) => missionMatchesFilter(t.mission, typeFilter));
    }

    const levelsForFilter: Array<'L1' | 'L2' | 'L3'> =
      levelFilter !== 'ALL'
        ? [levelFilter as 'L1' | 'L2' | 'L3']
        : activeTab === 'LB'
          ? ['L1', 'L2', 'L3']
          : activeTab === 'L1' || activeTab === 'L2' || activeTab === 'L3'
            ? [activeTab]
            : ['L1', 'L2', 'L3'];

    if (securityFilter.hint) {
      list = list.filter((t) => {
        if (activeTab === 'REG') return false;
        return levelsForFilter.some((l) => t.levels[l]?.some((r) => r.hintUsed));
      });
    }
    if (securityFilter.malpractice) {
      list = list.filter((t) => {
        if (activeTab === 'REG') return false;
        return levelsForFilter.some((l) =>
          t.levels[l]?.some((r) => (r.tabSwitches || 0) > 0)
        );
      });
    }

    return list;
  }, [
    teamMap,
    normalizedSearch,
    activeTab,
    levelFilter,
    typeFilter,
    securityFilter,
  ]);

  const lbRows = useMemo(() => {
    const leaderboardLevels: Array<'L1' | 'L2' | 'L3'> =
      levelFilter === 'ALL' ? ['L1', 'L2', 'L3'] : [levelFilter as 'L1' | 'L2' | 'L3'];

    let rows = Object.values(teamMap).map((t) => {
      let solved = 0;
      let totalHints = 0;
      let totalTabs = 0;
      let pointsFromRecords = 0;
      let hasPointData = false;
      let latestTimestamp = '';
      let latestTimestampMs = -1;
      let hasHint = false;
      let hasMalpractice = false;
      let latestScore = 0;

      leaderboardLevels.forEach((l) => {
        const recs = t.levels[l];
        if (!Array.isArray(recs)) return;
        recs.forEach((r) => {
          if (r.status === 'SOLVED') solved++;
          if (r.hintUsed) {
            totalHints++;
            hasHint = true;
          }
          totalTabs += Math.max(0, r.tabSwitches || 0);
          if (r.tabSwitches > 0) hasMalpractice = true;

          if (r.status === 'SOLVED' || r.status === 'REPEAT_SOLVE') {
            pointsFromRecords += Number(r.points || 0);
            hasPointData = true;
          }

          const recordTimestamp = r.timestamp || '';
          const ms = recordTimestamp ? new Date(recordTimestamp).getTime() : NaN;
          if (Number.isFinite(ms) && ms >= latestTimestampMs) {
            latestTimestampMs = ms;
            latestTimestamp = recordTimestamp;
            latestScore = Number(r.totalScore || 0);
          }
        });
      });

      if (!latestTimestamp) latestTimestamp = t.regTime || '';
      const pts = hasPointData ? pointsFromRecords : latestScore;

      return {
        name: t.name,
        teamName: t.teamName,
        tid: t.tid || '-',
        timestamp: latestTimestamp,
        solved,
        totalHints,
        totalTabs,
        pts,
        mission: t.mission,
        hasHint,
        hasMalpractice,
      };
    });

    if (normalizedSearch) {
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(normalizedSearch) ||
          String(r.tid || '').toLowerCase().includes(normalizedSearch)
      );
    }
    if (typeFilter !== 'ALL') {
      rows = rows.filter((r) => missionMatchesFilter(r.mission, typeFilter));
    }
    if (securityFilter.hint) rows = rows.filter((r) => r.hasHint);
    if (securityFilter.malpractice) rows = rows.filter((r) => r.hasMalpractice);

    rows.sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
    return rows;
  }, [teamMap, levelFilter, normalizedSearch, typeFilter, securityFilter]);

  const levelAssertRows = useMemo(() => {
    if (activeTab !== 'L1' && activeTab !== 'L2' && activeTab !== 'L3') return [];
    const rows: Array<{ team: TeamMapRecord; record: LevelRecord | null }> = [];
    filteredStandardTeams.forEach((team) => {
      const recs = team.levels[activeTab];
      if (recs.length) {
        recs.forEach((r) => rows.push({ team, record: r }));
      } else {
        rows.push({ team, record: null });
      }
    });
    return rows;
  }, [filteredStandardTeams, activeTab]);

  useEffect(() => {
    setTablePage(1);
  }, [activeTab, normalizedSearch, typeFilter, levelFilter, securityFilter]);

  const activeTableTotalRows =
    activeTab === 'LB'
      ? lbRows.length
      : activeTab === 'REG'
        ? filteredStandardTeams.length
        : levelAssertRows.length;

  const totalTablePages = Math.max(1, Math.ceil(activeTableTotalRows / ROWS_PER_PAGE));
  const safeTablePage = Math.min(Math.max(1, tablePage), totalTablePages);
  const tableStartIdx = (safeTablePage - 1) * ROWS_PER_PAGE;

  const pagedLbRows = useMemo(
    () => lbRows.slice(tableStartIdx, tableStartIdx + ROWS_PER_PAGE),
    [lbRows, tableStartIdx]
  );
  const pagedRegTeams = useMemo(
    () => filteredStandardTeams.slice(tableStartIdx, tableStartIdx + ROWS_PER_PAGE),
    [filteredStandardTeams, tableStartIdx]
  );
  const pagedLevelAssertRows = useMemo(
    () => levelAssertRows.slice(tableStartIdx, tableStartIdx + ROWS_PER_PAGE),
    [levelAssertRows, tableStartIdx]
  );

  const hasActiveFilters =
    searchTerm.trim() !== '' ||
    typeFilter !== 'ALL' ||
    levelFilter !== 'ALL' ||
    securityFilter.hint ||
    securityFilter.malpractice;

  const clearAllFilters = () => {
    setSearchTerm('');
    setTypeFilter('ALL');
    setLevelFilter('ALL');
    setSecurityFilter({ hint: false, malpractice: false });
  };

  const handleAdminLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const candidateEmail = adminEmailInput.trim().toLowerCase();
    const candidatePass = passwordInput.trim();
    if (!candidateEmail || !candidatePass) {
      setAuthError('Enter both Admin Email ID and Password.');
      return;
    }
    if (!isValidEmail(candidateEmail)) {
      setAuthError('Enter a valid email address.');
      return;
    }
    setAuthBusy(true);
    setAuthError('');
    try {
      const ok = await verifyAdminCredentials(candidateEmail, candidatePass);
      if (!ok) {
        setAuthError('Invalid admin email or password.');
        setIsAdmin(false);
        return;
      }
      const nextSession = { email: candidateEmail, password: candidatePass };
      try {
        sessionStorage.setItem(STORAGE_KEYS.adminSessionKey, JSON.stringify(nextSession));
      } catch {
        // ignore
      }
      nextSinceRowRef.current = 2;
      lastPollEpochRef.current = 0;
      setAdminSession(nextSession);
      setAdminEmailInput('');
      setPasswordInput('');
      setIsAdmin(true);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Unable to verify admin credentials.'
      );
    } finally {
      setAuthBusy(false);
    }
  };

  const handleAdminLogout = () => {
    try {
      sessionStorage.removeItem(STORAGE_KEYS.adminSessionKey);
    } catch {
      // ignore
    }
    setAdminSession({ email: '', password: '' });
    setIsAdmin(false);
    setLiveLogs([]);
    setTeamProgressRows([]);
    nextSinceRowRef.current = 2;
    lastPollEpochRef.current = 0;
  };

  const toggleAutoRefresh = () => {
    setAutoRefresh((prev) => {
      const next = !prev;
      if (next) {
        setSystemStatusText('Connected');
        setSystemStateKind('ok');
      } else {
        setSystemStatusText('Paused');
        setSystemStateKind('paused');
      }
      return next;
    });
  };

  const handleNewStart = () => {
    setConfirmMode('none');
    nextSinceRowRef.current = 2;
    setLiveLogs([]);
    setTeamProgressRows([]);
    setSystemStatusText('Refreshing...');
    setSystemStateKind('paused');
    window.setTimeout(() => {
      fetchAdminLogs(adminKey, 2)
        .then((res) => {
          lastPollEpochRef.current = res.epoch;
          nextSinceRowRef.current = Math.max(2, res.nextSinceRow);
          setLiveLogs(res.logs);
          setTeamProgressRows(res.teamProgress);
          setSystemStatusText(autoRefresh ? 'Connected' : 'Paused');
          setSystemStateKind(autoRefresh ? 'ok' : 'paused');
        })
        .catch(() => {
          setSystemStatusText(autoRefresh ? 'Connected' : 'Paused');
          setSystemStateKind(autoRefresh ? 'ok' : 'paused');
        });
    }, 450);
  };

  const handleResetEverything = async () => {
    if (!adminKey) return;
    const enteredPass = resetPasswordInput.trim();
    if (!enteredPass) {
      setResetPasswordError('Enter your admin password to confirm reset.');
      return;
    }

    setResetting(true);
    setResetPasswordError('');

    try {
      let passwordValid = enteredPass === adminSession.password;
      if (passwordValid && adminSession.email) {
        try {
          passwordValid = await verifyAdminCredentials(adminSession.email, enteredPass);
        } catch (error) {
          setResetPasswordError(
            error instanceof Error
              ? error.message
              : 'Could not verify your password. Check your connection and try again.'
          );
          setResetting(false);
          return;
        }
      }

      if (!passwordValid) {
        setResetPasswordError('Incorrect admin password.');
        setResetting(false);
        return;
      }

      resetGenRef.current += 1;
      setConfirmMode('none');
      setResetPasswordInput('');
      setResetPasswordError('');
      setSystemStatusText('Clearing...');
      setSystemStateKind('error');
      setLastUpdatedText('Clearing event data...');

      const nextEpoch = await adminResetAllData(adminKey, clearCustomCatalog);
      nextSinceRowRef.current = 2;
      lastPollEpochRef.current = nextEpoch;
      setLiveLogs([]);
      setTeamProgressRows([]);
      setTablePage(1);
      if (clearCustomCatalog) {
        await reloadCatalog(adminKey);
      }
      setClearCustomCatalog(false);
      setSystemStatusText('Reset complete');
      setSystemStateKind('ok');
      setLastUpdatedText('Event data cleared');
      window.setTimeout(() => {
        setSystemStatusText(autoRefresh ? 'Connected' : 'Paused');
        setSystemStateKind(autoRefresh ? 'ok' : 'paused');
      }, 2500);
    } catch (err) {
      console.error('Reset failed:', err);
      setSystemStatusText('Reset failed');
      setSystemStateKind('error');
      setLastUpdatedText('Permission or network error');
    } finally {
      setResetting(false);
    }
  };

  const handleExportCsv = () => {
    const headers = [
      'Timestamp',
      'Action',
      'Level',
      'TID',
      'TeamName',
      'Email',
      'Mission',
      'Language',
      'PuzzleID',
      'Status',
      'WrongAttempts',
      'TabSwitches',
      'HintUsed',
      'Points',
      'TotalScore',
    ];
    const escapeCsv = (val: unknown) => {
      const s = String(val ?? '');
      const neutralized = /^[\t\r\n ]*[=+\-@]/.test(s) ? `'${s}` : s;
      return `"${neutralized.replace(/"/g, '""')}"`;
    };
    const rows = liveLogs.map((l) =>
      [
        l.timestamp,
        l.action,
        l.level,
        l.tid,
        l.teamName,
        l.email || '',
        l.mission,
        l.language,
        l.puzzleId,
        l.status,
        l.wrongAttempts,
        l.tabSwitches,
        l.hintUsed ? '1' : '0',
        l.points,
        l.totalScore,
      ]
        .map(escapeCsv)
        .join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pykachu-go-telemetry-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const tabIcon = (tab: AdminTab) => {
    switch (tab) {
      case 'REG':
        return <ClipboardList className="w-4 h-4 shrink-0" />;
      case 'LB':
        return <Trophy className="w-4 h-4 shrink-0" />;
      case 'L1':
      case 'L2':
      case 'L3':
        return <Layers className="w-4 h-4 shrink-0" />;
      case 'CREATE':
        return <Database className="w-4 h-4 shrink-0" />;
    }
  };

  const liveNavTabs: AdminTab[] = ['REG', 'LB', 'L1', 'L2', 'L3'];
  const creatorNavTabs: { mode: CreatorMode; label: string; Icon: React.ElementType; count?: number }[] = [
    { mode: 'TEAM', label: 'Teams', Icon: Users, count: teams.length },
    { mode: 'PUZZLE', label: 'Puzzles', Icon: PuzzleIcon, count: puzzles.length },
    { mode: 'MEME', label: 'Memes', Icon: Film, count: memes.length },
    { mode: 'QR', label: 'QR Builder', Icon: QrCode },
  ];

  return (
    <div className="admin-viewport">
      {/* Organizer Sign-In Gate */}
      {!isAdmin && (
        <div
          id="adminAuthModal"
          className="fixed inset-0 z-50 grid min-h-[100dvh] place-items-center bg-[#090D16] px-4 py-6"
        >
          <form
            onSubmit={handleAdminLoginSubmit}
            className="w-full max-w-sm rounded-xl border border-slate-800 bg-[#0E1420] p-6 shadow-2xl"
          >
            <div className="flex items-center gap-2.5 mb-2">
              <img
                src="/assets/img/pokeball.svg"
                alt=""
                className="w-5 h-5 object-contain"
              />
              <span className="text-sm font-semibold text-white">Pykachu Go</span>
            </div>
            <h1 className="text-xl font-semibold text-white tracking-tight">
              Organizer Sign In
            </h1>
            <p className="mt-1.5 text-sm text-slate-400">
              Sign in with your organizer email address and password.
            </p>

            <div className="mt-5 space-y-4">
              <div>
                <label
                  htmlFor="adminEmailInput"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Admin Email ID
                </label>
                <input
                  type="email"
                  id="adminEmailInput"
                  value={adminEmailInput}
                  onChange={(e) => setAdminEmailInput(e.target.value)}
                  placeholder="admin@pykachu.go"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={authChecking || authBusy}
                  className="w-full h-11 rounded-lg border border-slate-800 bg-[#090D16] px-3.5 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="adminPasswordInput"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Password
                </label>
                <input
                  type="password"
                  id="adminPasswordInput"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  disabled={authChecking || authBusy}
                  className="w-full h-11 rounded-lg border border-slate-800 bg-[#090D16] px-3.5 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            {authError && (
              <p
                id="adminAuthError"
                className="mt-3 text-xs text-rose-400 bg-rose-950/30 border border-rose-500/30 rounded-lg px-3 py-2"
              >
                {authError}
              </p>
            )}

            <button
              type="submit"
              disabled={authChecking || authBusy}
              className="mt-5 w-full h-11 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60 transition-colors cursor-pointer"
            >
              {authChecking
                ? 'Checking session...'
                : authBusy
                  ? 'Verifying...'
                  : 'Sign In'}
            </button>

            <a
              href="/"
              className="mt-4 block text-center text-xs text-slate-400 hover:text-white transition-colors"
            >
              Return to Pokédex Terminal
            </a>
          </form>
        </div>
      )}

      {/* Confirmation Modals */}
      {confirmMode !== 'none' && (
        <div
          ref={confirmDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="adminConfirmTitle"
          tabIndex={-1}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (resetting) return;
              if (confirmMode === 'new_start') handleNewStart();
              else if (confirmMode === 'reset_1') {
                setResetPasswordInput('');
                setResetPasswordError('');
                setConfirmMode('reset_2');
              } else {
                void handleResetEverything();
              }
            }}
            className="w-full max-w-sm rounded-xl border border-slate-800 bg-[#0E1420] p-6 shadow-2xl fade-in"
          >
            <h3 id="adminConfirmTitle" className="text-base font-semibold text-white">
              {confirmMode === 'new_start'
                ? 'Refresh Telemetry Feed?'
                : confirmMode === 'reset_1'
                  ? 'Reset Event Data?'
                  : 'Confirm Permanent Reset'}
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              {confirmMode === 'new_start'
                ? 'Reloads live telemetry logs from the backend for the current session.'
                : confirmMode === 'reset_1'
                  ? 'Clears all telemetry logs, team scores, hint usage, and player progress across local storage and Supabase.'
                  : 'Every team’s saved score, progress, and logs will be erased and the event epoch will advance. This action cannot be undone.'}
            </p>
            {(confirmMode === 'reset_1' || confirmMode === 'reset_2') && (
              <label className="mt-4 flex items-start gap-2.5 rounded-lg border border-slate-800 bg-[#090D16] p-3 text-xs text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={clearCustomCatalog}
                  disabled={resetting}
                  onChange={(e) => setClearCustomCatalog(e.target.checked)}
                  className="mt-0.5 accent-rose-500"
                />
                <span>Also clear custom Creator Studio edits (teams, puzzles &amp; memes)</span>
              </label>
            )}
            {confirmMode === 'reset_2' && (
              <div className="mt-4 space-y-1.5">
                <label
                  htmlFor="resetAdminPasswordInput"
                  className="block text-xs font-medium text-slate-300"
                >
                  Admin Password ({adminSession.email || 'Organizer'})
                </label>
                <input
                  type="password"
                  id="resetAdminPasswordInput"
                  value={resetPasswordInput}
                  onChange={(e) => {
                    setResetPasswordInput(e.target.value);
                    if (resetPasswordError) setResetPasswordError('');
                  }}
                  placeholder="Enter your admin password"
                  autoComplete="current-password"
                  autoFocus
                  disabled={resetting}
                  className="w-full h-10 rounded-lg border border-slate-800 bg-[#090D16] px-3 text-xs text-white placeholder-slate-500 focus:border-rose-500 focus:outline-none"
                />
                {resetPasswordError && (
                  <p className="text-xs text-rose-400">{resetPasswordError}</p>
                )}
              </div>
            )}
            <div className="mt-5 flex gap-2.5">
              <button
                ref={confirmCancelButtonRef}
                type="button"
                disabled={resetting}
                onClick={() => {
                  setClearCustomCatalog(false);
                  setResetPasswordInput('');
                  setResetPasswordError('');
                  setConfirmMode('none');
                }}
                className="flex-1 h-10 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={resetting || (confirmMode === 'reset_2' && !resetPasswordInput.trim())}
                className={`flex-1 h-10 rounded-lg text-xs font-medium text-white cursor-pointer disabled:opacity-50 ${
                  confirmMode === 'new_start'
                    ? 'bg-indigo-600 hover:bg-indigo-500'
                    : 'bg-rose-600 hover:bg-rose-500'
                }`}
              >
                {confirmMode === 'new_start'
                  ? 'Refresh Now'
                  : confirmMode === 'reset_1'
                    ? 'Continue'
                    : resetting
                      ? 'Verifying...'
                      : 'Reset Everything'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Workspace Shell: Clean 240px Sidebar + Main Content */}
      <div className="flex flex-1 min-h-[100dvh]">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:flex w-60 shrink-0 flex-col justify-between bg-[#0B101B] border-r border-slate-800/80">
          <div className="p-5 space-y-7">
            {/* Brand Zone (Single Line) */}
            <div className="flex items-center gap-2.5 px-2">
              <img
                src="/assets/img/pokeball.svg"
                alt=""
                className="w-5 h-5 object-contain shrink-0"
              />
              <span className="text-base font-semibold text-white tracking-tight whitespace-nowrap">
                Pykachu Go
              </span>
            </div>

            {/* Navigation Groups */}
            <nav className="space-y-6" aria-label="Console Navigation">
              <div>
                <div className="px-2.5 mb-2 text-[11px] font-medium text-slate-500">
                  Live Operations
                </div>
                <div className="space-y-1">
                  {liveNavTabs.map((tab) => {
                    const active = activeTab === tab;
                    const badgeCount =
                      tab === 'REG'
                        ? registeredCount
                        : tab === 'LB'
                          ? lbRows.length
                          : undefined;
                    return (
                      <button
                        key={tab}
                        type="button"
                        id={`tab-${tab}`}
                        onClick={() => setActiveTab(tab)}
                        className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                          active
                            ? 'bg-indigo-600/15 text-indigo-300'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                        }`}
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          {tabIcon(tab)}
                          <span className="truncate">{TAB_META[tab].label}</span>
                        </span>
                        {badgeCount !== undefined && (
                          <span className="font-mono tabular-nums text-[11px] text-slate-500">
                            {badgeCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="px-2.5 mb-2 text-[11px] font-medium text-slate-500">
                  Event Data
                </div>
                <div className="space-y-1">
                  {creatorNavTabs.map(({ mode, label, Icon, count }) => {
                    const active = activeTab === 'CREATE' && creatorMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        id={`catalog-tab-${mode}`}
                        onClick={() => {
                          setCreatorMode(mode);
                          setActiveTab('CREATE');
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                          active
                            ? 'bg-indigo-600/15 text-indigo-300'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                        }`}
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          <Icon className="w-4 h-4 shrink-0" />
                          <span className="truncate">{label}</span>
                        </span>
                        {count !== undefined && <span className="font-mono tabular-nums text-[11px] text-slate-500">{count}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </nav>
          </div>

          {/* Sidebar Bottom Controls */}
          <div className="p-4 border-t border-slate-800/80 space-y-3">
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setConfirmMode('new_start')}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-800/50 transition-colors cursor-pointer whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
                <span>Refresh Feed</span>
              </button>

              <button
                type="button"
                disabled={resetting}
                onClick={() => setConfirmMode('reset_1')}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium text-rose-400 hover:bg-rose-500/10 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Reset Event Data</span>
              </button>
            </div>

            <div className="pt-3 border-t border-slate-800/60 flex items-center justify-between gap-2 px-1">
              <div className="min-w-0">
                <div className="text-xs font-medium text-slate-200 truncate">
                  {adminSession.email || 'Organizer'}
                </div>
              </div>
              <button
                type="button"
                onClick={handleAdminLogout}
                className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content Viewport */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Top Bar Contract: Single Clean Row */}
          <header className="h-16 px-4 sm:px-6 lg:px-8 border-b border-slate-800/80 bg-[#090D16] flex items-center justify-between gap-4 sticky top-0 z-30">
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-500 hidden sm:inline">Console</span>
              <span className="text-slate-600 hidden sm:inline">/</span>
              <h1 className="font-semibold text-white truncate">
                {TAB_META[activeTab].label}
              </h1>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <span className="hidden md:inline text-xs text-slate-500 whitespace-nowrap" id="lastUpdated">
                {lastUpdatedText}
              </span>

              <button
                type="button"
                onClick={toggleAutoRefresh}
                className="h-9 px-3 rounded-lg border border-slate-800 bg-[#0E1420] hover:bg-slate-800 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                title={autoRefresh ? 'Pause automatic updates' : 'Resume automatic updates'}
              >
                {autoRefresh ? (
                  <Pause className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Play className="w-3.5 h-3.5 text-amber-400" />
                )}
                <span>{autoRefresh ? 'Auto-sync: On' : 'Paused'}</span>
              </button>

              {activeTab !== 'CREATE' && (
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="h-9 px-3.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Export CSV</span>
                  <span className="sm:hidden">CSV</span>
                </button>
              )}

              {/* Mobile Sign Out / Reset quick actions */}
              <button
                type="button"
                onClick={handleAdminLogout}
                className="lg:hidden h-9 px-2.5 rounded-lg border border-slate-800 bg-[#0E1420] text-slate-300 hover:text-white inline-flex items-center cursor-pointer"
                aria-label="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </header>

          {/* Mobile Navigation Bar */}
          <div className="lg:hidden px-4 py-2.5 border-b border-slate-800/80 bg-[#0B101B] flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
            {liveNavTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  activeTab === tab
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200 bg-slate-900/60'
                }`}
              >
                {TAB_META[tab].shortLabel}
              </button>
            ))}
            {creatorNavTabs.map(({ mode, label }) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setCreatorMode(mode);
                  setActiveTab('CREATE');
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  activeTab === 'CREATE' && creatorMode === mode
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200 bg-slate-900/60'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Workspace Body */}
          <main className="flex-1 max-w-[1360px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
            {/* Section Context Header */}
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  {activeTab === 'CREATE'
                    ? creatorNavTabs.find((item) => item.mode === creatorMode)?.label
                    : TAB_META[activeTab].label}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {activeTab === 'CREATE'
                    ? 'Manage catalog entries, imports, QR codes, and exports.'
                    : TAB_META[activeTab].description}
                </p>
              </div>

              {/* Mobile-only Reset / Refresh Actions */}
              <div className="flex lg:hidden items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmMode('new_start')}
                  className="px-3 py-1.5 rounded-lg border border-slate-800 bg-[#0E1420] text-xs text-slate-300 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Refresh</span>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmMode('reset_1')}
                  className="px-3 py-1.5 rounded-lg border border-rose-500/30 bg-rose-950/20 text-xs text-rose-400 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Reset</span>
                </button>
              </div>
            </div>

            {activeTab === 'CREATE' ? (
              <AdminCreatorPanel
                adminKey={adminKey}
                teams={teams}
                memes={memes}
                puzzles={puzzles}
                mode={creatorMode}
                onCatalogUpdated={reloadCatalog}
              />
            ) : (
              <>
                {/* Unified Summary Strip (No stacked cards-within-cards or border-l-4 stripes) */}
                <section
                  aria-label="Event summary"
                  className="rounded-xl border border-slate-800/80 bg-[#0E1420] grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-800/80"
                >
                  <div className="p-4 sm:px-5">
                    <div className="text-xs text-slate-400">Registered Teams</div>
                    <div
                      id="teamCount"
                      className="mt-1.5 text-2xl font-semibold text-white font-mono tabular-nums"
                    >
                      {registeredCount}
                      <span className="text-sm font-normal text-slate-500">
                        {' '}
                        / {teams.length}
                      </span>
                    </div>
                  </div>

                  <div className="p-4 sm:px-5">
                    <div className="text-xs text-slate-400">Puzzles Solved</div>
                    <div
                      id="badgeCount"
                      className="mt-1.5 text-2xl font-semibold text-white font-mono tabular-nums"
                    >
                      {totalSolved}
                    </div>
                  </div>

                  <div className="p-4 sm:px-5">
                    <div className="text-xs text-slate-400">Teams With Tab Switches</div>
                    <div className="mt-1.5 text-2xl font-semibold text-white font-mono tabular-nums">
                      {flaggedTabCount}
                    </div>
                  </div>

                  <div className="p-4 sm:px-5">
                    <div className="text-xs text-slate-400">Backend Feed</div>
                    <div
                      id="systemStatus"
                      className={`mt-1.5 text-base font-semibold flex items-center gap-1.5 ${
                        systemStateKind === 'ok'
                          ? 'text-emerald-400'
                          : systemStateKind === 'paused'
                            ? 'text-amber-400'
                            : 'text-rose-400'
                      }`}
                    >
                      {systemStateKind === 'ok' ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                      ) : (
                        <Activity className="w-4 h-4 shrink-0" />
                      )}
                      <span>{systemStatusText}</span>
                    </div>
                  </div>
                </section>

                {/* Clean Horizontal Filter Bar */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative flex-1 min-w-[220px] max-w-sm">
                    <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      id="teamSearch"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Search team name, TID, or email..."
                      className="w-full h-10 bg-[#0E1420] border border-slate-800 text-slate-200 text-xs rounded-lg pl-9 pr-8 focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                    {searchTerm && (
                      <button
                        type="button"
                        onClick={() => setSearchTerm('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white cursor-pointer"
                        aria-label="Clear search"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="w-40">
                    <CustomSelect
                      id="typeFilter"
                      value={typeFilter}
                      onChange={setTypeFilter}
                      options={typeSelectOptions}
                      placeholder="All Types"
                      playClick={false}
                    />
                  </div>

                  <div className="w-36">
                    <CustomSelect
                      id="levelFilter"
                      value={levelFilter}
                      onChange={setLevelFilter}
                      options={levelSelectOptions}
                      placeholder="All Levels"
                      playClick={false}
                    />
                  </div>

                  {activeTab !== 'REG' && (
                    <div
                      className="inline-flex items-center p-1 rounded-lg bg-[#0E1420] border border-slate-800/80"
                      role="group"
                      aria-label="Activity flags"
                    >
                      <button
                        type="button"
                        id="filterAll"
                        aria-pressed={!securityFilter.hint && !securityFilter.malpractice}
                        onClick={() => setSecurityFilter({ hint: false, malpractice: false })}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                          !securityFilter.hint && !securityFilter.malpractice
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        id="filterHint"
                        aria-pressed={securityFilter.hint}
                        onClick={() => setSecurityFilter((current) => ({ ...current, hint: !current.hint }))}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                          securityFilter.hint
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Hint Used
                      </button>
                      <button
                        type="button"
                        id="filterMalpractice"
                        aria-pressed={securityFilter.malpractice}
                        onClick={() => setSecurityFilter((current) => ({ ...current, malpractice: !current.malpractice }))}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                          securityFilter.malpractice
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Tab Switches
                      </button>
                    </div>
                  )}

                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={clearAllFilters}
                      className="h-9 px-3 rounded-lg text-xs font-medium text-slate-400 hover:text-white inline-flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Clear filters</span>
                    </button>
                  )}
                </div>

                {/* High-Readability Semantic Data Table */}
                <div className="rounded-xl border border-slate-800/80 bg-[#0E1420] overflow-hidden">
                  <div className="overflow-x-auto" id="logsContainer">
                    {activeTab === 'LB' ? (
                      lbRows.length === 0 ? (
                        <EmptyTabNotice />
                      ) : (
                        <table className="w-full text-left border-collapse min-w-[720px]">
                          <thead>
                            <tr className="border-b border-slate-800/80 bg-slate-900/40 text-xs font-medium text-slate-400">
                              <th className="py-3 px-4 w-16">Rank</th>
                              <th className="py-3 px-4 w-24">TID</th>
                              <th className="py-3 px-4">Team Name</th>
                              <th className="py-3 px-4 w-28">Last Active</th>
                              <th className="py-3 px-4 text-right w-20">Solved</th>
                              <th className="py-3 px-4 text-right w-20">Hints</th>
                              <th className="py-3 px-4 text-right w-28">Tab Switches</th>
                              <th className="py-3 px-4 text-right w-28">Total Pts</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60 text-xs">
                            {pagedLbRows.map((r, i) => {
                              const rank = tableStartIdx + i + 1;
                              return (
                                <tr
                                  key={`${r.tid}-${r.name}`}
                                  className="hover:bg-slate-800/30 transition-colors"
                                >
                                  <td className="py-3 px-4 font-mono tabular-nums font-semibold">
                                    {rank <= 3 ? (
                                      <span className="inline-flex items-center gap-1 text-amber-300">
                                        <Award className="w-3.5 h-3.5" />
                                        {rank}
                                      </span>
                                    ) : (
                                      <span className="text-slate-500">{rank}</span>
                                    )}
                                  </td>
                                  <td className="py-3 px-4 font-mono tabular-nums text-slate-300">
                                    {r.tid}
                                  </td>
                                  <td className="py-3 px-4 font-medium text-white">
                                    {r.name}
                                  </td>
                                  <td className="py-3 px-4 font-mono tabular-nums text-slate-400">
                                    {formatTime(r.timestamp)}
                                  </td>
                                  <td className="py-3 px-4 font-mono tabular-nums text-right text-slate-200">
                                    {r.solved}
                                  </td>
                                  <td
                                    className={`py-3 px-4 font-mono tabular-nums text-right ${
                                      r.totalHints > 0 ? 'text-amber-300' : 'text-slate-600'
                                    }`}
                                  >
                                    {r.totalHints}
                                  </td>
                                  <td
                                    className={`py-3 px-4 font-mono tabular-nums text-right ${
                                      r.totalTabs > 0 ? 'text-rose-400 font-medium' : 'text-slate-600'
                                    }`}
                                  >
                                    {r.totalTabs}
                                  </td>
                                  <td
                                    className={`py-3 px-4 font-mono tabular-nums text-right font-semibold ${
                                      r.solved > 0 && r.pts > 0
                                        ? 'text-emerald-400'
                                        : 'text-slate-500'
                                    }`}
                                  >
                                    {r.solved > 0 ? r.pts : '-'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )
                    ) : activeTab === 'REG' ? (
                      filteredStandardTeams.length === 0 ? (
                        <EmptyTabNotice label="No registered teams yet." />
                      ) : (
                        <table className="w-full text-left border-collapse min-w-[720px]">
                          <thead>
                            <tr className="border-b border-slate-800/80 bg-slate-900/40 text-xs font-medium text-slate-400">
                              <th className="py-3 px-4 w-16">#</th>
                              <th className="py-3 px-4 w-28">Time</th>
                              <th className="py-3 px-4 w-24">TID</th>
                              <th className="py-3 px-4">Team Name</th>
                              <th className="py-3 px-4">Email ID</th>
                              <th className="py-3 px-4 w-28">Language</th>
                              <th className="py-3 px-4 w-36">Mission</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60 text-xs">
                            {pagedRegTeams.map((team, index) => (
                              <tr
                                key={`${team.tid}-${team.name}`}
                                className="hover:bg-slate-800/30 transition-colors"
                              >
                                <td className="py-3 px-4 font-mono tabular-nums text-slate-500">
                                  {tableStartIdx + index + 1}
                                </td>
                                <td className="py-3 px-4 font-mono tabular-nums text-slate-400">
                                  {formatTime(team.regTime)}
                                </td>
                                <td className="py-3 px-4 font-mono tabular-nums text-slate-300 font-medium">
                                  {team.tid || '-'}
                                </td>
                                <td className="py-3 px-4 font-medium text-white">{team.name}</td>
                                <td className="py-3 px-4 font-mono text-slate-300 max-w-[240px] truncate">
                                  {team.email || '-'}
                                </td>
                                <td className="py-3 px-4 font-mono text-slate-300">
                                  {team.language || 'PYTHON'}
                                </td>
                                <td className="py-3 px-4 font-mono text-indigo-300">
                                  {team.mission}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )
                    ) : levelAssertRows.length === 0 ? (
                      <EmptyTabNotice label={`No ${TAB_META[activeTab].label.toLowerCase()} logged yet.`} />
                    ) : (
                      <table className="w-full text-left border-collapse min-w-[960px]">
                        <thead>
                          <tr className="border-b border-slate-800/80 bg-slate-900/40 text-xs font-medium text-slate-400">
                            <th className="py-3 px-3 w-12">#</th>
                            <th className="py-3 px-3 w-20">TID</th>
                            <th className="py-3 px-3">Team</th>
                            <th className="py-3 px-3 w-28">Mission</th>
                            <th className="py-3 px-3 w-20">Puzzle</th>
                            <th className="py-3 px-3 w-24">Status</th>
                            <th className="py-3 px-3 text-right w-16">Wrong</th>
                            <th className="py-3 px-3 text-right w-16">Tabs</th>
                            <th className="py-3 px-3 text-right w-16">Hint</th>
                            <th className="py-3 px-3 text-right w-16">Pts</th>
                            <th className="py-3 px-3 text-right w-20">Score</th>
                            <th className="py-3 px-3 w-24">Unlocked</th>
                            <th className="py-3 px-3 text-right w-24">Time</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 text-xs">
                          {pagedLevelAssertRows.map(({ team, record }, index) => {
                            const globalIndex = tableStartIdx + index;
                            const lvlData: LevelRecord = record || {
                              lastActive: '',
                              tid: team.tid || '-',
                              teamName: team.name,
                              mission: team.mission,
                              puzzleId: 0,
                              status: 'IDLE',
                              wrongAttempts: 0,
                              tabSwitches: 0,
                              hintUsed: false,
                              timestamp: '',
                              pointsEarned: 0,
                              pointsLost: 0,
                              hasPointData: false,
                              totalScore: 0,
                              unlockedPuzzles: '',
                            };

                            const timestampStr = formatTime(lvlData.timestamp);
                            const recordStatus = String(lvlData.status || '').trim().toUpperCase();
                            const isRepeatSolve = recordStatus === 'REPEAT_SOLVE';
                            const isSolved = recordStatus === 'SOLVED' || isRepeatSolve;
                            const isActive = recordStatus === 'ACTIVE';
                            const isIdle = recordStatus === 'IDLE';
                            const netPts = isSolved ? Number(lvlData.points || 0) : null;
                            const lid = puzzleLinkById[lvlData.puzzleId];

                            return (
                              <tr
                                key={`${team.tid}-${team.name}-${lvlData.puzzleId}-${globalIndex}`}
                                className="hover:bg-slate-800/30 transition-colors"
                              >
                                <td className="py-2.5 px-3 font-mono tabular-nums text-slate-500">
                                  {globalIndex + 1}
                                </td>
                                <td className="py-2.5 px-3 font-mono tabular-nums text-slate-300">
                                  {lvlData.tid || '-'}
                                </td>
                                <td className="py-2.5 px-3 font-medium text-white max-w-[160px] truncate" title={team.name}>
                                  {team.name}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-slate-400 truncate max-w-[120px]">
                                  {lvlData.mission || team.mission}
                                </td>
                                <td className="py-2.5 px-3 font-mono tabular-nums">
                                  {lvlData.puzzleId && lid ? (
                                    <a
                                      href={`/?linkid=${encodeURIComponent(lid)}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200 hover:underline underline-offset-2"
                                      title={`Open Puzzle ${lvlData.puzzleId} (${lid})`}
                                    >
                                      <span>P{lvlData.puzzleId}</span>
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                  ) : lvlData.puzzleId ? (
                                    <span className="text-slate-300">P{lvlData.puzzleId}</span>
                                  ) : (
                                    <span className="text-slate-600">-</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 font-medium">
                                  {isRepeatSolve ? (
                                    <span className="text-amber-300">Repeat</span>
                                  ) : isSolved ? (
                                    <span className="text-emerald-400">Solved</span>
                                  ) : isActive ? (
                                    <span className="text-cyan-400">Active</span>
                                  ) : isIdle ? (
                                    <span className="text-slate-500">Idle</span>
                                  ) : (
                                    <span className="text-rose-400">Unsolved</span>
                                  )}
                                </td>
                                <td
                                  className={`py-2.5 px-3 font-mono tabular-nums text-right ${
                                    lvlData.wrongAttempts > 0 ? 'text-rose-400 font-medium' : 'text-slate-600'
                                  }`}
                                >
                                  {lvlData.wrongAttempts}
                                </td>
                                <td
                                  className={`py-2.5 px-3 font-mono tabular-nums text-right ${
                                    lvlData.tabSwitches > 0 ? 'text-rose-400 font-medium' : 'text-slate-600'
                                  }`}
                                >
                                  {lvlData.tabSwitches}
                                </td>
                                <td
                                  className={`py-2.5 px-3 font-mono tabular-nums text-right ${
                                    lvlData.hintUsed ? 'text-amber-300 font-medium' : 'text-slate-600'
                                  }`}
                                >
                                  {lvlData.hintUsed ? 'Yes' : 'No'}
                                </td>
                                <td
                                  className={`py-2.5 px-3 font-mono tabular-nums text-right font-medium ${
                                    isSolved && netPts !== null
                                      ? netPts > 0
                                        ? 'text-emerald-400'
                                        : netPts < 0
                                          ? 'text-rose-400'
                                          : 'text-slate-500'
                                      : 'text-slate-600'
                                  }`}
                                >
                                  {isSolved && netPts !== null ? netPts : '-'}
                                </td>
                                <td className="py-2.5 px-3 font-mono tabular-nums text-right text-slate-200 font-medium">
                                  {lvlData.totalScore || 0}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-slate-400 truncate max-w-[100px]">
                                  {lvlData.unlockedPuzzles || '-'}
                                </td>
                                <td className="py-2.5 px-3 font-mono tabular-nums text-right text-slate-400">
                                  {timestampStr}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Clean Pagination Footer */}
                  {totalTablePages > 1 && (
                    <div className="px-4 py-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                      <span className="font-mono tabular-nums">
                        Showing {tableStartIdx + 1}–
                        {Math.min(tableStartIdx + ROWS_PER_PAGE, activeTableTotalRows)} of{' '}
                        {activeTableTotalRows}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={safeTablePage <= 1}
                          onClick={() => setTablePage((p) => Math.max(1, p - 1))}
                          className="px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                          <span>Previous</span>
                        </button>
                        <span className="font-mono tabular-nums text-slate-300 px-1">
                          {safeTablePage} / {totalTablePages}
                        </span>
                        <button
                          type="button"
                          disabled={safeTablePage >= totalTablePages}
                          onClick={() => setTablePage((p) => Math.min(totalTablePages, p + 1))}
                          className="px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <span>Next</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};

const EmptyTabNotice: React.FC<{ label?: string }> = ({
  label = 'No records available for this view yet.',
}) => (
  <div className="flex flex-col items-center justify-center text-slate-500 py-14 px-4 fade-in">
    <ClipboardList className="w-8 h-8 mb-2.5 text-slate-600" />
    <p className="text-sm text-slate-400">{label}</p>
  </div>
);
