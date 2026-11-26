import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { playSound } from '../services/audio';

export type RevealBeat = 'drop1' | 'drop2' | 'open' | 'emerge';

interface Step4Stage3DProps {
  active: boolean;
  revealKey: number;
  pokemonImgSrc?: string;
  onBouncingChange?: (bouncing: boolean) => void;
  onRevealBeat?: (beat: RevealBeat) => void;
  onWebGLUnavailable?: () => void;
}

const BALL_DROP_1_S = 0.65;
const BALL_DROP_2_S = 1.18;
const BALL_OPEN_S = 1.6;
const BALL_FADE_END_S = 1.98;
const POKEMON_EMERGE_START_S = 1.74;
const POKEMON_EMERGE_END_S = 2.82;
const BOUNCE_CYCLE_S = 1.875; // 8 cycles = exact 15.0s
const BOUNCE_ACTIVE_WINDOW_S = 15.0;
const BOUNCE_FULL_PERIOD_S = 60.0; // 15s bounce + 45s rest

let cachedSoftwareGl: boolean | null = null;

function detectSoftwareWebGL(): boolean {
  if (cachedSoftwareGl !== null) return cachedSoftwareGl;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) {
      cachedSoftwareGl = true;
      return true;
    }
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    cachedSoftwareGl = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    return cachedSoftwareGl;
  } catch {
    cachedSoftwareGl = true;
    return true;
  }
}

function createRadialShadowTexture(size = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const half = size / 2;
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, 'rgba(3, 7, 18, 0.65)');
    grad.addColorStop(0.55, 'rgba(3, 7, 18, 0.26)');
    grad.addColorStop(1, 'rgba(3, 7, 18, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createCenterBlueGlowTexture(size = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const half = size / 2;
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, 'rgba(224, 242, 254, 0.98)');
    grad.addColorStop(0.32, 'rgba(59, 130, 246, 0.72)');
    grad.addColorStop(0.68, 'rgba(37, 99, 235, 0.25)');
    grad.addColorStop(1, 'rgba(37, 99, 235, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createEnergyDotTexture(size = 64): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const half = size / 2;
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0.0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.28, 'rgba(224, 242, 254, 0.92)');
    grad.addColorStop(0.6, 'rgba(96, 165, 250, 0.45)');
    grad.addColorStop(1.0, 'rgba(59, 130, 246, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createReleaseBeamTexture(size = 192): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, size, 0, 0);
    grad.addColorStop(0.0, 'rgba(255, 255, 255, 0.92)');
    grad.addColorStop(0.28, 'rgba(186, 230, 253, 0.7)');
    grad.addColorStop(0.68, 'rgba(59, 130, 246, 0.28)');
    grad.addColorStop(1.0, 'rgba(59, 130, 246, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function drawDefaultPokemonShadow(canvas: HTMLCanvasElement): void {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const anchorY = h * 0.28;

  // Downward-cast soft shadow penumbra stretching forward onto the front/down side of the disc
  ctx.save();
  ctx.translate(cx, anchorY + h * 0.16);
  ctx.scale(1.12, 0.78);
  const outerGrad = ctx.createRadialGradient(0, 0, 6, 0, 0, w * 0.33);
  outerGrad.addColorStop(0, 'rgba(2, 5, 16, 0.68)');
  outerGrad.addColorStop(0.55, 'rgba(2, 6, 18, 0.34)');
  outerGrad.addColorStop(1, 'rgba(2, 6, 18, 0)');
  ctx.fillStyle = outerGrad;
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.33, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Tight grounded foot contact occlusion directly under the feet
  ctx.save();
  ctx.translate(cx, anchorY + 4);
  ctx.scale(1.05, 0.45);
  const innerGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, w * 0.24);
  innerGrad.addColorStop(0, 'rgba(1, 4, 14, 0.88)');
  innerGrad.addColorStop(0.6, 'rgba(2, 5, 16, 0.42)');
  innerGrad.addColorStop(1, 'rgba(2, 5, 16, 0)');
  ctx.fillStyle = innerGrad;
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.24, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function renderSpriteOverheadShadow(canvas: HTMLCanvasElement, img: HTMLImageElement): boolean {
  const probeSize = 128;
  const probeCanvas = document.createElement('canvas');
  probeCanvas.width = probeSize;
  probeCanvas.height = probeSize;
  const probeCtx = probeCanvas.getContext('2d', { willReadFrequently: true });
  if (!probeCtx) return false;

  probeCtx.clearRect(0, 0, probeSize, probeSize);
  probeCtx.drawImage(img, 0, 0, probeSize, probeSize);

  let pixels: Uint8ClampedArray;
  try {
    pixels = probeCtx.getImageData(0, 0, probeSize, probeSize).data;
  } catch {
    return false;
  }

  let minX = probeSize;
  let maxX = -1;
  let minY = probeSize;
  let maxY = -1;
  for (let y = 0; y < probeSize; y++) {
    for (let x = 0; x < probeSize; x++) {
      const a = pixels[(y * probeSize + x) * 4 + 3];
      if (a > 20) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return false;

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const srcX = (minX / probeSize) * img.naturalWidth;
  const srcY = (minY / probeSize) * img.naturalHeight;
  const srcW = (cropW / probeSize) * img.naturalWidth;
  const srcH = (cropH / probeSize) * img.naturalHeight;

  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  ctx.clearRect(0, 0, w, h);

  // Normalize silhouette footprint so light coming from above projects a foreshortened shadow
  const targetMax = 152;
  const scale = targetMax / Math.max(cropW, cropH);
  const drawW = Math.max(48, cropW * scale);
  const scaledH = cropH * scale;
  const drawH = Math.max(40, Math.min(122, scaledH * 0.44));

  const cx = w / 2;
  const anchorY = h * 0.28;

  const silCanvas = document.createElement('canvas');
  silCanvas.width = 128;
  silCanvas.height = 128;
  const silCtx = silCanvas.getContext('2d');
  if (!silCtx) return false;

  const sc = 128 / w;
  const sCx = cx * sc;
  const sAnchorY = anchorY * sc;
  const sDrawW = drawW * sc;
  const sDrawH = drawH * sc;

  // Flip vertically from the feet downward so the shadow casts onto the down/front side (+Z) of the platform
  silCtx.clearRect(0, 0, 128, 128);
  silCtx.save();
  silCtx.translate(sCx, sAnchorY);
  silCtx.scale(1, -1);
  silCtx.drawImage(img, srcX, srcY, srcW, srcH, -sDrawW / 2, -sDrawH, sDrawW, sDrawH);
  silCtx.restore();
  silCtx.globalCompositeOperation = 'source-in';
  silCtx.fillStyle = '#020512';
  silCtx.fillRect(0, 0, 128, 128);

  // 1. Single soft forward/downward body silhouette shadow across the front of the platform
  ctx.save();
  if ('filter' in ctx) ctx.filter = 'blur(5px)';
  ctx.globalAlpha = 0.72;
  ctx.drawImage(silCanvas, 0, 0, w, h);
  ctx.restore();

  // 3. Tight grounded elliptical foot contact shadow directly at the base
  ctx.save();
  ctx.translate(cx, anchorY + 4);
  ctx.scale(1.0, Math.max(0.32, (drawH * 0.36) / Math.max(24, drawW * 0.44)));
  const rad = Math.max(30, drawW * 0.44);
  const contactGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, rad);
  contactGrad.addColorStop(0, 'rgba(1, 4, 14, 0.88)');
  contactGrad.addColorStop(0.55, 'rgba(2, 5, 16, 0.44)');
  contactGrad.addColorStop(1, 'rgba(2, 5, 16, 0)');
  ctx.fillStyle = contactGrad;
  ctx.beginPath();
  ctx.arc(0, 0, rad, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  return true;
}

function createYellowGradientTexture(size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, size, 0);
    grad.addColorStop(0.0, '#facc15');
    grad.addColorStop(0.25, '#fef08a');
    grad.addColorStop(0.5, '#eab308');
    grad.addColorStop(0.75, '#ca8a04');
    grad.addColorStop(1.0, '#facc15');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, 32);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

function createDiscDeckTexture(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const cx = size / 2;
    const cy = size / 2;

    // Deep solid dark-blue painted arena top (no light blue washout)
    const baseGrad = ctx.createRadialGradient(cx, cy, 8, cx, cy, cx);
    baseGrad.addColorStop(0, '#0f2350');
    baseGrad.addColorStop(0.45, '#0b1a3d');
    baseGrad.addColorStop(0.78, '#07122b');
    baseGrad.addColorStop(1, '#040b1c');
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, size, size);

    // Rich yellow gradient ring band across the middle deck
    const yellowBandGrad = ctx.createRadialGradient(cx, cy, cx * 0.42, cx, cy, cx * 0.86);
    yellowBandGrad.addColorStop(0, 'rgba(202, 138, 4, 0)');
    yellowBandGrad.addColorStop(0.38, 'rgba(250, 204, 21, 0.22)');
    yellowBandGrad.addColorStop(0.62, 'rgba(234, 179, 8, 0.16)');
    yellowBandGrad.addColorStop(1, 'rgba(161, 98, 7, 0)');
    ctx.fillStyle = yellowBandGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, cx * 0.86, 0, Math.PI * 2);
    ctx.fill();

    // Outer dark blue track ring
    ctx.strokeStyle = '#1e3a8a';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(cx, cy, cx * 0.87, 0, Math.PI * 2);
    ctx.stroke();

    // Mid ring with linear yellow gradient (light lemon -> gold -> amber)
    const yellowStrokeGrad = ctx.createLinearGradient(0, 0, size, size);
    yellowStrokeGrad.addColorStop(0, '#fef08a');
    yellowStrokeGrad.addColorStop(0.45, '#facc15');
    yellowStrokeGrad.addColorStop(0.75, '#eab308');
    yellowStrokeGrad.addColorStop(1, '#ca8a04');

    ctx.strokeStyle = yellowStrokeGrad;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, cx * 0.65, 0, Math.PI * 2);
    ctx.stroke();

    // Inner Poké-arena center circle & horizontal split line in dark blue + yellow highlight
    ctx.strokeStyle = '#1d3b82';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, cx * 0.31, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = yellowStrokeGrad;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx - cx * 0.63, cy);
    ctx.lineTo(cx - cx * 0.31, cy);
    ctx.moveTo(cx + cx * 0.31, cy);
    ctx.lineTo(cx + cx * 0.63, cy);
    ctx.stroke();

    // Crisp radial graduation ticks in yellow gradient
    const ticks = 36;
    for (let i = 0; i < ticks; i++) {
      const angle = (i / ticks) * Math.PI * 2;
      const isMajor = i % 3 === 0;
      const r0 = cx * (isMajor ? 0.74 : 0.79);
      const r1 = cx * 0.84;
      ctx.strokeStyle = isMajor ? '#fde047' : '#ca8a04';
      ctx.lineWidth = isMajor ? 4 : 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * r0, cy + Math.sin(angle) * r0);
      ctx.lineTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export const Step4Stage3D: React.FC<Step4Stage3DProps> = ({
  active,
  revealKey,
  pokemonImgSrc,
  onBouncingChange,
  onRevealBeat,
  onWebGLUnavailable,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef(active);
  const startTimeRef = useRef(performance.now());
  const wakeRef = useRef<(() => void) | null>(null);
  const updatePokemonShadowRef = useRef<((src?: string) => void) | null>(null);
  const latestImgSrcRef = useRef(pokemonImgSrc);
  const onBouncingChangeRef = useRef(onBouncingChange);
  const onRevealBeatRef = useRef(onRevealBeat);
  const onWebGLUnavailableRef = useRef(onWebGLUnavailable);
  const isBouncingRef = useRef(false);
  const bounceAudioStateRef = useRef<{ hopCycle: number; bounceCycle: number }>({
    hopCycle: -1,
    bounceCycle: -1,
  });
  const revealBeatsFiredRef = useRef<Record<RevealBeat, boolean>>({
    drop1: false,
    drop2: false,
    open: false,
    emerge: false,
  });

  activeRef.current = active;
  latestImgSrcRef.current = pokemonImgSrc;
  onBouncingChangeRef.current = onBouncingChange;
  onRevealBeatRef.current = onRevealBeat;
  onWebGLUnavailableRef.current = onWebGLUnavailable;

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const disposables: Array<{ dispose: () => void }> = [];
    const track = <T extends { dispose: () => void }>(item: T): T => {
      disposables.push(item);
      return item;
    };

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        alpha: true,
        powerPreference: 'high-performance',
      });
      if (!renderer.getContext()) {
        onWebGLUnavailableRef.current?.();
        return;
      }
    } catch {
      onWebGLUnavailableRef.current?.();
      return;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.shadowMap.enabled = false;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.pointerEvents = 'none';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    renderer.setSize(width, height, false);

    // Tilted 3D studio camera showing a wide, solid 3D disc pedestal
    const BASE_CAM_Y = 2.95;
    const BASE_CAM_Z = 6.05;
    const camera = new THREE.PerspectiveCamera(39, width / height, 0.1, 40);
    camera.position.set(0, BASE_CAM_Y, BASE_CAM_Z);
    camera.lookAt(0, 0.36, 0);

    // Balanced 4-light studio rig (zero PMREM / zero shadowMap pass stall)
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x050c1d, 1.15);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfffbeb, 1.72);
    keyLight.position.set(1.3, 6.2, 2.8);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xe0f2fe, 0.65);
    fillLight.position.set(2.4, 2.6, 2.8);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x60a5fa, 0.78);
    rimLight.position.set(-2.8, 2.4, -3.0);
    scene.add(rimLight);

    const maxAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());

    // =========================================================================
    // 1. LARGE SOLID 3D DISC PEDESTAL (Deep Dark Blue + Yellow Gradient)
    // =========================================================================
    const platformGroup = new THREE.Group();
    platformGroup.position.set(0, -0.66, 0);
    platformGroup.scale.setScalar(1.06);
    scene.add(platformGroup);

    // 1a. Solid lathe-turned stepped 3D pedestal base body (deep dark navy-blue)
    const discProfile = [
      new THREE.Vector2(0.0, -0.28),
      new THREE.Vector2(1.36, -0.28),
      new THREE.Vector2(1.45, -0.22),
      new THREE.Vector2(1.48, -0.13),
      new THREE.Vector2(1.56, -0.06),
      new THREE.Vector2(1.58, 0.0),
      new THREE.Vector2(1.48, 0.02),
      new THREE.Vector2(0.0, 0.02),
    ];
    const discBodyGeo = track(new THREE.LatheGeometry(discProfile, 48));
    const discBodyMat = track(
      new THREE.MeshPhongMaterial({
        color: 0x07132e,
        emissive: 0x020614,
        specular: 0x1e3a8a,
        shininess: 22,
      })
    );
    const discBodyMesh = new THREE.Mesh(discBodyGeo, discBodyMat);
    platformGroup.add(discBodyMesh);

    // 1b. Flat planar top deck disc with dark blue base & yellow gradient track
    const discDeckTex = track(createDiscDeckTexture(512));
    discDeckTex.anisotropy = maxAniso;
    const topDeckGeo = track(new THREE.CircleGeometry(1.47, 72));
    const topDeckMat = track(
      new THREE.MeshPhongMaterial({
        color: 0xffffff,
        map: discDeckTex,
        specular: 0x334155,
        shininess: 18,
      })
    );
    const topDeckMesh = new THREE.Mesh(topDeckGeo, topDeckMat);
    topDeckMesh.rotation.x = -Math.PI / 2;
    topDeckMesh.position.y = 0.022;
    platformGroup.add(topDeckMesh);

    // 1c. Solid matte deep dark-blue tapered side skirt
    const lowerCollarGeo = track(new THREE.CylinderGeometry(1.565, 1.445, 0.16, 64, 1, false));
    const lowerCollarMat = track(
      new THREE.MeshPhongMaterial({
        color: 0x0c1e4a,
        emissive: 0x03091a,
        specular: 0x2563eb,
        shininess: 28,
      })
    );
    const lowerCollarMesh = new THREE.Mesh(lowerCollarGeo, lowerCollarMat);
    lowerCollarMesh.position.y = -0.14;
    platformGroup.add(lowerCollarMesh);

    // 1d. Solid 3D Dark Blue Outer Rim Ring (#172e6e)
    const outerBlueGroup = new THREE.Group();
    outerBlueGroup.position.y = 0.026;
    platformGroup.add(outerBlueGroup);

    const outerRingGeo = track(new THREE.TorusGeometry(1.49, 0.042, 20, 96));
    const outerRingMat = track(
      new THREE.MeshPhongMaterial({
        color: 0x172e6e,
        emissive: 0x081436,
        specular: 0x60a5fa,
        shininess: 42,
      })
    );
    const outerRingMesh = new THREE.Mesh(outerRingGeo, outerRingMat);
    outerRingMesh.rotation.x = Math.PI / 2;
    outerBlueGroup.add(outerRingMesh);

    // 1e. Solid 3D Yellow-Gradient Mid Ring (warm yellow -> gold -> amber gradient)
    const yellowGradTex = track(createYellowGradientTexture(256));
    yellowGradTex.anisotropy = maxAniso;

    const midGoldGroup = new THREE.Group();
    midGoldGroup.position.y = 0.032;
    platformGroup.add(midGoldGroup);

    const midRingGeo = track(new THREE.TorusGeometry(1.01, 0.03, 20, 84));
    const midRingMat = track(
      new THREE.MeshPhongMaterial({
        color: 0xffffff,
        map: yellowGradTex,
        emissive: 0x422006,
        emissiveIntensity: 0.3,
        specular: 0xfef9c3,
        shininess: 68,
      })
    );
    const midRingMesh = new THREE.Mesh(midRingGeo, midRingMat);
    midRingMesh.rotation.x = Math.PI / 2;
    midGoldGroup.add(midRingMesh);

    // 1f. Lower yellow-gradient trim ring around bottom base chamfer
    const lowerTrimGeo = track(new THREE.TorusGeometry(1.445, 0.02, 12, 72));
    const lowerTrimMesh = new THREE.Mesh(lowerTrimGeo, midRingMat);
    lowerTrimMesh.rotation.x = Math.PI / 2;
    lowerTrimMesh.position.y = -0.22;
    platformGroup.add(lowerTrimMesh);

    // 1g. 4 solid raised yellow-gradient arc segments on top deck
    const arcGeo = track(new THREE.TorusGeometry(1.24, 0.018, 10, 24, Math.PI * 0.26));
    const arcMat = track(
      new THREE.MeshPhongMaterial({
        color: 0xffffff,
        map: yellowGradTex,
        emissive: 0x422006,
        emissiveIntensity: 0.25,
        specular: 0xfef08a,
        shininess: 58,
      })
    );
    const orbitArcsGroup = new THREE.Group();
    orbitArcsGroup.position.y = 0.028;
    for (let i = 0; i < 4; i++) {
      const arc = new THREE.Mesh(arcGeo, arcMat);
      arc.rotation.x = Math.PI / 2;
      arc.rotation.z = (i * Math.PI) / 2;
      orbitArcsGroup.add(arc);
    }
    platformGroup.add(orbitArcsGroup);

    // 1h. Solid deep dark-blue center inlay pad & reactive blue touchdown glow
    const centerPadGeo = track(new THREE.CylinderGeometry(0.45, 0.48, 0.018, 48));
    const centerPadMat = track(
      new THREE.MeshPhongMaterial({
        color: 0x0d2152,
        emissive: new THREE.Color(0x2563eb),
        emissiveIntensity: 0,
        specular: 0x60a5fa,
        shininess: 35,
      })
    );
    const centerPadMesh = new THREE.Mesh(centerPadGeo, centerPadMat);
    centerPadMesh.position.y = 0.026;
    platformGroup.add(centerPadMesh);

    const centerGlowTex = track(createCenterBlueGlowTexture(128));
    const centerGlowGeo = track(new THREE.CircleGeometry(0.72, 48));
    const centerGlowMat = track(
      new THREE.MeshBasicMaterial({
        map: centerGlowTex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    const centerGlowMesh = new THREE.Mesh(centerGlowGeo, centerGlowMat);
    centerGlowMesh.rotation.x = -Math.PI / 2;
    centerGlowMesh.position.y = 0.0365;
    centerGlowMesh.renderOrder = 1;
    platformGroup.add(centerGlowMesh);

    const centerPulseRingGeo = track(new THREE.RingGeometry(0.36, 0.45, 48));
    const centerPulseRingMat = track(
      new THREE.MeshBasicMaterial({
        color: 0x60a5fa,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    const centerPulseRingMesh = new THREE.Mesh(centerPulseRingGeo, centerPulseRingMat);
    centerPulseRingMesh.rotation.x = -Math.PI / 2;
    centerPulseRingMesh.position.y = 0.0372;
    centerPulseRingMesh.renderOrder = 1;
    platformGroup.add(centerPulseRingMesh);

    const centerGlowLight = new THREE.PointLight(0x3b82f6, 0, 1.9, 2);
    centerGlowLight.position.set(0, 0.22, 0);
    platformGroup.add(centerGlowLight);

    const shadowTex = track(createRadialShadowTexture(128));
    const contactShadowGeo = track(new THREE.PlaneGeometry(1.15, 1.15));
    const contactShadowMat = track(
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
    const contactShadowMesh = new THREE.Mesh(contactShadowGeo, contactShadowMat);
    contactShadowMesh.rotation.x = -Math.PI / 2;
    contactShadowMesh.position.y = 0.037;
    platformGroup.add(contactShadowMesh);

    // 1i. Downward-cast Pokémon silhouette + foot contact shadow on the front/down side of the disc
    const pokemonShadowCanvas = document.createElement('canvas');
    pokemonShadowCanvas.width = 256;
    pokemonShadowCanvas.height = 256;
    drawDefaultPokemonShadow(pokemonShadowCanvas);

    const pokemonShadowTex = track(new THREE.CanvasTexture(pokemonShadowCanvas));
    pokemonShadowTex.colorSpace = THREE.SRGBColorSpace;
    pokemonShadowTex.anisotropy = maxAniso;
    pokemonShadowTex.needsUpdate = true;

    const pokemonShadowGeo = track(new THREE.PlaneGeometry(1.65, 1.55));
    // Shift anchorY (0.28 * h) to the mesh origin so scaling keeps feet pinned at platform center while shadow extends forward/down (+Z)
    pokemonShadowGeo.translate(0, -0.34, 0);
    const pokemonShadowMat = track(
      new THREE.MeshBasicMaterial({
        map: pokemonShadowTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    );
    const pokemonShadowMesh = new THREE.Mesh(pokemonShadowGeo, pokemonShadowMat);
    pokemonShadowMesh.rotation.x = -Math.PI / 2;
    pokemonShadowMesh.position.set(0, 0.039, 0);
    pokemonShadowMesh.renderOrder = 2;
    platformGroup.add(pokemonShadowMesh);

    let shadowRequestToken = 0;
    const applyPokemonShadowSrc = (src?: string) => {
      const token = ++shadowRequestToken;
      if (!src) {
        drawDefaultPokemonShadow(pokemonShadowCanvas);
        pokemonShadowTex.needsUpdate = true;
        return;
      }

      const img = new Image();
      if (/^https?:\/\//i.test(src)) {
        img.crossOrigin = 'anonymous';
      }
      img.onload = () => {
        if (disposed || token !== shadowRequestToken) return;
        const ok = renderSpriteOverheadShadow(pokemonShadowCanvas, img);
        if (!ok) {
          drawDefaultPokemonShadow(pokemonShadowCanvas);
        }
        pokemonShadowTex.needsUpdate = true;
      };
      img.onerror = () => {
        if (disposed || token !== shadowRequestToken) return;
        drawDefaultPokemonShadow(pokemonShadowCanvas);
        pokemonShadowTex.needsUpdate = true;
      };
      img.src = src;
    };

    updatePokemonShadowRef.current = applyPokemonShadowSrc;
    applyPokemonShadowSrc(latestImgSrcRef.current);

    // =========================================================================
    // 2. COMPOSITE 3D POKEBALL (Multi-part PBR Shells + Equatorial Band + Latch)
    // =========================================================================
    const BALL_R = 0.42;
    const ballRoot = new THREE.Group();
    const BALL_REST_Y = platformGroup.position.y + 0.035 * 1.06 + BALL_R;
    ballRoot.position.set(0, BALL_REST_Y + 2.85, 0);
    scene.add(ballRoot);

    const ballFadeMaterials: Array<{ mat: THREE.Material; baseOpacity: number }> = [];
    const registerFade = <T extends THREE.Material>(mat: T, baseOpacity = 1): T => {
      ballFadeMaterials.push({ mat, baseOpacity });
      return mat;
    };

    const innerCoreGeo = track(new THREE.SphereGeometry(BALL_R * 0.9, 32, 24));
    const innerCoreMat = registerFade(
      track(
        new THREE.MeshPhongMaterial({
          color: 0x0b101b,
          specular: 0x475569,
          shininess: 38,
          transparent: true,
          opacity: 1,
        })
      )
    );
    const innerCoreMesh = new THREE.Mesh(innerCoreGeo, innerCoreMat);
    ballRoot.add(innerCoreMesh);

    const energyCoreGeo = track(new THREE.SphereGeometry(BALL_R * 0.56, 24, 18));
    const energyCoreMat = registerFade(
      track(
        new THREE.MeshBasicMaterial({
          color: 0xe0f2fe,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      ),
      0
    );
    const energyCoreMesh = new THREE.Mesh(energyCoreGeo, energyCoreMat);
    ballRoot.add(energyCoreMesh);

    // Procedural Release Beam Cone rising from the pedestal when Pokéball pops open
    const releaseBeamTex = track(createReleaseBeamTexture(192));
    const releaseBeamGeo = track(new THREE.CylinderGeometry(0.95, 0.24, 1.9, 28, 1, true));
    releaseBeamGeo.translate(0, 0.95, 0);
    const releaseBeamMat = track(
      new THREE.MeshBasicMaterial({
        map: releaseBeamTex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    const releaseBeamMesh = new THREE.Mesh(releaseBeamGeo, releaseBeamMat);
    releaseBeamMesh.position.y = 0.04;
    releaseBeamMesh.visible = false;
    platformGroup.add(releaseBeamMesh);

    // Spiraling Materialization Energy Particles forming the Pokémon silhouette
    const PARTICLE_COUNT = 28;
    const particleMeta = Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
      phase: (i / PARTICLE_COUNT) * Math.PI * 2,
      speed: 3.4 + (i % 5) * 0.55,
      radiusBias: 0.45 + ((i * 7) % 11) * 0.045,
      heightBias: 0.72 + ((i * 3) % 7) * 0.11,
      delay: (i % 9) * 0.025,
    }));
    const particlePositions = new Float32Array(PARTICLE_COUNT * 3);
    const particleGeo = track(new THREE.BufferGeometry());
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const particleDotTex = track(createEnergyDotTexture(64));
    const particleMat = track(
      new THREE.PointsMaterial({
        map: particleDotTex,
        color: 0xe0f2fe,
        size: 0.24,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      })
    );
    const energyParticles = new THREE.Points(particleGeo, particleMat);
    energyParticles.visible = false;
    scene.add(energyParticles);

    const topHingeGroup = new THREE.Group();
    topHingeGroup.position.set(0, 0, -BALL_R * 0.88);
    ballRoot.add(topHingeGroup);

    const topShellMat = registerFade(
      track(
        new THREE.MeshPhongMaterial({
          color: 0xe11d48,
          emissive: 0x3b0712,
          emissiveIntensity: 0.35,
          specular: 0xffd6dd,
          shininess: 115,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 1,
        })
      )
    );
    const topHemGeo = track(
      new THREE.SphereGeometry(BALL_R, 44, 22, 0, Math.PI * 2, 0, Math.PI * 0.472)
    );
    const topHemMesh = new THREE.Mesh(topHemGeo, topShellMat);
    topHemMesh.position.set(0, 0, BALL_R * 0.88);
    topHingeGroup.add(topHemMesh);

    const topLipGeo = track(new THREE.TorusGeometry(BALL_R * 0.992, 0.022, 14, 64));
    const darkBandMat = registerFade(
      track(
        new THREE.MeshPhongMaterial({
          color: 0x090d16,
          specular: 0x64748b,
          shininess: 52,
          transparent: true,
          opacity: 1,
        })
      )
    );
    const topLipMesh = new THREE.Mesh(topLipGeo, darkBandMat);
    topLipMesh.rotation.x = Math.PI / 2;
    topLipMesh.position.set(0, BALL_R * 0.055, BALL_R * 0.88);
    topHingeGroup.add(topLipMesh);

    const bottomHingeGroup = new THREE.Group();
    bottomHingeGroup.position.set(0, 0, -BALL_R * 0.88);
    ballRoot.add(bottomHingeGroup);

    const bottomShellMat = registerFade(
      track(
        new THREE.MeshPhongMaterial({
          color: 0xf8fafc,
          emissive: 0x1e293b,
          emissiveIntensity: 0.14,
          specular: 0xffffff,
          shininess: 105,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 1,
        })
      )
    );
    const bottomHemGeo = track(
      new THREE.SphereGeometry(
        BALL_R,
        44,
        22,
        0,
        Math.PI * 2,
        Math.PI * 0.528,
        Math.PI * 0.472
      )
    );
    const bottomHemMesh = new THREE.Mesh(bottomHemGeo, bottomShellMat);
    bottomHemMesh.position.set(0, 0, BALL_R * 0.88);
    bottomHingeGroup.add(bottomHemMesh);

    const bottomLipMesh = new THREE.Mesh(topLipGeo, darkBandMat);
    bottomLipMesh.rotation.x = Math.PI / 2;
    bottomLipMesh.position.set(0, -BALL_R * 0.055, BALL_R * 0.88);
    bottomHingeGroup.add(bottomLipMesh);

    const eqBandGeo = track(
      new THREE.CylinderGeometry(BALL_R * 0.96, BALL_R * 0.96, BALL_R * 0.14, 48, 1, false)
    );
    const eqBandMesh = new THREE.Mesh(eqBandGeo, darkBandMat);
    ballRoot.add(eqBandMesh);

    const frontLatchGroup = new THREE.Group();
    frontLatchGroup.position.set(0, 0, BALL_R * 0.97);
    ballRoot.add(frontLatchGroup);

    const bezelGeo = track(new THREE.CylinderGeometry(BALL_R * 0.27, BALL_R * 0.29, 0.055, 36));
    const bezelMesh = new THREE.Mesh(bezelGeo, darkBandMat);
    bezelMesh.rotation.x = Math.PI / 2;
    frontLatchGroup.add(bezelMesh);

    const outerRimGeo = track(new THREE.TorusGeometry(BALL_R * 0.19, 0.018, 12, 36));
    const chromeMat = registerFade(
      track(
        new THREE.MeshPhongMaterial({
          color: 0xdbeafe,
          specular: 0xffffff,
          shininess: 95,
          transparent: true,
          opacity: 1,
        })
      )
    );
    const outerRimMesh = new THREE.Mesh(outerRimGeo, chromeMat);
    outerRimMesh.position.z = 0.025;
    frontLatchGroup.add(outerRimMesh);

    const buttonCapGeo = track(new THREE.CylinderGeometry(BALL_R * 0.15, BALL_R * 0.16, 0.045, 32));
    const buttonCapMat = registerFade(
      track(
        new THREE.MeshPhongMaterial({
          color: 0xffffff,
          emissive: 0x38bdf8,
          emissiveIntensity: 0.12,
          specular: 0xffffff,
          shininess: 110,
          transparent: true,
          opacity: 1,
        })
      )
    );
    const buttonCapMesh = new THREE.Mesh(buttonCapGeo, buttonCapMat);
    buttonCapMesh.rotation.x = Math.PI / 2;
    buttonCapMesh.position.z = 0.028;
    frontLatchGroup.add(buttonCapMesh);

    const backHingeGeo = track(new THREE.BoxGeometry(0.14, 0.09, 0.06));
    const backHingeMesh = new THREE.Mesh(backHingeGeo, darkBandMat);
    backHingeMesh.position.set(0, 0, -BALL_R * 0.97);
    ballRoot.add(backHingeMesh);

    // =========================================================================
    // 3. ANIMATION LOOP (Synchronized with Step4Success sound + reveal beats)
    // =========================================================================
    let rafId = 0;
    let timeoutId = 0;
    let disposed = false;
    let contextLost = false;
    let isLoopRunning = false;

    const cancelScheduledFrame = () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
      if (timeoutId) {
        window.clearTimeout(timeoutId);
        timeoutId = 0;
      }
    };

    const handleResize = () => {
      if (disposed || !container) return;
      const w = Math.max(container.clientWidth, 1);
      const h = Math.max(container.clientHeight, 1);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || gl.isContextLost?.() || typeof gl.fenceSync !== 'function') {
        timeoutId = window.setTimeout(cb, 33);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed || contextLost || gl.isContextLost?.()) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          timeoutId = window.setTimeout(poll, 4);
        } else {
          if (sync) gl.deleteSync(sync);
          timeoutId = window.setTimeout(cb, 33);
        }
      };
      timeoutId = window.setTimeout(poll, 4);
    };

    const smoothStep = (x: number) => {
      const c = Math.max(0, Math.min(1, x));
      return c * c * (3 - 2 * c);
    };

    const fireBeat = (beat: RevealBeat) => {
      if (revealBeatsFiredRef.current[beat]) return;
      revealBeatsFiredRef.current[beat] = true;
      onRevealBeatRef.current?.(beat);
    };

    let lastFrameTs = performance.now();
    let hiddenStartedAt = 0;

    const updateScene = (rawT: number, dt: number) => {
      const t = prefersReducedMotion ? Math.max(rawT, POKEMON_EMERGE_END_S) : rawT;

      if (prefersReducedMotion) {
        revealBeatsFiredRef.current.drop1 = true;
        revealBeatsFiredRef.current.drop2 = true;
        fireBeat('open');
        fireBeat('emerge');
      } else {
        if (t >= BALL_DROP_1_S) fireBeat('drop1');
        if (t >= BALL_DROP_2_S) fireBeat('drop2');
        if (t >= BALL_OPEN_S) fireBeat('open');
        if (t >= POKEMON_EMERGE_START_S) fireBeat('emerge');
      }

      // Slow turntable rotation on outer deck accents
      orbitArcsGroup.rotation.y = prefersReducedMotion ? 0 : t * 0.32;

      // Subtle tactile disc compression/rebound + camera jolt on heavy Pokeball impacts
      let discImpact = 0;
      let camImpactJolt = 0;
      let impactRingProgress = -1;
      let centerTouchGlow = 0;

      if (t >= BALL_DROP_1_S && t < BALL_DROP_1_S + 0.3) {
        const p = (t - BALL_DROP_1_S) / 0.3;
        discImpact = Math.sin(Math.min(1, p * 1.4) * Math.PI) * (1 - p * 0.35) * 1.25;
        camImpactJolt = Math.sin(p * Math.PI * 2.2) * Math.exp(-p * 5.2) * 0.055;
        impactRingProgress = p;
        centerTouchGlow = Math.max(centerTouchGlow, (1 - p) * 0.75);
      } else if (t >= BALL_DROP_2_S && t < BALL_DROP_2_S + 0.24) {
        const p = (t - BALL_DROP_2_S) / 0.24;
        discImpact = Math.sin(Math.min(1, p * 1.4) * Math.PI) * 0.58 * (1 - p * 0.45);
        camImpactJolt = Math.sin(p * Math.PI * 2.0) * Math.exp(-p * 5.5) * 0.025;
        impactRingProgress = p;
        centerTouchGlow = Math.max(centerTouchGlow, (1 - p) * 0.48);
      }

      if (t < BALL_OPEN_S) {
        ballRoot.visible = true;
        topHingeGroup.rotation.x = 0;
        bottomHingeGroup.rotation.x = 0;
        energyCoreMat.opacity = 0;
        releaseBeamMesh.visible = false;
        releaseBeamMat.opacity = 0;
        ballFadeMaterials.forEach(({ mat, baseOpacity }) => {
          if (mat !== energyCoreMat) mat.opacity = baseOpacity;
        });

        let yOffset = 0;
        let tiltZ = 0;
        let squashX = 1;
        let squashY = 1;

        if (t < BALL_DROP_1_S) {
          // Visible weighty drop from top edge of stage down onto center pad
          const p = t / BALL_DROP_1_S;
          const accel = Math.pow(p, 2.05);
          yOffset = (1 - accel) * 2.85;
          tiltZ = -0.2 * (1 - p * 0.9);
          squashX = 1 - 0.035 * p * p;
          squashY = 1 + 0.07 * p * p;
          buttonCapMat.emissiveIntensity = 0.12;
        } else if (t < BALL_DROP_2_S) {
          // Contact squash compression -> ONE clear ballistic gravity bounce on stage
          const dur = BALL_DROP_2_S - BALL_DROP_1_S;
          const p = (t - BALL_DROP_1_S) / dur;
          const squashWindow = 0.13;
          if (p < squashWindow) {
            const sp = Math.sin((p / squashWindow) * Math.PI);
            yOffset = 0;
            squashX = 1 + sp * 0.24;
            squashY = 1 - sp * 0.22;
            tiltZ = sp * 0.03;
          } else {
            const u = (p - squashWindow) / (1 - squashWindow);
            yOffset = 4 * u * (1 - u) * 0.66;
            const launchStretch = u < 0.2 ? Math.sin((u / 0.2) * Math.PI * 0.5) * (1 - u / 0.2) : 0;
            squashX = 1 - launchStretch * 0.05;
            squashY = 1 + launchStretch * 0.1;
            tiltZ = Math.sin(u * Math.PI) * 0.14;
          }
          buttonCapMat.emissiveIntensity = 0.3 + p * 0.28;
        } else {
          // Firm planted settle on Pokéball before opening to reveal Pokémon
          const dur = BALL_OPEN_S - BALL_DROP_2_S;
          const p = (t - BALL_DROP_2_S) / dur;
          yOffset = 0;
          if (p < 0.34) {
            const sp = p / 0.34;
            const damp = Math.sin(sp * Math.PI) * (1 - sp * 0.45);
            squashX = 1 + damp * 0.15;
            squashY = 1 - damp * 0.14;
            tiltZ = Math.sin(sp * Math.PI) * -0.045;
          } else if (p < 0.62) {
            tiltZ = 0;
          } else {
            const wiggle = (p - 0.62) / 0.38;
            tiltZ = Math.sin(wiggle * Math.PI * 3.5) * 0.11 * wiggle;
          }
          buttonCapMat.emissiveIntensity = 0.52 + Math.sin(p * Math.PI * 3) * 0.48;
        }

        ballRoot.position.y = BALL_REST_Y + yOffset;
        ballRoot.rotation.set(0.14, Math.sin(t * 1.4) * 0.14, tiltZ);
        ballRoot.scale.set(squashX, squashY, squashX);

        const distFactor = Math.max(0.15, 1 - yOffset / 2.2);
        contactShadowMesh.scale.setScalar(0.45 + 0.55 * distFactor);
        contactShadowMat.opacity = 0.65 * distFactor;
      } else if (t < BALL_FADE_END_S) {
        const p = (t - BALL_OPEN_S) / (BALL_FADE_END_S - BALL_OPEN_S);
        const easeOut = 1 - Math.pow(1 - p, 3);
        ballRoot.visible = true;
        ballRoot.position.y = BALL_REST_Y + easeOut * 0.12;
        ballRoot.rotation.set(0.12, 0, 0);
        ballRoot.scale.setScalar(1 + easeOut * 0.18);

        topHingeGroup.rotation.x = -easeOut * 1.45;
        bottomHingeGroup.rotation.x = easeOut * 0.95;
        buttonCapMat.emissiveIntensity = 1.1;

        const flash = Math.sin(Math.min(1, p * 1.6) * Math.PI);
        energyCoreMat.opacity = Math.max(0, flash * 0.78);
        energyCoreMesh.scale.setScalar(0.65 + easeOut * 0.6);

        releaseBeamMesh.visible = true;
        releaseBeamMat.opacity = Math.max(0, Math.sin(p * Math.PI) * 0.62);
        releaseBeamMesh.scale.set(0.75 + easeOut * 0.45, 0.45 + easeOut * 0.65, 0.75 + easeOut * 0.45);
        impactRingProgress = p;

        const fade = Math.max(0, 1 - Math.max(0, (p - 0.25) / 0.75));
        ballFadeMaterials.forEach(({ mat, baseOpacity }) => {
          if (mat !== energyCoreMat) mat.opacity = baseOpacity * fade;
        });

        contactShadowMat.opacity = 0.65 * fade;
      } else {
        ballRoot.visible = false;
        contactShadowMat.opacity = 0;
        if (t < BALL_FADE_END_S + 0.22) {
          const tail = 1 - (t - BALL_FADE_END_S) / 0.22;
          releaseBeamMesh.visible = true;
          releaseBeamMat.opacity = Math.max(0, tail * 0.25);
        } else {
          releaseBeamMesh.visible = false;
          releaseBeamMat.opacity = 0;
        }
      }

      // Spiraling materialization energy particles (1.60s -> 2.88s)
      const ENERGY_END_S = 2.88;
      if (!prefersReducedMotion && t >= BALL_OPEN_S && t < ENERGY_END_S) {
        const bp = (t - BALL_OPEN_S) / (ENERGY_END_S - BALL_OPEN_S);

        energyParticles.visible = true;
        particleMat.opacity = Math.max(0, Math.sin(Math.min(1, bp) * Math.PI) * 0.95);
        const posAttr = particleGeo.getAttribute('position') as THREE.BufferAttribute;
        const arr = posAttr.array as Float32Array;
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          const meta = particleMeta[i];
          const lp = Math.max(0, Math.min(1, (bp - meta.delay) / 0.82));
          const rise = 1 - Math.pow(1 - lp, 2);
          const radialEnvelope = Math.sin(lp * Math.PI) * meta.radiusBias * (1 - lp * 0.42);
          const theta = meta.phase + lp * meta.speed * Math.PI;
          arr[i * 3] = Math.cos(theta) * radialEnvelope;
          arr[i * 3 + 1] = BALL_REST_Y - 0.05 + rise * 1.95 * meta.heightBias;
          arr[i * 3 + 2] = Math.sin(theta) * radialEnvelope;
        }
        posAttr.needsUpdate = true;
      } else {
        energyParticles.visible = false;
        particleMat.opacity = 0;
      }

      // Downward-cast Pokémon shadow + reactive blue platform center glow synced with 15s-on / 45s-rest cycle
      if (t < POKEMON_EMERGE_START_S) {
        if (isBouncingRef.current) {
          isBouncingRef.current = false;
          onBouncingChangeRef.current?.(false);
        }
        pokemonShadowMesh.visible = false;
        pokemonShadowMat.opacity = 0;
        if (t >= BALL_OPEN_S) {
          centerTouchGlow = Math.max(centerTouchGlow, 0.72);
        }
      } else if (t < POKEMON_EMERGE_END_S) {
        if (isBouncingRef.current) {
          isBouncingRef.current = false;
          onBouncingChangeRef.current?.(false);
        }
        const p = (t - POKEMON_EMERGE_START_S) / (POKEMON_EMERGE_END_S - POKEMON_EMERGE_START_S);
        const easeOut = 1 - Math.pow(1 - p, 3);
        pokemonShadowMesh.visible = true;
        pokemonShadowMesh.position.set(0, 0.039, 0);
        pokemonShadowMesh.scale.setScalar(0.28 + 0.72 * easeOut);
        pokemonShadowMat.opacity = 0.94 * easeOut;

        centerTouchGlow = p < 0.65 ? 0.75 * (1 - p * 0.45) : 0.45 + 0.35 * ((p - 0.65) / 0.35);
      } else if (prefersReducedMotion) {
        if (isBouncingRef.current) {
          isBouncingRef.current = false;
          onBouncingChangeRef.current?.(false);
        }
        pokemonShadowMesh.visible = true;
        pokemonShadowMesh.position.set(0, 0.039, 0);
        pokemonShadowMesh.scale.setScalar(1);
        pokemonShadowMat.opacity = 0.94;
        centerTouchGlow = 0.35;
      } else {
        const sinceEmerge = t - POKEMON_EMERGE_END_S;
        const minuteWindowIdx = Math.floor(sinceEmerge / BOUNCE_FULL_PERIOD_S);
        const windowPos = sinceEmerge % BOUNCE_FULL_PERIOD_S;
        const bouncingActive = windowPos < BOUNCE_ACTIVE_WINDOW_S;

        if (bouncingActive !== isBouncingRef.current) {
          isBouncingRef.current = bouncingActive;
          onBouncingChangeRef.current?.(bouncingActive);
        }

        if (bouncingActive) {
          const cycleInWindow = Math.floor(windowPos / BOUNCE_CYCLE_S);
          const globalCycleIdx = minuteWindowIdx * 100 + cycleInWindow;
          const p = (windowPos % BOUNCE_CYCLE_S) / BOUNCE_CYCLE_S;

          if (p >= 0.08 && p < 0.24 && bounceAudioStateRef.current.hopCycle !== globalCycleIdx) {
            bounceAudioStateRef.current.hopCycle = globalCycleIdx;
            playSound('pokemonHop', 0.11);
          }
          if (p >= 0.55 && p < 0.72 && bounceAudioStateRef.current.bounceCycle !== globalCycleIdx) {
            bounceAudioStateRef.current.bounceCycle = globalCycleIdx;
            playSound('pokemonBounce', 0.28);
          }

          let jumpLift = 0;
          if (p >= 0.08 && p < 0.34) {
            jumpLift = smoothStep((p - 0.08) / (0.34 - 0.08));
          } else if (p >= 0.34 && p < 0.58) {
            jumpLift = 1 - smoothStep((p - 0.34) / (0.58 - 0.34));
          } else if (p >= 0.61 && p < 0.68) {
            jumpLift = 0.14 * smoothStep((p - 0.61) / 0.07);
          } else if (p >= 0.68 && p < 0.76) {
            jumpLift = 0.14 * (1 - smoothStep((p - 0.68) / 0.08));
          }

          let shadowSquash = 0;
          if (p < 0.12) {
            shadowSquash = 0.05 * Math.sin((p / 0.12) * Math.PI);
          } else if (p >= 0.55 && p < 0.65) {
            shadowSquash = 0.08 * Math.sin(((p - 0.55) / 0.1) * Math.PI);
          }

          pokemonShadowMesh.visible = true;
          pokemonShadowMesh.position.set(0, 0.039, 0.05 * jumpLift);
          pokemonShadowMesh.scale.set(
            1 + shadowSquash - 0.28 * jumpLift,
            1 + shadowSquash * 0.6 - 0.34 * jumpLift,
            1
          );
          pokemonShadowMat.opacity = Math.max(0.38, 0.95 - 0.5 * jumpLift);

          if (p >= 0.55 && p < 0.78) {
            const ip = (p - 0.55) / 0.23;
            centerTouchGlow =
              0.35 + 0.65 * Math.sin(Math.min(1, ip * 1.45) * Math.PI * 0.5) * (1 - ip * 0.5);
            impactRingProgress = ip;
            discImpact = Math.max(discImpact, Math.sin(Math.min(1, ip * 2.2) * Math.PI) * 0.42);
          } else if (p >= 0.78) {
            const sp = (p - 0.78) / 0.22;
            centerTouchGlow = 0.42 * (1 - sp * 0.4);
          } else if (p < 0.12) {
            centerTouchGlow = 0.25 * (1 - p / 0.12);
          }
        } else {
          // 45-second rest phase until next 1-minute cycle: calm grounded stance
          pokemonShadowMesh.visible = true;
          pokemonShadowMesh.position.set(0, 0.039, 0);
          pokemonShadowMesh.scale.setScalar(1);
          pokemonShadowMat.opacity = 0.94;
          centerTouchGlow = 0.3 + 0.08 * (0.5 + 0.5 * Math.sin(t * 1.8));
        }
      }

      // Smooth exponential-damped studio camera push-in + impact jolt
      if (!prefersReducedMotion) {
        const pushWindow = t >= BALL_OPEN_S && t < POKEMON_EMERGE_END_S ? 1 : 0;
        const targetCamY = BASE_CAM_Y - pushWindow * 0.16 - camImpactJolt;
        const targetCamZ = BASE_CAM_Z - pushWindow * 0.36;
        camera.position.y = THREE.MathUtils.damp(camera.position.y, targetCamY, camImpactJolt !== 0 ? 18 : 4.5, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, targetCamZ, 4.5, dt);
      }

      platformGroup.position.y = -0.66 - discImpact * 0.048;
      centerPadMat.emissiveIntensity = centerTouchGlow * 1.95;
      centerGlowMat.opacity = centerTouchGlow * 0.88;
      centerGlowMesh.scale.setScalar(0.86 + centerTouchGlow * 0.24);
      centerGlowLight.intensity = centerTouchGlow * 1.45;

      if (impactRingProgress >= 0 && impactRingProgress <= 1) {
        centerPulseRingMesh.visible = true;
        centerPulseRingMesh.scale.setScalar(0.85 + impactRingProgress * 1.25);
        centerPulseRingMat.opacity = (1 - impactRingProgress) * 0.75;
      } else {
        centerPulseRingMesh.visible = false;
        centerPulseRingMat.opacity = 0;
      }
    };

    const tick = () => {
      if (disposed || contextLost || !activeRef.current || document.hidden) {
        isLoopRunning = false;
        return;
      }
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - lastFrameTs) / 1000));
      lastFrameTs = now;
      const elapsed = Math.max(0, (now - startTimeRef.current) / 1000);
      updateScene(elapsed, dt);
      renderer.render(scene, camera);

      if (isSoftwareGl) afterDraw(tick);
      else rafId = window.requestAnimationFrame(tick);
    };

    const startLoop = () => {
      if (disposed || contextLost || isLoopRunning || !activeRef.current || document.hidden) return;
      handleResize();
      lastFrameTs = performance.now();
      isLoopRunning = true;
      if (isSoftwareGl) {
        rafId = window.requestAnimationFrame(() => {
          if (!disposed && !contextLost && activeRef.current && !document.hidden) tick();
          else isLoopRunning = false;
        });
      } else {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    let contextLossFallbackTimer = 0;
    const onContextLost = (e: Event) => {
      e.preventDefault();
      contextLost = true;
      isLoopRunning = false;
      cancelScheduledFrame();
      if (contextLossFallbackTimer) window.clearTimeout(contextLossFallbackTimer);
      contextLossFallbackTimer = window.setTimeout(() => {
        if (!disposed && contextLost) {
          onWebGLUnavailableRef.current?.();
        }
      }, 900);
    };

    const onContextRestored = () => {
      if (disposed) return;
      contextLost = false;
      if (contextLossFallbackTimer) {
        window.clearTimeout(contextLossFallbackTimer);
        contextLossFallbackTimer = 0;
      }
      startLoop();
    };

    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    const onVisibilityChange = () => {
      if (disposed) return;
      if (document.hidden) {
        hiddenStartedAt = performance.now();
        isLoopRunning = false;
        cancelScheduledFrame();
      } else {
        if (hiddenStartedAt > 0) {
          startTimeRef.current += performance.now() - hiddenStartedAt;
          hiddenStartedAt = 0;
        }
        startLoop();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Pre-compile WebGL shaders before timeline starts so frame 1 never skips the drop
    try {
      releaseBeamMesh.visible = true;
      energyParticles.visible = true;
      renderer.compile(scene, camera);
      updateScene(0, 0.016);
    } catch {
      // ignore shader compile helper error on restricted WebGL contexts
    }

    wakeRef.current = startLoop;
    if (activeRef.current) {
      startTimeRef.current = performance.now();
      startLoop();
    }

    return () => {
      disposed = true;
      shadowRequestToken++;
      wakeRef.current = null;
      updatePokemonShadowRef.current = null;
      if (isBouncingRef.current) {
        isBouncingRef.current = false;
        onBouncingChangeRef.current?.(false);
      }
      if (contextLossFallbackTimer) {
        window.clearTimeout(contextLossFallbackTimer);
      }
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      cancelScheduledFrame();
      resizeObserver.disconnect();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      try {
        renderer.getContext()?.getExtension('WEBGL_lose_context')?.loseContext();
      } catch {
        // ignore unsupported context loss
      }
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  useEffect(() => {
    updatePokemonShadowRef.current?.(pokemonImgSrc);
  }, [pokemonImgSrc]);

  useEffect(() => {
    if (!active) return;
    isBouncingRef.current = false;
    onBouncingChangeRef.current?.(false);
    bounceAudioStateRef.current = { hopCycle: -1, bounceCycle: -1 };
    revealBeatsFiredRef.current = { drop1: false, drop2: false, open: false, emerge: false };
    startTimeRef.current = performance.now();
    wakeRef.current?.();
  }, [active, revealKey]);

  return (
    <div
      ref={mountRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[6] h-full w-full"
    />
  );
};
