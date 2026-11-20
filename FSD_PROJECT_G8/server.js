'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const DB_FILE = process.env.DB_FILE || path.join(ROOT, 'data', 'g8-bakery.sqlite');
const SESSION_TTL = 8 * 60 * 60 * 1000;
const sessions = new Map();
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec(`PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bookings (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL, festival TEXT NOT NULL, pickup_date TEXT NOT NULL, pickup_time TEXT NOT NULL, cake_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Confirmed', created_at TEXT NOT NULL);`);

const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml' };
function send(res, status, data, extra = {}) { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'X-Content-Type-Options':'nosniff', 'Cache-Control':'no-store', ...extra }); res.end(JSON.stringify(data)); }
function cleanText(value, max = 120) { return String(value ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, max); }
function readBody(req) { return new Promise((resolve, reject) => { let raw=''; req.on('data', chunk => { raw += chunk; if (raw.length > 64 * 1024) { reject(new Error('Request body too large')); req.destroy(); } }); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON')); } }); req.on('error', reject); }); }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) { const hash = crypto.scryptSync(password, salt, 64).toString('hex'); return { hash, salt }; }
function verifyPassword(password, salt, expected) { const actual = Buffer.from(hashPassword(password, salt).hash, 'hex'); const wanted = Buffer.from(expected, 'hex'); return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted); }
function sessionFor(req) { const token = (req.headers.cookie || '').split(';').map(v=>v.trim()).find(v=>v.startsWith('g8_session='))?.slice('g8_session='.length); if (!token) return null; const session = sessions.get(token); if (!session || session.expires < Date.now()) { sessions.delete(token); return null; } session.expires = Date.now() + SESSION_TTL; return token; }
function requireAdmin(req, res) { const token = sessionFor(req); if (!token) { send(res, 401, { error:'Please log in as an administrator.' }); return false; } return true; }
function todayLocal() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function validateBooking(input) {
  const name = cleanText(input.name, 80), phone = cleanText(input.phone, 10), festival = cleanText(input.festival, 40), date = cleanText(input.date, 10), time = cleanText(input.time, 30);
  if (name.length < 2 || !/^[6-9]\d{9}$/.test(phone) || !festival || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < todayLocal() || !time) throw new Error('Please provide valid booking details.');
  const allowedTimes = ['10 AM - 12 PM','12 PM - 2 PM','2 PM - 4 PM','4 PM - 6 PM'];
  if (!allowedTimes.includes(time)) throw new Error('Please select a valid pickup time.');
  const rawCake = input.cake || {};
  const flavor = cleanText(rawCake.flavor, 40);
  const weight = Number(rawCake.weight), shape = cleanText(rawCake.shape, 20), frosting = cleanText(rawCake.frosting, 30), decoration = Number(rawCake.decoration || 0), message = cleanText(rawCake.message, 40);
  if (!['Chocolate Truffle','Red Velvet','Mango'].includes(flavor) || ![0.5,1,1.5,2,3,4,5].includes(weight) || !['round','square','heart'].includes(shape) || ![0,150,300].includes(decoration)) throw new Error('Cake selection is invalid. Please customize your cake again.');
  const pricePerKg = { 'Chocolate Truffle':650, 'Red Velvet':750, 'Mango':700 }[flavor];
  const base = pricePerKg * weight + decoration;
  const days = Math.floor((new Date(`${date}T00:00:00`) - new Date(`${todayLocal()}T00:00:00`)) / 86400000);
  const discountPercent = days >= 7 ? 10 : 0;
  const discountAmount = base * discountPercent / 100;
  const cake = { flavor, weight, shape, frosting, decoration, message, basePrice:base.toFixed(2), discountPercent, discountAmount:discountAmount.toFixed(2), price:(base-discountAmount).toFixed(2) };
  return { name, phone, festival, date, time, cake };
}
function mapBooking(row) { return { id:row.id, name:row.name, phone:row.phone, festival:row.festival, date:row.pickup_date, time:row.pickup_time, cake:JSON.parse(row.cake_json), status:row.status, createdAt:row.created_at }; }
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (['POST','PATCH','DELETE'].includes(req.method) && url.pathname.startsWith('/api/')) {
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== (req.headers.host || '')) return send(res, 403, { error:'Request origin not allowed.' });
  }
  try {
    if (url.pathname === '/api/login' && req.method === 'POST') {
      const body = await readBody(req), username = cleanText(body.username, 60), password = String(body.password || '');
      const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
      if (!admin || password.length > 200 || !verifyPassword(password, admin.salt, admin.password_hash)) return send(res, 401, { error:'Incorrect username or password.' });
      const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, { username, expires:Date.now()+SESSION_TTL });
      return send(res, 200, { ok:true, username }, { 'Set-Cookie':`g8_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL/1000}` });
    }
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      const token = sessionFor(req); if (token) sessions.delete(token);
      return send(res, 200, { ok:true }, { 'Set-Cookie':'g8_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    }
    if (url.pathname === '/api/session' && req.method === 'GET') {
      const token = sessionFor(req); return token ? send(res, 200, { authenticated:true, username:sessions.get(token).username }) : send(res, 401, { authenticated:false });
    }
    if (url.pathname === '/api/bookings' && req.method === 'POST') {
      const input = validateBooking(await readBody(req));
      const count = db.prepare("SELECT COUNT(*) AS count FROM bookings WHERE pickup_date = ? AND status != 'Cancelled'").get(input.date).count;
      if (count >= 25) return send(res, 409, { error:'Sorry, this date has reached its 25-cake limit.' });
      const result = db.prepare('INSERT INTO bookings (name, phone, festival, pickup_date, pickup_time, cake_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(input.name,input.phone,input.festival,input.date,input.time,JSON.stringify(input.cake),new Date().toISOString());
      const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(Number(result.lastInsertRowid));
      return send(res, 201, { booking:mapBooking(row) });
    }
    if (url.pathname === '/api/bookings' && req.method === 'GET') {
      if (!requireAdmin(req,res)) return;
      const rows = db.prepare('SELECT * FROM bookings ORDER BY id DESC').all(); return send(res, 200, { bookings:rows.map(mapBooking) });
    }
    const statusMatch = url.pathname.match(/^\/api\/bookings\/(\d+)\/status$/);
    if (statusMatch && req.method === 'PATCH') {
      if (!requireAdmin(req,res)) return;
      const { status } = await readBody(req);
      if (!['Accepted','Completed','Cancelled'].includes(status)) return send(res, 400, { error:'Invalid order status.' });
      const result = db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, Number(statusMatch[1]));
      if (!result.changes) return send(res, 404, { error:'Booking not found.' });
      return send(res, 200, { ok:true });
    }
    if (url.pathname === '/' || url.pathname === '/index.html') return serveFile(path.join(ROOT,'HTML','index.html'),res);
    if (url.pathname === '/G8owner-login.html') return serveFile(path.join(ROOT,'HTML','G8owner-login.html'),res);
    if (url.pathname === '/G8owner.html') return serveFile(path.join(ROOT,'HTML','G8owner.html'),res);
    const safePath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (safePath.includes('..') || safePath.includes('\\')) return send(res,400,{error:'Invalid path.'});
    const filePath = path.join(ROOT, safePath);
    if (filePath.startsWith(ROOT + path.sep) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return serveFile(filePath,res);
    return send(res,404,{error:'Page not found.'});
  } catch (error) {
    const status = error.message === 'Request body too large' ? 413 : 400;
    return send(res,status,{error:error.message || 'Request failed.'});
  }
}
function serveFile(file,res) { const ext=path.extname(file).toLowerCase(); res.writeHead(200,{'Content-Type':MIME[ext]||'application/octet-stream','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'}); fs.createReadStream(file).pipe(res); }
const server = http.createServer((req,res)=>{ handle(req,res).catch(()=>send(res,500,{error:'Internal server error.'})); });
if (require.main === module) server.listen(PORT,()=>console.log(`G8 Bakery running at http://localhost:${PORT}`));
module.exports = { server, db, hashPassword, cleanText, validateBooking };
