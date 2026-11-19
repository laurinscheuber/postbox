// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { MessageSummary } from '../types/mail';
import { openPstArchive, streamPstFolderHeaders } from '../worker/parsers/pstAdapter';
import { createPstBlockReader } from '../worker/pstBlockReader';
import {
  NID_NAME_TO_ID_MAP,
  NID_ROOT_FOLDER,
  NID_TYPE_CONTENTS_TABLE,
  NID_TYPE_HIERARCHY_TABLE,
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

  it('streams TableContext headers without TDZ errors and skips NBT scans on leaf folders', async () => {
    const VIRTUAL_SIZE = 42 * 1024 * 1024 * 1024;
    const regions: Array<{ start: number; data: Uint8Array }> = [];
    const utf16 = (str: string) => {
      const buf = new Uint8Array(str.length * 2);
      const dv = new DataView(buf.buffer);
      for (let i = 0; i < str.length; i += 1) dv.setUint16(i * 2, str.charCodeAt(i), true);
      return buf;
    };

    const buildHeapPage = (bClientSig: number, userRootHnid: number, items: Uint8Array[]) => {
      let dataCursor = 12;
      const offsets: number[] = [dataCursor];
      for (const item of items) {
        dataCursor += item.byteLength;
        offsets.push(dataCursor);
      }
      const pageMapOffset = dataCursor;
      const totalSize = pageMapOffset + 4 + offsets.length * 2;
      const page = new Uint8Array(totalSize);
      const pv = new DataView(page.buffer);
      pv.setUint16(0, pageMapOffset, true);
      page[2] = 0xec;
      page[3] = bClientSig;
      pv.setUint32(4, userRootHnid, true);
      for (let i = 0; i < items.length; i += 1) {
        page.set(items[i], offsets[i]);
      }
      pv.setUint16(pageMapOffset, items.length, true);
      pv.setUint16(pageMapOffset + 2, 0, true);
      for (let i = 0; i < offsets.length; i += 1) {
        pv.setUint16(pageMapOffset + 4 + i * 2, offsets[i], true);
      }
      return page;
    };

    const buildFolderPc = (name: string, contentCount: number, hasSubfolders: boolean) => {
      const nameBytes = utf16(name);
      const bthHdr = new Uint8Array(8);
      const bhv = new DataView(bthHdr.buffer);
      bthHdr[0] = 0xb5;
      bthHdr[1] = 2;
      bthHdr[2] = 6;
      bthHdr[3] = 0;
      bhv.setUint32(4, 0x40, true);

      const recs = new Uint8Array(24);
      const rv = new DataView(recs.buffer);
      // 0x3001 PT_UNICODE -> 0x60
      rv.setUint16(0, 0x3001, true);
      rv.setUint16(2, 0x001f, true);
      rv.setUint32(4, 0x60, true);
      // 0x3602 PT_LONG -> contentCount
      rv.setUint16(8, 0x3602, true);
      rv.setUint16(10, 0x0003, true);
      rv.setUint32(12, contentCount, true);
      // 0x360a PT_BOOLEAN -> hasSubfolders
      rv.setUint16(16, 0x360a, true);
      rv.setUint16(18, 0x000b, true);
      recs[20] = hasSubfolders ? 1 : 0;

      return buildHeapPage(0xbc, 0x20, [bthHdr, recs, nameBytes]);
    };

    const buildTableTc = (cols: Array<{ type: number; key: number; ibData: number; cbData: number; iBit: number }>, numRowBytes: number, cebOffset: number, rowData: Uint8Array, extraItems: Uint8Array[] = []) => {
      const tcInfo = new Uint8Array(22 + cols.length * 8);
      const tv = new DataView(tcInfo.buffer);
      tcInfo[0] = 0x7c;
      tcInfo[1] = cols.length;
      tv.setUint16(6, cebOffset, true);
      tv.setUint16(8, numRowBytes, true);
      tv.setUint32(14, 0x40, true);
      for (let i = 0; i < cols.length; i += 1) {
        const off = 22 + i * 8;
        tv.setUint16(off, cols[i].type, true);
        tv.setUint16(off + 2, cols[i].key, true);
        tv.setUint16(off + 4, cols[i].ibData, true);
        tcInfo[off + 6] = cols[i].cbData;
        tcInfo[off + 7] = cols[i].iBit;
      }
      return buildHeapPage(0x7c, 0x20, [tcInfo, rowData, ...extraItems]);
    };

    const INBOX_NID = 32834;
    const MSG_NID = 2097188;
    const ROOT_HIER_NID = makeSiblingNid(NID_ROOT_FOLDER, NID_TYPE_HIERARCHY_TABLE);
    const INBOX_HIER_NID = makeSiblingNid(INBOX_NID, NID_TYPE_HIERARCHY_TABLE);
    const INBOX_CONTENTS_NID = makeSiblingNid(INBOX_NID, NID_TYPE_CONTENTS_TABLE);

    // Folder PCs
    const rootPc = buildFolderPc('', 0, true);
    const inboxPc = buildFolderPc('Inbox', 1, false);

    // Root hierarchy table containing INBOX_NID
    const rootHierRow = new Uint8Array(8);
    new DataView(rootHierRow.buffer).setUint32(0, INBOX_NID, true);
    rootHierRow[4] = 0x80;
    const rootHierTc = buildTableTc([{ type: 0x0003, key: 0x67f2, ibData: 0, cbData: 4, iBit: 0 }], 5, 4, rootHierRow);

    // Inbox contents table with 1 message row
    const subjBytes = utf16('33 GB TDZ Regression Test');
    const senderBytes = utf16('Laurin Scheuber');
    const contentsRow = new Uint8Array(16);
    const crv = new DataView(contentsRow.buffer);
    crv.setUint32(0, MSG_NID, true);
    crv.setUint32(4, 0x60, true); // subject HID
    crv.setUint32(8, 0x80, true); // sender HID
    contentsRow[12] = 0xe0; // bits for cols 0,1,2
    const inboxContentsTc = buildTableTc(
      [
        { type: 0x0003, key: 0x67f2, ibData: 0, cbData: 4, iBit: 0 },
        { type: 0x001f, key: 0x0037, ibData: 4, cbData: 4, iBit: 1 },
        { type: 0x001f, key: 0x0c1a, ibData: 8, cbData: 4, iBit: 2 },
      ],
      13,
      12,
      contentsRow,
      [subjBytes, senderBytes],
    );

    const blocks: Array<{ bid: bigint; ib: number; data: Uint8Array }> = [
      { bid: 0x100n, ib: 40 * 1024 * 1024 * 1024 + 4096, data: rootPc },
      { bid: 0x104n, ib: 40 * 1024 * 1024 * 1024 + 8192, data: rootHierTc },
      { bid: 0x108n, ib: 40 * 1024 * 1024 * 1024 + 12288, data: inboxPc },
      { bid: 0x10cn, ib: 40 * 1024 * 1024 * 1024 + 16384, data: inboxContentsTc },
    ];
    for (const b of blocks) regions.push({ start: b.ib, data: b.data });

    // Multi-level BBT (cLevel = 1 -> leaf @ >40 GB) with unnormalized odd btkey (0x101n)
    const BBT_LEAF_IB = 40 * 1024 * 1024 * 1024 + 20480;
    const BBT_ROOT_IB = 40 * 1024 * 1024 * 1024 + 24576;
    const bbtLeaf = new Uint8Array(512);
    const blv = new DataView(bbtLeaf.buffer);
    blocks.forEach((b, idx) => {
      blv.setBigUint64(idx * 24, b.bid, true);
      blv.setBigUint64(idx * 24 + 8, BigInt(b.ib), true);
      blv.setUint16(idx * 24 + 16, b.data.byteLength, true);
    });
    blv.setUint8(0x1e8, blocks.length);
    blv.setUint8(0x1eb, 0);
    regions.push({ start: BBT_LEAF_IB, data: bbtLeaf });

    const bbtRoot = new Uint8Array(512);
    const brv = new DataView(bbtRoot.buffer);
    brv.setBigUint64(0, 0x100n | 1n, true); // odd LSB bit intentionally set!
    brv.setBigUint64(8, 0x101n, true);
    brv.setBigUint64(16, BigInt(BBT_LEAF_IB), true);
    brv.setUint8(0x1e8, 1);
    brv.setUint8(0x1eb, 1);
    regions.push({ start: BBT_ROOT_IB, data: bbtRoot });

    // NBT Leaf sorted by NID: 97, 290, 301 (ROOT_HIER), 32834 (INBOX), 32846 (INBOX_CONTENTS)
    const NBT_ROOT_IB = 40 * 1024 * 1024 * 1024 + 28672;
    const nbtEntries = [
      { nid: NID_NAME_TO_ID_MAP, bid: 0n, parent: 0 },
      { nid: NID_ROOT_FOLDER, bid: 0x100n, parent: 0 },
      { nid: ROOT_HIER_NID, bid: 0x104n, parent: 0 },
      { nid: INBOX_NID, bid: 0x108n, parent: NID_ROOT_FOLDER },
      { nid: INBOX_HIER_NID, bid: 0n, parent: 0 },
      { nid: INBOX_CONTENTS_NID, bid: 0x10cn, parent: 0 },
    ].sort((a, b) => a.nid - b.nid);

    const nbtLeaf = new Uint8Array(512);
    const nlv = new DataView(nbtLeaf.buffer);
    nbtEntries.forEach((e, idx) => {
      nlv.setBigUint64(idx * 32, BigInt(e.nid), true);
      nlv.setBigUint64(idx * 32 + 8, e.bid, true);
      nlv.setBigUint64(idx * 32 + 16, 0n, true);
      nlv.setUint32(idx * 32 + 24, e.parent, true);
    });
    nlv.setUint8(0x1e8, nbtEntries.length);
    nlv.setUint8(0x1eb, 0);
    regions.push({ start: NBT_ROOT_IB, data: nbtLeaf });

    // Header
    const header = new Uint8Array(1024);
    const hv = new DataView(header.buffer);
    header.set([0x21, 0x42, 0x44, 0x4e], 0);
    hv.setUint16(10, 0x17, true);
    hv.setUint8(0x201, 0);
    hv.setBigUint64(0xe0, BigInt(NBT_ROOT_IB), true);
    hv.setBigUint64(0xf0, BigInt(BBT_ROOT_IB), true);
    regions.push({ start: 0, data: header });

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
          const ovStart = Math.max(start, reg.start);
          const ovEnd = Math.min(end, reg.start + reg.data.byteLength);
          if (ovEnd > ovStart) {
            out.set(reg.data.subarray(ovStart - reg.start, ovEnd - reg.start), ovStart - start);
          }
        }
        return out.buffer;
      },
    } as unknown as Blob);

    const mockFile = {
      name: '42gb-archive.pst',
      size: VIRTUAL_SIZE,
      type: 'application/octet-stream',
      slice(start = 0, end = VIRTUAL_SIZE) {
        return makeSlice(start, Math.min(VIRTUAL_SIZE, end));
      },
      async arrayBuffer() {
        throw new Error('Full-file arrayBuffer() forbidden!');
      },
    } as unknown as File;

    const { session, defaultFolderId } = await openPstArchive(mockFile, 'arch-tdz', 'pst');
    expect(defaultFolderId).toBe(`arch-tdz:folder:${INBOX_NID}`);

    const streamed: MessageSummary[] = [];
    const { total, cancelled } = await streamPstFolderHeaders(session, defaultFolderId!, {
      onBatch: (batch) => {
        streamed.push(...batch);
      },
    });

    expect(cancelled).toBe(false);
    expect(total).toBe(1);
    expect(streamed.length).toBe(1);
    expect(streamed[0].subject).toBe('33 GB TDZ Regression Test');
    expect(streamed[0].senderName).toBe('Laurin Scheuber');

    await session.engine.close();
  });
});
