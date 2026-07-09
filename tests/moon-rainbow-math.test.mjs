/**
 * Unit tests for moon-rainbow-math.js — plain node:test, zero dependencies.
 * Run with:  npm test   (= node --test tests/)
 *
 * Reference cases from the spec:
 *   E=0    -> k≈0.00  (new moon)
 *   E=90   -> k≈0.50  (quarter moon)
 *   E=138  -> k≈0.872 (Moon on the primary rainbow, ~87%)
 *   E=180  -> k≈1.00  (full moon)
 * plus geometry property tests that pin down two bug classes found in
 * earlier drafts: ρ drift from Cartesian clamping, and off-canvas Moon
 * positions when ρ exceeds the top-edge limit.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  illuminationFromElongation,
  elongationFromRainbowRadius,
  phaseName,
  maxPhiDeg,
  maxRhoDeg,
  pointFromRhoPhi,
  rhoPhiFromPoint,
} from "../src/moon-rainbow-math.js";

// Must mirror the constants in MoonOnTheRainbow.jsx (glyph-aware bounds).
const MOON_GLYPH_R = 34;
const GEOM = {
  centerX: 400,
  centerY: 430,
  pxPerDeg: 4,
  minX: 30 + MOON_GLYPH_R,
  maxX: 770 - MOON_GLYPH_R,
  minY: 18 + MOON_GLYPH_R,
  maxY: 376,
};
const RAINBOW = 42;
const MIN_ANGLE = 14;
const MAX_ANGLE = 94;

function approxEqual(actual, expected, tolerance, label) {
  const diff = Math.abs(actual - expected);
  assert.ok(diff <= tolerance, `${label}: expected ${expected} ± ${tolerance}, got ${actual}`);
}

/* ------------------------- illumination ------------------------- */

test("new moon at E=0", () => {
  approxEqual(illuminationFromElongation(0), 0, 1e-9, "k at E=0");
});

test("quarter moon at E=90", () => {
  approxEqual(illuminationFromElongation(90), 0.5, 1e-9, "k at E=90");
});

test("full moon at E=180", () => {
  approxEqual(illuminationFromElongation(180), 1, 1e-9, "k at E=180");
});

test("primary rainbow (42°) implies E=138°", () => {
  assert.equal(elongationFromRainbowRadius(42), 138);
});

test("secondary rainbow (51°) implies E=129°", () => {
  assert.equal(elongationFromRainbowRadius(51), 129);
});

test("Moon on the primary rainbow is ~87% illuminated (spec reference value)", () => {
  const E = elongationFromRainbowRadius(RAINBOW);
  const k = illuminationFromElongation(E);
  approxEqual(k, 0.8716, 0.0005, "k at E=138");
  assert.equal(Math.round(k * 100), 87);
});

test("illumination is monotonically increasing with elongation", () => {
  const samples = [0, 20, 45, 70, 90, 110, 138, 160, 180];
  for (let i = 1; i < samples.length; i += 1) {
    assert.ok(
      illuminationFromElongation(samples[i]) > illuminationFromElongation(samples[i - 1]),
      `k should increase from E=${samples[i - 1]} to E=${samples[i]}`
    );
  }
});

test("illumination is clamped for out-of-range input", () => {
  approxEqual(illuminationFromElongation(-10), 0, 1e-9, "clamp below 0");
  approxEqual(illuminationFromElongation(200), 1, 1e-9, "clamp above 180");
});

test("phaseName reference cases (no waxing/waning inference)", () => {
  assert.equal(phaseName(0.01), "New");
  assert.equal(phaseName(0.25), "Crescent");
  assert.equal(phaseName(0.5), "Quarter");
  assert.equal(phaseName(0.872), "Gibbous");
  assert.equal(phaseName(0.99), "Full");
});

/* ---------------------- geometry invariance ---------------------- */

test("INVARIANCE: ρ is preserved exactly across the whole φ range on the bow", () => {
  const maxPhi = maxPhiDeg(RAINBOW, GEOM);
  assert.ok(maxPhi > 60, `bow should allow a wide sweep (got ±${maxPhi.toFixed(1)}°)`);
  for (let phi = -maxPhi; phi <= maxPhi; phi += maxPhi / 24) {
    const p = pointFromRhoPhi(RAINBOW, phi, GEOM);
    const back = rhoPhiFromPoint(p.x, p.y, GEOM);
    approxEqual(back.rhoDeg, RAINBOW, 1e-9, `ρ round-trip at φ=${phi.toFixed(1)}°`);
  }
});

test("INVARIANCE: illumination on the bow is identical at every φ (87.16%)", () => {
  const kRef = illuminationFromElongation(180 - RAINBOW);
  const maxPhi = maxPhiDeg(RAINBOW, GEOM);
  for (let phi = -maxPhi; phi <= maxPhi; phi += 5) {
    const p = pointFromRhoPhi(RAINBOW, phi, GEOM);
    const { rhoDeg } = rhoPhiFromPoint(p.x, p.y, GEOM);
    const k = illuminationFromElongation(180 - rhoDeg);
    approxEqual(k, kRef, 1e-12, `k at φ=${phi}°`);
  }
});

test("REGRESSION: every reachable (ρ, φ) stays inside the sky box (no off-canvas Moon)", () => {
  // An earlier draft allowed ρ up to 118°, which put the Moon above the
  // canvas at small |φ|. MAX_ANGLE must respect the top edge.
  assert.ok(
    MAX_ANGLE <= maxRhoDeg(GEOM),
    `MAX_ANGLE (${MAX_ANGLE}) must be ≤ top-edge limit (${maxRhoDeg(GEOM)})`
  );
  for (let rho = MIN_ANGLE; rho <= MAX_ANGLE; rho += 0.5) {
    const maxPhi = maxPhiDeg(rho, GEOM);
    for (const phi of [-maxPhi, -maxPhi / 2, 0, maxPhi / 2, maxPhi]) {
      const p = pointFromRhoPhi(rho, phi, GEOM);
      assert.ok(p.x >= GEOM.minX - 1e-6 && p.x <= GEOM.maxX + 1e-6, `x in bounds at ρ=${rho}, φ=${phi.toFixed(1)}`);
      assert.ok(p.y >= GEOM.minY - 1e-6 && p.y <= GEOM.maxY + 1e-6, `y in bounds at ρ=${rho}, φ=${phi.toFixed(1)}`);
    }
  }
});

test("REGRESSION: MIN_ANGLE is reachable above the horizon (φ interval non-empty)", () => {
  // ρ · cos(φ) must be able to clear centerY − maxY = 54 px.
  assert.ok(MIN_ANGLE * GEOM.pxPerDeg >= GEOM.centerY - GEOM.maxY,
    "MIN_ANGLE must place the Moon at or above the horizon at φ=0");
  const maxPhi = maxPhiDeg(MIN_ANGLE, GEOM);
  assert.ok(maxPhi >= 0, "φ interval exists at MIN_ANGLE");
  const p = pointFromRhoPhi(MIN_ANGLE, 0, GEOM);
  assert.ok(p.y <= GEOM.maxY + 1e-6, "Moon at MIN_ANGLE sits above the horizon");
});

test("rhoPhiFromPoint ↔ pointFromRhoPhi round-trips φ too", () => {
  for (const rho of [MIN_ANGLE, 30, RAINBOW, 60, 85, MAX_ANGLE]) {
    const maxPhi = maxPhiDeg(rho, GEOM);
    for (const phi of [-maxPhi, -17.3, 0, 8.9, maxPhi]) {
      if (Math.abs(phi) > maxPhi) continue;
      const p = pointFromRhoPhi(rho, phi, GEOM);
      const back = rhoPhiFromPoint(p.x, p.y, GEOM);
      approxEqual(back.phiDeg, phi, 1e-9, `φ round-trip at ρ=${rho}, φ=${phi}`);
    }
  }
});
