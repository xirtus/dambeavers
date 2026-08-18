/**
 * Structural acceptance for the Phase 10 parity matrix itself -- the
 * audit's integrity contract: exactly the 300 checklist rows, each with
 * a valid verdict and a WRITTEN rationale, evidence naming real files,
 * every domain covered, and no unexplained row (the gate's own
 * "no unexplained red rows").
 */
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PARITY_MATRIX, PARITY_DOMAINS, parityRowsByDomain, unexplainedParityRows } from "../../src/sim/parity/ParityMatrix.js";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

describe("Phase 10 parity matrix integrity", () => {
  it("contains exactly the 300 checklist rows with unique ids 1..300", () => {
    expect(PARITY_MATRIX.length).toBe(300);
    const ids = PARITY_MATRIX.map((row) => row.id);
    expect(new Set(ids).size).toBe(300);
    for (let id = 1; id <= 300; id++) expect(ids).toContain(id);
  });

  it("every row carries a valid verdict and a written rationale", () => {
    const validVerdicts = new Set(["PASS", "ADAPTED", "EXCEEDED", "OUT_OF_SCOPE"]);
    for (const row of PARITY_MATRIX) {
      expect(validVerdicts.has(row.verdict), `row ${row.id}`).toBe(true);
      expect(row.rationale.trim().length, `row ${row.id} rationale`).toBeGreaterThan(0);
      expect(row.title.trim().length, `row ${row.id} title`).toBeGreaterThan(0);
    }
  });

  it("OUT_OF_SCOPE rows carry a written scope reason; every other verdict cites real evidence files", () => {
    for (const row of PARITY_MATRIX) {
      if (row.verdict === "OUT_OF_SCOPE") {
        expect((row.scopeReason ?? "").trim().length, `row ${row.id} scopeReason`).toBeGreaterThan(0);
        // P10 critic fix: a bare "not modeled" is a red row wearing an
        // OUT_OF_SCOPE label -- every scope reason must name an honest
        // deferral (a later phase, a presentation layer, optional
        // content, or the fiction's own scope).
        const reason = (row.scopeReason ?? "").toLowerCase();
        const honest = ["phase 11", "p11-", "presentation", "optional", "content", "fiction", "deferred"];
        expect(honest.some((token) => reason.includes(token)), `row ${row.id} scopeReason must name an honest deferral: ${row.scopeReason}`).toBe(true);
      } else {
        expect(row.evidence.length, `row ${row.id} evidence`).toBeGreaterThan(0);
        for (const file of row.evidence) {
          expect(existsSync(resolve(REPO_ROOT, file)), `row ${row.id} evidence ${file}`).toBe(true);
        }
      }
    }
  });

  it("covers all twelve parity domains with real rows", () => {
    for (const domain of PARITY_DOMAINS) {
      const rows = parityRowsByDomain(domain);
      expect(rows.length, `domain ${domain}`).toBeGreaterThan(0);
    }
    const domainSet = new Set(PARITY_MATRIX.map((row) => row.domain));
    expect(domainSet.size).toBe(12);
  });

  it("has no unexplained red rows (the Phase 10 gate's own sentence)", () => {
    expect(unexplainedParityRows()).toEqual([]);
  });

  it("every verdict class is represented (the audit is a real judgment, not one default)", () => {
    const verdicts = new Set(PARITY_MATRIX.map((row) => row.verdict));
    for (const verdict of ["PASS", "ADAPTED", "EXCEEDED", "OUT_OF_SCOPE"]) {
      expect(verdicts.has(verdict as never), verdict).toBe(true);
    }
  });
});
