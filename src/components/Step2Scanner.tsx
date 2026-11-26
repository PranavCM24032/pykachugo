import React, { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { AppIcon } from './AppIcon';
import { playSound } from '../services/audio';
import { useDialogFocus } from '../hooks/useDialogFocus';

interface ZoomCapability {
  min: number;
  max: number;
  step?: number;
}

interface Step2ScannerProps {
  active: boolean;
  onScanResult: (rawCode: string) => void;
  onShowToast: (msg: string, type: 'info' | 'success' | 'error') => void;
  onOpenCameraGuide: (reason: 'inapp' | 'permission') => void;
}

type NativeBarcodeDetector = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};
type NativeBarcodeDetectorCtor = new (options?: { formats?: string[] }) => NativeBarcodeDetector;

async function requestCameraStream(): Promise<MediaStream> {
  const attempts: MediaStreamConstraints[] = [
    {
      video: {
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
    },
    { video: { facingMode: { ideal: 'environment' } } },
    { video: true },
  ];

  let lastError: unknown = null;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
      const errName = (error as { name?: string })?.name || '';
      if (['NotAllowedError', 'SecurityError'].includes(errName)) throw error;
    }
  }
  throw lastError || new Error('Camera could not start');
}

function cameraErrorMessage(error: unknown): string {
  if (!window.isSecureContext) return 'Camera needs HTTPS. Use manual code entry.';
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    return 'This browser cannot access the camera. Use manual code entry.';
  }
  const errName = (error as { name?: string })?.name;
  switch (errName) {
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera found. Use manual code entry.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Camera is busy in another app. Close it and retry, or use manual entry.';
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'Camera blocked. Allow camera for this site, then retry or use manual entry.';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'Camera settings are unsupported. Retry or use manual entry.';
    case 'AbortError':
      return 'Camera stopped before it started. Retry or use manual entry.';
    default:
      return 'Camera could not start. Use manual code entry.';
  }
}

export const Step2Scanner: React.FC<Step2ScannerProps> = ({
  active,
  onScanResult,
  onShowToast,
  onOpenCameraGuide,
}) => {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSignal, setManualSignal] = useState('');
  const [zoomCap, setZoomCap] = useState<ZoomCapability | null>(null);
  const [zoomValue, setZoomValue] = useState(1);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const manualInputRef = useRef<HTMLInputElement | null>(null);
  const manualDialogRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const startingRef = useRef(false);
  const scanGenRef = useRef(0);
  const loadAbortRef = useRef<(() => void) | null>(null);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);

  useDialogFocus(manualOpen, manualDialogRef, () => setManualOpen(false), manualInputRef);

  const stopScanner = useCallback(() => {
    scanGenRef.current += 1;
    if (loadAbortRef.current) {
      const abort = loadAbortRef.current;
      loadAbortRef.current = null;
      abort();
    }
    if (scanTimerRef.current !== null) {
      window.clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    trackRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    pinchRef.current = null;
    setZoomCap(null);
    setScannerOpen(false);
  }, []);

  useEffect(() => {
    if (!active) {
      stopScanner();
      setManualOpen(false);
    }
  }, [active, stopScanner]);

  useEffect(() => {
    return () => stopScanner();
  }, [stopScanner]);

  const applyZoom = useCallback(async (val: number) => {
    const track = trackRef.current;
    if (!track || !zoomCap) return;
    const clamped = Math.min(Math.max(val, zoomCap.min), zoomCap.max);
    try {
      await track.applyConstraints({
        advanced: [{ zoom: clamped } as unknown as MediaTrackConstraintSet],
      });
      setZoomValue(clamped);
    } catch {
      // ignore unsupported zoom constraints
    }
  }, [zoomCap]);

  const startScanner = async () => {
    if (streamRef.current || startingRef.current) return;
    startingRef.current = true;
    const gen = scanGenRef.current;
    let stream: MediaStream | null = null;

    try {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        const err = new Error('Camera API unavailable');
        err.name = window.isSecureContext ? 'NotSupportedError' : 'SecurityError';
        throw err;
      }

      stream = await requestCameraStream();
      if (gen !== scanGenRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;
      playSound('scanStart');
      setScannerOpen(true);

      // Wait for React render to expose video element
      await new Promise((r) => requestAnimationFrame(r));
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) {
        stopScanner();
        return;
      }

      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // mobile browsers may warm up first
      }

      if (gen !== scanGenRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      if (video.readyState < video.HAVE_CURRENT_DATA) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            cleanup();
            reject(new Error('Camera stream did not produce video frames'));
          }, 10000);
          const onLoaded = () => {
            cleanup();
            resolve();
          };
          const onErr = () => {
            cleanup();
            reject(video.error || new Error('Camera video could not be played'));
          };
          const onAbort = () => {
            cleanup();
            resolve();
          };
          const cleanup = () => {
            clearTimeout(timeout);
            if (loadAbortRef.current === onAbort) loadAbortRef.current = null;
            video.removeEventListener('loadeddata', onLoaded);
            video.removeEventListener('error', onErr);
          };
          loadAbortRef.current = onAbort;
          video.addEventListener('loadeddata', onLoaded, { once: true });
          video.addEventListener('error', onErr, { once: true });
        });
      }

      if (gen !== scanGenRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const track = stream.getVideoTracks()[0];
      if (track && typeof track.getCapabilities === 'function') {
        try {
          const caps = track.getCapabilities() as MediaTrackCapabilities & { zoom?: ZoomCapability };
          if (caps && caps.zoom) {
            trackRef.current = track;
            setZoomCap(caps.zoom);
            const settings =
              typeof track.getSettings === 'function'
                ? (track.getSettings() as MediaTrackSettings & { zoom?: number })
                : {};
            setZoomValue(settings.zoom || caps.zoom.min);
          }
        } catch {
          // iOS Safari fallback
        }
      }

      const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
      const DetectorCtor = (
        window as unknown as { BarcodeDetector?: NativeBarcodeDetectorCtor }
      ).BarcodeDetector;
      let nativeDetector: NativeBarcodeDetector | null = null;
      if (DetectorCtor) {
        try {
          nativeDetector = new DetectorCtor({ formats: ['qr_code'] });
        } catch {
          nativeDetector = null;
        }
      }

      let frameTick = 0;
      const runScanFrame = async () => {
        if (gen !== scanGenRef.current) return;
        const v = videoRef.current;
        if (v && v.readyState === v.HAVE_ENOUGH_DATA && v.videoWidth && v.videoHeight) {
          try {
            let detectedValue = '';
            if (nativeDetector) {
              try {
                const hits = await nativeDetector.detect(v);
                if (gen !== scanGenRef.current) return;
                detectedValue = hits.find((h) => h.rawValue)?.rawValue || '';
              } catch {
                nativeDetector = null;
              }
            }

            if (!detectedValue && !nativeDetector && ctx) {
              const maxDim = 480;
              const scale = Math.min(1, maxDim / Math.max(v.videoWidth, v.videoHeight));
              const w = Math.max(160, Math.round(v.videoWidth * scale));
              const h = Math.max(160, Math.round(v.videoHeight * scale));
              if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
              }
              ctx.drawImage(v, 0, 0, w, h);
              const imageData = ctx.getImageData(0, 0, w, h);
              const inversionAttempts = frameTick % 4 === 0 ? 'attemptBoth' : 'dontInvert';
              frameTick += 1;
              const code = jsQR(imageData.data, w, h, { inversionAttempts });
              if (code && code.data) {
                detectedValue = code.data;
              }
            }

            if (detectedValue) {
              playSound('scanFound', 0.28);
              stopScanner();
              onScanResult(detectedValue);
              return;
            }
          } catch {
            // ignore single frame error
          }
        }
        if (gen === scanGenRef.current) {
          scanTimerRef.current = window.setTimeout(() => {
            void runScanFrame();
          }, nativeDetector ? 60 : 85);
        }
      };

      scanTimerRef.current = window.setTimeout(() => {
        void runScanFrame();
      }, 30);
    } catch (error) {
      if (gen !== scanGenRef.current) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      stopScanner();
      const errName = (error as { name?: string })?.name || '';
      if (!window.isSecureContext) {
        onShowToast(cameraErrorMessage(error), 'error');
        setManualOpen(true);
      } else if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError', 'NotSupportedError'].includes(errName)) {
        onOpenCameraGuide(errName === 'NotSupportedError' ? 'inapp' : 'permission');
      } else {
        onShowToast(cameraErrorMessage(error), 'error');
        setManualOpen(true);
      }
    } finally {
      startingRef.current = false;
    }
  };

  const handleOpenManual = () => {
    playSound('toggle', 0.24);
    setManualOpen(true);
  };

  const handleSubmitManual = () => {
    const trimmed = manualSignal.trim().toUpperCase();
    if (!trimmed) {
      playSound('error', 0.24);
      onShowToast('Enter a valid code', 'error');
      return;
    }
    if (trimmed.length > 50) {
      playSound('error', 0.24);
      onShowToast('Max 50 characters', 'error');
      return;
    }
    playSound('scanFound', 0.28);
    onScanResult(trimmed);
    setManualSignal('');
    setManualOpen(false);
  };

  return (
    <div id="step2" className={`flow-step${active ? ' active' : ''} h-full`}>
      <div className="min-h-full w-full flex flex-col justify-center items-center gap-5 p-3 sm:p-5">
        <div className="text-center w-full shrink-0">
          <h2 className="font-pixel text-blue-400 mb-1 tracking-widest uppercase text-xs sm:text-sm">
            Signal Tracking
          </h2>
          <p className="text-gray-400 text-[10px] sm:text-xs">Locate regional QR tags</p>
        </div>

        <div className="qr-radar mx-auto shrink-0">
          <div className="qr-radar-scan"></div>
          <div className="qr-radar-scan" style={{ animationDelay: '0.5s' }}></div>
          <div className="qr-radar-scan" style={{ animationDelay: '1s' }}></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-[45%] h-[45%] border-2 border-blue-400/30 rounded-2xl flex items-center justify-center bg-blue-500/5">
              <AppIcon name="qr_code_scanner" className="animate-pulse text-[clamp(26px,7vmin,48px)] text-blue-400" />
            </div>
          </div>
        </div>

        <div className="player-scanner-actions w-full max-w-xs space-y-2.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              playSound('ok', 0.28);
              void startScanner();
            }}
            className="btn-pokedex w-full flex items-center justify-center gap-2 py-3.5 text-xs sm:text-sm"
          >
            <AppIcon name="radar" className="text-base sm:text-lg md:text-xl" />
            ACTIVATE SENSORS
          </button>
          <button
            type="button"
            onClick={handleOpenManual}
            className="w-full flex items-center justify-center py-3.5 text-[10px] sm:text-xs text-slate-500 hover:text-slate-300 font-pixel bg-[#0c111b]/70 border border-slate-700/60 hover:border-slate-600 rounded-xl hover:bg-[#111827]/70 transition-all uppercase tracking-tighter"
          >
            Manual Override
          </button>
        </div>
      </div>

      {/* QR Scanner Overlay */}
      <div
        id="qrScannerContainer"
        className={`${scannerOpen ? '' : 'hidden '}absolute inset-0 z-[130] bg-black`}
        onTouchStart={(e) => {
          if (e.touches.length === 2 && zoomCap) {
            const d = Math.hypot(
              e.touches[0].pageX - e.touches[1].pageX,
              e.touches[0].pageY - e.touches[1].pageY
            );
            pinchRef.current = { dist: d, zoom: zoomValue };
          }
        }}
        onTouchMove={(e) => {
          if (e.touches.length === 2 && pinchRef.current && zoomCap) {
            const d = Math.hypot(
              e.touches[0].pageX - e.touches[1].pageX,
              e.touches[0].pageY - e.touches[1].pageY
            );
            const delta = (d - pinchRef.current.dist) / 100;
            void applyZoom(pinchRef.current.zoom + delta);
          }
        }}
        onTouchEnd={() => {
          pinchRef.current = null;
        }}
      >
        <div className="relative h-full w-full overflow-hidden flex flex-col">
          <video ref={videoRef} id="qrVideo" className="w-full h-full object-cover" />
          <canvas ref={canvasRef} id="qrCanvas" className="hidden" />
          <div className="absolute inset-0 flex flex-col">
            <div className="flex justify-between items-start p-3 sm:p-4">
              <div className="bg-black/60 p-2 sm:p-3 rounded-lg border border-blue-500/30">
                <p className="font-pixel text-blue-400 text-xs sm:text-sm uppercase">Scanner Active</p>
              </div>
              <button
                type="button"
                aria-label="Close scanner"
                onClick={() => {
                  playSound('cancel', 0.25);
                  stopScanner();
                }}
                className="bg-red-600/80 text-white p-2 sm:p-3 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <AppIcon name="close" className="text-lg sm:text-xl md:text-2xl" />
              </button>
            </div>
            <div className="flex-1 flex items-center justify-center p-4">
              <div className="relative w-full aspect-square max-w-48 sm:max-w-64 overflow-hidden rounded-lg">
                <div className="absolute inset-0 border-2 border-blue-400/50 rounded-lg"></div>
                <div className="absolute top-0 left-0 w-6 h-6 sm:w-8 sm:h-8 border-t-2 border-l-2 border-blue-400"></div>
                <div className="absolute bottom-0 right-0 w-6 h-6 sm:w-8 sm:h-8 border-b-2 border-r-2 border-blue-400"></div>
                <div className="animate-scanline inset-0 pointer-events-none">
                  <div className="w-full h-0.5 bg-blue-400/80 shadow-[0_0_8px_rgba(96,165,250,0.9)]"></div>
                </div>
              </div>
            </div>
            <div id="zoomControlContainer" className={`${zoomCap ? '' : 'hidden '}px-5 pb-2`}>
              <div className="flex items-center gap-2 bg-[#0f172a] rounded-full px-4 py-2.5 border border-slate-700 shadow-lg">
                <AppIcon name="remove" className="select-none text-base text-white/40 sm:text-lg" />
                <div className="flex-1 relative flex items-center">
                  <input
                    type="range"
                    id="qrZoomSlider"
                    aria-label="Camera zoom"
                    min={zoomCap?.min ?? 1}
                    max={zoomCap?.max ?? 5}
                    step={zoomCap?.step ?? 0.1}
                    value={zoomValue}
                    onChange={(e) => void applyZoom(parseFloat(e.target.value))}
                    className="w-full h-8 appearance-none cursor-pointer"
                  />
                </div>
                <AppIcon name="add" className="select-none text-base text-white/40 sm:text-lg" />
              </div>
            </div>
            <div className="p-3 sm:p-4 text-center">
              <p className="text-white/70 text-xs sm:text-sm">Point camera at QR code</p>
              <p className="text-gray-500 text-[10px] sm:text-xs mt-1">Make sure code is within frame</p>
            </div>
          </div>
        </div>
      </div>

      {/* Manual Entry Overlay */}
      <div
        id="manualEntryContainer"
        ref={manualDialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="manualOverrideTitle"
        tabIndex={-1}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            playSound('cancel', 0.22);
            setManualOpen(false);
          }
        }}
        className={`${manualOpen ? '' : 'hidden '}absolute inset-0 z-[120] bg-[#060913]/92 flex flex-col items-center justify-center p-4`}
      >
        <div className="relative overflow-hidden rounded-2xl border border-blue-500/45 bg-gradient-to-b from-[#0b152e]/95 to-[#060c1d]/95 p-5 sm:p-6 w-full max-w-[320px] sm:max-w-sm text-center animate-fade-in">
          <div className="pointer-events-none absolute inset-0 opacity-70 [background-image:linear-gradient(rgba(59,130,246,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.07)_1px,transparent_1px)] [background-size:16px_16px]"></div>

          <div className="relative z-10">
            <h3
              id="manualOverrideTitle"
              className="font-pixel text-blue-400 text-sm sm:text-base tracking-widest uppercase mb-5"
            >
              MANUAL ENTRY
            </h3>

            <div className="mb-4">
              <input
                ref={manualInputRef}
                type="text"
                id="manualSignalId"
                aria-label="Enter Signal ID"
                value={manualSignal}
                onChange={(e) => {
                  if (e.target.value !== manualSignal) playSound('keystroke', 0.14);
                  setManualSignal(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSubmitManual();
                  }
                }}
                className="w-full bg-[#060a14]/90 border border-slate-700/80 rounded-lg px-3.5 py-3 text-white font-mono text-xs sm:text-sm tracking-wider placeholder:text-slate-400 focus:border-blue-500 outline-none uppercase min-h-[44px] transition-colors text-left"
                placeholder="ENTER SIGNAL ID"
                autoComplete="off"
                maxLength={50}
                autoCapitalize="characters"
              />
            </div>

            <div className="flex gap-3 items-stretch">
              <button
                type="button"
                onClick={handleSubmitManual}
                className="btn-pokedex flex-1 py-3 rounded-lg text-xs sm:text-sm min-h-[46px] uppercase tracking-wider"
              >
                DECODE
              </button>
              <button
                type="button"
                onClick={() => {
                  playSound('cancel', 0.25);
                  setManualOpen(false);
                }}
                className="flex-1 bg-slate-800/75 hover:bg-slate-700/80 border border-slate-700/60 text-slate-300 hover:text-white font-mono uppercase tracking-wider py-3 rounded-lg text-xs sm:text-sm transition-colors min-h-[46px] cursor-pointer"
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
