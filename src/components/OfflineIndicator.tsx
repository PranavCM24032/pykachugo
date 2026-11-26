import React from 'react';
import { AppIcon } from './AppIcon';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-1 rounded-full border border-amber-400/60 bg-amber-950 px-2.5 py-1 text-[10px] font-bold tracking-wider text-amber-200 uppercase shadow-sm"
    >
      <AppIcon name="cloud_off" className="text-xs leading-none" />
      <span>Offline</span>
    </div>
  );
};
