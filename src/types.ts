export interface HistoryItem {
  shortUrl: string;
  originalUrl: string;
  createdAt: number;
}

export interface SpooResponse {
  short_url: string;
  domain: string;
  original_url: string;
}

export type ShortenResult =
  | { ok: true; shortUrl: string; originalUrl: string }
  | { ok: false; message: string };

export type ParsedInput =
  | { ok: true; url: string }
  | { ok: false; message: string };
