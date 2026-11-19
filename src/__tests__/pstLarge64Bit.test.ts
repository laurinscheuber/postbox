// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createPstBlockReader } from '../worker/pstBlockReader';
import {
  NID_NAME_TO_ID_MAP,
  NID_TYPE_CONTENTS_TABLE,
  PstEngine,
  makeSiblingNid,
} from '../worker/pstEngine';

/**
 * Constructs a sparse 45 GB virtual Blob whose `.arrayBuffer()` throws if full-file reading
 * is ever attempted, placing PST BBT/NBT/Data pages above 40 GB (42,949,672,960 bytes)
 * with 64-bit BIDs > 0x4_0000_0000 and high unsigned NIDs >= 0x8000_0000.
 */
function createSparse45GbPstBlob(): { blob: Blob; payloadText: string; highNid: number; highBid: bigint } {
  const VIRTUAL_SIZE = 45 * 1024 * 1024 * 1024; // 45 GB (> 42.9 GB)
  const PAGE_NBT_IB = 40 * 1024 * 1024 * 1024 + 512; // > 40 GB offset
  const PAGE_BBT_IB = 40 * 1024 * 1024 * 1024 + 4096; // > 40 GB offset
  const DATA_PAYLOAD_IB = 41 * 1024 * 1024 * 1024 + 131072; // > 41 GB offset

  const highBid = 0x400000004n; // > 17 billion (overflows 32-bit!)
  const highNid = 0x80000024; // >= 2^31 (signed negative in 32-bit JS!)
  const payloadText = 'Postbox 45 GB 64-bit PST slice verification payload!';
  const payloadBytes = new TextEncoder().encode(payloadText);

  // Sparse memory regions backed by offset -> Uint8Array
  const regions: Array<{ start: number; data: Uint8Array }> = [];

  // 1. Header (1024 bytes at offset 0): Unicode 64-bit PST (wVer = 23 = 0x17), cryptMethod = 0
  const header = new Uint8Array(1024);
  const hv = new DataView(header.buffer);
  header[0] = 0x21; // '!'
  header[1] = 0x42; // 'B'
  header[2] = 0x44; // 'D'
  header[3] = 0x4e; // 'N'
  hv.setUint16(10, 0x17, true); // Unicode 64-bit
  hv.setUint8(0x201, 0); // no encryption
  hv.setBigUint64(0xe0, BigInt(PAGE_NBT_IB), true);
  hv.setBigUint64(0xf0, BigInt(PAGE_BBT_IB), true);
  regions.push({ start: 0, data: header });

  // 2. NBT Leaf Page (512 bytes at >40 GB)
  // Include NID_NAME_TO_ID_MAP (97) with bidData=0 and highNid pointing to highBid
  const nbtPage = new Uint8Array(512);
  const nv = new DataView(nbtPage.buffer);
  // Entry 0: nid = 97 (empty)
  nv.setBigUint64(0, BigInt(NID_NAME_TO_ID_MAP), true);
  nv.setBigUint64(8, 0n, true);
  nv.setBigUint64(16, 0n, true);
  nv.setUint32(24, 0, true);
  // Entry 1: highNid (0x80000024) -> highBid
  nv.setBigUint64(32 + 0, BigInt(highNid), true);
  nv.setBigUint64(32 + 8, highBid, true);
  nv.setBigUint64(32 + 16, 0n, true);
  nv.setUint32(32 + 24, 290, true);
  // Trailer: cEnt = 2 @ 0x1e8, cLevel = 0 @ 0x1eb
  nv.setUint8(0x1e8, 2);
  nv.setUint8(0x1eb, 0);
  regions.push({ start: PAGE_NBT_IB, data: nbtPage });

  // 3. BBT Leaf Page (512 bytes at >40 GB)
  const bbtPage = new Uint8Array(512);
  const bv = new DataView(bbtPage.buffer);
  bv.setBigUint64(0, highBid, true);
  bv.setBigUint64(8, BigInt(DATA_PAYLOAD_IB), true);
  bv.setUint16(16, payloadBytes.byteLength, true);
  bv.setUint8(0x1e8, 1);
  bv.setUint8(0x1eb, 0);
  regions.push({ start: PAGE_BBT_IB, data: bbtPage });

  // 4. Data Payload at >41 GB
  regions.push({ start: DATA_PAYLOAD_IB, data: payloadBytes });

  const makeSlice = (start: number, end: number): Blob => ({
    size: Math.max(0, end - start),
    type: 'application/octet-stream',
    slice(s = 0, e = end - start) {
      return makeSlice(start + s, Math.min(end, start + e));
    },
    async arrayBuffer() {
      const len = Math.max(0, end - start);
      const out = new Uint8Array(len);
      for (const reg of regions) {
        const regEnd = reg.start + reg.data.byteLength;
        const ovStart = Math.max(start, reg.start);
        const ovEnd = Math.min(end, regEnd);
        if (ovEnd > ovStart) {
          out.set(
            reg.data.subarray(ovStart - reg.start, ovEnd - reg.start),
            ovStart - start,
          );
        }
      }
      return out.buffer;
    },
  } as unknown as Blob);

  const sparseBlob = {
    size: VIRTUAL_SIZE,
    type: 'application/octet-stream',
    slice(start = 0, end = VIRTUAL_SIZE) {
      return makeSlice(start, Math.min(VIRTUAL_SIZE, end));
    },
    async arrayBuffer(): Promise<ArrayBuffer> {
      throw new Error('Full-file arrayBuffer() is forbidden on PST/OST archives!');
    },
  } as unknown as Blob;

  return { blob: sparseBlob, payloadText, highNid, highBid };
}

describe('PstEngine 64-bit >40 GB addressing', () => {
  it('reads BBT/NBT/Data pages above 40 GB via 64 KB File.slice() without calling arrayBuffer() on full file', async () => {
    const { blob, payloadText, highNid, highBid } = createSparse45GbPstBlob();
    const reader = createPstBlockReader(blob);
    const engine = await PstEngine.open(reader);

    expect(engine.fileSize).toBe(45 * 1024 * 1024 * 1024);

    // 32-bit signed-overflow NID lookup (0x80000024) & sibling NID math
    const siblingContents = makeSiblingNid(0x80000022, NID_TYPE_CONTENTS_TABLE);
    expect(siblingContents).toBe(0x8000002e);

    const nbtEntry = await engine.lookupNode(highNid);
    expect(nbtEntry).toBeDefined();
    expect(nbtEntry?.nid).toBe(highNid);
    expect(nbtEntry?.bidData).toBe(highBid);

    const bbtEntry = await engine.lookupBlock(highBid);
    expect(bbtEntry).toBeDefined();
    expect(bbtEntry?.ib).toBe(41 * 1024 * 1024 * 1024 + 131072);

    const buffers = await engine.readDataBuffers(highBid);
    expect(buffers.length).toBe(1);
    expect(new TextDecoder().decode(buffers[0])).toBe(payloadText);

    // Ensure reader only cached minimal 64 KB blocks
    expect(reader.getStats().cachedBlocks).toBeLessThanOrEqual(4);
    await engine.close();
  });
});
