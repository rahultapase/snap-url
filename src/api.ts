import type { ParsedInput, ShortenResult, SpooResponse } from './types';

const ENDPOINT = 'https://spoo.me/';
const TIMEOUT_MS = 10_000;

export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function parseInput(raw: string): ParsedInput {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: false, message: 'Paste a link to shorten.' };
  }
  if (/\s/.test(trimmed)) {
    return { ok: false, message: 'That link contains spaces. Check it and try again.' };
  }

  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed) && !/^[^/:]+:\d/.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, message: 'That doesn\u2019t look like a web address.' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, message: 'Only http and https links can be shortened.' };
  }
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host.startsWith('.') || host.endsWith('.')) {
    return { ok: false, message: 'Add a full domain, like example.com.' };
  }
  if (host === 'spoo.me' || host.endsWith('.spoo.me')) {
    return { ok: false, message: 'That\u2019s already a short link.' };
  }

  return { ok: true, url: url.href };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSpooResponse(value: unknown): value is SpooResponse {
  return (
    isRecord(value) &&
    typeof value.short_url === 'string' &&
    typeof value.domain === 'string' &&
    typeof value.original_url === 'string'
  );
}

function errorText(value: unknown): string | null {
  if (!isRecord(value)) return null;
  for (const [key, field] of Object.entries(value)) {
    if (typeof field !== 'string' || field.trim() === '') continue;
    if (/error$/i.test(key) || key === 'message') return field.trim();
  }
  return null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

export async function shorten(longUrl: string): Promise<ShortenResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: new URLSearchParams({ url: longUrl }),
      signal: controller.signal,
    });
  } catch (error) {
    window.clearTimeout(timer);
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, message: 'The shortener took too long to answer. Try again in a moment.' };
    }
    return { ok: false, message: 'Couldn\u2019t reach the shortener. Check your connection and try again.' };
  }

  const body = await readJson(response);
  window.clearTimeout(timer);

  if (response.status === 429) {
    return {
      ok: false,
      message: 'Too many links too quickly (about 5 a minute). Wait a moment and try again.',
    };
  }
  if (!response.ok) {
    const detail = errorText(body);
    return {
      ok: false,
      message: detail
        ? `The shortener refused that link: ${detail}`
        : `The shortener returned an error (${response.status}). Try again shortly.`,
    };
  }
  if (!isSpooResponse(body)) {
    return { ok: false, message: 'The shortener sent back something unexpected. Try again shortly.' };
  }

  const shortUrl = body.short_url.replace(/^http:\/\//i, 'https://');
  if (!isHttpUrl(shortUrl)) {
    return { ok: false, message: 'The shortener sent back an invalid link. Try again shortly.' };
  }
  return { ok: true, shortUrl, originalUrl: longUrl };
}
