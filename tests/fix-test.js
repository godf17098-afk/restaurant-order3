'use strict';
// Tests for restaurant-order3 fixes: validation, anti-spoofing, status whitelist,
// rate limiting, upload hardening, ghost-retry safety.
const path = require('path');
const ROOT = path.join(__dirname, '..');
const WebSocket = require(path.join(ROOT, 'node_modules', 'ws'));
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3100';
const WS_BASE = BASE.replace(/^http/, 'ws');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

async function postJson(p, body, ip) {
  const headers = { 'Content-Type': 'application/json' };
  if (ip) headers['X-Forwarded-For'] = ip;
  const res = await fetch(BASE + p, { method: 'POST', headers, body: JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

function wsOpen() {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_BASE);
    ws.on('open', () => resolve(ws));
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('== 1. server-derived item data (name/price cannot be spoofed) ==');
  {
    const r = await postJson('/api/order', {
      table: 'T9',
      items: [{ id: 1, name: '<img src=x onerror=alert(1)>', price: 9999, qty: 2 }],
      source: 'customer',
      clientOrderId: 'spoof-' + Date.now(),
    }, '10.9.0.1');
    check('order accepted', r.status === 200 && r.body.ok, r.body);
    const item = r.body.ticket && r.body.ticket.items[0];
    check('name comes from server menu', item && item.name === 'ข้าวผัดกระเทียม', item);
    check('no injected price field stored', item && item.price === undefined, item);
    check('qty preserved', item && item.qty === 2, item);
  }

  console.log('== 2. bad tables / payloads rejected ==');
  {
    for (const table of ['<script>alert(1)</script>', 'T".x', '', 'x'.repeat(21), null]) {
      const r = await postJson('/api/order', { table, items: [{ id: 1, qty: 1 }] }, '10.9.0.2');
      check('table rejected: ' + JSON.stringify(table).slice(0, 30), r.status === 400, r.body);
    }
    const r = await postJson('/api/order', { table: 'T9', items: [] }, '10.9.0.2');
    check('empty items rejected', r.status === 400, r.body);
    const r2 = await postJson('/api/order', { table: 'T9', items: 'nope' }, '10.9.0.2');
    check('non-array items rejected', r2.status === 400, r2.body);
    const huge = await postJson('/api/order', { table: 'T9', items: Array.from({ length: 101 }, () => ({ id: 1, qty: 1 })) }, '10.9.0.2');
    check('too many line items rejected', huge.status === 400, huge.body);
  }

  console.log('== 3. qty / unknown item / duplicate merge ==');
  {
    const r = await postJson('/api/order', {
      table: 'T9',
      items: [
        { id: 1, qty: 0 },
        { id: 1, qty: 2 },
        { id: 1, qty: 3 },
        { id: 99999, qty: 4 },
        { id: 2, qty: 500 },
      ],
    }, '10.9.0.3');
    check('order accepted with only valid lines', r.status === 200, r.body);
    const items = r.body.ticket.items;
    check('duplicate ids merged to one line', items.length === 1, items);
    check('qty clamped/merged (2+3=5)', items[0] && items[0].qty === 5, items[0]);
    check('unknown item dropped', !items.some(i => i.id === 99999), items);
  }

  console.log('== 4. note length capped at 200 ==');
  {
    const r = await postJson('/api/order', { table: 'T9', items: [{ id: 1, qty: 1 }], note: 'ก'.repeat(500) }, '10.9.0.4');
    check('order accepted', r.status === 200, r.body);
    check('note <= 200 chars', r.body.ticket && r.body.ticket.note.length === 200, r.body.ticket && r.body.ticket.note.length);
  }

  console.log('== 5. closed menu item cannot be ordered ==');
  {
    await postJson('/api/menu/1/availability', { available: false }, '10.9.0.5');
    const r = await postJson('/api/order', { table: 'T9', items: [{ id: 1, qty: 1 }] }, '10.9.0.5');
    check('order of closed item rejected', r.status === 400, r.body);
    const ok = await postJson('/api/order', { table: 'T9', items: [{ id: 1, qty: 1 }, { id: 2, qty: 1 }] }, '10.9.0.5');
    check('open item still orderable', ok.status === 200 && ok.body.ticket.items.length === 1, ok.body);
    await postJson('/api/menu/1/availability', { available: true }, '10.9.0.5');
    const back = await fetch(BASE + '/api/menu').then(r => r.json());
    const m1 = back.menu.flatMap(c => c.items).find(i => i.id === 1);
    check('menu item re-opened', m1 && m1.available === true, m1);
  }

  console.log('== 6. WS status whitelist + itemIndex validation ==');
  {
    const ws = await wsOpen();
    const got = [];
    ws.on('message', (raw) => { try { got.push(JSON.parse(raw)); } catch {} });
    const r = await postJson('/api/order', { table: 'T8', items: [{ id: 3, qty: 1 }] }, '10.9.0.6');
    const num = r.body.ticket.num;
    await sleep(150);

    ws.send(JSON.stringify({ type: 'set_status', num, status: 'HACKED' }));
    await sleep(150);
    let orders = await fetch(BASE + '/api/table/T8/orders').then(x => x.json());
    check('invalid status ignored', orders.orders.find(t => t.num === num).status === 'new', orders.orders);

    ws.send(JSON.stringify({ type: 'increment_made', num, itemIndex: 99 }));
    await sleep(150);
    orders = await fetch(BASE + '/api/table/T8/orders').then(x => x.json());
    check('out-of-range itemIndex ignored', orders.orders.find(t => t.num === num).items[0].madeQty === 0, orders.orders);

    ws.send(JSON.stringify({ type: 'set_status', num, status: 'cooking' }));
    await sleep(150);
    orders = await fetch(BASE + '/api/table/T8/orders').then(x => x.json());
    check('valid status still works', orders.orders.find(t => t.num === num).status === 'cooking', orders.orders);
    ws.close();
  }

  console.log('== 7. ghost retry after delete creates a real ticket ==');
  {
    const id = 'ghost-' + Date.now();
    const first = await postJson('/api/order', { table: 'T7', items: [{ id: 4, qty: 1 }], clientOrderId: id }, '10.9.0.7');
    const num = first.body.ticket.num;
    const ws = await wsOpen();
    ws.send(JSON.stringify({ type: 'delete_ticket', num }));
    await sleep(250);
    const retry = await postJson('/api/order', { table: 'T7', items: [{ id: 4, qty: 1 }], clientOrderId: id }, '10.9.0.7');
    check('retry succeeds', retry.status === 200, retry.body);
    check('retry created a NEW ticket (not stale num)', retry.body.ticket.num !== num, { old: num, now: retry.body.ticket && retry.body.ticket.num });
    const kitchen = await fetch(BASE + '/api/table/T7/orders').then(x => x.json());
    check('kitchen actually has the order', kitchen.orders.some(t => t.num === retry.body.ticket.num), kitchen.orders);
    ws.close();
  }

  console.log('== 8. upload hardening (html/svg rejected, png accepted) ==');
  {
    const mk = (type, name, bytes) => {
      const fd = new FormData();
      fd.append('image', new Blob([bytes], { type }), name);
      return fetch(BASE + '/api/menu/2/image', { method: 'POST', body: fd, headers: { 'X-Forwarded-For': '10.9.0.8' } });
    };
    const html = await mk('text/html', 'evil.html', '<script>alert(1)</script>');
    check('text/html upload rejected', html.status === 400, html.status);
    const svg = await mk('image/svg+xml', 'evil.svg', '<svg onload="alert(1)"></svg>');
    check('image/svg+xml upload rejected', svg.status === 400, svg.status);
    const js = await mk('application/javascript', 'evil.js', 'alert(1)');
    check('application/javascript upload rejected', js.status === 400, js.status);

    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0300050001a5f645400000000049454e44ae426082', 'hex');
    const ok = await mk('image/png', 'ok.png', png);
    check('image/png upload accepted', ok.status === 200, ok.status);
    const body = await ok.json().catch(() => ({}));
    check('stored filename has random suffix + .png', /^\/uploads\/menu-2-\d+-[0-9a-f]{8}\.png$/.test(body.image || ''), body);
    if (body.image) await fetch(BASE + '/api/menu/2/image', { method: 'DELETE' });
  }

  console.log('== 9. HTTP rate limit ==');
  {
    let limited = 0;
    for (let i = 0; i < 40; i++) {
      const r = await postJson('/api/order', { table: 'T6', items: [{ id: 2, qty: 1 }] }, '10.9.0.9');
      if (r.status === 429) limited++;
    }
    check('some requests got 429', limited > 0, { limited });
    const otherIp = await postJson('/api/order', { table: 'T6', items: [{ id: 2, qty: 1 }] }, '10.9.0.10');
    check('other IP unaffected', otherIp.status === 200, otherIp.status);
  }

  console.log('== 10. WS oversized payload rejected ==');
  {
    const ws = await wsOpen();
    const closed = await new Promise((resolve) => {
      ws.on('close', () => resolve(true));
      ws.send(JSON.stringify({ type: 'join_table', table: 'T1', pad: 'x'.repeat(70 * 1024) }));
      setTimeout(() => resolve(false), 1500);
    });
    check('connection closed for >64KB frame', closed, closed);
  }

  console.log('== 11. server enforces closed salmon quota ==');
  {
    const ws = await wsOpen();
    ws.send(JSON.stringify({ type: 'set_salmon_status', table: 'TS1', closed: true }));
    await sleep(250);
    const closed = await postJson('/api/order', { table: 'TS1', items: [{ id: 22, qty: 1 }] }, '10.9.0.11');
    check('salmon order rejected while table closed', closed.status === 409, closed.body);
    const mixed = await postJson('/api/order', { table: 'TS1', items: [{ id: 22, qty: 1 }, { id: 3, qty: 1 }] }, '10.9.0.11');
    check('mixed salmon order rejected', mixed.status === 409, mixed.body);
    ws.send(JSON.stringify({ type: 'set_salmon_status', table: 'TS1', closed: false }));
    await sleep(250);
    const open = await postJson('/api/order', { table: 'TS1', items: [{ id: 22, qty: 1 }] }, '10.9.0.11');
    check('salmon order accepted after re-open', open.status === 200, open.body);
    ws.close();
  }

  console.log(`\n${fail === 0 ? '🎉 ALL PASSED' : '⚠️ FAILURES'} — ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(2); });
