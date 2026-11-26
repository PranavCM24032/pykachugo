import React, { useEffect } from 'react';
import { playSound } from '../services/audio';
import { AppIcon } from './AppIcon';

interface SignOutOverlayProps {
  visible: boolean;
  teamName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const SignOutOverlay: React.FC<SignOutOverlayProps> = ({
  visible,
  teamName,
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [visible, onCancel]);

  return (
    <div
      id="signoutOverlay"
      className={`${visible ? '' : 'hidden '}absolute inset-0 z-[160] glass-panel flex flex-col items-center justify-center p-4 confirm-dialog-overlay`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="signoutTitle"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-[#111827] border-2 border-red-600/60 rounded-xl p-4 sm:p-5 w-full max-w-xs sm:max-w-sm text-center animate-fade-in">
        <AppIcon name="power_settings_new" className="text-3xl text-red-500 sm:text-4xl md:text-5xl" />
        <h3 id="signoutTitle" className="font-pixel text-red-500 text-sm sm:text-base my-3">
          SIGN OUT
        </h3>
        <p className="text-gray-400 text-xs sm:text-sm mb-4 leading-relaxed">
          Trainer{' '}
          <span id="signOutTeam" className="text-white font-bold">
            {teamName || 'Trainer'}
          </span>
          <br />
          End your current session?
        </p>

        <div className="flex gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => {
              playSound('ok', 0.26);
              onConfirm();
            }}
            className="bg-red-600 text-white hover:bg-red-700 font-bold flex-1 py-3 sm:py-4 rounded-lg text-sm sm:text-base transition-colors min-h-[44px]"
          >
            <span className="flex items-center justify-center gap-2">
              <AppIcon name="logout" className="text-base sm:text-lg" />
              LOGOUT
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              playSound('cancel', 0.25);
              onCancel();
            }}
            className="bg-gray-800 text-white flex-1 py-3 sm:py-4 rounded-lg text-sm sm:text-base hover:bg-gray-700 transition-colors min-h-[44px]"
          >
            <span className="flex items-center justify-center gap-2">
              <AppIcon name="close" className="text-base sm:text-lg" />STAY
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
