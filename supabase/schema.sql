-- ============================================================================
-- Pykachu Go — Tier 3: Supabase PostgreSQL Schema, Constraints, Indexes,
-- Security RPCs & RLS Policies
-- Project ID: gapgwryagjpwpyxkcxck
-- Run this in Supabase Dashboard -> SQL Editor -> New Query
-- Existing data in existing tables is preserved cleanly.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Game Metadata (Epoch & Catalog Version)
CREATE TABLE IF NOT EXISTS public.game_meta (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  epoch INTEGER NOT NULL DEFAULT 1 CHECK (epoch >= 1),
  catalog_version INTEGER NOT NULL DEFAULT 1 CHECK (catalog_version >= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Admins Credentials (Verified server-side via verify_admin_login RPC)
CREATE TABLE IF NOT EXISTS public.admins (
  email TEXT PRIMARY KEY,
  password TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admins_email_normalized ON public.admins (LOWER(TRIM(email)));

-- 3. Game Runtime Config (Legacy admin sync compatibility; player static config is local)
CREATE TABLE IF NOT EXISTS public.game_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Teams Roster (Email ID(s) -> Backend Team Name + TID + Security Key)
CREATE TABLE IF NOT EXISTS public.teams (
  tid TEXT PRIMARY KEY,
  team TEXT NOT NULL,
  email TEXT,
  emails TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  security_key TEXT NOT NULL DEFAULT '123',
  team_members TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teams_tid_upper ON public.teams (UPPER(tid));
CREATE INDEX IF NOT EXISTS idx_teams_email_lower ON public.teams (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_teams_emails_gin ON public.teams USING GIN (emails);

-- 5. Puzzles Catalog
CREATE TABLE IF NOT EXISTS public.puzzles (
  id INTEGER PRIMARY KEY CHECK (id >= 1),
  linkid TEXT NOT NULL UNIQUE,
  badge_id INTEGER,
  question_python TEXT NOT NULL DEFAULT '',
  question_cpp TEXT NOT NULL DEFAULT '',
  answer TEXT NOT NULL,
  next_puzzle_id INTEGER[] NOT NULL DEFAULT '{}'::INTEGER[],
  start_code TEXT,
  requires_start_code BOOLEAN NOT NULL DEFAULT FALSE,
  location_clue TEXT NOT NULL DEFAULT '',
  level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  points INTEGER NOT NULL DEFAULT 10 CHECK (points >= 0),
  hint TEXT,
  has_hint BOOLEAN NOT NULL DEFAULT FALSE,
  hint_penalty INTEGER NOT NULL DEFAULT 60 CHECK (hint_penalty >= 0),
  tab_switch_penalty_seconds INTEGER NOT NULL DEFAULT 15 CHECK (tab_switch_penalty_seconds >= 0),
  pokemon_id INTEGER NOT NULL DEFAULT 25,
  pokemon_name TEXT NOT NULL DEFAULT 'Pikachu',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.puzzles
  ADD COLUMN IF NOT EXISTS tab_switch_penalty_seconds INTEGER NOT NULL DEFAULT 15
  CHECK (tab_switch_penalty_seconds >= 0);

CREATE INDEX IF NOT EXISTS idx_puzzles_level_id ON public.puzzles (level, id);
CREATE INDEX IF NOT EXISTS idx_puzzles_linkid_upper ON public.puzzles (UPPER(linkid));
CREATE INDEX IF NOT EXISTS idx_puzzles_next_puzzle_gin ON public.puzzles USING GIN (next_puzzle_id);

-- 6. Memes Catalog
CREATE TABLE IF NOT EXISTS public.memes (
  memeid TEXT PRIMARY KEY,
  ytlink TEXT NOT NULL,
  starttime INTEGER NOT NULL DEFAULT 0 CHECK (starttime >= 0),
  endtime INTEGER NOT NULL DEFAULT 0 CHECK (endtime >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Persistent Team Registrations (Unique per Team + Epoch, Duplicate Prevention)
CREATE TABLE IF NOT EXISTS public.team_registrations (
  registration_id TEXT PRIMARY KEY,
  tid TEXT NOT NULL REFERENCES public.teams(tid) ON UPDATE CASCADE ON DELETE CASCADE,
  epoch INTEGER NOT NULL DEFAULT 1 CHECK (epoch >= 1),
  team_name TEXT NOT NULL,
  email TEXT NOT NULL,
  mission TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'PYTHON',
  session_id TEXT NOT NULL DEFAULT '',
  sync_status TEXT NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('synced')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_team_registrations_tid_epoch UNIQUE (tid, epoch)
);

CREATE INDEX IF NOT EXISTS idx_team_registrations_tid_epoch
  ON public.team_registrations (tid, epoch);
CREATE INDEX IF NOT EXISTS idx_team_registrations_email_lower
  ON public.team_registrations (LOWER(email));

-- 8. Live Team Progress State
CREATE TABLE IF NOT EXISTS public.team_progress (
  tid TEXT PRIMARY KEY,
  team_name TEXT NOT NULL,
  email TEXT,
  mission TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'PYTHON',
  session_id TEXT NOT NULL DEFAULT '',
  score INTEGER NOT NULL DEFAULT 0,
  solved INTEGER[] NOT NULL DEFAULT '{}'::INTEGER[],
  unlocked INTEGER[] NOT NULL DEFAULT '{}'::INTEGER[],
  hints_used INTEGER[] NOT NULL DEFAULT '{}'::INTEGER[],
  current_puzzle INTEGER NOT NULL DEFAULT 0,
  tab_switches INTEGER NOT NULL DEFAULT 0 CHECK (tab_switches >= 0),
  epoch INTEGER NOT NULL DEFAULT 1 CHECK (epoch >= 1),
  registered_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_progress_epoch_updated
  ON public.team_progress (epoch, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_team_progress_epoch_score
  ON public.team_progress (epoch, score DESC, updated_at ASC);

-- 9. Telemetry, Submissions & Summary Event Logs
CREATE TABLE IF NOT EXISTS public.puzzle_logs (
  id TEXT PRIMARY KEY,
  submission_id TEXT,
  action TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'L1',
  tid TEXT NOT NULL,
  team_name TEXT NOT NULL,
  email TEXT,
  mission TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'PYTHON',
  session_id TEXT NOT NULL DEFAULT '',
  puzzle_id INTEGER NOT NULL DEFAULT 0,
  linkid TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  wrong_attempts INTEGER NOT NULL DEFAULT 0,
  tab_switches INTEGER NOT NULL DEFAULT 0,
  hint_used BOOLEAN NOT NULL DEFAULT FALSE,
  scan_count INTEGER NOT NULL DEFAULT 0,
  points_earned INTEGER NOT NULL DEFAULT 0,
  points_lost INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  total_score INTEGER NOT NULL DEFAULT 0,
  unlocked_puzzles TEXT NOT NULL DEFAULT '',
  solved_puzzles TEXT NOT NULL DEFAULT '',
  epoch INTEGER NOT NULL DEFAULT 1,
  client_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  registered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.puzzle_logs
  ADD COLUMN IF NOT EXISTS submission_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_puzzle_logs_submission_id
  ON public.puzzle_logs (submission_id)
  WHERE submission_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_puzzle_logs_tid ON public.puzzle_logs (tid);
CREATE INDEX IF NOT EXISTS idx_puzzle_logs_tid_epoch_puzzle ON public.puzzle_logs (tid, epoch, puzzle_id);
CREATE INDEX IF NOT EXISTS idx_puzzle_logs_epoch_created ON public.puzzle_logs (epoch, created_at);
CREATE INDEX IF NOT EXISTS idx_puzzle_logs_epoch_last_active ON public.puzzle_logs (epoch, last_active);
CREATE INDEX IF NOT EXISTS idx_puzzle_logs_epoch_last_active_id ON public.puzzle_logs (epoch, last_active ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_puzzle_logs_epoch_action ON public.puzzle_logs (epoch, action);

-- ============================================================================
-- Authoritative Server-Side Validation & Bulk RPCs (SECURITY DEFINER)
-- ============================================================================

-- A. Server-side Team Authentication (never exposes full roster security keys)
CREATE OR REPLACE FUNCTION public.authenticate_team(
  p_email TEXT,
  p_security_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := LOWER(TRIM(COALESCE(p_email, '')));
  v_key TEXT := UPPER(TRIM(COALESCE(p_security_key, '')));
  v_team RECORD;
BEGIN
  IF v_email = '' OR v_key = '' THEN
    RETURN jsonb_build_object('authorized', FALSE, 'reason', 'MISSING_CREDENTIALS');
  END IF;

  -- Index-backed fast path first (hits idx_teams_email_lower & idx_teams_emails_gin)
  SELECT tid, team, email, emails, security_key
  INTO v_team
  FROM public.teams
  WHERE LOWER(email) = v_email
     OR emails @> ARRAY[v_email]
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT tid, team, email, emails, security_key
    INTO v_team
    FROM public.teams
    WHERE LOWER(TRIM(COALESCE(email, ''))) = v_email
       OR v_email = ANY (SELECT LOWER(TRIM(e)) FROM UNNEST(emails) AS e)
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('authorized', FALSE, 'reason', 'NOT_FOUND');
  END IF;

  IF UPPER(TRIM(COALESCE(v_team.security_key, ''))) <> v_key THEN
    RETURN jsonb_build_object('authorized', FALSE, 'reason', 'INVALID_KEY');
  END IF;

  RETURN jsonb_build_object(
    'authorized', TRUE,
    'tid', UPPER(TRIM(v_team.tid)),
    'team', TRIM(v_team.team),
    'email', v_email
  );
END;
$$;

-- B. Server-side Admin Credential Check (protects admins table from direct SELECT)
CREATE OR REPLACE FUNCTION public.verify_admin_login(
  p_email TEXT,
  p_password TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := LOWER(TRIM(COALESCE(p_email, '')));
  v_pass TEXT := TRIM(COALESCE(p_password, ''));
  v_match BOOLEAN := FALSE;
BEGIN
  IF v_email = '' OR v_pass = '' THEN
    RETURN FALSE;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.admins a
    WHERE LOWER(TRIM(a.email)) = v_email
      AND TRIM(a.password) = v_pass
  ) INTO v_match;

  RETURN v_match;
END;
$$;

-- C. Idempotent Registration Sync RPC
CREATE OR REPLACE FUNCTION public.sync_registration_record(
  p_registration_id TEXT,
  p_tid TEXT,
  p_team_name TEXT,
  p_email TEXT,
  p_mission TEXT,
  p_language TEXT,
  p_session_id TEXT,
  p_client_epoch INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tid TEXT := UPPER(TRIM(COALESCE(p_tid, '')));
  v_email TEXT := LOWER(TRIM(COALESCE(p_email, '')));
  v_reg_id TEXT := TRIM(COALESCE(p_registration_id, ''));
  v_remote_epoch INTEGER := 1;
  v_team_exists BOOLEAN := FALSE;
  v_prog RECORD;
  v_starter_unlocked INTEGER[];
BEGIN
  IF v_tid = '' THEN
    RAISE EXCEPTION 'Team ID is required';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.teams WHERE UPPER(tid) = v_tid) INTO v_team_exists;
  IF NOT v_team_exists THEN
    RAISE EXCEPTION 'Unauthorized team ID %', v_tid;
  END IF;

  SELECT COALESCE(epoch, 1) INTO v_remote_epoch FROM public.game_meta WHERE id = 1;
  v_remote_epoch := GREATEST(1, COALESCE(v_remote_epoch, 1));

  IF v_reg_id = '' THEN
    v_reg_id := 'reg_' || v_tid || '_ep' || v_remote_epoch::TEXT;
  END IF;

  INSERT INTO public.team_registrations (
    registration_id, tid, epoch, team_name, email, mission, language, session_id, sync_status, updated_at
  ) VALUES (
    v_reg_id, v_tid, v_remote_epoch, TRIM(p_team_name), v_email, TRIM(p_mission),
    UPPER(TRIM(COALESCE(p_language, 'PYTHON'))), TRIM(COALESCE(p_session_id, '')), 'synced', NOW()
  )
  ON CONFLICT (tid, epoch) DO UPDATE SET
    team_name = EXCLUDED.team_name,
    email = EXCLUDED.email,
    mission = EXCLUDED.mission,
    language = EXCLUDED.language,
    session_id = EXCLUDED.session_id,
    updated_at = NOW();

  SELECT * INTO v_prog FROM public.team_progress WHERE tid = v_tid;

  IF NOT FOUND OR COALESCE(v_prog.epoch, 1) <> v_remote_epoch THEN
    SELECT ARRAY(
      SELECT DISTINCT p.id
      FROM public.puzzles p
      WHERE p.requires_start_code = TRUE
         OR NOT EXISTS (
           SELECT 1
           FROM public.puzzles parent
           WHERE parent.id <> p.id
             AND p.id = ANY(parent.next_puzzle_id)
         )
      ORDER BY p.id
    ) INTO v_starter_unlocked;

    INSERT INTO public.team_progress (
      tid, team_name, email, mission, language, session_id,
      score, solved, unlocked, hints_used, current_puzzle, tab_switches,
      epoch, registered_at, updated_at
    ) VALUES (
      v_tid, TRIM(p_team_name), NULLIF(v_email, ''), TRIM(p_mission),
      CASE WHEN UPPER(TRIM(p_language)) IN ('CPP', 'C++') THEN 'C++' ELSE 'PYTHON' END,
      TRIM(COALESCE(p_session_id, '')),
      0, '{}'::INTEGER[], COALESCE(v_starter_unlocked, '{}'::INTEGER[]), '{}'::INTEGER[],
      0, 0, v_remote_epoch, NOW(), NOW()
    )
    ON CONFLICT (tid) DO UPDATE SET
      team_name = EXCLUDED.team_name,
      email = EXCLUDED.email,
      mission = EXCLUDED.mission,
      language = EXCLUDED.language,
      session_id = EXCLUDED.session_id,
      score = 0,
      solved = '{}'::INTEGER[],
      unlocked = EXCLUDED.unlocked,
      hints_used = '{}'::INTEGER[],
      current_puzzle = 0,
      tab_switches = 0,
      epoch = EXCLUDED.epoch,
      registered_at = COALESCE(public.team_progress.registered_at, NOW()),
      updated_at = NOW();
  ELSE
    UPDATE public.team_progress SET
      team_name = TRIM(p_team_name),
      email = NULLIF(v_email, ''),
      mission = TRIM(p_mission),
      language = CASE WHEN UPPER(TRIM(p_language)) IN ('CPP', 'C++') THEN 'C++' ELSE 'PYTHON' END,
      session_id = TRIM(COALESCE(p_session_id, '')),
      updated_at = NOW()
    WHERE tid = v_tid;
  END IF;

  SELECT * INTO v_prog FROM public.team_progress WHERE tid = v_tid;

  INSERT INTO public.puzzle_logs (
    id, submission_id, action, level, tid, team_name, email, mission, language,
    session_id, puzzle_id, linkid, status, total_score, unlocked_puzzles, solved_puzzles,
    epoch, client_timestamp, last_active, registered_at
  ) VALUES (
    'reg_' || v_tid,
    v_reg_id,
    'REGISTRATION',
    'REG',
    v_tid,
    TRIM(p_team_name),
    NULLIF(v_email, ''),
    TRIM(p_mission),
    CASE WHEN UPPER(TRIM(p_language)) IN ('CPP', 'C++') THEN 'C++' ELSE 'PYTHON' END,
    TRIM(COALESCE(p_session_id, '')),
    0,
    '',
    'REGISTERED',
    COALESCE(v_prog.score, 0),
    COALESCE(array_to_string(v_prog.unlocked, ','), ''),
    COALESCE(array_to_string(v_prog.solved, ','), ''),
    v_remote_epoch,
    NOW(),
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    team_name = EXCLUDED.team_name,
    email = EXCLUDED.email,
    mission = EXCLUDED.mission,
    language = EXCLUDED.language,
    session_id = EXCLUDED.session_id,
    epoch = EXCLUDED.epoch,
    last_active = NOW();

  RETURN jsonb_build_object(
    'ok', TRUE,
    'registration_id', v_reg_id,
    'epoch', v_remote_epoch,
    'teamState', jsonb_build_object(
      'score', v_prog.score,
      'solved', v_prog.solved,
      'unlocked', v_prog.unlocked,
      'hintsUsed', v_prog.hints_used,
      'tabSwitches', v_prog.tab_switches,
      'currentPuzzle', v_prog.current_puzzle
    )
  );
END;
$$;

-- D. Authorized Bulk Puzzle Catalog Retrieval (Selective Columns + Digests, No Plaintext Secrets)
CREATE OR REPLACE FUNCTION public.get_authorized_puzzle_catalog(
  p_tid TEXT,
  p_session_id TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tid TEXT := UPPER(TRIM(COALESCE(p_tid, '')));
  v_meta RECORD;
  v_puzzles JSONB;
  v_memes JSONB;
BEGIN
  IF v_tid <> '' THEN
    IF NOT EXISTS (SELECT 1 FROM public.teams WHERE UPPER(tid) = v_tid) THEN
      RAISE EXCEPTION 'Unauthorized team access';
    END IF;
  END IF;

  SELECT COALESCE(epoch, 1) AS epoch, COALESCE(catalog_version, 1) AS catalog_version
  INTO v_meta
  FROM public.game_meta
  WHERE id = 1;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'linkid', p.linkid,
        'badgeId', p.badge_id,
        'questionPython', p.question_python,
        'questionCpp', p.question_cpp,
        'nextPuzzleId', p.next_puzzle_id,
        'requiresStartCode', p.requires_start_code OR (COALESCE(TRIM(p.start_code), '') <> ''),
        'startCodeDigest', CASE
          WHEN COALESCE(TRIM(p.start_code), '') <> ''
          THEN encode(digest(UPPER(TRIM(p.start_code)), 'sha256'), 'hex')
          ELSE NULL
        END,
        'answerDigest', encode(digest(UPPER(TRIM(p.answer)), 'sha256'), 'hex'),
        'locationClue', p.location_clue,
        'level', p.level,
        'points', p.points,
        'hint', p.hint,
        'hasHint', p.has_hint,
        'hintPenalty', p.hint_penalty,
        'tabSwitchPenaltySeconds', p.tab_switch_penalty_seconds,
        'pokemonId', p.pokemon_id,
        'pokemonName', p.pokemon_name
      )
      ORDER BY p.id ASC
    ),
    '[]'::JSONB
  ) INTO v_puzzles
  FROM public.puzzles p;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'memeid', m.memeid,
        'ytlink', m.ytlink,
        'starttime', m.starttime,
        'endtime', m.endtime
      )
      ORDER BY m.memeid ASC
    ),
    '[]'::JSONB
  ) INTO v_memes
  FROM public.memes m;

  RETURN jsonb_build_object(
    'epoch', GREATEST(1, COALESCE(v_meta.epoch, 1)),
    'catalogVersion', GREATEST(1, COALESCE(v_meta.catalog_version, 1)),
    'puzzles', v_puzzles,
    'memes', v_memes
  );
END;
$$;

-- E. Bulk Authoritative Submission Sync RPC (Idempotent + Partial Batch Failure Support)
CREATE OR REPLACE FUNCTION public.sync_submission_batch(
  p_submissions JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_results JSONB := '[]'::JSONB;
  v_sub_id TEXT;
  v_tid TEXT;
  v_action TEXT;
  v_puzzle_id INTEGER;
  v_epoch INTEGER;
  v_puzzle RECORD;
  v_prog RECORD;
  v_submitted_answer TEXT;
  v_already_exists BOOLEAN;
  v_is_repeat BOOLEAN;
  v_points_delta INTEGER;
  v_next_solved INTEGER[];
  v_next_unlocked INTEGER[];
  v_next_hints INTEGER[];
  v_next_score INTEGER;
  v_starter_unlocked INTEGER[] := NULL;
  v_lvl_tag TEXT;
  v_anchor_id TEXT;
BEGIN
  IF p_submissions IS NULL OR jsonb_typeof(p_submissions) <> 'array' THEN
    RETURN '[]'::JSONB;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_submissions) LOOP
    v_sub_id := TRIM(COALESCE(v_item->>'submissionId', ''));
    v_tid := UPPER(TRIM(COALESCE(v_item->>'tid', '')));
    v_action := UPPER(TRIM(COALESCE(v_item->>'action', 'SOLVED')));
    v_puzzle_id := COALESCE((v_item->>'puzzleId')::INTEGER, 0);
    v_epoch := GREATEST(1, COALESCE((v_item->>'epoch')::INTEGER, 1));

    BEGIN
      IF v_sub_id = '' OR v_tid = '' THEN
        v_results := v_results || jsonb_build_object(
          'submissionId', v_sub_id, 'ok', FALSE, 'error', 'Missing submissionId or tid'
        );
        CONTINUE;
      END IF;

      -- Ownership validation
      IF NOT EXISTS (SELECT 1 FROM public.teams WHERE UPPER(tid) = v_tid) THEN
        v_results := v_results || jsonb_build_object(
          'submissionId', v_sub_id, 'ok', FALSE, 'error', 'Unknown team ID'
        );
        CONTINUE;
      END IF;

      -- Idempotency check
      SELECT EXISTS (
        SELECT 1 FROM public.puzzle_logs WHERE submission_id = v_sub_id
      ) INTO v_already_exists;

      IF v_already_exists THEN
        v_results := v_results || jsonb_build_object(
          'submissionId', v_sub_id, 'ok', TRUE, 'duplicate', TRUE
        );
        CONTINUE;
      END IF;

      IF v_action = 'SOLVED' THEN
        SELECT * INTO v_puzzle FROM public.puzzles WHERE id = v_puzzle_id;
        IF NOT FOUND THEN
          v_results := v_results || jsonb_build_object(
            'submissionId', v_sub_id, 'ok', FALSE, 'error', 'Puzzle not found'
          );
          CONTINUE;
        END IF;

        -- Server-side authoritative answer check when submittedAnswer is provided
        v_submitted_answer := UPPER(TRIM(COALESCE(v_item->>'submittedAnswer', '')));
        IF v_submitted_answer <> '' AND v_submitted_answer <> UPPER(TRIM(COALESCE(v_puzzle.answer, ''))) THEN
          v_results := v_results || jsonb_build_object(
            'submissionId', v_sub_id, 'ok', FALSE, 'error', 'Server answer verification failed'
          );
          CONTINUE;
        END IF;

        IF v_starter_unlocked IS NULL THEN
          SELECT ARRAY(
            SELECT DISTINCT p.id
            FROM public.puzzles p
            WHERE p.requires_start_code = TRUE
               OR NOT EXISTS (
                 SELECT 1 FROM public.puzzles parent
                 WHERE parent.id <> p.id AND p.id = ANY(parent.next_puzzle_id)
               )
            ORDER BY p.id
          ) INTO v_starter_unlocked;
        END IF;

        SELECT * INTO v_prog FROM public.team_progress WHERE tid = v_tid FOR UPDATE;
        v_is_repeat := COALESCE((v_item->>'repeat')::BOOLEAN, FALSE);
        IF FOUND AND COALESCE(v_prog.epoch, 1) = v_epoch THEN
          v_is_repeat := v_puzzle_id = ANY(v_prog.solved);
          v_next_solved := CASE
            WHEN v_is_repeat THEN v_prog.solved
            ELSE ARRAY(SELECT DISTINCT x FROM UNNEST(v_prog.solved || v_puzzle_id) AS x ORDER BY x)
          END;
          v_points_delta := CASE WHEN v_is_repeat THEN -GREATEST(0, v_puzzle.points) ELSE GREATEST(0, v_puzzle.points) END;
          v_next_score := GREATEST(0, COALESCE(v_prog.score, 0) + v_points_delta);
          v_next_hints := v_prog.hints_used;
        ELSE
          v_is_repeat := FALSE;
          v_next_solved := ARRAY[v_puzzle_id];
          v_points_delta := GREATEST(0, v_puzzle.points);
          v_next_score := v_points_delta;
          v_next_hints := '{}'::INTEGER[];
        END IF;

        SELECT ARRAY(
          SELECT DISTINCT u FROM (
            SELECT UNNEST(COALESCE(v_starter_unlocked, '{}'::INTEGER[])) AS u
            UNION
            SELECT UNNEST(p2.next_puzzle_id) AS u
            FROM public.puzzles p2
            WHERE p2.id = ANY(v_next_solved)
            UNION
            SELECT UNNEST(v_next_solved) AS u
          ) sub
          WHERE u IS NOT NULL AND u > 0
          ORDER BY u
        ) INTO v_next_unlocked;

        INSERT INTO public.team_progress (
          tid, team_name, mission, language, session_id, score, solved, unlocked,
          hints_used, current_puzzle, tab_switches, epoch, registered_at, updated_at
        ) VALUES (
          v_tid,
          COALESCE(v_item->>'teamName', v_tid),
          COALESCE(v_item->>'mission', ''),
          COALESCE(v_item->>'language', 'PYTHON'),
          COALESCE(v_item->>'sessionId', ''),
          v_next_score,
          v_next_solved,
          v_next_unlocked,
          COALESCE(v_next_hints, '{}'::INTEGER[]),
          v_puzzle_id,
          GREATEST(0, COALESCE((v_item->>'tabSwitchesTotal')::INTEGER, 0)),
          v_epoch,
          NOW(),
          NOW()
        )
        ON CONFLICT (tid) DO UPDATE SET
          team_name = EXCLUDED.team_name,
          mission = EXCLUDED.mission,
          language = EXCLUDED.language,
          session_id = EXCLUDED.session_id,
          score = v_next_score,
          solved = v_next_solved,
          unlocked = v_next_unlocked,
          current_puzzle = v_puzzle_id,
          tab_switches = GREATEST(public.team_progress.tab_switches, EXCLUDED.tab_switches),
          epoch = v_epoch,
          updated_at = NOW();

        v_lvl_tag := CASE
          WHEN v_puzzle.level = 2 THEN 'L2'
          WHEN v_puzzle.level = 3 THEN 'L3'
          ELSE 'L1'
        END;

        v_anchor_id := CASE
          WHEN v_is_repeat THEN v_lvl_tag || '_' || v_tid || '_P' || v_puzzle_id::TEXT || '_repeat_' || v_sub_id
          ELSE v_lvl_tag || '_' || v_tid || '_P' || v_puzzle_id::TEXT
        END;

        INSERT INTO public.puzzle_logs (
          id, submission_id, action, level, tid, team_name, mission, language, session_id,
          puzzle_id, linkid, status, wrong_attempts, tab_switches, hint_used, scan_count,
          points_earned, points_lost, points, total_score, unlocked_puzzles, solved_puzzles,
          epoch, client_timestamp, last_active, registered_at
        ) VALUES (
          v_anchor_id,
          v_sub_id,
          'SUMMARY',
          v_lvl_tag,
          v_tid,
          COALESCE(v_item->>'teamName', v_tid),
          COALESCE(v_item->>'mission', ''),
          COALESCE(v_item->>'language', 'PYTHON'),
          COALESCE(v_item->>'sessionId', ''),
          v_puzzle_id,
          COALESCE(v_puzzle.linkid, ''),
          CASE WHEN v_is_repeat THEN 'REPEAT_SOLVE' ELSE 'SOLVED' END,
          GREATEST(0, COALESCE((v_item->>'wrongAttempts')::INTEGER, 0)),
          GREATEST(0, COALESCE((v_item->>'tabSwitches')::INTEGER, 0)),
          COALESCE((v_item->>'hintUsed')::BOOLEAN, FALSE),
          GREATEST(0, COALESCE((v_item->>'scanCount')::INTEGER, 0)),
          CASE WHEN v_is_repeat THEN 0 ELSE GREATEST(0, v_puzzle.points) END,
          CASE WHEN v_is_repeat THEN GREATEST(0, v_puzzle.points) ELSE 0 END,
          v_points_delta,
          v_next_score,
          array_to_string(v_next_unlocked, ','),
          array_to_string(v_next_solved, ','),
          v_epoch,
          COALESCE((v_item->>'clientTimestamp')::TIMESTAMPTZ, NOW()),
          NOW(),
          NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          submission_id = EXCLUDED.submission_id,
          status = CASE
            WHEN public.puzzle_logs.status = 'SOLVED' AND EXCLUDED.status <> 'REPEAT_SOLVE' THEN 'SOLVED'
            ELSE EXCLUDED.status
          END,
          wrong_attempts = GREATEST(public.puzzle_logs.wrong_attempts, EXCLUDED.wrong_attempts),
          tab_switches = GREATEST(public.puzzle_logs.tab_switches, EXCLUDED.tab_switches),
          hint_used = public.puzzle_logs.hint_used OR EXCLUDED.hint_used,
          points_earned = GREATEST(public.puzzle_logs.points_earned, EXCLUDED.points_earned),
          points = CASE
            WHEN public.puzzle_logs.status = 'SOLVED' THEN public.puzzle_logs.points
            ELSE EXCLUDED.points
          END,
          total_score = GREATEST(public.puzzle_logs.total_score, EXCLUDED.total_score),
          unlocked_puzzles = EXCLUDED.unlocked_puzzles,
          solved_puzzles = EXCLUDED.solved_puzzles,
          last_active = NOW();

        v_results := v_results || jsonb_build_object(
          'submissionId', v_sub_id,
          'ok', TRUE,
          'duplicate', FALSE,
          'score', v_next_score,
          'solved', v_next_solved,
          'unlocked', v_next_unlocked
        );
      ELSE
        -- Telemetry / Penalty / Hint / Abandon event
        v_lvl_tag := COALESCE(NULLIF(UPPER(v_item->>'levelTag'), ''), 'L1');
        v_anchor_id := COALESCE(
          NULLIF(v_item->>'logId', ''),
          CASE WHEN v_puzzle_id > 0 THEN v_lvl_tag || '_' || v_tid || '_P' || v_puzzle_id::TEXT ELSE v_sub_id END
        );

        INSERT INTO public.puzzle_logs (
          id, submission_id, action, level, tid, team_name, mission, language, session_id,
          puzzle_id, linkid, status, wrong_attempts, tab_switches, hint_used, scan_count,
          total_score, unlocked_puzzles, epoch, client_timestamp, last_active, registered_at
        ) VALUES (
          v_anchor_id,
          v_sub_id,
          'SUMMARY',
          v_lvl_tag,
          v_tid,
          COALESCE(v_item->>'teamName', v_tid),
          COALESCE(v_item->>'mission', ''),
          COALESCE(v_item->>'language', 'PYTHON'),
          COALESCE(v_item->>'sessionId', ''),
          v_puzzle_id,
          COALESCE(v_item->>'linkid', ''),
          COALESCE(NULLIF(v_item->>'status', ''), 'UNSOLVED'),
          GREATEST(0, COALESCE((v_item->>'wrongAttempts')::INTEGER, 0)),
          GREATEST(0, COALESCE((v_item->>'tabSwitches')::INTEGER, 0)),
          COALESCE((v_item->>'hintUsed')::BOOLEAN, FALSE),
          GREATEST(0, COALESCE((v_item->>'scanCount')::INTEGER, 0)),
          GREATEST(0, COALESCE((v_item->>'totalScore')::INTEGER, 0)),
          COALESCE(v_item->>'unlockedPuzzles', ''),
          v_epoch,
          COALESCE((v_item->>'clientTimestamp')::TIMESTAMPTZ, NOW()),
          NOW(),
          NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          wrong_attempts = GREATEST(public.puzzle_logs.wrong_attempts, EXCLUDED.wrong_attempts),
          tab_switches = GREATEST(public.puzzle_logs.tab_switches, EXCLUDED.tab_switches),
          hint_used = public.puzzle_logs.hint_used OR EXCLUDED.hint_used,
          last_active = NOW();

        IF jsonb_typeof(v_item->'progressPatch') = 'object' THEN
          UPDATE public.team_progress SET
            tab_switches = GREATEST(
              tab_switches,
              COALESCE((v_item->'progressPatch'->>'tabSwitches')::INTEGER, tab_switches)
            ),
            hints_used = CASE
              WHEN jsonb_typeof(v_item->'progressPatch'->'hintsUsed') = 'array' THEN
                ARRAY(SELECT DISTINCT x::INTEGER FROM jsonb_array_elements_text(v_item->'progressPatch'->'hintsUsed') AS x)
              ELSE hints_used
            END,
            current_puzzle = COALESCE((v_item->'progressPatch'->>'currentPuzzle')::INTEGER, current_puzzle),
            updated_at = NOW()
          WHERE tid = v_tid;
        END IF;

        v_results := v_results || jsonb_build_object(
          'submissionId', v_sub_id, 'ok', TRUE, 'duplicate', FALSE
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_object(
        'submissionId', v_sub_id, 'ok', FALSE, 'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN v_results;
END;
$$;

-- F. Session-scoped Active Puzzle Heartbeat (replaces direct anon UPDATE on team_progress)
CREATE OR REPLACE FUNCTION public.set_team_current_puzzle(
  p_tid TEXT,
  p_session_id TEXT,
  p_puzzle_id INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tid TEXT := UPPER(TRIM(COALESCE(p_tid, '')));
  v_sid TEXT := TRIM(COALESCE(p_session_id, ''));
  v_pid INTEGER := GREATEST(0, COALESCE(p_puzzle_id, 0));
BEGIN
  IF v_tid = '' OR v_sid = '' THEN
    RETURN;
  END IF;
  UPDATE public.team_progress
  SET current_puzzle = v_pid, updated_at = NOW()
  WHERE tid = v_tid AND (session_id = '' OR session_id = v_sid);
END;
$$;

-- ============================================================================
-- G. Authenticated Admin RPCs (SECURITY DEFINER; allows full table RLS lockdown)
-- ============================================================================
CREATE OR REPLACE FUNCTION public._assert_admin(
  p_email TEXT,
  p_password TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.verify_admin_login(p_email, p_password) THEN
    RAISE EXCEPTION 'Unauthorized admin credentials';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_catalog(
  p_email TEXT,
  p_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta RECORD;
  v_teams JSONB;
  v_puzzles JSONB;
  v_memes JSONB;
BEGIN
  PERFORM public._assert_admin(p_email, p_password);

  SELECT COALESCE(epoch, 1) AS epoch, COALESCE(catalog_version, 1) AS catalog_version
  INTO v_meta
  FROM public.game_meta
  WHERE id = 1;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.tid ASC), '[]'::JSONB)
  INTO v_teams
  FROM public.teams t;

  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.id ASC), '[]'::JSONB)
  INTO v_puzzles
  FROM public.puzzles p;

  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.memeid ASC), '[]'::JSONB)
  INTO v_memes
  FROM public.memes m;

  RETURN jsonb_build_object(
    'epoch', GREATEST(1, COALESCE(v_meta.epoch, 1)),
    'catalogVersion', GREATEST(1, COALESCE(v_meta.catalog_version, 1)),
    'teams', v_teams,
    'puzzles', v_puzzles,
    'memes', v_memes
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_fetch_logs(
  p_email TEXT,
  p_password TEXT,
  p_since_iso TIMESTAMPTZ DEFAULT NULL,
  p_offset INTEGER DEFAULT 0,
  p_limit INTEGER DEFAULT 1000
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_epoch INTEGER := 1;
  v_offset INTEGER := GREATEST(0, COALESCE(p_offset, 0));
  v_limit INTEGER := LEAST(1000, GREATEST(1, COALESCE(p_limit, 1000)));
  v_progress JSONB := '[]'::JSONB;
  v_logs JSONB := '[]'::JSONB;
BEGIN
  PERFORM public._assert_admin(p_email, p_password);

  SELECT COALESCE(epoch, 1) INTO v_epoch FROM public.game_meta WHERE id = 1;
  v_epoch := GREATEST(1, COALESCE(v_epoch, 1));

  IF v_offset = 0 THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(tp) ORDER BY tp.updated_at DESC), '[]'::JSONB)
    INTO v_progress
    FROM (
      SELECT tid, team_name, email, mission, language, session_id, score, solved, unlocked,
             hints_used, current_puzzle, tab_switches, epoch, registered_at, updated_at
      FROM public.team_progress
      WHERE epoch = v_epoch
      ORDER BY updated_at DESC
      LIMIT 1000
    ) tp;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(pl)), '[]'::JSONB)
  INTO v_logs
  FROM (
    SELECT id, action, level, tid, team_name, email, mission, language, session_id,
           puzzle_id, linkid, status, wrong_attempts, tab_switches, hint_used, scan_count,
           points_earned, points_lost, points, total_score, unlocked_puzzles, solved_puzzles,
           client_timestamp, last_active, registered_at, created_at
    FROM public.puzzle_logs
    WHERE epoch = v_epoch
      AND (p_since_iso IS NULL OR last_active >= p_since_iso)
    ORDER BY last_active ASC, id ASC
    OFFSET v_offset
    LIMIT v_limit
  ) pl;

  RETURN jsonb_build_object(
    'epoch', v_epoch,
    'teamProgress', v_progress,
    'logs', v_logs
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._admin_bump_catalog_ver()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ver INTEGER;
BEGIN
  INSERT INTO public.game_meta (id, epoch, catalog_version, updated_at)
  VALUES (1, 1, 2, NOW())
  ON CONFLICT (id) DO UPDATE SET
    catalog_version = public.game_meta.catalog_version + 1,
    updated_at = NOW()
  RETURNING catalog_version INTO v_ver;
  RETURN COALESCE(v_ver, 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_teams(
  p_email TEXT,
  p_password TEXT,
  p_rows JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_tid TEXT;
  v_count INTEGER := 0;
BEGIN
  PERFORM public._assert_admin(p_email, p_password);
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN 0;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_tid := UPPER(TRIM(COALESCE(v_item->>'tid', '')));
    IF v_tid = '' THEN CONTINUE; END IF;
    INSERT INTO public.teams (tid, team, email, emails, security_key, team_members, updated_at)
    VALUES (
      v_tid,
      TRIM(COALESCE(v_item->>'team', '')),
      NULLIF(LOWER(TRIM(COALESCE(v_item->>'email', ''))), ''),
      ARRAY(SELECT LOWER(TRIM(x)) FROM jsonb_array_elements_text(COALESCE(v_item->'emails', '[]'::JSONB)) AS x WHERE TRIM(x) <> ''),
      TRIM(COALESCE(v_item->>'security_key', '123')),
      ARRAY(SELECT TRIM(x) FROM jsonb_array_elements_text(COALESCE(v_item->'team_members', '[]'::JSONB)) AS x WHERE TRIM(x) <> ''),
      NOW()
    )
    ON CONFLICT (tid) DO UPDATE SET
      team = EXCLUDED.team,
      email = EXCLUDED.email,
      emails = EXCLUDED.emails,
      security_key = EXCLUDED.security_key,
      team_members = EXCLUDED.team_members,
      updated_at = NOW();
    v_count := v_count + 1;
  END LOOP;

  PERFORM public._admin_bump_catalog_ver();
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_team(
  p_email TEXT,
  p_password TEXT,
  p_tid TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_admin(p_email, p_password);
  DELETE FROM public.teams WHERE UPPER(tid) = UPPER(TRIM(COALESCE(p_tid, '')));
  PERFORM public._admin_bump_catalog_ver();
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_memes(
  p_email TEXT,
  p_password TEXT,
  p_rows JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_memeid TEXT;
  v_count INTEGER := 0;
BEGIN
  PERFORM public._assert_admin(p_email, p_password);
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN 0;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_memeid := UPPER(TRIM(COALESCE(v_item->>'memeid', '')));
    IF v_memeid = '' THEN CONTINUE; END IF;
    INSERT INTO public.memes (memeid, ytlink, starttime, endtime, updated_at)
    VALUES (
      v_memeid,
      TRIM(COALESCE(v_item->>'ytlink', '')),
      GREATEST(0, COALESCE((v_item->>'starttime')::INTEGER, 0)),
      GREATEST(0, COALESCE((v_item->>'endtime')::INTEGER, 0)),
      NOW()
    )
    ON CONFLICT (memeid) DO UPDATE SET
      ytlink = EXCLUDED.ytlink,
      starttime = EXCLUDED.starttime,
      endtime = EXCLUDED.endtime,
      updated_at = NOW();
    v_count := v_count + 1;
  END LOOP;

  PERFORM public._admin_bump_catalog_ver();
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_meme(
  p_email TEXT,
  p_password TEXT,
  p_memeid TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_admin(p_email, p_password);
  DELETE FROM public.memes WHERE UPPER(memeid) = UPPER(TRIM(COALESCE(p_memeid, '')));
  PERFORM public._admin_bump_catalog_ver();
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_puzzles(
  p_email TEXT,
  p_password TEXT,
  p_rows JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_pid INTEGER;
  v_count INTEGER := 0;
BEGIN
  PERFORM public._assert_admin(p_email, p_password);
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN 0;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_pid := COALESCE((v_item->>'id')::INTEGER, 0);
    IF v_pid <= 0 THEN CONTINUE; END IF;
    INSERT INTO public.puzzles (
      id, linkid, badge_id, question_python, question_cpp, answer,
      next_puzzle_id, start_code, requires_start_code, location_clue,
      level, points, hint, has_hint, hint_penalty, tab_switch_penalty_seconds,
      pokemon_id, pokemon_name, updated_at
    ) VALUES (
      v_pid,
      UPPER(TRIM(COALESCE(v_item->>'linkid', ''))),
      NULLIF(COALESCE((v_item->>'badge_id')::INTEGER, 0), 0),
      COALESCE(v_item->>'question_python', ''),
      COALESCE(v_item->>'question_cpp', ''),
      COALESCE(v_item->>'answer', ''),
      ARRAY(SELECT x::INTEGER FROM jsonb_array_elements_text(COALESCE(v_item->'next_puzzle_id', '[]'::JSONB)) AS x WHERE x::INTEGER > 0),
      NULLIF(TRIM(COALESCE(v_item->>'start_code', '')), ''),
      COALESCE((v_item->>'requires_start_code')::BOOLEAN, FALSE),
      COALESCE(v_item->>'location_clue', ''),
      GREATEST(1, COALESCE((v_item->>'level')::INTEGER, 1)),
      GREATEST(0, COALESCE((v_item->>'points')::INTEGER, 10)),
      NULLIF(COALESCE(v_item->>'hint', ''), ''),
      COALESCE((v_item->>'has_hint')::BOOLEAN, FALSE),
      GREATEST(0, COALESCE((v_item->>'hint_penalty')::INTEGER, 60)),
      GREATEST(0, COALESCE((v_item->>'tab_switch_penalty_seconds')::INTEGER, 15)),
      GREATEST(0, COALESCE((v_item->>'pokemon_id')::INTEGER, 25)),
      COALESCE(NULLIF(TRIM(v_item->>'pokemon_name'), ''), 'Pikachu'),
      NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      linkid = EXCLUDED.linkid,
      badge_id = EXCLUDED.badge_id,
      question_python = EXCLUDED.question_python,
      question_cpp = EXCLUDED.question_cpp,
      answer = EXCLUDED.answer,
      next_puzzle_id = EXCLUDED.next_puzzle_id,
      start_code = EXCLUDED.start_code,
      requires_start_code = EXCLUDED.requires_start_code,
      location_clue = EXCLUDED.location_clue,
      level = EXCLUDED.level,
      points = EXCLUDED.points,
      hint = EXCLUDED.hint,
      has_hint = EXCLUDED.has_hint,
      hint_penalty = EXCLUDED.hint_penalty,
      tab_switch_penalty_seconds = EXCLUDED.tab_switch_penalty_seconds,
      pokemon_id = EXCLUDED.pokemon_id,
      pokemon_name = EXCLUDED.pokemon_name,
      updated_at = NOW();
    v_count := v_count + 1;
  END LOOP;

  PERFORM public._admin_bump_catalog_ver();
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_puzzle(
  p_email TEXT,
  p_password TEXT,
  p_id INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_admin(p_email, p_password);
  DELETE FROM public.puzzles WHERE id = p_id;
  PERFORM public._admin_bump_catalog_ver();
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reset_all_data(
  p_email TEXT,
  p_password TEXT,
  p_clear_catalog BOOLEAN DEFAULT FALSE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_epoch INTEGER;
BEGIN
  PERFORM public._assert_admin(p_email, p_password);

  -- This button clears the event log feed only. Registrations, scores,
  -- progress, catalog data, and the current epoch are preserved.
  DELETE FROM public.puzzle_logs;

  SELECT GREATEST(1, COALESCE(epoch, 1)) INTO v_epoch
  FROM public.game_meta WHERE id = 1;
  RETURN COALESCE(v_epoch, 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_new_start_solved_only(
  p_email TEXT,
  p_password TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_epoch INTEGER;
  v_starter_unlocked INTEGER[];
  v_unlocked_csv TEXT;
BEGIN
  PERFORM public._assert_admin(p_email, p_password);

  SELECT ARRAY(
    SELECT DISTINCT p.id
    FROM public.puzzles p
    WHERE p.requires_start_code = TRUE
       OR NOT EXISTS (
         SELECT 1 FROM public.puzzles parent
         WHERE parent.id <> p.id AND p.id = ANY(parent.next_puzzle_id)
       )
    ORDER BY p.id
  ) INTO v_starter_unlocked;

  v_starter_unlocked := COALESCE(v_starter_unlocked, '{}'::INTEGER[]);
  v_unlocked_csv := array_to_string(v_starter_unlocked, ',');

  INSERT INTO public.game_meta (id, epoch, catalog_version, updated_at)
  VALUES (1, 2, 1, NOW())
  ON CONFLICT (id) DO UPDATE SET
    epoch = LEAST(1000000, public.game_meta.epoch + 1),
    updated_at = NOW()
  RETURNING epoch INTO v_next_epoch;

  DELETE FROM public.puzzle_logs WHERE action <> 'REGISTRATION';

  UPDATE public.puzzle_logs SET
    epoch = v_next_epoch,
    total_score = 0,
    solved_puzzles = '',
    unlocked_puzzles = v_unlocked_csv,
    last_active = NOW()
  WHERE action = 'REGISTRATION';

  UPDATE public.team_progress SET
    score = 0,
    solved = '{}'::INTEGER[],
    unlocked = v_starter_unlocked,
    hints_used = '{}'::INTEGER[],
    current_puzzle = 0,
    tab_switches = 0,
    epoch = v_next_epoch,
    updated_at = NOW();

  RETURN COALESCE(v_next_epoch, 2);
END;
$$;

-- ============================================================================
-- Strict Row Level Security (RLS) Policies & Grants
-- Direct anon reads/writes to sensitive tables are revoked; clients communicate
-- strictly through SECURITY DEFINER RPCs above (plus read-only game_meta).
-- ============================================================================
ALTER TABLE public.game_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.puzzles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.puzzle_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon all admins" ON public.admins;
DROP POLICY IF EXISTS "Allow anon write game_meta" ON public.game_meta;
DROP POLICY IF EXISTS "Allow anon all game_config" ON public.game_config;
DROP POLICY IF EXISTS "Allow anon all teams" ON public.teams;
DROP POLICY IF EXISTS "Allow anon all puzzles" ON public.puzzles;
DROP POLICY IF EXISTS "Allow anon all memes" ON public.memes;
DROP POLICY IF EXISTS "Allow anon all team_registrations" ON public.team_registrations;
DROP POLICY IF EXISTS "Allow anon all team_progress" ON public.team_progress;
DROP POLICY IF EXISTS "Allow anon all puzzle_logs" ON public.puzzle_logs;

DROP POLICY IF EXISTS "Allow anon read game_meta" ON public.game_meta;
CREATE POLICY "Allow anon read game_meta" ON public.game_meta FOR SELECT TO anon, authenticated USING (true);

REVOKE ALL ON
  public.admins,
  public.game_meta,
  public.game_config,
  public.teams,
  public.puzzles,
  public.memes,
  public.team_registrations,
  public.team_progress,
  public.puzzle_logs
FROM anon, authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.game_meta TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION
  public._assert_admin(TEXT, TEXT),
  public._admin_bump_catalog_ver()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.authenticate_team(TEXT, TEXT),
  public.verify_admin_login(TEXT, TEXT),
  public.sync_registration_record(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER),
  public.get_authorized_puzzle_catalog(TEXT, TEXT),
  public.sync_submission_batch(JSONB),
  public.set_team_current_puzzle(TEXT, TEXT, INTEGER),
  public.admin_get_catalog(TEXT, TEXT),
  public.admin_fetch_logs(TEXT, TEXT, TIMESTAMPTZ, INTEGER, INTEGER),
  public.admin_upsert_teams(TEXT, TEXT, JSONB),
  public.admin_delete_team(TEXT, TEXT, TEXT),
  public.admin_upsert_memes(TEXT, TEXT, JSONB),
  public.admin_delete_meme(TEXT, TEXT, TEXT),
  public.admin_upsert_puzzles(TEXT, TEXT, JSONB),
  public.admin_delete_puzzle(TEXT, TEXT, INTEGER),
  public.admin_reset_all_data(TEXT, TEXT, BOOLEAN),
  public.admin_new_start_solved_only(TEXT, TEXT)
TO anon, authenticated;
