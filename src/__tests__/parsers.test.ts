// @vitest-environment node
import { Buffer } from 'buffer';
import { describe, expect, it } from 'vitest';
import {
  decodeMimeWords,
  decodeSmartHtmlBytes,
  decodeSmartTextBytes,
  extractRtfBody,
} from '../utils/encoding';
import { serializeMessageToEml } from '../utils/emlSerializer';
import { createSampleMboxFile } from '../utils/sampleArchive';
import {
  indexMboxFile,
  loadMboxMessageDetail,
  parseEmlFile,
} from '../worker/parsers/emlMboxAdapter';
import { stripHtmlToText } from '../worker/parsers/helpers';
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
      folderPath: 'Inbox',
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

  it('decodes German umlauts, Euro symbols, RFC 2047 headers, HTML entities, and RTF escapes without mojibake', () => {
    // Windows-1252 single-byte sequence: ö ä ü ß €
    const win1252Bytes = new Uint8Array([0xf6, 0xe4, 0xfc, 0xdf, 0x20, 0x80]);
    expect(decodeSmartTextBytes(win1252Bytes, 1252)).toBe('öäüß €');
    expect(decodeSmartHtmlBytes(new Uint8Array([0x3c, 0x70, 0x3e, 0xf6, 0xe4, 0xfc, 0xdf, 0x80, 0x3c, 0x2f, 0x70, 0x3e]), 1252)).toBe('<p>öäüß€</p>');

    // UTF-8 sequence
    const utf8Bytes = new TextEncoder().encode('öäüß €');
    expect(decodeSmartTextBytes(utf8Bytes, 1252)).toBe('öäüß €');
    expect(decodeSmartHtmlBytes(new TextEncoder().encode('<p>öäüß €</p>'), 1252)).toBe('<p>öäüß €</p>');

    // ISO-8859-15 Euro (0xA4 -> €)
    expect(decodeSmartTextBytes(new Uint8Array([0x31, 0x30, 0x20, 0xa4]), 28605)).toBe('10 €');

    // CP850 DOS German umlauts (0x94=ö, 0x84=ä, 0x81=ü, 0xE1=ß)
    expect(decodeSmartTextBytes(new Uint8Array([0x94, 0x84, 0x81, 0xe1]), 850)).toBe('öäüß');

    // RFC 2047 Q-encoded & B-encoded words
    expect(decodeMimeWords('=?iso-8859-1?Q?Gr=FC=DFe_aus_Z=FCrich?=')).toBe('Grüße aus Zürich');
    expect(decodeMimeWords('=?utf-8?B?w5xiZXJnYWJl?= =?utf-8?B?IOKCrA==?=')).toBe('Übergabe €');

    // HTML entity decoding inside stripHtmlToText
    expect(stripHtmlToText('<p>Gr&uuml;&szlig;e f&#252;r R&#xFC;ckfragen &amp; 10 &euro;</p>')).toBe(
      'Grüße für Rückfragen & 10 €',
    );

    // Plain RTF hex escapes
    const plainRtf = String.raw`{\rtf1\ansi\ansicpg1252{\fonttbl{\f0 Arial;}}Gr\'f6\'dfe \'e4\'fc\'df\par Mit \'80}`;
    expect(extractRtfBody(plainRtf)).toEqual({
      html: '',
      text: 'Größe äüß\nMit €',
    });

    // Outlook \fromhtml1 encapsulated HTML RTF
    const htmlRtf = String.raw`{\rtf1\ansi\ansicpg1252\fromhtml1{\*\htmltag64 <p>}Hallo \htmlrtf {\f0 \par}\htmlrtf0 Z\'fcrich & \'dcbung{\*\htmltag72 </p>}}`;
    expect(extractRtfBody(htmlRtf)).toEqual({
      html: '<p>Hallo Zürich & Übung</p>',
      text: '',
    });
  });

  it('preserves ISO-8859-1 8-bit umlauts and unescapes >From lines in MBOX files', async () => {
    const header =
      'From sender@example.com Thu Nov 19 08:00:00 2026\r\n' +
      'From: =?iso-8859-1?Q?J=FCrgen_M=FCller?= <juergen@example.com>\r\n' +
      'Subject: =?iso-8859-1?Q?R=FCckfragen_zu_Gr=F6=DFen?=\r\n' +
      'Date: Thu, 19 Nov 2026 08:00:00 +0100\r\n' +
      'MIME-Version: 1.0\r\n' +
      'Content-Type: text/plain; charset=iso-8859-1\r\n' +
      'Content-Transfer-Encoding: 8bit\r\n\r\n';
    const bodyTextLatin1 = 'Hallo,\r\n>From System: Besprechung über öäüßÖÄÜ.\r\n';

    const toLatin1 = (str: string): Uint8Array => {
      const arr = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i += 1) arr[i] = str.charCodeAt(i) & 0xff;
      return arr;
    };

    const hBytes = toLatin1(header);
    const bBytes = toLatin1(bodyTextLatin1);
    const combined = new Uint8Array(hBytes.length + bBytes.length);
    combined.set(hBytes, 0);
    combined.set(bBytes, hBytes.length);

    const mboxFile = new File([combined], 'latin1-umlauts.mbox', { type: 'application/mbox' });
    const session = await indexMboxFile(mboxFile, 'arch-latin1');
    expect(session.messages.length).toBe(1);
    expect(session.messages[0].subject).toBe('Rückfragen zu Größen');
    expect(session.messages[0].senderName).toBe('Jürgen Müller');

    const detail = await loadMboxMessageDetail(session, session.messages[0].id);
    expect(detail?.textBody).toContain('From System: Besprechung über öäüßÖÄÜ.');
    expect(detail?.textBody).not.toContain('>From System');
    expect(detail?.textBody).not.toContain('\uFFFD');
  });
});
