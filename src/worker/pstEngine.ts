import {
  Consts,
  PSTMessage,
  PropertyTypeObject,
  type PLNode,
  type PLSubNode,
  type Property,
  type PropertyValueResolver,
  type RootProvider,
} from '@hiraokahypertools/pst-extractor';
import { inflate } from 'pako';
import { decodeSmartTextBytes } from '../utils/encoding';
import type { PagedBlockReader } from './pstBlockReader';

const COMP_ENC: readonly number[] = [
  0x47, 0xf1, 0xb4, 0xe6, 0x0b, 0x6a, 0x72, 0x48, 0x85, 0x4e, 0x9e, 0xeb, 0xe2, 0xf8, 0x94, 0x53,
  0xe0, 0xbb, 0xa0, 0x02, 0xe8, 0x5a, 0x09, 0xab, 0xdb, 0xe3, 0xba, 0xc6, 0x7c, 0xc3, 0x10, 0xdd,
  0x39, 0x05, 0x96, 0x30, 0xf5, 0x37, 0x60, 0x82, 0x8c, 0xc9, 0x13, 0x4a, 0x6b, 0x1d, 0xf3, 0xfb,
  0x8f, 0x26, 0x97, 0xca, 0x91, 0x17, 0x01, 0xc4, 0x32, 0x2d, 0x6e, 0x31, 0x95, 0xff, 0xd9, 0x23,
  0xd1, 0x00, 0x5e, 0x79, 0xdc, 0x44, 0x3b, 0x1a, 0x28, 0xc5, 0x61, 0x57, 0x20, 0x90, 0x3d, 0x83,
  0xb9, 0x43, 0xbe, 0x67, 0xd2, 0x46, 0x42, 0x76, 0xc0, 0x6d, 0x5b, 0x7e, 0xb2, 0x0f, 0x16, 0x29,
  0x3c, 0xa9, 0x03, 0x54, 0x0d, 0xda, 0x5d, 0xdf, 0xf6, 0xb7, 0xc7, 0x62, 0xcd, 0x8d, 0x06, 0xd3,
  0x69, 0x5c, 0x86, 0xd6, 0x14, 0xf7, 0xa5, 0x66, 0x75, 0xac, 0xb1, 0xe9, 0x45, 0x21, 0x70, 0x0c,
  0x87, 0x9f, 0x74, 0xa4, 0x22, 0x4c, 0x6f, 0xbf, 0x1f, 0x56, 0xaa, 0x2e, 0xb3, 0x78, 0x33, 0x50,
  0xb0, 0xa3, 0x92, 0xbc, 0xcf, 0x19, 0x1c, 0xa7, 0x63, 0xcb, 0x1e, 0x4d, 0x3e, 0x4b, 0x1b, 0x9b,
  0x4f, 0xe7, 0xf0, 0xee, 0xad, 0x3a, 0xb5, 0x59, 0x04, 0xea, 0x40, 0x55, 0x25, 0x51, 0xe5, 0x7a,
  0x89, 0x38, 0x68, 0x52, 0x7b, 0xfc, 0x27, 0xae, 0xd7, 0xbd, 0xfa, 0x07, 0xf4, 0xcc, 0x8e, 0x5f,
  0xef, 0x35, 0x9c, 0x84, 0x2b, 0x15, 0xd5, 0x77, 0x34, 0x49, 0xb6, 0x12, 0x0a, 0x7f, 0x71, 0x88,
  0xfd, 0x9d, 0x18, 0x41, 0x7d, 0x93, 0xd8, 0x58, 0x2c, 0xce, 0xfe, 0x24, 0xaf, 0xde, 0xb8, 0x36,
  0xc8, 0xa1, 0x80, 0xa6, 0x99, 0x98, 0xa8, 0x2f, 0x0e, 0x81, 0x65, 0x73, 0xe4, 0xc2, 0xa2, 0x8a,
  0xd4, 0xe1, 0x11, 0xd0, 0x08, 0x8b, 0x2a, 0xf2, 0xed, 0x9a, 0x64, 0x3f, 0xc1, 0x6c, 0xf9, 0xec,
];

const GUID_MAP = new Map<string, number>([
  ['00020329-0000-0000-C000-000000000046', 0],
  ['00062008-0000-0000-C000-000000000046', 1],
  ['00062004-0000-0000-C000-000000000046', 2],
  ['00020386-0000-0000-C000-000000000046', 3],
  ['00062002-0000-0000-C000-000000000046', 4],
  ['6ED8DA90-450B-101B-98DA-00AA003F1305', 5],
  ['0006200A-0000-0000-C000-000000000046', 6],
  ['41F28F13-83F4-4114-A584-EEDB5A6B0BFF', 7],
  ['0006200E-0000-0000-C000-000000000046', 8],
  ['00062041-0000-0000-C000-000000000046', 9],
  ['00062003-0000-0000-C000-000000000046', 10],
  ['4442858E-A9E3-4E80-B900-317A210CC15B', 11],
  ['00020328-0000-0000-C000-000000000046', 12],
  ['71035549-0739-4DCB-9163-00F0580DBBDF', 13],
  ['00062040-0000-0000-C000-000000000046', 14],
]);

export const NID_TYPE_NORMAL_FOLDER = 0x02;
export const NID_TYPE_SEARCH_FOLDER = 0x03;
export const NID_TYPE_NORMAL_MESSAGE = 0x04;
export const NID_TYPE_HIERARCHY_TABLE = 0x0d;
export const NID_TYPE_CONTENTS_TABLE = 0x0e;
export const NID_MESSAGE_STORE = 33;
export const NID_NAME_TO_ID_MAP = 97;
export const NID_ROOT_FOLDER = 290;
export const NID_TOP_OF_OUTLOOK_DATA_FILE = 32802;

const MAX_BTREE_PAGE_CACHE = 1024;
const utf16Decoder = new TextDecoder('utf-16le');

// 64-bit safe arithmetic helpers (zero 32-bit bitwise ops on offsets or BIDs)
export function readU64(view: DataView, offset: number): bigint {
  return view.getBigUint64(offset, true);
}

export function toSafeNumber(value: bigint, label = 'offset'): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${label} exceeds safe 53-bit integer range: ${value.toString()}`);
  }
  return Number(value);
}

export function normalizeBid(bid: bigint): bigint {
  return bid & ~1n;
}

export function isDataBid(bid: bigint): boolean {
  return (bid & 2n) === 0n;
}

export function toUnsignedNid(nid: number): bigint {
  return BigInt(nid) & 0xffffffffn;
}

export function getNidType(nid: number): number {
  return Number(toUnsignedNid(nid) & 0x1fn);
}

export function makeSiblingNid(nid: number, nidType: number): number {
  const base = toUnsignedNid(nid) & ~0x1fn;
  const typeBits = BigInt(nidType) & 0x1fn;
  return Number(base | typeBits);
}

export function filetimeToDate(view: DataView, offset: number): Date | null {
  const ticks = view.getBigUint64(offset, true);
  if (ticks === 0n) return null;
  const msSince1601 = ticks / 10000n;
  const epochDiffMs = 11644473600000n;
  const unixMs = msSince1601 - epochDiffMs;
  const numMs = Number(unixMs);
  if (!Number.isFinite(numMs)) return null;
  const d = new Date(numMs);
  return Number.isNaN(d.getTime()) ? null : d;
}

function decodeCompressible(buf: ArrayBuffer): void {
  const view = new Uint8Array(buf);
  for (let i = 0; i < view.byteLength; i += 1) {
    view[i] = COMP_ENC[view[i]];
  }
}

function inflateZlib(buf: ArrayBuffer): ArrayBuffer {
  const out = inflate(new Uint8Array(buf));
  if (out.byteOffset === 0 && out.byteLength === out.buffer.byteLength) {
    return out.buffer as ArrayBuffer;
  }
  return out.slice().buffer;
}

function concatArrayBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
  if (buffers.length === 0) return new ArrayBuffer(0);
  if (buffers.length === 1) return buffers[0];
  const total = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const buf of buffers) {
    out.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return out.buffer;
}

export interface BbtLeafEntry {
  bid: bigint; // normalized (LSB bit 0 cleared)
  rawBid: bigint;
  ib: number; // safe 53-bit file byte offset
  cb: number;
  isData: boolean;
}

export interface NbtLeafEntry {
  nid: number; // unsigned 32-bit value stored as safe integer
  bidData: bigint;
  bidSub: bigint;
  nidParent: number;
}

interface BtIntermediateEntry {
  btkey: bigint;
  bid: bigint;
  ib: number;
}

type ParsedBtreePage =
  | {
      kind: 'nbt-leaf';
      cLevel: 0;
      entries: NbtLeafEntry[];
    }
  | {
      kind: 'bbt-leaf';
      cLevel: 0;
      entries: BbtLeafEntry[];
    }
  | {
      kind: 'bt-internal';
      cLevel: number;
      entries: BtIntermediateEntry[];
    };

interface HeaderTrait {
  is64Bit: boolean;
  is4K: boolean;
  pageSize: number;
  cryptMethod: number;
  nbtRootIb: number;
  bbtRootIb: number;
  cEntOffset: number;
  cLevelOffset: number;
}

function parseHeaderTrait(view: DataView): HeaderTrait {
  // Check "!BDN"
  if (
    view.getUint8(0) !== 0x21 ||
    view.getUint8(1) !== 0x42 ||
    view.getUint8(2) !== 0x44 ||
    view.getUint8(3) !== 0x4e
  ) {
    throw new Error('Invalid PST/OST signature (expected "!BDN")');
  }

  const wVer = view.getUint16(10, true);
  if (wVer === 0x0e || wVer === 0x0f) {
    const cryptMethod = view.getUint8(0x1cd);
    if (cryptMethod === 0x02) {
      throw new Error('Encrypted PST/OST files (High Encryption) are not supported');
    }
    return {
      is64Bit: false,
      is4K: false,
      pageSize: 512,
      cryptMethod,
      nbtRootIb: view.getUint32(0xbc, true),
      bbtRootIb: view.getUint32(0xc4, true),
      cEntOffset: 0x1f0,
      cLevelOffset: 0x1f3,
    };
  }

  if (wVer === 0x15 || wVer === 0x16 || wVer === 0x17) {
    const cryptMethod = view.getUint8(0x201);
    if (cryptMethod === 0x02) {
      throw new Error('Encrypted PST/OST files (High Encryption) are not supported');
    }
    return {
      is64Bit: true,
      is4K: false,
      pageSize: 512,
      cryptMethod,
      nbtRootIb: toSafeNumber(readU64(view, 0xe0), 'nbtRootIb'),
      bbtRootIb: toSafeNumber(readU64(view, 0xf0), 'bbtRootIb'),
      cEntOffset: 0x1e8,
      cLevelOffset: 0x1eb,
    };
  }

  if (wVer === 0x24) {
    const cryptMethod = view.getUint8(0x201);
    if (cryptMethod === 0x02) {
      throw new Error('Encrypted PST/OST files (High Encryption) are not supported');
    }
    return {
      is64Bit: true,
      is4K: true,
      pageSize: 4096,
      cryptMethod,
      nbtRootIb: toSafeNumber(readU64(view, 0xe0), 'nbtRootIb'),
      bbtRootIb: toSafeNumber(readU64(view, 0xf0), 'bbtRootIb'),
      cEntOffset: 0xfd8,
      cLevelOffset: 0xfdd,
    };
  }

  throw new Error(`Unsupported PST/OST file version: ${wVer}`);
}

export interface HeapReader {
  readonly is4K: boolean;
  readonly bClientSig: number;
  readonly userRootHnid: number;
  getHeapBuffers(hnid: number): Promise<ArrayBuffer[]>;
  streamHeapBuffers(
    hnid: number,
    onBuffer: (buf: ArrayBuffer) => Promise<void> | void,
    isCancelled?: () => boolean,
  ): Promise<void>;
}

export interface RawTableColumn {
  type: number;
  key: number;
  ibData: number;
  cbData: number;
  iBit: number;
}

export class PstEngine {
  private readonly reader: PagedBlockReader;
  private readonly trait: HeaderTrait;
  private readonly pageCache = new Map<string, ParsedBtreePage>();
  private readonly resolver: PropertyValueResolver;
  private readonly defaultAnsiEncoding: string;

  private nameToIdNumeric = new Map<string, number>();
  private nameToIdString = new Map<string, number>();
  private folderChildrenMap: Map<number, number[]> | null = null;

  private constructor(
    reader: PagedBlockReader,
    trait: HeaderTrait,
    ansiEncoding = 'windows-1252',
  ) {
    this.reader = reader;
    this.trait = trait;
    this.defaultAnsiEncoding = ansiEncoding;
    this.resolver = this.createResolver();
  }

  static async open(reader: PagedBlockReader, ansiEncoding = 'windows-1252'): Promise<PstEngine> {
    const headerBuf = await reader.readExact(0, 1024);
    const headerView = new DataView(headerBuf);
    const trait = parseHeaderTrait(headerView);
    const engine = new PstEngine(reader, trait, ansiEncoding);
    await engine.loadNameToIdMap();
    return engine;
  }

  get is4K(): boolean {
    return this.trait.is4K;
  }

  get fileSize(): number {
    return this.reader.size;
  }

  getReaderStats() {
    return this.reader.getStats();
  }

  clearCaches(): void {
    this.pageCache.clear();
    this.folderChildrenMap = null;
    this.reader.clearCache();
  }

  async close(): Promise<void> {
    this.pageCache.clear();
    this.folderChildrenMap = null;
    await this.reader.close();
  }

  private async readBtreePage(ib: number, isNbt: boolean): Promise<ParsedBtreePage> {
    const cacheKey = `${isNbt ? 'N' : 'B'}:${ib}`;
    const cached = this.pageCache.get(cacheKey);
    if (cached !== undefined) {
      this.pageCache.delete(cacheKey);
      this.pageCache.set(cacheKey, cached);
      return cached;
    }

    let buf = await this.reader.readExact(ib, this.trait.pageSize);
    let view = new DataView(buf);
    if (this.trait.is4K && buf.byteLength >= 4 && view.getUint16(0, true) === 0x9c78) {
      buf = inflateZlib(buf);
      view = new DataView(buf);
    }
    const cEnt = this.trait.is4K
      ? view.getUint16(this.trait.cEntOffset, true)
      : view.getUint8(this.trait.cEntOffset);
    const cLevel = view.getUint8(this.trait.cLevelOffset);

    let parsed: ParsedBtreePage;

    if (cLevel === 0) {
      if (isNbt) {
        const entries: NbtLeafEntry[] = [];
        if (this.trait.is64Bit) {
          for (let i = 0; i < cEnt; i += 1) {
            const top = 32 * i;
            const nidRaw = readU64(view, top);
            const nid = Number(nidRaw & 0xffffffffn);
            if (nid === 0) break;
            entries.push({
              nid,
              bidData: readU64(view, top + 8),
              bidSub: readU64(view, top + 16),
              nidParent: view.getUint32(top + 24, true),
            });
          }
        } else {
          for (let i = 0; i < cEnt; i += 1) {
            const top = 16 * i;
            const nid = view.getUint32(top, true);
            if (nid === 0) break;
            entries.push({
              nid,
              bidData: BigInt(view.getUint32(top + 4, true)),
              bidSub: BigInt(view.getUint32(top + 8, true)),
              nidParent: view.getUint32(top + 12, true),
            });
          }
        }
        parsed = { kind: 'nbt-leaf', cLevel: 0, entries };
      } else {
        const entries: BbtLeafEntry[] = [];
        if (this.trait.is64Bit) {
          for (let i = 0; i < cEnt; i += 1) {
            const top = 24 * i;
            const rawBid = readU64(view, top);
            const bid = normalizeBid(rawBid);
            const entryIb = toSafeNumber(readU64(view, top + 8), 'BBTENTRY.ib');
            const cb = view.getUint16(top + 16, true);
            entries.push({
              bid,
              rawBid,
              ib: entryIb,
              cb,
              isData: isDataBid(rawBid),
            });
          }
        } else {
          for (let i = 0; i < cEnt; i += 1) {
            const top = 12 * i;
            const rawBid = BigInt(view.getUint32(top, true));
            const bid = normalizeBid(rawBid);
            const entryIb = view.getUint32(top + 4, true);
            const cb = view.getUint16(top + 8, true);
            entries.push({
              bid,
              rawBid,
              ib: entryIb,
              cb,
              isData: isDataBid(rawBid),
            });
          }
        }
        parsed = { kind: 'bbt-leaf', cLevel: 0, entries };
      }
    } else {
      const entries: BtIntermediateEntry[] = [];
      if (this.trait.is64Bit) {
        for (let i = 0; i < cEnt; i += 1) {
          const top = 24 * i;
          const rawKey = readU64(view, top);
          entries.push({
            btkey: isNbt ? (rawKey & 0xffffffffn) : normalizeBid(rawKey),
            bid: readU64(view, top + 8),
            ib: toSafeNumber(readU64(view, top + 16), 'BTENTRY.ib'),
          });
        }
      } else {
        for (let i = 0; i < cEnt; i += 1) {
          const top = 12 * i;
          const rawKey = BigInt(view.getUint32(top, true));
          entries.push({
            btkey: isNbt ? rawKey : normalizeBid(rawKey),
            bid: BigInt(view.getUint32(top + 4, true)),
            ib: view.getUint32(top + 8, true),
          });
        }
      }
      parsed = { kind: 'bt-internal', cLevel, entries };
    }

    if (this.pageCache.size >= MAX_BTREE_PAGE_CACHE) {
      const oldest = this.pageCache.keys().next().value;
      if (oldest !== undefined) {
        this.pageCache.delete(oldest);
      }
    }
    this.pageCache.set(cacheKey, parsed);
    return parsed;
  }

  /**
   * Binary-searches the Block B-Tree (BBT) directly on disk via the 64 KB paged LRU cache.
   * Safe for arbitrary 64-bit BIDs and file offsets past 40 GB+.
   */
  async lookupBlock(targetBid: bigint): Promise<BbtLeafEntry | undefined> {
    const normalized = normalizeBid(targetBid);
    if (normalized === 0n) return undefined;

    let currentIb = this.trait.bbtRootIb;
    if (currentIb === 0) return undefined;

    for (let depth = 0; depth < 16; depth += 1) {
      const page = await this.readBtreePage(currentIb, false);
      if (page.kind === 'bbt-leaf') {
        const list = page.entries;
        let lo = 0;
        let hi = list.length - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >>> 1;
          const val = list[mid].bid;
          if (val === normalized) return list[mid];
          if (val < normalized) lo = mid + 1;
          else hi = mid - 1;
        }
        return undefined;
      }
      if (page.kind !== 'bt-internal') return undefined;

      const list = page.entries;
      if (list.length === 0) return undefined;
      // Find largest index where entries[i].btkey <= normalized
      let lo = 0;
      let hi = list.length - 1;
      let match = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (list[mid].btkey <= normalized) {
          match = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (match === -1) return undefined;
      currentIb = list[match].ib;
    }

    return undefined;
  }

  /**
   * Binary-searches the Node B-Tree (NBT) on disk without loading all file nodes into memory.
   */
  async lookupNode(targetNid: number): Promise<NbtLeafEntry | undefined> {
    const targetKey = toUnsignedNid(targetNid);
    if (targetKey === 0n) return undefined;

    let currentIb = this.trait.nbtRootIb;
    if (currentIb === 0) return undefined;

    for (let depth = 0; depth < 16; depth += 1) {
      const page = await this.readBtreePage(currentIb, true);
      if (page.kind === 'nbt-leaf') {
        const list = page.entries;
        let lo = 0;
        let hi = list.length - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >>> 1;
          const val = toUnsignedNid(list[mid].nid);
          if (val === targetKey) return list[mid];
          if (val < targetKey) lo = mid + 1;
          else hi = mid - 1;
        }
        return undefined;
      }
      if (page.kind !== 'bt-internal') return undefined;

      const list = page.entries;
      if (list.length === 0) return undefined;
      let lo = 0;
      let hi = list.length - 1;
      let match = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (list[mid].btkey <= targetKey) {
          match = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (match === -1) return undefined;
      currentIb = list[match].ib;
    }

    return undefined;
  }

  /**
   * Streaming NBT leaf scan fallback for folders whose Hierarchy/Contents table is corrupt or absent.
   */
  async scanChildNidsByParent(
    parentNid: number,
    nidTypeFilter?: number,
  ): Promise<NbtLeafEntry[]> {
    const results: NbtLeafEntry[] = [];
    const targetParent = toUnsignedNid(parentNid);

    const walk = async (ib: number): Promise<void> => {
      if (ib === 0) return;
      const page = await this.readBtreePage(ib, true);
      if (page.kind === 'nbt-leaf') {
        for (const entry of page.entries) {
          if (
            toUnsignedNid(entry.nidParent) === targetParent &&
            entry.nid !== parentNid &&
            (nidTypeFilter === undefined || getNidType(entry.nid) === nidTypeFilter)
          ) {
            results.push(entry);
          }
        }
      } else if (page.kind === 'bt-internal') {
        for (const child of page.entries) {
          await walk(child.ib);
        }
      }
    };

    await walk(this.trait.nbtRootIb);
    return results;
  }

  /**
   * Resolves the root IPM subtree folder NID from the Message Store (`NID = 33`)
   * property `PidTagIpmSubTreeEntryId` (`0x35e0`) or standard `32802` node.
   */
  async readIpmSubTreeNid(): Promise<number | null> {
    const storeEntry = await this.lookupNode(NID_MESSAGE_STORE);
    if (storeEntry) {
      const storeSub = this.createSubNodeHandle(
        storeEntry.nid,
        storeEntry.bidData,
        storeEntry.bidSub,
        'MessageStore',
      );
      const props = await this.readProperties(storeSub, new Set([0x35e0]));
      const entryId = props.find((p) => p.key === 0x35e0)?.value;
      if (entryId instanceof ArrayBuffer && entryId.byteLength >= 24) {
        const candidateNid = new DataView(entryId).getUint32(entryId.byteLength - 4, true);
        if (candidateNid !== 0 && (await this.lookupNode(candidateNid))) {
          return candidateNid;
        }
      }
    }
    if (await this.lookupNode(NID_TOP_OF_OUTLOOK_DATA_FILE)) {
      return NID_TOP_OF_OUTLOOK_DATA_FILE;
    }
    return null;
  }

  /**
   * One-time cached folder-only NBT scan fallback for archives missing Hierarchy Tables.
   * Retains ONLY folder NIDs (`0x02`/`0x03`) keyed by `nidParent` so message NIDs never accumulate in RAM.
   */
  async getFallbackChildFolderNids(parentNid: number): Promise<number[]> {
    if (!this.folderChildrenMap) {
      const map = new Map<number, number[]>();
      const walkNbtFolders = async (ib: number): Promise<void> => {
        if (ib === 0) return;
        const page = await this.readBtreePage(ib, true);
        if (page.kind === 'nbt-leaf') {
          for (const entry of page.entries) {
            const nidType = getNidType(entry.nid);
            if (nidType === NID_TYPE_NORMAL_FOLDER || nidType === NID_TYPE_SEARCH_FOLDER) {
              if (entry.nid === entry.nidParent) continue;
              const bucket = map.get(entry.nidParent);
              if (bucket) {
                bucket.push(entry.nid);
              } else {
                map.set(entry.nidParent, [entry.nid]);
              }
            }
          }
        } else if (page.kind === 'bt-internal') {
          for (let i = 0; i < page.entries.length; i += 8) {
            const chunk = page.entries.slice(i, i + 8);
            await Promise.all(chunk.map((child) => walkNbtFolders(child.ib)));
          }
        }
      };
      await walkNbtFolders(this.trait.nbtRootIb);
      this.folderChildrenMap = map;
    }
    return this.folderChildrenMap.get(parentNid) ?? [];
  }

  private async readBlockPayload(entry: BbtLeafEntry, decrypt: boolean): Promise<ArrayBuffer> {
    if (entry.cb === 0) return new ArrayBuffer(0);
    const buf = await this.reader.readExact(entry.ib, entry.cb);
    if (decrypt && entry.isData && this.trait.cryptMethod === 1) {
      decodeCompressible(buf);
    }
    if (this.trait.is4K && buf.byteLength >= 4) {
      const view = new DataView(buf);
      if (view.getUint16(0, true) === 0x9c78) {
        return inflateZlib(buf);
      }
    }
    return buf;
  }

  async streamDataBuffers(
    bid: bigint,
    onBuffer: (buf: ArrayBuffer) => Promise<void> | void,
    isCancelled?: () => boolean,
  ): Promise<void> {
    const visited = new Set<bigint>();

    const walk = async (targetBid: bigint): Promise<void> => {
      if (isCancelled?.()) return;
      const norm = normalizeBid(targetBid);
      if (norm === 0n || visited.has(norm)) return;
      visited.add(norm);

      const entry = await this.lookupBlock(norm);
      if (!entry) return;

      if (entry.isData) {
        await onBuffer(await this.readBlockPayload(entry, true));
        return;
      }

      const buf = await this.readBlockPayload(entry, false);
      const view = new DataView(buf);
      if (buf.byteLength < 8 || view.getUint8(0) !== 1) return;

      const level = view.getUint8(1);
      const itemCount = view.getUint16(2, true);
      if (level !== 1 && level !== 2) return;

      const stride = this.trait.is64Bit ? 8 : 4;
      for (let i = 0; i < itemCount; i += 1) {
        if (isCancelled?.()) return;
        const pos = 8 + stride * i;
        if (pos + stride > buf.byteLength) break;
        const childBid = this.trait.is64Bit
          ? readU64(view, pos)
          : BigInt(view.getUint32(pos, true));
        await walk(childBid);
      }
    };

    await walk(bid);
  }

  async readDataBuffers(bid: bigint): Promise<ArrayBuffer[]> {
    const out: ArrayBuffer[] = [];
    await this.streamDataBuffers(bid, (buf) => {
      out.push(buf);
    });
    return out;
  }

  private async findSubNodeEntry(
    bidSub: bigint,
    targetNid: number,
  ): Promise<{ bidData: bigint; bidSub: bigint } | undefined> {
    const norm = normalizeBid(bidSub);
    if (norm === 0n) return undefined;

    const targetKey = toUnsignedNid(targetNid);
    const entry = await this.lookupBlock(norm);
    if (!entry) return undefined;

    const buf = await this.readBlockPayload(entry, false);
    const view = new DataView(buf);
    if (buf.byteLength < 4 || view.getUint8(0) !== 2) return undefined;

    const level = view.getUint8(1);
    const count = view.getUint16(2, true);
    const headerBytes = this.trait.is64Bit ? 8 : 4;

    if (level === 0) {
      // SLBLOCK (small per-node subnode block, linear scan safe even if unsorted)
      const stride = this.trait.is64Bit ? 24 : 12;
      for (let i = 0; i < count; i += 1) {
        const pos = headerBytes + stride * i;
        if (pos + stride > buf.byteLength) break;
        const nid = BigInt(view.getUint32(pos, true));
        if (nid === targetKey) {
          return this.trait.is64Bit
            ? { bidData: readU64(view, pos + 8), bidSub: readU64(view, pos + 16) }
            : {
                bidData: BigInt(view.getUint32(pos + 4, true)),
                bidSub: BigInt(view.getUint32(pos + 8, true)),
              };
        }
      }
      return undefined;
    }

    // SIBLOCK (16B entries in 64-bit, 8B in 32-bit)
    const stride = this.trait.is64Bit ? 16 : 8;
    let lo = 0;
    let hi = count - 1;
    let matchPos = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const pos = headerBytes + stride * mid;
      if (pos + stride > buf.byteLength) break;
      const nid = BigInt(view.getUint32(pos, true));
      if (nid <= targetKey) {
        matchPos = pos;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (matchPos === -1) return undefined;
    const childBid = this.trait.is64Bit
      ? readU64(view, matchPos + 8)
      : BigInt(view.getUint32(matchPos + 4, true));
    return await this.findSubNodeEntry(childBid, targetNid);
  }

  createSubNodeHandle(
    nodeId: number,
    bidData: bigint,
    bidSub: bigint,
    label?: string,
  ): PLSubNode & {
    streamData?: (
      onBuffer: (buf: ArrayBuffer) => Promise<void> | void,
      isCancelled?: () => boolean,
    ) => Promise<void>;
  } {
    const selfEngine = this;
    const is4K = this.trait.is4K;
    return {
      nodeId,
      is4K,
      async getChildBy(childNodeId: number): Promise<PLSubNode | undefined> {
        const child = await selfEngine.findSubNodeEntry(bidSub, childNodeId);
        if (!child) return undefined;
        return selfEngine.createSubNodeHandle(
          childNodeId,
          child.bidData,
          child.bidSub,
          `${label ?? nodeId}->0x${childNodeId.toString(16)}`,
        );
      },
      async getData(): Promise<ArrayBuffer[]> {
        return await selfEngine.readDataBuffers(bidData);
      },
      async streamData(
        onBuffer: (buf: ArrayBuffer) => Promise<void> | void,
        isCancelled?: () => boolean,
      ): Promise<void> {
        await selfEngine.streamDataBuffers(bidData, onBuffer, isCancelled);
      },
      toString(): string {
        return label ?? `subNode(${nodeId})`;
      },
    } as PLSubNode & {
      streamData?: (
        onBuffer: (buf: ArrayBuffer) => Promise<void> | void,
        isCancelled?: () => boolean,
      ) => Promise<void>;
    };
  }

  createPLNode(entry: NbtLeafEntry): PLNode {
    const selfEngine = this;
    const plNode: PLNode = {
      nodeId: entry.nid,
      getParent(): PLNode | undefined {
        return undefined;
      },
      getChildren(): PLNode[] {
        return [];
      },
      getSubNode(): PLSubNode {
        return selfEngine.createSubNodeHandle(
          entry.nid,
          entry.bidData,
          entry.bidSub,
          `node(${entry.nid})`,
        );
      },
      getSiblingNode(): PLNode | undefined {
        return undefined;
      },
    };
    return plNode;
  }

  async openHeap(subNode: PLSubNode): Promise<HeapReader | undefined> {
    const dataArray = await subNode.getData();
    if (dataArray.length === 0) return undefined;

    const chunks = new Map<number, ArrayBuffer>();
    let bClientSig = 0;
    let userRootHnid = 0;
    const pageMul = this.trait.is4K ? 524288 : 65536;

    for (let pageIdx = 0; pageIdx < dataArray.length; pageIdx += 1) {
      const page = dataArray[pageIdx];
      if (page.byteLength < 8) continue;
      const view = new DataView(page);
      const pageMapOffset = view.getUint16(0, true);
      if (pageIdx === 0) {
        const sig = view.getUint8(2);
        if (sig !== 0xec) {
          throw new Error(`Invalid HNHDR signature 0x${sig.toString(16)}`);
        }
        bClientSig = view.getUint8(3);
        userRootHnid = view.getUint32(4, true);
      }
      if (pageMapOffset + 4 > page.byteLength) continue;
      const cAlloc = view.getUint16(pageMapOffset, true);
      for (let x = 0; x < cAlloc; x += 1) {
        const offPos = pageMapOffset + 4 + 2 * x;
        if (offPos + 4 > page.byteLength) break;
        const from = view.getUint16(offPos, true);
        const to = view.getUint16(offPos + 2, true);
        if (to >= from && to <= page.byteLength) {
          const hid = 0x20 * (1 + x) + pageMul * pageIdx;
          chunks.set(hid, page.slice(from, to));
        }
      }
    }

    const is4K = this.trait.is4K;
    return {
      is4K,
      bClientSig,
      userRootHnid,
      async getHeapBuffers(hnid: number): Promise<ArrayBuffer[]> {
        if (hnid === 0) return [];
        if ((hnid & 0x1f) !== 0) {
          const child = await subNode.getChildBy(hnid);
          if (!child) return [];
          return await child.getData();
        }
        const chunk = chunks.get(hnid);
        return chunk ? [chunk] : [];
      },
      async streamHeapBuffers(
        hnid: number,
        onBuffer: (buf: ArrayBuffer) => Promise<void> | void,
        isCancelled?: () => boolean,
      ): Promise<void> {
        if (hnid === 0) return;
        if ((hnid & 0x1f) !== 0) {
          const child = (await subNode.getChildBy(hnid)) as
            | (PLSubNode & {
                streamData?: (
                  cb: (buf: ArrayBuffer) => Promise<void> | void,
                  cancelled?: () => boolean,
                ) => Promise<void>;
              })
            | undefined;
          if (!child) return;
          if (child.streamData) {
            await child.streamData(onBuffer, isCancelled);
          } else {
            for (const buf of await child.getData()) {
              if (isCancelled?.()) return;
              await onBuffer(buf);
            }
          }
          return;
        }
        const chunk = chunks.get(hnid);
        if (chunk && !isCancelled?.()) {
          await onBuffer(chunk);
        }
      },
    };
  }

  private async readBthRecords(
    heap: HeapReader,
    hnid: number,
  ): Promise<Array<{ key: ArrayBuffer; data: ArrayBuffer }>> {
    if (hnid === 0) return [];
    const headerBufs = await heap.getHeapBuffers(hnid);
    if (headerBufs.length !== 1 || headerBufs[0].byteLength < 8) return [];

    const headerView = new DataView(headerBufs[0]);
    if (headerView.getUint8(0) !== 0xb5) return [];

    const cbKey = headerView.getUint8(1);
    const cbEnt = headerView.getUint8(2);
    const bIdxLevels = headerView.getUint8(3);
    const hidRoot = headerView.getUint32(4, true);
    const out: Array<{ key: ArrayBuffer; data: ArrayBuffer }> = [];

    const walk = async (hid: number, level: number): Promise<void> => {
      if (hid === 0) return;
      const bufs = await heap.getHeapBuffers(hid);
      if (bufs.length !== 1) return;
      const record = bufs[0];
      if (level === 0) {
        const recSize = cbKey + cbEnt;
        const count = Math.floor(record.byteLength / recSize);
        for (let i = 0; i < count; i += 1) {
          const top = recSize * i;
          out.push({
            key: record.slice(top, top + cbKey),
            data: record.slice(top + cbKey, top + recSize),
          });
        }
      } else {
        const recSize = cbKey + 4;
        const view = new DataView(record);
        const count = Math.floor(record.byteLength / recSize);
        for (let i = 0; i < count; i += 1) {
          const top = recSize * i;
          const childHid = view.getUint32(top + cbKey, true);
          await walk(childHid, level - 1);
        }
      }
    };

    await walk(hidRoot, bIdxLevels);
    return out;
  }

  /**
   * Reads properties from a Property Context (`bTypePC = 0xBC`) and ONLY resolves keys
   * in `allowedKeys` (if provided). Prevents decoding `PR_BODY`, `PR_BODY_HTML`, or binary
   * payloads during folder scans and metadata-only searches.
   */
  async readProperties(
    subNode: PLSubNode,
    allowedKeys: Set<number> | null,
  ): Promise<Property[]> {
    const heap = await this.openHeap(subNode);
    if (!heap || heap.bClientSig !== 0xbc) return [];

    const records = await this.readBthRecords(heap, heap.userRootHnid);
    let cp3fde: number | undefined;
    let cp3ffd: number | undefined;
    let cp66c3: number | undefined;
    for (const rec of records) {
      if (rec.key.byteLength < 2 || rec.data.byteLength < 6) continue;
      const key = new DataView(rec.key).getUint16(0, true);
      if (key !== 0x3fde && key !== 0x3ffd && key !== 0x66c3) continue;
      const dv = new DataView(rec.data);
      if (dv.getUint16(0, true) !== 0x0003) continue;
      const val = dv.getInt32(2, true);
      if (val > 0) {
        if (key === 0x3fde) cp3fde = val;
        else if (key === 0x3ffd) cp3ffd = val;
        else cp66c3 = val;
      }
    }
    const codepage = cp3fde ?? cp3ffd ?? cp66c3;
    const activeResolver = codepage !== undefined ? this.createResolver(codepage) : this.resolver;

    const props: Property[] = [];

    for (const rec of records) {
      if (rec.key.byteLength < 2 || rec.data.byteLength < 2) continue;
      const key = new DataView(rec.key).getUint16(0, true);
      if (allowedKeys !== null && !allowedKeys.has(key)) continue;

      const type = new DataView(rec.data).getUint16(0, true);
      const rawVal = rec.data.slice(2);
      try {
        const value = await activeResolver.resolveValueOf(key, type, rawVal, heap);
        props.push({ key, type, value });
      } catch {
        // Skip unreadable individual property so corrupt property doesn't abort message
      }
    }

    return props;
  }

  /**
   * Streams Table Context (`bTypeTC = 0x7C`) rows block-by-block in batches, resolving only
   * `wantedColumns` (plus `0x67f2` `ltpRowId` when present) and passing `schemaKeys` directly
   * into `onBatch` to avoid outer-scope TDZ bugs.
   */
  async streamTableRows(
    subNode: PLSubNode,
    wantedColumns: Set<number> | null,
    batchSize: number,
    onBatch: (
      rows: Map<number, unknown>[],
      processed: number,
      total: number,
      schemaKeys: ReadonlySet<number>,
    ) => Promise<void> | void,
    isCancelled?: () => boolean,
  ): Promise<{ total: number; schemaKeys: Set<number> }> {
    const heap = await this.openHeap(subNode);
    if (!heap || heap.bClientSig !== 0x7c) {
      return { total: 0, schemaKeys: new Set() };
    }

    const headerBufs = await heap.getHeapBuffers(heap.userRootHnid);
    if (headerBufs.length !== 1 || headerBufs[0].byteLength < 22) {
      return { total: 0, schemaKeys: new Set() };
    }

    const hv = new DataView(headerBufs[0]);
    if (hv.getUint8(0) !== 0x7c) return { total: 0, schemaKeys: new Set() };

    const numCols = hv.getUint8(1);
    const cebOffset = hv.getUint16(6, true);
    const numRowBytes = hv.getUint16(8, true);
    const hnidRows = hv.getUint32(14, true);

    if (numRowBytes === 0 || headerBufs[0].byteLength < 22 + numCols * 8) {
      return { total: 0, schemaKeys: new Set() };
    }

    const schema: RawTableColumn[] = [];
    const schemaKeys = new Set<number>();
    for (let c = 0; c < numCols; c += 1) {
      const off = 22 + c * 8;
      const col: RawTableColumn = {
        type: hv.getUint16(off, true),
        key: hv.getUint16(off + 2, true),
        ibData: hv.getUint16(off + 4, true),
        cbData: hv.getUint8(off + 6),
        iBit: hv.getUint8(off + 7),
      };
      schema.push(col);
      schemaKeys.add(col.key);
    }

    const filteredCols =
      wantedColumns === null
        ? schema
        : schema.filter(
            (col) =>
              col.key === 0x67f2 ||
              col.key === 0x3fde ||
              col.key === 0x3ffd ||
              wantedColumns.has(col.key),
          );
    const activeCols = filteredCols.toSorted((a, b) => {
      const rank = (col: RawTableColumn): number => {
        if (col.type === 0x0003) return 0;
        if (col.type === 0x001e || col.type === 0x101e) return 2;
        return 1;
      };
      return rank(a) - rank(b);
    });
    const resolverByCodepage = new Map<number, PropertyValueResolver>();

    let processed = 0;
    let firstBatchEmitted = false;
    let currentBatch: Map<number, unknown>[] = [];
    const firstLimit = Math.min(100, batchSize);

    if (hnidRows !== 0) {
      await heap.streamHeapBuffers(
        hnidRows,
        async (page) => {
          const rowsInPage = Math.floor(page.byteLength / numRowBytes);
          for (let rIdx = 0; rIdx < rowsInPage; rIdx += 1) {
            if (isCancelled?.()) return;

            const rowStart = rIdx * numRowBytes;
            const rowEnd = rowStart + numRowBytes;
            if (rowEnd > page.byteLength) break;

            const rowSlice = page.slice(rowStart, rowEnd);
            const rgCEB = new Uint8Array(rowSlice, cebOffset);
            const rowMap = new Map<number, unknown>();

            for (const col of activeCols) {
              const bytePos = Math.floor(col.iBit / 8);
              const bitMask = 1 << (7 - (col.iBit % 8));
              const exists = bytePos < rgCEB.byteLength && (rgCEB[bytePos] & bitMask) !== 0;
              if (!exists) continue;
              if (col.ibData + col.cbData > rowSlice.byteLength) continue;

              const rawVal = rowSlice.slice(col.ibData, col.ibData + col.cbData);
              try {
                let colResolver = this.resolver;
                if (col.type === 0x001e || col.type === 0x101e) {
                  const cpVal = rowMap.get(0x3fde) ?? rowMap.get(0x3ffd);
                  if (typeof cpVal === 'number' && cpVal > 0) {
                    let cached = resolverByCodepage.get(cpVal);
                    if (!cached) {
                      cached = this.createResolver(cpVal);
                      resolverByCodepage.set(cpVal, cached);
                    }
                    colResolver = cached;
                  }
                }
                const val = await colResolver.resolveValueOf(col.key, col.type, rawVal, heap);
                if (val !== undefined) {
                  rowMap.set(col.key, val);
                }
              } catch {
                // Skip unreadable column value
              }
            }

            currentBatch.push(rowMap);
            processed += 1;

            const targetSize = firstBatchEmitted ? batchSize : firstLimit;
            if (currentBatch.length >= targetSize) {
              firstBatchEmitted = true;
              const flush = currentBatch;
              currentBatch = [];
              await onBatch(flush, processed, 0, schemaKeys);
            }
          }
        },
        isCancelled,
      );
    }

    if (currentBatch.length > 0 && !isCancelled?.()) {
      await onBatch(currentBatch, processed, processed, schemaKeys);
    }

    return { total: processed, schemaKeys };
  }

  private async loadNameToIdMap(): Promise<void> {
    const entry = await this.lookupNode(NID_NAME_TO_ID_MAP);
    if (!entry) return;
    const subNode = this.createSubNodeHandle(entry.nid, entry.bidData, entry.bidSub, 'NameToIDMap');
    const props = await this.readProperties(subNode, new Set([2, 3, 4]));

    const guidBuf = props.find((p) => p.key === 2)?.value;
    const mapBuf = props.find((p) => p.key === 3)?.value;
    const strBuf = props.find((p) => p.key === 4)?.value;

    if (!(guidBuf instanceof ArrayBuffer) || !(mapBuf instanceof ArrayBuffer)) {
      return;
    }

    const guidBytes = new Uint8Array(guidBuf);
    const nGuids = Math.trunc(guidBytes.byteLength / 16);
    const guidIndexes: number[] = [];
    for (let i = 0; i < nGuids; i += 1) {
      const uuid = stringifyMsftUuid(guidBytes, i * 16).toUpperCase();
      guidIndexes.push(GUID_MAP.get(uuid) ?? -1);
    }

    const mapView = new DataView(mapBuf);
    const strView = strBuf instanceof ArrayBuffer ? new DataView(strBuf) : null;
    const strBytes = strBuf instanceof ArrayBuffer ? new Uint8Array(strBuf) : null;

    for (let x = 0; x + 8 <= mapBuf.byteLength; x += 8) {
      const key = mapView.getUint32(x, true);
      if (key === 0x55555555) break;
      const rawGuid = mapView.getUint16(x + 4, true);
      const propId = mapView.getUint16(x + 6, true) + 0x8000;

      if ((rawGuid & 1) === 0) {
        const g = rawGuid >> 1;
        let guidIdx = -1;
        if (g === 1) guidIdx = 12;
        else if (g === 2) guidIdx = 0;
        else if (g >= 3) guidIdx = guidIndexes[g - 3] ?? -1;
        this.nameToIdNumeric.set(`${key}:${guidIdx}`, propId);
      } else if (strView && strBytes && key + 4 <= strBytes.byteLength) {
        const len = strView.getUint32(key, true);
        if (key + 4 + len <= strBytes.byteLength) {
          const nameBytes = strBytes.subarray(key + 4, key + 4 + len);
          const name = utf16Decoder.decode(nameBytes).replace(/\0/g, '');
          this.nameToIdString.set(name, propId);
        }
      }
    }
  }

  async openMessageByNid(msgNid: number): Promise<PSTMessage | null> {
    const entry = await this.lookupNode(msgNid);
    if (!entry) return null;
    const plNode = this.createPLNode(entry);
    const plSubNode = plNode.getSubNode();
    return await this.createPSTMessageFromSubNode(plNode, plSubNode);
  }

  private async createPSTMessageFromSubNode(
    plNode: PLNode,
    plSubNode: PLSubNode,
  ): Promise<PSTMessage> {
    const props = await this.readProperties(plSubNode, null);
    const propByKey = new Map<number, Property>();
    for (const p of props) {
      propByKey.set(p.key, p);
    }

    const cpVal =
      propByKey.get(0x3fde)?.value ??
      propByKey.get(0x3ffd)?.value ??
      propByKey.get(0x66c3)?.value;
    const codepageHint = typeof cpVal === 'number' && cpVal > 0 ? cpVal : undefined;

    const propertyFinder = {
      findByKey: (key: number) => propByKey.get(key),
      all: () => props,
    };

    const rootProvider = this.createRootProvider(codepageHint);
    return new PSTMessage(rootProvider, plNode, plSubNode, propertyFinder);
  }

  createRootProvider(codepageHint?: number): RootProvider {
    const engine = this;
    const activeResolver =
      codepageHint !== undefined ? this.createResolver(codepageHint) : this.resolver;
    const encodingHint = codepageHint ?? this.defaultAnsiEncoding;
    return {
      resolver: activeResolver,
      getNameToIdMapItem(key: number, idx: number): number {
        return engine.nameToIdNumeric.get(`${key}:${idx}`) ?? 0;
      },
      getStringToIdMapItem(key: string): number {
        return engine.nameToIdString.get(key) ?? 0;
      },
      async getItemOf(node: PLNode, subNode: PLSubNode): Promise<PSTMessage> {
        return await engine.createPSTMessageFromSubNode(node, subNode);
      },
      async getFolderOf(): Promise<never> {
        throw new Error('Folder traversal uses streaming engine');
      },
      convertAnsiStringImmediately: (data: Uint8Array) =>
        decodeSmartTextBytes(data, encodingHint),
    };
  }

  private createResolver(codepageHint?: number): PropertyValueResolver {
    const encodingHint: number | string = codepageHint ?? this.defaultAnsiEncoding;

    return {
      async resolveValueOf(
        _key: number,
        type: number,
        value: ArrayBuffer,
        heap,
      ): Promise<unknown> {
        const view = new DataView(value);
        const resolveHeap = async (hnid: number): Promise<ArrayBuffer> => {
          return concatArrayBuffers(await heap.getHeapBuffers(hnid));
        };
        const getBytes = async (numBytes: number): Promise<ArrayBuffer | undefined> => {
          if (value.byteLength === 4 && value.byteLength < numBytes) {
            return await resolveHeap(view.getUint32(0, true));
          }
          if (value.byteLength !== 4 && numBytes <= value.byteLength) {
            return value.slice(0, numBytes);
          }
          return undefined;
        };

        switch (type) {
          case 0x0002: // PT_SHORT
            return view.byteLength >= 2 ? view.getInt16(0, true) : 0;
          case 0x0003: // PT_LONG
            return view.byteLength >= 4 ? view.getInt32(0, true) : 0;
          case 0x0004: // PT_FLOAT
            return view.byteLength >= 4 ? view.getFloat32(0, true) : 0;
          case 0x0005: {
            // PT_DOUBLE
            const b = await getBytes(8);
            return b && b.byteLength >= 8 ? new DataView(b).getFloat64(0, true) : undefined;
          }
          case 0x000b: // PT_BOOLEAN
            return view.byteLength >= 1 ? view.getUint8(0) !== 0 : false;
          case 0x000d: {
            // PT_OBJECT
            if (value.byteLength < 4) return undefined;
            const b = await resolveHeap(view.getUint32(0, true));
            if (b.byteLength < 8) return undefined;
            const dv = new DataView(b);
            return new PropertyTypeObject(dv.getUint32(0, true), dv.getUint32(4, true));
          }
          case 0x0014: {
            // PT_LONGLONG
            const b = await getBytes(8);
            if (!b || b.byteLength < 8) return undefined;
            const big = new DataView(b).getBigUint64(0, true);
            return big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big.toString();
          }
          case 0x001e: {
            // PT_STRING8
            if (value.byteLength < 4) return '';
            const b = await resolveHeap(view.getUint32(0, true));
            return decodeSmartTextBytes(new Uint8Array(b), encodingHint);
          }
          case 0x001f: {
            // PT_UNICODE
            if (value.byteLength < 4) return '';
            const b = await resolveHeap(view.getUint32(0, true));
            return utf16Decoder.decode(new Uint8Array(b)).replace(/\0/g, '');
          }
          case 0x0040: {
            // PT_SYSTIME
            const b = await getBytes(8);
            if (!b || b.byteLength < 8) return null;
            return filetimeToDate(new DataView(b), 0);
          }
          case 0x0048: // PT_CLSID
          case 0x0102: {
            // PT_BINARY
            if (value.byteLength < 4) return new ArrayBuffer(0);
            return await resolveHeap(view.getUint32(0, true));
          }
          case 0x1002: {
            // PT_MV_SHORT
            const hnid = view.getUint32(0, true);
            if (hnid === 0) return [];
            const b = await resolveHeap(hnid);
            const dv = new DataView(b);
            const out: number[] = [];
            for (let i = 0; i + 2 <= b.byteLength; i += 2) out.push(dv.getInt16(i, true));
            return out;
          }
          case 0x1003: {
            // PT_MV_LONG
            const hnid = view.getUint32(0, true);
            if (hnid === 0) return [];
            const b = await resolveHeap(hnid);
            const dv = new DataView(b);
            const out: number[] = [];
            for (let i = 0; i + 4 <= b.byteLength; i += 4) out.push(dv.getInt32(i, true));
            return out;
          }
          case 0x101e: {
            // PT_MV_STRING8
            const hnid = view.getUint32(0, true);
            if (hnid === 0) return [];
            const b = await resolveHeap(hnid);
            const dv = new DataView(b);
            const count = b.byteLength >= 4 ? dv.getUint32(0, true) : 0;
            const out: string[] = [];
            for (let x = 0; x < count - 1; x += 1) {
              const from = Math.min(dv.getUint32(4 + 4 * x, true), b.byteLength);
              const to = Math.max(from, Math.min(dv.getUint32(4 + 4 * (x + 1), true), b.byteLength));
              out.push(decodeSmartTextBytes(new Uint8Array(b, from, to - from), encodingHint));
            }
            return out;
          }
          case 0x101f: {
            // PT_MV_UNICODE
            const hnid = view.getUint32(0, true);
            if (hnid === 0) return [];
            const b = await resolveHeap(hnid);
            const dv = new DataView(b);
            const count = b.byteLength >= 4 ? dv.getUint32(0, true) : 0;
            const out: string[] = [];
            for (let x = 0; x < count - 1; x += 1) {
              const from = dv.getUint32(4 + 4 * x, true);
              const to = dv.getUint32(4 + 4 * (x + 1), true);
              out.push(utf16Decoder.decode(new Uint8Array(b.slice(from, to))).replace(/\0/g, ''));
            }
            return out;
          }
          case 0x1102: // PT_MV_BINARY
          case 0x2102: {
            const hnid = view.getUint32(0, true);
            if (hnid === 0) return [];
            const b = await resolveHeap(hnid);
            const dv = new DataView(b);
            const count = b.byteLength >= 4 ? dv.getUint32(0, true) : 0;
            const out: ArrayBuffer[] = [];
            for (let x = 0; x < count - 1; x += 1) {
              const from = dv.getUint32(4 + 4 * x, true);
              const to = dv.getUint32(4 + 4 * (x + 1), true);
              out.push(b.slice(from, to));
            }
            return out;
          }
          case 0x1048: {
            // PT_MV_CLSID
            const hnid = view.getUint32(0, true);
            if (hnid === 0) return [];
            const b = await resolveHeap(hnid);
            const out: ArrayBuffer[] = [];
            for (let i = 0; i + 16 <= b.byteLength; i += 16) out.push(b.slice(i, i + 16));
            return out;
          }
          default:
            return undefined;
        }
      },
    };
  }
}

function stringifyMsftUuid(bytes: Uint8Array, offset: number): string {
  const hex = (start: number, len: number, reverse = false): string => {
    const slice = bytes.subarray(offset + start, offset + start + len);
    const ordered = reverse ? Array.from(slice).reverse() : Array.from(slice);
    return ordered.map((b) => b.toString(16).padStart(2, '0')).join('');
  };
  return `${hex(0, 4, true)}-${hex(4, 2, true)}-${hex(6, 2, true)}-${hex(8, 2)}-${hex(10, 6)}`;
}

export { Consts };
