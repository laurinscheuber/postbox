// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createPstBlockReader } from '../worker/pstBlockReader';

describe('createPstBlockReader', () => {
  it('reads single and cross-block byte ranges accurately and clamps at EOF', async () => {
    const size = 600 * 1024; // 600 KB -> spans multiple 256 KB blocks
    const raw = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) {
      raw[i] = (i * 31 + 7) & 0xff;
    }
    const blob = new Blob([raw]);
    const reader = createPstBlockReader(blob, { blockSize: 256 * 1024, maxCachedBlocks: 2 });

    // Cross-boundary read spanning blocks 0 and 1 (around 256 KB mark)
    const offset = 256 * 1024 - 128;
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

    // Re-reading block 2 (most recent) should hit LRU cache
    const hitsBefore = reader.getStats().hits;
    const hitBuf = new ArrayBuffer(10);
    await reader.readFile(hitBuf, 0, 10, tailOffset);
    expect(reader.getStats().hits).toBe(hitsBefore + 1);

    await reader.close();
    expect(reader.getStats().cachedBlocks).toBe(0);
  });
});
