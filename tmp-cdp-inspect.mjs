// Temporary CDP inspection script for market UI comparison.
const CDP_BASE = 'http://127.0.0.1:9222';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPage(url) {
  const res = await fetch(`${CDP_BASE}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!res.ok) throw new Error(`openPage ${res.status}`);
  return res.json();
}

async function attach(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { ws, send };
}

async function navigate(wsUrl, url) {
  const { ws, send } = await attach(wsUrl);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url });
  await sleep(5500);
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const shot = async (file) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const fs = await import('node:fs');
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
  };
  return { ws, send, evalJs, shot };
}

const INSPECT_MARKET = `(() => {
  const pick = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      text: (el.textContent || '').trim().slice(0, 120),
      cls: (el.className || '').toString().slice(0, 160),
      color: cs.color,
      bg: cs.backgroundColor,
      border: cs.borderColor,
      radius: cs.borderRadius,
      h: el.getBoundingClientRect().height,
    };
  };
  const header = document.querySelector('header, [class*="header"]');
  const buttons = [...document.querySelectorAll('button')].map(pick);
  const selects = [...document.querySelectorAll('[role="combobox"], select, [class*="select"]')].map((el) => pick(el));
  const cards = [...document.querySelectorAll('[class*="ant-card"], [data-testid="assistant-item"]')];
  const navText = [...document.querySelectorAll('nav a, nav span, aside a')].map((el) => (el.textContent || '').trim()).filter(Boolean).slice(0, 30);
  const bodyText = document.body.innerText.slice(0, 2500);
  return {
    title: document.title,
    url: location.href,
    header: header ? pick(header) : null,
    buttons,
    selects,
    cardCount: cards.length,
    cardSamples: cards.slice(0, 3).map((c) => ({
      text: (c.innerText || '').trim().slice(0, 400),
      tags: [...c.querySelectorAll('[class*="tag"]')].map((t) => (t.textContent || '').trim()).filter(Boolean).slice(0, 12),
    })),
    navText,
    bodyText,
  };
})()`;

const INSPECT_DETAIL = `(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /chat|对话|开始/i.test(b.textContent || ''));
  const cs = btn ? getComputedStyle(btn) : null;
  const buttons = [...document.querySelectorAll('button')].map((el) => {
    const s = getComputedStyle(el);
    return { text: (el.textContent || '').trim().slice(0, 60), bg: s.backgroundColor, color: s.color, border: s.borderColor, radius: s.borderRadius, h: el.getBoundingClientRect().height };
  });
  const vars = getComputedStyle(document.documentElement).getPropertyValue('--lobe-colorPrimary') || '';
  return {
    title: document.title,
    url: location.href,
    chatButton: btn ? { text: (btn.textContent || '').trim(), bg: cs.backgroundColor, color: cs.color, border: cs.borderColor, radius: cs.borderRadius, h: btn.getBoundingClientRect().height } : null,
    buttons,
    primaryVar: vars,
    bodyText: document.body.innerText.slice(0, 1800),
  };
})()`;

const target = process.argv[2];
const outJson = process.argv[3];
const shotPng = process.argv[4];
const detail = process.argv[5] === 'detail';

const page = await openPage(target);
const cdp = await navigate(page.webSocketDebuggerUrl, target);
const result = detail ? await cdp.evalJs(INSPECT_DETAIL) : await cdp.evalJs(INSPECT_MARKET);
if (shotPng) await cdp.shot(shotPng);
const fs = await import('node:fs');
fs.writeFileSync(outJson, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2).slice(0, 4000));
cdp.ws.close();
