import { afterEach, describe, expect, it, vi } from 'vitest';
import { sanitizeEmailHtml } from '../utils/sanitizeEmailHtml';

describe('sanitizeEmailHtml', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('strips scripts/event handlers, blocks external images by default, and resolves cid: inline attachments', () => {
    let urlSeq = 0;
    const originalCreateObjectURL = URL.createObjectURL;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => {
        urlSeq += 1;
        return `blob:http://localhost/inline-${urlSeq}`;
      }),
    });

    try {

    const html = `
      <div>
        <script>alert("xss")</script>
        <img src="https://evil.example/pixel.gif" onerror="alert(1)" alt="Tracker" />
        <img src="cid:logo-123" alt="Inline Logo" />
        <a href="javascript:alert(2)">Bad Link</a>
        <a href="https://example.org/docs">Safe Link</a>
      </div>
    `;

    const result = sanitizeEmailHtml(html, {
      blockExternalImages: true,
      theme: 'light',
      attachments: [
        {
          id: 'att-inline',
          filename: 'logo.png',
          mimeType: 'image/png',
          size: 4,
          contentId: '<logo-123>',
          isInline: true,
          data: new Uint8Array([137, 80, 78, 71]),
        },
      ],
    });

    expect(result.blockedExternalCount).toBe(1);
    expect(result.resolvedInlineCount).toBe(1);
    expect(result.objectUrls).toEqual(['blob:http://localhost/inline-1']);
    expect(result.srcDoc).not.toContain('<script');
    expect(result.srcDoc).not.toContain('onerror');
    expect(result.srcDoc).not.toContain('https://evil.example/pixel.gif');
    expect(result.srcDoc).toContain('blob:http://localhost/inline-1');
    expect(result.srcDoc).not.toContain('javascript:alert');
    expect(result.srcDoc).toContain('rel="noopener noreferrer"');
    } finally {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        writable: true,
        value: originalCreateObjectURL,
      });
    }
  });
});
