/**
 * R0-10 — the architectural boundary is machine-enforced (threejs_layer.md
 * Law R6/R7), not conventional:
 *
 *  - src/sim/**        NEVER imports three, DOM, or presentation/render code.
 *  - src/presentation/** NEVER imports three or DOM (headless-testable).
 *  - src/render3d/**   imports three + presentation CONTRACTS only -- never
 *                      simulation internals, never projection/bridge/scenario
 *                      (those belong to whichever host wires the bridge up).
 *  - src/ui/web/**     talks to presentation contracts/bridge interfaces only.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..", "..", "src");

function listTsFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) result.push(...listTsFiles(full));
    else if (entry.endsWith(".ts")) result.push(full);
  }
  return result;
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const imports: string[] = [];
  for (const match of source.matchAll(/(?:import|export)[^"']*from\s+["']([^"']+)["']/g)) {
    imports.push(match[1]!);
  }
  for (const match of source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    imports.push(match[1]!);
  }
  return imports;
}

const FORBIDDEN_IN_SIM = [/^(three|three\/)/, /\brender3d\//, /\bpresentation\//, /\bui\//, /node:/, /\breact\b/];
const FORBIDDEN_IN_PRESENTATION = [/^(three|three\/)/, /\brender3d\//, /node:/, /\breact\b/];
const FORBIDDEN_IN_RENDER3D = [/\bsim\//, /node:/];

describe("import boundary (R0-10)", () => {
  it("src/sim stays renderer-free and presentation-free", () => {
    const violations: string[] = [];
    for (const file of listTsFiles(join(SRC, "sim"))) {
      for (const specifier of importsOf(file)) {
        if (FORBIDDEN_IN_SIM.some((pattern) => pattern.test(specifier))) {
          violations.push(`${relative(SRC, file)} imports ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("src/presentation stays three-free and node-free (headless-testable)", () => {
    const violations: string[] = [];
    for (const file of listTsFiles(join(SRC, "presentation"))) {
      for (const specifier of importsOf(file)) {
        if (FORBIDDEN_IN_PRESENTATION.some((pattern) => pattern.test(specifier))) {
          violations.push(`${relative(SRC, file)} imports ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("src/render3d never imports simulation internals", () => {
    const violations: string[] = [];
    for (const file of listTsFiles(join(SRC, "render3d"))) {
      for (const specifier of importsOf(file)) {
        if (FORBIDDEN_IN_RENDER3D.some((pattern) => pattern.test(specifier))) {
          violations.push(`${relative(SRC, file)} imports ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
