function toBase64Utf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

/**
 * Generates an entirely client-side sample `.mbox` archive containing rich HTML,
 * inline `cid:` SVG graphics, blocked external tracking pixel demonstrations,
 * and downloadable attachments so users can try Postbox without uploading files.
 */
export function createSampleMboxFile(): File {
  const inlineLogoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="36" viewBox="0 0 144 36" fill="none"><rect width="144" height="36" rx="9" fill="#0B1325"/><rect x="6" y="6" width="24" height="24" rx="6" fill="#38BDF8"/><path d="M9.5 13.5L18 19.5L26.5 13.5" stroke="#0B1325" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><rect x="13" y="23" width="10" height="2.2" rx="1.1" fill="#0B1325" fill-opacity="0.72"/><text x="38" y="23" fill="#F8FAFC" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="700" letter-spacing="0.04em">POSTBOX</text></svg>`;
  const inlineLogoB64 = toBase64Utf8(inlineLogoSvg);
  const auditNotesB64 = toBase64Utf8(
    'Postbox Security Architecture Verification\n=======================================\n1. Zero-Upload: All parsing runs in local browser Web Workers.\n2. CSP Policy: connect-src none prevents any network egress.\n3. Tracking Pixel Strip: External http/https images are blocked by default.\n',
  );
  const csvB64 = toBase64Utf8(
    'format,engine,streaming_or_block_cache\n.pst,pst-extractor,256KB File.slice() LRU\n.ost,pst-extractor,256KB File.slice() LRU\n.msg,msgreader,ArrayBuffer in Worker\n.eml,postal-mime,ArrayBuffer in Worker\n.mbox,postal-mime,4MB File.slice() scanner\n',
  );

  const mboxContent = [
    'From security@postbox.scheuber.dev Thu Nov 19 08:15:00 2026',
    'From: Postbox Security Team <security@postbox.scheuber.dev>',
    'To: Auditor <auditor@example.org>',
    'Cc: Engineering <eng@example.org>',
    'Subject: Welcome to Postbox — Zero-Upload Inspection Demo',
    'Date: Thu, 19 Nov 2026 08:15:00 +0000',
    'Message-ID: <demo-01@postbox.scheuber.dev>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="sample_mix_1"',
    '',
    '--sample_mix_1',
    'Content-Type: multipart/related; boundary="sample_rel_1"',
    '',
    '--sample_rel_1',
    'Content-Type: multipart/alternative; boundary="sample_alt_1"',
    '',
    '--sample_alt_1',
    'Content-Type: text/plain; charset="utf-8"',
    '',
    'Welcome to Postbox!',
    '',
    'This sample email was generated 100% locally in your browser RAM.',
    'External tracking pixels are stripped automatically while inline cid: images render cleanly.',
    '',
    '--sample_alt_1',
    'Content-Type: text/html; charset="utf-8"',
    '',
    '<div style="font-family: sans-serif; max-width: 600px;">',
    '  <p><img src="cid:postbox-badge" alt="Postbox Inline Badge" /></p>',
    '  <h2 style="margin: 12px 0 8px;">Zero-Upload Mail Archive Inspection</h2>',
    '  <p>Everything you see here—HTML sanitization, inline <code>cid:</code> image resolution, and attachment extraction—runs strictly inside your browser using a strict <code>connect-src \'none\'</code> Content Security Policy.</p>',
    '  <p>Below is a simulated remote tracking pixel (blocked by default for your privacy):</p>',
    '  <p><img src="https://tracker.invalid/open-pixel.png" alt="Simulated Tracker Pixel" /></p>',
    '  <blockquote>Tip: Try switching between <strong>HTML</strong>, <strong>Plain Text</strong>, and <strong>Raw Source</strong> tabs, or export this message as an <code>.eml</code> file.</blockquote>',
    '</div>',
    '',
    '--sample_alt_1--',
    '',
    '--sample_rel_1',
    'Content-Type: image/svg+xml; name="postbox-badge.svg"',
    'Content-Disposition: inline; filename="postbox-badge.svg"',
    'Content-ID: <postbox-badge>',
    'Content-Transfer-Encoding: base64',
    '',
    inlineLogoB64,
    '--sample_rel_1--',
    '',
    '--sample_mix_1',
    'Content-Type: text/plain; name="security-verification.txt"',
    'Content-Disposition: attachment; filename="security-verification.txt"',
    'Content-Transfer-Encoding: base64',
    '',
    auditNotesB64,
    '',
    '--sample_mix_1',
    'Content-Type: text/csv; name="supported-formats.csv"',
    'Content-Disposition: attachment; filename="supported-formats.csv"',
    'Content-Transfer-Encoding: base64',
    '',
    csvB64,
    '--sample_mix_1--',
    '',
    'From incidents@example.org Wed Nov 18 16:42:10 2026',
    'From: Incident Response <incidents@example.org>',
    'To: IT Forensics <forensics@example.org>',
    'Subject: Phishing Triage: Suspected Credential Harvest Sample',
    'Date: Wed, 18 Nov 2026 16:42:10 +0000',
    'Message-ID: <demo-02@postbox.scheuber.dev>',
    'Authentication-Results: spf=fail smtp.mailfrom=evil-spoof.example; dkim=none',
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="utf-8"',
    '',
    '<div>',
    '  <h3>Forensic Review Note</h3>',
    '  <p>Inspect the <strong>Raw Internet Headers</strong> drawer or switch to the <strong>Raw Source</strong> tab to review <code>Authentication-Results</code> and transport headers without risking script execution.</p>',
    '  <p>Even if an attacker embeds a script tag or inline event handler, DOMPurify and iframe sandboxing neutralize it completely:</p>',
    '  <script>window.alert("This script is stripped by DOMPurify")</script>',
    '  <img src="x" onerror="window.alert(\'stripped\')" alt="Broken image test" />',
    '</div>',
    '',
    'From archive-bot@example.org Mon Nov 16 09:05:00 2026',
    'From: Archive Automation <archive-bot@example.org>',
    'To: Compliance Team <compliance@example.org>',
    'Subject: Q4 Retention Export Summary (Plain Text)',
    'Date: Mon, 16 Nov 2026 09:05:00 +0000',
    'Message-ID: <demo-03@postbox.scheuber.dev>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="utf-8"',
    '',
    'Hello Compliance Team,',
    '',
    'This plain-text message demonstrates mbox ">From " unescaping and virtualized search.',
    '>From the compliance export daemon: 0 records left the workstation.',
    '',
    'Best regards,',
    'Archive Automation',
    '',
  ].join('\n');

  return new File([mboxContent], 'postbox-sample-archive.mbox', {
    type: 'application/mbox',
    lastModified: Date.now(),
  });
}
