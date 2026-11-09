# Tests

Tests ยิงเข้าที่เซิร์ฟเวอร์จริง (ค่าเริ่มต้น `http://127.0.0.1:3100`) จึงต้องสตาร์ทเซิร์ฟเวอร์ก่อน:

```bash
PORT=3100 node server.js
```

แล้วรันอีก terminal:

```bash
node tests/fix-test.js      # validation, XSS/anti-spoof, rate limit, upload, WS
node tests/report-test.js   # ตรวจไฟล์ Excel + Top 5
node tests/image-test.js    # รูปถูกเก็บใน data/uploads + เสิร์ฟได้ + ลบได้
BASE_URL=http://127.0.0.1:3000 node tests/fix-test.js   # เปลี่ยนพอร์ต
```

> `fix-test.js` สร้างออเดอร์/บิลและเปลี่ยนสถานะเมนูชั่วคราว (คืนสถานะให้เอง)
> ถ้าไม่ต้องการให้ข้อมูลทดสอบค้าง ให้ลบ `data/state.json` หลังรัน หรือรันบนเซิร์ฟเวอร์แยก
