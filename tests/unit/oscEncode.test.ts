/**
 * The OSC 1.1 wire encoder: exact byte vectors so the bridge's packets
 * are verifiably what SuperCollider/Max/Pd expect on the socket.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM module without type declarations
import { encodeMessage } from "../../tools/audio/osc-encode.mjs";

function bytes(...values: number[]): number[] {
  return values;
}

describe("encodeMessage", () => {
  it("encodes an address-only message with an empty typetag string", () => {
    const packet = encodeMessage("/a", []);
    expect([...packet]).toEqual(bytes(47, 97, 0, 0, 44, 0, 0, 0)); // "/a\0\0" ",\0\0"
  });

  it("encodes string, int32 and float32 args with 4-byte alignment", () => {
    const packet = encodeMessage("/beavers/note", ["pluck", 64, 0.5]);
    // "/beavers/note\0\0\0" (16) + ",sif\0\0\0\0" (8) + "pluck\0\0\0" (8) + int 64 (4) + float 0.5 (4)
    expect(packet.length).toBe(40);
    const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
    // address
    expect(String.fromCharCode(...packet.subarray(0, 13))).toBe("/beavers/note");
    expect(packet[13]).toBe(0);
    // typetags
    expect(String.fromCharCode(...packet.subarray(16, 20))).toBe(",sif");
    // string arg "pluck" padded to 8
    expect(String.fromCharCode(...packet.subarray(24, 29))).toBe("pluck");
    // int arg big-endian
    expect(view.getInt32(32, false)).toBe(64);
    // float arg big-endian
    expect(view.getFloat32(36, false)).toBeCloseTo(0.5, 6);
  });

  it("distinguishes ints from floats by integrality", () => {
    const packet = encodeMessage("/x", [3, 3.5]);
    expect(String.fromCharCode(...packet.subarray(4, 8))).toBe(",if\0");
  });

  it("rejects addresses without a leading slash and unsupported arg types", () => {
    expect(() => encodeMessage("nope", [])).toThrow(RangeError);
    expect(() => encodeMessage("/x", [Number.NaN])).toThrow(RangeError);
    expect(() => encodeMessage("/x", [{}])).toThrow(RangeError);
  });
});
