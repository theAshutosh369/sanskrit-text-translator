import { chromium } from 'playwright';

const CHATGPT_URL = 'https://chatgpt.com/';
const SYSTEM_PROMPT = `You are a scholarly Sanskrit-to-English translator working on an OCR Sanskrit text.
Translate ONLY the supplied units.

HARD RULES:
1. Preserve every Sanskrit source EXACTLY as supplied. Do not correct OCR, spelling, punctuation, sandhi, spacing, or numbering.
2. Return exactly one JSON object for every supplied unit, in exactly the same order.
3. Each object MUST have exactly these keys: "sanskrit" and "english".
4. The "sanskrit" value MUST be an exact character-for-character copy of the supplied Sanskrit unit.
5. If a unit ends with a verse number, the English translation MUST end with that exact same number.
6. Translate headings and prose as independent units.
7. Do not omit, merge, split, reorder, renumber, correct, normalize, or invent units.
8. Do not add commentary, notes, titles, markdown, or explanations.
9. Use scholarly but readable English. Retain important technical Sanskrit terms in transliteration when useful.
10. Return JSON only. No markdown fences.`;

function parseJson(text) {
  const cleaned = String(text || '').trim()
    .replace(/^```json\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const first = cleaned.indexOf('[');
  const last = cleaned.lastIndexOf(']');
  if (first >= 0 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
  return JSON.parse(cleaned);
}

async function findComposer(page, timeoutMs = 120000) {
  const selectors = [
    'textarea',
    '[contenteditable="true"]',
    'div[role="textbox"]'
  ];
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    for (const selector of selectors) {
      const loc = page.locator(selector);
      const count = await loc.count().catch(() => 0);
      if (!count) continue;
      for (let i = count - 1; i >= 0; i--) {
        const item = loc.nth(i);
        if (await item.isVisible().catch(() => false)) return item;
      }
    }
    await page.waitForTimeout(500);
  }

  throw new Error(`Could not find the ChatGPT message composer after ${Math.round(timeoutMs / 1000)} seconds. Check that ChatGPT is loaded and you are signed in.`);
}

async function sendMessage(page, prompt) {
  const composer = await findComposer(page);
  await composer.click();
  await composer.fill(prompt);

  const sendSelectors = [
    'button[aria-label*="Send"]',
    'button[data-testid*="send"]',
    'button:has(svg)'
  ];
  for (const selector of sendSelectors) {
    const loc = page.locator(selector);
    const count = await loc.count();
    for (let i = count - 1; i >= 0; i--) {
      const button = loc.nth(i);
      if (await button.isVisible().catch(() => false) && await button.isEnabled().catch(() => false)) {
        const aria = await button.getAttribute('aria-label').catch(() => '');
        if (selector === 'button:has(svg)' && !String(aria || '').toLowerCase().includes('send')) continue;
        await button.click();
        return;
      }
    }
  }

  await composer.press('Enter');
}

async function assistantMessages(page) {
  const selectors = [
    '[data-message-author-role="assistant"]',
    'article[data-testid*="conversation-turn"]'
  ];
  for (const selector of selectors) {
    const loc = page.locator(selector);
    const count = await loc.count();
    if (count) return loc;
  }
  return page.locator('main article');
}

async function waitForAssistantResponse(page, beforeCount, timeoutMs, onProgress) {
  const started = Date.now();
  let lastText = '';
  let stableSince = 0;
  while (Date.now() - started < timeoutMs) {
    const messages = await assistantMessages(page);
    const count = await messages.count().catch(() => 0);
    if (count > beforeCount) {
      const latest = messages.nth(count - 1);
      const text = (await latest.innerText().catch(() => '')).trim();
      if (text) {
        if (text === lastText) {
          if (!stableSince) stableSince = Date.now();
          if (Date.now() - stableSince >= 1200) return text;
        } else {
          lastText = text;
          stableSince = Date.now();
        }
        onProgress?.(Math.min(99, Math.max(1, Math.round((Date.now() - started) / timeoutMs * 100))));
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`Timed out waiting for ChatGPT response after ${Math.round(timeoutMs / 1000)} seconds.`);
}

export class ChatGPTBrowser {
  constructor({profileDir, headless = false, timeoutMs = 180000, log = () => {}} = {}) {
    this.profileDir = profileDir;
    this.headless = headless;
    this.timeoutMs = timeoutMs;
    this.log = log;
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async connect() {
    this.log('Starting ChatGPT browser automation…');
    this.log(`Using persistent browser profile: ${this.profileDir}`);

    this.context = await chromium.launchPersistentContext(this.profileDir, {
      headless: this.headless,
      viewport: { width: 1440, height: 1000 },
      args: ['--disable-blink-features=AutomationControlled']
    });

    this.browser = this.context.browser();
    this.page = this.context.pages()[0] || await this.context.newPage();

    // Do not wait for DOMContentLoaded here. ChatGPT can keep loading network
    // resources for a long time, which caused a false startup failure even
    // though the page was already usable. `commit` only waits for navigation
    // to be committed, after which we independently wait for the composer.
    this.log('Opening ChatGPT…');
    try {
      await this.page.goto(CHATGPT_URL, {waitUntil: 'commit', timeout: 30000});
      this.log(`Navigation committed: ${this.page.url()}`);
    } catch (error) {
      if (/timeout/i.test(String(error?.message || error))) {
        this.log('Initial navigation timed out, but the browser may still be loading ChatGPT. Continuing to wait for the page…');
      } else {
        throw error;
      }
    }

    await this.page.waitForTimeout(2000);
    this.log(`Current ChatGPT URL: ${this.page.url()}`);

    if (/auth|login/i.test(this.page.url())) {
      this.log('ChatGPT is not signed in. Sign in in the opened browser window; automation will wait up to 5 minutes.');
      try {
        await this.page.waitForURL(/chatgpt\.com\/(?!auth|login)/i, {timeout: 300000});
      } catch {
        // The URL can remain unchanged after authentication while the app
        // becomes usable, so composer detection below is the real readiness check.
      }
      this.log(`URL after sign-in wait: ${this.page.url()}`);
    }

    this.log('Waiting for the ChatGPT message composer…');
    await findComposer(this.page, 120000);
    this.log('ChatGPT composer detected. Ready.');
  }

  async translatePage(units, pageNumber, totalPages) {
    const payload = units.map((u, i) => ({unit: i + 1, type: u.type, sanskrit: u.source}));
    const prompt = `${SYSTEM_PROMPT}\n\nYou are translating PAGE ${pageNumber} of ${totalPages}.\nTranslate every unit below in one single response.\n\nINPUT:\n${JSON.stringify(payload, null, 2)}`;

    const messages = await assistantMessages(this.page);
    const beforeCount = await messages.count().catch(() => 0);
    this.log(`Page ${pageNumber}/${totalPages}: sending ${units.length} units in ONE batch…`);
    await sendMessage(this.page, prompt);
    const response = await waitForAssistantResponse(this.page, beforeCount, this.timeoutMs, p => {
      if (p % 10 === 0) this.log(`Page ${pageNumber}/${totalPages}: waiting for ChatGPT response (${p}%)…`);
    });
    this.log(`Page ${pageNumber}/${totalPages}: response received (${response.length.toLocaleString()} chars).`);
    const pairs = parseJson(response);
    if (!Array.isArray(pairs)) throw new Error(`Page ${pageNumber}: ChatGPT did not return a JSON array.`);
    if (pairs.length !== units.length) throw new Error(`Page ${pageNumber}: expected ${units.length} units, received ${pairs.length}.`);
    return units.map((u, i) => ({
      ...u,
      translatedSource: String(pairs[i]?.sanskrit ?? ''),
      translation: String(pairs[i]?.english ?? '')
    }));
  }

  async close() {
    if (this.context) await this.context.close().catch(() => {});
    this.context = null;
    this.browser = null;
    this.page = null;
  }
}
