const path = require('path');
const ROOT = path.join(__dirname, '..');
const ExcelJS = require(path.join(ROOT, 'node_modules', 'exceljs'));
const WebSocket = require(path.join(ROOT, 'node_modules', 'ws'));
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3100';
const WS_BASE = BASE.replace(/^http/, 'ws');
const post = (p,b,ip) => fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':ip||'10.7.0.1'},body:JSON.stringify(b)}).then(async r=>({status:r.status,body:await r.json()}));
(async()=>{
  const o = await post('/api/order',{table:'TP2',items:[{id:5,qty:2},{id:4,qty:1}],source:'customer'},'10.7.0.2');
  if(!o.body.ok){console.log('order failed',o);process.exit(1)}
  const ws = new WebSocket(WS_BASE);
  await new Promise(r=>ws.on('open',r));
  ws.send(JSON.stringify({type:'clear_table',table:'TP2',peopleCount:2,pricePerPerson:399,totalPrice:798}));
  await new Promise(r=>setTimeout(r,400));
  ws.close();
  const res = await fetch(BASE+'/api/report/excel');
  console.log('report http', res.status, res.headers.get('content-type'));
  const buf = Buffer.from(await res.arrayBuffer());
  console.log('bytes', buf.length);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const s = wb.getWorksheet('สรุปยอด');
  s.eachRow((row)=>console.log('  row', row.number, JSON.stringify([row.getCell(1).value,row.getCell(2).value])));
  const d = wb.getWorksheet('รายละเอียดบิล');
  d.eachRow((row)=>console.log('  detail', row.number, JSON.stringify([row.getCell(2).value,row.getCell(7).value])));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(2)});
