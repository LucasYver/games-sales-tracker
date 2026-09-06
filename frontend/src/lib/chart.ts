/**
 * Geometry helpers shared by the public charts. Everything is drawn as inline
 * SVG on a fixed 800×250 viewBox and scaled with CSS, so a chart costs no
 * client JS and stays sharp at any width.
 */

export const VB_W = 800;
export const VB_H = 250;
const PAD_L = 54;
const PAD_R = 10;
const PAD_T = 16;
const PAD_B = 26;

export const BASELINE = VB_H - PAD_B;
export const PLOT_TOP = PAD_T;
export const PLOT_LEFT = PAD_L;
export const PLOT_RIGHT = VB_W - PAD_R;

/** Round a maximum up to a readable 1 / 2 / 2.5 / 5 × 10ⁿ tick. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const scaled = value / base;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
  return step * base;
}

export function scaleY(value: number, max: number): number {
  const clamped = Math.max(0, Math.min(value, max));
  return BASELINE - (clamped / max) * (BASELINE - PLOT_TOP);
}

export function scaleX(t: number, tMin: number, tMax: number): number {
  if (tMax <= tMin) return PLOT_RIGHT;
  const ratio = (t - tMin) / (tMax - tMin);
  return PLOT_LEFT + ratio * (PLOT_RIGHT - PLOT_LEFT);
}

/**
 * Keep a series readable (and the DOM small) by averaging it down to at most
 * `target` points, preserving the first and last observation.
 */
export function downsample<T>(points: T[], target = 80): T[] {
  if (points.length <= target) return points;
  const step = (points.length - 1) / (target - 1);
  const out: T[] = [];
  for (let i = 0; i < target; i++) out.push(points[Math.round(i * step)]);
  return out;
}
