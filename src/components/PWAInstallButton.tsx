import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { playSound } from '../services/audio';
import { AppIcon } from './AppIcon';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => {
          playSound('ok', 0.26);
          void install();
        }}
        title="Install Pykachu Go for offline play"
        className="flex items-center gap-1.5 rounded-full border border-blue-400/50 bg-slate-900 px-2.5 py-1 text-[10px] font-bold tracking-wider text-blue-300 uppercase shadow-sm transition-colors hover:border-blue-400 hover:bg-slate-800 hover:text-white cursor-pointer"
      >
        <Download aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span>Install</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => {
            playSound('toggle', 0.24);
            setShowIOSGuide(true);
          }}
          title="Install on iPhone / iPad"
          className="flex items-center gap-1 rounded-full border border-blue-400/45 bg-slate-900 px-2.5 py-1 text-[10px] font-bold tracking-wider text-blue-300 uppercase transition-colors hover:bg-slate-800 hover:text-white cursor-pointer"
        >
          <AppIcon name="ios_share" className="text-xs leading-none" />
          <span>Install</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#070b14] p-4">
            <div className="w-full max-w-xs rounded-xl border border-blue-500/40 bg-slate-950 p-5 text-left shadow-2xl">
              <div className="flex items-center gap-2 mb-2">
                <AppIcon name="install_mobile" className="text-xl text-blue-400" />
                <h3 className="font-pixel text-xs text-blue-300 uppercase">Install Offline App</h3>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                1. Tap the <strong className="text-white">Share</strong> icon in Safari&apos;s toolbar.
                <br />
                2. Scroll down and select <strong className="text-white">Add to Home Screen</strong>.
              </p>
              <button
                type="button"
                onClick={() => {
                  playSound('ok', 0.25);
                  setShowIOSGuide(false);
                }}
                className="btn-pokedex mt-4 w-full py-2 text-xs"
              >
                GOT IT
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
