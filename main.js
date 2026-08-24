/* Peonies Under the Moon
   A small nocturnal garden. Vanilla JS, canvas 2D, no dependencies.

   The garden lives on a ground plane in (x, z). The camera orbits that plane:
   it starts standing among the flowers at eye level and slowly rises. Only from
   up there does the planting read as what it always was. */

(() => {
'use strict';

/* ────────────────────────────── helpers ────────────────────────────── */

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
const RAD = Math.PI / 180;

const easeOutCubic   = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;
const easeOutQuint   = (t) => 1 - Math.pow(1 - t, 5);
const easeOutSine    = (t) => Math.sin(t * Math.PI / 2);
const easeInOutSine  = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

/* deterministic noise — the garden is planted the same way every visit */
let _seed = 20260824;
const rnd = () => {
  _seed ^= _seed << 13; _seed ^= _seed >>> 17; _seed ^= _seed << 5;
  return ((_seed >>> 0) % 100000) / 100000;
};
const rr = (a, b) => a + rnd() * (b - a);
const mix = (a, b, t) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp((pa >> 16) & 255, (pb >> 16) & 255, t));
  const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t));
  const bl = Math.round(lerp(pa & 255, pb & 255, t));
  return `rgb(${r},${g},${bl})`;
};
const hash = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ───────────────────────────── environment ─────────────────────────── */

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const cores = navigator.hardwareConcurrency || 4;
const rawDpr = window.devicePixelRatio || 1;
const lowPower = cores <= 4 || (rawDpr <= 1.5 && cores <= 6);
const TIER = reduced ? 0 : (lowPower ? 1 : 2);      // 0 still · 1 light · 2 full
/* Phones get a slightly lower ceiling than desktops: this is a soft painterly
   image, and every extra device pixel is fill rate a mobile GPU has to find. */
const coarse = window.matchMedia('(pointer: coarse)').matches;
const DPR_CAP = TIER === 2 ? (coarse ? 1.75 : 2) : 1.5;

const stage = $('#stage');
const canvas = $('#scene');
const ctx = canvas.getContext('2d', { alpha: false });
let W = 0, H = 0, DPR = 1;

/* ────────────────────────────── palette ────────────────────────────── */

const SKY = [
  [0.00, '#04060e'],
  [0.38, '#070c1a'],
  [0.70, '#0c1327'],
  [1.00, '#141d38'],
];

const PETALS = [
  { base:'#7d3f5c', mid:'#c9819c', tip:'#f2c8d6', heart:'#e9c184' }, // blush
  { base:'#8d6f62', mid:'#d8bdae', tip:'#f6e6da', heart:'#e8c893' }, // ivory
  { base:'#5f5280', mid:'#a695c4', tip:'#ddd0ec', heart:'#e4c396' }, // lavender
  { base:'#6f3450', mid:'#bd7192', tip:'#eab3c6', heart:'#e5bd88' }, // dusty rose
  { base:'#7a5c6d', mid:'#c3a3b4', tip:'#eddbe2', heart:'#e7c692' }, // pale mauve
];

const LEAF = ['#16272a', '#1a2f2b', '#132325'];
const BUD  = '#74836a';   // the green a peony wears before it opens

/* ─────────────────────────── flower sprites ────────────────────────── */
/* Each bloom is drawn once per (variant · bloom step · size bucket) into an
   offscreen canvas and then blitted. This is what keeps a hundred peonies
   at 60fps on a mid-range phone. */

const STEPS = TIER === 0 ? 10 : 16;
const spriteCache = new Map();

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/* one petal, base at origin, growing along +y, with a peony's split tip */
function petalPath(g, len, wid, ruffle) {
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(-wid * .62, len * .24, -wid * .55, len * .74, -wid * .26, len * .95);
  g.quadraticCurveTo(-wid * .10, len * (.95 - ruffle), 0, len * .99);
  g.quadraticCurveTo(wid * .10, len * (.95 - ruffle), wid * .26, len * .95);
  g.bezierCurveTo(wid * .55, len * .74, wid * .62, len * .24, 0, 0);
  g.closePath();
}

const RINGS = [
  { n: 11, scale: 1.00, phase: 0.00, delay: 0.00, w: 1.02 },
  { n: 11, scale: 0.88, phase: 0.29, delay: 0.10, w: 0.98 },
  { n: 10, scale: 0.72, phase: 0.16, delay: 0.24, w: 0.92 },
  { n:  9, scale: 0.56, phase: 0.44, delay: 0.38, w: 0.86 },
  { n:  7, scale: 0.40, phase: 0.21, delay: 0.52, w: 0.78 },
  { n:  6, scale: 0.26, phase: 0.60, delay: 0.64, w: 0.70 },
];

function drawPeony(g, size, bloom, variant) {
  const P = PETALS[variant % PETALS.length];
  const R = size * 0.45;
  g.save();
  g.translate(size / 2, size / 2);

  /* sepals and leaves — they hold the bud, and stay visible when open */
  g.fillStyle = LEAF[variant % LEAF.length];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.5;
    const l = R * (0.34 + hash(i + variant * 7) * 0.18) * (1.05 - bloom * 0.18);
    g.save();
    g.rotate(a);
    g.globalAlpha = 0.75;
    petalPath(g, l, l * 0.5, 0.06);
    g.fill();
    g.restore();
  }

  for (let r = 0; r < RINGS.length; r++) {
    const ring = RINGS[r];
    const o = easeOutCubic(clamp((bloom - ring.delay) / (1 - ring.delay), 0, 1));

    const baseLen = R * ring.scale * (0.33 + 0.67 * o);
    const curl = (1 - o) * 0.30;              // petals still folded inward
    const squeeze = 0.84 + 0.16 * o;

    for (let i = 0; i < ring.n; i++) {
      const h1 = hash(i * 3.7 + r * 11.3 + variant);
      const h2 = hash(i * 8.1 + r * 5.9 + variant * 3);
      const len = baseLen * (0.90 + h1 * 0.20);
      const wid = len * ring.w * (1.16 - 0.16 * o) * (0.92 + h2 * 0.16);
      const a = ring.phase + (i / ring.n) * TAU + (h2 - 0.5) * 0.26 * o;

      g.save();
      g.rotate(a);
      g.transform(squeeze, 0, curl * (i % 2 ? 1 : -1), 1, 0, 0);

      /* a closed bud is still half green; the colour floods in as it opens */
      const green = (1 - bloom) * 0.44;
      const grad = g.createLinearGradient(0, 0, 0, len);
      grad.addColorStop(0.00, mix(mix(P.mid, P.base, o), BUD, green));
      grad.addColorStop(0.42, mix(mix(P.tip, P.mid, o), BUD, green * 0.72));
      grad.addColorStop(1.00, mix(P.tip, BUD, green * 0.45));
      g.fillStyle = grad;
      g.globalAlpha = 0.94 + h1 * 0.06;
      petalPath(g, len, wid, 0.09 + h2 * 0.06);
      g.fill();

      g.globalAlpha = 0.16 - 0.07 * o;
      g.strokeStyle = P.tip;
      g.lineWidth = Math.max(0.5, size * 0.0035);
      g.stroke();
      g.restore();
    }

    /* the flower's own shadow, gathering toward its middle */
    if (r === 1) {
      const sh = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.62);
      sh.addColorStop(0, 'rgba(38,20,40,.42)');
      sh.addColorStop(0.62, 'rgba(38,20,40,.16)');
      sh.addColorStop(1, 'rgba(38,20,40,0)');
      g.globalAlpha = 0.55 + 0.45 * o;
      g.fillStyle = sh;
      g.beginPath(); g.arc(0, 0, R * 0.62, 0, TAU); g.fill();
      g.globalAlpha = 1;
    }
  }

  /* heart of the flower, only once it is truly open */
  const heart = clamp((bloom - 0.68) / 0.32, 0, 1);
  if (heart > 0) {
    const hr = R * 0.16 * heart;
    const hg = g.createRadialGradient(0, 0, 0, 0, 0, hr * 2.6);
    hg.addColorStop(0, P.heart);
    hg.addColorStop(0.45, 'rgba(244,212,156,.38)');
    hg.addColorStop(1, 'rgba(244,212,156,0)');
    g.globalAlpha = heart * 0.85;
    g.fillStyle = hg;
    g.beginPath(); g.arc(0, 0, hr * 2.6, 0, TAU); g.fill();

    g.globalAlpha = heart * 0.95;
    g.fillStyle = P.heart;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + 0.4;
      const d = hr * (0.55 + hash(i * 2.2) * 0.7);
      g.beginPath();
      g.arc(Math.cos(a) * d, Math.sin(a) * d, Math.max(0.5, hr * 0.2), 0, TAU);
      g.fill();
    }
  }

  /* bake the moonlight in: it always falls from the upper right */
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-atop';
  const light = g.createLinearGradient(R * 0.9, -R * 0.9, -R * 0.9, R * 0.9);
  light.addColorStop(0.00, 'rgba(255,249,232,.32)');
  light.addColorStop(0.40, 'rgba(255,248,228,0)');
  light.addColorStop(0.56, 'rgba(18,22,48,.14)');
  light.addColorStop(1.00, 'rgba(13,16,38,.46)');
  g.fillStyle = light;
  g.fillRect(-size, -size, size * 2, size * 2);

  g.restore();
}

function sprite(variant, step, px) {
  const key = variant + '|' + step + '|' + px;
  let c = spriteCache.get(key);
  if (c) return c;
  if (spriteCache.size > 220) spriteCache.clear();   // hard ceiling on memory
  c = makeCanvas(px, px);
  drawPeony(c.getContext('2d'), px, step / (STEPS - 1), variant);
  spriteCache.set(key, c);
  return c;
}

/* ──────────────────────────── the planting ─────────────────────────── */

const M_PTS = [[-310, 330], [-310, -330], [0, 70], [310, -330], [310, 330]];
const Z0 = 600;                       // world z of the garden's middle

function samplePolyline(pts, n) {
  const segs = []; let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i+1][0] - pts[i][0], dy = pts[i+1][1] - pts[i][1];
    const len = Math.hypot(dx, dy);
    segs.push({ x: pts[i][0], y: pts[i][1], dx, dy, len });
    total += len;
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    let d = (i / (n - 1)) * total;
    for (let k = 0; k < segs.length; k++) {
      const s = segs[k];
      if (d <= s.len || k === segs.length - 1) {
        const t = clamp(d / s.len, 0, 1);
        out.push([s.x + s.dx * t, s.y + s.dy * t]);
        break;
      }
      d -= s.len;
    }
  }
  return out;
}

function distToPolyline(x, y, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], ay = pts[i][1];
    const dx = pts[i+1][0] - ax, dy = pts[i+1][1] - ay;
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx*dx + dy*dy), 0, 1);
    best = Math.min(best, Math.hypot(x - (ax + dx*t), y - (ay + dy*t)));
  }
  return best;
}

const flowers = [];

function buildGarden() {
  flowers.length = 0;
  const keyCount = TIER === 2 ? 54 : 42;

  samplePolyline(M_PTS, keyCount).forEach(([x, my], i) => {
    flowers.push({
      x: x + rr(-16, 16),
      z: Z0 - (my + rr(-16, 16)),
      h: rr(46, 78),
      r: rr(30, 41),
      variant: i % PETALS.length,
      key: true,
      sway: rr(0, TAU), swaySpeed: rr(0.15, 0.29), tilt: rr(-0.14, 0.14),
      bloom: 0, t0: 0,
    });
  });

  const fillCount = TIER === 2 ? 44 : 28;
  let guard = 0;
  while (flowers.length < keyCount + fillCount && guard++ < 1200) {
    const my = rr(-470, 500);
    const spread = clamp((Z0 - my) * 0.52, 130, 790);
    const x = rr(-spread, spread);
    if (distToPolyline(x, my, M_PTS) < 84) continue;
    flowers.push({
      x, z: Z0 - my,
      h: rr(22, 46),
      r: rr(12, 21),
      variant: flowers.length % PETALS.length,
      key: false,
      sway: rr(0, TAU), swaySpeed: rr(0.13, 0.27), tilt: rr(-0.3, 0.3),
      bloom: 0, t0: 0,
    });
  }

  /* a handful of blooms right in front of you, inside the camera's cone */
  for (let i = 0, n = TIER === 2 ? 9 : 6; i < n; i++) {
    const z = rr(300, 520);
    flowers.push({
      x: rr(-0.30, 0.30) * (z - 190),
      z,
      h: rr(26, 62),
      r: rr(13, 23),
      variant: i % PETALS.length,
      key: false,
      sway: rr(0, TAU), swaySpeed: rr(0.13, 0.26), tilt: rr(-0.28, 0.28),
      bloom: 0, t0: 0, near: true,
    });
  }

  /* they open from the near edge and travel away from you */
  flowers.sort((a, b) => a.z - b.z);
  flowers.forEach((f, i) => {
    f.t0 = f.near ? rr(0, 0.12)
                  : clamp((i / flowers.length) * 0.84 + rr(-0.11, 0.11), 0, 0.88);
  });
}

/* ─────────────────────────── ambient elements ──────────────────────── */

let stars = null, fireflies = [], drifting = [];

function buildStars() {
  const c = makeCanvas(Math.max(1, W), Math.max(1, H));
  const g = c.getContext('2d');
  const n = Math.round((W * H) / 5600 * (TIER === 2 ? 1 : 0.55));
  for (let i = 0; i < n; i++) {
    const x = rr(0, W), y = rr(0, H * 0.78);
    const a = rr(0.10, 0.6) * (1 - y / (H * 0.95));
    g.globalAlpha = Math.max(0.04, a);
    g.fillStyle = i % 11 === 0 ? '#dde3f6' : '#f4f0e8';
    g.beginPath(); g.arc(x, y, rr(0.35, 1.1), 0, TAU); g.fill();
  }
  stars = c;
}

function buildAmbient() {
  fireflies = []; drifting = [];
  if (TIER === 0) return;
  for (let i = 0, n = TIER === 2 ? 10 : 6; i < n; i++) {
    fireflies.push({
      x: rr(0, 1), y: rr(0.5, 0.95), ph: rr(0, TAU),
      sp: rr(0.05, 0.12), amp: rr(0.02, 0.06),
      blink: rr(0.22, 0.55), r: rr(0.8, 1.7),
    });
  }
  for (let i = 0, n = TIER === 2 ? 14 : 7; i < n; i++) {
    drifting.push({
      x: rr(-0.1, 1.1), y: rr(-0.2, 1.1),
      vx: rr(0.008, 0.026), vy: rr(0.010, 0.030),
      rot: rr(0, TAU), vr: rr(-0.4, 0.4),
      s: rr(2.4, 6.5), a: rr(0.10, 0.26),
      variant: i % PETALS.length,
    });
  }
}

/* ──────────────────────────── scene state ──────────────────────────── */

const S = {
  moon: 0, moonY: 0.17,
  garden: 0, fog: 0,
  hero: 0, heroBloom: 0,
  progress: 0, target: 0,
  dist: 330, pitch: 12 * RAD, aimZ: 505, aimSY: 0.66,
  reveal: 0,
};

/* the orbit camera, resolved once per frame */
const cam = { x: 0, z: 0, h: 0, cp: 1, sp: 0, f: 0, oy: 0, horizon: 0 };

/* distance at which the planting spans a comfortable share of the screen */
let FIT = 1470;
function computeFit() {
  const f = Math.min(H * 0.92, W * 2.0);
  FIT = clamp(620 * f / (W * 0.84), 900, 2100);
}

function updateCamera() {
  const p = S.pitch;
  cam.cp = Math.cos(p); cam.sp = Math.sin(p);
  cam.x = 0;
  cam.z = S.aimZ - S.dist * cam.cp;
  cam.h = S.dist * cam.sp;
  cam.f = Math.min(H * 0.92, W * 2.0);
  cam.oy = H * S.aimSY;
  cam.horizon = cam.oy - cam.f * (cam.sp / cam.cp);
}

/* returns screen x, y and world-to-screen scale, or null when behind camera */
function project(x, z, h, out) {
  const dx = x - cam.x;
  const dz = z - cam.z;
  const Y = cam.h - h;
  const zp = Y * cam.sp + dz * cam.cp;
  if (zp < 40) return null;
  const yp = Y * cam.cp - dz * cam.sp;
  const k = cam.f / zp;
  out.x = W / 2 + dx * k;
  out.y = cam.oy + yp * k;
  out.k = k;
  out.zp = zp;
  return out;
}

/* ─────────────────────────────── tweens ────────────────────────────── */

const tweens = [];
let devTakeover = false;          // set only by the #dev hook, so the story
                                  // stops writing over a state you jumped to
function tween(prop, to, dur, ease = easeInOutCubic) {
  return new Promise((res) => {
    if (devTakeover) { res(); return; }
    for (let i = tweens.length - 1; i >= 0; i--)
      if (tweens[i].prop === prop) { tweens[i].res(); tweens.splice(i, 1); }
    /* call sites give milliseconds; the clock here counts seconds */
    const ms = reduced ? Math.min(dur, 700) : dur;
    tweens.push({ prop, from: S[prop], to, dur: ms / 1000, t: 0, ease, res });
  });
}
function stepTweens(dt) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.t += dt;
    const k = clamp(tw.t / tw.dur, 0, 1);
    S[tw.prop] = lerp(tw.from, tw.to, tw.ease(k));
    if (k >= 1) { tweens.splice(i, 1); tw.res(); }
  }
}

/* ─────────────────────────────── render ────────────────────────────── */

let skyGrad = null;

function buildGradients() {
  skyGrad = ctx.createLinearGradient(0, 0, 0, H);
  SKY.forEach(([p, c]) => skyGrad.addColorStop(p, c));
}

function drawSkyAndGround() {
  const hz = clamp(cam.horizon, -H, H * 2);

  ctx.fillStyle = '#04060e';
  ctx.fillRect(0, 0, W, H);

  if (hz > 0) {
    const sg = ctx.createLinearGradient(0, 0, 0, hz);
    SKY.forEach(([p, c]) => sg.addColorStop(p, c));
    ctx.globalAlpha = 0.4 + S.garden * 0.6;
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, W, hz);
    ctx.globalAlpha = 1;

    if (stars) {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, hz); ctx.clip();
      ctx.globalAlpha = clamp(0.4 + S.garden * 0.5 - S.moon * 0.2, 0, 1);
      ctx.drawImage(stars, 0, 0, W, H);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  /* ground base — the haze that ties it to the sky is applied after the hills */
  const gTop = Math.max(0, hz);
  ctx.fillStyle = '#070a14';
  ctx.fillRect(0, gTop, W, H - gTop);
}

/* distance haze, laid over the hills so nothing shows a cut edge */
function drawHaze() {
  const gTop = Math.max(0, cam.horizon);
  const band = H * 0.26;
  const g = ctx.createLinearGradient(0, gTop - band * 0.55, 0, gTop + band);
  g.addColorStop(0.00, 'rgba(92,102,138,0)');
  g.addColorStop(0.22, `rgba(92,102,138,${0.07 + S.moon * 0.09})`);
  g.addColorStop(0.55, `rgba(44,52,80,${0.03 + S.moon * 0.04})`);
  g.addColorStop(1.00, 'rgba(20,24,42,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, gTop - band, W, band * 2);

  const deep = ctx.createLinearGradient(0, H * 0.45, 0, H);
  deep.addColorStop(0, 'rgba(4,6,13,0)');
  deep.addColorStop(1, 'rgba(3,4,10,.85)');
  ctx.fillStyle = deep;
  ctx.fillRect(0, H * 0.45, W, H * 0.55);
}

function drawMoon() {
  const mx = W * 0.74;
  const my = H * S.moonY;
  const R = Math.max(16, Math.min(W, H) * 0.058);
  const lum = S.moon;

  /* halo and moonlight wash are one and the same fill — blending the screen
     twice a frame is the kind of thing a mid-range phone notices */
  const reach = Math.max(W, H) * (0.85 + lum * 0.45);
  const halo = ctx.createRadialGradient(mx, my, R * 0.5, mx, my, reach);
  halo.addColorStop(0.00, `rgba(250,242,224,${0.16 + lum * 0.22})`);
  halo.addColorStop(0.10, `rgba(226,224,236,${0.05 + lum * 0.09})`);
  halo.addColorStop(0.34, `rgba(186,196,226,${0.012 + lum * 0.032})`);
  halo.addColorStop(1.00, 'rgba(150,170,214,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, H);

  const disc = ctx.createRadialGradient(mx - R * .3, my - R * .32, R * .08, mx, my, R * 1.02);
  disc.addColorStop(0, `rgba(255,253,246,${0.5 + lum * 0.5})`);
  disc.addColorStop(0.7, `rgba(244,237,220,${0.42 + lum * 0.52})`);
  disc.addColorStop(1, `rgba(219,214,200,${0.24 + lum * 0.5})`);
  ctx.fillStyle = disc;
  ctx.beginPath(); ctx.arc(mx, my, R, 0, TAU); ctx.fill();

  ctx.globalAlpha = 0.025 + lum * 0.030;
  ctx.fillStyle = '#9a9484';
  ctx.beginPath(); ctx.arc(mx - R*.3, my - R*.16, R*.30, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(mx + R*.22, my + R*.26, R*.20, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
}

function drawHills(t) {
  const hz = cam.horizon;
  if (hz < -80 || hz > H + 40) return;
  const drift = Math.sin(t * 0.04) * 1.6;
  const layers = [
    { rise: 0.085, col: '#0a0f1f', a: 0.9 },
    { rise: 0.048, col: '#070b18', a: 1 },
  ];
  for (const L of layers) {
    const r = H * L.rise;
    ctx.globalAlpha = L.a * (0.45 + S.garden * 0.55);
    ctx.fillStyle = L.col;
    ctx.beginPath();
    ctx.moveTo(-10, hz + 4);
    ctx.lineTo(-10, hz - r * 0.5 + drift);
    ctx.bezierCurveTo(W * 0.24, hz - r * 1.35, W * 0.40, hz - r * 0.25, W * 0.60, hz - r * 0.85);
    ctx.bezierCurveTo(W * 0.76, hz - r * 1.5, W * 0.88, hz - r * 0.30, W + 10, hz - r * 0.7 + drift);
    ctx.lineTo(W + 10, hz + 4);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawFog(t) {
  const a = S.fog * (0.06 + S.moon * 0.08);
  if (a <= 0.002) return;
  const hz = cam.horizon;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0, n = quality === 2 ? 3 : 1; i < n; i++) {
    const y = hz + H * (0.015 + i * 0.055) + Math.sin(t * 0.07 + i * 1.7) * H * 0.010;
    const band = H * 0.085;
    const g = ctx.createLinearGradient(0, y - band, 0, y + band);
    g.addColorStop(0, 'rgba(146,158,196,0)');
    g.addColorStop(0.5, `rgba(156,168,202,${a * (1 - i * 0.28)})`);
    g.addColorStop(1, 'rgba(146,158,196,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y - band, W, band * 2);
  }
  ctx.restore();
}

const _p = { x: 0, y: 0, k: 1, zp: 0 };
const _b = { x: 0, y: 0, k: 1, zp: 0 };
let order = [];

function drawGarden(t) {
  if (S.garden <= 0.003) return;
  if (order.length !== flowers.length) order = flowers.slice();
  order.sort((a, b) => b.z - a.z);              // far to near

  const light = 0.40 + S.moon * 0.60;

  for (let i = 0; i < order.length; i++) {
    const f = order[i];
    const sway = Math.sin(t * f.swaySpeed + f.sway) * (0.9 + f.bloom * 0.7);

    const head = project(f.x + sway * 2.2, f.z, f.h, _p);
    if (!head) continue;
    const d = f.r * 2 * head.k;
    if (d < 1.2) continue;
    if (head.x < -d || head.x > W + d || head.y < -d || head.y > H + d) continue;

    const base = project(f.x, f.z, 0, _b);
    const depth = clamp(1 - (head.zp - S.dist * 0.35) / 2100, 0.30, 1);
    const near = f.near ? lerp(1, 0.30, easeInOutSine(S.progress)) : 1;
    const alpha = clamp(S.garden * light * depth * near * (f.key ? 1 : 0.62), 0, 1);

    if (base && d > 7) {
      ctx.globalAlpha = alpha * 0.75;
      ctx.strokeStyle = 'rgba(22,40,36,.95)';
      ctx.lineWidth = Math.max(0.6, d * 0.035);
      ctx.beginPath();
      ctx.moveTo(head.x, head.y + d * 0.30);
      ctx.quadraticCurveTo((head.x + base.x) / 2 - sway * 1.5, (head.y + base.y) / 2, base.x, base.y);
      ctx.stroke();
    }

    const step = Math.round(f.bloom * (STEPS - 1));
    const px = d > 150 ? 192 : (d > 54 ? 96 : 48);
    const img = sprite(f.variant, step, px);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(head.x, head.y);
    ctx.rotate(f.tilt + sway * 0.018);
    ctx.drawImage(img, -d / 2, -d / 2, d, d);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawHeroPeony(t) {
  if (S.hero <= 0.003) return;
  const size = Math.min(W, H) * 0.47;
  const x = W * 0.46;
  const y = H * 0.56 + (1 - S.hero) * H * 0.07;
  const img = sprite(0, Math.round(S.heroBloom * (STEPS - 1)), 192);
  const sway = Math.sin(t * 0.17) * 0.012;
  const a = S.hero * (0.45 + S.moon * 0.55);

  ctx.save();
  ctx.globalAlpha = a * 0.9;
  ctx.strokeStyle = 'rgba(20,36,33,.95)';
  ctx.lineWidth = Math.max(2, size * 0.02);
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.28);
  ctx.quadraticCurveTo(x - size * 0.07, y + size * 0.72, x - size * 0.02, H + 20);
  ctx.stroke();

  ctx.translate(x, y);
  ctx.rotate(-0.06 + sway);
  ctx.globalAlpha = a;
  const d = size * (0.92 + S.heroBloom * 0.08);
  ctx.drawImage(img, -d / 2, -d / 2, d, d);
  ctx.restore();
}

/* near foliage, out of focus, holding the bottom of the frame.
   It thins out as the camera rises — by the reveal you are above it. */
const FOLIAGE = [
  { x: -0.03, s: 1.05, a: -0.40, sp: 0.11 },
  { x:  0.14, s: 0.70, a: -0.16, sp: 0.15 },
  { x:  0.80, s: 0.78, a:  0.22, sp: 0.13 },
  { x:  1.03, s: 1.10, a:  0.44, sp: 0.09 },
];

function drawForeground(t) {
  const k = S.garden * clamp(1 - S.progress * 1.9, 0, 1);
  if (k <= 0.01) return;
  const unit = Math.min(W, H) * 0.62;
  ctx.save();
  ctx.globalAlpha = k;
  for (let i = 0; i < FOLIAGE.length; i++) {
    const L = FOLIAGE[i];
    const sway = Math.sin(t * L.sp + i * 2.1) * 0.035;
    const len = unit * L.s;
    ctx.save();
    ctx.translate(L.x * W, H + len * 0.10);
    ctx.rotate(L.a + sway);
    ctx.fillStyle = i % 2 ? '#070b16' : '#0a0f1d';
    petalPath(ctx, -len, len * 0.13, 0.02);
    ctx.fill();
    ctx.strokeStyle = `rgba(196,206,232,${0.05 + S.moon * 0.07})`;
    ctx.lineWidth = 1;
    ctx.stroke();
    // a second, smaller blade beside it
    ctx.rotate(0.34);
    ctx.globalAlpha = k * 0.85;
    petalPath(ctx, -len * 0.62, len * 0.09, 0.02);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawFireflies(t) {
  if (!fireflies.length || S.garden <= 0.02) return;
  const hz = clamp(cam.horizon, 0, H);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const f of fireflies) {
    const x = (f.x + Math.sin(t * f.sp + f.ph) * f.amp) * W;
    const y = hz + (f.y * (H - hz)) + Math.cos(t * f.sp * 0.8 + f.ph) * H * 0.02;
    const blink = 0.5 + 0.5 * Math.sin(t * f.blink + f.ph * 3);
    const a = blink * blink * 0.5 * S.garden * (0.3 + S.moon * 0.45);
    const r = f.r * (2 + blink * 3) * 3.2;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(250,238,196,${a})`);
    g.addColorStop(1, 'rgba(250,238,196,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

function drawDrifting(t, dt) {
  if (!drifting.length || S.garden <= 0.02) return;
  for (const d of drifting) {
    d.x -= d.vx * dt * 0.11;
    d.y += d.vy * dt * 0.11;
    d.rot += d.vr * dt;
    if (d.y > 1.15) { d.y = -0.15; d.x = rand(-0.05, 1.15); }
    if (d.x < -0.15) d.x = 1.15;

    const P = PETALS[d.variant];
    const x = d.x * W + Math.sin(t * 0.45 + d.rot) * W * 0.014;
    const y = d.y * H;
    ctx.save();
    ctx.globalAlpha = d.a * S.garden * (0.35 + S.moon * 0.65);
    ctx.translate(x, y);
    ctx.rotate(d.rot);
    ctx.fillStyle = P.tip;
    ctx.beginPath();
    ctx.ellipse(0, 0, d.s * Math.abs(Math.cos(d.rot * 0.7)) + 0.5, d.s * 0.5, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/* ───────────────────────────── main loop ───────────────────────────── */

let last = 0, t = 0, running = true;

/* If the device cannot hold a smooth frame, quietly take work away rather
   than letting the whole thing stutter. Never goes back up: no oscillation. */
let quality = TIER;
let probeTime = 0, probeFrames = 0, probeStart = 0;

function degrade() {
  if (quality <= 0) return;
  quality--;
  if (DPR > 1.25) { DPR = Math.max(1, DPR * 0.75); applyCanvasSize(); }
  fireflies.length = Math.min(fireflies.length, quality > 0 ? 5 : 0);
  drifting.length = Math.min(drifting.length, quality > 0 ? 6 : 0);
}

function frame(now) {
  if (!running) return;
  requestAnimationFrame(frame);
  if (!last) last = now;
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  t += dt;

  if (probeStart < 3) { probeStart += dt; }
  else if (quality > 0) {
    probeTime += dt; probeFrames++;
    if (probeTime > 2.5) {
      if (probeTime / probeFrames > 1 / 40) degrade();
      probeTime = 0; probeFrames = 0;
    }
  }

  stepTweens(dt);

  if (bloomActive) {
    S.progress += (S.target - S.progress) * Math.min(1, dt * 2.4);
    applyProgress();
  }
  for (let i = 0; i < flowers.length; i++) {
    const f = flowers[i];
    const target = easeOutCubic(clamp((S.progress - f.t0) / 0.12, 0, 1));
    f.bloom += (target - f.bloom) * Math.min(1, dt * 2.0);
  }

  updateCamera();
  render(t, dt);
}

function render(t, dt) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawSkyAndGround();
  drawHills(t);
  drawHaze();
  drawMoon();
  drawGarden(t);
  drawFog(t);
  drawHeroPeony(t);
  drawFireflies(t);
  drawForeground(t);
  drawDrifting(t, dt);
}

/* ───────────────────────────── progression ─────────────────────────── */

let bloomActive = false, finished = false;
const railEl = $('#rail'), railDot = railEl.querySelector('i');

function applyProgress() {
  const e = easeInOutSine(S.progress);
  const c = easeInOutCubic(S.progress);
  S.dist  = lerp(330, FIT, e);
  S.pitch = lerp(12 * RAD, 44 * RAD, e);
  S.aimZ  = lerp(505, Z0, c);
  S.aimSY = lerp(0.66, 0.565, e);
  S.moonY = lerp(0.17, 0.10, e);
  railDot.style.top = (S.progress * 100).toFixed(1) + '%';
}

function addProgress(v) {
  if (!bloomActive) return;
  S.target = clamp(S.target + v, 0, 1);
  hideHint();
  nudgeSoon();
  for (const m of milestones) {
    if (!m.done && S.target >= m.at) { m.done = true; say(m.text, { hold: 2600, soft: m.soft }); }
  }
  if (S.target >= 0.995 && !finished) { finished = true; finale(); }
}

const milestones = [
  { at: 0.17, text: 'Και άλλη μία, γιατί ξέρω ότι σου αρέσουν.', done: false },
  { at: 0.45, text: 'Μοιάζει να μην σταματάνε.', done: false },
  { at: 0.74, text: 'Λίγο ακόμα.', done: false, soft: true },
];

/* ─────────────────────────────── text ──────────────────────────────── */

const capsEl = $('#captions'), ctaEl = $('#cta');

function say(text, { hold = 2400, soft = false } = {}) {
  return new Promise((resolve) => {
    const p = document.createElement('p');
    p.className = 'line' + (soft ? ' soft' : '');
    p.textContent = text;
    capsEl.appendChild(p);
    requestAnimationFrame(() => requestAnimationFrame(() => p.classList.add('in')));
    const inDur = reduced ? 400 : 1250;
    setTimeout(() => {
      p.classList.remove('in'); p.classList.add('out');
      setTimeout(() => p.remove(), 1100);
      resolve();
    }, inDur + hold);
  });
}

function clearLines() {
  capsEl.querySelectorAll('.line').forEach((p) => {
    p.classList.remove('in'); p.classList.add('out');
    setTimeout(() => p.remove(), 1000);
  });
}

const ARROW = '<svg class="arrow" viewBox="0 0 19 8" aria-hidden="true"><path d="M0 4h17M13.4 .6 17 4l-3.6 3.4"/></svg>';

function showCTA(label, withArrow = true) {
  return new Promise((resolve) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cta';
    b.innerHTML = `<span class="glow"></span><span class="lbl">${label}</span>${withArrow ? ARROW : ''}<span class="rule"></span>`;
    ctaEl.appendChild(b);
    requestAnimationFrame(() => requestAnimationFrame(() => b.classList.add('in')));
    let used = false;
    b.addEventListener('click', () => {
      if (used) return;
      used = true;
      b.classList.add('tapped');
      audio.prime();
      setTimeout(() => {
        b.classList.remove('in'); b.classList.add('out');
        setTimeout(() => b.remove(), 800);
        resolve();
      }, 220);
    });
  });
}

/* The hint is not a one-off. It steps out of the way while she is moving and
   comes back whenever she stops, saying a little more each time — because the
   thing she needs to know is not "swipe", it is "keep going". */
const hintEl = $('#hint');
const hintLabel = hintEl.querySelector('.hint-label');

const HINTS = [
  'σύρε προς τα πάνω',
  'συνέχισε… έχει κι άλλο',
  'μη σταματάς',
];

let hintStage = -1, hintTimer = null;

function showHint(stage) {
  if (stage !== hintStage) {
    hintStage = stage;
    hintLabel.textContent = HINTS[Math.min(stage, HINTS.length - 1)];
  }
  hintEl.classList.add('in');
}

function hideHint() { hintEl.classList.remove('in'); }

/* she stopped; wait a beat, then nudge her on */
function nudgeSoon() {
  clearTimeout(hintTimer);
  if (!bloomActive) return;
  hintTimer = setTimeout(() => {
    if (!bloomActive || S.target > 0.99) return;
    showHint(Math.min(hintStage + 1, HINTS.length - 1));
  }, 2600);
}

/* ─────────────────────────────── audio ─────────────────────────────── */
/* A streamed mp3, not a decoded buffer: a two-minute track held as raw PCM
   would cost tens of megabytes on a phone. Loads only after the first tap. */

const audio = (() => {
  const btn = $('#sound');
  const SRC = 'audio/hopes-and-fears.mp3';
  const VOL = 0.34;                 // never louder than this
  const LOOP_FADE = 1.6;            // seconds of dip across the loop seam

  let el = null, on = false, ramp = null, primed = false;

  function build() {
    if (el) return;
    el = new Audio();
    el.src = SRC;
    el.preload = 'auto';
    el.loop = false;                // handled by hand, so the seam can be soft
    el.volume = 0;
    el.setAttribute('playsinline', '');

    /* soften the loop: dip out at the tail, dip back in from the top */
    el.addEventListener('timeupdate', () => {
      if (!on || !el.duration) return;
      const left = el.duration - el.currentTime;
      if (left < LOOP_FADE) el.volume = Math.max(0, VOL * (left / LOOP_FADE));
    });
    el.addEventListener('ended', () => {
      if (!on) return;
      el.currentTime = 0;
      el.play().then(() => fadeTo(VOL, LOOP_FADE * 1000)).catch(() => {});
    });
    el.addEventListener('error', () => { btn.classList.remove('in'); });
  }

  function fadeTo(target, ms) {
    if (!el) return;
    clearInterval(ramp);
    const from = el.volume, t0 = performance.now();
    ramp = setInterval(() => {
      const k = clamp((performance.now() - t0) / ms, 0, 1);
      el.volume = clamp(lerp(from, target, easeInOutSine(k)), 0, 1);
      if (k >= 1) clearInterval(ramp);
    }, 60);
  }

  function enable() {
    build();
    on = true;
    btn.setAttribute('aria-pressed', 'true');
    const p = el.play();
    if (p && p.catch) p.catch(() => { on = false; btn.setAttribute('aria-pressed', 'false'); });
    fadeTo(VOL, 4000);
  }

  function disable() {
    on = false;
    btn.setAttribute('aria-pressed', 'false');
    fadeTo(0, 900);
    setTimeout(() => { if (!on && el) el.pause(); }, 1000);
  }

  btn.addEventListener('click', () => { on ? disable() : enable(); });

  document.addEventListener('visibilitychange', () => {
    if (!el || !on) return;
    if (document.hidden) el.pause();
    else el.play().catch(() => {});
  });

  return {
    el: () => el,
    /* iOS only unlocks an element that started inside a gesture handler,
       so the first tap on any control primes it silently */
    prime() {
      build();
      if (primed) return;
      primed = true;
      const p = el.play();
      if (p && p.then) p.then(() => { if (!on) el.pause(); }).catch(() => {});
    },
    start() { btn.classList.add('in'); enable(); },
    /* the reveal leans in a little, then settles back */
    reveal() {
      if (!on || !el) return;
      fadeTo(Math.min(1, VOL * 1.5), 2600);
      setTimeout(() => { if (on) fadeTo(VOL, 6000); }, 9000);
    },
  };
})();

/* ─────────────────────────── the choreography ──────────────────────── */

async function sceneArrival() {
  await wait(650);
  tween('moon', 0.30, 4400, easeOutSine);
  await wait(1500);
  await say('Καλώς ήρθες, Μπεμπού', { hold: 2500 });
  tween('garden', 0.20, 5200, easeOutSine);
  await say('Έχω ακούσει ότι σου αρέσουν πολύ οι παιώνιες…', { hold: 2600 });
  await say('…οπότε σου έφτιαξα έναν μικρό κήπο.', { hold: 2200 });
  await wait(300);
  await showCTA('Μπες στον κήπο');
}

async function sceneGarden() {
  audio.start();
  tween('garden', 1, 4400, easeInOutSine);
  tween('fog', 0.72, 5200, easeOutSine);
  tween('dist', 330, 5400, easeInOutCubic);
  tween('pitch', 12 * RAD, 5400, easeInOutCubic);
  await wait(reduced ? 900 : 4700);
  await say('Θες να ανάψουμε το φεγγάρι;', { hold: 2200 });
  await showCTA('Άναψέ το', false);
}

async function sceneMoonlight() {
  await tween('moon', 1, reduced ? 800 : 3400, easeInOutSine);
  await wait(700);
}

async function sceneFirstPeony() {
  tween('hero', 1, 2400, easeOutCubic);
  await wait(1000);
  await tween('heroBloom', 1, reduced ? 900 : 4800, easeOutQuint);
  await say('Μία για τη Μπεμπού', { hold: 2400 });
  await say('Άλλη μία, γιατί… μία ήταν λίγη.', { hold: 2400 });
}

async function sceneBloom() {
  tween('hero', 0, 2800, easeInOutCubic);
  bloomActive = true;
  applyProgress();
  railEl.classList.add('in');
  await wait(700);
  showHint(0);
}

async function finale() {
  bloomActive = false;
  railEl.classList.remove('in');
  clearTimeout(hintTimer);
  hideHint();
  clearLines();

  S.progress = S.target = 1;
  applyProgress();

  /* one last breath outward — the planting finishes assembling itself */
  tween('fog', 0.95, 5000, easeInOutSine);
  tween('reveal', 1, 7000, easeInOutCubic);
  tween('dist', FIT * 1.10, reduced ? 900 : 8000, easeInOutCubic);
  tween('pitch', 50 * RAD, reduced ? 900 : 8000, easeInOutCubic);
  tween('aimSY', 0.545, 8000, easeInOutCubic);

  await wait(reduced ? 1300 : 5600);
  audio.reveal();
  await wait(reduced ? 400 : 2400);

  await say('Εντάξει… νομίζω το παρακάναμε λίγο.', { hold: 3000 });
  await wait(900);
  await say('Καλό βράδυ, Μπεμπού', { hold: 3000 });
  await say('Ελπίζω να σου άρεσε ο μικρός σου κήπος.', { hold: 4400, soft: true });

  tween('dist', FIT * 1.15, 40000, easeInOutSine);   // the garden keeps breathing
}

async function run() {
  await sceneArrival();
  await sceneGarden();
  await sceneMoonlight();
  await sceneFirstPeony();
  await sceneBloom();
}

/* ───────────────────────────── input ───────────────────────────────── */

let touchY = null, touchId = null;

stage.addEventListener('touchstart', (e) => {
  const tch = e.changedTouches[0];
  touchId = tch.identifier; touchY = tch.clientY;
}, { passive: true });

stage.addEventListener('touchmove', (e) => {
  if (!bloomActive || touchY === null) return;
  let tch = null;
  for (const c of e.changedTouches) if (c.identifier === touchId) tch = c;
  if (!tch) return;
  const dy = touchY - tch.clientY;
  touchY = tch.clientY;
  addProgress((dy / H) * 0.60);
}, { passive: true });

stage.addEventListener('touchend', () => { touchY = null; touchId = null; }, { passive: true });

stage.addEventListener('wheel', (e) => {
  if (!bloomActive) return;
  e.preventDefault();
  addProgress((e.deltaY / 1500) * 0.55);
}, { passive: false });

let downY = null, moved = 0;
stage.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') return;
  downY = e.clientY; moved = 0;
});
stage.addEventListener('pointermove', (e) => {
  if (downY === null || !bloomActive) return;
  const dy = downY - e.clientY;
  downY = e.clientY; moved += Math.abs(dy);
  addProgress((dy / H) * 0.60);
});
window.addEventListener('pointerup', (e) => {
  if (downY !== null && moved < 6 && bloomActive && !e.target.closest('.cta')) addProgress(0.075);
  downY = null;
});

window.addEventListener('keydown', (e) => {
  if (!bloomActive) return;
  if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); addProgress(0.06); }
  if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); addProgress(-0.06); }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) running = false;
  else if (!running) { running = true; last = 0; requestAnimationFrame(frame); }
});

/* ───────────────────────────── boot ────────────────────────────────── */

function applyCanvasSize() {
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
}

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, DPR_CAP, quality > 0 ? DPR_CAP : 1.25);
  W = stage.clientWidth;
  H = stage.clientHeight;
  applyCanvasSize();
  buildGradients();
  buildStars();
  computeFit();
  updateCamera();
}

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(resize, 160);
});
window.addEventListener('orientationchange', () => setTimeout(resize, 260));

/* author-side inspection hook: open with #dev */
if (location.hash === '#dev') {
  window.__garden = {
    S, cam, flowers, tween, sprite, drawPeony, audio,
    setDpr(v) { DPR = v; applyCanvasSize(); updateCamera(); return DPR; },
    /* advance the scene clock by hand, at a fixed 60fps step, so the real
       timed sequence can be inspected without depending on a live rAF */
    tick(sec = 1) {
      const step = 1 / 60;
      for (let i = 0, n = Math.round(sec / step); i < n; i++) {
        stepTweens(step);
        if (bloomActive) { S.progress += (S.target - S.progress) * step * 2.4; applyProgress(); }
        for (const f of flowers) {
          const target = easeOutCubic(clamp((S.progress - f.t0) / 0.12, 0, 1));
          f.bloom += (target - f.bloom) * Math.min(1, step * 2.0);
        }
      }
      updateCamera();
      render(t, step);
      return { moon: +S.moon.toFixed(3), garden: +S.garden.toFixed(3) };
    },
    bench(n = 90) {                      // pure raster cost of one frame, in ms
      updateCamera();
      render(1, 0.016);                  // warm the sprite cache first
      const t0 = performance.now();
      for (let i = 0; i < n; i++) render(i * 0.016, 0.016);
      return +((performance.now() - t0) / n).toFixed(2);
    },
    strip(variant = 0) {                 // filmstrip of the bloom, for eyeballing
      running = false;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.fillStyle = '#0b1020'; ctx.fillRect(0, 0, W, H);
      const cols = 3, cell = W / cols;
      for (let i = 0; i < 9; i++) {
        const c = makeCanvas(200, 200);
        drawPeony(c.getContext('2d'), 200, i / 8, variant);
        ctx.drawImage(c, (i % cols) * cell, Math.floor(i / cols) * cell, cell, cell);
      }
      return 'strip';
    },
    jump(p, opts = {}) {
      devTakeover = true;
      tweens.length = 0;
      capsEl.innerHTML = ''; ctaEl.innerHTML = '';
      bloomActive = true;
      S.target = S.progress = p;
      S.moon = 1; S.garden = 1; S.fog = 0.85; S.hero = opts.hero || 0; S.heroBloom = 1;
      S.reveal = p > 0.99 ? 1 : 0;
      applyProgress();
      if (p > 0.99) { S.dist = FIT * 1.10; S.pitch = 50 * RAD; S.aimSY = 0.545; }
      flowers.forEach((f) => { f.bloom = easeOutCubic(clamp((p - f.t0) / 0.12, 0, 1)); });
      updateCamera();
      return 'jumped ' + p;
    },
  };
}

document.documentElement.dataset.tier = String(TIER);

buildGarden();
buildAmbient();
resize();
requestAnimationFrame(frame);
run();

})();
