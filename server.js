// Voxa: site + grupos + chat + sinalização das calls (WebRTC)
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 3000, DB = path.join(__dirname, 'groups.json');

// Grupos são temporários: ficam só na memória e somem quando todos saem (após 15 s de tolerância)
let G = {};
const save = () => {};
const T = {};

// Arquivos do app (PWA) que o servidor pode entregar
const FILES = {
  '/manifest.json': ['manifest.json', 'application/manifest+json'],
  '/sw.js': ['sw.js', 'application/javascript; charset=utf-8'],
  '/icon-192.png': ['icon-192.png', 'image/png'],
  '/icon-512.png': ['icon-512.png', 'image/png'],
  '/icon-maskable-512.png': ['icon-maskable-512.png', 'image/png'],
  '/apple-touch-icon.png': ['apple-touch-icon.png', 'image/png']
};
const srv = http.createServer((q, r) => {
  const url = (q.url || '/').split('?')[0], f = FILES[url];
  if (f) {
    return fs.readFile(path.join(__dirname, f[0]), (e, d) => {
      if (e) { r.writeHead(404); return r.end('não encontrado'); }
      const h = { 'Content-Type': f[1] };
      if (url === '/sw.js') h['Cache-Control'] = 'no-cache';
      r.writeHead(200, h); r.end(d);
    });
  }
  fs.readFile(path.join(__dirname, 'index.html'), (e, d) => {
    if (e) { r.writeHead(500); return r.end('index.html não encontrado'); }
    r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(d);
  });
});
const wss = new WebSocketServer({ server: srv });
const users = new Map(); let n = 0;
const send = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
const gids = uid => Object.values(G).filter(g => g.m[uid]).map(g => g.id);
const list = uid => Object.values(G).filter(g => g.m[uid]).map(g => ({
  id: g.id, name: g.name, code: g.code, text: Object.keys(g.ch), voice: ['Call 1', 'Call 2'],
  members: Object.entries(g.m).map(([uid, name]) => ({ uid, name }))
}));
const online = g => [...users.values()].some(x => x.uid && g.m[x.uid]);
const check = gid => {
  const g = G[gid]; if (!g) return; clearTimeout(T[gid]);
  if (!online(g)) T[gid] = setTimeout(() => { if (G[gid] && !online(G[gid])) { delete G[gid]; delete T[gid]; } }, 15000);
};
const pushGroups = (uid, focus) => users.forEach(u => u.uid === uid && send(u.ws, { t: 'groups', groups: list(uid), focus }));
const pushGroup = gid => Object.keys(G[gid].m).forEach(uid => pushGroups(uid));
const state = () => users.forEach(r => {
  const mine = new Set(gids(r.uid));
  send(r.ws, { t: 'state', users: [...users].filter(([, u]) => gids(u.uid).some(g => mine.has(g))).map(([id, u]) => ({ id, uid: u.uid, name: u.name, room: u.room })) });
});

wss.on('connection', ws => {
  const id = 'u' + (++n), u = { ws, uid: null, name: 'Visitante', room: null };
  users.set(id, u);
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const g = G[m.gid], ok = g && u.uid && g.m[u.uid];
    if (m.t === 'hello') {
      u.uid = String(m.uid || '').slice(0, 40) || id;
      u.name = String(m.name || 'Visitante').trim().slice(0, 24) || 'Visitante';
      Object.values(G).forEach(x => { if (x.m[u.uid]) { x.m[u.uid] = u.name; } }); save();
      send(ws, { t: 'welcome', id, groups: list(u.uid) });
      gids(u.uid).forEach(pushGroup); state();
    } else if (!u.uid) return;
    else if (m.t === 'mk') {
      const name = String(m.name || '').trim().slice(0, 30); if (!name) return;
      const x = { id: 'g' + Date.now().toString(36) + n, name, code: Math.random().toString(36).slice(2, 8).toUpperCase(), m: { [u.uid]: u.name }, ch: { geral: [], jogos: [] } };
      G[x.id] = x; save(); pushGroups(u.uid, x.id); state();
    } else if (m.t === 'join') {
      const x = Object.values(G).find(v => v.code === String(m.code || '').trim().toUpperCase());
      if (!x) return send(ws, { t: 'err', msg: 'Código de convite inválido.' });
      x.m[u.uid] = u.name; save(); pushGroup(x.id); pushGroups(u.uid, x.id); state();
    } else if (m.t === 'open' && ok && g.ch[m.ch]) {
      send(ws, { t: 'hist', gid: g.id, ch: m.ch, msgs: g.ch[m.ch] });
    } else if (m.t === 'msg' && ok && g.ch[m.ch]) {
      const text = String(m.text || '').slice(0, 1000); if (!text.trim()) return;
      const o = { t: 'msg', gid: g.id, ch: m.ch, from: u.uid, name: u.name, text, ts: Date.now() };
      g.ch[m.ch].push(o); if (g.ch[m.ch].length > 100) g.ch[m.ch].shift(); save();
      users.forEach(x => x.uid && g.m[x.uid] && send(x.ws, o));
    } else if (m.t === 'voice') {
      let r = m.room || null;
      if (r) { const [a, v] = String(r).split(':'); if (!(G[a] && G[a].m[u.uid] && (v === 'v1' || v === 'v2'))) r = null; }
      u.room = r;
      send(ws, { t: 'peers', peers: r ? [...users].filter(([k, x]) => k !== id && x.room === r).map(([k]) => k) : [] });
      state();
    } else if (m.t === 'sig') {
      const v = users.get(m.to);
      if (v && u.room && v.room === u.room) send(v.ws, { t: 'sig', from: id, data: m.data });
    }
  });
  ws.on('close', () => { users.delete(id); gids(u.uid).forEach(check); state(); });
});
srv.listen(PORT, () => console.log('Voxa rodando em http://localhost:' + PORT));
