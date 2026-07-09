# Moon on the Rainbow 🌖🌈

**Can the Moon have any phase when it appears on a rainbow?**

An interactive geometry experiment. Drag the Moon around the sky and place it on the rainbow — then try to change the number. You can't. A Moon centered on the primary bow is always about **87% illuminated (gibbous)**, no matter where on the bow it sits. This app lets learners *discover* that fact before it explains it.

Built for curious kids, students, and teachers. A **Teacher Mode** panel exposes the live values (ρ, E, k), a glossary, and discussion questions.

## The science

The model rests on one exact fact and two good approximations.

**Exact.** A rainbow is centered on the *antisolar point* — the point in the sky directly opposite the Sun. Because the Sun and the antisolar point are antipodal (exactly 180° apart on the celestial sphere), any object at angular distance ρ from the antisolar point is at solar elongation

```
E = 180° − ρ        (exact, for every position angle φ around the bow)
```

This is why the reading cannot change as you slide around the bow: the invariance is a theorem of spherical geometry, not an approximation.

**Approximation 1.** The primary bow is drawn at a single angular radius of **42°**. In reality it spans about 40.5° (violet) to 42.4° (red) — that spread *is* the bow's width.

**Approximation 2.** The Moon's illuminated fraction is taken as

```
k = (1 − cos E) / 2
```

which follows from the standard phase formula k = (1 + cos i)/2 with the far-Sun approximation i ≈ 180° − E (excellent: the Sun is ~390× farther away than the Moon).

Putting it together for the primary bow:

```
ρ = 42°  →  E = 138°  →  k = (1 − cos 138°)/2 ≈ 0.872  →  ≈ 87%, gibbous
```

The photograph may be rare. The geometry is not a coincidence.

### What the model deliberately does *not* claim

- **No waxing/waning labels.** Illuminated fraction alone cannot distinguish waxing from waning; inferring it from screen position would assert an orbital fact the model doesn't track.
- **No ephemeris.** The app lets you move the Moon freely to expose the geometry; the real Moon's positions are constrained by its orbit.
- **No frequency claim.** A daytime Moon on a visible rainbow is a real but uncommon coincidence of geometry and weather.

## Running it

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (node --test, zero dependencies)
npm run build      # production build in dist/
```

## Accuracy guarantees (enforced by tests)

The math lives in [`src/moon-rainbow-math.js`](src/moon-rainbow-math.js) — pure functions, no DOM. [`tests/moon-rainbow-math.test.mjs`](tests/moon-rainbow-math.test.mjs) pins:

- the reference cases E=0 → 0%, E=90 → 50%, E=138 → 87.16%, E=180 → 100%;
- **ρ-invariance**: round-tripping (ρ=42°, φ) → pixels → (ρ, φ) preserves ρ to 1e-9 across the entire slider range — the app stores (ρ, φ) as its single source of truth, so pixel clamping can never silently change ρ;
- **on-canvas regression**: every reachable (ρ, φ) keeps the whole Moon glyph inside the sky box (an earlier draft let the Moon fly off the top of the canvas at large ρ).

An optional Playwright script ([`e2e/invariance.mjs`](e2e/invariance.mjs)) drags the real Moon in a real browser, sweeps it around the bow, and asserts ρ = 42.0°, E = 138.0°, k = 87.2% at every stop.

## Design notes

- The interface says "the point opposite the Sun" for children; Teacher Mode introduces the formal term *antisolar point*.
- The sky inside the bow is drawn slightly brighter than outside — a real optical effect.
- The Moon's bright limb always points along the great circle toward the Sun (radially outward from the antisolar point).
- Respects `prefers-reduced-motion`; the Moon is keyboard-operable (arrow keys move it, Home places it on the bow).

## Contributing

Ideas welcome: a secondary bow at 51° (→ E = 129°, k ≈ 82%), Alexander's dark band, real ephemeris mode, translations. Keep the core promise: **every number shown must be exactly what the stated model computes.**

## Credits

Created by [P. V. (Sundar) Balakrishnan](https://orcid.org/0000-0002-2856-5543) (University of Washington Bothell), developed with Claude (Anthropic). MIT licensed — use it, remix it, teach with it.
