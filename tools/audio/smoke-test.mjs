/**
 * §26 live smoke test: boots the REAL built game in headless Chrome with
 * the score auto-started and the OSC backend enabled, drives real
 * commands (cut trees, build a dam row), and asserts:
 *   1. the conductor emits gestures from observed world state,
 *   2. the OSC bridge forwards real packets (its status counter rises),
 *   3. the page stays error-free.
 * Usage: node tools/audio/smoke-test.mjs   (expects dist/ built)
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer";

const ROOT = new URL("../../", import.meta.url).pathname;
const DIST = join(ROOT, "dist");
const GAME_PORT = 4881;
const BRIDGE_PORT = 8788;
const OSC_PORT = 57199;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".map": "application/json", ".css": "text/css" };

function serveGame() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${GAME_PORT}`);
    let path = join(DIST, url.pathname === "/" ? "index.html" : url.pathname);
    if (!existsSync(path)) path = join(DIST, "index.html");
    try {
      const data = await readFile(path);
      res.writeHead(200, { "Content-Type": MIME[extname(path)] ?? "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((resolve) => server.listen(GAME_PORT, () => resolve(server)));
}

async function bridgePackets() {
  const res = await fetch(`http://localhost:${BRIDGE_PORT}/`);
  const status = await res.json();
  return status.packetsSent;
}

const gameServer = await serveGame();
const bridge = spawn("node", [join(ROOT, "tools/audio/osc-bridge.mjs"), "--port", String(BRIDGE_PORT), "--osc-port", String(OSC_PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 700));

const browser = await puppeteer.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio", "--enable-unsafe-webgpu"],
});

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`http://localhost:${GAME_PORT}/?audio=1&osc=ws://localhost:${BRIDGE_PORT}`, { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForFunction(() => window.__app?.ready === true, { timeout: 20000 });

  // Enable the OSC backend (the ?audio=1 flag already started the pump + synth).
  await page.evaluate(() => window.__app.audio.setBackendEnabled("osc", true));
  await new Promise((r) => setTimeout(r, 600));

  // Drive REAL world change: resume the world (it starts paused, like a player pressing Play), fell three trees, place a dam row, let it run.
  await page.evaluate(() => {
    window.__app.bridge.submitCommand({ type: "resume" });
    window.__app.designateNearestTrees(3);
    window.__app.advanceTicks(400);
    window.__app.buildDamRow();
    window.__app.advanceTicks(1200);
  });
  await new Promise((r) => setTimeout(r, 4000)); // wall-clock: the pump composes in real time

  const state = await page.evaluate(() => window.__app.audio.getDebugState());
  const packets = await bridgePackets();

  check("page boots with the score", errors.length === 0, errors.join(" | "));
  check("conductor emits gestures", state.emittedGestures > 40, `${state.emittedGestures} gestures`);
  check("world music identity present", typeof state.conductor?.root === "number" && typeof state.conductor?.family === "string", `${state.conductor?.family} root ${state.conductor?.root}`);
  check("beat clock advanced", state.conductor?.beat > 1, `beat ${state.conductor?.beat}`);
  check("OSC bridge forwarded packets", packets > 30, `${packets} packets`);

  const audioContextState = await page.evaluate(() => {
    // reach the synth's context through a fresh probe gesture is overkill; read it via the debug handle if exposed
    return window.__app.audio.backendsState ?? "n/a";
  });
  console.log("  (backend state probe:", audioContextState + ")");
} finally {
  await browser.close();
  bridge.kill();
  gameServer.close();
}
process.exit(failures === 0 ? 0 : 1);
