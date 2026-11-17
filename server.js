const express = require('express');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, maxPayload: 64 * 1024 });
wss.on('error', (err) => console.error('WS server error:', err.message));
let wsSeq = 0;

// Persistent data directory. Priority:
//   1. DATA_DIR (explicit override)
//   2. RAILWAY_VOLUME_MOUNT_PATH (set automatically by Railway when a volume is attached)
//   3. ./data next to the app
// On Railway, attach a volume with mount path /app/data so orders AND images survive
// restarts and redeploys.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : (process.env.RAILWAY_VOLUME_MOUNT_PATH
      ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH)
      : path.join(__dirname, 'data'));
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const uploadsDir = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

if (process.env.RAILWAY_ENVIRONMENT && !process.env.DATA_DIR && !process.env.RAILWAY_VOLUME_MOUNT_PATH) {
  console.warn('\n⚠️  Railway: ยังไม่ได้ mount Volume — ข้อมูลออเดอร์และรูปเมนูจะหายเมื่อ deploy ใหม่');
  console.warn('   แก้ที่ Railway → service → Volumes → Add Volume → Mount path: /app/data\n');
}

// Older versions stored images in the ephemeral public/uploads folder. Move any files
// found there into the persistent uploads dir once, keeping the same /uploads/<name> URL.
const legacyUploadsDir = path.join(__dirname, 'public', 'uploads');
function migrateLegacyUploads() {
  try {
    if (!fs.existsSync(legacyUploadsDir)) return;
    for (const name of fs.readdirSync(legacyUploadsDir)) {
      const from = path.join(legacyUploadsDir, name);
      const to = path.join(uploadsDir, name);
      if (!fs.statSync(from).isFile() || fs.existsSync(to)) continue;
      fs.renameSync(from, to);
      console.log(`↪ ย้ายรูปเดิมไปเก็บถาวร: ${name}`);
    }
  } catch (err) {
    console.error('ย้ายรูปเดิมไม่สำเร็จ:', err.message);
  }
}
migrateLegacyUploads();

app.use('/uploads', express.static(uploadsDir, { dotfiles: 'deny', maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.redirect('/staff.html'));

// อนุญาตเฉพาะชนิดรูปที่เบราว์เซอร์แสดงเป็นภาพได้ — ไม่รับ SVG/HTML/JS
const IMAGE_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = IMAGE_EXT[file.mimetype];
    if (!ext) return cb(new Error('ชนิดไฟล์รูปไม่รองรับ'));
    const id = parseInt(req.params.id, 10) || 0;
    cb(null, `menu-${id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (!IMAGE_EXT[file.mimetype]) return cb(new Error('ไฟล์ต้องเป็น JPG, PNG, WEBP หรือ GIF เท่านั้น'));
    cb(null, true);
  },
});

let tickets = [];
let ticketCounter = 1001;
let billHistory = []; // stores cleared table bills for reporting
let closedSalmonTables = []; // table IDs where staff has manually closed further salmon orders

/* ---------------------------------------------- persistence */

let saveTimer = null;

function menuSnapshot() {
  const out = {};
  for (const cat of MENU) {
    for (const item of cat.items) {
      out[item.id] = { available: item.available !== false, image: item.image || null };
    }
  }
  return out;
}

function saveStateNow() {
  try {
    const payload = JSON.stringify({
      tickets,
      ticketCounter,
      billHistory,
      closedSalmonTables,
      menu: menuSnapshot(),
      savedAt: new Date().toISOString(),
    });
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, payload);
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    console.error('บันทึก state ไม่สำเร็จ:', err.message);
  }
}

// เขียนลงดิสก์แบบ debounce — กันเขียนถี่เกินตอนมีออเดอร์รัว ๆ
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveStateNow(); }, 250);
}

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (Array.isArray(raw.tickets)) tickets = raw.tickets;
    if (Array.isArray(raw.billHistory)) billHistory = raw.billHistory;
    if (Array.isArray(raw.closedSalmonTables)) closedSalmonTables = raw.closedSalmonTables;
    if (Number.isInteger(raw.ticketCounter)) ticketCounter = raw.ticketCounter;

    // คืนสถานะเมนู (เปิด/ปิด + รูป) ที่เคยตั้งไว้
    if (raw.menu && typeof raw.menu === 'object') {
      for (const cat of MENU) {
        for (const item of cat.items) {
          const saved = raw.menu[item.id];
          if (!saved) continue;
          if (typeof saved.available === 'boolean') item.available = saved.available;
          if (typeof saved.image === 'string' && saved.image.startsWith('/uploads/')) {
            // only trust a bare filename, and only keep the image if the file is really there
            const filename = path.basename(saved.image);
            item.image = fs.existsSync(path.join(uploadsDir, filename)) ? `/uploads/${filename}` : null;
          }
        }
      }
    }

    const maxNum = tickets.reduce((m, t) => (Number.isInteger(t.num) && t.num > m ? t.num : m), 1000);
    if (ticketCounter <= maxNum) ticketCounter = maxNum + 1;

    if (tickets.length || billHistory.length) {
      console.log(`↺ โหลดข้อมูลเดิม: ${tickets.length} ออเดอร์, ${billHistory.length} บิล`);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('โหลด state ไม่สำเร็จ:', err.message);
  }
}

// Discord webhook — posts a message to a Discord channel whenever a new order comes in,
// so staff get a phone/desktop notification (with sound) even if the KDS tab isn't open.
// Set DISCORD_WEBHOOK_URL in the environment to override (recommended: rotate the old URL,
// which used to be hard-coded here and is therefore public in git history).
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL
  || 'https://discord.com/api/webhooks/1541771736331321437/B75dd0Mf24hf2pvoWMF4JyRP-vh2ONytlYlfKwYli83SZ2CH3MOlSbwOUFt_QCavIN-W';

function notifyDiscordNewOrder(ticket) {
  if (!DISCORD_WEBHOOK_URL) return;
  try {
    const itemsText = ticket.items.map(i => `• ${i.name} x${i.qty}`).join('\n') || '(ไม่มีรายการ)';
    const payload = JSON.stringify({
      embeds: [{
        title: `🔔 ออเดอร์ใหม่ #${ticket.num} — โต๊ะ ${ticket.table}`,
        description: itemsText,
        color: 0xfbbf24,
        footer: { text: `เวลา ${ticket.time}${ticket.note ? ' · โน้ต: ' + ticket.note : ''}` }
      }]
    });
    const url = new URL(DISCORD_WEBHOOK_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => { res.on('data', () => {}); });
    req.on('error', (err) => console.error('Discord webhook error:', err.message));
    req.write(payload);
    req.end();
  } catch (err) {
    console.error('Discord webhook error:', err.message);
  }
}

const MENU = [
  { cat: 'ข้าว/อูด้ง', color: '#f59e0b', items: [
    { id: 1,  name: 'ข้าวผัดกระเทียม', price: 0 , image: null, available: true },
    { id: 2,  name: 'ข้าวผัดมันเนื้อ', price: 0 , image: null, available: true },
    { id: 3,  name: 'ข้าวสวยญี่ปุ่น', price: 0 , image: null, available: true },
    { id: 4,  name: 'ข้าวหน้าเนื้อตุ๋น', price: 0 , image: null, available: true },
    { id: 5,  name: 'อุด้งเนื้อตุ๋น', price: 0 , image: null, available: true },
  ]},
  { cat: 'ของทอด', color: '#4f8ef7', items: [
    { id: 7,  name: 'เฟรนฟราย', price: 0 , image: null, available: true },
    { id: 8,  name: 'ปีกไก่ทอด(3 ชิ้น)', price: 0 , image: null, available: true },
    { id: 9,  name: 'ซาลาเปาทอด(3 ชิ้น)', price: 0 , image: null, available: true },
    { id: 10, name: 'กุ้งทอด(3 ชิ้น)', price: 0 , image: null, available: true },
    { id: 11, name: 'นักเก็ต(3 ชิ้น)', price: 0 , image: null, available: true },
    { id: 12, name: 'ชีสบอล(3 ชิ้น)', price: 0 , image: null, available: true },
    { id: 13, name: 'หมึกวงทอด(3 ชิ้น)', price: 0 , image: null, available: true },
    { id: 14, name: 'ไก่ป็อบ(5 ชิ้น)', price: 0 , image: null, available: true },
    { id: 21, name: 'ไส้กรอกแดง(3 ชิ้น)', price: 0 , image: null, available: true },
  ]},
  { cat: 'ซาชิมิ', color: '#14b8a6', items: [
    { id: 22, name: 'แซลมอนซาชิมิ(8 ชิ้น)', price: 0 , image: null, available: true },
  ]},
  { cat: 'ของดอง / ยำ', color: '#2dd4a0', items: [
    { id: 15, name: 'แซลมอนดอง', price: 0 , image: null, available: true },
    { id: 16, name: 'กุ้งดอง', price: 0 , image: null, available: true },
    { id: 17, name: 'ไข่ดอง', price: 0 , image: null, available: true },
    { id: 18, name: 'จุ๊เนื้อ', price: 0 , image: null, available: true },
    { id: 19, name: 'ยำเนื้อเย็น', price: 0 , image: null, available: true },
  ]},
  { cat: 'อบเนยชีส/อื่นๆ', color: '#f87171', items: [
    { id: 20, name: 'ถั่วแระ', price: 0 , image: null, available: true },
    { id: 23, name: 'หอยเชลล์อบเนยชีส', price: 0 , image: null, available: true },
    { id: 24, name: 'หอยแมลงภู่อบเนยชีส', price: 0 , image: null, available: true },
    { id: 67, name: 'ชีส', price: 0 , image: null, available: true },
  ]},
  { cat: 'เนื้อวัว', color: '#dc2626', items: [
    { id: 26, name: 'ลิ้นวัว', price: 0 , image: null, available: true },
    { id: 27, name: 'ริบอาย', price: 0 , image: null, available: true },
    { id: 29, name: 'ตับเนื้อ', price: 0 , image: null, available: true },
    { id: 30, name: 'เนื้อหมัก', price: 0 , image: null, available: true },
    { id: 31, name: 'พิคานย่า', price: 0 , image: null, available: true },
    { id: 32, name: 'สันสะโพก', price: 0 , image: null, available: true },
    { id: 33, name: 'ติดมัน', price: 0 , image: null, available: true },
    { id: 34, name: 'ใบพาย', price: 0 , image: null, available: true },
    { id: 35, name: 'ปลาช่อน', price: 0 , image: null, available: true },
    { id: 36, name: 'เนื้อบริสเก็ต (เสือร้องไห้)', price: 0 , image: null, available: true },
    { id: 38, name: 'สันคอ (เนื้อ)', price: 0 , image: null, available: true },
  ]},
  { cat: 'เนื้อหมู', color: '#f472b6', items: [
    { id: 39, name: 'หมูสามชั้น', price: 0 , image: null, available: true },
    { id: 40, name: 'หมูสันนอก', price: 0 , image: null, available: true },
    { id: 41, name: 'หมูสันคอ', price: 0 , image: null, available: true },
    { id: 42, name: 'หมูสามชั้นเกาหลี', price: 0 , image: null, available: true },
    { id: 43, name: 'หมูหมัก', price: 0 , image: null, available: true },
  ]},
  { cat: 'ผัก/ของแปรรูป', color: '#22c55e', items: [
    { id: 44, name: 'ผักกาดหอม', price: 0 , image: null, available: true },
    { id: 45, name: 'ผักกาดขาว', price: 0 , image: null, available: true },
    { id: 46, name: 'เห็ดเข็มทอง', price: 0 , image: null, available: true },
    { id: 47, name: 'เห็ดออรินจิ', price: 0 , image: null, available: true },
    { id: 48, name: 'ข้าวโพดอ่อน', price: 0 , image: null, available: true },
    { id: 49, name: 'ผักบุ้ง', price: 0 , image: null, available: true },
    { id: 50, name: 'ฟักทอง', price: 0 , image: null, available: true },
    { id: 51, name: 'หอมหัวใหญ่', price: 0 , image: null, available: true },
    { id: 52, name: 'แครอท', price: 0 , image: null, available: true },
    { id: 68, name: 'กระหล่ำปลีซอย', price: 0 , image: null, available: true },
    { id: 69, name: 'ข้าวโพดหวาน', price: 0 , image: null, available: true },
    { id: 70, name: 'กระเทียมสด', price: 0 , image: null, available: true },
    { id: 65, name: 'ปูอัด', price: 0 , image: null, available: true },
    { id: 64, name: 'ไส้กรอกชีส', price: 0 , image: null, available: true },
    { id: 66, name: 'สามชั้นพันเห็ดเข็มทอง', price: 0 , image: null, available: true },
  ]},
  { cat: 'ทะเล', color: '#0ea5e9', items: [
    { id: 53, name: 'กุ้ง', price: 0 , image: null, available: true },
    { id: 54, name: 'หอยแมลงภู่', price: 0 , image: null, available: true },
    { id: 55, name: 'ปลาดอลลี่', price: 0 , image: null, available: true },
    { id: 56, name: 'หมึกวง', price: 0 , image: null, available: true },
    { id: 57, name: 'หมึกหนวด', price: 0 , image: null, available: true },
  ]},
  { cat: 'เครื่องเคียง', color: '#a855f7', items: [
    { id: 58, name: 'กิมจิ', price: 0 , image: null, available: true },
    { id: 59, name: 'ยำสาหร่าย', price: 0 , image: null, available: true },
    { id: 60, name: 'ผักดอง 3 รส', price: 0 , image: null, available: true },
    { id: 61, name: 'เนยมันเนื้อ', price: 0 , image: null, available: true },
    { id: 62, name: 'เนย/มาการีน', price: 0 , image: null, available: true },
    { id: 63, name: 'ไข่ไก่', price: 0 , image: null, available: true },
  ]},
];

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

function findMenuItem(id) {
  for (const cat of MENU) {
    const item = cat.items.find(i => i.id === id);
    if (item) return item;
  }
  return null;
}

// Maps a client-generated clientOrderId -> the ticket already created for it, so a retried
// submission (same order, resent because the first response was lost/slow) returns the
// existing ticket instead of creating a duplicate. Entries are pruned after a few minutes.
const recentOrderIds = new Map();
const ORDER_ID_TTL_MS = 5 * 60 * 1000;

function pruneRecentOrderIds() {
  const cutoff = Date.now() - ORDER_ID_TTL_MS;
  for (const [id, entry] of recentOrderIds) {
    if (entry.at < cutoff) recentOrderIds.delete(id);
  }
}

// A retried order may point at a ticket that staff already deleted or a table that was
// already cleared — in that case the cached entry is stale and must not be reported as
// a success (otherwise the customer sees "ordered!" but the kitchen never gets it).
function forgetRecentOrder(num) {
  for (const [id, entry] of recentOrderIds) {
    if (entry.ticket && entry.ticket.num === num) recentOrderIds.delete(id);
  }
}

/* ---------------------------------------------- validation + limits */

const MAX_ORDER_ITEMS = 100;
const MAX_ITEM_QTY = 99;
const MAX_ORDER_QTY = 500;
const MAX_BILL_HISTORY = 5000; // keep recent bills for reports without unbounded memory growth
const TABLE_RE = /^[\p{L}\p{N}_\- ]{1,20}$/u;
const TICKET_STATUSES = new Set(['new', 'cooking', 'done']);
const SALMON_NAME = 'แซลมอนซาชิมิ(8 ชิ้น)';

function normalizeTable(value) {
  const s = String(value ?? '').trim();
  return TABLE_RE.test(s) ? s : null;
}

function toIntInRange(value, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function cleanText(value, maxLen) {
  return String(value ?? '').trim().slice(0, maxLen);
}

// simple fixed-window limiter (per IP for HTTP, per socket for WS)
function createLimiter(limit, windowMs) {
  const hits = new Map();
  return function allow(key, now = Date.now()) {
    const entry = hits.get(key);
    if (!entry || now >= entry.reset) {
      hits.set(key, { count: 1, reset: now + windowMs });
      if (hits.size > 5000) {
        for (const [k, v] of hits) if (now >= v.reset) hits.delete(k);
      }
      return true;
    }
    if (entry.count >= limit) return false;
    entry.count += 1;
    return true;
  };
}

const orderLimiter = createLimiter(30, 60 * 1000);
const wsOrderLimiter = createLimiter(25, 60 * 1000);

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

// Shared order-creation logic — used by both the WebSocket 'new_order' message
// and the HTTP POST /api/order fallback (for customers on weak/unstable connections).
// Returns { ticket } on success or { error, status } when the request is rejected.
function createOrder(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: 'ข้อมูลออเดอร์ไม่ถูกต้อง', status: 400 };
  }

  const table = normalizeTable(payload.table);
  if (!table) return { error: 'หมายเลขโต๊ะไม่ถูกต้อง', status: 400 };

  if (!Array.isArray(payload.items) || !payload.items.length) {
    return { error: 'ไม่มีรายการอาหาร', status: 400 };
  }
  if (payload.items.length > MAX_ORDER_ITEMS) {
    return { error: 'รายการอาหารมากเกินไป', status: 400 };
  }

  const clientOrderId = typeof payload.clientOrderId === 'string'
    ? payload.clientOrderId.trim().slice(0, 100)
    : '';
  if (clientOrderId) {
    pruneRecentOrderIds();
    const existing = recentOrderIds.get(clientOrderId);
    if (existing) {
      const live = tickets.find(t => t.num === existing.ticket.num && !t.tableCleared && t.table === table);
      if (live) return { ticket: live };
      recentOrderIds.delete(clientOrderId);
    }
  }

  // ทุกอย่างที่ลูกค้าส่งมาเป็นแค่ "id + จำนวน" — ชื่อและราคาใช้จาก MENU ฝั่งเซิร์ฟเวอร์เท่านั้น
  const merged = new Map();
  for (const raw of payload.items) {
    if (!raw || typeof raw !== 'object') continue;
    const id = Number(raw.id);
    if (!Number.isInteger(id)) continue;
    const menuItem = findMenuItem(id);
    if (!menuItem || menuItem.available === false) continue;

    const qty = toIntInRange(raw.qty ?? raw.quantity, 1, MAX_ITEM_QTY);
    if (qty === null) continue;

    const prev = merged.get(id);
    if (prev) {
      prev.qty = Math.min(MAX_ITEM_QTY, prev.qty + qty);
    } else {
      merged.set(id, { id, name: menuItem.name, qty });
    }
  }

  const items = [...merged.values()];
  if (!items.length) return { error: 'ไม่มีรายการที่สั่งได้ (เมนูอาจถูกปิดไปแล้ว)', status: 400 };

  // buffet salmon quota: staff may close salmon ordering for a table; the customer page
  // hides it, but the server must enforce it too so a crafted request can't bypass it
  if (closedSalmonTables.includes(table) && items.some(i => i.name === SALMON_NAME)) {
    return { error: 'โต๊ะนี้ปิดรับแซลมอนแล้ว', status: 409 };
  }

  const totalQty = items.reduce((sum, i) => sum + i.qty, 0);
  if (totalQty > MAX_ORDER_QTY) return { error: 'จำนวนอาหารมากเกินไป', status: 400 };

  const ticket = {
    num: ticketCounter++,
    table,
    items: items.map(i => ({ ...i, done: false, madeQty: 0, servedQty: 0 })),
    note: cleanText(payload.note, 200),
    time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Bangkok' }),
    status: 'new',
    source: payload.source === 'customer' ? 'customer' : 'staff',
    staffName: cleanText(payload.staffName, 60),
    tableCleared: false,
  };
  tickets.push(ticket);
  if (clientOrderId) recentOrderIds.set(clientOrderId, { ticket, at: Date.now() });
  broadcast({ type: 'ticket_added', ticket });
  broadcast({ type: 'table_updated', table, orders: tickets.filter(t => t.table === table && !t.tableCleared) });
  notifyDiscordNewOrder(ticket);
  scheduleSave();
  return { ticket };
}

// API: get full menu (with image info) — used by menu image manager page
app.get('/api/menu', (req, res) => {
  res.json({ menu: MENU });
});

// API: toggle menu item availability (open/close menu)
app.post('/api/menu/:id/availability', express.json(), (req, res) => {
  const id = parseInt(req.params.id);
  const item = findMenuItem(id);
  if (!item) return res.status(404).json({ error: 'ไม่พบเมนูนี้' });

  item.available = req.body.available !== undefined ? !!req.body.available : !item.available;
  scheduleSave();
  broadcast({ type: 'menu_updated', menu: MENU });
  res.json({ ok: true, available: item.available });
});

// API: upload image for a menu item
function requireMenuItem(req, res, next) {
  const item = findMenuItem(parseInt(req.params.id, 10));
  if (!item) return res.status(404).json({ error: 'ไม่พบเมนูนี้' });
  req.menuItem = item;
  next();
}

app.post('/api/menu/:id/image', requireMenuItem, upload.single('image'), (req, res) => {
  const item = req.menuItem;
  if (!req.file) return res.status(400).json({ error: 'ไม่พบไฟล์ที่อัปโหลด' });

  // remove old image file if exists
  if (item.image) {
    const oldPath = path.join(uploadsDir, path.basename(item.image));
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  item.image = `/uploads/${req.file.filename}`;
  scheduleSave();
  broadcast({ type: 'menu_updated', menu: MENU });
  res.json({ ok: true, image: item.image });
});

// API: delete image for a menu item
app.delete('/api/menu/:id/image', (req, res) => {
  const id = parseInt(req.params.id);
  const item = findMenuItem(id);
  if (!item) return res.status(404).json({ error: 'ไม่พบเมนูนี้' });

  if (item.image) {
    const filePath = path.join(uploadsDir, path.basename(item.image));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    item.image = null;
    scheduleSave();
  }

  broadcast({ type: 'menu_updated', menu: MENU });
  res.json({ ok: true });
});

// Error handler for multer (file too large, wrong type, etc.)
app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message });
  next();
});

// API: get orders for a specific table (used by customer.html "My Orders" tab)
app.get('/api/table/:id/orders', (req, res) => {
  const tableId = req.params.id;
  const orders = tickets.filter(t => t.table === tableId && !t.tableCleared);
  res.json({ orders });
});

// API: place an order over plain HTTP — a reliable fallback to the WebSocket 'new_order'
// message for customers on weak/unstable internet, where a WebSocket send can silently
// fail to reach the server. A normal HTTP request gets a real success/failure response
// that the client can retry on, unlike a fire-and-forget ws.send().
app.post('/api/order', express.json({ limit: '64kb' }), (req, res) => {
  if (!orderLimiter(clientIp(req))) {
    return res.status(429).json({ error: 'ส่งออเดอร์ถี่เกินไป กรุณารอสักครู่' });
  }
  const result = createOrder(req.body || {});
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.json({ ok: true, ticket: result.ticket });
});

wss.on('connection', (ws) => {
  ws._id = ++wsSeq;
  ws.send(JSON.stringify({ type: 'init', tickets, menu: MENU, closedSalmonTables }));

  // a client can send a frame larger than maxPayload (or otherwise corrupt data);
  // without this handler the emitted error would be uncaught and crash the whole server
  ws.on('error', (err) => {
    console.error('WS error:', err.message);
    try { ws.terminate(); } catch {}
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;

    if (msg.type === 'join_table') {
      const table = normalizeTable(msg.table);
      if (table) ws.tableNum = table;
      return;
    }

    if (msg.type === 'new_order') {
      if (!wsOrderLimiter(ws._id)) {
        ws.send(JSON.stringify({ type: 'order_error', error: 'ส่งออเดอร์ถี่เกินไป กรุณารอสักครู่' }));
        return;
      }
      const result = createOrder(msg);
      if (result.error) ws.send(JSON.stringify({ type: 'order_error', error: result.error }));
      return;
    }

    const num = toIntInRange(msg.num, 1, Number.MAX_SAFE_INTEGER);
    const t = num === null ? null : tickets.find(x => x.num === num);

    // kitchen presses +1 / -1 for how many of this item have actually been cooked so far —
    // no need to wait until the whole qty is ready before it can be sent out to serve
    if (msg.type === 'increment_made' || msg.type === 'decrement_made') {
      if (!t || !Array.isArray(t.items)) return;
      const itemIndex = toIntInRange(msg.itemIndex, 0, t.items.length - 1);
      if (itemIndex === null) return;
      const item = t.items[itemIndex];
      if (!item) return;

      const delta = msg.type === 'increment_made' ? 1 : -1;
      item.madeQty = Math.max(0, Math.min(item.qty, (item.madeQty || 0) + delta));
      item.done = item.madeQty >= item.qty;

      const anyStarted = t.items.some(i => (i.madeQty || 0) > 0);
      const allDone = t.items.every(i => i.done);
      if (allDone) t.status = 'done';
      else if (anyStarted) t.status = 'cooking';
      else t.status = 'new';

      broadcast({ type: 'ticket_updated', ticket: t });
      scheduleSave();
      return;
    }

    // mark an item as served (removes it from the "ready to serve" list)
    if (msg.type === 'serve_item') {
      if (!t || !Array.isArray(t.items)) return;
      const itemIndex = toIntInRange(msg.itemIndex, 0, t.items.length - 1);
      if (itemIndex === null) return;
      const item = t.items[itemIndex];
      if (!item) return;

      item.servedQty = (item.servedQty || 0) + 1;
      if (item.servedQty >= item.qty) {
        item.servedQty = item.qty;
        item.served = true;
      }
      broadcast({ type: 'ticket_updated', ticket: t });
      scheduleSave();
      return;
    }

    if (msg.type === 'set_status') {
      if (!t || !TICKET_STATUSES.has(msg.status)) return;
      t.status = msg.status;
      broadcast({ type: 'ticket_updated', ticket: t });
      scheduleSave();
      return;
    }

    if (msg.type === 'delete_ticket') {
      if (num === null) return;
      forgetRecentOrder(num);
      tickets = tickets.filter(x => x.num !== num);
      broadcast({ type: 'ticket_deleted', num });
      scheduleSave();
      return;
    }

    if (msg.type === 'delete_all_tickets') {
      tickets = [];
      recentOrderIds.clear();
      broadcast({ type: 'all_tickets_deleted' });
      scheduleSave();
      return;
    }

    if (msg.type === 'clear_table') {
      const table = normalizeTable(msg.table);
      if (!table) return;

      const tableOrders = tickets.filter(x => x.table === table && !x.tableCleared);
      const dateStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
      const timeStr = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });

      const peopleCount = toIntInRange(msg.peopleCount, 0, 500);
      const pricePerPerson = toIntInRange(msg.pricePerPerson, 0, 100000);
      const totalPrice = toIntInRange(msg.totalPrice, 0, 10000000);

      // One summary row per table checkout (with price), plus item detail per ticket
      if (tableOrders.length) {
        const itemsList = tableOrders.flatMap(x => x.items.map(i => ({ name: i.name, qty: i.qty })));
        billHistory.push({
          date: dateStr,
          time: timeStr,
          table,
          ticketNum: tableOrders.map(x => x.num).join(', '),
          items: itemsList.map(i => `${i.name} x${i.qty}`).join(' | '),
          itemsList,
          itemCount: itemsList.reduce((sum, i) => sum + i.qty, 0),
          source: tableOrders[0].source,
          staffName: tableOrders[0].staffName || '',
          peopleCount,
          pricePerPerson,
          totalPrice,
        });
        tableOrders.forEach(x => forgetRecentOrder(x.num));
        if (billHistory.length > MAX_BILL_HISTORY) {
          billHistory.splice(0, billHistory.length - MAX_BILL_HISTORY);
        }
      }

      tickets.forEach(x => { if (x.table === table) x.tableCleared = true; });
      closedSalmonTables = closedSalmonTables.filter(x => x !== table);
      broadcast({ type: 'table_cleared', table });
      broadcast({ type: 'salmon_status_updated', closedSalmonTables });
      scheduleSave();
      return;
    }

    // staff toggles whether a table can still order the salmon sashimi (buffet quota control)
    if (msg.type === 'set_salmon_status') {
      const table = normalizeTable(msg.table);
      if (!table) return;
      if (msg.closed) {
        if (!closedSalmonTables.includes(table)) closedSalmonTables.push(table);
      } else {
        closedSalmonTables = closedSalmonTables.filter(x => x !== table);
      }
      broadcast({ type: 'salmon_status_updated', closedSalmonTables });
      scheduleSave();
      return;
    }

    // move all active (uncleared) orders from one table to another —
    // e.g. staff physically moves a party to a different table mid-meal
    if (msg.type === 'move_table') {
      const fromTable = normalizeTable(msg.fromTable);
      const toTable = normalizeTable(msg.toTable);
      if (!fromTable || !toTable || fromTable === toTable) return;

      const moved = tickets.filter(x => x.table === fromTable && !x.tableCleared);
      if (!moved.length) return;

      moved.forEach(x => { x.table = toTable; });

      // update every existing client's copy of each moved ticket (kitchen/serve/staff/cashier)
      moved.forEach(x => broadcast({ type: 'ticket_updated', ticket: x }));
      // keep any customer.html tabs still open on either table number in sync
      broadcast({ type: 'table_updated', table: fromTable, orders: tickets.filter(x => x.table === fromTable && !x.tableCleared) });
      broadcast({ type: 'table_updated', table: toTable, orders: tickets.filter(x => x.table === toTable && !x.tableCleared) });
      broadcast({ type: 'table_moved', fromTable, toTable, count: moved.length });
      scheduleSave();
    }
  });
});

// API: download today's sales report as Excel
const REPORT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

app.get('/api/report/excel', async (req, res) => {
  try {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
    const dateParam = REPORT_DATE_RE.test(String(req.query.date || '')) ? req.query.date : today;
    const dayBills = billHistory.filter(b => b.date === dateParam);

    const workbook = new ExcelJS.Workbook();

  // Sheet 1: Summary
  const summarySheet = workbook.addWorksheet('สรุปยอด');
  summarySheet.columns = [
    { header: 'รายการ', key: 'label', width: 25 },
    { header: 'ค่า', key: 'value', width: 20 },
  ];
  const totalBills = dayBills.length;
  const totalItems = dayBills.reduce((s, b) => s + b.itemCount, 0);
  const totalRevenue = dayBills.reduce((s, b) => s + (b.totalPrice || 0), 0);
  const totalPeople = dayBills.reduce((s, b) => s + (b.peopleCount || 0), 0);

  const menuCount = {};
  dayBills.forEach(b => {
    // ใช้ข้อมูลแบบโครงสร้างถ้ามี (รองรับชื่อเมนูที่มี ", " อยู่ข้างใน)
    const list = Array.isArray(b.itemsList)
      ? b.itemsList
      : String(b.items || '').split(' | ').map(entry => {
          const match = entry.match(/^(.+) x(\d+)$/);
          return match ? { name: match[1], qty: parseInt(match[2], 10) } : null;
        }).filter(Boolean);

    list.forEach(i => {
      if (!i || !i.name) return;
      menuCount[i.name] = (menuCount[i.name] || 0) + (Number(i.qty) || 0);
    });
  });
  const topItems = Object.entries(menuCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

  summarySheet.addRow({ label: 'วันที่', value: dateParam });
  summarySheet.addRow({ label: 'จำนวนบิลทั้งหมด', value: totalBills });
  summarySheet.addRow({ label: 'จำนวนลูกค้ารวม', value: totalPeople + ' คน' });
  summarySheet.addRow({ label: 'ยอดขายรวม', value: '฿' + totalRevenue.toLocaleString() });
  summarySheet.addRow({ label: 'จำนวนรายการอาหารรวม', value: totalItems });
  summarySheet.addRow({});
  summarySheet.addRow({ label: 'เมนูขายดี Top 5', value: '' });
  topItems.forEach(([name, qty]) => summarySheet.addRow({ label: name, value: qty + ' รายการ' }));

  summarySheet.getRow(1).font = { bold: true };
  summarySheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };

  // Sheet 2: Bill details
  const detailSheet = workbook.addWorksheet('รายละเอียดบิล');
  detailSheet.columns = [
    { header: 'เวลา', key: 'time', width: 12 },
    { header: 'โต๊ะ', key: 'table', width: 10 },
    { header: 'จำนวนคน', key: 'peopleCount', width: 10 },
    { header: 'ราคา/คน', key: 'pricePerPerson', width: 12 },
    { header: 'ยอดรวม', key: 'totalPrice', width: 14 },
    { header: 'เลขออเดอร์', key: 'ticketNum', width: 16 },
    { header: 'รายการอาหาร', key: 'items', width: 60 },
    { header: 'ที่มา', key: 'source', width: 12 },
  ];
  dayBills.forEach(b => {
    detailSheet.addRow({
      time: b.time,
      table: b.table,
      peopleCount: b.peopleCount || '-',
      pricePerPerson: b.pricePerPerson ? '฿' + b.pricePerPerson : '-',
      totalPrice: b.totalPrice ? '฿' + b.totalPrice.toLocaleString() : '-',
      ticketNum: b.ticketNum,
      items: b.items,
      source: b.source === 'customer' ? 'ลูกค้า' : 'พนักงาน',
    });
  });
  detailSheet.getRow(1).font = { bold: true };
  detailSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="sales-report-${dateParam}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
  } catch (err) {
    console.error('สร้างรายงานไม่สำเร็จ:', err.message);
    if (res.headersSent) res.end();
    else res.status(500).json({ error: 'สร้างรายงานไม่สำเร็จ' });
  }
});

const PORT = process.env.PORT || 3000;

loadState();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅  Server running at http://localhost:${PORT}\n`);
});

function shutdown(signal) {
  console.log(`\n${signal} — กำลังบันทึกข้อมูลและปิดเซิร์ฟเวอร์...`);
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  saveStateNow();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
