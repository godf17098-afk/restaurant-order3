# Deploy ขึ้น Railway (ฟรี)

## ขั้นตอน

### 1. สมัคร GitHub (ถ้ายังไม่มี)
ไปที่ https://github.com → กด Sign up

### 2. สร้าง Repository ใหม่
1. กด **+** มุมบนขวา → **New repository**
2. ตั้งชื่อ เช่น `restaurant-order`
3. เลือก **Public**
4. กด **Create repository**

### 3. อัปโหลดไฟล์ขึ้น GitHub
ในหน้า repository ที่สร้างใหม่ จะมีปุ่ม **uploading an existing file**
- ลากไฟล์ทั้งหมดในโฟลเดอร์ `restaurant` (server.js, package.json, Procfile, โฟลเดอร์ public) ใส่เข้าไป
- กด **Commit changes**

### 4. สมัคร Railway
ไปที่ https://railway.app → กด **Login with GitHub**

### 5. Deploy
1. กด **New Project**
2. เลือก **Deploy from GitHub repo**
3. เลือก repo `restaurant-order` ที่สร้างไว้
4. Railway จะ build และ deploy ให้อัตโนมัติ (รอ 1-2 นาที)

### 6. เปิด Public URL
1. คลิกที่ service (กล่องสี่เหลี่ยม) ในหน้า Railway
2. ไปที่แท็บ **Settings**
3. เลื่อนไปหา **Networking** → กด **Generate Domain**
4. จะได้ URL เช่น `restaurant-order-production.up.railway.app`

### 7. ใช้งาน
```
พนักงาน:  https://<URL>.up.railway.app/staff.html
ลูกค้าโต๊ะ1: https://<URL>.up.railway.app/customer.html?table=1
ลูกค้าโต๊ะ2: https://<URL>.up.railway.app/customer.html?table=2
```

ลูกค้าใช้เน็ตอะไรก็เข้าได้เลย ไม่ต้องอยู่ WiFi เดียวกับร้าน

## หมายเหตุ
- Railway แผนฟรีให้เครดิตใช้ฟรีต่อเดือน เพียงพอสำหรับร้านขนาดเล็ก-กลาง
- ถ้าข้อมูลออเดอร์หายเมื่อ redeploy ต้องเพิ่มฐานข้อมูล (เช่น Railway PostgreSQL) ภายหลัง
