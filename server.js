// server.js — run with: node server.js
// Zero dependencies (no npm install needed). Serves client.html and hosts a
// hand-rolled WebSocket game room for up to 12 players over LAN/hotspot.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const Sim = require('./sim.js');

const PORT = process.env.PORT || 8080;
const MAX_PLAYERS = 12;
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// ---- lobby / room state ----
let clients = new Map(); // id -> { socket, name, skin, joinedAt }
let sim = null;          // Sim state once match starts
let matchRunning = false;
let hostId = null;
let nextId = 1;

function broadcast(obj, exceptId) {
  const buf = encodeFrame(JSON.stringify(obj));
  for (const [id, c] of clients) {
    if (id === exceptId) continue;
    try { c.socket.write(buf); } catch (e) {}
  }
}
function sendTo(id, obj) {
  const c = clients.get(id);
  if (!c) return;
  try { c.socket.write(encodeFrame(JSON.stringify(obj))); } catch (e) {}
}
function lobbyList() {
  return Array.from(clients.values()).map(c => ({ id: c.id, name: c.name, skin: c.skin }));
}
function broadcastLobby() {
  broadcast({ type: 'lobby', players: lobbyList(), hostId, matchRunning });
}

function startMatch() {
  sim = Sim.newState(Date.now());
  for (const c of clients.values()) Sim.addPlayer(sim, c.id, c.name, c.skin);
  matchRunning = true;
  broadcast({ type: 'matchStart' });
}

let lastTick = Date.now();
setInterval(() => {
  if (!matchRunning || !sim) return;
  const now = Date.now();
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  Sim.step(sim, dt);
  broadcast({ type: 'snapshot', s: Sim.snapshot(sim) });
}, 50); // 20Hz

// ---- HTTP: serve client.html + sim.js ----
const server = http.createServer((req, res) => {
  let file = req.url === '/' ? '/client.html' : req.url;
  file = file.split('?')[0];
  const map = { '/client.html': 'text/html', '/sim.js': 'application/javascript', '/solo.js': 'application/javascript' };
  const type = map[file];
  if (!type) { res.writeHead(404); res.end('not found'); return; }
  fs.readFile(path.join(__dirname, file.slice(1)), (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
});

// ---- WebSocket upgrade ----
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  if (clients.size >= MAX_PLAYERS) {
    socket.write(encodeFrame(JSON.stringify({ type: 'full' })));
    socket.end();
    return;
  }

  const id = 'p' + (nextId++);
  const isHost = clients.size === 0;
  if (isHost) hostId = id;
  const client = { id, socket, name: 'Diver', skin: 0, joinedAt: Date.now() };
  clients.set(id, client);
  sendTo(id, { type: 'welcome', id, isHost });
  broadcastLobby();

  let buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    let msg;
    while ((msg = decodeFrame(buf))) {
      buf = buf.slice(msg.consumed);
      if (msg.opcode === 0x8) { socket.end(); return; } // close frame
      if (msg.text) handleMessage(id, msg.text);
    }
  });

  // IMPORTANT: a graceful browser close sends only 'end' (TCP FIN), not always
  // a WS close frame promptly. Without ending our side here, the socket lingers
  // half-open and the player becomes a permanent ghost in the room.
  const cleanup = () => {
    if (!clients.has(id)) return;
    clients.delete(id);
    if (sim) Sim.removePlayer(sim, id);
    if (hostId === id) {
      const next = clients.keys().next();
      hostId = next.done ? null : next.value;
    }
    broadcastLobby();
    if (clients.size === 0) { matchRunning = false; sim = null; }
  };
  socket.on('end', () => { socket.end(); cleanup(); });
  socket.on('close', cleanup);
  socket.on('error', cleanup);
});

function handleMessage(id, text) {
  let msg;
  try { msg = JSON.parse(text); } catch (e) { return; }
  const c = clients.get(id);
  if (!c) return;
  if (msg.type === 'profile') {
    c.name = String(msg.name || 'Diver').slice(0, 16);
    c.skin = Number(msg.skin) || 0;
    broadcastLobby();
  } else if (msg.type === 'start' && id === hostId && !matchRunning) {
    startMatch();
  } else if (msg.type === 'input' && sim) {
    Sim.setInput(sim, id, msg.input);
  }
}

// ---- minimal WS frame codec (text frames only, server<->client) ----
function encodeFrame(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}
function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2); offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2)); offset = 10;
  }
  let maskKey;
  if (masked) {
    if (buf.length < offset + 4) return null;
    maskKey = buf.slice(offset, offset + 4);
    offset += 4;
  }
  if (buf.length < offset + len) return null;
  let payload = buf.slice(offset, offset + len);
  if (masked) {
    const out = Buffer.alloc(len);
    for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i % 4];
    payload = out;
  }
  return { opcode, text: opcode === 0x1 ? payload.toString('utf8') : null, consumed: offset + len };
}

server.listen(PORT, () => {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name in nets) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) addrs.push(net.address);
    }
  }
  console.log(`\nSounding: Depths host running.`);
  console.log(`Share this with players on the same Wi-Fi/hotspot:\n`);
  addrs.forEach(a => console.log(`  http://${a}:${PORT}`));
  if (addrs.length === 0) console.log(`  http://localhost:${PORT}  (no LAN interface found)`);
  console.log(`\nUp to ${MAX_PLAYERS} players. Press Ctrl+C to stop.\n`);
});
