import { isHttpUrl, parseInput, shorten } from './api';
import {
  addToHistory,
  clearHistory,
  findByOriginal,
  loadHistory,
  removeFromHistory,
} from './history';
import { icon } from './icons';
import { initThemeToggle } from './theme';
import type { HistoryItem } from './types';

/* ---------- DOM lookups ---------- */

function byId<T extends HTMLElement>(id: string, type: { new (): T }): T {
  const node = document.getElementById(id);
  if (!(node instanceof type)) throw new Error(`Missing #${id}`);
  return node;
}

const form = byId('shorten-form', HTMLFormElement);
const input = byId('url-input', HTMLInputElement);
const submitButton = byId('shorten-button', HTMLButtonElement);
const errorEl = byId('url-error', HTMLParagraphElement);
const resultEl = byId('result', HTMLDivElement);
const listEl = byId('history-list', HTMLOListElement);
const emptyEl = byId('history-empty', HTMLDivElement);
const countEl = byId('history-count', HTMLParagraphElement);
const clearArea = byId('clear-area', HTMLDivElement);
const announcer = byId('announcer', HTMLDivElement);

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const LEAVE_MS = 200;
const COPIED_MS = 1500;
const MAX_ITEMS = 10;

/* ---------- Small builders ---------- */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function withoutScheme(url: string): string {
  return url.replace(/^https?:\/\//i, '');
}

interface ShortLink {
  anchor: HTMLAnchorElement;
  text: HTMLSpanElement;
}

function shortLink(url: string, className: string): ShortLink {
  const anchor = el('a', `short-link ${className}`);
  if (isHttpUrl(url)) anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';

  const text = el('span', 'short-link-text');
  const scheme = /^https?:\/\//i.exec(url)?.[0] ?? '';
  text.append(el('span', 'short-link-scheme', scheme), document.createTextNode(withoutScheme(url)));

  anchor.append(text, icon('external', 'icon icon-external'), el('span', 'visually-hidden', ' (opens in a new tab)'));
  return { anchor, text };
}

function truncatedUrl(url: string, className: string): HTMLSpanElement {
  const span = el('span', `truncate ${className}`, url);
  span.title = url;
  return span;
}

/* ---------- Announcements ---------- */

let announceTimer = 0;
function announce(message: string): void {
  window.clearTimeout(announceTimer);
  announcer.textContent = '';
  announceTimer = window.setTimeout(() => {
    announcer.textContent = message;
  }, 60);
}

/* ---------- Copy ---------- */

const copyTimers = new WeakMap<HTMLButtonElement, number>();

function copyButton(
  url: string,
  label: string,
  link: ShortLink,
  note: HTMLElement,
  extraClass = '',
): HTMLButtonElement {
  const button = el('button', `button button-copy ${extraClass}`.trim());
  button.type = 'button';
  button.setAttribute('aria-label', label);

  const icons = el('span', 'copy-icons');
  icons.append(icon('copy', 'icon icon-copy'), icon('check', 'icon icon-check'));
  const text = el('span', 'copy-label', 'Copy');
  button.append(icons, text);

  button.addEventListener('click', () => {
    void copy(url, button, text, link, note);
  });
  return button;
}

async function copy(
  url: string,
  button: HTMLButtonElement,
  label: HTMLSpanElement,
  link: ShortLink,
  note: HTMLElement,
): Promise<void> {
  window.clearTimeout(copyTimers.get(button));
  try {
    if (!navigator.clipboard) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(url);
  } catch {
    startManualCopy(link.text, note);
    announce('Couldn\u2019t copy automatically. The link is selected: press Ctrl+C to copy.');
    return;
  }

  endManualCopy();
  button.dataset.state = 'copied';
  label.textContent = 'Copied';
  announce(`Copied ${withoutScheme(url)}`);
  copyTimers.set(
    button,
    window.setTimeout(() => {
      delete button.dataset.state;
      label.textContent = 'Copy';
    }, COPIED_MS),
  );
}

/* The document has a single selection, so at most one manual-copy hint can be pending. */
let manualCopy: { text: Node; note: HTMLElement } | null = null;

function startManualCopy(text: Node, note: HTMLElement): void {
  endManualCopy();
  const selection = window.getSelection();
  if (selection) {
    const range = document.createRange();
    range.selectNodeContents(text);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  note.textContent = 'Press Ctrl+C to copy';
  note.hidden = false;
  manualCopy = { text, note };
}

function endManualCopy(): void {
  if (!manualCopy) return;
  const { text, note } = manualCopy;
  manualCopy = null;
  note.hidden = true;
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0 && selection.containsNode(text, true)) {
    selection.removeAllRanges();
  }
}

document.addEventListener('copy', () => {
  if (!manualCopy) return;
  const copied = window.getSelection()?.containsNode(manualCopy.text, true) ?? false;
  window.setTimeout(endManualCopy, 0);
  if (copied) announce('Copied.');
});

/* ---------- Result ticket ---------- */

function renderResult(item: HistoryItem, reused: boolean): void {
  const perforation = el('div', 'ticket-perf');
  perforation.setAttribute('aria-hidden', 'true');
  perforation.append(icon('scissors', 'icon icon-scissors'));

  const heading = el('p', 'ticket-label', reused ? 'Already in your history' : 'Your short link');
  const link = shortLink(item.shortUrl, 'ticket-link');
  const note = el('p', 'copy-note');
  note.hidden = true;
  const copyBtn = copyButton(item.shortUrl, `Copy ${withoutScheme(item.shortUrl)}`, link, note, 'button-copy-lg');

  const row = el('div', 'ticket-row');
  row.append(link.anchor, copyBtn);

  const origin = el('p', 'ticket-origin');
  origin.append(el('span', 'ticket-origin-label', 'From'), truncatedUrl(item.originalUrl, 'ticket-origin-url'));

  resultEl.classList.remove('is-shown');
  resultEl.replaceChildren(perforation, heading, row, origin, note);
  resultEl.hidden = false;
  void resultEl.offsetWidth;
  resultEl.classList.add('is-shown');
}

/* ---------- Relative time ---------- */

function relativeTime(then: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ---------- History ledger ---------- */

let history: HistoryItem[] = loadHistory();
const rows = new Map<string, HTMLLIElement>();
const pad = (n: number): string => String(n).padStart(2, '0');

function buildRow(item: HistoryItem): HTMLLIElement {
  const li = el('li', 'item');
  const inner = el('div', 'item-inner');

  const index = el('span', 'item-index');
  index.setAttribute('aria-hidden', 'true');

  const main = el('div', 'item-main');
  const link = shortLink(item.shortUrl, 'item-link');
  main.append(link.anchor, truncatedUrl(item.originalUrl, 'item-origin'));

  const time = el('time', 'item-time');
  time.dateTime = new Date(item.createdAt).toISOString();

  const note = el('p', 'copy-note item-note');
  note.hidden = true;

  const actions = el('div', 'item-actions');
  const name = withoutScheme(item.shortUrl);
  const del = el('button', 'button button-icon button-delete');
  del.type = 'button';
  del.setAttribute('aria-label', `Delete ${name} from history`);
  del.append(icon('trash'));
  del.addEventListener('click', () => deleteRow(item.shortUrl));
  actions.append(copyButton(item.shortUrl, `Copy ${name}`, link, note, 'button-quiet'), del);

  inner.append(index, main, time, actions, note);
  li.append(inner);
  return li;
}

function renderHistory(freshKey?: string): void {
  const keys = new Set(history.map((item) => item.shortUrl));
  for (const [key, li] of rows) {
    if (!keys.has(key) && !li.classList.contains('is-leaving')) {
      li.remove();
      rows.delete(key);
    }
  }

  const now = Date.now();
  let previous: Element | null = null;
  history.forEach((item, i) => {
    let li = rows.get(item.shortUrl);
    if (li?.classList.contains('is-leaving')) {
      li.remove();
      li = undefined;
    }
    const isNew = !li;
    if (!li) {
      li = buildRow(item);
      rows.set(item.shortUrl, li);
    }
    li.dataset.index = String(i);
    const index = li.querySelector('.item-index');
    if (index) index.textContent = pad(i + 1);
    const time = li.querySelector('time');
    if (time) {
      time.dateTime = new Date(item.createdAt).toISOString();
      time.textContent = relativeTime(item.createdAt, now);
    }
    let at: Element | null = previous ? previous.nextElementSibling : listEl.firstElementChild;
    while (at && at !== li && at.classList.contains('is-leaving')) at = at.nextElementSibling;
    if (at !== li) listEl.insertBefore(li, at);
    previous = li;

    if (!isNew && item.shortUrl === freshKey) {
      li.classList.remove('is-fresh');
      void li.offsetWidth;
      li.classList.add('is-fresh');
    }
  });

  countEl.textContent = `${pad(history.length)} / ${MAX_ITEMS}`;
  renderEmpty();
  renderClear(false);
}

function renderEmpty(): void {
  const empty = history.length === 0;
  listEl.hidden = empty;
  emptyEl.hidden = !empty;
  if (!empty || emptyEl.childElementCount > 0) return;

  const mark = el('div', 'empty-mark');
  mark.append(icon('link', 'icon icon-empty'));
  emptyEl.append(
    mark,
    el('p', 'empty-title', 'Your short links collect here'),
    el(
      'p',
      'empty-body',
      'Shorten a link and it appears here, newest first, ready to copy again. Snip keeps the last 10 in this browser.',
    ),
  );
}

function deleteRow(shortUrl: string): void {
  const li = rows.get(shortUrl);
  if (!li || li.classList.contains('is-leaving')) return;

  const settled = (start: Element | null, step: (node: Element) => Element | null): Element | null => {
    let node = start;
    while (node && node.classList.contains('is-leaving')) node = step(node);
    return node;
  };
  const neighbour =
    settled(li.nextElementSibling, (node) => node.nextElementSibling) ??
    settled(li.previousElementSibling, (node) => node.previousElementSibling);
  const removed = history.find((item) => item.shortUrl === shortUrl);
  history = removeFromHistory(history, shortUrl);

  const nextFocus = neighbour?.querySelector<HTMLButtonElement>('.button-delete') ?? input;
  nextFocus.focus();
  announce(`Deleted ${removed ? withoutScheme(removed.shortUrl) : 'link'} from history.`);

  const finish = (): void => {
    if (rows.get(shortUrl) === li) {
      li.remove();
      rows.delete(shortUrl);
    }
    renderHistory();
  };

  if (reduceMotion.matches) {
    finish();
    return;
  }
  li.classList.add('is-leaving');
  window.setTimeout(finish, LEAVE_MS);
}

function renderClear(confirming: boolean): void {
  if (history.length === 0) {
    clearArea.replaceChildren();
    return;
  }

  if (!confirming) {
    const button = el('button', 'button button-text', 'Clear history');
    button.type = 'button';
    button.addEventListener('click', () => {
      renderClear(true);
      clearArea.querySelector<HTMLButtonElement>('.button-cancel')?.focus();
    });
    clearArea.replaceChildren(button);
    return;
  }

  const count = history.length;
  const question = el('span', 'confirm-text', `Clear ${count} ${count === 1 ? 'link' : 'links'}?`);
  question.id = 'confirm-text';

  const yes = el('button', 'button button-danger', 'Clear history');
  yes.type = 'button';
  yes.setAttribute('aria-describedby', 'confirm-text');
  yes.addEventListener('click', () => {
    history = clearHistory();
    renderHistory();
    input.focus();
    announce('History cleared.');
  });

  const no = el('button', 'button button-text button-cancel', 'Keep links');
  no.type = 'button';
  no.setAttribute('aria-describedby', 'confirm-text');
  const cancel = (): void => {
    renderClear(false);
    clearArea.querySelector<HTMLButtonElement>('.button-text')?.focus();
  };
  no.addEventListener('click', cancel);

  const group = el('div', 'confirm');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Confirm clearing history');
  group.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') cancel();
  });
  group.append(question, no, yes);
  clearArea.replaceChildren(group);
  announce(`Clear all ${count} ${count === 1 ? 'link' : 'links'} from history? Choose Clear history or Keep links.`);
}

/* ---------- Form ---------- */

let busy = false;

function setBusy(next: boolean): void {
  busy = next;
  submitButton.disabled = next;
  input.readOnly = next;
  form.setAttribute('aria-busy', String(next));
  submitButton.dataset.loading = next ? 'true' : 'false';
  const label = submitButton.querySelector('.button-label');
  if (label) label.textContent = next ? 'Shortening\u2026' : 'Shorten';
}

function showError(message: string): void {
  errorEl.replaceChildren(icon('alert'), el('span', undefined, message));
  errorEl.hidden = false;
  input.setAttribute('aria-invalid', 'true');
  const ticketLabel = resultEl.querySelector('.ticket-label');
  if (!resultEl.hidden && ticketLabel) ticketLabel.textContent = 'Previous short link';
  announce(message);
}

function clearError(): void {
  errorEl.hidden = true;
  errorEl.textContent = '';
  input.removeAttribute('aria-invalid');
}

function accept(item: HistoryItem, reused: boolean): void {
  history = addToHistory(history, item);
  renderHistory(item.shortUrl);
  renderResult(item, reused);
  input.value = '';
  announce(
    reused
      ? `Already shortened: ${withoutScheme(item.shortUrl)}. Moved to the top of your history.`
      : `Short link ready: ${withoutScheme(item.shortUrl)}`,
  );
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;

  const parsed = parseInput(input.value);
  if (!parsed.ok) {
    showError(parsed.message);
    input.focus();
    return;
  }
  clearError();

  const existing = findByOriginal(history, parsed.url);
  if (existing) {
    accept({ ...existing, createdAt: Date.now() }, true);
    return;
  }

  setBusy(true);
  const result = await shorten(parsed.url);
  setBusy(false);

  if (!result.ok) {
    showError(result.message);
    input.focus();
    return;
  }
  accept({ shortUrl: result.shortUrl, originalUrl: result.originalUrl, createdAt: Date.now() }, false);
});

input.addEventListener('input', () => {
  if (!errorEl.hidden) clearError();
});

window.addEventListener('storage', (event) => {
  if (event.key !== null && event.key !== 'snip:history:v1') return;
  history = loadHistory();
  renderHistory();
});

window.setInterval(() => {
  const now = Date.now();
  for (const item of history) {
    const time = rows.get(item.shortUrl)?.querySelector('time');
    if (time) time.textContent = relativeTime(item.createdAt, now);
  }
}, 30_000);

initThemeToggle(byId('theme-toggle', HTMLButtonElement), announce);
renderHistory();
requestAnimationFrame(() => {
  listEl.dataset.ready = '';
});
