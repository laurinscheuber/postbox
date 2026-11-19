// @vitest-environment node
import { Buffer } from 'buffer';
import { describe, expect, it } from 'vitest';
import { serializeMessageToEml } from '../utils/emlSerializer';
import { createSampleMboxFile } from '../utils/sampleArchive';
import {
  indexMboxFile,
  loadMboxMessageDetail,
  parseEmlFile,
} from '../worker/parsers/emlMboxAdapter';
import { parseMsgFile } from '../worker/parsers/msgAdapter';

(globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;

describe('EML & MBOX parsing and RFC 5322 export', () => {
  it('indexes mbox messages via File.slice() and lazily extracts bodies, cid attachments, and >From unescaping', async () => {
    const sampleFile = createSampleMboxFile();
    const session = await indexMboxFile(sampleFile, 'arch-1');

    expect(session.messages.length).toBe(3);
    expect(session.folderNode.totalCount).toBe(3);

    const welcomeMsg = session.messages.find((m) =>
      m.subject.includes('Zero-Upload Inspection Demo'),
    );
    expect(welcomeMsg).toBeDefined();
    expect(welcomeMsg?.hasAttachments).toBe(true);

    const detail = await loadMboxMessageDetail(session, welcomeMsg!.id);
    expect(detail).not.toBeNull();
    expect(detail?.from.address).toBe('security@postbox.scheuber.dev');
    expect(detail?.attachments.length).toBeGreaterThanOrEqual(3);
    expect(detail?.attachments.some((a) => a.contentId === 'postbox-badge')).toBe(true);

    // Check mbox ">From " unescaping on plain-text compliance message
    const complianceMsg = session.messages.find((m) =>
      m.subject.includes('Q4 Retention Export Summary'),
    );
    expect(complianceMsg).toBeDefined();
    const complianceDetail = await loadMboxMessageDetail(session, complianceMsg!.id);
    expect(complianceDetail?.textBody).toContain('From the compliance export daemon:');
    expect(complianceDetail?.textBody).not.toContain('>From the compliance export daemon:');
  });

  it('synthesizes valid RFC 5322 .eml from structured MessageDetail and re-parses identically', async () => {
    const emlBytes = serializeMessageToEml({
      id: 'msg-synthetic-1',
      folderId: 'f1',
      archiveId: 'a1',
      format: 'pst',
      subject: 'Quartalsbericht Zürich Q4',
      senderName: 'Laurin Scheuber',
      senderAddress: 'laurin@scheuber.dev',
      toSummary: 'team@scheuber.dev',
      date: '2026-11-19T08:00:00.000Z',
      timestamp: Date.parse('2026-11-19T08:00:00.000Z'),
      snippet: 'Hallo Team',
      hasAttachments: true,
      isRead: true,
      from: { name: 'Laurin Scheuber', address: 'laurin@scheuber.dev' },
      to: [{ name: 'Team', address: 'team@scheuber.dev' }],
      cc: [],
      bcc: [],
      headersRaw: '',
      textBody: 'Hallo Team,\nAnbei der Bericht.',
      htmlBody: '<p>Hallo <strong>Team</strong></p>',
      attachments: [
        {
          id: 'att-1',
          filename: 'report.txt',
          mimeType: 'text/plain',
          size: 11,
          isInline: false,
          data: new TextEncoder().encode('hello world'),
        },
      ],
    });

    const exportedFile = new File(
      [new Uint8Array(emlBytes)],
      'exported.eml',
      { type: 'message/rfc822' },
    );
    const reparsed = await parseEmlFile(exportedFile, 'arch-2', 'virtual:imported');

    expect(reparsed.detail.subject).toBe('Quartalsbericht Zürich Q4');
    expect(reparsed.detail.from.address).toBe('laurin@scheuber.dev');
    expect(reparsed.detail.htmlBody).toContain('<strong>Team</strong>');
    expect(reparsed.detail.attachments.length).toBe(1);
    expect(reparsed.detail.attachments[0].filename).toBe('report.txt');
    expect(new TextDecoder().decode(reparsed.detail.attachments[0].data)).toBe('hello world');
  });

  it('loads MsgReader cleanly and rejects non-OLE files with descriptive error', async () => {
    const fakeMsg = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], 'invalid.msg');
    await expect(parseMsgFile(fakeMsg, 'arch-msg', 'virtual:imported')).rejects.toThrow(
      /Failed to parse MSG file/,
    );
  });
});
