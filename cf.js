import { request, Agent, setGlobalDispatcher, interceptors } from 'undici';
import tls from 'tls';

const UA_POOL = [
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    ch: '"Not)A;Brand";v="99", "Google Chrome";v="150", "Chromium";v="150"',
    pf: '"Windows"'
  },
  {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    ch: '"Not)A;Brand";v="99", "Google Chrome";v="150", "Chromium";v="150"',
    pf: '"macOS"'
  },
  {
    ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    ch: '"Not)A;Brand";v="99", "Google Chrome";v="150", "Chromium";v="150"',
    pf: '"Linux"'
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
  keepAliveTimeout: 15000,
  connect: {
    ciphers: shuffledCiphers
  }
}).compose(
  interceptors.redirect({ maxRedirections: 5 })
);

setGlobalDispatcher(agent);

export async function proxyFetch(targetUrl) {
  const id = UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
  const urlObj = new URL(targetUrl);
  const originUrl = `${urlObj.protocol}//${urlObj.host}`;

  try {
    const { statusCode, body } = await request(targetUrl, {
      method: 'GET',
      headers: {
        'Host': urlObj.host,
        'User-Agent': id.ua,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Origin': originUrl,
        'Referer': `${originUrl}/`,
        'X-Requested-With': 'XMLHttpRequest',
        'X-Proxy-Secret': 'animein-secure-proxy-key-123',
        'Sec-Ch-Ua': id.ch,
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': id.pf,
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Connection': 'keep-alive'
      },
    });

    if (statusCode !== 200) {
        throw new Error(`Target returned status ${statusCode}`);
    }

    const text = await body.text();
    return JSON.parse(text);
  } catch (err) {
    throw err;
  }
}

export async function proxyStream(targetUrl, incomingHeaders) {
  const id = UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
  const urlObj = new URL(targetUrl);

  const headersToSend = {
    'Host': urlObj.host,
    'User-Agent': id.ua,
    'Accept': incomingHeaders['accept'] || '*/*',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'Origin': 'https://animein.net',
    'Referer': 'https://animein.net/',
    'X-Requested-With': 'XMLHttpRequest',
    'X-Proxy-Secret': 'animein-secure-proxy-key-123',
    'Sec-Ch-Ua': id.ch,
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': id.pf,
    'Sec-Fetch-Dest': 'video',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': 'cross-site',
    'Connection': 'keep-alive'
  };

  if (incomingHeaders['range']) {
    headersToSend['Range'] = incomingHeaders['range'];
  }

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