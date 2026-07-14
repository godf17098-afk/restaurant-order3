const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.redirect('/staff.html'));

let tickets = [];
let ticketCounter = 1001;

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
        items: msg.items,
        note: msg.note || '',
        time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        status: 'new',
        source: msg.source || 'staff',
        staffName: msg.staffName || '',
        tableCleared: false,
      };
      tickets.unshift(ticket);
      broadcast({ type: 'ticket_added', ticket });
      broadcast({ type: 'table_updated', table: msg.table, orders: tickets.filter(t => t.table === msg.table && !t.tableCleared) });
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
      tickets.forEach(t => { if (t.table === msg.table) t.tableCleared = true; });
      broadcast({ type: 'table_cleared', table: msg.table });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅  Server running at http://localhost:${PORT}\n`);
});
    
