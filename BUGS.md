# BUGS / สรุปงานแก้ไข — restaurant-order3

อัปเดตล่าสุด: 2026-11-10 (Asia/Bangkok)

## ✅ แก้แล้วในรอบนี้

### 1. ข้อมูลหายเมื่อรีสตาร์ทเซิร์ฟเวอร์
- เพิ่ม persistence ลง `data/state.json` (เขียนแบบ atomic ผ่านไฟล์ `.tmp` + rename, debounce 250 ms)
- โหลดกลับตอนบูต (`loadState`) และบันทึกตอน `SIGINT`/`SIGTERM`
- เก็บ: tickets, ticketCounter, billHistory, closedSalmonTables, สถานะเปิด/ปิดเมนู และรูปเมนู
- `ticketCounter` ถูกดันให้มากกว่าเลข ticket สูงสุดเสมอ กันเลขซ้ำหลังโหลด

### 2. Ghost order (ลูกค้าเห็น "สั่งสำเร็จ" แต่ครัวไม่ได้รับ)
- retry ด้วย `clientOrderId` เดิมจะคืน ticket เฉพาะเมื่อ ticket นั้นยังอยู่และโต๊ะตรงกัน
- ลบ ticket / เคลียร์โต๊ะ / ลบทั้งหมด จะล้าง cache `recentOrderIds` ที่เกี่ยวข้อง
- retry หลังถูกลบจึงสร้าง ticket ใหม่จริง (ไม่ใช่คืนเลขเก่าที่หายไปแล้ว)

### 3. ไม่มีการ validate ข้อมูลออเดอร์ (ปลอมชื่อ/ราคา/โต๊ะได้)
- เซิร์ฟเวอร์รับจากลูกค้าเฉพาะ `id` + `qty` — **ชื่อเมนูและราคาใช้จาก `MENU` ฝั่งเซิร์ฟเวอร์เท่านั้น**
- ตรวจโต๊ะด้วย `TABLE_RE` (ตัวอักษร/ตัวเลข/ขีด/ช่องว่าง 1–20 ตัว)
- ตรวจ id ว่ามีในเมนูจริง, เมนูต้องเปิดอยู่, qty 1–99, รวม id ซ้ำ, เพดาน 100 รายการ/500 ชิ้น
- `note` ตัดที่ 200 ตัวอักษร, `source` จำกัดเป็น `customer`/`staff`
- ปิดเมนูแล้วสั่งไม่ได้ (server-side)

### 4. WebSocket ไม่ปลอดภัย / ทำให้เซิร์ฟเวอร์ล่มได้
- `maxPayload` 64 KB และเพิ่ม `ws.on('error')` — **เดิมส่ง frame ใหญ่เกินจะทำให้ process crash ทั้งเซิร์ฟเวอร์**
- whitelist สถานะ ticket (`new`/`cooking`/`done`) — ค่าอื่นถูกเมิน
- ตรวจ `num`, `itemIndex`, `table` ก่อนใช้งานทุกจุด
- จำกัดอัตราการส่งออเดอร์ต่อ socket (25/นาที) และตอบ `order_error` กลับไป

### 5. ยิงออเดอร์รัว ๆ / body ใหญ่เกิน
- HTTP `/api/order` จำกัด body 64 KB และ 30 ออเดอร์/นาที/IP → เกินได้ `429`

### 6. อัปโหลดไฟล์อันตราย (XSS ผ่าน SVG/HTML)
- รับเฉพาะ MIME `image/jpeg|png|webp|gif` และตั้งนามสกุลไฟล์จาก MIME เท่านั้น
- ชื่อไฟล์มี random hex กันคาดเดา/ทับกัน
- `.html`, `.svg`, `.js` ถูกปฏิเสธ
- ตรวจว่า menu id มีจริงก่อนเขียนไฟล์ (กันไฟล์ขยะค้าง)

### 7. รายงาน Excel Top 5 ผิดเมื่อชื่อเมนูมีตัวคั่น
- เก็บ `itemsList` แบบโครงสร้างใน billHistory และคำนวณ Top 5 จากข้อมูลนี้ (fallback parse `" | "` สำหรับบิลเก่า)
- ตรวจ `?date=` ให้เป็น `YYYY-MM-DD` เท่านั้น (กัน header/path injection)
- ครอบ try/catch กัน async error ทำให้ process ล่ม

### 8. XSS ฝั่งหน้าเว็บ (innerHTML)
- เพิ่ม helper `esc()` และ escape ค่าที่มาจากผู้ใช้ (`note`, `table`, ชื่อเมนู, ชื่อพนักงาน) ใน
  `staff.html`, `kitchen.html`, `serve-1.html`, `cashier.html`, `cashier-hub.html`,
  `customer.html`, `salmon-control.html`, `move-table.html`
- `move-table.html` เปลี่ยนจาก inline `onclick="...'${table}'"` เป็น `data-table` + `this.dataset.table`

### 9. โควตาแซลมอน
- เซิร์ฟเวอร์บังคับปิดรับแซลมอนจริง (เดิมซ่อนแค่ในหน้า customer) → สั่งแซลมอนโต๊ะที่ปิดจะได้ `409`
- แก้ชื่อเมนูแซลมอนใน `cashier.html` ที่พิมพ์ผิด (`ปลาแซลมอน`) ทำให้คิดราคา 448/คนไม่เคยทำงาน

### 10. เรื่องเล็ก ๆ ที่เก็บเพิ่ม
- `billHistory` จำกัด 5,000 บิลล่าสุด กัน memory โตไม่จำกัด
- Discord webhook อ่านจาก `DISCORD_WEBHOOK_URL` ก่อน (มีค่าเดิมเป็น fallback)
- ฝั่ง client: ถ้าเซิร์ฟเวอร์ตอบ 4xx (เมนูปิด/แซลมอนปิด/rate limit) จะแสดงข้อความจริงและไม่ retry ซ้ำเปล่า ๆ
- เพิ่ม `.gitignore` (`node_modules/`, `data/`, `public/uploads/`, `.env`, `*.log`)

## 🧪 วิธีตรวจสอบ

มีชุดทดสอบใน `tests/` (ต้องสตาร์ทเซิร์ฟเวอร์ก่อน):

```bash
PORT=3100 node server.js
node tests/fix-test.js      # 38 checks — ผ่านทั้งหมด
node tests/report-test.js   # ตรวจ Excel + Top 5
```

ทดสอบ persistence แยก: สร้างออเดอร์ → `SIGTERM` → start ใหม่ → ข้อมูลยังอยู่ (ยืนยันแล้ว)

## ⚠️ ยังค้าง / ความเสี่ยงที่ยังไม่ได้แก้

1. **ไม่มี authentication เลย** — ใครก็ส่ง WS `delete_ticket`, `delete_all_tickets`, `set_status`,
   `clear_table`, `move_table` หรือเรียก `POST /api/menu/:id/availability`, upload/delete รูปได้
   → ควรเพิ่ม PIN/token สำหรับหน้าพนักงาน หรืออย่างน้อยแยก endpoint ที่ต้องใช้สิทธิ์
2. **Discord webhook ยังอยู่ใน git history** — ควร rotate URL ใหม่แล้วตั้งผ่าน env
   `DISCORD_WEBHOOK_URL` แทน (ค่าเก่าที่ hardcode ไว้ถือว่ารั่วแล้ว)
3. **ไม่มีฐานข้อมูล** — ใช้ไฟล์ JSON ไฟล์เดียว จึงรองรับได้แค่ instance เดียว
   และบน Railway ต้อง mount volume ที่ `/app/data` ไม่งั้น deploy ใหม่ข้อมูลหาย
4. **ไม่มี CSRF protection** — เกี่ยวเนื่องกับข้อ 1 (ยังไม่มี session/auth)
5. **ไฟล์รูปเก่าไม่ถูกลบอัตโนมัติ** เมื่อเปลี่ยนรูปแล้วเกิด error กลางทาง
6. **ไม่ได้ทดสอบ UI ในเบราว์เซอร์จริง** — ตรวจแค่ syntax ของ script ทุกหน้า + API/WS tests

## 📌 หมายเหตุการ deploy (Railway)

- ต้องเพิ่ม **Volume** mount ที่ `/app/data` เพื่อให้ `state.json` อยู่ข้าม deploy
- ตั้ง env `DISCORD_WEBHOOK_URL` (ถ้าต้องการใช้แจ้งเตือน Discord)
