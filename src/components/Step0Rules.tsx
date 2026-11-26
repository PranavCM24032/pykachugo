import React from 'react';
import { playSound } from '../services/audio';
import { AppIcon } from './AppIcon';

interface Step0RulesProps {
  active: boolean;
  onAccept: () => void;
}

export const Step0Rules: React.FC<Step0RulesProps> = ({ active, onAccept }) => {
  return (
    <div id="step0" className={`flow-step${active ? ' active' : ''} h-full`}>
      <div className="min-h-full w-full flex flex-col justify-center items-center gap-3 p-2.5 sm:p-4 text-center">
        <div className="briefing-container shrink-0">
          <div className="rules-board blackboard w-full mx-auto">
            <p className="rules-content text-[11px] sm:text-xs leading-relaxed text-left space-y-2 text-slate-100">
              <span className="rules-title block mb-1.5 font-bold text-center pb-1">
                Oak’s Master Rules
              </span>
              <span className="flex items-start gap-1.5">
                <span className="chalk-bullet">1.</span>
                <span>No tab switching. (Jenny&apos;s watching!)</span>
              </span>
              <span className="flex items-start gap-1.5">
                <span className="chalk-bullet">2.</span>
                <span>Hints cost processing time.</span>
              </span>
              <span className="flex items-start gap-1.5">
                <span className="chalk-bullet">3.</span>
                <span>Keys are confidential.</span>
              </span>
              <span className="flex items-start gap-1.5">
                <span className="chalk-bullet">4.</span>
                <span>Stay in mission sector.</span>
              </span>
            </p>
          </div>

          <div className="oak-overlap">
            <img src="/assets/img/oak.png" alt="Professor Oak" decoding="async" />
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            playSound('ok');
            onAccept();
          }}
          className="btn-pokedex oak-ready-button w-full max-w-xs flex items-center justify-center gap-2 py-3 text-xs sm:text-sm shrink-0"
        >
          <AppIcon name="check_circle" className="text-base sm:text-lg" />
          I&apos;M READY, PROFESSOR!
        </button>
      </div>
    </div>
  );
};
