import type { ReadFileApi } from '@hiraokahypertools/pst-extractor';

export const PST_BLOCK_SIZE = 65536; // 64 KB aligned pages
export const PST_MAX_CACHED_BLOCKS = 2048; // ~128 MB bounded LRU cache

export interface PstBlockReaderOptions {
  blockSize?: number;
  maxCachedBlocks?: number;
}

export interface PstBlockReaderStats {
  hits: number;
  misses: number;
  cachedBlocks: number;
  bytesReadTotal: number;
  blockSize: number;
  maxCachedBlocks: number;
}

export interface PagedBlockReader extends ReadFileApi {
  readonly size: number;
  readExact(position: number, length: number): Promise<ArrayBuffer>;
  clearCache(): void;
  getStats(): PstBlockReaderStats;
}

/**
 * Implements `@hiraokahypertools/pst-extractor`'s `ReadFileApi` strictly via paged
 * 64 KB `File.slice()` reads and a bounded 2,048-block (~128 MB) LRU cache.
 * Uses pure IEEE-754 53-bit integer math (never 32-bit bitwise operators) so files
 * larger than 2 GB / 40 GB+ are addressed accurately without overflowing.
 */
export function createPstBlockReader(
  file: Blob,
  options: PstBlockReaderOptions = {},
): PagedBlockReader {
  const blockSize = options.blockSize ?? PST_BLOCK_SIZE;
  const maxCachedBlocks = options.maxCachedBlocks ?? PST_MAX_CACHED_BLOCKS;
  const fileSize = file.size;

  const cache = new Map<number, Uint8Array>();
  const inflight = new Map<number, Promise<Uint8Array>>();
  let closed = false;
  let hits = 0;
  let misses = 0;
  let bytesReadTotal = 0;

  async function getBlock(blockIndex: number): Promise<Uint8Array> {
    if (closed) {
      throw new Error('PST file reader is closed');
    }

    const cached = cache.get(blockIndex);
    if (cached !== undefined) {
      hits += 1;
      cache.delete(blockIndex);
      cache.set(blockIndex, cached);
      return cached;
    }

    const existingFlight = inflight.get(blockIndex);
    if (existingFlight !== undefined) {
      return existingFlight;
    }

    misses += 1;
    const start = blockIndex * blockSize;
    const end = Math.min(start + blockSize, fileSize);

    const loadPromise = (async () => {
      if (start < 0 || start >= fileSize) {
        return new Uint8Array(0);
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
        throw new RangeError(`File byte offset exceeds MAX_SAFE_INTEGER: ${start}..${end}`);
      }
      const sliceBuffer = await file.slice(start, end).arrayBuffer();
      const bytes = new Uint8Array(sliceBuffer);
      bytesReadTotal += bytes.byteLength;

      if (!closed) {
        if (cache.size >= maxCachedBlocks) {
          const oldestKey = cache.keys().next().value;
          if (oldestKey !== undefined) {
            cache.delete(oldestKey);
          }
        }
        cache.set(blockIndex, bytes);
      }
      return bytes;
    })();

    inflight.set(blockIndex, loadPromise);
    try {
      return await loadPromise;
    } finally {
      inflight.delete(blockIndex);
    }
  }

  async function readFile(
    buffer: ArrayBuffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<number> {
    if (closed) {
      throw new Error('PST file reader is closed');
    }
    if (length <= 0 || position < 0 || position >= fileSize) {
      return 0;
    }
    if (!Number.isSafeInteger(position)) {
      throw new RangeError(`Invalid 53-bit file position: ${position}`);
    }

    const readableLength = Math.min(length, fileSize - position, buffer.byteLength - offset);
    if (readableLength <= 0) {
      return 0;
    }

    const target = new Uint8Array(buffer, offset, readableLength);
    let bytesCopied = 0;
    let cursor = position;

    while (bytesCopied < readableLength) {
      const blockIndex = Math.floor(cursor / blockSize);
      const blockStart = blockIndex * blockSize;
      const offsetInBlock = cursor - blockStart;
      const blockData = await getBlock(blockIndex);

      if (offsetInBlock >= blockData.byteLength) {
        break;
      }

      const available = blockData.byteLength - offsetInBlock;
      const chunkLen = Math.min(readableLength - bytesCopied, available);
      target.set(blockData.subarray(offsetInBlock, offsetInBlock + chunkLen), bytesCopied);

      bytesCopied += chunkLen;
      cursor += chunkLen;
    }

    return bytesCopied;
  }

  return {
    size: fileSize,
    readFile,

    async readExact(position: number, length: number): Promise<ArrayBuffer> {
      const out = new ArrayBuffer(length);
      const got = await readFile(out, 0, length, position);
      if (got !== length) {
        throw new Error(
          `Unexpected EOF reading ${length} bytes at offset ${position} (got ${got})`,
        );
      }
      return out;
    },

    clearCache(): void {
      cache.clear();
      inflight.clear();
    },

    async close(): Promise<void> {
      closed = true;
      cache.clear();
      inflight.clear();
    },

    getStats(): PstBlockReaderStats {
      return {
        hits,
        misses,
        cachedBlocks: cache.size,
        bytesReadTotal,
        blockSize,
        maxCachedBlocks,
      };
    },
  };
}
