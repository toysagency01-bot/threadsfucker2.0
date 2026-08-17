import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { containsExactPhrase, isRecentTimestamp, normalize } from './src/filter.js';
import type { ThreadsPost } from './src/types.js';

const DEFAULT_KEYWORDS = [
  'ищу маркетолога',
  'ищу таргетолога',
  'ищу специалиста meta ads',
  'ищу специалиста google ads',
  'ищу агентство трафика',
];

const MAX_POST_AGE_MINUTES = Number(process.env.MAX_POST_AGE_MINUTES || '240');
const MAX_ITEMS_PER_KEYWORD = Number(process.env.MAX_ITEMS_PER_KEYWORD || '50');
const STATE_PATH = process.env.STATE_PATH || 'threads_monitor_state.json';
const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const SESSION_ID = (process.env.THREADS_SESSION_ID || '').trim();
const STORAGE_STATE_JSON = (process.env.THREADS_STORAGE_STATE_JSON || '').trim();

type StoredState = {
  chatId?: number;
  sentPostIds: Record<string, string>;
};

type ReplyFlags = Map<string, boolean>;

type SearchItem = {
  href: string;
  text: string;
  timestamp: string;
  isReply?: boolean;
};

function log(message: string, details?: unknown): void {
  if (details === undefined) console.log(`[monitor] ${message}`);
  else console.log(`[monitor] ${message}`, JSON.stringify(details));
}

function keywordsFromEnv(): string[] {
  const raw = process.env.KEYWORDS || '';
  const values = raw
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? values : DEFAULT_KEYWORDS;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function postIdFromUrl(url: string): string {
  const match = url.match(/\/post\/([^/?#]+)/);
  return match?.[1] || url;
}

function absoluteUrl(href: string): string {
  if (href.startsWith('http://') || href.startsWith('https://')) return href.split('?')[0];
  return `https://www.threads.com${href.split('?')[0]}`;
}

async function loadState(): Promise<StoredState> {
  if (!existsSync(STATE_PATH)) return { sentPostIds: {} };
  try {
    const parsed = JSON.parse(await readFile(STATE_PATH, 'utf8')) as Partial<StoredState>;
    return {
      chatId: parsed.chatId,
      sentPostIds: parsed.sentPostIds || {},
    };
  } catch (error) {
    log('State file is invalid; starting with an empty state', String(error));
    return { sentPostIds: {} };
  }
}

async function saveState(state: StoredState): Promise<void> {
  const entries = Object.entries(state.sentPostIds).slice(-5000);
  state.sentPostIds = Object.fromEntries(entries);
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function storageStateFromEnv(): Record<string, unknown> | undefined {
  if (!STORAGE_STATE_JSON) return undefined;
  try {
    return JSON.parse(STORAGE_STATE_JSON) as Record<string, unknown>;
  } catch {
    throw new Error('THREADS_STORAGE_STATE_JSON is not valid JSON');
  }
}

async function createContext(): Promise<{ browser: Browser; context: BrowserContext }> {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const storageState = storageStateFromEnv();
  const context = await browser.newContext({
    ...(storageState ? { storageState: storageState as any } : {}),
    locale: 'ru-RU',
    timezoneId: 'UTC',
    viewport: { width: 1280, height: 1600 },
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
  });

  if (SESSION_ID) {
    await context.addCookies([
      {
        name: 'sessionid',
        value: SESSION_ID,
        domain: '.threads.com',
        path: '/',
        secure: true,
        httpOnly: true,
      },
      {
        name: 'sessionid',
        value: SESSION_ID,
        domain: '.threads.net',
        path: '/',
        secure: true,
        httpOnly: true,
      },
    ]);
    log('Using THREADS_SESSION_ID browser cookie');
  } else if (storageState) {
    log('Using THREADS_STORAGE_STATE_JSON browser session');
  } else {
    log('Using public Threads search without an authenticated session');
  }

  return { browser, context };
}

async function blockHeavyResources(page: Page): Promise<void> {
  await page.route('**/*', async (route) => {
    const type = route.request().resourceType();
    if (type === 'image' || type === 'font' || type === 'media') await route.abort();
    else await route.continue();
  });
}

async function collectReplyFlags(page: Page): Promise<ReplyFlags> {
  const flags = await page.evaluate(() => {
    const output: Array<{ id: string; isReply: boolean }> = [];
    const replyMarker = /(replying to|replied to|в ответ на|ответ пользователю|отвечает)/i;
    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/post/"]'));
    const seen = new Set<string>();

    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') || anchor.href || '';
      const match = href.match(/\/post\/([^/?#]+)/);
      if (!match || seen.has(match[1])) continue;
      seen.add(match[1]);

      let node: HTMLElement | null = anchor;
      let card: HTMLElement | null = null;
      for (let depth = 0; depth < 12 && node; depth += 1, node = node.parentElement) {
        const text = (node.innerText || '').trim();
        if (node.querySelector('time') && text.length >= 15 && text.length <= 7000) {
          card = node;
        }
        if (node.matches('article, [role="article"], [data-pressable-container="true"]')) {
          card = node;
          break;
        }
      }
      const raw = (card || anchor.parentElement)?.innerText || '';
      output.push({ id: match[1], isReply: replyMarker.test(raw) });
    }
    return output;
  });

  return new Map(flags.map((item) => [item.id, item.isReply]));
}

function collectStructuredReplyFlags(payloads: unknown[]): ReplyFlags {
  const flags: ReplyFlags = new Map();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!value || typeof value !== 'object') return;

    const node = value as Record<string, unknown>;
    const permalink = String(node.permalink || node.post_url || node.url || '');
    const id = node.id ? String(node.id) : permalink ? postIdFromUrl(permalink) : '';
    const isReply =
      node.is_reply === true ||
      node.isReply === true ||
      Boolean(node.reply_to || node.reply_to_id || node.parent_id || node.replied_to);
    if (id && isReply) flags.set(id, true);

    for (const child of Object.values(node)) walk(child);
  };
  for (const payload of payloads) walk(payload);
  return flags;
}

async function scrollForSearch(page: Page): Promise<void> {
  for (let index = 0; index < 3; index += 1) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1800);
  }
}

/**
 * Threads changes its React/card markup frequently. The copied Toolkit
 * parser is useful when its expected card structure is present, but it can
 * return zero items while the page visibly contains posts. This extractor
 * intentionally relies only on stable post links and the nearest readable
 * card, then lets the monitor apply the exact-phrase/reply/date filters.
 */
async function extractSearchItemsFromDom(page: Page, keyword: string): Promise<SearchItem[]> {
  // Pass a plain JavaScript string to Playwright. Passing this TypeScript
  // callback directly through tsx makes esbuild inject __name(), which does
  // not exist inside the browser page.
  return page.evaluate(
    `(wantedKeyword) => {
      const normalizeText = (value) =>
        (value || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase('ru-RU');
    const wanted = normalizeText(wantedKeyword);
    const anchors = Array.from(document.querySelectorAll('a[href*="/post/"]'));
    const output = [];
    const seen = new Set();

    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') || anchor.href || '';
      if (!href || seen.has(href)) continue;

      let node = anchor;
      let card = null;
      for (let depth = 0; depth < 12 && node; depth += 1, node = node.parentElement) {
        const raw = (node.innerText || '').trim();
        const hasTime = Boolean(node.querySelector('time, [datetime]'));
        const hasPostLink = Boolean(node.querySelector('a[href*="/post/"]'));
        if (hasPostLink && hasTime && raw.length >= 15 && raw.length <= 7000) {
          if (!card || raw.length < (card.innerText || '').length) card = node;
        }
        if (node.matches('article, [role="article"], [data-pressable-container="true"]') && raw.length >= 15) {
          card = node;
          break;
        }
      }

      if (!card) {
        card = anchor.closest('article, [role="article"], [data-pressable-container="true"]') || anchor.parentElement;
      }
      if (!card) continue;

      const rawText = (card.innerText || '').trim();
      const blocks = Array.from(card.querySelectorAll('[dir="auto"]'))
        .map((element) => (element.innerText || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      const matchingBlock = blocks.find((text) => normalizeText(text).includes(wanted));
      const text = matchingBlock || blocks.sort((a, b) => b.length - a.length)[0] || rawText;
      const time = card.querySelector('time, [datetime]');
      const timestamp =
        time?.getAttribute('datetime') ||
        time?.getAttribute('title') ||
        time?.textContent ||
        '';
      const lower = normalizeText(rawText);
      const isReply = /replying to|replied to|в ответ на|ответ пользователю|отвечает/.test(lower);

      seen.add(href);
      output.push({ href, text, timestamp, isReply });
    }
    return output;
  }`,
    keyword,
  );
}

function extractStructuredSearchItems(payloads: unknown[]): SearchItem[] {
  const results: SearchItem[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    let text = node.text || node.caption || node.caption_text || node.text_content || '';
    if (typeof text === 'object' && text) {
      const nested = text as Record<string, unknown>;
      text = nested.text || nested.value || '';
    }
    const permalink = String(node.permalink || node.post_url || node.url || '');
    const username = String(
      node.username ||
        (node.user && typeof node.user === 'object' && 'username' in node.user
          ? (node.user as Record<string, unknown>).username
          : '') ||
        '',
    );
    const code = String(node.code || node.shortcode || node.short_code || '');
    const href = permalink || (username && code ? `https://www.threads.com/@${username}/post/${code}` : '');
    if (typeof text === 'string' && text.trim() && href.includes('/post/')) {
      results.push({
        href,
        text: text.trim(),
        timestamp: String(node.timestamp || node.created_at || node.taken_at || node.created_time || ''),
        isReply: Boolean(node.is_reply || node.isReply || node.reply_to || node.reply_to_id || node.parent_id),
      });
    }
    Object.values(node).forEach(walk);
  };
  payloads.forEach(walk);
  return results;
}

function searchItemToPost(item: SearchItem): ThreadsPost | null {
  const href = absoluteUrl(item.href);
  const match = href.match(/\/\@([^/]+)\/post\/([^/?#]+)/);
  if (!match) return null;
  const rawTimestamp = item.timestamp.trim();
  const numericTimestamp = Number(rawTimestamp);
  const timestamp =
    Number.isFinite(numericTimestamp) && numericTimestamp > 1_000_000_000
      ? new Date(numericTimestamp < 10_000_000_000 ? numericTimestamp * 1000 : numericTimestamp).toISOString()
      : rawTimestamp;
  return {
    id: match[2],
    url: href,
    author: {
      username: match[1],
      displayName: match[1],
      profileUrl: `https://www.threads.com/@${match[1]}`,
    },
    content: item.text,
    timestamp,
    stats: { likes: 0, replies: 0, reposts: 0, shares: 0 },
  };
}

async function searchKeyword(context: BrowserContext, keyword: string): Promise<ThreadsPost[]> {
  const page = await context.newPage();
  const payloads: unknown[] = [];
  page.on('response', (response) => {
    void (async () => {
      const contentType = response.headers()['content-type'] || '';
      const url = response.url().toLocaleLowerCase();
      if (!contentType.includes('json') && !url.includes('graphql') && !url.includes('/search')) return;
      try {
        payloads.push(await response.json());
      } catch {
        // Some responses are JSON-looking but are not readable twice.
      }
    })();
  });

  try {
    await blockHeavyResources(page);
    const url = new URL('https://www.threads.com/search/');
    url.searchParams.set('q', keyword);
    url.searchParams.set('serp_type', 'default');
    url.searchParams.set('filter', 'recent');
    log(`Searching ${JSON.stringify(keyword)}`);
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(4_000);
    await scrollForSearch(page);
    await page.waitForTimeout(500);

    const body = normalize(await page.locator('body').innerText().catch(() => ''));
    if (/произошла ошибка|something went wrong|try again/i.test(body)) {
      log(`Threads returned a page error for ${JSON.stringify(keyword)}`);
      return [];
    }

    const replyFlags = await collectReplyFlags(page);
    const structuredReplyFlags = collectStructuredReplyFlags(payloads);
    const domItems = await extractSearchItemsFromDom(page, keyword);
    const structuredItems = extractStructuredSearchItems(payloads);
    log(`Extractor counts for ${JSON.stringify(keyword)}`, {
      domItems: domItems.length,
      structuredItems: structuredItems.length,
      postLinks: await page.locator('a[href*="/post/"]').count(),
    });
    const structuredById = new Map(
      structuredItems.map((item) => {
        const post = searchItemToPost(item);
        return [post?.id || item.href, item] as const;
      }),
    );
    const fallbackPosts = [...domItems, ...structuredItems]
      .map((item) => {
        const post = searchItemToPost(item);
        if (!post) return null;
        const structured = structuredById.get(post.id);
        if (structured?.timestamp) post.timestamp = structured.timestamp;
        return post;
      })
      .filter((post): post is ThreadsPost => Boolean(post));
    const uniquePosts = new Map<string, ThreadsPost>();
    for (const post of fallbackPosts) {
      const previous = uniquePosts.get(post.id);
      if (!previous || (!previous.timestamp && post.timestamp)) uniquePosts.set(post.id, post);
    }
    const posts = [...uniquePosts.values()].slice(0, MAX_ITEMS_PER_KEYWORD);
    const result: ThreadsPost[] = [];
    let exact = 0;
    let repliesSkipped = 0;

    for (const post of posts) {
      if (!containsExactPhrase(post.content, keyword)) continue;
      exact += 1;
      if (structuredReplyFlags.get(post.id) === true || replyFlags.get(post.id) === true) {
        repliesSkipped += 1;
        continue;
      }
      result.push(post);
    }

    log(`Search ${JSON.stringify(keyword)} completed`, {
      raw: posts.length,
      exact,
      repliesSkipped,
      root: result.length,
    });
    return result;
  } catch (error) {
    log(`Search failed for ${JSON.stringify(keyword)}`, String(error));
    return [];
  } finally {
    await page.close();
  }
}

async function telegramRequest<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json()) as { ok?: boolean; result?: T; description?: string };
  if (!response.ok || !payload.ok) throw new Error(`Telegram ${method} failed: ${payload.description || response.status}`);
  return payload.result as T;
}

async function findChatId(state: StoredState): Promise<number> {
  const configured = Number(process.env.TELEGRAM_CHAT_ID || '');
  if (Number.isFinite(configured) && configured !== 0) return configured;
  if (state.chatId) return state.chatId;

  const updates = await telegramRequest<Array<{ message?: { chat?: { id?: number; type?: string } } }>>('getUpdates');
  const update = [...updates].reverse().find((item) => item.message?.chat?.type === 'private' && item.message.chat.id);
  if (!update?.message?.chat?.id) {
    throw new Error('Telegram chat not found. Open the bot and press Start, then run the workflow again.');
  }
  state.chatId = update.message.chat.id;
  return state.chatId;
}

function formatPost(post: ThreadsPost, keyword: string): string {
  const text = post.content.length > 2800 ? `${post.content.slice(0, 2800).trim()}…` : post.content;
  const username = post.author.username || 'не указан';
  return [
    '🔎 <b>Найден коммерческий запрос</b>',
    '',
    `Ключ: <code>${escapeHtml(keyword)}</code>`,
    `Автор: @${escapeHtml(username)}`,
    `Время: ${escapeHtml(post.timestamp || 'не указано')}`,
    '',
    escapeHtml(text),
    '',
    `🔗 <a href="${escapeHtml(absoluteUrl(post.url))}">Открыть пост</a>`,
  ].join('\n');
}

async function main(): Promise<void> {
  if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is missing');
  if (!Number.isFinite(MAX_POST_AGE_MINUTES) || MAX_POST_AGE_MINUTES < 1) throw new Error('MAX_POST_AGE_MINUTES must be positive');

  const state = await loadState();
  const chatId = await findChatId(state);
  const { browser, context } = await createContext();
  const keywords = keywordsFromEnv();
  let sent = 0;

  try {
    for (const keyword of keywords) {
      const posts = await searchKeyword(context, keyword);
      for (const post of posts) {
        const id = post.id || postIdFromUrl(post.url);
        if (!id || !isRecentTimestamp(post.timestamp, MAX_POST_AGE_MINUTES)) {
          log(`Skipping old or undated post for ${JSON.stringify(keyword)}`, { timestamp: post.timestamp });
          continue;
        }
        if (state.sentPostIds[id]) continue;

        await telegramRequest('sendMessage', {
          chat_id: chatId,
          text: formatPost(post, keyword),
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
        state.sentPostIds[id] = new Date().toISOString();
        await saveState(state);
        sent += 1;
      }
    }
  } finally {
    await browser.close();
  }

  await saveState(state);
  log(`Scan completed: ${sent} new post(s) sent`);
}

await main();
