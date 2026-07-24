const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const ExcelJS = require('exceljs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.redirect('/staff.html'));

let tickets = [];
let ticketCounter = 1001;
let billHistory = []; // stores cleared table bills for reporting
const SPECIAL_ITEM_NAME = 'เดี่ยวแซลมอน';

const MENU = [
  { cat: 'ข้าว / ก๋วยเตี๋ยว', color: '#f59e0b', items: [
    { id: 1,  name: 'ข้าวผัดกระเทียม', price: 0 },
    { id: 2,  name: 'ข้าวผัดมันเนื้อ', price: 0 },
    { id: 3,  name: 'ข้าวสวย', price: 0 },
    { id: 4,  name: 'ข้าวหน้าเนื้อตุ๋น', price: 0 },
    { id: 5,  name: 'อุด้งเนื้อตุ๋น', price: 0 },
  ]},
  { cat: 'ของทอด', color: '#4f8ef7', items: [
    { id: 6,  name: 'ผักทอด', price: 0 },
    { id: 7,  name: 'เฟรนฟราย', price: 0 },
    { id: 8,  name: 'ปีกไก่ทอด', price: 0 },
    { id: 9,  name: 'ซาลาเปาทอด', price: 0 },
    { id: 10, name: 'กุ้งทอด', price: 0 },
    { id: 11, name: 'นักเก็ต', price: 0 },
    { id: 12, name: 'ชีสบอล', price: 0 },
    { id: 13, name: 'หมึกทอด', price: 0 },
    { id: 14, name: 'ไก่ป็อบ', price: 0 },
  ]},
  { cat: 'ของดอง / ยำ', color: '#2dd4a0', items: [
    { id: 15, name: 'ม่อนดอง', price: 0 },
    { id: 16, name: 'กุ้งดอง', price: 0 },
    { id: 17, name: 'ไข่ดอง', price: 0 },
    { id: 18, name: 'จุ๊เนื้อ', price: 0 },
    { id: 19, name: 'ยำเนื้อเย็น', price: 0 },
  ]},
  { cat: 'อื่นๆ', color: '#f87171', items: [
    { id: 20, name: 'ถั่วแระ', price: 0 },
    { id: 21, name: 'ไส้กรอกแดง', price: 0 },
    { id: 22, name: 'ปลาแซลมอน', price: 0 },
    { id: 23, name: 'หอยเชลล์', price: 0 },
    { id: 24, name: 'หอยแมลงภู่', price: 0 },
    { id: 25, name: 'เดี่ยวแซลมอน', price: 0 },
  ]},
  { cat: 'เนื้อ', color: '#dc2626', items: [
    { id: 26, name: 'ลิ้น', price: 0 },
    { id: 27, name: 'ริบอาย', price: 0 },
    { id: 28, name: 'น่องลาย', price: 0 },
    { id: 29, name: 'ตับเนื้อ', price: 0 },
    { id: 30, name: 'เนื้อหมัก', price: 0 },
    { id: 31, name: 'พิคานย่า', price: 0 },
    { id: 32, name: 'สันสะโพก', price: 0 },
    { id: 33, name: 'ติดมัน', price: 0 },
    { id: 34, name: 'ไบพาย', price: 0 },
    { id: 35, name: 'ปลาซี่โครง', price: 0 },
    { id: 36, name: 'เสือ', price: 0 },
    { id: 37, name: 'รูบิค', price: 0 },
    { id: 38, name: 'สันคอ (เนื้อ)', price: 0 },
  ]},
  { cat: 'หมู', color: '#f472b6', items: [
    { id: 39, name: 'สามชั้น', price: 0 },
    { id: 40, name: 'สันนอก', price: 0 },
    { id: 41, name: 'สันคอ (หมู)', price: 0 },
    { id: 42, name: 'หมูสามชั้นเกาหลี', price: 0 },
    { id: 43, name: 'หมูหมัก', price: 0 },
  ]},
  { cat: 'ผัก', color: '#22c55e', items: [
    { id: 44, name: 'ผักกาดหอม', price: 0 },
    { id: 45, name: 'ผักกาดขาว', price: 0 },
    { id: 46, name: 'เห็ดเข็มทอง', price: 0 },
    { id: 47, name: 'เห็ดออรินจิ', price: 0 },
    { id: 48, name: 'ข้าวโพดอ่อน', price: 0 },
    { id: 49, name: 'ผักบุ้ง', price: 0 },
    { id: 50, name: 'ฟักทอง', price: 0 },
    { id: 51, name: 'หอมหัวใหญ่', price: 0 },
    { id: 52, name: 'แครอท', price: 0 },
  ]},
  { cat: 'ทะเล', color: '#0ea5e9', items: [
    { id: 53, name: 'กุ้ง', price: 0 },
    { id: 54, name: 'หอย', price: 0 },
    { id: 55, name: 'ปลาดอลลี่', price: 0 },
    { id: 56, name: 'หมึกวง', price: 0 },
    { id: 57, name: 'หมึกหนวด', price: 0 },
  ]},
];

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

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
                                                               
