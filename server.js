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
  { cat: 'อาหารจานเดียว', color: '#f59e0b', items: [
    { id: 1, name: 'ข้าวผัดกุ้ง', price: 85 },
    { id: 2, name: 'ข้าวผัดปู', price: 100 },
    { id: 3, name: 'ข้าวหมูแดง', price: 65 },
    { id: 4, name: 'ข้าวมันไก่', price: 60 },
  ]},
  { cat: 'กับข้าว', color: '#4f8ef7', items: [
    { id: 5, name: 'ผัดกะเพราหมู', price: 70 },
    { id: 6, name: 'ต้มยำกุ้ง', price: 130 },
    { id: 7, name: 'แกงเขียวหวานไก่', price: 110 },
    { id: 8, name: 'ยำวุ้นเส้น', price: 85 },
    { id: 9, name: 'ผัดผักรวมมิตร', price: 75 },
  ]},
  { cat: 'เครื่องดื่ม / อื่นๆ', color: '#2dd4a0', items: [
    { id: 10, name: 'ข้าวสวย', price: 15 },
    { id: 11, name: 'น้ำเปล่า', price: 20 },
    { id: 12, name: 'น้ำอัดลม', price: 35 },
    { id: 13, name: 'ชาเย็น', price: 40 },
  ]},
];

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'init', tickets, menu: MENU }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'new_order') {
      const ticket = {
        num: ticketCounter++,
        table: msg.table,
        items: msg.items,
        note: msg.note || '',
        time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        status: 'new',
        source: msg.source || 'staff',
      };
      tickets.unshift(ticket);
      broadcast({ type: 'ticket_added', ticket });
    }

    if (msg.type === 'set_status') {
      const t = tickets.find(x => x.num === msg.num);
      if (t) { t.status = msg.status; broadcast({ type: 'ticket_updated', ticket: t }); }
    }
  });
});

// Railway provides PORT automatically via environment variable
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
});
