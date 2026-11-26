import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  GitBranch,
  Pencil,
  Plus,
  QrCode,
  RotateCcw,
  Search,
  Table2,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { PuzzleConnectionMap } from './PuzzleConnectionMap';
import { useDialogFocus } from '../hooks/useDialogFocus';
import {
  QR_BASE_URL,
  QrBatchSheetModal,
  QrCodeModal,
  renderBrandedQrStickerDataUrl,
  type QrTargetItem,
} from './QrCodeModal';
import {
  adminDeleteMemeCatalog,
  adminDeletePuzzleCatalog,
  adminDeleteTeamCatalog,
  adminSyncAllCatalogToSupabase,
  adminUpsertMemes,
  adminUpsertPuzzles,
  adminUpsertTeams,
  extractTeamEmails,
  getPokemonArtworkUrl,
  hasSupabaseBackend,
  sanitizeCatalogId,
} from '../services/gameBackend';
import {
  downloadMemesTemplateXlsx,
  downloadPuzzlesTemplateXlsx,
  downloadTeamsTemplateXlsx,
  exportMemesToXlsx,
  exportPuzzlesToXlsx,
  exportTeamsToXlsx,
  parseMemesSpreadsheet,
  parsePuzzlesSpreadsheet,
  parseTeamsSpreadsheet,
  type ParsedSpreadsheetResult,
} from '../utils/excelCatalog';
import type { MemeEntry, Puzzle, TeamEntry } from '../types/game';

export type CreatorMode = 'TEAM' | 'PUZZLE' | 'MEME' | 'QR';

interface AdminCreatorPanelProps {
  adminKey: string;
  teams: TeamEntry[];
  memes: MemeEntry[];
  puzzles: Puzzle[];
  mode: CreatorMode;
  onCatalogUpdated: () => Promise<void>;
}

function suggestNextTid(teams: TeamEntry[]): string {
  let maxNum = 0;
  teams.forEach((t) => {
    const m = String(t.tid || '').match(/\d+/);
    if (m) {
      const n = Number(m[0]);
      if (!Number.isNaN(n) && n > maxNum) maxNum = n;
    }
  });
  return `T${String(maxNum + 1).padStart(3, '0')}`;
}

function suggestNextMemeId(memes: MemeEntry[]): string {
  let maxNum = 0;
  memes.forEach((m) => {
    const match = String(m.memeid || '').match(/\d+/);
    if (match) {
      const n = Number(match[0]);
      if (!Number.isNaN(n) && n > maxNum) maxNum = n;
    }
  });
  return `M${String(maxNum + 1).padStart(2, '0')}`;
}

function suggestNextPuzzleId(puzzles: Puzzle[]): number {
  let maxId = 0;
  puzzles.forEach((p) => {
    if (Number(p.id) > maxId) maxId = Number(p.id);
  });
  return maxId + 1;
}

function downloadCustomQrTemplate(): void {
  const rows = [
    {
      payload: `${QR_BASE_URL}/?linkid=XG01`,
      pokemonId: 25,
      idLabel: 'P1',
      location: 'CSE entrance',
      colorHex: '#090D16',
      bgColorHex: '#FFFFFF',
      pokemonSizePercent: 44,
    },
  ];
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet['!cols'] = [
    { wch: 42 }, { wch: 12 }, { wch: 16 }, { wch: 24 },
    { wch: 14 }, { wch: 14 }, { wch: 22 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'QR Codes');
  XLSX.writeFile(workbook, 'pykachu_qr_bulk_template.xlsx');
}

function getQrSheetCell(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

export const AdminCreatorPanel: React.FC<AdminCreatorPanelProps> = ({
  adminKey,
  teams,
  memes,
  puzzles,
  mode,
  onCatalogUpdated,
}) => {
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogPage, setCatalogPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const customQrCopyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!confirmDeleteKey) return;
    const timer = window.setTimeout(() => setConfirmDeleteKey(null), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmDeleteKey]);

  useEffect(() => {
    return () => {
      if (customQrCopyTimerRef.current !== null) {
        window.clearTimeout(customQrCopyTimerRef.current);
      }
    };
  }, []);

  // Focused Drawers (reduces visual clutter)
  const [showEditor, setShowEditor] = useState(false);
  const [isEditingExisting, setIsEditingExisting] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [puzzleView, setPuzzleView] = useState<'TABLE' | 'MAP'>('TABLE');
  const [qrModalItem, setQrModalItem] = useState<QrTargetItem | null>(null);
  const [showQrSheet, setShowQrSheet] = useState(false);

  // Team Form State
  const [teamTid, setTeamTid] = useState(() => suggestNextTid(teams));
  const [teamName, setTeamName] = useState('');
  const [teamEmailsText, setTeamEmailsText] = useState('');
  const [teamKey, setTeamKey] = useState('123');
  const [teamMembersText, setTeamMembersText] = useState('');

  // Meme Form State
  const [memeId, setMemeId] = useState(() => suggestNextMemeId(memes));
  const [memeYtLink, setMemeYtLink] = useState('');
  const [memeStart, setMemeStart] = useState('0');
  const [memeEnd, setMemeEnd] = useState('0');

  // Puzzle Form State
  const nextPid = useMemo(() => suggestNextPuzzleId(puzzles), [puzzles]);
  const [puzzleId, setPuzzleId] = useState(() => String(nextPid));
  const [puzzleLinkId, setPuzzleLinkId] = useState(() => `XG${String(nextPid).padStart(2, '0')}`);
  const [puzzleLevel, setPuzzleLevel] = useState('1');
  const [puzzlePoints, setPuzzlePoints] = useState('10');
  const [puzzleStartCode, setPuzzleStartCode] = useState('');
  const [puzzleBadgeId, setPuzzleBadgeId] = useState('0');
  const [puzzleLocation, setPuzzleLocation] = useState('');
  const [puzzlePokemonId, setPuzzlePokemonId] = useState('25');
  const [puzzlePokemonName, setPuzzlePokemonName] = useState('Pikachu');
  const [puzzleAnswer, setPuzzleAnswer] = useState('');
  const [puzzleHint, setPuzzleHint] = useState('');
  const [puzzleHintPenalty, setPuzzleHintPenalty] = useState('60');
  const [puzzleTabSwitchPenalty, setPuzzleTabSwitchPenalty] = useState('15');
  const [puzzleNextIds, setPuzzleNextIds] = useState('');
  const [puzzlePython, setPuzzlePython] = useState('');
  const [puzzleCpp, setPuzzleCpp] = useState('');

  // Excel Bulk Upload State
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bulkDialogRef = useRef<HTMLDivElement | null>(null);
  const bulkCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const [bulkFilename, setBulkFilename] = useState('');
  const [bulkTeams, setBulkTeams] = useState<ParsedSpreadsheetResult<TeamEntry> | null>(null);
  const [bulkMemes, setBulkMemes] = useState<ParsedSpreadsheetResult<MemeEntry> | null>(null);
  const [bulkPuzzles, setBulkPuzzles] = useState<ParsedSpreadsheetResult<Puzzle> | null>(null);

  // Manual Custom QR Studio State
  const [customQrLink, setCustomQrLink] = useState(`${QR_BASE_URL}/?linkid=XG01`);
  const [customQrPokemonId, setCustomQrPokemonId] = useState('25');
  const [customQrColor, setCustomQrColor] = useState({ r: 9, g: 13, b: 22 });
  const [customQrHex, setCustomQrHex] = useState('#090d16');
  const [customQrBgColor, setCustomQrBgColor] = useState({ r: 255, g: 255, b: 255 });
  const [customQrBgHex, setCustomQrBgHex] = useState('#ffffff');
  const [customQrPokemonSize, setCustomQrPokemonSize] = useState('44');
  const [customQrIdLabel, setCustomQrIdLabel] = useState('P1');
  const [customQrLocation, setCustomQrLocation] = useState('CSE entrance - openspace');
  const [customQrStickerUrl, setCustomQrStickerUrl] = useState('');
  const [customQrError, setCustomQrError] = useState<string | null>(null);
  const [customQrCopied, setCustomQrCopied] = useState(false);
  const customQrBulkInputRef = useRef<HTMLInputElement | null>(null);
  const [customQrBulkRows, setCustomQrBulkRows] = useState<{ label: string; url: string }[]>([]);
  const [customQrGridColumns, setCustomQrGridColumns] = useState(3);
  const [customQrGridRows, setCustomQrGridRows] = useState(8);
  const [customQrBulkError, setCustomQrBulkError] = useState<string | null>(null);
  const [customQrBulkLoading, setCustomQrBulkLoading] = useState(false);
  const [customQrBulkFilename, setCustomQrBulkFilename] = useState('');

  useEffect(() => {
    setCustomQrHex(`#${[customQrColor.r, customQrColor.g, customQrColor.b].map((value) => value.toString(16).padStart(2, '0')).join('')}`);
  }, [customQrColor]);

  useEffect(() => {
    setCustomQrBgHex(`#${[customQrBgColor.r, customQrBgColor.g, customQrBgColor.b].map((value) => value.toString(16).padStart(2, '0')).join('')}`);
  }, [customQrBgColor]);

  useEffect(() => {
    if (!showEditor && !teamName) setTeamTid(suggestNextTid(teams));
  }, [teams, teamName, showEditor]);

  useEffect(() => {
    if (!showEditor && !memeYtLink) setMemeId(suggestNextMemeId(memes));
  }, [memes, memeYtLink, showEditor]);

  useEffect(() => {
    if (!showEditor && !puzzleAnswer && !puzzlePython && !puzzleCpp) {
      const n = suggestNextPuzzleId(puzzles);
      setPuzzleId(String(n));
      setPuzzleLinkId(`XG${String(n).padStart(2, '0')}`);
    }
  }, [puzzles, puzzleAnswer, puzzlePython, puzzleCpp, showEditor]);

  useEffect(() => {
    if (mode !== 'QR') return;
    const payload = customQrLink.trim();
    if (!payload) {
      setCustomQrStickerUrl('');
      setCustomQrError('Enter a QR link or text payload to generate the sticker.');
      return;
    }
    let cancelled = false;
    setCustomQrError(null);
    const timer = window.setTimeout(() => {
      const parsedPokeId = Math.max(0, Math.floor(Number(customQrPokemonId || 0)));
      renderBrandedQrStickerDataUrl({
        payload,
        idLabel: customQrIdLabel,
        locationLabel: customQrLocation,
        pokemonId: parsedPokeId > 0 ? parsedPokeId : undefined,
        qrColor: customQrColor,
        qrBgColor: customQrBgColor,
        pokemonSizePercent: Number(customQrPokemonSize) || 44,
        size: 680,
      })
        .then((url) => {
          if (!cancelled) setCustomQrStickerUrl(url);
        })
        .catch((err) => {
          if (!cancelled) {
            setCustomQrError(err instanceof Error ? err.message : 'Failed to generate QR sticker.');
          }
        });
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mode, customQrLink, customQrPokemonId, customQrIdLabel, customQrLocation, customQrColor, customQrBgColor, customQrPokemonSize]);

  const clearBulkPreview = () => {
    setBulkFilename('');
    setBulkTeams(null);
    setBulkMemes(null);
    setBulkPuzzles(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  useDialogFocus(
    showBulkModal,
    bulkDialogRef,
    () => {
      setShowBulkModal(false);
      clearBulkPreview();
    },
    bulkCloseButtonRef
  );

  useEffect(() => {
    setCatalogSearch('');
    setCatalogPage(1);
    setConfirmDeleteKey(null);
    setStatusBanner(null);
    setShowEditor(false);
    setIsEditingExisting(false);
    setShowBulkModal(false);
    setBulkFilename('');
    setBulkTeams(null);
    setBulkMemes(null);
    setBulkPuzzles(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [mode]);

  const resetFormsToDefaults = (targetMode: CreatorMode) => {
    setIsEditingExisting(false);
    if (targetMode === 'TEAM') {
      setTeamTid(suggestNextTid(teams));
      setTeamName('');
      setTeamEmailsText('');
      setTeamKey('123');
      setTeamMembersText('');
    } else if (targetMode === 'MEME') {
      setMemeId(suggestNextMemeId(memes));
      setMemeYtLink('');
      setMemeStart('0');
      setMemeEnd('0');
    } else if (targetMode === 'PUZZLE') {
      const n = suggestNextPuzzleId(puzzles);
      setPuzzleId(String(n));
      setPuzzleLinkId(`XG${String(n).padStart(2, '0')}`);
      setPuzzleLevel('1');
      setPuzzlePoints('10');
      setPuzzleStartCode('');
      setPuzzleBadgeId('0');
      setPuzzleLocation('');
      setPuzzlePokemonId('25');
      setPuzzlePokemonName('Pikachu');
      setPuzzleAnswer('');
      setPuzzleHint('');
      setPuzzleHintPenalty('60');
      setPuzzleTabSwitchPenalty('15');
      setPuzzleNextIds('');
      setPuzzlePython('');
      setPuzzleCpp('');
    }
  };

  const openPuzzleEditor = (p: Puzzle) => {
    setPuzzleId(String(p.id));
    setPuzzleLinkId(p.linkid);
    setPuzzleLevel(String(p.level));
    setPuzzlePoints(String(p.points));
    setPuzzleStartCode(p.startCode || '');
    setPuzzleBadgeId(String(p.badgeId || 0));
    setPuzzleLocation(p.locationClue || '');
    setPuzzlePokemonId(String(p.pokemonId ?? 25));
    setPuzzlePokemonName(p.pokemonName || 'Pikachu');
    setPuzzleAnswer(p.answer);
    setPuzzleHint(typeof p.hint === 'string' ? p.hint : '');
    setPuzzleHintPenalty(String(p.hintPenalty ?? 60));
    setPuzzleTabSwitchPenalty(String(p.tabSwitchPenaltySeconds ?? 15));
    setPuzzleNextIds((p.nextPuzzleId || []).join(', '));
    setPuzzlePython(p.questionPython || '');
    setPuzzleCpp(p.questionCpp || '');
    setIsEditingExisting(true);
    setShowEditor(true);
  };

  const supabaseReady = hasSupabaseBackend();
  const storageLabel = supabaseReady ? 'Supabase' : 'Local Catalog';

  const handlePushAllToSupabase = async () => {
    setBusy(true);
    setStatusBanner(null);
    try {
      const counts = await adminSyncAllCatalogToSupabase(teams, memes, puzzles);
      await onCatalogUpdated();
      setStatusBanner({
        type: 'success',
        message: `Synced ${counts.teams} teams, ${counts.memes} memes, ${counts.puzzles} puzzles, plus admins & config to Supabase.`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Supabase sync failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleExportJson = () => {
    let payload: unknown = [];
    let filename = 'data.json';
    if (mode === 'TEAM') {
      payload = teams.map(({ isCustom: _c, ...rest }) => rest);
      filename = 'teams.json';
    } else if (mode === 'MEME') {
      payload = memes.map(({ isCustom: _c, ...rest }) => rest);
      filename = 'meme.json';
    } else {
      payload = puzzles.map(({ isCustom: _c, ...rest }) => rest);
      filename = 'puzzle.json';
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusBanner(null);
    const cleanTid = sanitizeCatalogId(teamTid.toUpperCase(), 32);
    const cleanName = teamName.trim();
    const cleanKey = teamKey.trim();
    const emails = extractTeamEmails({ email: teamEmailsText }).slice(0, 12);

    if (!cleanTid || !cleanName || !cleanKey || emails.length === 0) {
      setStatusBanner({
        type: 'error',
        message: 'Team ID, team name, valid email address, and security key are required.',
      });
      return;
    }
    const members = teamMembersText
      .split(/[,|\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 12);

    setBusy(true);
    try {
      await adminUpsertTeams(
        [
          {
            tid: cleanTid,
            team: cleanName,
            email: emails[0],
            emails,
            securityKey: cleanKey,
            team_members: members,
          },
        ],
        adminKey
      );
      await onCatalogUpdated();
      setShowEditor(false);
      resetFormsToDefaults('TEAM');
      setStatusBanner({
        type: 'success',
        message: `Saved team "${cleanName}" (${cleanTid}).`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to save team.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCreateMeme = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusBanner(null);
    const cleanId = sanitizeCatalogId(memeId.toUpperCase(), 32);
    const cleanLink = memeYtLink.trim();
    const start = Math.max(0, Number(memeStart || 0));
    const end = Math.max(0, Number(memeEnd || 0));

    if (!cleanId || cleanLink.length < 5) {
      setStatusBanner({
        type: 'error',
        message: 'Meme ID and a valid YouTube URL are required.',
      });
      return;
    }

    setBusy(true);
    try {
      await adminUpsertMemes(
        [{ memeid: cleanId, ytlink: cleanLink, starttime: start, endtime: end }],
        adminKey
      );
      await onCatalogUpdated();
      setShowEditor(false);
      resetFormsToDefaults('MEME');
      setStatusBanner({
        type: 'success',
        message: `Saved meme "${cleanId}" to ${storageLabel}.`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to save meme.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCreatePuzzle = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusBanner(null);
    const id = Math.floor(Number(puzzleId));
    const linkid = puzzleLinkId.trim().toUpperCase();
    const answer = puzzleAnswer.trim();

    if (!id || id < 1 || id > 10000) {
      setStatusBanner({ type: 'error', message: 'Puzzle ID must be between 1 and 10000.' });
      return;
    }
    if (!linkid || !answer) {
      setStatusBanner({ type: 'error', message: 'QR Link ID and Expected Answer are required.' });
      return;
    }
    if (!puzzlePython.trim() && !puzzleCpp.trim()) {
      setStatusBanner({
        type: 'error',
        message: 'Provide at least one code snippet (Python or C++).',
      });
      return;
    }

    const nextIds = puzzleNextIds
      .split(/[,|\s]+/)
      .map((s) => Math.floor(Number(s)))
      .filter((n) => !Number.isNaN(n) && n > 0);

    const hintTrim = puzzleHint.trim();
    const puzzle: Puzzle = {
      id,
      linkid,
      badgeId: Number(puzzleBadgeId) > 0 ? Math.floor(Number(puzzleBadgeId)) : undefined,
      questionPython: puzzlePython,
      questionCpp: puzzleCpp,
      answer,
      nextPuzzleId: nextIds,
      startCode: puzzleStartCode.trim() ? puzzleStartCode.trim().toUpperCase() : undefined,
      requiresStartCode: Boolean(puzzleStartCode.trim()),
      locationClue: puzzleLocation.trim() || 'Campus Signal Node',
      level: Math.max(1, Math.min(10, Math.floor(Number(puzzleLevel || 1)))),
      points: Math.max(0, Number(puzzlePoints || 10)),
      hint: hintTrim || undefined,
      hasHint: Boolean(hintTrim),
      hintPenalty: Math.max(0, Math.floor(Number(puzzleHintPenalty || 60))),
      tabSwitchPenaltySeconds: Math.max(0, Math.floor(Number(puzzleTabSwitchPenalty || 0))),
      pokemonId: Math.max(0, Math.floor(Number(puzzlePokemonId || 25))),
      pokemonName: puzzlePokemonName.trim() || 'Pikachu',
    };

    setBusy(true);
    try {
      await adminUpsertPuzzles([puzzle], adminKey);
      await onCatalogUpdated();
      setShowEditor(false);
      resetFormsToDefaults('PUZZLE');
      setStatusBanner({
        type: 'success',
        message: `Saved puzzle #${id} (${linkid}) to ${storageLabel}.`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to save puzzle.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatusBanner(null);
    setBulkFilename(file.name);

    try {
      if (mode === 'TEAM') {
        const res = await parseTeamsSpreadsheet(file);
        setBulkTeams(res);
      } else if (mode === 'MEME') {
        const res = await parseMemesSpreadsheet(file);
        setBulkMemes(res);
      } else {
        const res = await parsePuzzlesSpreadsheet(file);
        setBulkPuzzles(res);
      }
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to parse spreadsheet.',
      });
      clearBulkPreview();
    }
  };

  const handleBulkImport = async () => {
    setBusy(true);
    setStatusBanner(null);
    try {
      let imported = 0;
      if (mode === 'TEAM' && bulkTeams?.valid.length) {
        imported = await adminUpsertTeams(bulkTeams.valid, adminKey);
      } else if (mode === 'MEME' && bulkMemes?.valid.length) {
        imported = await adminUpsertMemes(bulkMemes.valid, adminKey);
      } else if (mode === 'PUZZLE' && bulkPuzzles?.valid.length) {
        imported = await adminUpsertPuzzles(bulkPuzzles.valid, adminKey);
      }
      await onCatalogUpdated();
      clearBulkPreview();
      setShowBulkModal(false);
      setStatusBanner({
        type: 'success',
        message: `Imported ${imported} ${mode.toLowerCase()}(s) into ${storageLabel}.`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Bulk import failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteCloudItem = async (key: string, action: () => Promise<void>) => {
    if (confirmDeleteKey !== key) {
      setConfirmDeleteKey(key);
      return;
    }
    setConfirmDeleteKey(null);
    setBusy(true);
    setStatusBanner(null);
    try {
      await action();
      await onCatalogUpdated();
      setStatusBanner({
        type: 'success',
        message: `Deleted "${key}" from ${storageLabel}.`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Delete failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const activeBulk = mode === 'TEAM' ? bulkTeams : mode === 'MEME' ? bulkMemes : bulkPuzzles;
  const searchLower = catalogSearch.trim().toLowerCase();

  const filteredTeams = useMemo(() => {
    if (!searchLower) return teams;
    return teams.filter(
      (t) =>
        t.team.toLowerCase().includes(searchLower) ||
        t.tid.toLowerCase().includes(searchLower) ||
        (t.email || '').toLowerCase().includes(searchLower) ||
        (t.emails || []).some((em) => em.toLowerCase().includes(searchLower)) ||
        (t.team_members || []).some((m) => m.toLowerCase().includes(searchLower))
    );
  }, [teams, searchLower]);

  const filteredMemes = useMemo(() => {
    if (!searchLower) return memes;
    return memes.filter(
      (m) =>
        m.memeid.toLowerCase().includes(searchLower) ||
        m.ytlink.toLowerCase().includes(searchLower)
    );
  }, [memes, searchLower]);

  const filteredPuzzles = useMemo(() => {
    if (!searchLower) return puzzles;
    return puzzles.filter(
      (p) =>
        String(p.id).includes(searchLower) ||
        p.linkid.toLowerCase().includes(searchLower) ||
        p.locationClue.toLowerCase().includes(searchLower) ||
        p.pokemonName.toLowerCase().includes(searchLower)
    );
  }, [puzzles, searchLower]);

  const CATALOG_PAGE_SIZE = 50;
  const activeFilteredCount =
    mode === 'TEAM'
      ? filteredTeams.length
      : mode === 'MEME'
        ? filteredMemes.length
        : filteredPuzzles.length;
  const totalCatalogPages = Math.max(1, Math.ceil(activeFilteredCount / CATALOG_PAGE_SIZE));
  const safeCatalogPage = Math.min(Math.max(1, catalogPage), totalCatalogPages);
  const catalogStartIdx = (safeCatalogPage - 1) * CATALOG_PAGE_SIZE;

  const pagedTeams = useMemo(
    () => filteredTeams.slice(catalogStartIdx, catalogStartIdx + CATALOG_PAGE_SIZE),
    [filteredTeams, catalogStartIdx]
  );
  const pagedMemes = useMemo(
    () => filteredMemes.slice(catalogStartIdx, catalogStartIdx + CATALOG_PAGE_SIZE),
    [filteredMemes, catalogStartIdx]
  );
  const pagedPuzzles = useMemo(
    () => filteredPuzzles.slice(catalogStartIdx, catalogStartIdx + CATALOG_PAGE_SIZE),
    [filteredPuzzles, catalogStartIdx]
  );

  const entityLabel =
    mode === 'TEAM' ? 'Team' : mode === 'PUZZLE' ? 'Puzzle' : mode === 'MEME' ? 'Meme' : 'QR';

  const handleDownloadCustomQrPng = async () => {
    const payload = customQrLink.trim();
    if (!payload) return;
    setCustomQrError(null);
    try {
      const parsedPokeId = Math.max(0, Math.floor(Number(customQrPokemonId || 0)));
      const pngUrl = await renderBrandedQrStickerDataUrl({
        payload,
        idLabel: customQrIdLabel,
        locationLabel: customQrLocation,
        pokemonId: parsedPokeId > 0 ? parsedPokeId : undefined,
        qrColor: customQrColor,
        qrBgColor: customQrBgColor,
        pokemonSizePercent: Number(customQrPokemonSize) || 44,
        size: 800,
      });
      const slug = sanitizeCatalogId(customQrIdLabel || 'custom', 32).toLowerCase() || 'custom';
      const a = document.createElement('a');
      a.href = pngUrl;
      a.download = `pykachu_qr_${slug}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      setCustomQrError(err instanceof Error ? err.message : 'Could not download QR PNG.');
    }
  };

  const handleCopyCustomQrLink = async () => {
    const payload = customQrLink.trim();
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload);
      setCustomQrCopied(true);
      if (customQrCopyTimerRef.current !== null) {
        window.clearTimeout(customQrCopyTimerRef.current);
      }
      customQrCopyTimerRef.current = window.setTimeout(() => {
        customQrCopyTimerRef.current = null;
        setCustomQrCopied(false);
      }, 1800);
    } catch {
      setCustomQrError('Clipboard access denied by browser.');
    }
  };

  const handleCustomQrBulkFile = async (file?: File) => {
    if (!file) return;
    setCustomQrBulkLoading(true);
    setCustomQrBulkError(null);
    setCustomQrBulkRows([]);
    setCustomQrBulkFilename(file.name);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!firstSheet) throw new Error('The spreadsheet has no worksheet.');
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' });
      const nonEmptyRows = rows.filter((row) => Object.values(row).some((value) => String(value).trim()));
      if (nonEmptyRows.length === 0) throw new Error('No data rows found. Download the template to see the required columns.');
      const gridCapacity = customQrGridColumns * customQrGridRows;
      if (nonEmptyRows.length > gridCapacity) throw new Error(`This ${customQrGridColumns} × ${customQrGridRows} layout fits ${gridCapacity} QR codes. Increase the layout size or reduce the rows in your file.`);

      const parsed = nonEmptyRows.map((row, index) => {
        const values: Record<string, unknown> = {};
        Object.entries(row).forEach(([key, value]) => {
          values[key.toLowerCase().replace(/[^a-z0-9]/g, '')] = value;
        });
        const payload = getQrSheetCell(values, 'payload', 'url', 'qrlink', 'link', 'text');
        if (!payload) throw new Error(`Row ${index + 2}: payload / URL is required.`);
        const readNumber = (keys: string[], fallback: number, min: number, max: number) => {
          const raw = getQrSheetCell(values, ...keys);
          if (!raw) return fallback;
          const value = Number(raw);
          if (!Number.isFinite(value)) throw new Error(`Row ${index + 2}: ${keys[0]} must be a number.`);
          return Math.max(min, Math.min(max, Math.round(value)));
        };
        const trimmedDefaultPokeId = customQrPokemonId.trim();
        const defaultBulkPokeId =
          trimmedDefaultPokeId !== '' && Number.isFinite(Number(trimmedDefaultPokeId))
            ? Math.max(0, Math.min(10000, Math.round(Number(trimmedDefaultPokeId))))
            : 25;
        const pokemonId = readNumber(['pokemonid', 'pokeid'], defaultBulkPokeId, 0, 10000);
        const idLabel = getQrSheetCell(values, 'idlabel', 'id') || `QR${String(index + 1).padStart(2, '0')}`;
        const location = getQrSheetCell(values, 'location', 'locationlabel', 'caption');
        const colorHex = getQrSheetCell(values, 'colorhex', 'hexcolor', 'hex');
        let qrColor = {
          r: readNumber(['red', 'r'], customQrColor.r, 0, 255),
          g: readNumber(['green', 'g'], customQrColor.g, 0, 255),
          b: readNumber(['blue', 'b'], customQrColor.b, 0, 255),
        };
        if (colorHex) {
          const match = colorHex.match(/^#?([\da-fA-F]{6})$/);
          if (!match) throw new Error(`Row ${index + 2}: colorHex must be a 6-digit hex color, like #090D16.`);
          qrColor = {
            r: parseInt(match[1].slice(0, 2), 16),
            g: parseInt(match[1].slice(2, 4), 16),
            b: parseInt(match[1].slice(4, 6), 16),
          };
        }
        const bgColorHex = getQrSheetCell(values, 'bgcolorhex', 'bghex', 'backgroundhex', 'backgroundcolor', 'bgcolor', 'qrbgcolor');
        let qrBgColor = {
          r: readNumber(['bgred', 'bgr'], customQrBgColor.r, 0, 255),
          g: readNumber(['bggreen', 'bgg'], customQrBgColor.g, 0, 255),
          b: readNumber(['bgblue', 'bgb'], customQrBgColor.b, 0, 255),
        };
        if (bgColorHex) {
          const bgMatch = bgColorHex.match(/^#?([\da-fA-F]{6})$/);
          if (!bgMatch) throw new Error(`Row ${index + 2}: bgColorHex must be a 6-digit hex color, like #FFFFFF.`);
          qrBgColor = {
            r: parseInt(bgMatch[1].slice(0, 2), 16),
            g: parseInt(bgMatch[1].slice(2, 4), 16),
            b: parseInt(bgMatch[1].slice(4, 6), 16),
          };
        }
        const pokemonSizePercent = readNumber(['pokemonsizepercent', 'pokemonsize', 'sizepercent'], Number(customQrPokemonSize) || 44, 5, 80);
        return { payload, idLabel, location, pokemonId, qrColor, qrBgColor, pokemonSizePercent };
      });

      const rendered = await Promise.all(parsed.map(async (item) => ({
        label: item.idLabel,
        url: await renderBrandedQrStickerDataUrl({
          payload: item.payload,
          idLabel: item.idLabel,
          locationLabel: item.location,
          pokemonId: item.pokemonId > 0 ? item.pokemonId : undefined,
          qrColor: item.qrColor,
          qrBgColor: item.qrBgColor,
          pokemonSizePercent: item.pokemonSizePercent,
          size: 460,
        }),
      })));
      setCustomQrBulkRows(rendered);
    } catch (err) {
      setCustomQrBulkError(err instanceof Error ? err.message : 'Could not read this spreadsheet.');
    } finally {
      setCustomQrBulkLoading(false);
    }
  };

  const handleDownloadCustomQrBulkSheet = async () => {
    if (!customQrBulkRows.length) return;
    setCustomQrBulkError(null);
    try {
      const columns = Math.max(1, customQrGridColumns);
      const cellWidth = 420;
      const cellHeight = 510;
      const padding = 28;
      const rows = Math.max(1, Math.ceil(customQrBulkRows.length / columns));
      const canvas = document.createElement('canvas');
      canvas.width = columns * cellWidth + padding * 2;
      canvas.height = rows * cellHeight + padding * 2 + 52;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setCustomQrBulkError('Canvas context unavailable for QR sheet export.');
        return;
      }
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 26px system-ui, sans-serif';
      ctx.fillText('Custom QR Stickers', padding, padding + 24);
      await Promise.all(customQrBulkRows.map(({ url }, index) => new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const x = padding + (index % columns) * cellWidth + 10;
          const y = padding + 52 + Math.floor(index / columns) * cellHeight + 10;
          ctx.drawImage(img, x, y, cellWidth - 20, cellHeight - 20);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = url;
      })));
      const anchor = document.createElement('a');
      anchor.href = canvas.toDataURL('image/png');
      anchor.download = 'pykachu_custom_qr_bulk.png';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } catch (err) {
      setCustomQrBulkError(err instanceof Error ? err.message : 'Could not export QR sticker sheet.');
    }
  };

  return (
    <div className="space-y-5">
      {/* Studio Header Controls */}
      <div className="flex flex-wrap items-center justify-end gap-3">

        {/* Clean Action Group */}
        {mode !== 'QR' && (
          <div className="flex flex-wrap items-center gap-2">
            {supabaseReady && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handlePushAllToSupabase()}
                className="px-3.5 py-2 rounded-lg bg-[#0E1420] hover:bg-slate-800 disabled:opacity-50 border border-slate-800 text-slate-200 text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <CloudUpload className="w-3.5 h-3.5 text-cyan-400" />
                <span>{busy ? 'Syncing...' : 'Sync to Supabase'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setShowBulkModal(true);
                setStatusBanner(null);
              }}
              className="px-3.5 py-2 rounded-lg bg-[#0E1420] hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              <span>Import Excel</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (mode === 'TEAM') exportTeamsToXlsx(teams);
                else if (mode === 'MEME') exportMemesToXlsx(memes);
                else exportPuzzlesToXlsx(puzzles);
              }}
              className="px-3.5 py-2 rounded-lg bg-[#0E1420] hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              title={`Export ${entityLabel}s to Excel`}
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export .xlsx</span>
            </button>

            {(mode === 'PUZZLE' || mode === 'MEME') && (
              <button
                type="button"
                onClick={() => setShowQrSheet(true)}
                className="px-3.5 py-2 rounded-lg bg-[#0E1420] hover:bg-slate-800 border border-slate-800 text-cyan-300 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                title={`View & download all ${entityLabel} QR codes`}
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>QR Sheet</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleExportJson}
              className="px-3.5 py-2 rounded-lg bg-[#0E1420] hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              title={`Export ${entityLabel}s to JSON`}
            >
              <Download className="w-3.5 h-3.5" />
              <span>.json</span>
            </button>

            <button
              type="button"
              onClick={() => {
                resetFormsToDefaults(mode);
                setShowEditor(true);
                setStatusBanner(null);
              }}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add {entityLabel}</span>
            </button>
          </div>
        )}
      </div>

      {/* Feedback Banner */}
      {statusBanner && (
        <div
          className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
            statusBanner.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{statusBanner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="text-slate-400 hover:text-white text-xs font-medium cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Focused Single-Entry Editor Drawer */}
      {showEditor && (
        <div className="rounded-xl border border-slate-800 bg-[#0E1420] p-5 fade-in">
          <div className="flex items-center justify-between gap-4 pb-4 mb-5 border-b border-slate-800/80">
            <div>
              <h3 className="text-sm font-semibold text-white">
                {isEditingExisting ? `Edit ${entityLabel}` : `New ${entityLabel}`}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Changes save directly to {storageLabel} and sync offline cache automatically.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowEditor(false);
                resetFormsToDefaults(mode);
              }}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Close editor"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {mode === 'TEAM' && (
            <form onSubmit={handleCreateTeam} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Team ID (TID) *
                  </label>
                  <input
                    type="text"
                    value={teamTid}
                    onChange={(e) => setTeamTid(e.target.value.toUpperCase())}
                    placeholder="T041"
                    maxLength={32}
                    required
                    className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Backend Team Name *
                  </label>
                  <input
                    type="text"
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    placeholder="e.g. PIKA SQUAD"
                    maxLength={60}
                    required
                    className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Security Key *
                  </label>
                  <input
                    type="text"
                    value={teamKey}
                    onChange={(e) => setTeamKey(e.target.value)}
                    placeholder="e.g. 123"
                    maxLength={64}
                    required
                    className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Registered Email(s) *
                  </label>
                  <input
                    type="text"
                    value={teamEmailsText}
                    onChange={(e) => setTeamEmailsText(e.target.value)}
                    placeholder="trainer1@pykachu.go, trainer2@pykachu.go"
                    required
                    className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs font-mono text-cyan-300 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Team Members (comma separated)
                  </label>
                  <input
                    type="text"
                    value={teamMembersText}
                    onChange={(e) => setTeamMembersText(e.target.value)}
                    placeholder="Ash, Misty, Brock"
                    className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditor(false);
                    resetFormsToDefaults('TEAM');
                  }}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium cursor-pointer"
                >
                  {busy ? 'Saving...' : 'Save Team'}
                </button>
              </div>
            </form>
          )}

          {mode === 'MEME' && (
            <form onSubmit={handleCreateMeme} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Meme ID *
                  </label>
                  <input
                    type="text"
                    value={memeId}
                    onChange={(e) => setMemeId(e.target.value.toUpperCase())}
                    placeholder="M03"
                    maxLength={32}
                    required
                    className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    YouTube Link *
                  </label>
                  <input
                    type="url"
                    value={memeYtLink}
                    onChange={(e) => setMemeYtLink(e.target.value)}
                    placeholder="https://youtube.com/shorts/..."
                    maxLength={512}
                    required
                    className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Start (s)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={86400}
                      value={memeStart}
                      onChange={(e) => setMemeStart(e.target.value)}
                      className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      End (s)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={86400}
                      value={memeEnd}
                      onChange={(e) => setMemeEnd(e.target.value)}
                      className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditor(false);
                    resetFormsToDefaults('MEME');
                  }}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium cursor-pointer"
                >
                  {busy ? 'Saving...' : 'Save Meme'}
                </button>
              </div>
            </form>
          )}

          {mode === 'PUZZLE' && (
            <form onSubmit={handleCreatePuzzle} className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Puzzle ID *
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={puzzleId}
                    onChange={(e) => setPuzzleId(e.target.value)}
                    required
                    className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    QR Link ID *
                  </label>
                  <input
                    type="text"
                    value={puzzleLinkId}
                    onChange={(e) => setPuzzleLinkId(e.target.value.toUpperCase())}
                    placeholder="XG08"
                    maxLength={32}
                    required
                    className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Level
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={puzzleLevel}
                    onChange={(e) => setPuzzleLevel(e.target.value)}
                    className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Points
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    value={puzzlePoints}
                    onChange={(e) => setPuzzlePoints(e.target.value)}
                    className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Answer *
                  </label>
                  <input
                    type="text"
                    value={puzzleAnswer}
                    onChange={(e) => setPuzzleAnswer(e.target.value)}
                    placeholder="e.g. 14"
                    maxLength={256}
                    required
                    className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Start Code
                  </label>
                  <input
                    type="text"
                    value={puzzleStartCode}
                    onChange={(e) => setPuzzleStartCode(e.target.value.toUpperCase())}
                    placeholder="Optional"
                    maxLength={64}
                    className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Location Clue
                  </label>
                  <input
                    type="text"
                    value={puzzleLocation}
                    onChange={(e) => setPuzzleLocation(e.target.value)}
                    placeholder="e.g. Library Main Steps"
                    maxLength={500}
                    className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Next Puzzle IDs
                  </label>
                  <input
                    type="text"
                    value={puzzleNextIds}
                    onChange={(e) => setPuzzleNextIds(e.target.value)}
                    placeholder="e.g. 2, 6"
                    className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Pokémon ID
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    value={puzzlePokemonId}
                    onChange={(e) => setPuzzlePokemonId(e.target.value)}
                    className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Pokémon Name
                  </label>
                  <input
                    type="text"
                    value={puzzlePokemonName}
                    onChange={(e) => setPuzzlePokemonName(e.target.value)}
                    placeholder="Pikachu"
                    maxLength={80}
                    className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Badge ID (0=none)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    value={puzzleBadgeId}
                    onChange={(e) => setPuzzleBadgeId(e.target.value)}
                    className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                <div className="sm:col-span-3">
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Hint (optional)
                  </label>
                  <input
                    type="text"
                    value={puzzleHint}
                    onChange={(e) => setPuzzleHint(e.target.value)}
                    placeholder="Optional hint for teams..."
                    maxLength={1000}
                    className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Hint Wait (sec)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={3600}
                    value={puzzleHintPenalty}
                    onChange={(e) => setPuzzleHintPenalty(e.target.value)}
                    className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Tab Switch Penalty (sec)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={3600}
                    value={puzzleTabSwitchPenalty}
                    onChange={(e) => setPuzzleTabSwitchPenalty(e.target.value)}
                    className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Python Snippet
                  </label>
                  <textarea
                    rows={5}
                    value={puzzlePython}
                    onChange={(e) => setPuzzlePython(e.target.value)}
                    placeholder={'x = 5\nprint(x * 2)'}
                    className="w-full bg-[#090D16] border border-slate-800 rounded-lg p-3 text-xs font-mono text-emerald-300 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    C++ Snippet
                  </label>
                  <textarea
                    rows={5}
                    value={puzzleCpp}
                    onChange={(e) => setPuzzleCpp(e.target.value)}
                    placeholder={'#include <iostream>\nusing namespace std;\nint main(){ cout << 10; }'}
                    className="w-full bg-[#090D16] border border-slate-800 rounded-lg p-3 text-xs font-mono text-cyan-300 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditor(false);
                    resetFormsToDefaults('PUZZLE');
                  }}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium cursor-pointer"
                >
                  {busy ? 'Saving...' : 'Save Puzzle'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Excel Bulk Import Modal */}
      {showBulkModal && (
        <div
          ref={bulkDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulkImportTitle"
          tabIndex={-1}
          className="fixed inset-0 z-[70] flex items-start sm:items-center justify-center overflow-y-auto bg-slate-950/85 backdrop-blur-sm p-4"
        >
          <div className="my-0 sm:my-auto max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-800 bg-[#0E1420] p-6 shadow-2xl fade-in">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
              <div>
                <h3 id="bulkImportTitle" className="text-base font-semibold text-white">
                  Import {entityLabel}s via Excel
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Upload a formatted .xlsx, .xls, or .csv spreadsheet.
                </p>
              </div>
              <button
                ref={bulkCloseButtonRef}
                type="button"
                onClick={() => {
                  setShowBulkModal(false);
                  clearBulkPreview();
                }}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                aria-label="Close bulk import"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="rounded-lg bg-[#090D16] border border-slate-800 px-3.5 py-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-300 font-medium">
                    Excel Template (.xlsx) with sample rows
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (mode === 'TEAM') downloadTeamsTemplateXlsx();
                      else if (mode === 'MEME') downloadMemesTemplateXlsx();
                      else downloadPuzzlesTemplateXlsx();
                    }}
                    className="text-xs font-medium text-indigo-400 hover:text-indigo-300 flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Template (.xlsx)</span>
                  </button>
                </div>
                {mode === 'PUZZLE' && (
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Required: <span className="font-mono text-slate-200">id</span>,{' '}
                    <span className="font-mono text-slate-200">linkid</span>,{' '}
                    <span className="font-mono text-slate-200">answer</span>, and{' '}
                    <span className="font-mono text-slate-200">questionPython</span> or{' '}
                    <span className="font-mono text-slate-200">questionCpp</span>. Optional:{' '}
                    <span className="font-mono text-slate-300">
                      nextPuzzleId, level, points, locationClue, hint, hintPenalty, startCode, badgeId, pokemonId, pokemonName
                    </span>
                    .
                  </p>
                )}
              </div>

              <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-700 hover:border-indigo-500/60 rounded-xl p-6 bg-[#090D16] cursor-pointer transition-colors text-center">
                <Upload className="w-7 h-7 text-indigo-400 mb-2" />
                <span className="text-xs font-medium text-slate-200">
                  {bulkFilename || `Select ${entityLabel} spreadsheet (.xlsx / .csv)`}
                </span>
                <span className="text-xs text-slate-500 mt-1">
                  Click to browse files from your device
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => void handleFileChange(e)}
                  className="sr-only"
                />
              </label>

              {activeBulk && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs bg-[#090D16] rounded-lg px-3.5 py-2.5 border border-slate-800">
                    <span className="text-emerald-400 font-medium tabular-nums">
                      Valid rows: {activeBulk.valid.length} / {activeBulk.rawCount}
                    </span>
                    {activeBulk.errors.length > 0 && (
                      <span className="text-rose-400 font-medium tabular-nums">
                        Validation errors: {activeBulk.errors.length}
                      </span>
                    )}
                  </div>

                  {activeBulk.errors.length > 0 && (
                    <div className="max-h-36 overflow-y-auto rounded-lg bg-rose-950/30 border border-rose-500/30 p-3 text-xs font-mono text-rose-300 space-y-1.5">
                      {activeBulk.errors.map((err, i) => (
                        <div key={i}>
                          Row {err.row}: {err.reason}
                        </div>
                      ))}
                    </div>
                  )}

                  {activeBulk.valid.length > 0 && (
                    <div className="max-h-40 overflow-y-auto rounded-lg bg-[#090D16] border border-slate-800 divide-y divide-slate-800/80 text-xs font-mono">
                      {mode === 'TEAM' &&
                        (bulkTeams?.valid || []).slice(0, 8).map((t) => (
                          <div key={t.tid} className="px-3 py-2 flex items-center justify-between gap-2">
                            <span className="text-slate-400 shrink-0">{t.tid}</span>
                            <span className="text-white font-medium truncate">{t.team}</span>
                            <span className="text-slate-400 truncate flex-1 text-right">
                              {t.email || (t.emails || [])[0] || '-'}
                            </span>
                          </div>
                        ))}
                      {mode === 'MEME' &&
                        (bulkMemes?.valid || []).slice(0, 8).map((m) => (
                          <div key={m.memeid} className="px-3 py-2 flex items-center justify-between gap-2">
                            <span className="text-slate-200">{m.memeid}</span>
                            <span className="text-slate-400 truncate flex-1 text-right">{m.ytlink}</span>
                          </div>
                        ))}
                      {mode === 'PUZZLE' &&
                        (bulkPuzzles?.valid || []).slice(0, 8).map((p) => (
                          <div key={p.id} className="px-3 py-2 flex items-center justify-between gap-2">
                            <span className="text-slate-200 shrink-0">
                              P{p.id} · {p.linkid}
                            </span>
                            <span className="text-slate-400 truncate flex-1">{p.locationClue}</span>
                            <span className="text-cyan-300 shrink-0">
                              {p.nextPuzzleId.length > 0
                                ? `→ ${p.nextPuzzleId.map((n) => `P${n}`).join(',')}`
                                : 'End'}
                            </span>
                            <span className="text-emerald-400 shrink-0">Ans: {p.answer}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowBulkModal(false);
                    clearBulkPreview();
                  }}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy || !activeBulk?.valid.length}
                  onClick={() => void handleBulkImport()}
                  className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium cursor-pointer"
                >
                  {busy
                    ? 'Importing...'
                    : `Import ${activeBulk?.valid.length || 0} ${entityLabel}s`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Puzzle View Switcher: Directory Table vs Visual Circular Connection Map */}
      {mode === 'PUZZLE' && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className="inline-flex items-center p-1 rounded-lg bg-[#0E1420] border border-slate-800/80"
            role="tablist"
            aria-label="Puzzle workspace view"
          >
            <button
              type="button"
              role="tab"
              aria-selected={puzzleView === 'TABLE'}
              onClick={() => setPuzzleView('TABLE')}
              className={`px-3.5 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                puzzleView === 'TABLE'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Table2 className="w-3.5 h-3.5" />
              <span>Directory Table</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={puzzleView === 'MAP'}
              onClick={() => setPuzzleView('MAP')}
              className={`px-3.5 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                puzzleView === 'MAP'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5 text-cyan-400" />
              <span>Connection Map</span>
            </button>
          </div>
          <span className="text-xs text-slate-400">
            {puzzleView === 'MAP'
              ? 'Circular node graph with directional flow arrows'
              : 'Search, edit, or test QR links for individual puzzles'}
          </span>
        </div>
      )}

      {mode === 'QR' ? (
        <div className="space-y-5">
        <div className="rounded-xl border border-slate-800/80 bg-[#0E1420] p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 pb-4 mb-5 border-b border-slate-800/80">
            <div>
              <h3 className="text-sm font-semibold text-white">Custom QR Studio</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Manually enter any QR link, Pokémon ID for the center badge, and bottom ID &amp; location caption.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setCustomQrLink(`${QR_BASE_URL}/?linkid=`);
                setCustomQrPokemonId('25');
                setCustomQrColor({ r: 9, g: 13, b: 22 });
                setCustomQrBgColor({ r: 255, g: 255, b: 255 });
                setCustomQrPokemonSize('44');
                setCustomQrIdLabel('');
                setCustomQrLocation('');
                setCustomQrError(null);
              }}
              className="px-3 py-1.5 rounded-lg border border-slate-800 bg-[#090D16] hover:bg-slate-800 text-xs font-medium text-slate-300 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Fields</span>
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Manual Input Controls */}
            <div className="lg:col-span-7 space-y-4">
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label
                    htmlFor="customQrLinkInput"
                    className="block text-xs font-medium text-slate-300"
                  >
                    QR Link / URL *
                  </label>
                  <button
                    type="button"
                    onClick={() => setCustomQrLink(`${QR_BASE_URL}/?linkid=`)}
                    className="text-[11px] font-mono text-cyan-400 hover:text-cyan-300 cursor-pointer"
                  >
                    Use pykachugo.vercel.app
                  </button>
                </div>
                <input
                  id="customQrLinkInput"
                  type="text"
                  value={customQrLink}
                  onChange={(e) => setCustomQrLink(e.target.value)}
                  placeholder="https://pykachugo.vercel.app/?linkid=XG01"
                  className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs font-mono text-cyan-300 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="customQrPokeIdInput"
                    className="block text-xs font-medium text-slate-300 mb-1.5"
                  >
                    Pokémon ID (pokeid, 0 = none)
                  </label>
                  <div className="flex items-center gap-2.5">
                    <input
                      id="customQrPokeIdInput"
                      type="number"
                      min={0}
                      max={10000}
                      value={customQrPokemonId}
                      onChange={(e) => setCustomQrPokemonId(e.target.value)}
                      placeholder="25"
                      className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                    {Number(customQrPokemonId) > 0 && (
                      <div className="w-10 h-10 rounded-lg border border-slate-800 bg-[#090D16] flex items-center justify-center shrink-0 overflow-hidden">
                        <img
                          src={getPokemonArtworkUrl(Number(customQrPokemonId))}
                          alt={`Pokemon #${customQrPokemonId}`}
                          crossOrigin="anonymous"
                          className="w-8 h-8 object-contain"
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="customQrIdInput"
                    className="block text-xs font-medium text-slate-300 mb-1.5"
                  >
                    Bottom ID Label
                  </label>
                  <input
                    id="customQrIdInput"
                    type="text"
                    value={customQrIdLabel}
                    onChange={(e) => setCustomQrIdLabel(e.target.value)}
                    placeholder="e.g. P1"
                    maxLength={60}
                    className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="customQrHexColor" className="block text-xs font-medium text-slate-300 mb-1.5">
                    QR Color (HEX)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="customQrHexColor"
                      aria-label="QR color hex code"
                      type="text"
                      value={customQrHex}
                      onChange={(e) => {
                        const input = e.target.value.trim();
                        setCustomQrHex(input);
                        const hex = input.replace(/^#/, '');
                        if (/^[\da-fA-F]{6}$/.test(hex)) {
                          setCustomQrColor({
                            r: parseInt(hex.slice(0, 2), 16),
                            g: parseInt(hex.slice(2, 4), 16),
                            b: parseInt(hex.slice(4, 6), 16),
                          });
                        }
                      }}
                      className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                    />
                    <label
                      className="relative w-11 h-10 rounded-lg border border-slate-700 overflow-hidden shrink-0 cursor-pointer"
                      style={{ backgroundColor: `rgb(${customQrColor.r}, ${customQrColor.g}, ${customQrColor.b})` }}
                      title="Choose QR color"
                    >
                      <input
                        aria-label="Choose QR color"
                        type="color"
                        value={customQrHex.match(/^#?[\da-fA-F]{6}$/) ? (customQrHex.startsWith('#') ? customQrHex : `#${customQrHex}`) : `#${[customQrColor.r, customQrColor.g, customQrColor.b].map((value) => value.toString(16).padStart(2, '0')).join('')}`}
                        onChange={(e) => {
                          const hex = e.target.value.slice(1);
                          setCustomQrColor({
                            r: parseInt(hex.slice(0, 2), 16),
                            g: parseInt(hex.slice(2, 4), 16),
                            b: parseInt(hex.slice(4, 6), 16),
                          });
                        }}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                    </label>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">Enter a hex value or click the swatch to pick.</p>
                </div>

                <div>
                  <label htmlFor="customQrBgHexColor" className="block text-xs font-medium text-slate-300 mb-1.5">
                    QR Background (HEX)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="customQrBgHexColor"
                      aria-label="QR background color hex code"
                      type="text"
                      value={customQrBgHex}
                      onChange={(e) => {
                        const input = e.target.value.trim();
                        setCustomQrBgHex(input);
                        const hex = input.replace(/^#/, '');
                        if (/^[\da-fA-F]{6}$/.test(hex)) {
                          setCustomQrBgColor({
                            r: parseInt(hex.slice(0, 2), 16),
                            g: parseInt(hex.slice(2, 4), 16),
                            b: parseInt(hex.slice(4, 6), 16),
                          });
                        }
                      }}
                      className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                    />
                    <label
                      className="relative w-11 h-10 rounded-lg border border-slate-700 overflow-hidden shrink-0 cursor-pointer"
                      style={{ backgroundColor: `rgb(${customQrBgColor.r}, ${customQrBgColor.g}, ${customQrBgColor.b})` }}
                      title="Choose QR background color"
                    >
                      <input
                        aria-label="Choose QR background color"
                        type="color"
                        value={customQrBgHex.match(/^#?[\da-fA-F]{6}$/) ? (customQrBgHex.startsWith('#') ? customQrBgHex : `#${customQrBgHex}`) : `#${[customQrBgColor.r, customQrBgColor.g, customQrBgColor.b].map((value) => value.toString(16).padStart(2, '0')).join('')}`}
                        onChange={(e) => {
                          const hex = e.target.value.slice(1);
                          setCustomQrBgColor({
                            r: parseInt(hex.slice(0, 2), 16),
                            g: parseInt(hex.slice(2, 4), 16),
                            b: parseInt(hex.slice(4, 6), 16),
                          });
                        }}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                    </label>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">Changes sticker card &amp; QR module background.</p>
                </div>
              </div>

              {Math.abs(
                (0.299 * customQrColor.r + 0.587 * customQrColor.g + 0.114 * customQrColor.b) / 255 -
                (0.299 * customQrBgColor.r + 0.587 * customQrBgColor.g + 0.114 * customQrBgColor.b) / 255
              ) < 0.25 && (
                <p className="text-[11px] text-amber-400">
                  Low contrast between QR color and background may make this code difficult to scan.
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="customQrPokemonSize" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Pokémon Size (%)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="customQrPokemonSize"
                      type="number"
                      min={5}
                      max={80}
                      value={customQrPokemonSize}
                      onChange={(e) => setCustomQrPokemonSize(e.target.value)}
                      className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                    />
                    <span className="text-xs text-slate-500 shrink-0">5–80%</span>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="customQrLocationInput"
                    className="block text-xs font-medium text-slate-300 mb-1.5"
                  >
                    Bottom Location
                  </label>
                  <input
                    id="customQrLocationInput"
                    type="text"
                    value={customQrLocation}
                    onChange={(e) => setCustomQrLocation(e.target.value)}
                    placeholder="e.g. Library Main Steps"
                    maxLength={120}
                    className="w-full h-10 bg-[#090D16] border border-slate-800 rounded-lg px-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={!customQrStickerUrl || !customQrLink.trim()}
                  onClick={() => void handleDownloadCustomQrPng()}
                  className="px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download QR PNG</span>
                </button>

                <button
                  type="button"
                  disabled={!customQrLink.trim()}
                  onClick={() => void handleCopyCustomQrLink()}
                  className="px-3.5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {customQrCopied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-300">Copied Link</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Link</span>
                    </>
                  )}
                </button>

                {/^https?:\/\//i.test(customQrLink.trim()) && (
                  <a
                    href={customQrLink.trim()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3.5 py-2.5 rounded-lg border border-slate-800 bg-[#090D16] hover:bg-slate-800 text-slate-300 text-xs font-medium inline-flex items-center gap-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Test Link</span>
                  </a>
                )}
              </div>
            </div>

            {/* Live Branded Sticker Preview */}
            <div className="lg:col-span-5 flex flex-col items-center justify-center rounded-xl border border-slate-800 bg-[#090D16] p-3">
              {customQrError ? (
                <div className="py-16 text-center text-xs text-rose-400 font-medium px-4">
                  {customQrError}
                </div>
              ) : customQrStickerUrl ? (
                <img
                  src={customQrStickerUrl}
                  alt="Custom Branded QR Sticker Preview"
                  className="w-full max-w-[290px] h-auto object-contain rounded-lg shadow-lg"
                />
              ) : (
                <div className="w-64 h-72 flex items-center justify-center text-xs text-slate-500">
                  Generating custom QR...
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-800/80 bg-[#0E1420] p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 pb-4 mb-5 border-b border-slate-800/80">
            <div>
              <h3 className="text-sm font-semibold text-white">Bulk QR Creation</h3>
              <p className="mt-1 text-xs text-slate-400">
                Upload an Excel or CSV file, then choose how many QR stickers fit on each printable PNG sheet.
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Required: payload. Optional: pokemonId, idLabel, location, colorHex (e.g. #090D16), bgColorHex (e.g. #FFFFFF), pokemonSizePercent. RGB columns are also supported.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <span>Grid</span>
                <label className="flex items-center gap-1.5">
                  <span className="text-slate-500">Columns</span>
                  <input
                    aria-label="QR sheet columns"
                    type="number"
                    min={1}
                    max={10}
                    value={customQrGridColumns}
                    onChange={(e) => setCustomQrGridColumns(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                    className="h-9 w-14 rounded-lg border border-slate-700 bg-slate-900 px-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </label>
                <span className="text-slate-500">×</span>
                <label className="flex items-center gap-1.5">
                  <span className="text-slate-500">Rows</span>
                  <input
                    aria-label="QR sheet rows"
                    type="number"
                    min={1}
                    max={20}
                    value={customQrGridRows}
                    onChange={(e) => setCustomQrGridRows(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                    className="h-9 w-14 rounded-lg border border-slate-700 bg-slate-900 px-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </label>
                <span className="text-slate-500">({customQrGridColumns * customQrGridRows} QR max)</span>
              </div>
              <button
                type="button"
                onClick={downloadCustomQrTemplate}
                className="px-3 py-2 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                <span>Download Template</span>
              </button>
              <button
                type="button"
                disabled={customQrBulkLoading}
                onClick={() => customQrBulkInputRef.current?.click()}
                className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{customQrBulkLoading ? 'Generating…' : 'Upload Excel / CSV'}</span>
              </button>
              <input
                ref={customQrBulkInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="sr-only"
                onChange={(e) => {
                  void handleCustomQrBulkFile(e.target.files?.[0]);
                  e.currentTarget.value = '';
                }}
              />
            </div>
          </div>
          {customQrBulkFilename && <p className="mb-3 text-xs text-slate-400">File: {customQrBulkFilename}</p>}
          {customQrBulkError && (
            <p className="mb-3 rounded-lg border border-rose-500/30 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">
              {customQrBulkError}
            </p>
          )}
          {customQrBulkLoading && <p className="mb-3 text-xs text-cyan-300">Generating QR stickers…</p>}
          {customQrBulkRows.length > 0 && (
            <div>
              <div className="mb-3 rounded-lg border border-slate-700 bg-slate-950/70 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-200">PNG sheet preview</span>
                  <span className="text-[10px] text-slate-500">{customQrGridColumns} columns · {Math.ceil(customQrBulkRows.length / customQrGridColumns)} rows</span>
                </div>
                  <div className="max-h-[32rem] overflow-auto rounded-md bg-white p-2">
                  <div
                    className="grid w-full gap-1"
                    style={{ gridTemplateColumns: `repeat(${customQrGridColumns}, minmax(0, 1fr))` }}
                  >
                    {Array.from({ length: Math.ceil(customQrBulkRows.length / customQrGridColumns) * customQrGridColumns }, (_, index) => {
                      const row = customQrBulkRows[index];
                      return (
                        <div key={`sheet-preview-${index}`} className="aspect-[400/490] overflow-hidden rounded border border-slate-200 bg-slate-50">
                          {row ? (
                            <img src={row.url} alt={`QR sticker ${row.label}`} className="h-full w-full object-contain" />
                          ) : <div className="h-full w-full" />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-emerald-300">Generated {customQrBulkRows.length} QR stickers</span>
                <button
                  type="button"
                  onClick={() => void handleDownloadCustomQrBulkSheet()}
                  className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download PNG Sheet</span>
                </button>
              </div>
            </div>
          )}
        </div>
        </div>
      ) : mode === 'PUZZLE' && puzzleView === 'MAP' ? (
        <PuzzleConnectionMap
          puzzles={puzzles}
          onEditPuzzle={openPuzzleEditor}
          onShowQr={(p) =>
            setQrModalItem({
              kind: 'PUZZLE',
              code: p.linkid,
              title: `P${p.id} · ${p.linkid}`,
              idLabel: `P${p.id}`,
              subtitle: p.locationClue || 'Campus Signal Node',
              badgeText: `Level ${p.level} · ${p.points} pts`,
              pokemonId: p.pokemonId ?? 25,
            })
          }
        />
      ) : (
      /* Clean Catalog Table */
      <div className="rounded-xl border border-slate-800/80 bg-[#0E1420] overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-medium text-white">
            {entityLabel} Directory{' '}
            <span className="text-xs text-slate-400 font-mono tabular-nums ml-1.5">
              ({activeFilteredCount})
            </span>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={catalogSearch}
              onChange={(e) => {
                setCatalogSearch(e.target.value);
                setCatalogPage(1);
              }}
              placeholder={`Search ${entityLabel.toLowerCase()}s...`}
              className="w-full h-9 bg-[#090D16] border border-slate-800 rounded-lg pl-9 pr-3 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          {activeFilteredCount === 0 ? (
            <div className="px-6 py-12 text-center space-y-3">
              <p className="text-sm text-slate-400">
                No {entityLabel.toLowerCase()} records found.
              </p>
              <button
                type="button"
                onClick={() => {
                  resetFormsToDefaults(mode);
                  setShowEditor(true);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add {entityLabel}</span>
              </button>
            </div>
          ) : mode === 'TEAM' ? (
            <table className="w-full text-left border-collapse min-w-[680px]">
              <thead>
                <tr className="border-b border-slate-800/80 bg-slate-900/40 text-xs font-medium text-slate-400">
                  <th className="py-2.5 px-4 w-24">TID</th>
                  <th className="py-2.5 px-4">Team Name</th>
                  <th className="py-2.5 px-4">Registered Email(s)</th>
                  <th className="py-2.5 px-4 w-28">Key</th>
                  <th className="py-2.5 px-4">Members</th>
                  <th className="py-2.5 px-4 text-right w-40">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {pagedTeams.map((t) => {
                  const emailSummary =
                    t.emails && t.emails.length > 0 ? t.emails.join(', ') : t.email || '';
                  return (
                    <tr key={t.tid} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-300 font-medium">
                        {t.tid}
                      </td>
                      <td className="py-3 px-4 font-medium text-white">{t.team}</td>
                      <td className="py-3 px-4 font-mono text-slate-300 max-w-[240px] truncate" title={emailSummary}>
                        {emailSummary || '-'}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-400">{t.securityKey}</td>
                      <td className="py-3 px-4 text-slate-400 max-w-[200px] truncate">
                        {(t.team_members || []).join(', ') || '-'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setTeamTid(t.tid);
                              setTeamName(t.team);
                              setTeamEmailsText(emailSummary);
                              setTeamKey(t.securityKey);
                              setTeamMembersText((t.team_members || []).join(', '));
                              setIsEditingExisting(true);
                              setShowEditor(true);
                            }}
                            className="px-2.5 py-1.5 rounded-md bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void handleDeleteCloudItem(t.tid, () =>
                                adminDeleteTeamCatalog(t.tid, adminKey)
                              )
                            }
                            className={`px-2.5 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1 cursor-pointer ${
                              confirmDeleteKey === t.tid
                                ? 'bg-rose-600 text-white'
                                : 'text-rose-400 hover:bg-rose-500/10'
                            }`}
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>{confirmDeleteKey === t.tid ? 'Confirm?' : 'Delete'}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : mode === 'MEME' ? (
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="border-b border-slate-800/80 bg-slate-900/40 text-xs font-medium text-slate-400">
                  <th className="py-2.5 px-4 w-28">Meme ID</th>
                  <th className="py-2.5 px-4">YouTube Link</th>
                  <th className="py-2.5 px-4 w-32">Clip Window</th>
                  <th className="py-2.5 px-4 text-right w-48">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {pagedMemes.map((m) => (
                  <tr key={m.memeid} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-4 font-mono tabular-nums text-white font-medium">
                      {m.memeid}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-300 max-w-[340px] truncate">
                      {m.ytlink}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-400">
                      {m.starttime}s – {m.endtime || 'end'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setQrModalItem({
                              kind: 'MEME',
                              code: m.memeid,
                              title: m.memeid,
                              subtitle: m.ytlink,
                              badgeText: `${m.starttime}s – ${m.endtime || 'end'}`,
                            })
                          }
                          className="px-2.5 py-1.5 rounded-md bg-slate-800/80 hover:bg-slate-700 text-cyan-300 text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
                        >
                          <QrCode className="w-3 h-3" />
                          <span>QR</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMemeId(m.memeid);
                            setMemeYtLink(m.ytlink);
                            setMemeStart(String(m.starttime || 0));
                            setMemeEnd(String(m.endtime || 0));
                            setIsEditingExisting(true);
                            setShowEditor(true);
                          }}
                          className="px-2.5 py-1.5 rounded-md bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Pencil className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void handleDeleteCloudItem(m.memeid, () =>
                              adminDeleteMemeCatalog(m.memeid, adminKey)
                            )
                          }
                          className={`px-2.5 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1 cursor-pointer ${
                            confirmDeleteKey === m.memeid
                              ? 'bg-rose-600 text-white'
                              : 'text-rose-400 hover:bg-rose-500/10'
                          }`}
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>{confirmDeleteKey === m.memeid ? 'Confirm?' : 'Delete'}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left border-collapse min-w-[780px]">
              <thead>
                <tr className="border-b border-slate-800/80 bg-slate-900/40 text-xs font-medium text-slate-400">
                  <th className="py-2.5 px-4 w-20">ID</th>
                  <th className="py-2.5 px-4 w-24">Link ID</th>
                  <th className="py-2.5 px-4 w-20">Level</th>
                  <th className="py-2.5 px-4">Location Clue</th>
                  <th className="py-2.5 px-4 w-28">Next Links</th>
                  <th className="py-2.5 px-4 w-28">Pokémon</th>
                  <th className="py-2.5 px-4 text-right w-20">Points</th>
                  <th className="py-2.5 px-4 w-24">Answer</th>
                  <th className="py-2.5 px-4 text-right w-48">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {pagedPuzzles.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-4 font-mono tabular-nums text-white font-medium">
                      P{p.id}
                    </td>
                    <td className="py-3 px-4 font-mono text-cyan-300 font-medium">{p.linkid}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-400">L{p.level}</td>
                    <td className="py-3 px-4 text-slate-200 max-w-[200px] truncate">
                      {p.locationClue}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-300">
                      {(p.nextPuzzleId || []).length > 0
                        ? `→ ${p.nextPuzzleId.map((n) => `P${n}`).join(', ')}`
                        : 'End'}
                    </td>
                    <td className="py-3 px-4 text-slate-400">{p.pokemonName}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-right text-slate-300">
                      {p.points}
                    </td>
                    <td className="py-3 px-4 font-mono text-emerald-400">{p.answer}</td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setQrModalItem({
                              kind: 'PUZZLE',
                              code: p.linkid,
                              title: `P${p.id} · ${p.linkid}`,
                              idLabel: `P${p.id}`,
                              subtitle: p.locationClue || 'Campus Signal Node',
                              badgeText: `Level ${p.level} · ${p.points} pts`,
                              pokemonId: p.pokemonId ?? 25,
                            })
                          }
                          className="px-2.5 py-1.5 rounded-md bg-slate-800/80 hover:bg-slate-700 text-cyan-300 text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
                        >
                          <QrCode className="w-3 h-3" />
                          <span>QR</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openPuzzleEditor(p)}
                          className="px-2.5 py-1.5 rounded-md bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Pencil className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void handleDeleteCloudItem(`P${p.id}`, () =>
                              adminDeletePuzzleCatalog(p.id, adminKey)
                            )
                          }
                          className={`px-2.5 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1 cursor-pointer ${
                            confirmDeleteKey === `P${p.id}`
                              ? 'bg-rose-600 text-white'
                              : 'text-rose-400 hover:bg-rose-500/10'
                          }`}
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>{confirmDeleteKey === `P${p.id}` ? 'Confirm?' : 'Delete'}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {totalCatalogPages > 1 && (
          <div className="px-4 py-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
            <span className="font-mono tabular-nums">
              Showing {catalogStartIdx + 1}–
              {Math.min(catalogStartIdx + CATALOG_PAGE_SIZE, activeFilteredCount)} of{' '}
              {activeFilteredCount}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={safeCatalogPage <= 1}
                onClick={() => setCatalogPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 inline-flex items-center gap-1 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Previous</span>
              </button>
              <span className="font-mono tabular-nums text-slate-300 px-1">
                {safeCatalogPage} / {totalCatalogPages}
              </span>
              <button
                type="button"
                disabled={safeCatalogPage >= totalCatalogPages}
                onClick={() => setCatalogPage((p) => Math.min(totalCatalogPages, p + 1))}
                className="px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 inline-flex items-center gap-1 cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      <QrCodeModal item={qrModalItem} onClose={() => setQrModalItem(null)} />
      <QrBatchSheetModal
        open={showQrSheet}
        onClose={() => setShowQrSheet(false)}
        heading={mode === 'MEME' ? 'Meme QR Codes' : 'Puzzle QR Codes'}
        items={
          mode === 'MEME'
            ? memes.map((m) => ({
                kind: 'MEME' as const,
                code: m.memeid,
                title: m.memeid,
                subtitle: m.ytlink,
              }))
            : puzzles.map((p) => ({
                kind: 'PUZZLE' as const,
                code: p.linkid,
                title: `P${p.id} · ${p.linkid}`,
                idLabel: `P${p.id}`,
                subtitle: p.locationClue || 'Campus Signal Node',
                pokemonId: p.pokemonId ?? 25,
              }))
        }
      />
    </div>
  );
};
