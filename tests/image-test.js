'use strict';
// ตรวจว่ารูปเมนูถูกเก็บใต้ DATA_DIR/uploads และเสิร์ฟผ่าน /uploads/... ได้
// (การทดสอบข้าม restart: อัปโหลด → หยุดเซิร์ฟเวอร์ → start ใหม่ → GET รูปเดิมต้องยังได้ 200)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3100';
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const MENU_ID = 3;

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
  '0000000d4944415478da63fcffff3f0300050001a5f645400000000049454e44ae426082',
  'hex'
);

(async () => {
  const fd = new FormData();
  fd.append('image', new Blob([PNG], { type: 'image/png' }), 'test.png');
  const up = await fetch(`${BASE}/api/menu/${MENU_ID}/image`, { method: 'POST', body: fd });
  const body = await up.json();
  console.log('upload:', up.status, body.image);
  if (up.status !== 200) process.exit(1);

  const file = path.join(DATA_DIR, 'uploads', path.basename(body.image));
  const stored = fs.existsSync(file);
  console.log('stored under data dir:', stored, file);
  if (!stored) process.exit(1);

  const img = await fetch(BASE + body.image);
  const bytes = (await img.arrayBuffer()).byteLength;
  console.log('served:', img.status, img.headers.get('content-type'), bytes, 'bytes');
  if (img.status !== 200 || bytes !== PNG.length) process.exit(1);

  // cleanup
  await fetch(`${BASE}/api/menu/${MENU_ID}/image`, { method: 'DELETE' });
  console.log('deleted after test:', !fs.existsSync(file));
  console.log('🎉 IMAGE TEST PASSED');
})().catch((e) => { console.error(e); process.exit(2); });
