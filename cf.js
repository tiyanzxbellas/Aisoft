import { request, Agent, setGlobalDispatcher, interceptors } from 'undici';
import tls from 'tls';

const UA_POOL = [
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    ch: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    pf: '"Windows"'
  },
  {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    ch: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    pf: '"macOS"'
  },
  {
    ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    ch: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    pf: '"Linux"'
  },
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    ch: '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    pf: '"Windows"'
  }
];

const defaultCiphers = tls.DEFAULT_CIPHERS.split(':');
const shuffledCiphers = [
  defaultCiphers[1],
  defaultCiphers[2],
  defaultCiphers[0],
  ...defaultCiphers.slice(3)
].join(':');

const agent = new Agent({
  allowH2: true,
  keepAliveTimeout: 30000,
  keepAliveMaxTimeout: 60000,
  connect: {
    ciphers: shuffledCiphers,
    rejectUnauthorized: true
  }
}).compose(
  interceptors.redirect({ maxRedirections: 5 }),
  interceptors.retry({ maxRetries: 2 })
);

setGlobalDispatcher(agent);

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function pickUA() {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}

// Simple in-memory cookie jar for Cloudflare
let cachedCfCookies = null;
let cachedCfCookiesTime = 0;

async function getCfCookies(baseOrigin) {
  // Cache for 5 minutes
  if (cachedCfCookies && Date.now() - cachedCfCookiesTime < 5 * 60 * 1000) {
    return cachedCfCookies;
  }
  try {
    const ua = pickUA();
    const { headers } = await request(baseOrigin, {
      method: 'GET',
      headers: {
        'User-Agent': ua.ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Sec-Ch-Ua': ua.ch,
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': ua.pf,
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1'
      },
      headersTimeout: 3000,
      bodyTimeout: 3000,
    });
    const setCookie = headers['set-cookie'];
    if (setCookie) {
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
      const cookieStr = cookies.map(c => c.split(';')[0]).join('; ');
      cachedCfCookies = cookieStr;
      cachedCfCookiesTime = Date.now();
      return cookieStr;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

export async function proxyFetch(targetUrl, opts = {}) {
  const urlObj = new URL(targetUrl);
  const originUrl = `${urlObj.protocol}//${urlObj.host}`;
  const customSecret = opts.secret || process.env.PROXY_SECRET || 'animein-secure-proxy-key-123';
  const extraHeaders = opts.headers || {};

  let lastErr = null;
  let cfCookies = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const ua = pickUA();
    // Only fetch cookies after first 403 attempt to avoid overhead
    if (attempt > 0) {
      cfCookies = await getCfCookies(originUrl).catch(() => null);
    }

    const headers = {
      'Host': urlObj.host,
      'User-Agent': ua.ua,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      'Origin': originUrl,
      'Referer': `${originUrl}/`,
      'X-Requested-With': 'XMLHttpRequest',
      'X-Proxy-Secret': customSecret,
      'Sec-Ch-Ua': ua.ch,
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': ua.pf,
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      ...extraHeaders
    };

    if (cfCookies) {
      headers['Cookie'] = cfCookies;
    }

    try {
      const { statusCode, headers: resHeaders, body } = await request(targetUrl, {
        method: 'GET',
        headers,
        headersTimeout: 5000,
        bodyTimeout: 8000,
      });

      const text = await body.text();

      if (statusCode === 200) {
        try {
          return JSON.parse(text);
        } catch {
          // Not JSON, return raw
          return { raw: text };
        }
      }

      // Try to parse error body
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {}

      const errMsg = parsed?.message || text?.slice(0, 500) || `Status ${statusCode}`;
      const err = new Error(parsed?.message ? `${parsed.message} (status ${statusCode})` : `Target returned status ${statusCode}: ${errMsg}`);
      err.statusCode = statusCode;
      err.body = parsed || text;
      err.headers = resHeaders;

      // If 403 and message contains "Direct API Proxy access is blocked", we should retry with different strategy
      if (statusCode === 403 && attempt < 2) {
        // Rotate secret attempts, clear cookie cache and retry
        cachedCfCookies = null;
        await sleep(300 + attempt * 500);
        lastErr = err;
        continue;
      }

      throw err;
    } catch (err) {
      if (err.statusCode) throw err; // already handled
      lastErr = err;
      if (attempt < 2) {
        await sleep(400 + attempt * 600);
        continue;
      }
      throw new Error(`Target fetch failed after ${attempt + 1} attempts: ${err.message}`);
    }
  }
  throw lastErr;
}

// Generic JSON fetch with retries for fallback APIs like Jikan (no special headers)
export async function fetchJson(url, options = {}) {
  const ua = pickUA();
  let lastErr = null;
  for (let i = 0; i < 2; i++) {
    try {
      const { statusCode, body } = await request(url, {
        method: 'GET',
        headers: {
          'User-Agent': ua.ua,
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          ...options.headers
        },
        headersTimeout: 5000,
        bodyTimeout: 8000,
      });
      const txt = await body.text();
      if (statusCode !== 200) {
        throw new Error(`Jikan returned ${statusCode}: ${txt.slice(0, 200)}`);
      }
      return JSON.parse(txt);
    } catch (e) {
      lastErr = e;
      if (i < 1) await sleep(300 + i * 400);
    }
  }
  throw lastErr;
}

export async function proxyStream(targetUrl, incomingHeaders = {}) {
  const ua = pickUA();
  const urlObj = new URL(targetUrl);
  const cfCookies = await getCfCookies(`${urlObj.protocol}//${urlObj.host}`).catch(() => null);

  const headersToSend = {
    'Host': urlObj.host,
    'User-Agent': ua.ua,
    'Accept': incomingHeaders['accept'] || '*/*',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'Origin': 'https://animeinweb.com',
    'Referer': 'https://animeinweb.com/',
    'X-Requested-With': 'XMLHttpRequest',
    'X-Proxy-Secret': process.env.PROXY_SECRET || 'animein-secure-proxy-key-123',
    'Sec-Ch-Ua': ua.ch,
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': ua.pf,
    'Sec-Fetch-Dest': 'video',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': 'cross-site',
    'Connection': 'keep-alive'
  };

  if (cfCookies) headersToSend['Cookie'] = cfCookies;
  if (incomingHeaders['range']) headersToSend['Range'] = incomingHeaders['range'];

  try {
    const { statusCode, headers, body } = await request(targetUrl, {
      method: 'GET',
      headers: headersToSend,
    });
    return { statusCode, headers, body };
  } catch (err) {
    throw err;
  }
}

// Helper for debugging secret rotation (used by /v1/debug endpoint)
export async function testSecrets(targetUrl, secrets) {
  const results = [];
  for (const sec of secrets) {
    try {
      const data = await proxyFetch(targetUrl, { secret: sec });
      results.push({ secret: sec, success: true, status: 200, sample: JSON.stringify(data).slice(0, 200) });
    } catch (e) {
      results.push({ secret: sec, success: false, status: e.statusCode || 0, message: e.message, body: e.body });
    }
  }
  return results;
}
