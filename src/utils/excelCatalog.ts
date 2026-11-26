import * as XLSX from 'xlsx';
import type { MemeEntry, Puzzle, TeamEntry } from '../types/game';

export interface ParsedSpreadsheetResult<T> {
  valid: T[];
  errors: { row: number; reason: string }[];
  rawCount: number;
}

function normalizeHeader(key: string): string {
  return String(key || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeRow(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  Object.entries(raw).forEach(([k, v]) => {
    const nk = normalizeHeader(k);
    if (nk) out[nk] = v;
  });
  return out;
}

function pickStr(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const val = row[k];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      return String(val).trim();
    }
  }
  return '';
}

function pickNum(row: Record<string, unknown>, keys: string[], fallback = 0): number {
  for (const k of keys) {
    const val = row[k];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      const n = Number(val);
      if (!Number.isNaN(n)) return n;
    }
  }
  return fallback;
}

function sanitizeId(raw: string, maxLen: number): string {
  return raw
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLen);
}

async function readFirstSheetRows(file: File): Promise<Record<string, unknown>[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) return [];
  const sheet = wb.Sheets[firstSheet];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
}

// ==========================================
// TEAMS EXCEL PARSER & TEMPLATE
// ==========================================
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseEmailList(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  values.forEach((raw) => {
    String(raw || '')
      .split(/[,;\n\r\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .forEach((email) => {
        if (EMAIL_RE.test(email) && !seen.has(email)) {
          seen.add(email);
          out.push(email);
        }
      });
  });
  return out;
}

export async function parseTeamsSpreadsheet(
  file: File
): Promise<ParsedSpreadsheetResult<TeamEntry>> {
  const rawRows = await readFirstSheetRows(file);
  const valid: TeamEntry[] = [];
  const errors: { row: number; reason: string }[] = [];

  rawRows.forEach((raw, idx) => {
    const rowNum = idx + 2;
    const r = normalizeRow(raw);

    const team = pickStr(r, ['team', 'teamname', 'name']);
    const rawTid = pickStr(r, ['tid', 'teamid', 'id']);
    const securityKey = pickStr(r, ['securitykey', 'key', 'password', 'pin', 'code']) || '123';

    if (!team) {
      errors.push({ row: rowNum, reason: 'Missing team name (column: team / teamName)' });
      return;
    }
    const tid = sanitizeId((rawTid || `T${String(idx + 1).padStart(3, '0')}`).toUpperCase(), 32);
    if (!tid) {
      errors.push({ row: rowNum, reason: 'Invalid TID characters' });
      return;
    }

    const combinedMembers = pickStr(r, ['teammembers', 'members']);
    let members: string[] = [];
    if (combinedMembers) {
      members = combinedMembers
        .split(/[,|;\n]+/)
        .map((m) => m.trim())
        .filter(Boolean);
    } else {
      for (let mIdx = 1; mIdx <= 12; mIdx++) {
        const val = pickStr(r, [`member${mIdx}`, `player${mIdx}`, `m${mIdx}`]);
        if (val) members.push(val);
      }
    }

    const rawEmailSources: string[] = [];
    const primaryEmailRaw = pickStr(r, ['email', 'emailid', 'teamemail', 'emails', 'mail']);
    if (primaryEmailRaw) rawEmailSources.push(primaryEmailRaw);
    for (let eIdx = 1; eIdx <= 12; eIdx++) {
      const val = pickStr(r, [`email${eIdx}`, `memberemail${eIdx}`]);
      if (val) rawEmailSources.push(val);
    }
    members.forEach((m) => {
      if (m.includes('@')) rawEmailSources.push(m);
    });

    const emails = parseEmailList(rawEmailSources).slice(0, 12);
    if (emails.length === 0) {
      errors.push({ row: rowNum, reason: 'Missing valid email ID (column: email / emailId)' });
      return;
    }

    valid.push({
      tid,
      team: team.slice(0, 60),
      email: emails[0],
      emails,
      securityKey: securityKey.slice(0, 64),
      team_members: members.slice(0, 12),
    });
  });

  return { valid, errors, rawCount: rawRows.length };
}

export function downloadTeamsTemplateXlsx(): void {
  const rows = [
    {
      tid: 'T051',
      team: 'PIKA SQUAD',
      email: 'ash@pykachu.go, misty@pykachu.go',
      securityKey: 'PIKA123',
      member1: 'Ash Ketchum',
      member2: 'Misty Waterflower',
      member3: 'Brock Harrison',
      member4: 'Pikachu',
    },
    {
      tid: 'T052',
      team: 'CODE CHARIZARD',
      email: 'red@pykachu.go',
      securityKey: 'FIRE999',
      member1: 'Red',
      member2: 'Blue',
      member3: 'Green',
      member4: '',
    },
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Teams');
  XLSX.writeFile(wb, 'pykachu_teams_template.xlsx');
}

export function exportTeamsToXlsx(teams: TeamEntry[]): void {
  const rows = teams.map((t) => ({
    tid: t.tid,
    team: t.team,
    email:
      t.emails && t.emails.length > 0
        ? t.emails.join(', ')
        : t.email || '',
    securityKey: t.securityKey,
    team_members: (t.team_members || []).join(', '),
    member1: t.team_members?.[0] || '',
    member2: t.team_members?.[1] || '',
    member3: t.team_members?.[2] || '',
    member4: t.team_members?.[3] || '',
    source: 'PYKACHU_GO',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Teams');
  XLSX.writeFile(wb, `pykachu_teams_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ==========================================
// MEMES EXCEL PARSER & TEMPLATE
// ==========================================
export async function parseMemesSpreadsheet(
  file: File
): Promise<ParsedSpreadsheetResult<MemeEntry>> {
  const rawRows = await readFirstSheetRows(file);
  const valid: MemeEntry[] = [];
  const errors: { row: number; reason: string }[] = [];

  rawRows.forEach((raw, idx) => {
    const rowNum = idx + 2;
    const r = normalizeRow(raw);

    const rawId = pickStr(r, ['memeid', 'id', 'code']);
    const ytlink = pickStr(r, ['ytlink', 'youtubelink', 'youtube', 'url', 'link']);
    const starttime = Math.max(0, pickNum(r, ['starttime', 'start', 'startsec'], 0));
    const endtime = Math.max(0, pickNum(r, ['endtime', 'end', 'endsec'], 0));

    if (!rawId) {
      errors.push({ row: rowNum, reason: 'Missing memeid (e.g. M03)' });
      return;
    }
    if (!ytlink || ytlink.length < 5) {
      errors.push({ row: rowNum, reason: 'Missing or invalid ytlink' });
      return;
    }

    const memeid = sanitizeId(rawId.toUpperCase(), 32);
    if (!memeid) {
      errors.push({ row: rowNum, reason: 'Invalid memeid format' });
      return;
    }

    valid.push({
      memeid,
      ytlink: ytlink.slice(0, 512),
      starttime,
      endtime: endtime > 0 && endtime < starttime ? starttime : endtime,
    });
  });

  return { valid, errors, rawCount: rawRows.length };
}

export function downloadMemesTemplateXlsx(): void {
  const rows = [
    {
      memeid: 'M03',
      ytlink: 'https://youtube.com/shorts/dQw4w9WgXcQ',
      starttime: 0,
      endtime: 15,
    },
    {
      memeid: 'M04',
      ytlink: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      starttime: 10,
      endtime: 25,
    },
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Memes');
  XLSX.writeFile(wb, 'pykachu_memes_template.xlsx');
}

export function exportMemesToXlsx(memes: MemeEntry[]): void {
  const rows = memes.map((m) => ({
    memeid: m.memeid,
    ytlink: m.ytlink,
    starttime: m.starttime,
    endtime: m.endtime,
    qrUrl: `https://pykachugo.vercel.app/?memid=${encodeURIComponent(m.memeid)}`,
    source: 'PYKACHU_GO',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Memes');
  XLSX.writeFile(wb, `pykachu_memes_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ==========================================
// PUZZLES EXCEL PARSER & TEMPLATE
// ==========================================
function isBlankRow(raw: Record<string, unknown>): boolean {
  return Object.values(raw).every((v) => v === undefined || v === null || String(v).trim() === '');
}

function parseStrictInt(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const str = String(raw).trim();
  if (!str) return null;
  if (!/^-?\d+(\.0+)?$/.test(str)) return null;
  const n = Number(str);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function parseStrictNum(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const str = String(raw).trim();
  if (!str) return null;
  const n = Number(str);
  return Number.isFinite(n) ? n : null;
}

export async function parsePuzzlesSpreadsheet(
  file: File
): Promise<ParsedSpreadsheetResult<Puzzle>> {
  const rawRows = await readFirstSheetRows(file);
  const nonEmptyRows = rawRows
    .map((raw, idx) => ({ raw, rowNum: idx + 2 }))
    .filter(({ raw }) => !isBlankRow(raw));

  if (nonEmptyRows.length === 0) {
    return {
      valid: [],
      errors: [
        {
          row: 1,
          reason:
            'Spreadsheet is empty. Download the Puzzle Template (.xlsx) and add at least one puzzle row.',
        },
      ],
      rawCount: 0,
    };
  }

  const valid: Puzzle[] = [];
  const errors: { row: number; reason: string }[] = [];
  const seenIds = new Map<number, number>();
  const seenLinkIds = new Map<string, number>();

  nonEmptyRows.forEach(({ raw, rowNum }) => {
    const r = normalizeRow(raw);
    const rowIssues: string[] = [];

    const rawIdVal = r.id ?? r.puzzleid;
    const id = parseStrictInt(rawIdVal);
    if (id === null || id < 1 || id > 10000) {
      rowIssues.push('Missing or invalid id (must be whole number 1–10000)');
    } else if (seenIds.has(id)) {
      rowIssues.push(`Duplicate Puzzle id #${id} (already used on row ${seenIds.get(id)})`);
    }

    const linkid = pickStr(r, ['linkid', 'qr', 'qrcode', 'slug']).toUpperCase();
    if (!linkid) {
      rowIssues.push('Missing linkid (e.g. XG21)');
    } else if (linkid.length > 32) {
      rowIssues.push('linkid exceeds 32 characters');
    } else if (seenLinkIds.has(linkid)) {
      rowIssues.push(`Duplicate linkid "${linkid}" (already used on row ${seenLinkIds.get(linkid)})`);
    }

    const answer = pickStr(r, ['answer', 'ans', 'solution', 'output']);
    if (!answer) {
      rowIssues.push('Missing answer');
    }

    const questionPython = pickStr(r, ['questionpython', 'python', 'pycode', 'pythoncode']);
    const questionCpp = pickStr(r, ['questioncpp', 'cpp', 'cppcode', 'c']);
    if (!questionPython && !questionCpp) {
      rowIssues.push('Missing code snippet (provide questionPython or questionCpp)');
    }

    const rawLevelVal = r.level ?? r.lvl;
    let level = 1;
    if (rawLevelVal !== undefined && rawLevelVal !== null && String(rawLevelVal).trim() !== '') {
      const parsedLevel = parseStrictInt(rawLevelVal);
      if (parsedLevel === null || parsedLevel < 1 || parsedLevel > 10) {
        rowIssues.push('Invalid level (must be 1–10)');
      } else {
        level = parsedLevel;
      }
    }

    const rawPointsVal = r.points ?? r.pts ?? r.score;
    let points = 10;
    if (rawPointsVal !== undefined && rawPointsVal !== null && String(rawPointsVal).trim() !== '') {
      const parsedPoints = parseStrictNum(rawPointsVal);
      if (parsedPoints === null || parsedPoints < 0) {
        rowIssues.push('Invalid points (must be 0 or greater)');
      } else {
        points = parsedPoints;
      }
    }

    const rawPenaltyVal = r.hintpenalty ?? r.penalty;
    let hintPenalty = 60;
    if (rawPenaltyVal !== undefined && rawPenaltyVal !== null && String(rawPenaltyVal).trim() !== '') {
      const parsedPenalty = parseStrictInt(rawPenaltyVal);
      if (parsedPenalty === null || parsedPenalty < 0) {
        rowIssues.push('Invalid hintPenalty (must be 0 or greater)');
      } else {
        hintPenalty = parsedPenalty;
      }
    }

    const rawBadgeVal = r.badgeid ?? r.badge;
    let badgeId = 0;
    if (rawBadgeVal !== undefined && rawBadgeVal !== null && String(rawBadgeVal).trim() !== '') {
      const parsedBadge = parseStrictInt(rawBadgeVal);
      if (parsedBadge === null || parsedBadge < 0) {
        rowIssues.push('Invalid badgeId (must be 0 or positive integer)');
      } else {
        badgeId = parsedBadge;
      }
    }

    const rawPokeVal = r.pokemonid ?? r.pokeid;
    let pokemonId = 25;
    if (rawPokeVal !== undefined && rawPokeVal !== null && String(rawPokeVal).trim() !== '') {
      const parsedPoke = parseStrictInt(rawPokeVal);
      if (parsedPoke === null || parsedPoke < 0) {
        rowIssues.push('Invalid pokemonId (must be 0 or positive integer)');
      } else {
        pokemonId = parsedPoke;
      }
    }

    const nextRaw = pickStr(r, ['nextpuzzleid', 'next', 'nextids', 'nextpuzzles']);
    const nextPuzzleId: number[] = [];
    if (nextRaw) {
      const tokens = nextRaw
        .split(/[,|;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const invalidTokens: string[] = [];
      tokens.forEach((tok) => {
        const parsedNext = parseStrictInt(tok);
        if (parsedNext === null || parsedNext < 1 || parsedNext > 10000) {
          invalidTokens.push(tok);
        } else if (!nextPuzzleId.includes(parsedNext)) {
          nextPuzzleId.push(parsedNext);
        }
      });
      if (invalidTokens.length > 0) {
        rowIssues.push(
          `Invalid nextPuzzleId "${invalidTokens.join(', ')}" (use comma-separated IDs like "22, 23")`
        );
      }
    }

    if (rowIssues.length > 0) {
      errors.push({ row: rowNum, reason: rowIssues.join(' · ') });
      return;
    }

    const validId = id as number;
    seenIds.set(validId, rowNum);
    seenLinkIds.set(linkid, rowNum);

    const locationClue = pickStr(r, ['locationclue', 'location', 'clue']) || 'Campus Signal Node';
    const startCode = pickStr(r, ['startcode', 'unlockcode']).toUpperCase();
    const hint = pickStr(r, ['hint', 'tip']);
    const pokemonName = pickStr(r, ['pokemonname', 'pokemon']) || 'Pikachu';

    const hasValidHint =
      Boolean(hint) &&
      !['none', 'false', 'null'].includes(hint.trim().toLowerCase());

    valid.push({
      id: validId,
      linkid: linkid.slice(0, 32),
      badgeId: badgeId > 0 ? badgeId : undefined,
      questionPython: questionPython.slice(0, 8000),
      questionCpp: questionCpp.slice(0, 8000),
      answer: answer.slice(0, 256),
      nextPuzzleId: nextPuzzleId.slice(0, 50),
      startCode: startCode ? startCode.slice(0, 64) : undefined,
      requiresStartCode: Boolean(startCode),
      locationClue: locationClue.slice(0, 500),
      level,
      points,
      hint: hasValidHint ? hint.slice(0, 1000) : undefined,
      hasHint: hasValidHint,
      hintPenalty,
      pokemonId,
      pokemonName: pokemonName.slice(0, 80),
    });
  });

  return { valid, errors, rawCount: nonEmptyRows.length };
}

export function downloadPuzzlesTemplateXlsx(): void {
  const sampleRows = [
    {
      id: 21,
      linkid: 'XG21',
      level: 1,
      points: 10,
      answer: '14',
      nextPuzzleId: '22',
      locationClue: 'Library Entrance Gate',
      questionPython: 'total = 0\nfor i in range(2, 6):\n    total += i\nprint(total)',
      questionCpp:
        '#include <iostream>\nusing namespace std;\nint main() {\n    int total = 0;\n    for(int i = 2; i < 6; i++) total += i;\n    cout << total << endl;\n    return 0;\n}',
      hint: 'Check loop bounds carefully',
      hintPenalty: 60,
      startCode: 'START',
      badgeId: 1,
      pokemonId: 25,
      pokemonName: 'Pikachu',
    },
    {
      id: 22,
      linkid: 'XG22',
      level: 2,
      points: 20,
      answer: '18',
      nextPuzzleId: '',
      locationClue: 'Innovation Lab 2F',
      questionPython: 'def calc(x):\n    return x * 3\n\nprint(calc(6))',
      questionCpp:
        '#include <iostream>\nusing namespace std;\nint calc(int x) { return x * 3; }\nint main() { cout << calc(6) << endl; return 0; }',
      hint: 'Multiply input by 3',
      hintPenalty: 60,
      startCode: '',
      badgeId: 0,
      pokemonId: 6,
      pokemonName: 'Charizard',
    },
  ];

  const ws = XLSX.utils.json_to_sheet(sampleRows);
  ws['!cols'] = [
    { wch: 8 },  // id
    { wch: 10 }, // linkid
    { wch: 8 },  // level
    { wch: 8 },  // points
    { wch: 14 }, // answer
    { wch: 16 }, // nextPuzzleId
    { wch: 24 }, // locationClue
    { wch: 42 }, // questionPython
    { wch: 48 }, // questionCpp
    { wch: 28 }, // hint
    { wch: 12 }, // hintPenalty
    { wch: 12 }, // startCode
    { wch: 10 }, // badgeId
    { wch: 11 }, // pokemonId
    { wch: 14 }, // pokemonName
  ];

  const guideRows = [
    { Column: 'id', Status: 'Required', Format: 'Whole number (1–10000)', Notes: 'Unique numeric Puzzle ID (e.g. 21)' },
    { Column: 'linkid', Status: 'Required', Format: 'Text (max 32 chars)', Notes: 'Unique QR scan code (e.g. XG21)' },
    { Column: 'answer', Status: 'Required', Format: 'Text or number', Notes: 'Exact expected output (e.g. 14)' },
    { Column: 'questionPython', Status: 'Required (or C++)', Format: 'Python code text', Notes: 'At least one of questionPython or questionCpp is required' },
    { Column: 'questionCpp', Status: 'Required (or Python)', Format: 'C++ code text', Notes: 'At least one of questionPython or questionCpp is required' },
    { Column: 'nextPuzzleId', Status: 'Optional', Format: 'Comma-separated IDs', Notes: 'Links this puzzle to next puzzle IDs (e.g. "22, 23")' },
    { Column: 'level', Status: 'Optional', Format: 'Whole number (1–10)', Notes: 'Defaults to 1 if blank' },
    { Column: 'points', Status: 'Optional', Format: 'Number (>= 0)', Notes: 'Defaults to 10 if blank' },
    { Column: 'locationClue', Status: 'Optional', Format: 'Text', Notes: 'Physical clue shown to players; defaults to Campus Signal Node' },
    { Column: 'hint', Status: 'Optional', Format: 'Text', Notes: 'Optional hint text; leave blank for no hint' },
    { Column: 'hintPenalty', Status: 'Optional', Format: 'Seconds (>= 0)', Notes: 'Hint wait cooldown in seconds; defaults to 60' },
    { Column: 'startCode', Status: 'Optional', Format: 'Uppercase text', Notes: 'Optional unlock code required before viewing puzzle' },
    { Column: 'badgeId', Status: 'Optional', Format: 'Whole number (>= 0)', Notes: '0 or blank for no badge' },
    { Column: 'pokemonId', Status: 'Optional', Format: 'Whole number (>= 0)', Notes: 'Sprite ID (defaults to 25 for Pikachu)' },
    { Column: 'pokemonName', Status: 'Optional', Format: 'Text', Notes: 'Creature name (defaults to Pikachu)' },
  ];
  const guideSheet = XLSX.utils.json_to_sheet(guideRows);
  guideSheet['!cols'] = [
    { wch: 16 },
    { wch: 20 },
    { wch: 24 },
    { wch: 58 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Puzzles');
  XLSX.utils.book_append_sheet(wb, guideSheet, 'Field Guide');
  XLSX.writeFile(wb, 'pykachu_puzzles_template.xlsx');
}

export function exportPuzzlesToXlsx(puzzles: Puzzle[]): void {
  const rows = puzzles.map((p) => ({
    id: p.id,
    linkid: p.linkid,
    level: p.level,
    points: p.points,
    startCode: p.startCode || '',
    badgeId: p.badgeId || 0,
    locationClue: p.locationClue,
    pokemonId: p.pokemonId,
    pokemonName: p.pokemonName,
    answer: p.answer,
    hint: typeof p.hint === 'string' ? p.hint : '',
    hintPenalty: p.hintPenalty ?? 60,
    nextPuzzleId: (p.nextPuzzleId || []).join(', '),
    questionPython: p.questionPython,
    questionCpp: p.questionCpp,
    qrUrl: `https://pykachugo.vercel.app/?linkid=${encodeURIComponent(p.linkid)}`,
    source: 'PYKACHU_GO',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Puzzles');
  XLSX.writeFile(wb, `pykachu_puzzles_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
