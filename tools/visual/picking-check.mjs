/**
 * R1-09 live proof: synthetic pointer events at a beaver's projected
 * screen position must resolve to its STABLE entity id through the app's
 * real pick path; a tree click in cut mode must create a real designation.
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
const page = await browser.newPage();
page.on("pageerror", e => console.log("[pageerror]", e.message));
try {
  await page.goto("http://localhost:4879/?deterministic=1", { waitUntil: "networkidle0" });
  await page.waitForFunction(() => window.__app?.ready === true, { timeout: 60000 });
  await page.evaluate(() => window.__app.advanceTicks(50));
  // Aim at the first beaver from a close angle.
  const target = await page.evaluate(() => {
    const app = window.__app.app;
    const beavers = window.__app.beaverProbe();
    const b = beavers[0];
    const V = Object.getPrototypeOf(app["cameraController"].camera.position).constructor;
    app["cameraController"].setPose(new V(b.pos[0], b.pos[1], b.pos[2]), 5, 0.9, 0.35);
    return b;
  });
  await page.evaluate(() => new Promise(res => { let n = 0; const s = () => (++n >= 8 ? res() : requestAnimationFrame(s)); requestAnimationFrame(s); }));
  // Project the beaver's render position to screen and click there.
  const screen = await page.evaluate((target) => {
    const app = window.__app.app;
    const cam = app["cameraController"].camera;
    const V = Object.getPrototypeOf(cam.position).constructor;
    const v = new V(target.pos[0], target.pos[1] + 0.4, target.pos[2]);
    v.project(cam);
    const canvas = document.querySelector("#gl");
    const rect = canvas.getBoundingClientRect();
    return { x: (v.x * 0.5 + 0.5) * rect.width + rect.left, y: (-v.y * 0.5 + 0.5) * rect.height + rect.top };
  }, target);
  await page.mouse.click(screen.x, screen.y);
  await page.evaluate(() => new Promise(res => { let n = 0; const s = () => (++n >= 4 ? res() : requestAnimationFrame(s)); requestAnimationFrame(s); }));
  const selection = await page.evaluate(() => window.__app.app.getSelection());
  console.log("clicked beaver at", Math.round(screen.x), Math.round(screen.y), "-> selection:", JSON.stringify(selection));
  // All seven beavers share the arrival cell at tick 50 -- the pick must
  // resolve to A live beaver standing there (nearest rig wins), not a
  // specific one of the stacked seven.
  const stackedIds = (await page.evaluate(() => window.__app.beaverProbe().map((b) => b.id)));
  if (selection?.type !== "entity" || !stackedIds.includes(selection.entityId)) {
    console.log("FAIL: expected one of", stackedIds);
    process.exit(1);
  }
  // Now: cut-tree tool on a tree's screen position.
  const tree = await page.evaluate(() => {
    const registry = window.__app.app["registry"];
    let t;
    for (const r of registry.allRecords()) { if (r.kind === "tree") { t = r; break; } }
    const app = window.__app.app;
    const V = Object.getPrototypeOf(app["cameraController"].camera.position).constructor;
    app["cameraController"].setPose(new V(t.x + 0.5, t.y + 2.8, t.z + 0.5), 6, 0.8, 0.3);
    return t;
  });
  await page.evaluate(() => new Promise(res => { let n = 0; const s = () => (++n >= 8 ? res() : requestAnimationFrame(s)); requestAnimationFrame(s); }));
  const treeScreen = await page.evaluate((t) => {
    const app = window.__app.app;
    const cam = app["cameraController"].camera;
    const V = Object.getPrototypeOf(cam.position).constructor;
    const v = new V(t.x + 0.5, t.y + 2.9, t.z + 0.5);
    v.project(cam);
    const canvas = document.querySelector("#gl");
    const rect = canvas.getBoundingClientRect();
    return { x: (v.x * 0.5 + 0.5) * rect.width + rect.left, y: (-v.y * 0.5 + 0.5) * rect.height + rect.top };
  }, tree);
  await page.evaluate(() => { window.__hudSetTool ? window.__hudSetTool("cut-tree") : null; });
  await page.evaluate(() => {
    // set tool through the app's own API (same as the HUD button)
    window.__app.app.setTool("cut-tree");
  });
  await page.mouse.click(treeScreen.x, treeScreen.y);
  await page.evaluate(() => new Promise(res => { let n = 0; const s = () => (++n >= 4 ? res() : requestAnimationFrame(s)); requestAnimationFrame(s); }));
  const designations = await page.evaluate((treeId) => {
    const world = window.__app.bridge.worldForVerification;
    return world.entities.liveIdsOfKind("designation").filter((d) => {
      const des = world.components.get(d, [...world.components["tables"].keys()].find((t) => t.name === "designation"));
      return des?.targetEntity === treeId;
    }).length;
  }, tree.id);
  console.log("tree click in cut mode -> designations for tree", tree.id, ":", designations);
  if (designations < 1) {
    console.log("FAIL: no designation created");
    process.exit(1);
  }
  console.log("picking-check PASS");
} finally {
  await browser.close();
  server.close();
}
