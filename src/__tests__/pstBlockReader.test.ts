// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  PST_BLOCK_SIZE,
  PST_MAX_CACHED_BLOCKS,
  createPstBlockReader,
} from '../worker/pstBlockReader';

describe('createPstBlockReader', () => {
  it('enforces 64 KB aligned blocks and 2048-block (~128 MB) default LRU bounds', () => {
    expect(PST_BLOCK_SIZE).toBe(65536);
    expect(PST_MAX_CACHED_BLOCKS).toBe(2048);
  });

  it('reads single and cross-block byte ranges accurately and clamps at EOF', async () => {
    const size = 200 * 1024; // 200 KB -> spans four 64 KB blocks
    const raw = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) {
      raw[i] = (i * 31 + 7) & 0xff;
    }
    const blob = new Blob([raw]);
    const reader = createPstBlockReader(blob, { blockSize: PST_BLOCK_SIZE, maxCachedBlocks: 2 });

    // Cross-boundary read spanning 64 KB blocks 0 and 1
    const offset = PST_BLOCK_SIZE - 128;
    const len = 512;
    const outBuf = new ArrayBuffer(len);
    const bytesRead = await reader.readFile(outBuf, 0, len, offset);

    expect(bytesRead).toBe(len);
    const outView = new Uint8Array(outBuf);
    for (let i = 0; i < len; i += 1) {
      expect(outView[i]).toBe(raw[offset + i]);
    }

    // Read past EOF should clamp cleanly
    const tailOffset = size - 20;
    const tailBuf = new ArrayBuffer(100);
    const tailRead = await reader.readFile(tailBuf, 0, 100, tailOffset);
    expect(tailRead).toBe(20);
    expect(new Uint8Array(tailBuf, 0, 20)).toEqual(raw.subarray(tailOffset));

    // LRU cache should cap at maxCachedBlocks = 2
    expect(reader.getStats().cachedBlocks).toBe(2);

    // Re-reading tail block (most recent) should hit LRU cache
    const hitsBefore = reader.getStats().hits;
    const hitBuf = new ArrayBuffer(10);
    await reader.readFile(hitBuf, 0, 10, tailOffset);
    expect(reader.getStats().hits).toBe(hitsBefore + 1);

    reader.clearCache();
    expect(reader.getStats().cachedBlocks).toBe(0);
    await reader.close();
  });
});
