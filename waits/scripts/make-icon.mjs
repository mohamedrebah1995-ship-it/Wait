// Generates the Delivr app icon + splash source PNGs into assets/ from a vector design.
// Design: teal (#00b8a9) stopwatch on the app's dark #121519 — "wait times" in one glyph.
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const TEAL = "#00b8a9", DARK1 = "#16242b", DARK2 = "#0e1216", INK = "#121519";
mkdirSync("assets", { recursive: true });

// polar point measured from 12 o'clock, clockwise
const P = (cx, cy, r, deg) => { const a = (deg * Math.PI) / 180; return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; };
const n = v => Math.round(v * 100) / 100;

// A stopwatch centred at (cx,cy) scaled by s (1 = ~600px tall). Returns SVG fragment.
function stopwatch(cx, cy, s) {
  const ringR = 250 * s, ringW = 46 * s, tickIn = 205 * s, hubR = 22 * s;
  const ticks = [];
  for (let k = 0; k < 12; k++) {
    const major = k % 3 === 0;
    const [x1, y1] = P(cx, cy, major ? 218 * s : 224 * s, k * 30);
    const [x2, y2] = P(cx, cy, tickIn, k * 30);
    ticks.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${TEAL}" stroke-width="${n((major ? 14 : 8) * s)}" stroke-linecap="round" opacity="${major ? 0.95 : 0.5}"/>`);
  }
  const [hx, hy] = P(cx, cy, 168 * s, 52);   // hand tip (~1:45)
  const [tx, ty] = P(cx, cy, 60 * s, 232);   // short counterweight tail
  const [cwx, cwy] = P(cx, cy, ringR + 26 * s, 0); // crown base at 12 o'clock
  return `
    <circle cx="${n(cx)}" cy="${n(cy)}" r="${n(ringR)}" fill="none" stroke="${TEAL}" stroke-width="${n(ringW)}"/>
    ${ticks.join("")}
    <line x1="${n(tx)}" y1="${n(ty)}" x2="${n(hx)}" y2="${n(hy)}" stroke="${TEAL}" stroke-width="${n(26 * s)}" stroke-linecap="round"/>
    <circle cx="${n(cx)}" cy="${n(cy)}" r="${n(hubR)}" fill="${INK}" stroke="${TEAL}" stroke-width="${n(10 * s)}"/>
    <rect x="${n(cx - 46 * s)}" y="${n(cwy - 58 * s)}" width="${n(92 * s)}" height="${n(46 * s)}" rx="${n(20 * s)}" fill="${TEAL}"/>
    <rect x="${n(cx - 30 * s)}" y="${n(cwy - 92 * s)}" width="${n(60 * s)}" height="${n(44 * s)}" rx="${n(16 * s)}" fill="${TEAL}"/>`;
}

const bg = (w) => `
  <defs><radialGradient id="g" cx="50%" cy="42%" r="72%">
    <stop offset="0%" stop-color="${DARK1}"/><stop offset="100%" stop-color="${DARK2}"/>
  </radialGradient></defs>
  <rect width="${w}" height="${w}" fill="url(#g)"/>`;

const iconSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${bg(1024)}${stopwatch(512, 556, 1.30)}</svg>`;

const splashSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732" viewBox="0 0 2732 2732">
  ${bg(2732)}${stopwatch(1366, 1366, 1.55)}</svg>`;

async function render(svg, out, size) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`assets/${out}`);
  console.log("wrote assets/" + out);
}
await render(iconSVG, "icon-only.png", 1024);
await render(splashSVG, "splash.png", 2732);
await render(splashSVG, "splash-dark.png", 2732);
