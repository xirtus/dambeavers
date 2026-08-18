/**
 * Minimal OSC 1.1 binary encoder — pure ESM, zero dependencies, no node
 * imports (unit-tested from vitest; usable in any runtime). Supports the
 * exact type set the Damn Beavers score emits: int32, float32, string.
 *   encodeMessage("/beavers/note", ["pluck", 64, 0.5]) -> Uint8Array
 */

function pad4(length) {
  return (4 - (length % 4)) % 4;
}

function writePaddedString(parts, str) {
  const bytes = new TextEncoder().encode(str);
  parts.push(bytes);
  const padding = pad4(bytes.length + 1) + 1; // OSC strings are null-terminated, then 4-aligned
  parts.push(new Uint8Array(padding));
}

/** Encode one OSC message. args: numbers (int if integral and |v|<2^31, else float32) and strings. */
export function encodeMessage(address, args = []) {
  if (typeof address !== "string" || !address.startsWith("/")) {
    throw new RangeError(`OSC address must start with "/", got ${JSON.stringify(address)}`);
  }
  const parts = [];
  writePaddedString(parts, address);
  let typetags = ",";
  const argParts = [];
  for (const arg of args) {
    if (typeof arg === "string") {
      typetags += "s";
      writePaddedString(argParts, arg);
    } else if (typeof arg === "number" && Number.isInteger(arg) && Math.abs(arg) < 2 ** 31) {
      typetags += "i";
      const buf = new DataView(new ArrayBuffer(4));
      buf.setInt32(0, arg, false);
      argParts.push(new Uint8Array(buf.buffer));
    } else if (typeof arg === "number" && Number.isFinite(arg)) {
      typetags += "f";
      const buf = new DataView(new ArrayBuffer(4));
      buf.setFloat32(0, arg, false);
      argParts.push(new Uint8Array(buf.buffer));
    } else {
      throw new RangeError(`unsupported OSC argument: ${JSON.stringify(arg)}`);
    }
  }
  writePaddedString(parts, typetags);
  parts.push(...argParts);
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
