import React from 'react';
import { AppIcon } from './AppIcon';

interface PenaltyOverlayProps {
  visible: boolean;
  seconds: number;
  totalSeconds?: number;
  ringIteration: number;
  screenActive: boolean;
  resetCount: number;
  onInteract?: () => void;
}

export const PenaltyOverlay: React.FC<PenaltyOverlayProps> = ({
  visible,
  seconds,
  totalSeconds = 15,
  ringIteration,
  screenActive,
  resetCount,
  onInteract,
}) => {
  const safeDuration = Math.max(1, Math.floor(totalSeconds || 15));
  return (
    <div
      id="penaltyOverlay"
      onPointerDown={onInteract}
      className={`${visible ? '' : 'hidden '}absolute inset-0 z-[150] flex items-center justify-center p-4 sm:p-6 bg-[#060913]/92`}
    >
      <div className="relative w-[86%] max-w-[360px] h-[75%] min-h-[340px] max-h-[86%] rounded-2xl border-2 border-transparent p-4 sm:p-6 bg-[#0b101b]/95 shadow-2xl overflow-hidden flex flex-col items-center justify-center text-center z-10 animate-fade-in">
        <div className="absolute inset-4 sm:inset-5 flex items-center justify-center pointer-events-none z-0">
          <img
            src="/assets/img/jenny.png"
            alt="Officer Jenny"
            decoding="async"
            className="w-full h-full object-contain opacity-25"
          />
        </div>

        <div className="relative z-10 w-full max-h-full overflow-y-auto scrollable flex flex-col items-center justify-center">
          <div className="relative w-[clamp(104px,22vmin,158px)] h-[clamp(104px,22vmin,158px)] mx-auto shrink-0">
            <svg className="w-full h-full -rotate-90 absolute top-0 left-0" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="45" stroke="rgba(120, 120, 120, 0.35)" strokeWidth="4" fill="none" />
              <circle
                key={ringIteration}
                cx="50"
                cy="50"
                r="45"
                stroke="rgb(239, 68, 68)"
                strokeWidth="4"
                fill="none"
                strokeLinecap="round"
                strokeDasharray="283"
                strokeDashoffset="283"
                className="penalty-timer-ring"
                style={
                  visible
                    ? {
                        animation: `countdown ${safeDuration}s linear forwards`,
                        animationPlayState: screenActive ? 'running' : 'paused',
                      }
                    : { animation: 'none' }
                }
              />
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="font-mono text-[clamp(32px,7.5vmin,52px)] text-white font-bold tabular-nums" id="penaltyTimer">
                {Math.max(0, seconds)}
              </div>
              <span className="text-xs sm:text-sm text-red-300 font-pixel uppercase mt-1">Seconds</span>
            </div>
          </div>

          <h1 className="font-pixel text-red-300 text-sm sm:text-base uppercase mt-3 sm:mt-4 tracking-widest">
            MALPRACTICE DETECTED
          </h1>
          <div className="flex items-center justify-center gap-2 mt-1">
            <AppIcon name="security" className="text-sm text-red-400 sm:text-base" />
            <p className="text-xs sm:text-sm text-gray-300 uppercase">Authority Alert</p>
            <AppIcon name="policy" className="text-sm text-red-400 sm:text-base" />
          </div>

          {resetCount > 0 && (
            <div
              key={`reset-${resetCount}`}
              className="mt-3 w-full rounded-lg border border-red-500/70 bg-[#2a0b0e] px-2.5 py-2 text-center animate-shake"
            >
              <p className="font-pixel text-[9px] sm:text-[10px] text-red-300 uppercase">
                Tab switch during penalty!
              </p>
              <p className="text-[11px] text-red-200 mt-0.5">
                Penalty added again &amp; timer reset to {safeDuration}s
              </p>
            </div>
          )}

          {!screenActive && visible && (
            <p className="mt-2.5 text-[10px] sm:text-xs font-mono text-amber-300 uppercase tracking-wide">
              Timer paused — stay on this active screen
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
