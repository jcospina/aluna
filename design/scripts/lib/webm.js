// @ts-check
/**
 * A recorder's WebM, finished so a player knows its length and can seek it.
 *
 * Chrome and Firefox write their WebM as it is recorded, so the length and the index a player
 * seeks by, which belong near the start, are never written: Chrome leaves them out and Firefox
 * writes a Duration of 0 and an empty SeekHead. `finishWebm` rewrites the file whole: the same
 * header, Info with its Duration, the same Tracks, the same blocks in clusters of a few seconds
 * each, and a Cues index a SeekHead points at. The frames are copied, never decoded, straight
 * into one buffer sized before anything is written, so a long recording costs its own size once
 * more and no more. Anything it can't read exactly, it leaves as it was.
 */

const ID = {
  ebml: 0x1a45dfa3,
  segment: 0x18538067,
  seekHead: 0x114d9b74,
  seek: 0x4dbb,
  seekId: 0x53ab,
  seekPosition: 0x53ac,
  info: 0x1549a966,
  timecodeScale: 0x2ad7b1,
  duration: 0x4489,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackNumber: 0xd7,
  trackType: 0x83,
  cluster: 0x1f43b675,
  timecode: 0xe7,
  simpleBlock: 0xa3,
  blockGroup: 0xa0,
  block: 0xa1,
  cues: 0x1c53bb6b,
  cuePoint: 0xbb,
  cueTime: 0xb3,
  cueTrackPositions: 0xb7,
  cueTrack: 0xf7,
  cueClusterPosition: 0xf1,
};

/** The Segment's children, which also end a Cluster written without a size. */
const TOP_LEVEL = new Set([
  ID.seekHead,
  ID.info,
  ID.tracks,
  ID.cluster,
  ID.cues,
  0x1043a770,
  0x1254c367,
  0x1941a469,
]);

/** The only elements a recorder writes without a size: what it can't know until it stops. */
const OPEN = new Set([ID.segment, ID.cluster]);

const BLOCKS = new Set([ID.simpleBlock, ID.blockGroup]);

const VOID = 0xec;
const CRC = 0xbf;

/** What a Segment may hold, and a Cluster: anything else means the file isn't what it says. */
const SEGMENT_KIDS = new Set([...TOP_LEVEL, VOID, CRC]);
const CLUSTER_KIDS = new Set([...BLOCKS, ID.timecode, 0xa7, 0xab, 0xaf, 0x5854, VOID, CRC]);

/** The elements inside Tracks that hold others, walked so a broken one is found before it's copied. */
const TRACK_MASTERS = new Set([
  ID.trackEntry,
  0xe0,
  0xe1,
  0xe2,
  0x41e4,
  0x5034,
  0x5035,
  0x55b0,
  0x55d0,
  0x6240,
  0x6624,
  0x6d80,
  0x7670,
]);

/** The longest a cluster spans, in milliseconds: well inside a block's 16-bit offset. */
const CLUSTER_SPAN_MS = 5000;

const AUDIO_TRACK = 2;

/**
 * @typedef {{ id: number, start: number, data: number, end: number, sized: boolean }} Element
 * @typedef {{ at: number, id: number, from: number, to: number, offset: number,
 *   track: number }} Block
 * @typedef {{ raw: Uint8Array } | { id: number, kids: Node[] }
 *   | { block: Block, rel: number, key: boolean }} Node
 */

/**
 * @param {Uint8Array} bytes
 * @param {number} at
 */
function readId(bytes, at) {
  const length = Math.clz32(bytes[at] ?? 0) - 23;
  if (length < 1 || length > 4 || at + length > bytes.length) throw new RangeError("bad id");
  let id = 0;
  for (let i = 0; i < length; i++) id = id * 256 + (bytes[at + i] ?? 0);
  return { id, length };
}

/**
 * @param {Uint8Array} bytes
 * @param {number} at
 */
function readSize(bytes, at) {
  const first = bytes[at] ?? 0;
  const length = Math.clz32(first) - 23;
  if (length < 1 || length > 8 || at + length > bytes.length) throw new RangeError("bad size");
  let size = first & (0xff >> length);
  let unknown = size === 0xff >> length;
  for (let i = 1; i < length; i++) {
    const byte = bytes[at + i] ?? 0;
    size = size * 256 + byte;
    unknown &&= byte === 0xff;
  }
  if (!unknown && !Number.isSafeInteger(size)) throw new RangeError("size too large");
  return { size, length, unknown };
}

/**
 * The element at `at`, inside `limit`. Only a Segment or a Cluster may be written without a
 * size, and runs to `limit`; any other element must end inside its parent.
 *
 * @param {Uint8Array} bytes
 * @param {number} at
 * @param {number} limit
 * @returns {Element}
 */
function elementAt(bytes, at, limit) {
  const id = readId(bytes, at);
  const size = readSize(bytes, at + id.length);
  const data = at + id.length + size.length;
  if (size.unknown && !OPEN.has(id.id)) throw new RangeError("an element with no size");
  const end = size.unknown ? limit : data + size.size;
  if (end > limit) throw new RangeError("element past its parent");
  return { id: id.id, start: at, data, end, sized: !size.unknown };
}

/**
 * @param {Uint8Array} bytes
 * @param {number} from
 * @param {number} to
 */
function uintAt(bytes, from, to) {
  if (to - from > 8) throw new RangeError("an integer wider than 8 bytes");
  let value = 0;
  for (let i = from; i < to; i++) value = value * 256 + (bytes[i] ?? 0);
  if (!Number.isSafeInteger(value)) throw new RangeError("an integer too large");
  return value;
}

/**
 * The children of an element with a size, in order.
 *
 * @param {Uint8Array} bytes
 * @param {Element} parent
 */
function childrenOf(bytes, parent) {
  /** @type {Element[]} */
  const children = [];
  let at = parent.data;
  while (at < parent.end) {
    const child = elementAt(bytes, at, parent.end);
    children.push(child);
    at = child.end;
  }
  return children;
}

/**
 * A block, with where its 16-bit time offset sits in its payload so a new cluster can rewrite it.
 *
 * @param {Uint8Array} bytes
 * @param {Element} el
 * @param {number} base the cluster's time
 * @returns {Block}
 */
function blockOf(bytes, el, base) {
  const block = el.id === ID.blockGroup ? childrenOf(bytes, el).find((c) => c.id === ID.block) : el;
  if (!block) throw new RangeError("a BlockGroup with no Block");
  const track = readSize(bytes, block.data);
  if (block.end - block.data < track.length + 3) throw new RangeError("a block with no header");
  const offset = block.data - el.data + track.length;
  const view = new DataView(bytes.buffer, bytes.byteOffset + el.data + offset, 2);
  return {
    at: base + view.getInt16(0),
    id: el.id,
    from: el.data,
    to: el.end,
    offset,
    track: track.size,
  };
}

/**
 * A cluster's blocks, and where the cluster ends: its size, or for one written without a size,
 * the next element that can only stand beside it.
 *
 * @param {Uint8Array} bytes
 * @param {Element} cluster
 * @param {Block[]} into
 */
function readCluster(bytes, cluster, into) {
  let base = 0;
  let at = cluster.data;
  while (at < cluster.end) {
    if (!cluster.sized && TOP_LEVEL.has(readId(bytes, at).id)) break;
    const child = elementAt(bytes, at, cluster.end);
    if (!CLUSTER_KIDS.has(child.id)) throw new RangeError("a stray element in a Cluster");
    if (child.id === ID.timecode) base = uintAt(bytes, child.data, child.end);
    if (BLOCKS.has(child.id)) into.push(blockOf(bytes, child, base));
    at = child.end;
  }
  return at;
}

/**
 * Info's children but a Duration, which is written anew, and the clock its times count in.
 *
 * @param {Uint8Array} bytes
 * @param {Element} info
 */
function readInfo(bytes, info) {
  /** @type {Uint8Array[]} */
  const kept = [];
  let scale = 1_000_000;
  for (const child of childrenOf(bytes, info)) {
    if (child.id === ID.timecodeScale) scale = uintAt(bytes, child.data, child.end) || scale;
    if (child.id !== ID.duration && child.id !== CRC)
      kept.push(bytes.subarray(child.start, child.end));
  }
  return { kept, scale };
}

/**
 * Tracks as written. Every one must carry sound: Firefox marks no sound block as a keyframe,
 * though every Opus packet stands alone, and this marks them; a picture's blocks it could not.
 *
 * @param {Uint8Array} bytes
 * @param {Element} tracks
 */
function readTracks(bytes, tracks) {
  walkWhole(bytes, tracks);
  const audio = new Set();
  for (const entry of childrenOf(bytes, tracks)) {
    if (entry.id !== ID.trackEntry) continue;
    const fields = childrenOf(bytes, entry);
    const value = (/** @type {number} */ id) => {
      const field = fields.find((f) => f.id === id);
      return field ? uintAt(bytes, field.data, field.end) : 0;
    };
    if (value(ID.trackType) !== AUDIO_TRACK) throw new RangeError("a track that isn't sound");
    audio.add(value(ID.trackNumber));
  }
  return { bytes: bytes.subarray(tracks.start, tracks.end), audio };
}

/**
 * Every element under `parent`, all the way down, so none is copied that runs past its own.
 *
 * @param {Uint8Array} bytes
 * @param {Element} parent
 */
function walkWhole(bytes, parent) {
  for (const child of childrenOf(bytes, parent)) {
    if (TRACK_MASTERS.has(child.id)) walkWhole(bytes, child);
  }
}

/**
 * @param {Uint8Array} bytes
 * @param {Element} segment
 */
function readSegment(bytes, segment) {
  /** @type {ReturnType<typeof readInfo> | null} */
  let info = null;
  /** @type {ReturnType<typeof readTracks> | null} */
  let tracks = null;
  /** @type {Block[]} */
  const blocks = [];
  let at = segment.data;
  while (at < segment.end) {
    const el = elementAt(bytes, at, segment.end);
    if (!SEGMENT_KIDS.has(el.id)) throw new RangeError("a stray element in the Segment");
    if (el.id === ID.tracks) tracks = readTracks(bytes, el);
    if (el.id === ID.info) info = readInfo(bytes, el);
    at = el.id === ID.cluster ? readCluster(bytes, el, blocks) : el.end;
  }
  return { info, tracks, blocks };
}

/**
 * What the recording is made of: its EBML header, Info, Tracks, and every block in the order
 * written, whose times never run backwards. Anything else a recorder wrote, an empty SeekHead
 * or a Void, is written anew or left out.
 *
 * @param {Uint8Array} bytes
 */
function readRecording(bytes) {
  const header = elementAt(bytes, 0, bytes.length);
  if (header.id !== ID.ebml) throw new RangeError("not EBML");
  walkWhole(bytes, header);
  const segment = elementAt(bytes, header.end, bytes.length);
  if (segment.id !== ID.segment) throw new RangeError("no Segment");
  const { info, tracks, blocks } = readSegment(bytes, segment);
  if (!info || !tracks || blocks.length === 0) throw new RangeError("no Info, Tracks or blocks");
  let last = 0;
  for (const block of blocks) {
    if (block.at < last || !tracks.audio.has(block.track)) throw new RangeError("a stray block");
    last = block.at;
  }
  return {
    header: bytes.subarray(0, header.end),
    info: info.kept,
    tracks,
    blocks,
    scale: info.scale,
  };
}

/* ── Writing ──────────────────────────────────────────────────────────────── */

/** @param {number} value */
function bytesOf(value) {
  const out = [];
  for (let v = value; v > 0; v = Math.floor(v / 256)) out.unshift(v % 256);
  return out;
}

/**
 * @param {number} value
 * @param {number} [width] bytes to write, for a number whose size must not depend on its value
 */
function uintBytes(value, width = 1) {
  const out = bytesOf(value);
  while (out.length < width) out.unshift(0);
  return new Uint8Array(out);
}

/** @param {number} size */
function sizeBytes(size) {
  let length = 1;
  while (size >= 2 ** (7 * length) - 1) length++;
  const out = uintBytes(size, length);
  out[0] = (out[0] ?? 0) | (0x80 >> (length - 1));
  return out;
}

const idBytes = (/** @type {number} */ id) => new Uint8Array(bytesOf(id));

/** @type {WeakMap<Node, number>} */
const LENGTHS = new WeakMap();

/**
 * @param {Node} node
 * @returns {number}
 */
function payloadOf(node) {
  if ("raw" in node) return node.raw.length;
  if ("block" in node) return node.block.to - node.block.from;
  return node.kids.reduce((/** @type {number} */ sum, kid) => sum + lengthOf(kid), 0);
}

/**
 * The bytes `node` takes, header and all, measured once.
 *
 * @param {Node} node
 * @returns {number}
 */
function lengthOf(node) {
  const known = LENGTHS.get(node);
  if (known !== undefined) return known;
  const payload = payloadOf(node);
  const id = "raw" in node ? 0 : "block" in node ? node.block.id : node.id;
  const length = "raw" in node ? payload : idBytes(id).length + sizeBytes(payload).length + payload;
  LENGTHS.set(node, length);
  return length;
}

/**
 * @param {number} id
 * @param {Node[]} kids
 * @returns {{ id: number, kids: Node[] }}
 */
const el = (id, kids) => ({ id, kids });

/** @param {Uint8Array} raw @returns {Node} */
const raw = (raw) => ({ raw });

/**
 * @param {number} id
 * @param {number} value
 * @param {number} [width]
 */
const uintEl = (id, value, width) => el(id, [raw(uintBytes(value, width))]);

/** @param {number} value */
function durationEl(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value);
  return el(ID.duration, [raw(bytes)]);
}

/**
 * @param {number} target
 * @param {number} position
 */
const seekEl = (target, position) =>
  el(ID.seek, [el(ID.seekId, [raw(idBytes(target))]), uintEl(ID.seekPosition, position, 8)]);

/**
 * Write `node` into `out` at `at`: a block copied from the recording, its offset rewritten
 * against its new cluster and a sound block marked a keyframe.
 *
 * @param {Node} node
 * @param {Uint8Array} source
 * @param {Uint8Array} out
 * @param {number} at
 * @returns {number} where the next node goes
 */
function write(node, source, out, at) {
  if ("raw" in node) {
    out.set(node.raw, at);
    return at + node.raw.length;
  }
  const payload = payloadOf(node);
  const head = [idBytes("block" in node ? node.block.id : node.id), sizeBytes(payload)];
  for (const part of head) {
    out.set(part, at);
    at += part.length;
  }
  if (!("block" in node)) return node.kids.reduce((next, kid) => write(kid, source, out, next), at);
  const { block, rel, key } = node;
  out.set(source.subarray(block.from, block.to), at);
  new DataView(out.buffer, out.byteOffset + at + block.offset, 2).setInt16(0, rel);
  const flags = at + block.offset + 2;
  if (key) out[flags] = (out[flags] ?? 0) | 0x80;
  return at + payload;
}

/**
 * The blocks in clusters, each starting at its first block's time and spanning at most `span`
 * ticks, every block's offset measured from it.
 *
 * @param {Block[]} blocks
 * @param {number} span
 */
function clustersOf(blocks, span) {
  /** @type {{ time: number, track: number, node: { id: number, kids: Node[] } }[]} */
  const clusters = [];
  for (const block of blocks) {
    let cluster = clusters.at(-1);
    if (!cluster || block.at - cluster.time >= span) {
      cluster = {
        time: block.at,
        track: block.track,
        node: el(ID.cluster, [uintEl(ID.timecode, block.at)]),
      };
      clusters.push(cluster);
    }
    const key = block.id === ID.simpleBlock;
    cluster.node.kids.push({ block, rel: block.at - cluster.time, key });
  }
  return clusters;
}

/**
 * How long the recording runs, in its ticks: to the last block's start, and one block's length
 * past it, as far apart as the last two blocks began.
 *
 * @param {Block[]} blocks
 */
function ticksOf(blocks) {
  const last = blocks.at(-1)?.at ?? 0;
  const before = blocks.at(-2)?.at ?? last;
  return last + (last - before);
}

/**
 * @param {Uint8Array} bytes
 * @returns {{ bytes: Uint8Array, seconds: number }}
 */
function finish(bytes) {
  const { header, info, tracks, blocks, scale } = readRecording(bytes);
  const ticks = ticksOf(blocks);
  const infoEl = el(ID.info, [...info.map(raw), durationEl(ticks)]);
  const span = Math.min(0x7fff, Math.floor((CLUSTER_SPAN_MS * 1_000_000) / scale));
  const clusters = clustersOf(blocks, Math.max(1, span));
  const seekHeadLength = lengthOf(
    el(ID.seekHead, [seekEl(ID.info, 0), seekEl(ID.tracks, 0), seekEl(ID.cues, 0)]),
  );
  const tracksAt = seekHeadLength + lengthOf(infoEl);
  let at = tracksAt + tracks.bytes.length;
  const points = clusters.map((cluster) => {
    const position = at;
    at += lengthOf(cluster.node);
    return el(ID.cuePoint, [
      uintEl(ID.cueTime, cluster.time),
      el(ID.cueTrackPositions, [
        uintEl(ID.cueTrack, cluster.track),
        uintEl(ID.cueClusterPosition, position),
      ]),
    ]);
  });
  const seekHead = el(ID.seekHead, [
    seekEl(ID.info, seekHeadLength),
    seekEl(ID.tracks, tracksAt),
    seekEl(ID.cues, at),
  ]);
  const segment = el(ID.segment, [
    seekHead,
    infoEl,
    raw(tracks.bytes),
    ...clusters.map((c) => c.node),
    el(ID.cues, points),
  ]);
  const out = new Uint8Array(header.length + lengthOf(segment));
  write(segment, bytes, out, write(raw(header), bytes, out, 0));
  const seconds = (ticks * scale) / 1e9;
  if (!Number.isFinite(seconds)) throw new RangeError("no length");
  return { bytes: out, seconds };
}

/**
 * The recording rewritten with its length and an index to seek by. A file this can't read
 * exactly is returned as it was, since a recording that can't seek is still worth keeping.
 *
 * @param {Uint8Array} bytes
 * @returns {{ bytes: Uint8Array, seconds: number | null }}
 */
export function finishWebm(bytes) {
  try {
    return finish(bytes);
  } catch {
    return { bytes, seconds: null };
  }
}
