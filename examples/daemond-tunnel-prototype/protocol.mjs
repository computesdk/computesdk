// Shared wire protocol for the daemond dial-out tunnel.
//
// One WebSocket carries both planes:
//   - Control frames: WS text frames containing a single JSON object.
//       {"t":"open","id":<u32>,"port":<n>,"host":"127.0.0.1"}  control plane -> sandbox
//       {"t":"opened","id"}                                   sandbox -> control plane
//       {"t":"close","id"}                                    either direction (half-close)
//       {"t":"error","id"?,"code","message"}                  either direction
//       {"t":"ping","ts"} / {"t":"pong","ts"}                 either direction
//       {"t":"auth","token"}                                  sandbox -> control plane (first frame)
//   - Data frames: WS binary frames = 4-byte big-endian stream id + payload.
//
// Stream ids are allocated by the control plane: odd numbers, increasing.

export const MAX_FRAME_PAYLOAD = 64 * 1024; // 64 KiB

export function encodeData(id, buf) {
  const out = Buffer.allocUnsafe(4 + buf.length);
  out.writeUInt32BE(id >>> 0, 0);
  Buffer.from(buf).copy(out, 4);
  return out;
}

export function decodeData(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length < 4) throw new Error('data frame too short');
  return { id: b.readUInt32BE(0), payload: b.subarray(4) };
}

// Chunk a buffer into a list of data frames respecting MAX_FRAME_PAYLOAD.
export function encodeDataChunked(id, buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length <= MAX_FRAME_PAYLOAD) return [encodeData(id, b)];
  const frames = [];
  for (let off = 0; off < b.length; off += MAX_FRAME_PAYLOAD) {
    frames.push(encodeData(id, b.subarray(off, off + MAX_FRAME_PAYLOAD)));
  }
  return frames;
}

export function encodeControl(obj) {
  return JSON.stringify(obj);
}

export function decodeControl(text) {
  return JSON.parse(text);
}

// Control-plane stream id allocator: odd numbers, increasing.
export function createStreamIdAllocator(start = 1) {
  let next = start | 1;
  return () => {
    const id = next;
    next = (next + 2) >>> 0;
    if (next === 0) next = 1;
    return id;
  };
}
