priceวงทอด' express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.redirect('/staff.html'));

const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `menu-${req.params.id}-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('ไฟล์ต้องเป็นรูปภาพเท่านั้น'));
    cb(null, true);
  },
});

let tickets = [];
let ticketCounter = 1001;
let billHistory = []; // stores cleared table bills for reporting

const MENU = [
  { cat: 'ข้าว / ก๋วยเตี๋ยว', color: '#f59e0b', items: [
    { id: 1,  name: 'ข้าวผัดกระเทียม', price: 0 , image: null },
    { id: 2,  name: 'ข้าวผัดมันเนื้อ', price: 0 , image: null },
    { id: 3,  name: 'ข้าวสวยญี่ปุ่น', price: 0 , image: null },
    { id: 4,  name: 'ข้าวหน้าเนื้อตุ๋น', price: 0 , image: null },
    { id: 5,  name: 'อุด้งเนื้อตุ๋น', price: 0 , image: null },
  ]},
  { cat: 'ของทอด', color: '#4f8ef7', items: [
    { id: 7,  name: 'เฟรนฟราย', price: 0 , image: null },
    { id: 8,  name: 'ปีกไก่ทอด', price: 0 , image: null },
    { id: 9,  name: 'ซาลาเปาทอด', price: 0 , image: null },
    { id: 10, name: 'กุ้งทอด', price: 0 , image: null },
    { id: 11, name: 'นักเก็ต', price: 0 , image: null },
    { id: 12, name: 'ชีสบอล', price: 0 , image: null },
    { id: 13, name: 'หมึกทอด', price: 0 , image: null },
    { id: 14, name: 'ไก่ป็อบ', price: 0 , image: null },
  ]},
  { cat: 'ของดอง / ยำ', color: '#2dd4a0', items: [
    { id: 15, name: 'แซลมอนดอง', price: 0 , image: null },
    { id: 16, name: 'กุ้งดอง', price: 0 , image: null },
    { id: 17, name: 'ไข่ดอง', price: 0 , image: null },
    { id: 18, name: 'จุ๊เนื้อ', price: 0 , image: null },
    { id: 19, name: 'ยำเนื้อเย็น', price: 0 , image: null },
  ]},
  { cat: 'อื่นๆ', color: '#f87171', items: [
    { id: 20, name: 'ถั่วแระ', price: 0 , image: null },
    { id: 21, name: 'ไส้กรอกแดง', price: 0 , image: null },
    { id: 22, name: 'แซลมอนซาชิมิ', price: 0 , image: null },
    { id: 23, name: 'หอยเชลล์', price: 0 , image: null },
    { id: 24, name: 'หอยแมลงภู่', price: 0 , image: null },
  ]},
  { cat: 'เนื้อ', color: '#dc2626', items: [
    { id: 26, name: 'ลิ้นวัว', price: 0 , image: null },
    { id: 27, name: 'ริบอาย', price: 0 , image: null },
    { id: 28, name: 'น่องลาย', price: 0 , image: null },
    { id: 29, name: 'ตับเนื้อ', price: 0 , image: null },
    { id: 30, name: 'เนื้อหมัก', price: 0 , image: null },
    { id: 31, name: 'พิคานย่า', price: 0 , image: null },
    { id: 32, name: 'สันสะโพก', price: 0 , image: null },
    { id: 33, name: 'ติดมัน', price: 0 , image: null },
    { id: 34, name: 'ใบพาย', price: 0 , image: null },
    { id: 35, name: 'ปลาช่อน', price: 0 , image: null },
    { id: 36, name: 'เนื้อบริสเก็ต (เสือร้องไห้)', price: 0 , image: null },
    { id: 37, name: 'รูบิค', price: 0 , image: null },
    { id: 38, name: 'สันคอ (เนื้อ)', price: 0 , image: null },
  ]},
  { cat: 'หมู', color: '#f472b6', items: [
    { id: 39, name: 'สามชั้น', price: 0 , image: null },
    { id: 40, name: 'สันนอก', price: 0 , image: null },
    { id: 41, name: 'สันคอ (หมู)', price: 0 , image: null },
    { id: 42, name: 'หมูสามชั้นเกาหลี', price: 0 , image: null },
    { id: 43, name: 'หมูหมัก', price: 0 , image: null },
  ]},
  { cat: 'ผัก', color: '#22c55e', items: [
    { id: 44, name: 'ผักกาดหอม', price: 0 , image: null },
    { id: 45, name: 'ผักกาดขาว', price: 0 , image: null },
    { id: 46, name: 'เห็ดเข็มทอง', price: 0 , image: null },
    { id: 47, name: 'เห็ดออรินจิ', price: 0 , image: null },
    { id: 48, name: 'ข้าวโพดอ่อน', price: 0 , image: null },
    { id: 49, name: 'ผักบุ้ง', price: 0 , image: null },
    { id: 50, name: 'ฟักทอง', price: 0 , image: null },
    { id: 51, name: 'หอมหัวใหญ่', price: 0 , image: null },
    { id: 52, name: 'แครอท', price: 0 , image: null },
    { id: 67, name: 'กระหล่ำซอย', price: 0 , image: null },
  ]},
  { cat: 'ทะเล', color: '#0ea5e9', items: [
    { id: 53, name: 'กุ้ง', price: 0 , image: null },
    { id: 54, name: 'หอย', price: 0 , image: null },
    { id: 55, name: 'ปลาดอลลี่', price: 0 , image: null },
    { id: 56, name: 'หมึกวง', price: 0 , image: null },
    { id: 57, name: 'หมึกหนวด', price: 0 , image: null },
  ]},
  { cat: 'เครื่องเคียง', color: '#a855f7', items: [
    { id: 58, name: 'กิมจิ', price: 0 , image: null },
    { id: 59, name: 'ยำสาหร่าย', price: 0 , image: null },
    { id: 60, name: 'ผักดอง 3 รส', price: 0 , image: null },
    { id: 61, name: 'เนยมันเนื้อ', price: 0 , image: null },
    { id: 62, name: 'เนย/มาการีน', price: 0 , image: null },
    { id: 63, name: 'ไข่ไก่', price: 0 , image: null },
    { id: 68, name: 'ชีส', price: 0 , image: null },
  ]},
  { cat: 'ของแปรรูป', color: '#eab308', items: [
    { id: 64, name: 'ไส้กรอกชีส', price: 0 , image: null },
    { id: 65, name: 'ปูอัด', price: 0 , image: null },
    { id: 66, name: 'สามชั้นพันเห็ดเข็มทอง', price: 0 , image: null },
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

// API: get full menu (with image info) — used by menu image manager page
app.get('/api/menu', (req, res) => {
  res.json({ menu: MENU });
});

// API: upload image for a menu item
app.post('/api/menu/:id/image', upload.single('image'), (req, res) => {
  const id = parseInt(req.params.id);
  const item = findMenuItem(id);
  if (!item) return res.status(404).json({ error: 'ไม่พบเมนูนี้' });
  if (!req.file) return res.status(400).json({ error: 'ไม่พบไฟล์ที่อัปโหลด' });

  // remove old image file if exists
  if (item.image) {
    const oldPath = path.join(__dirname, 'public', item.image);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  item.image = `/uploads/${req.file.filename}`;
  broadcast({ type: 'menu_updated', menu: MENU });
  res.json({ ok: true, image: item.image });
});

// API: delete image for a menu item
app.delete('/api/menu/:id/image', (req, res) => {
  const id = parseInt(req.params.id);
  const item = findMenuItem(id);
  if (!item) return res.status(404).json({ error: 'ไม่พบเมนูนี้' });

  if (item.image) {
    const filePath = path.join(__dirname, 'public', item.image);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    item.image = null;
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

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'init', tickets, menu: MENU }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join_table') {
      ws.tableNum = msg.table;
    }

    if (msg.type === 'new_order') {
      const ticket = {
        num: ticketCounter++,
        table: msg.table,
        items: msg.items.map(i => ({ ...i, done: false })),
        note: msg.note || '',
        time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Bangkok' }),
        status: 'new',
        source: msg.source || 'staff',
        staffName: msg.staffName || '',
        tableCleared: false,
      };
      tickets.unshift(ticket);
      broadcast({ type: 'ticket_added', ticket });
      broadcast({ type: 'table_updated', table: msg.table, orders: tickets.filter(t => t.table === msg.table && !t.tableCleared) });
    }

    if (msg.type === 'toggle_item') {
      const t = tickets.find(x => x.num === msg.num);
      if (t) {
        const item = t.items[msg.itemIndex];
        if (item) {
          item.done = !item.done;
          if (item.done && t.status === 'new') t.status = 'cooking';
          const allDone = t.items.every(i => i.done);
          if (allDone) t.status = 'done';
          else if (t.status === 'done') t.status = 'cooking';
          broadcast({ type: 'ticket_updated', ticket: t });
        }
      }
    }

    // mark an item as served (removes it from the "ready to serve" list)
    if (msg.type === 'serve_item') {
      const t = tickets.find(x => x.num === msg.num);
      if (t) {
        const item = t.items[msg.itemIndex];
        if (item) {
          item.served = true;
          broadcast({ type: 'ticket_updated', ticket: t });
        }
      }
    }

    if (msg.type === 'set_status') {
      const t = tickets.find(x => x.num === msg.num);
      if (t) {
        t.status = msg.status;
        broadcast({ type: 'ticket_updated', ticket: t });
      }
    }

    if (msg.type === 'delete_ticket') {
      tickets = tickets.filter(x => x.num !== msg.num);
      broadcast({ type: 'ticket_deleted', num: msg.num });
    }

    if (msg.type === 'clear_table') {
      const tableOrders = tickets.filter(t => t.table === msg.table && !t.tableCleared);
      const now = new Date();
      const bangkokTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
      const dateStr = bangkokTime.toISOString().slice(0, 10);
      const timeStr = bangkokTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });

      const peopleCount = msg.peopleCount || null;
      const pricePerPerson = msg.pricePerPerson || null;
      const totalPrice = msg.totalPrice || null;

      // One summary row per table checkout (with price), plus item detail per ticket
      if (tableOrders.length) {
        billHistory.push({
          date: dateStr,
          time: timeStr,
          table: msg.table,
          ticketNum: tableOrders.map(t => t.num).join(', '),
          items: tableOrders.flatMap(t => t.items.map(i => `${i.name} x${i.qty}`)).join(', '),
          itemCount: tableOrders.reduce((s, t) => s + t.items.reduce((s2, i) => s2 + i.qty, 0), 0),
          source: tableOrders[0].source,
          staffName: tableOrders[0].staffName || '',
          peopleCount,
          pricePerPerson,
          totalPrice,
        });
      }

      tickets.forEach(t => { if (t.table === msg.table) t.tableCleared = true; });
      broadcast({ type: 'table_cleared', table: msg.table });
    }
  });
});

// API: download today's sales report as Excel
app.get('/api/report/excel', async (req, res) => {
  const dateParam = req.query.date || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
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
    b.items.split(', ').forEach(entry => {
      const match = entry.match(/^(.+) x(\d+)$/);
      if (match) {
        const name = match[1];
        const qty = parseInt(match[2]);
        menuCount[name] = (menuCount[name] || 0) + qty;
      }
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
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅  Server running at http://localhost:${PORT}\n`);
});
     
