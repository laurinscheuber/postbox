import type { MapiPropertyItem } from '../types/mail';

const MAPI_TAG_NAMES: Record<number, string> = {
  0x0002: 'PidTagAlternateRecipientAllowed',
  0x0017: 'PidTagImportance',
  0x001a: 'PidTagMessageClass',
  0x0023: 'PidTagOriginatorDeliveryReportRequested',
  0x0026: 'PidTagPriority',
  0x0029: 'PidTagReadReceiptRequested',
  0x002b: 'PidTagRecipientReassignmentProhibited',
  0x002e: 'PidTagOriginalSensitivity',
  0x0036: 'PidTagSensitivity',
  0x0037: 'PidTagSubject',
  0x0039: 'PidTagClientSubmitTime',
  0x003b: 'PidTagSentRepresentingSearchKey',
  0x003d: 'PidTagSubjectPrefix',
  0x0040: 'PidTagReceivedByName',
  0x0041: 'PidTagSentRepresentingEntryId',
  0x0042: 'PidTagSentRepresentingName',
  0x0044: 'PidTagReceivedRepresentingName',
  0x0049: 'PidTagOriginalSubject',
  0x0050: 'PidTagReplyRecipientNames',
  0x0057: 'PidTagMessageToMe',
  0x0058: 'PidTagMessageCcMe',
  0x0059: 'PidTagMessageRecipientMe',
  0x0063: 'PidTagResponseRequested',
  0x0064: 'PidTagSentRepresentingAddressType',
  0x0065: 'PidTagSentRepresentingEmailAddress',
  0x0070: 'PidTagConversationTopic',
  0x0071: 'PidTagConversationIndex',
  0x0072: 'PidTagOriginalDisplayBcc',
  0x0073: 'PidTagOriginalDisplayCc',
  0x0074: 'PidTagOriginalDisplayTo',
  0x0075: 'PidTagReceivedByAddressType',
  0x0076: 'PidTagReceivedByEmailAddress',
  0x0077: 'PidTagReceivedRepresentingAddressType',
  0x0078: 'PidTagReceivedRepresentingEmailAddress',
  0x007d: 'PidTagTransportMessageHeaders',
  0x0c19: 'PidTagSenderEntryId',
  0x0c1a: 'PidTagSenderName',
  0x0c1e: 'PidTagSenderAddressType',
  0x0c1f: 'PidTagSenderEmailAddress',
  0x0e02: 'PidTagDisplayBcc',
  0x0e03: 'PidTagDisplayCc',
  0x0e04: 'PidTagDisplayTo',
  0x0e06: 'PidTagMessageDeliveryTime',
  0x0e07: 'PidTagMessageFlags',
  0x0e08: 'PidTagMessageSize',
  0x0e12: 'PidTagMessageAttachments',
  0x0e13: 'PidTagMessageRecipients',
  0x0e1b: 'PidTagHasAttachments',
  0x0e1d: 'PidTagNormalizedSubject',
  0x0e1f: 'PidTagRtfInSync',
  0x0ff4: 'PidTagAccess',
  0x0ff7: 'PidTagAccessLevel',
  0x0ff9: 'PidTagRecordKey',
  0x0ffe: 'PidTagObjectType',
  0x0fff: 'PidTagEntryId',
  0x1000: 'PidTagBody',
  0x1006: 'PidTagRtfSyncBodyCrc',
  0x1007: 'PidTagRtfSyncBodyCount',
  0x1008: 'PidTagRtfSyncBodyTag',
  0x1009: 'PidTagRtfCompressed',
  0x1010: 'PidTagRtfSyncPrefixCount',
  0x1011: 'PidTagRtfSyncTrailingCount',
  0x1013: 'PidTagHtml',
  0x1035: 'PidTagInternetMessageId',
  0x1039: 'PidTagInternetReferences',
  0x1042: 'PidTagInReplyToId',
  0x1046: 'PidTagReturnPath',
  0x1080: 'PidTagIconIndex',
  0x1081: 'PidTagLastVerbExecuted',
  0x1082: 'PidTagLastVerbExecutionTime',
  0x3001: 'PidTagDisplayName',
  0x3007: 'PidTagCreationTime',
  0x3008: 'PidTagLastModificationTime',
  0x300b: 'PidTagSearchKey',
  0x3fde: 'PidTagInternetCodepage',
  0x3ff1: 'PidTagMessageLocaleId',
  0x3ffd: 'PidTagMessageCodepage',
  0x5d01: 'PidTagSenderSmtpAddress',
  0x5d02: 'PidTagSentRepresentingSmtpAddress',
  0x5d07: 'PidTagReceivedBySmtpAddress',
  0x5d08: 'PidTagReceivedRepresentingSmtpAddress',
  0x65e2: 'PidTagChangeKey',
  0x65e3: 'PidTagPredecessorChangeList',
};

const MAPI_TYPE_NAMES: Record<number, string> = {
  0x0002: 'PT_SHORT',
  0x0003: 'PT_LONG',
  0x0004: 'PT_FLOAT',
  0x0005: 'PT_DOUBLE',
  0x0006: 'PT_CURRENCY',
  0x0007: 'PT_APPTIME',
  0x000a: 'PT_ERROR',
  0x000b: 'PT_BOOLEAN',
  0x000d: 'PT_OBJECT',
  0x0014: 'PT_LONGLONG',
  0x001e: 'PT_STRING8',
  0x001f: 'PT_UNICODE',
  0x0040: 'PT_SYSTIME',
  0x0048: 'PT_CLSID',
  0x0102: 'PT_BINARY',
  0x1003: 'PT_MV_LONG',
  0x101e: 'PT_MV_STRING8',
  0x101f: 'PT_MV_UNICODE',
  0x1102: 'PT_MV_BINARY',
};

export function formatMapiTag(key: number): string {
  return `0x${(key >>> 0).toString(16).toUpperCase().padStart(4, '0')}`;
}

export function getMapiTagName(key: number): string {
  return MAPI_TAG_NAMES[key] ?? `Tag_${formatMapiTag(key)}`;
}

export function getMapiTypeName(typeCode: number): string {
  return MAPI_TYPE_NAMES[typeCode] ?? `0x${typeCode.toString(16).toUpperCase().padStart(4, '0')}`;
}

export function formatMapiValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }
  if (value instanceof ArrayBuffer) {
    return formatBinaryPreview(new Uint8Array(value));
  }
  if (value instanceof Uint8Array) {
    return formatBinaryPreview(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => formatMapiValue(item)).join(', ');
  }
  if (typeof value === 'object' && 'toString' in value && typeof value.toString === 'function') {
    const str = value.toString();
    if (str !== '[object Object]') {
      return str;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return '[Object]';
    }
  }
  const str = String(value);
  return str.length > 2000 ? `${str.slice(0, 2000)}… (${str.length.toLocaleString()} chars)` : str;
}

function formatBinaryPreview(bytes: Uint8Array): string {
  const previewLen = Math.min(bytes.byteLength, 24);
  const hex = Array.from(bytes.subarray(0, previewLen))
    .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ');
  return bytes.byteLength > previewLen
    ? `[${bytes.byteLength.toLocaleString()} bytes] ${hex} …`
    : `[${bytes.byteLength} bytes] ${hex}`;
}

export function toMapiPropertyItem(key: number, typeCode: number, value: unknown): MapiPropertyItem {
  return {
    tag: formatMapiTag(key),
    name: getMapiTagName(key),
    type: getMapiTypeName(typeCode),
    value: formatMapiValue(value),
  };
}
