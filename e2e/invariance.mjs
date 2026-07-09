/**
 * e2e/invariance.mjs — real-browser acceptance test.
 *
 * Serves the built app, then drives an actual pointer:
 *   1. Start the experiment.
 *   2. Drag the Moon onto the rainbow → banner shows ≈87% / Gibbous.
 *   3. Sweep it around the bow in one continuous drag (>60°) → invariance
 *      confirmed, "The Surprising Rule" cards appear.
 *   4. At several φ stops (drag AND φ-slider extremes), open Teacher Mode
 *      and assert ρ = 42.0°, E = 138.0°, k = 87.2% — exactly.
 *   5. ρ-slider extremes: Moon stays inside the sky canvas.
 *   6. No console errors anywhere.
 *
 * Prereqs: npm run build; npm i -D playwright (browsers preinstalled or
 * PLAYWRIGHT_BROWSERS_PATH set). Run: node e2e/invariance.mjs
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const SHOTS = fileURLToPath(new URL("./screenshots", import.meta.url));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

const server = createServer(async (req, res) => {
  const path = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  try {
    const body = await readFile(join(DIST, path));
    res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((r) => server.listen(4173, r));
await mkdir(SHOTS, { recursive: true });

let failures = 0;
function check(cond, label) {
  if (cond) console.log(`  ok  ${label}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

// PLAYWRIGHT_CHROMIUM_PATH lets CI/sandboxes point at a preinstalled build.
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}
);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
page.on("console", (m) => {
  // Ignore network-resource noise (e.g., a font CDN blocked by a sandbox
  // proxy) — only real page/script errors should fail the run.
  if (m.type() === "error" && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

await page.goto("http://localhost:4173/");
await page.getByRole("button", { name: "Start the experiment" }).click();
await page.screenshot({ path: join(SHOTS, "1-exploring.png") });

// Map SVG user coordinates -> page client coordinates.
async function svgToClient(x, y) {
  return page.evaluate(
    ([sx, sy]) => {
      const svg = document.querySelector(".sky-svg");
      const pt = svg.createSVGPoint();
      pt.x = sx;
      pt.y = sy;
      const p = pt.matrixTransform(svg.getScreenCTM());
      return { x: p.x, y: p.y };
    },
    [x, y]
  );
}

const CENTER = { x: 400, y: 430 };
const PX_PER_DEG = 4;
function skyPoint(rhoDeg, phiDeg) {
  const r = rhoDeg * PX_PER_DEG;
  const rad = (phiDeg * Math.PI) / 180;
  return { x: CENTER.x + r * Math.sin(rad), y: CENTER.y - r * Math.cos(rad) };
}

async function teacherValues() {
  const open = await page.locator(".teacher-panel").count();
  if (!open) await page.getByRole("button", { name: /Teacher Mode/ }).click();
  const vals = await page.locator(".kv strong").allTextContents();
  return vals; // [rho, bowRadius, E, k]
}

async function dragMoon(toRho, toPhi, steps = 12) {
  const from = await page.locator(".moon-group").boundingBox();
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const target = await svgToClient(...Object.values(skyPoint(toRho, toPhi)));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(
      start.x + ((target.x - start.x) * i) / steps,
      start.y + ((target.y - start.y) * i) / steps
    );
  }
  await page.mouse.up();
}

console.log("e2e: Moon on the Rainbow — live invariance test");

/* 2 — drag onto the bow (approach slightly off 42° so release-snap does the landing) */
await dragMoon(43.5, -20);
await page.waitForTimeout(450);
let banner = await page.locator(".banner-value").textContent();
check(banner.includes("87%"), `banner shows 87% after landing on the bow (got "${banner.trim()}")`);
let phase = await page.locator(".banner-phase").textContent();
check(phase.trim() === "Gibbous Moon", `banner phase is "Gibbous Moon" (got "${phase.trim()}")`);
await page.screenshot({ path: join(SHOTS, "2-found.png") });

let [rho, , E, k] = await teacherValues();
check(rho === "42.0°", `Teacher ρ = 42.0° exactly (got ${rho})`);
check(E === "138.0°", `Teacher E = 138.0° exactly (got ${E})`);
check(k === "87.2%", `Teacher k = 87.2% exactly (got ${k})`);
await page.screenshot({ path: join(SHOTS, "3-teacher.png") });
await page.getByRole("button", { name: "Close teacher mode" }).click();

/* 3 — one continuous sweep around the bow: -20° -> +55° (75° of travel) */
{
  const from = await page.locator(".moon-group").boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let phi = -20; phi <= 55; phi += 3) {
    const t = await svgToClient(...Object.values(skyPoint(42, phi)));
    await page.mouse.move(t.x, t.y);
  }
  await page.mouse.up();
}
await page.waitForTimeout(600);
check((await page.locator(".discovery h2").count()) === 1, "invariance confirmed after >60° sweep — explanation revealed");
const rule = await page.locator(".discovery h2").textContent();
check(rule.trim() === "The Surprising Rule", `explanation heading (got "${rule?.trim()}")`);
await page.screenshot({ path: join(SHOTS, "4-confirmed.png"), fullPage: true });

/* 4 — invariance at drag stops AND φ-slider extremes */
for (const phi of [-60, 0, 55]) {
  await dragMoon(42, phi, 8);
  await page.waitForTimeout(200);
  const [r2, , e2, k2] = await teacherValues();
  check(
    r2 === "42.0°" && e2 === "138.0°" && k2 === "87.2%",
    `at φ=${phi}°: ρ=${r2}, E=${e2}, k=${k2} (all exact)`
  );
  await page.getByRole("button", { name: "Close teacher mode" }).click();
}

for (const dir of ["min", "max"]) {
  await page.$eval(
    "#phi-slider",
    (el, d) => {
      const v = d === "min" ? el.min : el.max;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    dir
  );
  await page.waitForTimeout(150);
  const [r3, , e3, k3] = await teacherValues();
  check(
    r3 === "42.0°" && e3 === "138.0°" && k3 === "87.2%",
    `φ-slider at ${dir}: ρ=${r3}, E=${e3}, k=${k3} — ρ preserved exactly at slider extreme`
  );
  await page.getByRole("button", { name: "Close teacher mode" }).click();
}

/* 5 — ρ-slider extremes keep the Moon inside the sky canvas */
for (const dir of ["min", "max"]) {
  await page.$eval(
    "#rho-slider",
    (el, d) => {
      const v = d === "min" ? el.min : el.max;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    dir
  );
  await page.waitForTimeout(400);
  const moon = await page.locator(".moon-group").boundingBox();
  const sky = await page.locator(".sky-svg").boundingBox();
  const inside =
    moon.x >= sky.x - 2 &&
    moon.y >= sky.y - 2 &&
    moon.x + moon.width <= sky.x + sky.width + 2 &&
    moon.y + moon.height <= sky.y + sky.height + 2;
  check(inside, `Moon fully on-canvas at ρ-slider ${dir} (regression: off-canvas at high ρ)`);
}

/* 6 — console cleanliness */
check(consoleErrors.length === 0, `no console errors (got ${consoleErrors.length}: ${consoleErrors.slice(0, 3).join(" | ")})`);

await browser.close();
server.close();

if (failures) {
  console.error(`\n${failures} e2e check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll e2e checks passed.");
