import React from 'react';
import { AppIcon } from './AppIcon';
import { playSound } from '../services/audio';
import { HINT_SETTINGS, type LanguageCode, type Puzzle } from '../types/game';

interface Step3PuzzleProps {
  active: boolean;
  puzzle: Puzzle | null;
  language: LanguageCode;
  questionText: string;
  puzzleStartMs: number;
  answerValue: string;
  onAnswerChange: (val: string) => void;
  onSubmitAnswer: (e: React.FormEvent) => void;
  shakeAnswer: boolean;
  answerInputRef: React.RefObject<HTMLInputElement | null>;
  hasHint: boolean;
  hintRequestOpen: boolean;
  hintPenaltyOpen: boolean;
  hintPenaltySeconds: number;
  hintPenaltyRingIteration: number;
  hintScreenActive?: boolean;
  hintFocusLost: boolean;
  hintDisplayOpen: boolean;
  hintText: string;
  onRequestHint: () => void;
  onConfirmHintRequest: () => void;
  onCancelHintRequest: () => void;
  onCloseHintPopup: () => void;
}

function formatMMSS(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const mins = Math.floor(safe / 60)
    .toString()
    .padStart(2, '0');
  const secs = (safe % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

export const Step3Puzzle: React.FC<Step3PuzzleProps> = ({
  active,
  puzzle,
  language,
  questionText,
  puzzleStartMs,
  answerValue,
  onAnswerChange,
  onSubmitAnswer,
  shakeAnswer,
  answerInputRef,
  hasHint,
  hintRequestOpen,
  hintPenaltyOpen,
  hintPenaltySeconds,
  hintPenaltyRingIteration,
  hintScreenActive = true,
  hintFocusLost,
  hintDisplayOpen,
  hintText,
  onRequestHint,
  onConfirmHintRequest,
  onCancelHintRequest,
  onCloseHintPopup,
}) => {
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);

  React.useEffect(() => {
    if (!active || !puzzle) {
      setElapsedSeconds(0);
      return;
    }
    const tick = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - puzzleStartMs) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [active, puzzle, puzzleStartMs]);
  const penaltyTotal =
    puzzle?.hintPenalty && puzzle.hintPenalty > 0
      ? puzzle.hintPenalty
      : HINT_SETTINGS.defaultPenalty;

  const anyHintOverlayVisible = hintRequestOpen || hintPenaltyOpen || hintDisplayOpen;

  return (
    <>
      <div id="step3" className={`flow-step${active ? ' active' : ''} h-full relative overflow-hidden`}>
        <div className="flex flex-col h-full relative z-10 p-2 sm:p-3 overflow-hidden">
          <div className="flex justify-between items-center mb-2 px-2 shrink-0 border-b border-green-500/30 pb-1.5 font-mono">
            <span className="text-green-500 text-xs sm:text-sm truncate pr-2"> &gt;_ TERMINAL</span>
            <span
              id="langBadge"
              className="text-[8px] sm:text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20 font-bold"
            >
              {language === 'CPP' ? 'C++' : 'PYTHON'}
            </span>
            <div className="flex items-center gap-2">
              <span id="puzzleTimer" className="text-green-500 text-xs sm:text-sm font-mono tabular-nums">
                {formatMMSS(elapsedSeconds)}
              </span>
            </div>
          </div>

          <div
            className={`code-terminal${active ? ' glow-active' : ''} flex-1 p-2 sm:p-3 mb-3 transition-all duration-200`}
          >
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0 opacity-40">
              <div className="cyber-pokeball">
                <div className="cyber-orbit"></div>
                <div id="step4Pokeball" className={`pixel-pokeball${puzzle ? '' : ' hidden'}`}>
                  <div className="pokeball-btn"></div>
                </div>
              </div>
            </div>

            <pre
              id="puzzleQuestion"
              className="flex-1 overflow-y-auto scrollable text-green-300 text-xs sm:text-sm leading-relaxed font-mono whitespace-pre-wrap break-words unselectable relative z-10 p-1"
            >
              {questionText || 'Loading puzzle data...'}
            </pre>
          </div>

          <form
            id="answerForm"
            onSubmit={onSubmitAnswer}
            className="shrink-0 w-full mt-auto transition-all duration-200"
          >
            <div className="flex flex-row sm:flex-row gap-2 sm:gap-3 items-stretch">
              <button
                type="button"
                id="hintRequestBtn"
                onClick={() => {
                  playSound('toggle', 0.25);
                  onRequestHint();
                }}
                className={`${
                  hasHint ? '' : 'hidden '
                }bg-yellow-500/10 border-2 border-yellow-500/50 rounded-xl flex items-center justify-center text-yellow-500 hover:bg-yellow-500/20 hover:text-yellow-400 active:bg-yellow-500/30 transition-colors relative z-20 cursor-pointer py-3 sm:py-0 min-h-[44px] min-w-[44px] order-1`}
              >
                <AppIcon name="lightbulb" className="text-lg sm:text-xl md:text-2xl" />
              </button>

              <div className="flex-1 min-w-0 order-2">
                <input
                  ref={answerInputRef}
                  type="text"
                  id="puzzleAnswer"
                  value={answerValue}
                  onChange={(e) => {
                    if (e.target.value !== answerValue) playSound('keystroke', 0.14);
                    onAnswerChange(e.target.value);
                  }}
                  className={`w-full h-full bg-[#070b14] border-2 border-gray-700 rounded-lg px-3 sm:px-4 py-3 text-white text-sm sm:text-base focus:border-green-500 outline-none uppercase min-h-[44px]${
                    shakeAnswer ? ' animate-shake' : ''
                  }`}
                  placeholder="ENTER SOLUTION"
                  autoComplete="off"
                  required
                  maxLength={50}
                  autoCapitalize="characters"
                />
              </div>

              <button
                type="submit"
                onClick={() => playSound('submit', 0.28)}
                className="btn-pokedex flex items-center justify-center min-h-[44px] min-w-[44px] order-3 py-3 sm:py-0"
              >
                <AppIcon name="send" className="text-lg sm:text-xl md:text-2xl" />
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Hint System Overlays */}
      <div id="hintContainer" className={anyHintOverlayVisible ? '' : 'hidden'}>
        {/* Hint Request Overlay */}
        <div
          id="hintRequestOverlay"
          className={`${
            hintRequestOpen ? '' : 'hidden '
          }absolute inset-0 z-[90] glass-panel flex flex-col items-center justify-center p-4`}
        >
          <div className="bg-[#111827] border-2 border-yellow-600/60 rounded-xl p-4 sm:p-5 w-full max-w-xs sm:max-w-sm text-center animate-fade-in">
            <AppIcon name="lightbulb" className="text-3xl text-yellow-500 sm:text-4xl md:text-5xl" />
            <h3 className="font-pixel text-yellow-500 text-sm sm:text-base my-3">Hint Request</h3>
            <p className="text-gray-400 text-xs sm:text-sm mb-4">
              Requires <span id="hintPenaltyTime" className="font-bold">{penaltyTotal}</span>s
              processing time. Stay on screen.
            </p>
            <div className="flex gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => {
                  playSound('ok', 0.26);
                  onConfirmHintRequest();
                }}
                className="bg-yellow-600 text-black font-bold flex-1 py-3 sm:py-4 rounded-lg text-sm sm:text-base hover:bg-yellow-700 transition-colors min-h-[44px]"
              >
                PROCEED
              </button>
              <button
                type="button"
                onClick={() => {
                  playSound('cancel', 0.24);
                  onCancelHintRequest();
                }}
                className="bg-gray-800 text-white flex-1 py-3 sm:py-4 rounded-lg text-sm sm:text-base hover:bg-gray-700 transition-colors min-h-[44px]"
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>

        {/* Unified Brock Hint Screen (Countdown -> Revealed Hint in-place, locked card & Brock image size) */}
        <div
          id="hintPenaltyOverlay"
          className={`${
            hintPenaltyOpen || hintDisplayOpen ? '' : 'hidden '
          }absolute inset-0 z-[95] flex flex-col items-center justify-center p-4 bg-[#0c111b]`}
        >
          <div className="text-center relative w-full max-w-xs sm:max-w-sm bg-[#111827] border-2 border-amber-500/50 rounded-xl p-5 sm:p-6 overflow-hidden animate-fade-in">
            <div className="absolute inset-0 bg-gradient-to-br from-[#1c1917] via-[#1b150c] to-[#111827] pointer-events-none">
              <div className="absolute inset-0 flex items-center justify-center opacity-15">
                <img
                  src="/assets/img/brock.png"
                  alt="Brock"
                  decoding="async"
                  className="h-[70%] max-h-64 object-contain opacity-90"
                />
              </div>
            </div>

            <div className="mb-4 sm:mb-6 relative z-10">
              <h2 className="font-pixel text-amber-400 text-base sm:text-lg uppercase tracking-widest mb-1.5">
                GYM TRAINING
              </h2>
              <p className="text-xs sm:text-sm text-gray-400 uppercase">Brock&apos;s Discipline</p>
            </div>

            {hintDisplayOpen ? (
              <div
                id="hintDisplay"
                className="relative w-full h-[clamp(110px,24vmin,176px)] mx-auto mb-4 sm:mb-5 z-10 rounded-lg bg-black/30 border border-amber-500/25 p-3 flex overflow-y-auto scrollable animate-fade-in"
              >
                <p
                  id="hintText"
                  className="my-auto w-full text-white text-sm sm:text-base font-mono leading-relaxed whitespace-pre-wrap break-words text-center"
                >
                  {hintText}
                </p>
              </div>
            ) : (
              <div className="relative w-[clamp(110px,24vmin,176px)] h-[clamp(110px,24vmin,176px)] mx-auto mb-4 sm:mb-5 z-10">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle
                    cx="50"
                    cy="50"
                    r="45"
                    stroke="rgba(245, 158, 11, 0.2)"
                    strokeWidth="4"
                    fill="none"
                  />
                  <circle
                    key={hintPenaltyRingIteration}
                    cx="50"
                    cy="50"
                    r="45"
                    stroke="rgb(245, 158, 11)"
                    strokeWidth="4"
                    fill="none"
                    className="hint-penalty-timer-ring"
                    strokeDasharray="283"
                    strokeDashoffset="283"
                    strokeLinecap="round"
                    style={
                      hintPenaltyOpen
                        ? {
                            animation: `hint-countdown ${penaltyTotal}s linear forwards`,
                            animationPlayState: hintScreenActive ? 'running' : 'paused',
                          }
                        : { animation: 'none' }
                    }
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div
                    className="font-pixel text-amber-300 text-[clamp(30px,7.5vmin,48px)] mb-1"
                    id="hintTimerDisplay"
                  >
                    {Math.max(0, hintPenaltySeconds)}
                  </div>
                  <span className="text-xs sm:text-sm text-amber-500/70 uppercase">Seconds</span>
                </div>
              </div>
            )}

            <div className="mb-4 relative z-10">
              <p className="text-amber-400 text-xs sm:text-sm uppercase mb-1.5">
                {hintDisplayOpen ? 'Hint Unlocked!' : 'Decrypting Hint...'}
              </p>
              <p className="text-xs text-gray-500">Stay focused on your training!</p>
            </div>

            <div
              id="hintWarningMessage"
              className={`${
                !hintDisplayOpen && hintFocusLost ? '' : 'hidden '
              }bg-red-900/40 border border-red-500/50 p-3 rounded-lg animate-shake mb-4 relative z-10`}
            >
              <div className="flex items-center justify-center gap-2">
                <AppIcon name="warning" className="text-sm text-red-400 sm:text-base" />
                <p className="text-red-400 text-xs sm:text-sm font-pixel uppercase">FOCUS LOST!</p>
              </div>
              <p className="text-red-300 text-xs mt-1" id="tabSwitchWarning">
                Tab switch detected! Timer reset.
              </p>
            </div>

            <div className="border-t border-amber-500/20 pt-3 relative z-10">
              <p className="text-[11px] text-amber-500/60 mb-3">&quot;Rock-solid focus wins battles.&quot;</p>
              <button
                type="button"
                onClick={() => {
                  playSound('cancel', 0.24);
                  if (hintDisplayOpen) {
                    onCloseHintPopup();
                  } else {
                    onCancelHintRequest();
                  }
                }}
                className="bg-yellow-600 text-black font-bold w-full py-3 sm:py-4 rounded-lg text-sm sm:text-base hover:bg-yellow-700 transition-colors min-h-[44px] cursor-pointer"
              >
                {hintDisplayOpen ? 'CLOSE' : 'CANCEL'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
