import React, { useCallback, useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { AppIcon } from './AppIcon';
import {
  getAudioContextTime,
  getCelebrationDuration,
  isAudioClockRunning,
  playFinalCelebration,
  playSound,
  speakCatch,
  stopCatchVoice,
} from '../services/audio';
import { getPokemonArtworkUrl } from '../services/gameBackend';
import type { Puzzle } from '../types/game';
import { Step4Stage3D, type RevealBeat } from './Step4Stage3D';

interface Step4SuccessProps {
  active: boolean;
  puzzle: Puzzle | null;
  nextPuzzles: Puzzle[];
  missionLevel: string;
  revealKey: number;
  isLoggedIn: boolean;
  celebrationCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  screenRef: React.RefObject<HTMLDivElement | null>;
  onContinueToQRScan: () => void;
}

const CELEBRATION_BLASTS = [
  0, 3.45, 3.94, 4.44, 4.93, 5.43, 5.93, 6.42, 7.41, 7.91, 8.41, 9.4, 10.39,
  10.89, 11.38, 11.88, 12.62, 13.37, 14.01, 14.85, 15.75,
];
const CELEBRATION_SPARKS = [
  0.48, 0.97, 1.48, 1.97, 2.95, 4.68, 6.91, 8.9, 9.89, 11.63, 12.15, 13.86,
  14.38, 16.21, 17.42,
];
const CELEBRATION_BLAST_X = [0.5, 0.2, 0.8];

export const Step4Success: React.FC<Step4SuccessProps> = ({
  active,
  puzzle,
  nextPuzzles,
  missionLevel,
  revealKey,
  isLoggedIn,
  celebrationCanvasRef,
  screenRef,
  onContinueToQRScan,
}) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const fallbackRafRef = useRef<number | null>(null);
  const confettiFnRef = useRef<ReturnType<typeof confetti.create> | null>(null);
  const confettiCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [imgSrc, setImgSrc] = useState<string>('/assets/img/pikachu.png');
  const [webglUnavailable, setWebglUnavailable] = useState(false);

  const isEnd =
    !puzzle ||
    !Array.isArray(puzzle.nextPuzzleId) ||
    puzzle.nextPuzzleId.length === 0;

  const levelNum =
    puzzle && typeof puzzle.level === 'number'
      ? puzzle.level
      : (missionLevel || 'L1').split('_')[0].replace('L', '') || '1';

  useEffect(() => {
    setImgSrc(getPokemonArtworkUrl(puzzle?.pokemonId));
  }, [puzzle?.pokemonId]);

  const triggerCelebration = useCallback(() => {
    const audioStart = playFinalCelebration(1);
    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    const canvas = celebrationCanvasRef.current;
    const screenEl = screenRef.current;
    if (!canvas || !screenEl) return;

    if (!confettiFnRef.current || confettiCanvasRef.current !== canvas) {
      canvas.width = screenEl.clientWidth;
      canvas.height = screenEl.clientHeight;
      confettiCanvasRef.current = canvas;
      confettiFnRef.current = confetti.create(canvas, {
        resize: true,
        useWorker: false,
      });
    }
    const myConfetti = confettiFnRef.current;

    const colors = [
      '#ff0000',
      '#3b82f6',
      '#ffd700',
      '#22c55e',
      '#a855f7',
      '#ffffff',
      '#f97316',
    ];

    let usingAudioClock =
      audioStart != null && isAudioClockRunning() && getAudioContextTime() != null;
    let audioBase = audioStart ?? 0;
    let wallBase = performance.now() / 1000;
    let lastAudioTime = usingAudioClock ? (getAudioContextTime() ?? 0) : 0;
    let lastAudioWallMove = performance.now();

    const getElapsed = () => {
      const nowWall = performance.now() / 1000;
      if (usingAudioClock) {
        const audioNow = getAudioContextTime();
        if (audioNow == null || !isAudioClockRunning()) {
          const frozenElapsed = Math.max(0, lastAudioTime - audioBase);
          usingAudioClock = false;
          wallBase = nowWall - frozenElapsed;
          return frozenElapsed;
        }
        if (audioNow > lastAudioTime + 0.001) {
          lastAudioTime = audioNow;
          lastAudioWallMove = performance.now();
        } else if (performance.now() - lastAudioWallMove > 220) {
          const currentElapsed = Math.max(0, audioNow - audioBase);
          usingAudioClock = false;
          wallBase = nowWall - currentElapsed;
          return currentElapsed;
        }
        return Math.max(0, audioNow - audioBase);
      }
      return Math.max(0, nowWall - wallBase);
    };

    const schedule: Array<[number, 'blast' | 'star']> = [];
    CELEBRATION_BLASTS.forEach((t) => schedule.push([t, 'blast']));
    CELEBRATION_SPARKS.forEach((t) => schedule.push([t, 'star']));
    schedule.sort((a, b) => a[0] - b[0]);

    const lastHit = schedule.length ? schedule[schedule.length - 1][0] : 0;
    const trackDur = getCelebrationDuration();
    let displayEnd = lastHit + 1.0;
    if (trackDur) displayEnd = Math.min(displayEnd, trackDur);

    const isLowSpecDevice =
      typeof navigator !== 'undefined' &&
      typeof navigator.hardwareConcurrency === 'number' &&
      navigator.hardwareConcurrency <= 4;
    const blastScale = isLowSpecDevice ? 0.6 : 1;

    const blastAt = (x: number) =>
      myConfetti({
        particleCount: Math.round(110 * blastScale),
        startVelocity: 44,
        spread: 86,
        origin: { x, y: 0.7 },
        colors,
        gravity: 1.2,
        ticks: 160,
      });

    const starAt = (x: number, y: number) =>
      myConfetti({
        particleCount: Math.round(32 * blastScale),
        spread: 95,
        origin: { x, y },
        shapes: ['star'],
        colors: ['#FFEAB0', '#FFF9E3', '#FACC15'],
        ticks: 140,
      });

    let si = 0;
    let blastCount = 0;
    let nextFountainAt = 0;

    const frame = () => {
      if (document.hidden) {
        rafRef.current = window.requestAnimationFrame(frame);
        return;
      }
      const elapsed = getElapsed();

      while (si < schedule.length && elapsed >= schedule[si][0]) {
        if (elapsed - schedule[si][0] <= 0.16) {
          if (schedule[si][1] === 'blast') {
            blastAt(CELEBRATION_BLAST_X[blastCount++ % CELEBRATION_BLAST_X.length]);
          } else {
            starAt(Math.random(), Math.random() - 0.2);
          }
        }
        si++;
      }

      if (elapsed < displayEnd) {
        if (elapsed >= nextFountainAt) {
          myConfetti({
            particleCount: 5,
            angle: 60,
            spread: 55,
            origin: { x: 0, y: 1 },
            colors,
          });
          myConfetti({
            particleCount: 5,
            angle: 120,
            spread: 55,
            origin: { x: 1, y: 1 },
            colors,
          });
          nextFountainAt = elapsed + 0.1;
        }
        rafRef.current = window.requestAnimationFrame(frame);
      } else {
        rafRef.current = null;
      }
    };

    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = window.requestAnimationFrame(frame);
  }, [celebrationCanvasRef, screenRef]);

  const handleRevealBeat = useCallback(
    (beat: RevealBeat) => {
      if (!active || !isLoggedIn || !puzzle) return;
      if (beat === 'drop1') {
        playSound('pokeballDrop', 0.48);
      } else if (beat === 'drop2') {
        playSound('pokeballDrop', 0.28);
      } else if (beat === 'open') {
        stageRef.current?.classList.add('is-open');
        playSound('pokeballOpen');
        if (isEnd) {
          triggerCelebration();
        }
      } else if (beat === 'emerge') {
        playSound('materialize', 0.22);
        speakCatch(puzzle.pokemonName || '', !isEnd);
      }
    },
    [active, isLoggedIn, puzzle, isEnd, triggerCelebration]
  );

  useEffect(() => {
    const clearAll = () => {
      if (fallbackRafRef.current !== null) {
        window.cancelAnimationFrame(fallbackRafRef.current);
        fallbackRafRef.current = null;
      }
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      stopCatchVoice();
      try {
        confettiFnRef.current?.reset();
      } catch {
        // ignore confetti reset error
      }
      if (stageRef.current) {
        stageRef.current.classList.remove('is-playing', 'is-open', 'is-bouncing');
      }
    };

    if (!active || !isLoggedIn || !puzzle) {
      clearAll();
      return;
    }

    clearAll();

    const stage = stageRef.current;
    if (!stage) return;

    let alive = true;
    const playRafId = window.requestAnimationFrame(() => {
      if (alive) stage.classList.add('is-playing');
    });

    // Visibility-paused monotonic fallback timeline ONLY when WebGL is unavailable
    if (webglUnavailable) {
      const prefersReducedMotion =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (prefersReducedMotion) {
        handleRevealBeat('open');
        handleRevealBeat('emerge');
      } else {
        const fired: Record<RevealBeat | 'bounce', boolean> = {
          drop1: false,
          drop2: false,
          open: false,
          emerge: false,
          bounce: false,
        };
        let startMs = performance.now();
        let hiddenStartedAt = document.hidden ? startMs : 0;

        const onVisibilityChange = () => {
          if (document.hidden) {
            hiddenStartedAt = performance.now();
          } else if (hiddenStartedAt > 0) {
            startMs += performance.now() - hiddenStartedAt;
            hiddenStartedAt = 0;
          }
        };
        document.addEventListener('visibilitychange', onVisibilityChange);

        const stepFallback = () => {
          if (!alive) return;
          if (!document.hidden) {
            const elapsed = (performance.now() - startMs) / 1000;
            if (!fired.drop1 && elapsed >= 0.65) {
              fired.drop1 = true;
              handleRevealBeat('drop1');
            }
            if (!fired.drop2 && elapsed >= 1.18) {
              fired.drop2 = true;
              handleRevealBeat('drop2');
            }
            if (!fired.open && elapsed >= 1.6) {
              fired.open = true;
              handleRevealBeat('open');
            }
            if (!fired.emerge && elapsed >= 1.74) {
              fired.emerge = true;
              handleRevealBeat('emerge');
            }
            if (!fired.bounce && elapsed >= 2.82) {
              fired.bounce = true;
              stageRef.current?.classList.add('is-bouncing');
              return;
            }
          }
          fallbackRafRef.current = window.requestAnimationFrame(stepFallback);
        };
        fallbackRafRef.current = window.requestAnimationFrame(stepFallback);

        return () => {
          alive = false;
          document.removeEventListener('visibilitychange', onVisibilityChange);
          window.cancelAnimationFrame(playRafId);
          clearAll();
        };
      }
    }

    return () => {
      alive = false;
      window.cancelAnimationFrame(playRafId);
      clearAll();
    };
  }, [active, isLoggedIn, puzzle, revealKey, webglUnavailable, handleRevealBeat]);

  const handleImgError = () => {
    if (imgSrc !== '/assets/img/pikachu.png') {
      setImgSrc('/assets/img/pikachu.png');
    }
  };

  return (
    <>
      <div
        id="step4"
        className={`flow-step${active ? ' active' : ''} relative flex-1 min-h-0 h-full overflow-y-auto overflow-x-hidden`}
      >
        <div className="step4-success-layout relative flex min-h-full flex-col items-center justify-center gap-2.5 sm:gap-3 px-3 py-2 text-center sm:px-6 sm:py-3">
          {/* Background Sparkle & Halo Overlay (GPU-composited) */}
          <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
            <div className="perfect-sparkle sparkle-gold absolute left-[8%] top-[10%] size-1.5 animate-twinkle [animation-duration:2.1s]"></div>
            <div className="perfect-sparkle sparkle-blue absolute left-[22%] top-[7%] size-1 animate-twinkle [animation-delay:280ms] [animation-duration:2.4s]"></div>
            <div className="perfect-sparkle sparkle-white absolute left-[42%] top-[12%] size-1 animate-twinkle [animation-delay:620ms] [animation-duration:2.2s]"></div>
            <div className="perfect-sparkle sparkle-purple absolute right-[28%] top-[8%] size-1.5 animate-twinkle [animation-delay:410ms] [animation-duration:2.6s]"></div>
            <div className="perfect-sparkle sparkle-gold absolute right-[9%] top-[13%] size-1.5 animate-twinkle [animation-delay:140ms] [animation-duration:2.0s]"></div>

            <div className="perfect-sparkle sparkle-blue absolute left-[6%] top-[28%] size-1.5 animate-twinkle [animation-delay:850ms] [animation-duration:2.3s]"></div>
            <div className="perfect-sparkle sparkle-white absolute left-[16%] top-[22%] size-1 animate-twinkle [animation-delay:120ms] [animation-duration:1.9s]"></div>
            <div className="perfect-sparkle sparkle-gold absolute right-[15%] top-[23%] size-1 animate-twinkle [animation-delay:520ms] [animation-duration:2.1s]"></div>
            <div className="perfect-sparkle sparkle-white absolute right-[6%] top-[32%] size-1.5 animate-twinkle [animation-delay:950ms] [animation-duration:2.5s]"></div>

            <div className="perfect-sparkle sparkle-purple absolute left-[7%] top-[48%] size-1 animate-twinkle [animation-delay:330ms] [animation-duration:2.4s]"></div>
            <div className="perfect-sparkle sparkle-blue absolute right-[7%] top-[46%] size-1.5 animate-twinkle [animation-delay:740ms] [animation-duration:2.2s]"></div>

            <div className="perfect-sparkle sparkle-blue absolute bottom-[34%] left-[10%] size-1.5 animate-twinkle [animation-delay:690ms] [animation-duration:2.5s]"></div>
            <div className="perfect-sparkle sparkle-gold absolute bottom-[36%] right-[11%] size-1.5 animate-twinkle [animation-delay:1050ms] [animation-duration:2.2s]"></div>

            <div className="perfect-sparkle sparkle-white absolute bottom-[22%] left-[18%] size-1 animate-twinkle [animation-delay:440ms] [animation-duration:2.1s]"></div>
            <div className="perfect-sparkle sparkle-purple absolute bottom-[18%] right-[19%] size-1 animate-twinkle [animation-delay:1250ms] [animation-duration:2.7s]"></div>
            <div className="perfect-sparkle sparkle-gold absolute bottom-[11%] left-[10%] size-1.5 animate-twinkle [animation-delay:200ms] [animation-duration:2.3s]"></div>
            <div className="perfect-sparkle sparkle-blue absolute bottom-[10%] left-[32%] size-1 animate-twinkle [animation-delay:1450ms] [animation-duration:2.5s]"></div>
            <div className="perfect-sparkle sparkle-gold absolute bottom-[11%] right-[10%] size-1.5 animate-twinkle [animation-delay:880ms] [animation-duration:2.4s]"></div>

            <div className="absolute left-1/2 top-1/2 size-48 sm:size-64 -translate-x-1/2 -translate-y-1/2 rounded-full border border-yellow-400/15 animate-spin-slow"></div>
            <div className="absolute left-1/2 top-1/2 size-56 sm:size-72 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-full border border-blue-400/12 animate-spin-slow [animation-direction:reverse] [animation-duration:15s]"></div>
          </div>

          {/* Pokémon Stage Container */}
          <div className="step4-pokemon-stage relative z-10 flex w-full shrink-0 flex-col items-center justify-center">
            <div ref={stageRef} id="pokemonReveal" className="pokemon-reveal relative z-10 shrink-0">
              {active && isLoggedIn && Boolean(puzzle) && !webglUnavailable && (
                <Step4Stage3D
                  active
                  revealKey={revealKey}
                  pokemonImgSrc={imgSrc}
                  onRevealBeat={handleRevealBeat}
                  onWebGLUnavailable={() => setWebglUnavailable(true)}
                  onBouncingChange={(bouncing) => {
                    stageRef.current?.classList.toggle('is-bouncing', bouncing);
                  }}
                />
              )}

              {webglUnavailable && (
                <>
                  <div className="pk-platform" aria-hidden="true">
                    <div className="pk-ring pk-ring-outer"></div>
                    <div className="pk-ring pk-ring-mid"></div>
                    <div className="pk-ring pk-ring-core"></div>
                  </div>
                  <div className="pk-shadow" aria-hidden="true"></div>
                  <div className="pk-ball" aria-hidden="true">
                    <div className="pk-half pk-top">
                      <div className="pk-gloss"></div>
                    </div>
                    <div className="pk-half pk-bottom"></div>
                    <div className="pk-band"></div>
                    <div className="pk-btn"></div>
                    <div className="pk-shade"></div>
                  </div>
                </>
              )}

              <div className="pk-shockwave"></div>

              <div className="pk-pop">
                <img
                  id="caughtPokemonSilhouette"
                  src={imgSrc}
                  crossOrigin={/^https?:\/\//i.test(imgSrc) ? 'anonymous' : undefined}
                  onError={handleImgError}
                  className="pk-silhouette"
                  alt=""
                  aria-hidden="true"
                  decoding="async"
                />
                <div className="pk-bounce-wrap">
                  <img
                    id="caughtPokemonImg"
                    src={imgSrc}
                    crossOrigin={/^https?:\/\//i.test(imgSrc) ? 'anonymous' : undefined}
                    onError={handleImgError}
                    className="pk-sprite"
                    alt="Caught Pokémon"
                    decoding="async"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Main Content Section */}
          <div className="step4-success-content z-10 flex w-full shrink-0 flex-col items-center gap-3 px-2">
            <h2 className="font-pixel text-xs sm:text-sm tracking-wider text-green-400 uppercase drop-shadow">
              Decryption Successful
            </h2>

            {/* Single Destination Card */}
            <div
              id="locationCard"
              className={`${
                nextPuzzles.length === 1 ? '' : 'hidden '
              }location-card-glow relative w-full max-w-xs rounded-xl border border-yellow-500/50 bg-[#111827] p-3 shadow-2xl`}
            >
              <div className="map-grid-bg absolute inset-0 opacity-20"></div>
              <div className="absolute left-0 top-0 size-2.5 rounded-tl-lg border-l-2 border-t-2 border-yellow-400/60"></div>
              <div className="absolute right-0 top-0 size-2.5 rounded-tr-lg border-r-2 border-t-2 border-yellow-400/60"></div>
              <div className="absolute bottom-0 left-0 size-2.5 rounded-bl-lg border-b-2 border-l-2 border-yellow-400/60"></div>
              <div className="absolute bottom-0 right-0 size-2.5 rounded-br-lg border-b-2 border-r-2 border-yellow-400/60"></div>

              <div className="relative z-10 flex items-center gap-3">
                <div className="flex w-7 h-7 sm:w-9 sm:h-9 shrink-0 items-center justify-center rounded-lg border border-yellow-500/30 bg-yellow-500/20">
                  <AppIcon name="location_on" className="text-base text-yellow-400 sm:text-xl" />
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <span className="block text-[9px] font-black tracking-widest text-yellow-400/80 uppercase">
                    Signal Source
                  </span>
                  <p
                    id="locationClueText"
                    className={`${
                      nextPuzzles.length === 1 ? '' : 'hidden '
                    }font-pixel mt-0.5 text-xs sm:text-sm text-white leading-tight break-words`}
                  >
                    {nextPuzzles[0]?.locationClue || 'NO SIGNAL SOURCE'}
                  </p>
                </div>
              </div>
            </div>

            {/* Branching Multiple Destinations */}
            <div
              id="nextLocationList"
              className={`${
                nextPuzzles.length > 1 ? '' : 'hidden '
              }flex w-full flex-col items-center gap-2`}
            >
              {nextPuzzles.map((np) => (
                <div
                  key={np.id}
                  className="bg-[#111827] border border-yellow-500/50 rounded-xl p-2.5 sm:p-3 relative overflow-hidden location-card-glow shadow-2xl mx-auto w-full max-w-xs"
                >
                  <div className="absolute inset-0 map-grid-bg opacity-20"></div>
                  <div className="absolute top-0 left-0 w-2.5 h-2.5 border-t-2 border-l-2 border-yellow-400/50 rounded-tl-lg"></div>
                  <div className="absolute top-0 right-0 w-2.5 h-2.5 border-t-2 border-r-2 border-yellow-400/50 rounded-tr-lg"></div>
                  <div className="absolute bottom-0 left-0 w-2.5 h-2.5 border-b-2 border-l-2 border-yellow-400/50 rounded-bl-lg"></div>
                  <div className="absolute bottom-0 right-0 w-2.5 h-2.5 border-b-2 border-r-2 border-yellow-400/50 rounded-br-lg"></div>

                  <div className="flex items-center gap-2.5 relative z-10">
                    <div className="flex-shrink-0">
                      <div className="w-7 h-7 sm:w-9 sm:h-9 bg-yellow-500/20 rounded-lg flex items-center justify-center border border-yellow-500/30">
                        <AppIcon name="location_on" className="text-base text-yellow-400 sm:text-xl" />
                      </div>
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <span className="text-yellow-400/80 text-[8px] sm:text-[9px] uppercase tracking-widest font-black block">
                        NEXT LOCATION
                      </span>
                      <p className="font-pixel text-white leading-tight break-words mt-0.5 text-xs sm:text-sm">
                        {(np.locationClue || 'NO SIGNAL SOURCE').toUpperCase()}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Completion Trophy Card */}
          <div
            id="completionMessage"
            className={`${isEnd ? '' : 'hidden '}z-20 w-full max-w-xs animate-fade-in`}
          >
            <div className="relative overflow-hidden rounded-xl border border-yellow-500/60 bg-[#070b14]/92 ring-1 ring-inset ring-white/10 p-4 shadow-[0_0_25px_rgba(234,179,8,0.35)]">
              <div className="flex flex-col items-center text-center">
                <div className="relative mb-2 flex size-14 sm:size-20 md:size-[88px] items-center justify-center">
                  <div className="absolute inset-0 rounded-full bg-yellow-400/15"></div>
                  <img
                    id="completionTrophyImg"
                    src="/assets/img/poketropy.png"
                    alt="Level Trophy"
                    width={80}
                    height={80}
                    decoding="async"
                    className="relative z-10 size-full object-contain drop-shadow-[0_0_15px_rgba(234,179,8,0.8)]"
                  />
                  <div className="gemini-shine shine-1"></div>
                  <div className="gemini-shine shine-2"></div>
                  <div className="gemini-shine shine-3"></div>
                  <div className="gemini-shine shine-4"></div>
                  <div className="gemini-shine shine-5"></div>
                  <div className="gemini-shine shine-6"></div>
                </div>

                <h3
                  id="completionLevelTitle"
                  className="font-pixel text-xs sm:text-sm tracking-tight text-yellow-300 uppercase"
                >
                  LEVEL {levelNum} CHAMPION
                </h3>
                <p
                  id="completionLevelSub"
                  className="mt-0.5 text-[9px] sm:text-[10px] font-black tracking-widest text-blue-200 uppercase"
                >
                  YOU HAVE COMPLETED LEVEL {levelNum}
                </p>

                <div className="mt-3 flex gap-1.5">
                  <div className="size-1.5 rounded-full bg-yellow-400"></div>
                  <div className="size-1.5 rounded-full bg-blue-400"></div>
                  <div className="size-1.5 rounded-full bg-yellow-400"></div>
                </div>
              </div>
            </div>
          </div>

          {/* Primary Call To Action */}
          <button
            type="button"
            id="nextSignalBtn"
            onClick={() => {
              playSound('ok', 0.28);
              onContinueToQRScan();
            }}
            className={`${
              isEnd ? 'hidden ' : ''
            }btn-pokedex relative z-10 w-full max-w-xs shrink-0 py-3 font-pixel text-xs sm:text-sm tracking-wider uppercase transition-transform active:scale-95`}
          >
            Scan Next Signal
          </button>
        </div>
      </div>
    </>
  );
};
