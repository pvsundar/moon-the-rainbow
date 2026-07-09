/**
 * moon-rainbow-math.js
 *
 * Pure math for "Moon on the Rainbow". No DOM, no React — every function
 * here is unit-tested in tests/moon-rainbow-math.test.mjs.
 *
 * THE MODEL (simplified, educational — not an ephemeris):
 *
 *   1. A primary rainbow is a circle of angular radius ~42° centered on the
 *      antisolar point (the point in the sky directly opposite the Sun).
 *
 *   2. Because the Sun and the antisolar point are antipodal (exactly 180°
 *      apart on the celestial sphere), ANY point that is ρ degrees from the
 *      antisolar point is exactly (180° − ρ) degrees from the Sun. This is
 *      EXACT spherical geometry — it holds for every position angle φ around
 *      the bow, which is why the Moon's illumination is constant all along
 *      the rainbow. The invariance is a theorem, not an approximation.
 *
 *   3. Illuminated fraction k = (1 − cos E) / 2, where E is solar elongation
 *      in degrees. This follows from the standard lunar-phase formula
 *      k = (1 + cos i) / 2 (i = Sun–Moon–Earth phase angle) combined with
 *      the far-Sun approximation i ≈ 180° − E (excellent, because the Sun
 *      is ~390× farther from Earth than the Moon is).
 *
 *   The only approximations in the model are the fixed 42° bow radius
 *   (really ~40.5° violet to ~42.4° red) and the idealized k formula.
 */

/**
 * Illuminated fraction of the Moon's disk for a given solar elongation.
 * @param {number} elongationDegrees - Sun–Moon angle seen by the observer, 0–180.
 * @returns {number} illuminated fraction, 0 (new) to 1 (full).
 */
export function illuminationFromElongation(elongationDegrees) {
  const clamped = Math.max(0, Math.min(180, elongationDegrees));
  const radians = (clamped * Math.PI) / 180;
  return (1 - Math.cos(radians)) / 2;
}

/**
 * Solar elongation of a Moon sitting exactly on a rainbow of the given
 * angular radius (measured from the antisolar point). Exact: E = 180° − ρ.
 * @param {number} rainbowRadiusDegrees - e.g. 42 (primary) or 51 (secondary).
 * @returns {number} solar elongation in degrees.
 */
export function elongationFromRainbowRadius(rainbowRadiusDegrees) {
  return 180 - rainbowRadiusDegrees;
}

/**
 * Human-readable phase name from illuminated fraction alone.
 *
 * Deliberately does NOT distinguish waxing from waning: illuminated fraction
 * is a function of elongation magnitude only, so it cannot on its own say
 * whether the Moon is approaching or receding from full. Inferring that from
 * screen position would assert an orbital-progression claim this model does
 * not support.
 *
 * @param {number} k - illuminated fraction, 0 to 1.
 * @returns {string}
 */
export function phaseName(k) {
  if (k < 0.02) return "New";
  if (k < 0.48) return "Crescent";
  if (k < 0.52) return "Quarter";
  if (k < 0.98) return "Gibbous";
  return "Full";
}

/* ----------------------------------------------------------------
   Sky-projection geometry.

   The sky view is a flat projection: the antisolar point is a fixed pixel
   CENTER, and a sky position is (ρ, φ) — ρ = angular distance from the
   antisolar point (degrees, drawn at pxPerDeg pixels per degree), φ =
   position angle around it (degrees, 0 = straight up, positive = clockwise
   toward the right).

   These helpers are the ONLY code that converts between (ρ, φ) and pixels.
   The app stores (ρ, φ) as its single source of truth, so ρ can never
   drift through pixel clamping — the bug class an earlier draft had, where
   Cartesian clamping after the fact turned ρ = 42° into ρ = 43.51°
   (86.26% instead of 87.16%) at the ends of the φ slider.
   ---------------------------------------------------------------- */

/**
 * @typedef {Object} SkyGeometry
 * @property {number} centerX - antisolar point x (px)
 * @property {number} centerY - antisolar point y (px)
 * @property {number} pxPerDeg - pixels per degree of angular distance
 * @property {number} minX @property {number} maxX
 * @property {number} minY @property {number} maxY - allowed pixel box for the Moon's center
 */

/**
 * Largest |φ| (degrees, 0 = straight up) that keeps a point at angular
 * distance ρ inside the visible-sky box. Two constraints bind:
 *   horizon (maxY):  cos φ ≥ (centerY − maxY) / ρpx
 *   side walls (maxX, symmetric): |sin φ| ≤ (maxX − centerX) / ρpx
 * The TOP edge (minY) is deliberately NOT handled here: it would make the
 * valid φ set disjoint. Instead the app caps ρ at maxRhoDeg(geom) so the
 * top edge can never bind. tests/ enforce this with a property test.
 * @param {number} rhoDeg
 * @param {SkyGeometry} geom
 * @returns {number} max |φ| in degrees (0–180)
 */
export function maxPhiDeg(rhoDeg, geom) {
  const rhoPx = rhoDeg * geom.pxPerDeg;
  if (rhoPx <= 0) return 180;
  const yCos = (geom.centerY - geom.maxY) / rhoPx;
  const xSin = (geom.maxX - geom.centerX) / rhoPx;
  const phiFromY = yCos >= 1 ? 0 : yCos <= -1 ? 180 : (Math.acos(yCos) * 180) / Math.PI;
  const phiFromX = xSin >= 1 ? 180 : (Math.asin(Math.max(-1, Math.min(1, xSin))) * 180) / Math.PI;
  return Math.min(phiFromY, phiFromX);
}

/**
 * Largest ρ for which φ = 0 (straight up) still fits under the top edge.
 * The app must clamp ρ to this so maxPhiDeg's contiguous interval is valid.
 * @param {SkyGeometry} geom
 * @returns {number} degrees
 */
export function maxRhoDeg(geom) {
  return (geom.centerY - geom.minY) / geom.pxPerDeg;
}

/**
 * Exact (ρ, φ) → (x, y). No follow-up clamping — callers clamp φ first via
 * maxPhiDeg, so ρ is preserved to floating-point precision.
 * @param {number} rhoDeg @param {number} phiDeg @param {SkyGeometry} geom
 * @returns {{x: number, y: number}}
 */
export function pointFromRhoPhi(rhoDeg, phiDeg, geom) {
  const rhoPx = rhoDeg * geom.pxPerDeg;
  const phiRad = (phiDeg * Math.PI) / 180;
  return {
    x: geom.centerX + rhoPx * Math.sin(phiRad),
    y: geom.centerY - rhoPx * Math.cos(phiRad),
  };
}

/**
 * Inverse of pointFromRhoPhi: pixel position → unclamped (ρ, φ).
 * @param {number} x @param {number} y @param {SkyGeometry} geom
 * @returns {{rhoDeg: number, phiDeg: number}}
 */
export function rhoPhiFromPoint(x, y, geom) {
  const dx = x - geom.centerX;
  const dy = y - geom.centerY;
  const distPx = Math.sqrt(dx * dx + dy * dy);
  const rhoDeg = distPx / geom.pxPerDeg;
  const phiDeg = distPx > 1e-9 ? (Math.atan2(dx, -dy) * 180) / Math.PI : 0;
  return { rhoDeg, phiDeg };
}
