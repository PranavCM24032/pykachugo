import React, { useEffect, useRef, useState } from 'react';
import { AppIcon } from './AppIcon';
import { playSound } from '../services/audio';
import { CustomSelect } from './CustomSelect';
import type { GameConfig, LanguageCode } from '../types/game';

interface Step1LoginProps {
  active: boolean;
  email: string;
  onEmailChange: (val: string) => void;
  securityKey: string;
  onSecurityKeyChange: (val: string) => void;
  language: LanguageCode;
  onLanguageChange: (val: LanguageCode) => void;
  missionLevel: string;
  onMissionLevelChange: (val: string) => void;
  config: GameConfig | null;
  feedback: { message: string; type: 'error' | 'success' | 'info' } | null;
  shakeField: 'email' | 'teamSecurityKey' | null;
  isSubmitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
}

export const Step1Login: React.FC<Step1LoginProps> = ({
  active,
  email,
  onEmailChange,
  securityKey,
  onSecurityKeyChange,
  language,
  onLanguageChange,
  missionLevel,
  onMissionLevelChange,
  config,
  feedback,
  shakeField,
  isSubmitting,
  onSubmit,
}) => {
  const [showKey, setShowKey] = useState(false);
  const onSecurityKeyChangeRef = useRef(onSecurityKeyChange);
  onSecurityKeyChangeRef.current = onSecurityKeyChange;

  useEffect(() => {
    if (!active) return;
    onSecurityKeyChangeRef.current('');
    setShowKey(false);
  }, [active]);

  const feedbackClass =
    feedback?.type === 'error'
      ? 'text-xs p-3 rounded border bg-red-900/30 border-red-700 text-red-200'
      : feedback?.type === 'success'
        ? 'text-xs p-3 rounded border bg-green-900/30 border-green-700 text-green-200'
        : 'text-xs p-3 rounded border bg-blue-900/30 border-blue-700 text-blue-200';

  return (
    <div id="step1" className={`flow-step${active ? ' active' : ''} h-full`}>
      <div className="min-h-full w-full flex flex-col justify-center items-center gap-2 p-3 sm:p-5">
        <div className="text-center w-full shrink-0">
          <h2 className="font-pixel text-blue-400 mb-1 tracking-widest uppercase text-xs sm:text-sm">
            Trainer Identification
          </h2>
          <p className="text-gray-400 mb-1 sm:mb-2 text-[10px] sm:text-xs">Sync Kanto Network</p>

          <div className="relative flex justify-center mx-auto mb-1 sm:mb-2">
            <div className="relative w-11 h-11 sm:w-14 sm:h-14 md:w-16 md:h-16 bg-gray-900 rounded-full flex items-center justify-center border border-yellow-500/20">
              <div className="p-1 w-full h-full">
                <img
                  src="/assets/img/ash-3.png"
                  alt="Ash"
                  decoding="async"
                  className="w-full h-full rounded-full object-cover filter brightness-90"
                />
              </div>
            </div>
          </div>
        </div>

        <form id="registrationForm" onSubmit={onSubmit} className="w-full max-w-[300px] sm:max-w-xs">
          <div>
            <label className="block text-gray-500 uppercase tracking-widest mb-0.5 sm:mb-1 ml-1 font-bold text-[9px] sm:text-[10px]">
              Email ID
            </label>
            <div className="relative">
              <input
                type="email"
                id="trainerEmail"
                value={email}
                onChange={(e) => {
                  if (e.target.value !== email) playSound('keystroke', 0.14);
                  onEmailChange(e.target.value);
                }}
                className={`w-full h-12 bg-[#070b14] border border-slate-800 rounded-lg pl-2.5 pr-7 py-0 sm:pl-3 sm:pr-8 text-white focus:border-blue-500 focus:outline-none placeholder-gray-600 transition-all text-xs sm:text-sm${
                  shakeField === 'email' ? ' animate-shake' : ''
                }`}
                placeholder="trainer@pykachu.go"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                maxLength={100}
              />
              <span className="inset-y-0 right-2.5 sm:right-3 absolute flex items-center justify-center pointer-events-none text-slate-400/75">
                <AppIcon name="mail" className="reg-input-icon leading-none" />
              </span>
            </div>
          </div>

          <div>
            <label className="block text-gray-500 uppercase tracking-widest mb-0.5 sm:mb-1 ml-1 font-bold text-[9px] sm:text-[10px]">
              Security Key
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                id="teamSecurityKey"
                value={securityKey}
                onChange={(e) => {
                  if (e.target.value !== securityKey) playSound('keystroke', 0.14);
                  onSecurityKeyChange(e.target.value);
                }}
                className={`w-full h-12 bg-[#070b14] border border-slate-800 rounded-lg pl-2.5 pr-7 py-0 sm:pl-3 sm:pr-8 text-white focus:border-blue-500 focus:outline-none placeholder-gray-600 transition-all font-mono text-xs sm:text-sm${
                  shakeField === 'teamSecurityKey' ? ' animate-shake' : ''
                }`}
                placeholder="••••"
                autoComplete="new-password"
                name="trainer-security-key"
                required
                maxLength={50}
              />
              <button
                type="button"
                aria-label={showKey ? 'Hide security key' : 'Show security key'}
                onClick={() => {
                  playSound('toggle', 0.24);
                  setShowKey((prev) => !prev);
                }}
                className="absolute inset-y-0 right-2.5 sm:right-3 flex items-center justify-center leading-none text-slate-400/75 hover:text-yellow-400 transition-colors focus:outline-none cursor-pointer"
              >
                <AppIcon id="securityKeyToggleIcon" name={showKey ? 'visibility' : 'visibility_off'} className="reg-input-icon leading-none" />
              </button>
            </div>
          </div>

          <div>
            <label className="block text-gray-500 uppercase tracking-widest mb-0.5 sm:mb-1 ml-1 font-bold text-[9px] sm:text-[10px]">
              Language
            </label>
            <div className="relative group">
              <CustomSelect
                id="codeLanguage"
                value={language}
                onChange={(v) => onLanguageChange(v as LanguageCode)}
                options={config?.languages || []}
                placeholder="Select Language"
                accent="blue"
              />
            </div>
          </div>

          <div>
            <label className="block text-gray-500 uppercase tracking-widest mb-0.5 sm:mb-1 ml-1 font-bold text-[9px] sm:text-[10px]">
              Mission Discovery
            </label>
            <div className="relative group">
              <CustomSelect
                id="missionLevel"
                value={missionLevel}
                onChange={onMissionLevelChange}
                groups={config?.missionGroups || []}
                placeholder="Select Mission"
                accent="blue"
              />
            </div>
          </div>

          {feedback && feedback.type !== 'success' && (
            <div id="registrationFeedback" className={feedbackClass}>
              <div>{feedback.message}</div>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            onClick={() => playSound('ok', 0.28)}
            className="btn-pokedex w-full mt-1 flex items-center justify-center gap-1.5 sm:gap-2 py-2 sm:py-2.5 text-xs sm:text-sm"
          >
            <AppIcon name="play_arrow" className="text-base sm:text-lg" />
            {isSubmitting ? 'SYNCING...' : 'START GO'}
          </button>
        </form>
      </div>
    </div>
  );
};
