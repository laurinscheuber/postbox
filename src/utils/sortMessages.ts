import type { MessageSortOrder, MessageSummary } from '../types/mail';

/**
 * Compares two messages chronologically while keeping undated items (`timestamp <= 0`)
 * at the bottom regardless of sort direction.
 */
export function compareMessagesByDate(
  a: MessageSummary,
  b: MessageSummary,
  order: MessageSortOrder = 'desc',
): number {
  const aValid = a.timestamp > 0;
  const bValid = b.timestamp > 0;
  if (aValid && !bValid) return -1;
  if (!aValid && bValid) return 1;

  if (aValid && bValid && a.timestamp !== b.timestamp) {
    return order === 'desc' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp;
  }

  return a.id === b.id ? 0 : a.id.localeCompare(b.id);
}

/**
 * Returns a non-mutated, chronologically sorted copy of `messages`.
 */
export function sortMessages(
  messages: readonly MessageSummary[],
  order: MessageSortOrder = 'desc',
): MessageSummary[] {
  return messages.toSorted((a, b) => compareMessagesByDate(a, b, order));
}
