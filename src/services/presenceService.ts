import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabaseClient';

export type PlayerScreenState = 'ON_SCREEN' | 'OUT_OF_SCREEN';
export type TeamPresenceStatus = 'ON_SCREEN' | 'OUT_OF_SCREEN' | 'OFFLINE';

export interface PresenceSessionPayload {
  tid: string;
  teamName: string;
  sessionId: string;
  screenState: PlayerScreenState;
  step: string;
  updatedAt: number;
}

export interface TeamPresenceInfo {
  tid: string;
  teamName: string;
  screenState: PlayerScreenState;
  step: string;
  updatedAt: number;
  activeSessions: number;
}

export interface PlayerPresenceHandle {
  updateStep: (step: string) => void;
  stop: () => void;
}

const PRESENCE_CHANNEL_NAME = 'pykachu-live-presence-v1';
const LOCAL_BC_NAME = 'pykachu-live-presence-bc-v1';
const LOCAL_ENTRY_TTL_MS = 45000;

export function getCurrentScreenState(): PlayerScreenState {
  if (typeof document === 'undefined') return 'ON_SCREEN';
  if (document.hidden) return 'OUT_OF_SCREEN';
  if (typeof document.hasFocus === 'function' && !document.hasFocus()) {
    return 'OUT_OF_SCREEN';
  }
  return 'ON_SCREEN';
}

function normalizePresencePayload(raw: unknown): PresenceSessionPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const tid = String(obj.tid || '').trim().toUpperCase();
  const sessionId = String(obj.sessionId || '').trim();
  if (!tid || !sessionId) return null;
  const screenState: PlayerScreenState =
    obj.screenState === 'OUT_OF_SCREEN' ? 'OUT_OF_SCREEN' : 'ON_SCREEN';
  return {
    tid,
    teamName: String(obj.teamName || tid).trim(),
    sessionId,
    screenState,
    step: String(obj.step || '2'),
    updatedAt: Number(obj.updatedAt || Date.now()),
  };
}

/**
 * Starts real-time screen presence tracking for a logged-in team session.
 * Reports ON_SCREEN vs OUT_OF_SCREEN via Supabase Realtime Presence (zero DB writes)
 * plus BroadcastChannel for instant same-browser multi-tab visibility.
 */
export function startPlayerPresenceTracking(params: {
  tid: string;
  teamName: string;
  sessionId: string;
  initialStep: string;
}): PlayerPresenceHandle {
  const cleanTid = String(params.tid || '').trim().toUpperCase();
  const cleanTeam = String(params.teamName || cleanTid).trim();
  const cleanSession = String(params.sessionId || '').trim() || `sess_${Date.now()}`;
  const sessionKey = `${cleanTid}__${cleanSession}`;

  let stopped = false;
  let currentStep = String(params.initialStep || '2');
  let lastSentScreen: PlayerScreenState | null = null;
  let lastSentStep = '';
  let blurTimer: number | null = null;
  let channelSubscribed = false;

  const client =
    typeof navigator === 'undefined' || navigator.onLine !== false ? getSupabaseClient() : null;
  const channel: RealtimeChannel | null = client
    ? client.channel(PRESENCE_CHANNEL_NAME, {
        config: {
          presence: { key: sessionKey },
        },
      })
    : null;

  const bc =
    typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(LOCAL_BC_NAME) : null;

  const buildPayload = (screenState: PlayerScreenState): PresenceSessionPayload => ({
    tid: cleanTid,
    teamName: cleanTeam,
    sessionId: cleanSession,
    screenState,
    step: currentStep,
    updatedAt: Date.now(),
  });

  const publishPresence = (force = false) => {
    if (stopped || !cleanTid) return;
    const screenState = getCurrentScreenState();
    if (!force && screenState === lastSentScreen && currentStep === lastSentStep) {
      return;
    }
    lastSentScreen = screenState;
    lastSentStep = currentStep;
    const payload = buildPayload(screenState);

    if (channel && channelSubscribed) {
      void channel.track(payload).catch(() => {
        // ignore transient realtime track errors
      });
    }
    if (bc) {
      try {
        bc.postMessage({ type: 'UPSERT', sessionKey, payload });
      } catch {
        // ignore
      }
    }
  };

  if (channel) {
    channel.subscribe((status) => {
      if (stopped) return;
      if (status === 'SUBSCRIBED') {
        channelSubscribed = true;
        publishPresence(true);
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        channelSubscribed = false;
      }
    });
  }

  const onBcMessage = (ev: MessageEvent) => {
    if (stopped) return;
    const msg = ev.data as { type?: string } | null;
    if (msg?.type === 'REQUEST_SYNC') {
      publishPresence(true);
    }
  };
  if (bc) {
    bc.addEventListener('message', onBcMessage);
    publishPresence(true);
  }

  const clearBlurTimer = () => {
    if (blurTimer !== null) {
      window.clearTimeout(blurTimer);
      blurTimer = null;
    }
  };

  const onVisibilityChange = () => {
    clearBlurTimer();
    publishPresence(false);
  };

  const onFocusOrShow = () => {
    clearBlurTimer();
    publishPresence(false);
  };

  const onBlur = () => {
    clearBlurTimer();
    // Short debounce prevents internal UI/dialog focus shifts from flickering
    blurTimer = window.setTimeout(() => {
      blurTimer = null;
      publishPresence(false);
    }, 120);
  };

  const onOnline = () => {
    publishPresence(true);
  };

  const onPageHide = () => {
    clearBlurTimer();
    if (bc) {
      try {
        bc.postMessage({ type: 'LEAVE', sessionKey });
      } catch {
        // ignore
      }
    }
    if (channel && channelSubscribed) {
      void channel.untrack().catch(() => {});
    }
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('focus', onFocusOrShow);
  window.addEventListener('pageshow', onFocusOrShow);
  window.addEventListener('blur', onBlur);
  window.addEventListener('online', onOnline);
  window.addEventListener('pagehide', onPageHide);

  // Gentle local BroadcastChannel liveness refresh (every 20s) while tab is alive
  const keepaliveId = window.setInterval(() => {
    if (stopped || !bc) return;
    const payload = buildPayload(getCurrentScreenState());
    try {
      bc.postMessage({ type: 'UPSERT', sessionKey, payload });
    } catch {
      // ignore
    }
  }, 20000);

  return {
    updateStep: (nextStep: string) => {
      const normalized = String(nextStep || '2');
      if (normalized === currentStep) return;
      currentStep = normalized;
      publishPresence(true);
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearBlurTimer();
      window.clearInterval(keepaliveId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocusOrShow);
      window.removeEventListener('pageshow', onFocusOrShow);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pagehide', onPageHide);

      if (bc) {
        try {
          bc.postMessage({ type: 'LEAVE', sessionKey });
          bc.removeEventListener('message', onBcMessage);
          bc.close();
        } catch {
          // ignore
        }
      }
      if (channel && client) {
        void channel
          .untrack()
          .catch(() => {})
          .finally(() => {
            void client.removeChannel(channel).catch(() => {});
          });
      }
    },
  };
}

/**
 * Subscribes the Admin Dashboard to real-time team screen presence (observer-only).
 * Aggregates multiple tabs/sessions per team TID:
 * - ON_SCREEN if at least one active session has the app focused/visible
 * - OUT_OF_SCREEN if connected sessions exist but all are hidden/unfocused
 */
export function subscribeAdminPresence(
  onUpdate: (byTid: Record<string, TeamPresenceInfo>) => void
): () => void {
  let stopped = false;
  let rebuildTimer: number | null = null;

  const client = getSupabaseClient();
  const channel: RealtimeChannel | null = client ? client.channel(PRESENCE_CHANNEL_NAME) : null;
  const bc =
    typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(LOCAL_BC_NAME) : null;
  const localSessions = new Map<string, { payload: PresenceSessionPayload; seenAt: number }>();

  const computeAndEmit = () => {
    if (stopped) return;
    const mergedSessions = new Map<string, PresenceSessionPayload>();
    const now = Date.now();

    // 1. Collect live Supabase Realtime Presence sessions
    if (channel) {
      const state = channel.presenceState();
      Object.values(state).forEach((entries) => {
        if (!Array.isArray(entries)) return;
        entries.forEach((raw) => {
          const parsed = normalizePresencePayload(raw);
          if (!parsed) return;
          const sKey = `${parsed.tid}__${parsed.sessionId}`;
          const existing = mergedSessions.get(sKey);
          if (!existing || parsed.updatedAt >= existing.updatedAt) {
            mergedSessions.set(sKey, parsed);
          }
        });
      });
    }

    // 2. Merge fresh same-browser BroadcastChannel sessions (for local instant sync)
    for (const [sKey, entry] of localSessions.entries()) {
      if (now - entry.seenAt > LOCAL_ENTRY_TTL_MS) {
        localSessions.delete(sKey);
        continue;
      }
      const existing = mergedSessions.get(sKey);
      if (!existing || entry.payload.updatedAt > existing.updatedAt) {
        mergedSessions.set(sKey, entry.payload);
      }
    }

    // 3. Aggregate by team TID
    const byTid: Record<string, TeamPresenceInfo> = {};
    mergedSessions.forEach((sess) => {
      const prev = byTid[sess.tid];
      if (!prev) {
        byTid[sess.tid] = {
          tid: sess.tid,
          teamName: sess.teamName,
          screenState: sess.screenState,
          step: sess.step,
          updatedAt: sess.updatedAt,
          activeSessions: 1,
        };
        return;
      }
      prev.activeSessions += 1;
      // ON_SCREEN wins if any active session for this team is actively on screen
      if (sess.screenState === 'ON_SCREEN') {
        prev.screenState = 'ON_SCREEN';
      }
      if (sess.updatedAt >= prev.updatedAt) {
        prev.updatedAt = sess.updatedAt;
        prev.step = sess.step;
        if (sess.teamName) prev.teamName = sess.teamName;
      }
    });

    onUpdate(byTid);
  };

  const scheduleRebuild = () => {
    if (stopped || rebuildTimer !== null) return;
    rebuildTimer = window.setTimeout(() => {
      rebuildTimer = null;
      computeAndEmit();
    }, 150);
  };

  if (channel) {
    channel
      .on('presence', { event: 'sync' }, scheduleRebuild)
      .on('presence', { event: 'join' }, scheduleRebuild)
      .on('presence', { event: 'leave' }, scheduleRebuild)
      .subscribe((status) => {
        if (!stopped && status === 'SUBSCRIBED') {
          scheduleRebuild();
        }
      });
  }

  const onBcMessage = (ev: MessageEvent) => {
    if (stopped) return;
    const msg = ev.data as {
      type?: string;
      sessionKey?: string;
      payload?: unknown;
    } | null;
    if (!msg) return;
    if (msg.type === 'UPSERT' && msg.sessionKey) {
      const parsed = normalizePresencePayload(msg.payload);
      if (parsed) {
        localSessions.set(msg.sessionKey, { payload: parsed, seenAt: Date.now() });
        scheduleRebuild();
      }
    } else if (msg.type === 'LEAVE' && msg.sessionKey) {
      localSessions.delete(msg.sessionKey);
      scheduleRebuild();
    }
  };

  if (bc) {
    bc.addEventListener('message', onBcMessage);
    try {
      bc.postMessage({ type: 'REQUEST_SYNC' });
    } catch {
      // ignore
    }
  }

  // Prune expired local sessions periodically
  const pruneId = window.setInterval(() => {
    if (stopped || localSessions.size === 0) return;
    const now = Date.now();
    let changed = false;
    for (const [sKey, entry] of localSessions.entries()) {
      if (now - entry.seenAt > LOCAL_ENTRY_TTL_MS) {
        localSessions.delete(sKey);
        changed = true;
      }
    }
    if (changed) computeAndEmit();
  }, 15000);

  return () => {
    stopped = true;
    if (rebuildTimer !== null) {
      window.clearTimeout(rebuildTimer);
      rebuildTimer = null;
    }
    window.clearInterval(pruneId);
    if (bc) {
      try {
        bc.removeEventListener('message', onBcMessage);
        bc.close();
      } catch {
        // ignore
      }
    }
    if (channel && client) {
      void client.removeChannel(channel).catch(() => {});
    }
  };
}
