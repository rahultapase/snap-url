import { isHttpUrl } from './api';
import type { HistoryItem } from './types';

const KEY = 'snip:history:v1';
const MAX_ITEMS = 10;

function isHistoryItem(value: unknown): value is HistoryItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.shortUrl === 'string' &&
    typeof item.originalUrl === 'string' &&
    typeof item.createdAt === 'number' &&
    Number.isFinite(item.createdAt) &&
    isHttpUrl(item.shortUrl)
  );
}

export function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isHistoryItem).slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

function save(items: HistoryItem[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Storage full or blocked: history just won't persist this session.
  }
}

export function findByOriginal(items: HistoryItem[], originalUrl: string): HistoryItem | undefined {
  return items.find((item) => item.originalUrl === originalUrl);
}

export function addToHistory(items: HistoryItem[], entry: HistoryItem): HistoryItem[] {
  const rest = items.filter(
    (item) => item.originalUrl !== entry.originalUrl && item.shortUrl !== entry.shortUrl,
  );
  const next = [entry, ...rest].slice(0, MAX_ITEMS);
  save(next);
  return next;
}

export function removeFromHistory(items: HistoryItem[], shortUrl: string): HistoryItem[] {
  const next = items.filter((item) => item.shortUrl !== shortUrl);
  save(next);
  return next;
}

export function clearHistory(): HistoryItem[] {
  save([]);
  return [];
}
