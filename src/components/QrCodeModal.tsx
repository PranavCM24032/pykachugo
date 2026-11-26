import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  QrCode,
  X,
} from 'lucide-react';
import { getPokemonArtworkUrl } from '../services/gameBackend';

export const QR_BASE_URL = 'https://pykachugo.vercel.app';

export interface QrTargetItem {
  kind: 'PUZZLE' | 'MEME' | 'CUSTOM';
  code: string; // linkid (e.g. XG01), memeid (e.g. M01), or custom filename slug
  title: string; // Modal heading
  idLabel?: string; // ID printed in bottom id:location line (defaults to title)
  subtitle: string; // Location label shown in bottom id:location line
  badgeText?: string; // Optional metadata in modal header
  pokemonId?: number; // PokéAPI sprite ID placed in QR center
  customUrl?: string; // Exact encoded link when kind === 'CUSTOM'
}

interface QrCodeModalProps {
  item: QrTargetItem | null;
  onClose: () => void;
}

export function buildQrPayload(item: QrTargetItem, mode: 'URL' | 'CODE' = 'URL'): string {
  if (item.kind === 'CUSTOM') {
    return (item.customUrl || item.code || QR_BASE_URL).trim();
  }
  if (mode === 'CODE') return item.code;
  return item.kind === 'PUZZLE'
    ? `${QR_BASE_URL}/?linkid=${encodeURIComponent(item.code)}`
    : `${QR_BASE_URL}/?memid=${encodeURIComponent(item.code)}`;
}

function loadCanvasImage(src: string, useCrossOrigin = false): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    if (useCrossOrigin) {
      img.crossOrigin = 'anonymous';
    }
    const timer = window.setTimeout(() => {
      img.onload = null;
      img.onerror = null;
      resolve(null);
    }, 6000);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}

function fitTextToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  fontWeight: string,
  startSize: number,
  minSize: number,
  fontFamily: string
): { font: string; text: string } {
  let size = startSize;
  while (size > minSize) {
    ctx.font = `${fontWeight} ${size}px ${fontFamily}`;
    if (ctx.measureText(text).width <= maxWidth) {
      return { font: ctx.font, text };
    }
    size -= 1;
  }
  ctx.font = `${fontWeight} ${minSize}px ${fontFamily}`;
  let trimmed = text;
  while (trimmed.length > 3 && ctx.measureText(`${trimmed}...`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return {
    font: ctx.font,
    text: trimmed.length < text.length ? `${trimmed}...` : trimmed,
  };
}

function rgbToHex(color: { r: number; g: number; b: number }): string {
  return `#${[color.r, color.g, color.b]
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('')}`;
}

export async function renderBrandedQrStickerDataUrl(options: {
  payload: string;
  idLabel?: string;
  locationLabel?: string;
  pokemonId?: number;
  fallbackCenterImg?: string;
  qrColor?: { r: number; g: number; b: number };
  qrBgColor?: { r: number; g: number; b: number };
  pokemonSizePercent?: number;
  size?: number;
}): Promise<string> {
  const {
    payload,
    idLabel = '',
    locationLabel = '',
    pokemonId,
    fallbackCenterImg,
    qrColor = { r: 9, g: 13, b: 22 },
    qrBgColor = { r: 255, g: 255, b: 255 },
    pokemonSizePercent = 44,
    size = 680,
  } = options;

  const qrSize = Math.round(size * 0.88);
  const qrX = Math.round((size - qrSize) / 2);
  const qrY = Math.round(size * 0.032);
  const darkHex = rgbToHex(qrColor);
  const bgHex = rgbToHex(qrBgColor);
  const bgR = Math.max(0, Math.min(255, Math.round(qrBgColor.r)));
  const bgG = Math.max(0, Math.min(255, Math.round(qrBgColor.g)));
  const bgB = Math.max(0, Math.min(255, Math.round(qrBgColor.b)));
  const bgLuminance = (0.299 * bgR + 0.587 * bgG + 0.114 * bgB) / 255;

  const qrDataUrl = await QRCode.toDataURL(payload, {
    width: qrSize,
    margin: 2,
    errorCorrectionLevel: 'H',
    color: {
      dark: darkHex,
      light: bgHex,
    },
  });

  const centerSpriteUrl =
    pokemonId && pokemonId > 0
      ? getPokemonArtworkUrl(pokemonId)
      : fallbackCenterImg || '';

  const [qrImg, centerImgRaw, pykachuImg, goImg] = await Promise.all([
    loadCanvasImage(qrDataUrl, false),
    centerSpriteUrl
      ? loadCanvasImage(centerSpriteUrl, /^https?:\/\//i.test(centerSpriteUrl))
      : Promise.resolve(null),
    loadCanvasImage('/assets/img/pykachu.png', false),
    loadCanvasImage('/assets/img/go.png', false),
  ]);

  let centerImg = centerImgRaw;
  if (!centerImg && pokemonId && pokemonId > 0) {
    centerImg = await loadCanvasImage('/assets/img/pikachu.png', false);
  }

  // Compute proportional logo sizing (large & bold)
  const pykaH = Math.round(size * 0.125);
  const goH = Math.round(size * 0.112);
  const logoTopY = qrY + qrSize + Math.round(size * 0.015);
  const logoCenterY = logoTopY + Math.round(pykaH / 2);

  const cleanId = String(idLabel || '').trim();
  const cleanLoc = String(locationLabel || '').trim();
  const combinedLine =
    cleanId && cleanLoc
      ? `${cleanId}:${cleanLoc}`
      : cleanId || cleanLoc;

  const textY = logoTopY + pykaH + Math.round(size * 0.052);
  const cardHeight = combinedLine
    ? textY + Math.round(size * 0.055)
    : logoTopY + pykaH + Math.round(size * 0.045);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = cardHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx || !qrImg) return qrDataUrl;

  // Clean borderless sticker background
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, size, cardHeight);

  // QR code image (no border)
  ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

  // Center Pokémon PNG directly on QR (~44% of QR width/height, NO circle or border)
  if (centerImg && centerImg.naturalWidth > 0 && centerImg.naturalHeight > 0) {
    const cx = qrX + qrSize / 2;
    const cy = qrY + qrSize / 2;
    const maxPokeBox = Math.round(qrSize * (Math.max(5, Math.min(80, pokemonSizePercent)) / 100));
    const aspect = centerImg.naturalWidth / centerImg.naturalHeight;
    const drawW = aspect >= 1 ? maxPokeBox : maxPokeBox * aspect;
    const drawH = aspect >= 1 ? maxPokeBox / aspect : maxPokeBox;

    ctx.save();
    ctx.shadowColor = `rgba(${bgR}, ${bgG}, ${bgB}, 0.92)`;
    ctx.shadowBlur = Math.max(4, Math.round(size * 0.01));
    ctx.drawImage(centerImg, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
    ctx.restore();
  }

  // Bottom Row 1: Larger pykachu.png + go.png logo lockup
  if (pykachuImg && pykachuImg.naturalWidth > 0 && goImg && goImg.naturalWidth > 0) {
    const pykaW = pykaH * (pykachuImg.naturalWidth / pykachuImg.naturalHeight);
    const goW = goH * (goImg.naturalWidth / goImg.naturalHeight);
    const gap = Math.round(size * 0.02);
    const totalW = pykaW + gap + goW;
    const maxLogosW = size * 0.88;
    const scale = totalW > maxLogosW ? maxLogosW / totalW : 1;

    const scaledPykaW = pykaW * scale;
    const scaledPykaH = pykaH * scale;
    const scaledGoW = goW * scale;
    const scaledGoH = goH * scale;
    const scaledGap = gap * scale;
    const startX = (size - (scaledPykaW + scaledGap + scaledGoW)) / 2;

    ctx.drawImage(
      pykachuImg,
      startX,
      logoCenterY - scaledPykaH / 2,
      scaledPykaW,
      scaledPykaH
    );
    ctx.drawImage(
      goImg,
      startX + scaledPykaW + scaledGap,
      logoCenterY - scaledGoH / 2,
      scaledGoW,
      scaledGoH
    );
  } else if (pykachuImg && pykachuImg.naturalWidth > 0) {
    const pykaW = pykaH * (pykachuImg.naturalWidth / pykachuImg.naturalHeight);
    ctx.drawImage(pykachuImg, (size - pykaW) / 2, logoCenterY - pykaH / 2, pykaW, pykaH);
  }

  // Bottom Row 2: ONLY id:location
  if (combinedLine) {
    const maxTextWidth = size - Math.round(size * 0.09);
    const fitted = fitTextToWidth(
      ctx,
      combinedLine,
      maxTextWidth,
      '700',
      Math.round(size * 0.04),
      Math.round(size * 0.024),
      'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    );
    ctx.fillStyle = bgLuminance < 0.48 ? '#f8fafc' : '#0f172a';
    ctx.font = fitted.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fitted.text, size / 2, textY);
  }

  try {
    return canvas.toDataURL('image/png');
  } catch {
    return qrDataUrl;
  }
}

export const QrCodeModal: React.FC<QrCodeModalProps> = ({ item, onClose }) => {
  const [payloadMode, setPayloadMode] = useState<'URL' | 'CODE'>('URL');
  const [stickerDataUrl, setStickerDataUrl] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const payload = useMemo(() => {
    if (!item) return '';
    return buildQrPayload(item, payloadMode);
  }, [item, payloadMode]);

  const fullUrl = useMemo(() => {
    if (!item) return '';
    return buildQrPayload(item, 'URL');
  }, [item]);

  useEffect(() => {
    if (!item || !payload) {
      setStickerDataUrl('');
      return;
    }
    let cancelled = false;
    setErrorMsg(null);

    renderBrandedQrStickerDataUrl({
      payload,
      idLabel: item.idLabel ?? item.title,
      locationLabel: item.subtitle,
      pokemonId: item.pokemonId,
      fallbackCenterImg: item.kind === 'MEME' ? '/assets/img/pokeball.svg' : undefined,
      size: 680,
    })
      .then((url) => {
        if (!cancelled) setStickerDataUrl(url);
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'Failed to generate QR code');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [item, payload]);

  useEffect(() => {
    if (!item) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [item, onClose]);

  if (!item) return null;

  const handleDownloadPng = async () => {
    try {
      const cardUrl =
        stickerDataUrl ||
        (await renderBrandedQrStickerDataUrl({
          payload,
          idLabel: item.idLabel ?? item.title,
          locationLabel: item.subtitle,
          pokemonId: item.pokemonId,
          fallbackCenterImg: item.kind === 'MEME' ? '/assets/img/pokeball.svg' : undefined,
          size: 800,
        }));
      const a = document.createElement('a');
      a.href = cardUrl;
      a.download = `pykachu_qr_${item.code.toLowerCase()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not download QR PNG');
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        copyTimerRef.current = null;
        setCopied(false);
      }, 1800);
    } catch {
      setErrorMsg('Clipboard access denied by browser.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qrModalTitle"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-[#0E1420] p-6 shadow-2xl fade-in">
        <div className="flex items-start justify-between gap-3 pb-4 mb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <QrCode className="w-4 h-4 text-cyan-400 shrink-0" />
              <h3 id="qrModalTitle" className="text-base font-semibold text-white font-mono">
                {item.title}
              </h3>
            </div>
            <p className="text-xs text-slate-400 mt-1 truncate max-w-[300px]">
              {item.subtitle}
              {item.badgeText ? ` · ${item.badgeText}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
            aria-label="Close QR code modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Payload Format Toggle */}
        {item.kind !== 'CUSTOM' && (
          <div className="flex items-center justify-between gap-2 mb-4">
            <span className="text-xs text-slate-400">QR Content</span>
            <div className="inline-flex items-center p-1 rounded-lg bg-[#090D16] border border-slate-800">
              <button
                type="button"
                onClick={() => setPayloadMode('URL')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  payloadMode === 'URL'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                pykachugo.vercel.app
              </button>
              <button
                type="button"
                onClick={() => setPayloadMode('CODE')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  payloadMode === 'CODE'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Signal ID Only
              </button>
            </div>
          </div>
        )}

        {/* Borderless Scannable Branded QR Sticker Preview */}
        <div className="flex flex-col items-center justify-center rounded-xl bg-white p-2 mb-4">
          {errorMsg ? (
            <div className="py-12 text-center text-xs text-rose-600 font-medium">
              {errorMsg}
            </div>
          ) : stickerDataUrl ? (
            <img
              src={stickerDataUrl}
              alt={`Branded QR Sticker for ${item.title}`}
              className="w-64 h-auto object-contain"
            />
          ) : (
            <div className="w-64 h-72 flex items-center justify-center text-xs text-slate-500">
              Generating branded QR...
            </div>
          )}
        </div>

        {/* Encoded Value + Copy */}
        <div className="flex items-center gap-2 rounded-lg bg-[#090D16] border border-slate-800 px-3 py-2 mb-4">
          <span className="text-xs font-mono text-slate-300 truncate flex-1" title={payload}>
            {payload}
          </span>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium inline-flex items-center gap-1 shrink-0 cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-300">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>

        {/* Primary Actions */}
        <div className="flex items-center justify-between gap-2">
          <a
            href={fullUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3.5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium inline-flex items-center gap-1.5"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Open Link</span>
          </a>

          <button
            type="button"
            disabled={!stickerDataUrl}
            onClick={() => void handleDownloadPng()}
            className="px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download QR PNG</span>
          </button>
        </div>
      </div>
    </div>
  );
};

interface QrBatchSheetModalProps {
  open: boolean;
  items: QrTargetItem[];
  heading: string;
  onClose: () => void;
}

export const QrBatchSheetModal: React.FC<QrBatchSheetModalProps> = ({
  open,
  items,
  heading,
  onClose,
}) => {
  const [rendered, setRendered] = useState<{ item: QrTargetItem; url: string; payload: string }[]>([]);
  const [downloadingSheet, setDownloadingSheet] = useState(false);

  useEffect(() => {
    if (!open || items.length === 0) {
      setRendered([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        items.map(async (item) => {
          const payload = buildQrPayload(item, 'URL');
          const url = await renderBrandedQrStickerDataUrl({
            payload,
            idLabel: item.idLabel ?? item.title,
            locationLabel: item.subtitle,
            pokemonId: item.pokemonId,
            fallbackCenterImg: item.kind === 'MEME' ? '/assets/img/pokeball.svg' : undefined,
            size: 460,
          });
          return { item, url, payload };
        })
      );
      if (!cancelled) setRendered(results);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, items]);

  if (!open) return null;

  const handleDownloadCombinedSheet = async () => {
    if (rendered.length === 0) return;
    setDownloadingSheet(true);
    try {
      const cols = 3;
      const cellW = 420;
      const cellH = 510;
      const pad = 28;
      const rowsCount = Math.ceil(rendered.length / cols);

      const canvas = document.createElement('canvas');
      canvas.width = cols * cellW + pad * 2;
      canvas.height = rowsCount * cellH + pad * 2 + 52;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 26px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(heading, pad, pad + 24);

      await Promise.all(
        rendered.map(
          ({ url }, idx) =>
            new Promise<void>((resolve) => {
              const img = new Image();
              img.onload = () => {
                const col = idx % cols;
                const row = Math.floor(idx / cols);
                const x = pad + col * cellW + 10;
                const y = pad + 52 + row * cellH + 10;
                ctx.drawImage(img, x, y, cellW - 20, cellH - 20);
                resolve();
              };
              img.onerror = () => resolve();
              img.src = url;
            })
        )
      );

      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `pykachu_qr_sheet_${new Date().toISOString().slice(0, 10)}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      setDownloadingSheet(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qrBatchTitle"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-4xl max-h-[90vh] rounded-xl border border-slate-800 bg-[#0E1420] flex flex-col overflow-hidden shadow-2xl fade-in">
        <div className="px-6 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id="qrBatchTitle" className="text-base font-semibold text-white">
              {heading} ({items.length})
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Download the complete borderless sticker sheet PNG with Pokémon sprites and pykachugo.vercel.app links.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={downloadingSheet || rendered.length === 0}
              onClick={() => void handleDownloadCombinedSheet()}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{downloadingSheet ? 'Building PNG...' : 'Download All PNG Sheet'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              aria-label="Close QR sheet"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rendered.map(({ item, url }) => (
            <div
              key={`${item.kind}-${item.code}`}
              className="rounded-xl bg-white p-2 flex flex-col items-center text-center"
            >
              <img
                src={url}
                alt={`QR for ${item.title}`}
                className="w-52 h-auto object-contain"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
