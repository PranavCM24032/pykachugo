# Pykachu Go

A Pokédex-styled interactive Python & C++ coding puzzle hunt built with **React 19**, **TypeScript**, **Tailwind CSS v4**, and **Vite**, structured cleanly in a **Three-Tier Architecture** with **Local Configuration**, **IndexedDB Local-First Persistence**, **Controlled Bulk Synchronization**, and **Supabase PostgreSQL**.

---

## Architecture Overview

1. **Local Static Configuration (`/data/config.json` + `/src/services/configService.ts`)**
   - Languages, mission sectors, mission groups, cache TTL/version, sync batching policies, and gameplay timers are loaded synchronously from local configuration at boot without Supabase network calls or credentials.
2. **Tier 1 — Presentation Layer (`src/App.tsx`, `src/components/*`)**
   - Pokédex CRT terminal, QR scanner, registration draft persistence, offline/sync status indicator, puzzle solver, 3D celebration, and Admin Command Node (`/admin`) with live presence (`ON_SCREEN` / `OUT_OF_SCREEN` / `OFFLINE`).
3. **Tier 2 — Application & Cache Service Layer (`src/services/*`)**
   - Persistent IndexedDB cache (`localCacheDb.ts`) for teams, puzzles, memes, registration drafts/status, team progress, and ordered submission outbox.
   - Cache-first QR/puzzle lookups from one bulk catalog retrieval; instant local-first puzzle solve persistence with controlled sequential bulk batch sync, partial-failure handling, duplicate prevention, and exponential backoff retries (`gameBackend.ts`).
4. **Tier 3 — Database Layer (`/supabase/schema.sql`, `/supabase/seed.sql`, `src/services/gameBackend.ts`)**
   - Normalized PostgreSQL schema with unique `submission_id` deduplication, targeted indexes, salted hashed admin credentials via `pgcrypto`, Row Level Security (RLS), and `SECURITY DEFINER` RPCs (`verify_admin_login`, `authenticate_team`, `validate_and_sync_submissions`).

---

## Setup & Commands

1. **Database Setup**: Run `/supabase/schema.sql` and `/supabase/seed.sql` in your Supabase SQL Editor.
2. **Environment**: Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. **Development & Verification**:
   ```bash
   npm install
   npm run dev    # Dev server on http://localhost:3000
   npm run lint   # TypeScript verification
   npm run build  # Production bundle in ./dist
   ```
