#!/usr/bin/env node
/**
 * Damn Beavers OSC bridge (ARCHITECTURE_CONTRACT §26).
 *
 * Browsers can't send UDP. This zero-dependency Node process is the
 * narrow waist between the game's WebSocket JSON stream and any
 * OSC-speaking synth (SuperCollider, Max, Pd, TouchDesigner, ...):
 *
 *   game (ws://localhost:8787 JSON)  ->  this bridge  ->  UDP OSC 1.1
 *
 * Usage:
 *   node tools/audio/osc-bridge.mjs [--port 8787] [--osc-host 127.0.0.1] [--osc-port 57120] [-v]
 *
 * Wire format on the socket: one JSON object per text frame:
 *   {"type":"osc","address":"/beavers/note","args":["pluck",64,0.5,1,0.2,0.8,0.11]}
 * Every message becomes one binary OSC packet. See docs/AUDIO.md for the
 * full address scheme and tools/audio/dambeavers.scd for a ready synth.
 */
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { createSocket } from "node:dgram";
import { encodeMessage } from "./osc-encode.mjs";

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
}
const PORT = Number(option("port", "8787"));
const OSC_HOST = option("osc-host", "127.0.0.1");
const OSC_PORT = Number(option("osc-port", "57120"));
const VERBOSE = args.includes("-v") || args.includes("--verbose");

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const udp = createSocket("udp4");
let packetsSent = 0;
let packetsDropped = 0;
let clients = 0;

const server = createServer((req, res) => {
  // A plain GET answers a tiny status page — handy for "is it running?".
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, clients, packetsSent, packetsDropped, forwarding: `udp:${OSC_HOST}:${OSC_PORT}` }));
});

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.destroy();
    return;
  }
  const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.setNoDelay(true);
  clients++;
  log(`client connected (${clients} total)`);
  sendFrame(socket, JSON.stringify({ type: "hello", forwarding: `udp:${OSC_HOST}:${OSC_PORT}` }));

  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const frame = readFrame(buffer);
      if (frame === undefined) return;
      buffer = buffer.subarray(frame.consumed);
      if (frame.opcode === 0x8) {
        socket.end();
        return;
      }
      if (frame.opcode === 0x9) {
        sendFrame(socket, frame.payload, 0xA);
        continue;
      }
      if (frame.opcode !== 0x1) continue;
      handleMessage(frame.payload.toString("utf8"));
    }
  });
  const drop = () => {
    clients--;
    log(`client disconnected (${clients} total)`);
  };
  socket.on("close", drop);
  socket.on("error", drop);
});

function handleMessage(text) {
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    packetsDropped++;
    return;
  }
  if (message?.type !== "osc" || typeof message.address !== "string" || !Array.isArray(message.args)) {
    packetsDropped++;
    return;
  }
  let packet;
  try {
    packet = encodeMessage(message.address, message.args);
  } catch (error) {
    packetsDropped++;
    if (VERBOSE) console.warn("dropped:", error instanceof Error ? error.message : error);
    return;
  }
  udp.send(packet, OSC_PORT, OSC_HOST, (error) => {
    if (error) packetsDropped++;
    else packetsSent++;
  });
  if (VERBOSE) console.log("osc", message.address, ...message.args);
}

/** Minimal RFC 6455 frame reader (client->server frames are masked). Returns undefined until a full frame is buffered. */
function readFrame(buffer) {
  if (buffer.length < 2) return undefined;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return undefined;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return undefined;
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  const maskOffset = offset;
  if (masked) offset += 4;
  if (buffer.length < offset + length) return undefined;
  let payload = buffer.subarray(offset, offset + length);
  if (masked) {
    const mask = buffer.subarray(maskOffset, maskOffset + 4);
    const unmasked = Buffer.allocUnsafe(length);
    for (let i = 0; i < length; i++) unmasked[i] = payload[i] ^ mask[i & 3];
    payload = unmasked;
  }
  return { opcode, payload, consumed: offset + length };
}

/** Server->client frames are unmasked text (or pong) — small payloads only. */
function sendFrame(socket, payload, opcode = 0x1) {
  const data = Buffer.from(payload);
  const header = data.length < 126 ? 2 : 4;
  const frame = Buffer.allocUnsafe(header + data.length);
  frame[0] = 0x80 | opcode;
  if (header === 2) {
    frame[1] = data.length;
    data.copy(frame, 2);
  } else {
    frame[1] = 126;
    frame.writeUInt16BE(data.length, 2);
    data.copy(frame, 4);
  }
  socket.write(frame);
}

function log(...parts) {
  console.log(`[osc-bridge]`, ...parts);
}

server.listen(PORT, () => {
  log(`listening ws://localhost:${PORT}  ->  osc udp://${OSC_HOST}:${OSC_PORT}`);
  log(VERBOSE ? "verbose on" : "(-v for message log)");
});
