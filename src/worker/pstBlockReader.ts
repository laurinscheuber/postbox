import type { ReadFileApi } from '@hiraokahypertools/pst-extractor';

export interface PstBlockReaderOptions {
  blockSize?: number;
  maxCachedBlocks?: number;
}

const DEFAULT_BLOCK_SIZE = 256 * 1024; // 256 KB
const DEFAULT_MAX_BLOCKS = 128; // 32 MB LRU cache per PST/OST file

export interface PstBlockReaderStats {
  hits: number;
  misses: number;
  cachedBlocks: number;
}

/**
 * Implements `@hiraokahypertools/pst-extractor`'s `ReadFileApi` directly on top of the
 * browser's `File.slice()` API with an O(1) Map-based LRU block cache so multi-hundred-MB
 * `.pst` and `.ost` files never require reading the full archive into a single ArrayBuffer.
 */
export function createPstBlockReader(
  file: Blob,
  options: PstBlockReaderOptions = {},
): ReadFileApi & { getStats: () => PstBlockReaderStats } {
  const blockSize = options.blockSize ?? DEFAULT_BLOCK_SIZE;
  const maxCachedBlocks = options.maxCachedBlocks ?? DEFAULT_MAX_BLOCKS;
  const cache = new Map<number, Uint8Array>();
  const inflight = new Map<number, Promise<Uint8Array>>();
  let closed = false;
  let hits = 0;
  let misses = 0;

  async function getBlock(blockIndex: number): Promise<Uint8Array> {
    if (closed) {
      throw new Error('PST file reader is closed');
    }

    const cached = cache.get(blockIndex);
    if (cached !== undefined) {
      hits += 1;
      // Refresh recency in Map iteration order
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
    const end = Math.min(start + blockSize, file.size);

    const loadPromise = (async () => {
      if (start >= file.size) {
        return new Uint8Array(0);
      }
      const sliceBuffer = await file.slice(start, end).arrayBuffer();
      const bytes = new Uint8Array(sliceBuffer);
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

  return {
    async readFile(
      buffer: ArrayBuffer,
      offset: number,
      length: number,
      position: number,
    ): Promise<number> {
      if (closed) {
        throw new Error('PST file reader is closed');
      }
      if (length <= 0 || position < 0 || position >= file.size) {
        return 0;
      }

      const readableLength = Math.min(length, file.size - position, buffer.byteLength - offset);
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
      };
    },
  };
}
