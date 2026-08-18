/**
 * Deterministic visual capture harness (Law R11). Serves the built app,
 * drives REAL scenario steps through window.__app (the same commands a
 * player would issue), and screenshots fixed camera poses into
 * docs/webpage/shots/. Every capture is reproducible: same seed, same
 * ticks, same camera, same pinned visual time.
 *
 * Usage: node tools/visual/capture.mjs [suiteName...]
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
import puppeteer from "puppeteer";

const ROOT = new URL("../../", import.meta.url).pathname;
const DIST = join(ROOT, "dist");
const SHOTS = join(ROOT, "docs/webpage/shots");
const PORT = 4879;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".map": "application/json", ".css": "text/css", ".png": "image/png", ".json": "application/json" };

function serve() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
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
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

/** Capture suites: each step drives REAL sim state via the app's own command path. */
const SUITES = {
  "pond-start": {
    camera: "overview",
    setup: async (page) => {
      await page.evaluate(() => window.__app.advanceTicks(1320)); // late morning light
    },
  },
  "stream-close": {
    camera: "low-stream",
    setup: async (page) => {
      await page.evaluate(() => window.__app.advanceTicks(1320));
    },
  },
  "beaver-close": {
    camera: "beaver-close",
    setup: async (page) => {
      await page.evaluate(() => window.__app.advanceTicks(1320));
    },
  },
  "logging": {
    camera: "pond",
    setup: async (page) => {
      await page.evaluate(() => {
        window.__app.designateNearestTrees(5);
        window.__app.advanceTicks(1320);
      });
    },
  },
  "dam-early": {
    camera: "dam-wall",
    setup: async (page) => {
      await page.evaluate(() => {
        window.__app.designateNearestTrees(8);
        window.__app.advanceTicks(1300);
        window.__app.buildDamRow();
        window.__app.advanceTicks(450); // day 1, 17:00 -- golden hour, mid-build
      });
    },
  },
  "dam-risen": {
    camera: "dam-wall",
    setup: async (page) => {
      await page.evaluate(() => {
        window.__app.designateNearestTrees(10);
        window.__app.advanceTicks(1300);
        window.__app.buildDamRow(); // level 1
        window.__app.advanceTicks(700);
        window.__app.buildDamRow(); // level 2 (sites free after application)
        window.__app.advanceTicks(700);
        window.__app.buildDamRow(); // level 3
        window.__app.advanceTicks(3000);
        window.__app.buildDamRow(); // catch any stragglers
        window.__app.advanceTicks(2320); // day 4, 17:05 golden hour -- pond risen
      });
    },
  },
  night: {
    camera: "overview",
    setup: async (page) => {
      await page.evaluate(() => window.__app.advanceTicks(120)); // 01:12, moonlit
    },
  },
};

async function main() {
  const requested = process.argv.slice(2);
  const names = requested.length > 0 ? requested : Object.keys(SUITES);
  mkdirSync(SHOTS, { recursive: true });
  const server = await serve();

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--headless=new",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--disable-gpu-sandbox",
      "--no-sandbox",
      "--window-size=1600,900",
    ],
    defaultViewport: { width: 1600, height: 900 },
  });

  try {
    for (const name of names) {
      const suite = SUITES[name];
      if (!suite) {
        console.error(`unknown suite: ${name}`);
        continue;
      }
      const page = await browser.newPage();
      page.on("pageerror", (err) => console.error(`[pageerror] ${err.message}`));
      page.on("console", (msg) => {
        if (msg.type() === "error" || msg.type() === "warning") console.error(`[console.${msg.type()}] ${msg.text()}`);
      });
      await page.goto(`http://localhost:${PORT}/?deterministic=1&seed=m0-pond-test`, { waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.__app?.ready === true, { timeout: 60000 });
      await suite.setup(page);
      await page.evaluate((camera) => window.__app.setCamera(camera), suite.camera);
      // Let a few frames render so reconciliation/vis settle deterministically.
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            let frames = 0;
            const step = () => (++frames >= 5 ? resolve() : requestAnimationFrame(step));
            requestAnimationFrame(step);
          }),
      );
      const file = join(SHOTS, `${name}.png`);
      await page.screenshot({ path: file });
      const stats = await page.evaluate(() => window.__app.app.stats);
      console.log(`captured ${name}.png  tick=${stats.tick} beavers=${stats.liveBeavers} trees=${stats.liveTrees} dc=${stats.drawCalls} tris=${stats.triangles}`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
