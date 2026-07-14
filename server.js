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
  ]},
];

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

// API: get orders for a specific table (used by customer.html "My Orders" tab)
app.get('/api/table/:num/orders', (req, res) => {
  const num = parseInt(req.params.num);
  const orders = tickets.filter(t => t.table === num && !t.tableCleared);
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

      tableOrders.forEach(t => {
        billHistory.push({
          date: bangkokTime.toISOString().slice(0, 10),
          time: bangkokTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }),
          table: t.table,
          ticketNum: t.num,
          items: t.items.map(i => `${i.name} x${i.qty}`).join(', '),
          itemCount: t.items.reduce((s, i) => s + i.qty, 0),
          source: t.source,
          staffName: t.staffName || '',
        });
      });

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
    { header: 'โต๊ะ/พนักงาน', key: 'table', width: 15 },
    { header: 'เลขออเดอร์', key: 'ticketNum', width: 14 },
    { header: 'รายการอาหาร', key: 'items', width: 60 },
    { header: 'จำนวนรวม', key: 'itemCount', width: 12 },
    { header: 'ที่มา', key: 'source', width: 12 },
  ];
  dayBills.forEach(b => {
    detailSheet.addRow({
      time: b.time,
      table: b.table,
      ticketNum: b.ticketNum,
      items: b.items,
      itemCount: b.itemCount,
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
     
