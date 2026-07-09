import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  illuminationFromElongation,
  phaseName,
  maxPhiDeg,
  maxRhoDeg,
  pointFromRhoPhi,
  rhoPhiFromPoint,
} from "./moon-rainbow-math.js";

/* ================================================================
   CONSTANTS

   The app's single source of truth is (ρ, φ):
     ρ  = angular distance from the antisolar point, degrees
     φ  = position angle around it, degrees (0 = straight up)
   Pixel positions are always DERIVED from (ρ, φ), never the reverse
   (except while interpreting a pointer drag). This is what guarantees
   ρ = 42.000…° stays exact all the way around the bow.
   ================================================================ */

const SKY_W = 800;
const SKY_H = 480;
const HORIZON_Y = 380;

// Bounds are GLYPH-AWARE: the Moon is drawn ~34 px around its center
// (disk + glow ring), so the box is inset far enough that the whole glyph
// stays on-canvas at every reachable (ρ, φ). maxY is the horizon line —
// the Moon may sit ON the horizon, which is natural, never below it.
const MOON_GLYPH_R = 34;
const GEOM = {
  centerX: 400,
  centerY: 430, // antisolar point, just below the horizon
  pxPerDeg: 4,
  minX: 30 + MOON_GLYPH_R,
  maxX: 770 - MOON_GLYPH_R,
  minY: 18 + MOON_GLYPH_R,
  maxY: HORIZON_Y - 4,
};

const RAINBOW_RADIUS_DEG = 42; // Version 1 models the primary bow only.
const MIN_ANGLE = 14; // smallest ρ that still sits above the horizon at φ=0
const MAX_ANGLE = 94; // largest ρ whose whole glyph fits under the top edge at φ=0 (≤ maxRhoDeg(GEOM))
const NEAR_BOW_TOLERANCE = 2.2; // "you're close" glow while dragging
const RELEASE_SNAP_TOLERANCE = 4.5; // release this close → settle exactly on the bow
const SLIDER_SNAP_TOLERANCE = 1.2; // ρ slider is gently magnetic near 42°
const DRAG_ESCAPE_TOLERANCE = 9; // pull this far off the bow to break the magnetic lock
const CONFIRM_SWEEP_DEG = 60; // continuous φ sweep (single contact) that confirms the invariance
const EXACT_EPS = 0.01;

const COLORS = { moonBright: "#f2ecd9", moonDark: "#182645" };
const BAND_COLORS = ["#e2665c", "#e8935a", "#e8c15e", "#8ab389", "#6c93b8", "#6e77b0", "#9772ac"];

const MAX_PHI_AT_RAINBOW = maxPhiDeg(RAINBOW_RADIUS_DEG, GEOM);

// Deterministic starfield (fixed LCG seed — same sky every visit).
const STARS = (() => {
  let s = 20260709;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  return Array.from({ length: 64 }, () => ({
    x: +(rnd() * SKY_W).toFixed(1),
    y: +(rnd() * (HORIZON_Y - 24)).toFixed(1),
    r: +(0.5 + rnd() * 1.1).toFixed(2),
    o: +(0.2 + rnd() * 0.5).toFixed(2),
  }));
})();

const DISCOVERY_CARDS = [
  "A rainbow has a geometric center. It is centered opposite the Sun — the antisolar point.",
  "A full Moon is also found near the direction opposite the Sun.",
  "The primary rainbow sits about 42° away from that antisolar direction, all the way around its circle.",
  "So a Moon centered on the primary rainbow is about 138° from the Sun in angular separation — no matter which point on the bow it sits on.",
  "That geometry corresponds to a Moon that is approximately 87% illuminated: gibbous.",
];

/* ================================================================
   TINY INLINE ICONS (no icon-library dependency)
   ================================================================ */

function IconSun({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function IconCap({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 9L12 4 2 9l10 5 10-5z" />
      <path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5" />
      <path d="M22 9v5" />
    </svg>
  );
}

function IconX({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/* ================================================================
   MOON PHASE SHAPE
   Rendered with rect + rect + ellipse inside a circular clip —
   deliberately avoiding hand-built SVG arc paths (no sweep-flag risk).
   Drawn in one canonical orientation (bright limb on the right); the
   caller rotates the whole glyph so the bright limb points away from
   the antisolar point — i.e., along the great circle toward the Sun.
   ================================================================ */

function MoonPhaseShape({ k, size, uid }) {
  const r = size / 2;
  const rx = r * Math.abs(1 - 2 * k);
  const ellipseFill = k < 0.5 ? COLORS.moonDark : COLORS.moonBright;
  const clipId = `moonClip-${uid}`;
  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <circle cx={r} cy={r} r={r} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect x="0" y="0" width={size} height={size} fill={COLORS.moonDark} />
        <rect x={r} y="0" width={r} height={size} fill={COLORS.moonBright} />
        <ellipse cx={r} cy={r} rx={rx} ry={r} fill={ellipseFill} />
      </g>
      <circle cx={r} cy={r} r={r - 0.5} fill="none" stroke="rgba(244,241,234,0.25)" strokeWidth="1" />
    </>
  );
}

/* ================================================================
   INTERACTIVE SKY VIEW
   ================================================================ */

function SkyView({
  svgRef,
  moonPos,
  rhoDeg,
  phiDeg,
  k,
  isOnRainbow,
  isNearRainbow,
  dragging,
  reducedMotion,
  onMoonPointerDown,
  onMoonKeyDown,
  showSunHint,
}) {
  const rainbowRadiusPx = RAINBOW_RADIUS_DEG * GEOM.pxPerDeg;
  const moonSize = 52;
  const moonR = moonSize / 2;
  const bearingDeg = phiDeg - 90; // glyph rotation: bright limb radially outward

  return (
    <svg
      ref={svgRef}
      className="sky-svg"
      viewBox={`0 0 ${SKY_W} ${SKY_H}`}
      role="img"
      aria-label={`Sky view. The Moon is ${Math.round(rhoDeg)} degrees from the antisolar point and ${Math.round(
        k * 100
      )} percent illuminated. Drag the Moon or use the sliders below.`}
    >
      <defs>
        <linearGradient id="skyGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0b1a33" />
          <stop offset="55%" stopColor="#17335c" />
          <stop offset="100%" stopColor="#2e5c8a" />
        </linearGradient>
        <radialGradient id="insideBowGlow">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.05" />
          <stop offset="78%" stopColor="#ffffff" stopOpacity="0.07" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.12" />
        </radialGradient>
        <clipPath id="skyClip">
          <rect x="0" y="0" width={SKY_W} height={HORIZON_Y} />
        </clipPath>
      </defs>

      <rect x="0" y="0" width={SKY_W} height={SKY_H} fill="url(#skyGradient)" />

      <g clipPath="url(#skyClip)">
        {STARS.map((st, i) => (
          <circle key={i} cx={st.x} cy={st.y} r={st.r} fill="#e8ecf5" opacity={st.o} />
        ))}

        {/* Real optics, subtly drawn: the sky is brighter INSIDE the primary bow. */}
        <circle cx={GEOM.centerX} cy={GEOM.centerY} r={rainbowRadiusPx - 20} fill="url(#insideBowGlow)" />

        {BAND_COLORS.map((c, i) => (
          <circle
            key={c}
            cx={GEOM.centerX}
            cy={GEOM.centerY}
            r={Math.max(4, rainbowRadiusPx + (i - 3) * 6)}
            fill="none"
            stroke={c}
            strokeWidth="6"
            opacity={isOnRainbow || isNearRainbow ? 0.95 : 0.75}
          />
        ))}
      </g>

      <path
        d={`M0,${SKY_H} L0,${HORIZON_Y + 30} Q120,${HORIZON_Y - 10} 260,${HORIZON_Y + 12}
            Q420,${HORIZON_Y + 34} 560,${HORIZON_Y + 6} Q680,${HORIZON_Y - 14} ${SKY_W},${HORIZON_Y + 22}
            L${SKY_W},${SKY_H} Z`}
        fill="#050d1c"
      />

      {/* Observer, standing at the bottom center — the Sun is behind them. */}
      <g transform={`translate(${SKY_W / 2}, ${SKY_H - 30})`} aria-hidden="true">
        <ellipse cx="0" cy="16" rx="20" ry="5" fill="#000" opacity="0.35" />
        <circle cx="0" cy="-12" r="6" fill="#f4f1ea" opacity="0.85" />
        <path d="M -8,-2 Q0,-10 8,-2 L 6,16 L -6,16 Z" fill="#f4f1ea" opacity="0.85" />
      </g>

      {showSunHint && (
        <g aria-hidden="true">
          <ellipse cx={SKY_W / 2} cy={SKY_H + 24} rx="180" ry="46" fill="#f0a94e" opacity="0.22" />
          <line
            x1={SKY_W / 2}
            y1={SKY_H - 30}
            x2={SKY_W / 2}
            y2={SKY_H + 2}
            stroke="#f0a94e"
            strokeWidth="2"
            strokeDasharray="3 4"
          />
          <text x={SKY_W / 2} y={SKY_H - 8} textAnchor="middle" className="sky-label">
            ☀ The Sun — low in the sky, directly behind you
          </text>
        </g>
      )}

      <g
        transform={`translate(${moonPos.x}, ${moonPos.y}) rotate(${bearingDeg})`}
        className={`moon-group ${dragging || reducedMotion ? "no-transition" : ""}`}
        onPointerDown={onMoonPointerDown}
        onKeyDown={onMoonKeyDown}
        tabIndex={0}
        role="slider"
        aria-label="Moon position in the sky. Arrow keys move the Moon toward or away from the rainbow; press Home to place it on the rainbow."
        aria-valuemin={MIN_ANGLE}
        aria-valuemax={MAX_ANGLE}
        aria-valuenow={Math.round(rhoDeg)}
        aria-valuetext={`${Math.round(rhoDeg)} degrees from the antisolar point, ${Math.round(
          k * 100
        )} percent illuminated`}
      >
        {(isOnRainbow || isNearRainbow) && (
          <circle r="34" className="moon-glow" fill="none" stroke="#fff6df" strokeWidth="2" opacity="0.55" />
        )}
        <circle r="30" fill="rgba(0,0,0,0.25)" />
        <svg x={-moonR} y={-moonR} width={moonSize} height={moonSize} viewBox={`0 0 ${moonSize} ${moonSize}`}>
          <MoonPhaseShape k={k} size={moonSize} uid="sky" />
        </svg>
      </g>
    </svg>
  );
}

/* ================================================================
   OBSERVER-CENTERED ANGLE VIEW
   φ is a real position angle on the observer's sky — but every value
   of φ produces a congruent Sun–observer–Moon configuration in this
   plane, so this panel depends only on ρ. That IS the discovery.
   ================================================================ */

function arcPolyline(center, radius, fromDeg, toDeg, steps = 28) {
  const pts = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = fromDeg + ((toDeg - fromDeg) * i) / steps;
    const rad = (t * Math.PI) / 180;
    pts.push(`${(center.x + radius * Math.cos(rad)).toFixed(1)},${(center.y - radius * Math.sin(rad)).toFixed(1)}`);
  }
  return pts.join(" ");
}

function GeometryView({ rhoDeg, elongation, k, isOnRainbow }) {
  const w = 640;
  const h = 220;
  const earth = { x: 340, y: 148 };
  const sun = { x: 90, y: 148 };
  const orbitR = 92;
  const moon = {
    x: earth.x + orbitR * Math.cos((rhoDeg * Math.PI) / 180),
    y: earth.y - orbitR * Math.sin((rhoDeg * Math.PI) / 180),
  };
  const thetaArc = arcPolyline(earth, 38, 0, rhoDeg);
  const elongArc = arcPolyline(earth, 64, 180, rhoDeg);

  const readout = isOnRainbow
    ? `Rainbow radius = ${RAINBOW_RADIUS_DEG}° · Elongation E = 180° − ${RAINBOW_RADIUS_DEG}° = ${Math.round(
        elongation
      )}° · Illumination ≈ ${Math.round(k * 100)}%`
    : `ρ ≈ ${Math.round(rhoDeg)}° from the point opposite the Sun · Elongation E ≈ ${Math.round(
        elongation
      )}° · Illumination ≈ ${Math.round(k * 100)}%`;

  return (
    <figure className="geo-figure">
      <figcaption className="geo-head">
        <h2 className="geo-title">The angle between the Sun and the Moon</h2>
        <p className="geo-subtitle">as seen by you, the observer — not a scale model</p>
      </figcaption>
      <svg
        className="geo-svg"
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`Observer-centered angle diagram. Solar elongation ${Math.round(
          elongation
        )} degrees. Illumination ${Math.round(k * 100)} percent.`}
      >
        <rect x="0" y="0" width={w} height={h} rx="18" fill="#0e1f3d" />

        <line x1={sun.x} y1={sun.y} x2={earth.x} y2={earth.y} stroke="#f0a94e" strokeWidth="2" />
        <line
          x1={earth.x}
          y1={earth.y}
          x2={earth.x + orbitR + 74}
          y2={earth.y}
          stroke="#5c7ba8"
          strokeWidth="1.5"
          strokeDasharray="4 5"
        />

        <polyline points={elongArc} fill="none" stroke="#e8c15e" strokeWidth="2" opacity="0.85" />
        <polyline points={thetaArc} fill="none" stroke="#f2ecd9" strokeWidth="2" opacity={isOnRainbow ? 1 : 0.6} />

        <circle cx={sun.x} cy={sun.y} r="16" fill="#f0a94e" />
        <text x={sun.x} y={sun.y + 34} textAnchor="middle" className="geo-label">
          Sun
        </text>

        <circle cx={earth.x} cy={earth.y} r="10" fill="#6c93b8" />
        <text x={earth.x} y={earth.y + 28} textAnchor="middle" className="geo-label">
          You, on Earth
        </text>

        <circle
          cx={moon.x}
          cy={moon.y}
          r="7"
          fill={k < 0.5 ? COLORS.moonDark : COLORS.moonBright}
          stroke="#f4f1ea"
          strokeWidth="1"
        />
        <text x={moon.x} y={moon.y - 14} textAnchor="middle" className="geo-label">
          Moon
        </text>

        <text x={earth.x + orbitR + 76} y={earth.y - 6} textAnchor="end" className="geo-label subtle">
          antisolar direction
        </text>
        <text x={(sun.x + earth.x) / 2} y={sun.y - 14} textAnchor="middle" className="geo-label subtle">
          sunlight
        </text>
      </svg>
      <div className="geo-foot">
        <p className="geo-readout">{readout}</p>
        <p className="geo-caption">
          This panel depends only on ρ. Sliding around the bow changes φ — the control below — but every value
          of φ gives a congruent Sun–you–Moon angle, so nothing here moves. That is the whole discovery.
        </p>
      </div>
    </figure>
  );
}

/* ================================================================
   HERO
   ================================================================ */

function Hero() {
  return (
    <header className="hero">
      <p className="eyebrow">A geometry experiment about rainbows, sunlight, and lunar phases</p>
      <h1>Moon on the Rainbow</h1>
      <p className="hero-question">Can the Moon have any phase when it appears on a rainbow?</p>
    </header>
  );
}

/* ================================================================
   READING CARD — the illuminated-fraction number, ALWAYS on screen.
   Off the bow it shows the live value in a calm style; the moment the
   Moon reaches the bow it locks to a dramatic gold ≈87% and the message
   turns the learner from "find it" to "try to break it."
   ================================================================ */

function ReadingCard({ k, isOnRainbow, confirmed, sweptDeg, hasFoundOnce }) {
  const pct = Math.round(k * 100);
  const phase = phaseName(k);
  let subline;
  if (isOnRainbow) {
    if (confirmed) {
      subline = "It doesn't move. Anywhere on the bow, the Moon is ≈87% lit — that's the rule.";
    } else if (sweptDeg >= 12) {
      subline = `Keep sliding along the bow — you've swept ${Math.round(sweptDeg)}°. Is the number changing?`;
    } else {
      subline = "On the rainbow. Now slide the Moon along the bow and try to change this number.";
    }
  } else if (hasFoundOnce) {
    subline = "Off the bow it changes freely. Put the Moon back on the rainbow…";
  } else {
    subline = "This is how lit the Moon is right now. Move it onto the rainbow to see something surprising.";
  }
  return (
    <div className={`reading-card ${isOnRainbow ? "on-bow" : "off-bow"}`} role="status" aria-live="polite">
      <div className="reading-main">
        <span className="reading-pct">
          {pct}
          <span className="reading-sign">%</span>
        </span>
        <span className="reading-side">
          <span className="reading-illum">illuminated</span>
          <span className="reading-phase">{phase} Moon</span>
        </span>
      </div>
      <p className="reading-sub">{subline}</p>
    </div>
  );
}

/* ================================================================
   DISCOVERY EXPLANATION
   ================================================================ */

function DiscoveryCards({ confirmed }) {
  if (!confirmed) return null;
  return (
    <section className="discovery" aria-live="polite">
      <p className="discovery-callout">It stays the same. Why?</p>
      <h2>The Surprising Rule</h2>
      <ol className="discovery-cards">
        {DISCOVERY_CARDS.map((text, i) => (
          <li key={text} style={{ animationDelay: `${i * 90}ms` }}>
            <span className="card-index">{String(i + 1).padStart(2, "0")}</span>
            <p>{text}</p>
          </li>
        ))}
      </ol>
      <p className="discovery-conclude">The photograph may be rare. The geometry is not a coincidence.</p>
    </section>
  );
}

/* ================================================================
   TEACHER MODE
   ================================================================ */

function TeacherPanel({ open, onClose, rhoDeg, elongation, k }) {
  if (!open) return null;
  return (
    <div className="teacher-panel" role="dialog" aria-label="Teacher mode">
      <div className="teacher-head">
        <h2>
          <IconCap size={18} /> Teacher Mode
        </h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close teacher mode">
          <IconX size={18} />
        </button>
      </div>

      <div className="teacher-grid">
        <div>
          <h3>Current values</h3>
          <ul className="kv">
            <li>
              <span>Angular distance from antisolar point (ρ)</span>
              <strong>{rhoDeg.toFixed(1)}°</strong>
            </li>
            <li>
              <span>Primary rainbow angular radius</span>
              <strong>{RAINBOW_RADIUS_DEG}°</strong>
            </li>
            <li>
              <span>Solar elongation (E = 180° − ρ)</span>
              <strong>{elongation.toFixed(1)}°</strong>
            </li>
            <li>
              <span>Illuminated fraction k = (1 − cos E) / 2</span>
              <strong>{(k * 100).toFixed(1)}%</strong>
            </li>
          </ul>
        </div>

        <div>
          <h3>Glossary</h3>
          <dl className="glossary">
            <dt>Antisolar point</dt>
            <dd>The point on the sky directly opposite the Sun, as seen by the observer. In the child-facing controls it is called “the point opposite the Sun.”</dd>
            <dt>ρ (rho)</dt>
            <dd>The Moon’s angular distance from the antisolar point.</dd>
            <dt>φ (phi)</dt>
            <dd>The Moon’s position around the antisolar point; 0° is straight up.</dd>
            <dt>Solar elongation (E)</dt>
            <dd>The angle between the Sun and another body (here, the Moon), measured at the observer.</dd>
            <dt>Illuminated fraction (k)</dt>
            <dd>The proportion of the Moon’s visible disk that is lit by the Sun.</dd>
          </dl>
        </div>
      </div>

      <div>
        <h3>Discussion questions</h3>
        <ol className="discussion">
          <li>Why is a full Moon not centered on the visible primary rainbow arc?</li>
          <li>What Moon phase would you predict when the Moon appears on the primary rainbow?</li>
          <li>Which parts of this simulation are simplified approximations, and what real-world effects could produce small differences?</li>
        </ol>
      </div>

      <p className="teacher-note">
        <strong>Exact vs. approximate:</strong> E = 180° − ρ is exactly true for every position angle φ, because
        the Sun and the antisolar point are antipodal on the celestial sphere. The constancy of the reading around
        the bow is therefore a geometric fact, not an approximation. The approximations in this model are only the
        fixed 42° bow radius and the idealized illumination formula k = (1 − cos E) / 2.
      </p>
      <p className="teacher-note">
        <strong>Model note:</strong> the app lets you move the Moon freely around the modeled rainbow to expose the
        geometric relationship. The real Moon’s possible sky positions are constrained by its orbit.
      </p>
      <p className="teacher-note">
        Other simplifications: the Moon’s angular size is exaggerated for visibility; phase labels (New, Crescent,
        Quarter, Gibbous, Full) intentionally omit waxing/waning, since illuminated fraction alone cannot
        distinguish the two; the bow’s angular radius is treated as a single constant 42° — in reality it runs from
        about 40.5° (violet) to 42.4° (red), which is why the bow has width; only the primary bow is modeled; the
        sky inside the bow is drawn slightly brighter than outside, which is a real optical effect; and a daytime
        Moon this close to the antisolar point together with a visible rainbow is a real but uncommon coincidence
        of geometry and weather, not a claim about how often it happens.
      </p>
    </div>
  );
}

/* ================================================================
   ROOT COMPONENT
   ================================================================ */

export default function MoonOnTheRainbow() {
  const svgRef = useRef(null);
  const [stage, setStage] = useState("exploring"); // experiment is visible immediately — no hidden gate
  // (ρ, φ) is the single source of truth for the Moon's position.
  const [rhoPhi, setRhoPhi] = useState({ rho: 72, phi: 18 });
  const [dragging, setDragging] = useState(false);
  const [hasFoundOnce, setHasFoundOnce] = useState(false);
  const [teacherMode, setTeacherMode] = useState(false);
  const [showSunHint, setShowSunHint] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [sweptDeg, setSweptDeg] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const dragModeRef = useRef("free");
  const contactStartPhiRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e) => setReducedMotion(e.matches);
    if (mq.addEventListener) mq.addEventListener("change", handler);
    else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", handler);
      else mq.removeListener(handler);
    };
  }, []);

  const { rho: rhoDeg, phi: phiDeg } = rhoPhi;
  const moonPos = useMemo(() => pointFromRhoPhi(rhoDeg, phiDeg, GEOM), [rhoDeg, phiDeg]);
  const elongation = 180 - rhoDeg;
  const k = illuminationFromElongation(elongation);

  // Exact: the banner and its numbers only appear when ρ is EXACTLY 42
  // (snap guarantees this). A looser "near" band drives the visual glow.
  const isOnRainbow = Math.abs(rhoDeg - RAINBOW_RADIUS_DEG) <= EXACT_EPS;
  const isNearRainbow = !isOnRainbow && Math.abs(rhoDeg - RAINBOW_RADIUS_DEG) <= NEAR_BOW_TOLERANCE;

  useEffect(() => {
    if (stage === "intro") return;
    if (isOnRainbow) {
      setStage("found");
      setHasFoundOnce(true);
    } else {
      setStage((prev) => (prev === "found" ? "exploring" : prev));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnRainbow]);

  // Sweep tracking for the "confirmed" gate: measures continuous angular
  // travel from the START of a single, unbroken contact with the bow.
  // Leaving the bow resets the anchor, so two disconnected touches at
  // different points cannot be summed into a fake "sweep".
  useEffect(() => {
    if (!isOnRainbow) {
      contactStartPhiRef.current = null;
      return;
    }
    if (contactStartPhiRef.current === null) {
      contactStartPhiRef.current = phiDeg;
    }
    const dist = Math.abs(phiDeg - contactStartPhiRef.current); // φ never wraps (|φ| ≤ ~71° on the bow)
    setSweptDeg((prev) => Math.max(prev, dist));
  }, [isOnRainbow, phiDeg]);

  useEffect(() => {
    if (sweptDeg >= CONFIRM_SWEEP_DEG) setConfirmed(true);
  }, [sweptDeg]);

  // Set the Moon from a requested (possibly out-of-range) ρ and φ:
  // clamp ρ to [MIN, MAX], then clamp φ to the interval valid AT that ρ.
  const setFromRequested = useCallback((requestedRho, requestedPhi) => {
    const rho = Math.min(MAX_ANGLE, Math.max(MIN_ANGLE, requestedRho));
    const maxPhi = maxPhiDeg(rho, GEOM);
    const phi = Math.max(-maxPhi, Math.min(maxPhi, requestedPhi));
    setRhoPhi({ rho, phi });
  }, []);

  const clientToSvgPoint = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return { x: GEOM.centerX, y: GEOM.centerY };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: GEOM.centerX, y: GEOM.centerY };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }, []);

  const handleMoonPointerDown = useCallback(
    (e) => {
      e.preventDefault();
      dragModeRef.current =
        Math.abs(rhoDeg - RAINBOW_RADIUS_DEG) <= RELEASE_SNAP_TOLERANCE ? "onBow" : "free";
      setDragging(true);
    },
    [rhoDeg]
  );

  useEffect(() => {
    if (!dragging) return undefined;

    function handleMove(e) {
      const raw = clientToSvgPoint(e.clientX, e.clientY);
      const req = rhoPhiFromPoint(raw.x, raw.y, GEOM);
      if (dragModeRef.current === "onBow") {
        // Magnetically locked to the bow: ρ stays exactly 42°; only φ moves.
        // Pulling well away from the bow breaks the lock (escape gesture),
        // so the Moon never gets permanently stuck on the rainbow.
        if (Math.abs(req.rhoDeg - RAINBOW_RADIUS_DEG) > DRAG_ESCAPE_TOLERANCE) {
          dragModeRef.current = "free";
          setFromRequested(req.rhoDeg, req.phiDeg);
        } else {
          const clampedPhi = Math.max(-MAX_PHI_AT_RAINBOW, Math.min(MAX_PHI_AT_RAINBOW, req.phiDeg));
          setRhoPhi({ rho: RAINBOW_RADIUS_DEG, phi: clampedPhi });
        }
      } else {
        setFromRequested(req.rhoDeg, req.phiDeg);
      }
    }

    function handleUp() {
      setDragging(false);
      setRhoPhi((prev) => {
        if (Math.abs(prev.rho - RAINBOW_RADIUS_DEG) <= RELEASE_SNAP_TOLERANCE) {
          const clampedPhi = Math.max(-MAX_PHI_AT_RAINBOW, Math.min(MAX_PHI_AT_RAINBOW, prev.phi));
          return { rho: RAINBOW_RADIUS_DEG, phi: clampedPhi };
        }
        return prev;
      });
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [dragging, clientToSvgPoint, setFromRequested]);

  const handleRhoSliderChange = useCallback(
    (e) => {
      let newRho = Number(e.target.value);
      // Gently magnetic near the bow, so the slider lands on exactly 42°.
      if (Math.abs(newRho - RAINBOW_RADIUS_DEG) <= SLIDER_SNAP_TOLERANCE) newRho = RAINBOW_RADIUS_DEG;
      setFromRequested(newRho, phiDeg);
    },
    [phiDeg, setFromRequested]
  );

  const handlePhiSliderChange = useCallback(
    (e) => {
      setFromRequested(rhoDeg, Number(e.target.value));
    },
    [rhoDeg, setFromRequested]
  );

  const handleMoonKeyDown = useCallback(
    (e) => {
      if (e.key === "Home") {
        e.preventDefault();
        setFromRequested(RAINBOW_RADIUS_DEG, phiDeg);
        return;
      }
      const step = e.shiftKey ? 5 : 1;
      let delta = 0;
      if (e.key === "ArrowUp" || e.key === "ArrowRight") delta = step;
      else if (e.key === "ArrowDown" || e.key === "ArrowLeft") delta = -step;
      else return;
      e.preventDefault();
      setFromRequested(rhoDeg + delta, phiDeg);
    },
    [rhoDeg, phiDeg, setFromRequested]
  );

  const currentMaxPhi = maxPhiDeg(rhoDeg, GEOM);
  const placeOnRainbow = useCallback(() => setFromRequested(RAINBOW_RADIUS_DEG, phiDeg), [phiDeg, setFromRequested]);

  return (
    <div className="app-root">
      <style>{CSS}</style>

      <Hero />

      <main className="stage-area">
        <ReadingCard
          k={k}
          isOnRainbow={isOnRainbow}
          confirmed={confirmed}
          sweptDeg={sweptDeg}
          hasFoundOnce={hasFoundOnce}
        />

        {!isOnRainbow && (
          <div className="snap-row">
            <button type="button" className="snap-btn" onClick={placeOnRainbow}>
              Put the Moon on the rainbow
            </button>
            <span className="snap-hint">…or drag it there yourself</span>
          </div>
        )}

        <div className="views-grid">
            <SkyView
              svgRef={svgRef}
              moonPos={moonPos}
              rhoDeg={rhoDeg}
              phiDeg={phiDeg}
              k={k}
              isOnRainbow={isOnRainbow}
              isNearRainbow={isNearRainbow}
              dragging={dragging}
              reducedMotion={reducedMotion}
              onMoonPointerDown={handleMoonPointerDown}
              onMoonKeyDown={handleMoonKeyDown}
              showSunHint={showSunHint}
            />
            <GeometryView rhoDeg={rhoDeg} elongation={elongation} k={k} isOnRainbow={isOnRainbow} />
          </div>

          <div className="controls-row">
            <div className="slider-field">
              <label className="slider-label" htmlFor="rho-slider">
                Distance from the opposite-Sun point (ρ)
              </label>
              <input
                id="rho-slider"
                type="range"
                min={MIN_ANGLE}
                max={MAX_ANGLE}
                step="0.5"
                value={rhoDeg}
                onChange={handleRhoSliderChange}
              />
            </div>
            <div className="slider-field">
              <label className="slider-label" htmlFor="phi-slider">
                Position around the rainbow (φ)
              </label>
              <input
                id="phi-slider"
                type="range"
                min={-currentMaxPhi}
                max={currentMaxPhi}
                step="0.5"
                value={Math.max(-currentMaxPhi, Math.min(currentMaxPhi, phiDeg))}
                onChange={handlePhiSliderChange}
              />
            </div>
            <button
              type="button"
              className="ghost-btn"
              aria-pressed={showSunHint}
              onClick={() => setShowSunHint((v) => !v)}
            >
              <IconSun size={14} /> Where is the Sun?
            </button>
          </div>

          <DiscoveryCards confirmed={confirmed} />
        </main>

      <button
        type="button"
        className="teacher-toggle"
        aria-pressed={teacherMode}
        onClick={() => setTeacherMode((v) => !v)}
      >
        <IconCap size={16} /> Teacher Mode
      </button>

      <TeacherPanel
        open={teacherMode}
        onClose={() => setTeacherMode(false)}
        rhoDeg={rhoDeg}
        elongation={elongation}
        k={k}
      />

      <footer className="app-footer">
        <p>
          An educational geometric model, not an ephemeris. Primary bow fixed at 42° · illumination
          k = (1 − cos E) / 2 · E = 180° − ρ exactly. Open source under the MIT license.
        </p>
      </footer>
    </div>
  );
}

/* ================================================================
   STYLES
   ================================================================ */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap');

.app-root{
  --bg-deep:#0b1a33;
  --text:#ece8dd;
  --text-dim:#aab6cc;
  --sun:#f0a94e;
  --line:rgba(244,241,234,0.18);
  font-family:'Inter',system-ui,sans-serif;
  color:var(--text);
  background:radial-gradient(circle at 50% -10%, #16305c, var(--bg-deep) 60%);
  min-height:100vh;
  padding:40px 20px 40px;
  position:relative;
}
.app-root *{box-sizing:border-box;}
.app-root button{font-family:inherit;}

.hero{max-width:720px;margin:0 auto 32px;text-align:center;}
.eyebrow{font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:var(--sun);margin:0 0 14px;}
.hero h1{font-family:'Fraunces',serif;font-size:clamp(34px,6vw,58px);font-weight:600;margin:0 0 16px;letter-spacing:-0.01em;}
.hero-question{font-size:clamp(16px,2.4vw,20px);color:var(--text-dim);margin:0 0 22px;}
.hero-invite{font-size:15px;color:var(--text-dim);margin:0 0 24px;}
.btn-start{
  font-weight:600;font-size:15px;
  background:linear-gradient(135deg,#f0a94e,#e2665c);
  color:#1a1105;border:none;border-radius:999px;padding:14px 30px;cursor:pointer;
  box-shadow:0 10px 30px rgba(240,169,78,0.25);
  transition:transform 0.2s ease;
}
.btn-start:hover{transform:translateY(-1px);}
.btn-start:focus-visible{outline:3px solid #fff;outline-offset:3px;}

.stage-area{max-width:1100px;margin:0 auto;}

/* Always-on illumination reading. Calm off the bow, dramatic gold on it. */
.reading-card{
  text-align:center;margin:0 auto 16px;max-width:560px;
  padding:16px 24px 18px;border-radius:18px;
  border:1px solid var(--line);background:rgba(255,255,255,0.04);
  transition:background 0.35s ease,border-color 0.35s ease,box-shadow 0.35s ease;
}
.reading-card.on-bow{
  background:rgba(240,169,78,0.12);border-color:rgba(240,169,78,0.55);
  box-shadow:0 0 40px rgba(240,169,78,0.18);
  animation:cardPop 0.45s cubic-bezier(.2,.8,.2,1) both;
}
@keyframes cardPop{from{transform:scale(0.96);}to{transform:scale(1);}}
.reading-main{display:flex;align-items:center;justify-content:center;gap:16px;}
.reading-pct{
  font-family:'Fraunces',serif;font-weight:600;line-height:0.95;
  font-size:clamp(48px,8vw,72px);color:var(--text);
  transition:color 0.35s ease,text-shadow 0.35s ease;
}
.reading-card.on-bow .reading-pct{color:#fff6df;text-shadow:0 0 26px rgba(255,246,223,0.45);}
.reading-sign{font-size:0.42em;margin-left:2px;color:var(--text-dim);}
.reading-card.on-bow .reading-sign{color:var(--sun);}
.reading-side{display:flex;flex-direction:column;align-items:flex-start;text-align:left;gap:3px;}
.reading-illum{font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:var(--text-dim);}
.reading-phase{font-family:'IBM Plex Mono',monospace;font-size:15px;color:var(--text);}
.reading-card.on-bow .reading-phase{color:var(--sun);}
.reading-sub{font-size:14px;color:var(--text-dim);margin:12px 0 0;min-height:20px;line-height:1.5;}

.snap-row{display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap;margin:0 0 22px;}
.snap-btn{
  font-weight:600;font-size:15px;color:#1a1105;cursor:pointer;
  background:linear-gradient(135deg,#f0a94e,#e2665c);
  border:none;border-radius:999px;padding:13px 26px;
  box-shadow:0 10px 30px rgba(240,169,78,0.25);
  transition:transform 0.18s ease;
}
.snap-btn:hover{transform:translateY(-1px);}
.snap-btn:focus-visible{outline:3px solid #fff;outline-offset:3px;}
.snap-hint{font-size:13px;color:var(--text-dim);}

.views-grid{display:grid;grid-template-columns:1fr;gap:26px;}
@media(min-width:1000px){.views-grid{grid-template-columns:3fr 2fr;align-items:start;}}

.sky-svg{width:100%;height:auto;display:block;border-radius:20px;}
.sky-label{font-family:'IBM Plex Mono',monospace;font-size:12px;fill:#f0a94e;}
.moon-group{cursor:grab;touch-action:none;}
.moon-group:active{cursor:grabbing;}
.moon-group:focus-visible{outline:2px solid #fff6df;outline-offset:6px;border-radius:50%;}
.moon-group:not(.no-transition){transition:transform 0.35s cubic-bezier(.2,.8,.2,1);}
.moon-glow{animation:pulse 1.8s ease-in-out infinite;}
@keyframes pulse{0%,100%{opacity:0.35;}50%{opacity:0.75;}}

.geo-figure{margin:0;background:#0e1f3d;border-radius:20px;padding:14px 0 16px;}
.geo-head{padding:0 20px 10px;}
.geo-title{font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin:0;color:var(--text);}
.geo-subtitle{font-size:11.5px;color:var(--text-dim);margin:3px 0 0;font-style:italic;}
.geo-svg{width:100%;height:auto;display:block;}
.geo-svg text{font-family:'IBM Plex Mono',monospace;}
.geo-label{fill:var(--text);font-size:13px;}
.geo-label.subtle{fill:var(--text-dim);font-size:11px;}
.geo-foot{padding:10px 20px 0;}
.geo-readout{font-family:'IBM Plex Mono',monospace;color:#f0a94e;font-size:12.5px;margin:0 0 8px;line-height:1.5;}
.geo-caption{font-size:12px;font-style:italic;color:var(--text-dim);margin:0;line-height:1.55;}

.controls-row{
  display:flex;align-items:flex-end;gap:20px;flex-wrap:wrap;
  max-width:680px;margin:22px auto 0;padding:14px 18px;
  background:rgba(255,255,255,0.04);border-radius:14px;
}
.slider-field{display:flex;flex-direction:column;gap:6px;flex:1 1 220px;}
.slider-label{font-size:12px;color:var(--text-dim);}
.controls-row input[type=range]{accent-color:#f0a94e;}
.ghost-btn{
  display:inline-flex;align-items:center;gap:6px;
  background:transparent;border:1px solid var(--line);color:var(--text);
  border-radius:999px;padding:8px 14px;font-size:13px;cursor:pointer;
}
.ghost-btn[aria-pressed="true"]{background:rgba(240,169,78,0.18);border-color:#f0a94e;}
.ghost-btn:focus-visible,.controls-row input:focus-visible{outline:2px solid #fff6df;outline-offset:2px;}

.discovery{max-width:720px;margin:56px auto 0;}
.discovery-callout{text-align:center;font-family:'Fraunces',serif;font-size:22px;color:#fff6df;margin:0 0 6px;}
.discovery h2{font-family:'Fraunces',serif;font-size:26px;text-align:center;margin:0 0 24px;}
.discovery-cards{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px;}
.discovery-cards li{
  display:flex;gap:14px;align-items:flex-start;
  background:rgba(255,255,255,0.04);border-radius:14px;padding:16px 18px;
  animation:cardIn 0.5s ease both;
}
@keyframes cardIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}
.card-index{font-family:'IBM Plex Mono',monospace;color:#f0a94e;font-size:13px;flex:0 0 auto;}
.discovery-cards p{margin:0;font-size:15px;line-height:1.5;color:var(--text);}
.discovery-conclude{text-align:center;font-family:'Fraunces',serif;font-style:italic;font-size:18px;margin:26px 0 0;color:var(--sun);}

.teacher-toggle{
  position:fixed;right:18px;bottom:18px;z-index:20;
  display:inline-flex;align-items:center;gap:6px;
  background:rgba(11,26,51,0.9);border:1px solid var(--line);color:var(--text);
  border-radius:999px;padding:10px 16px;font-size:13px;cursor:pointer;backdrop-filter:blur(6px);
}
.teacher-toggle:focus-visible{outline:2px solid #fff6df;outline-offset:2px;}

.teacher-panel{
  position:fixed;right:18px;bottom:70px;z-index:20;width:min(520px,calc(100vw - 36px));
  max-height:70vh;overflow-y:auto;
  background:#0f2140;border:1px solid var(--line);border-radius:18px;
  padding:20px 22px;box-shadow:0 20px 60px rgba(0,0,0,0.45);
}
.teacher-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}
.teacher-head h2{font-size:16px;display:flex;align-items:center;gap:8px;margin:0;}
.icon-btn{background:transparent;border:none;color:var(--text-dim);cursor:pointer;padding:4px;}
.teacher-grid{display:grid;grid-template-columns:1fr;gap:18px;}
@media(min-width:640px){.teacher-grid{grid-template-columns:1fr 1fr;}}
.teacher-panel h3{font-size:13px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-dim);margin:0 0 8px;}
.kv{list-style:none;margin:0 0 12px;padding:0;display:flex;flex-direction:column;gap:6px;font-size:13px;}
.kv li{display:flex;justify-content:space-between;gap:10px;}
.kv strong{font-family:'IBM Plex Mono',monospace;color:#f0a94e;}
.glossary{margin:0;font-size:13px;}
.glossary dt{color:#f0a94e;font-weight:600;margin-top:8px;}
.glossary dd{margin:2px 0 0;color:var(--text-dim);}
.discussion{margin:0;padding-left:18px;font-size:13px;color:var(--text-dim);display:flex;flex-direction:column;gap:6px;}
.teacher-note{font-size:12px;color:var(--text-dim);margin:16px 0 0;line-height:1.5;}

.app-footer{max-width:720px;margin:64px auto 0;padding:0 0 80px;text-align:center;}
.app-footer p{font-size:12px;color:var(--text-dim);line-height:1.6;margin:0;}

@media (prefers-reduced-motion: reduce){
  .moon-group,.moon-glow,.discovery-cards li,.snap-btn,.reading-card{animation:none !important;transition:none !important;}
}
`;
