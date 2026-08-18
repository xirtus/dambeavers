/**
 * R1-14 / Law R8 proof: a deterministic scene captured, saved through the
 * real persistence path, reloaded, and recaptured must be PIXEL-IDENTICAL
 * -- the 3D world reconstructs solely from restored simulation state, with
 * zero hidden renderer state.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import puppeteer from "puppeteer";

const DIST = "/Users/xmacbookm5/Projects/j3games/dambeavers/dist";
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

try {
  const page = await browser.newPage();
  page.on("pageerror", e => console.log("[pageerror]", e.message));
  await page.goto("http://localhost:4879/?deterministic=1", { waitUntil: "networkidle0" });
  await page.waitForFunction(() => window.__app?.ready === true, { timeout: 60000 });

  // Drive a real scenario: logging + a dam + ticks (the world mid-story).
  await page.evaluate(() => {
    window.__app.designateNearestTrees(6);
    window.__app.advanceTicks(1300);
    window.__app.buildDamRow();
    window.__app.advanceTicks(300);
  });
  await page.evaluate(() => window.__app.setCameraAbsolute(17, 6.5, 30, 15, 0.35, 0.3));
  const settle = () => new Promise(res => { let n = 0; const s = () => (++n >= 20 ? res() : requestAnimationFrame(s)); requestAnimationFrame(s); });
  await page.evaluate(settle);
  const shotA = await page.screenshot({ encoding: "binary" });

  // Save through the real path, mutate the world further, then LOAD back.
  const snapshot = await page.evaluate(() => JSON.stringify(window.__app.bridge.saveSnapshot()));
  await page.evaluate(() => window.__app.advanceTicks(400)); // world moves on (different state)
  await page.evaluate((snap) => window.__app.bridge.loadSnapshot(JSON.parse(snap)), snapshot);
  await page.evaluate(() => window.__app.setCameraAbsolute(17, 6.5, 30, 15, 0.35, 0.3));
  await page.evaluate(settle);
  const shotB = await page.screenshot({ encoding: "binary" });

  const identical = Buffer.compare(Buffer.from(shotA), Buffer.from(shotB)) === 0;
  console.log("save/load pixel-identical:", identical);
  if (!identical) {
    const fs = await import("node:fs");
    fs.writeFileSync("/Users/xmacbookm5/Projects/j3games/dambeavers/docs/webpage/shots/saveload-A.png", Buffer.from(shotA));
    fs.writeFileSync("/Users/xmacbookm5/Projects/j3games/dambeavers/docs/webpage/shots/saveload-B.png", Buffer.from(shotB));
    console.log("DIFFERENT -- wrote saveload-A/B.png for inspection");
    process.exit(1);
  }
} finally {
  await browser.close();
  server.close();
}
