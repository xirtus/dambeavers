/** Live-mode smoke: the RAF loop advances the real clock in real time. */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import puppeteer from "puppeteer";
const ROOT = new URL("../../", import.meta.url).pathname;
const DIST = join(ROOT, "dist");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".map": "application/json" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  let path = join(DIST, url.pathname === "/" ? "index.html" : url.pathname);
  if (!existsSync(path)) path = join(DIST, "index.html");
  try { res.writeHead(200, { "Content-Type": MIME[extname(path)] ?? "application/octet-stream" }); res.end(await readFile(path)); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(4879, r));
const browser = await puppeteer.launch({ headless: true, args: ["--headless=new","--use-angle=swiftshader","--enable-unsafe-swiftshader","--no-sandbox"], defaultViewport: { width: 1280, height: 720 } });
const page = await browser.newPage();
page.on("pageerror", e => console.log("[pageerror]", e.message));
await page.goto("http://localhost:4879/", { waitUntil: "networkidle0" });
await page.waitForFunction(() => window.__app?.ready === true, { timeout: 60000 });
await page.evaluate(() => { window.__app.bridge.submitCommand({ type: "resume" }); window.__app.bridge.submitCommand({ type: "set-speed", speed: 4 }); });
const t0 = await page.evaluate(() => window.__app.bridge.getFrame().tick);
await new Promise(r => setTimeout(r, 4000));
const t1 = await page.evaluate(() => window.__app.bridge.getFrame().tick);
const backend = await page.evaluate(() => window.__app.app.stats.backend);
console.log("live mode: tick", t0, "->", t1, "over ~4s; backend:", backend);
await page.screenshot({ path: join(ROOT, "docs/webpage/shots/live-smoke.png") });
await browser.close(); server.close();
if (t1 <= t0) { console.log("FAIL: clock did not advance in live mode"); process.exit(1); }
console.log("LIVE SMOKE PASS");
