// =====================================================================
// TALLER DE OKRs — Lógica del servidor (Netlify Function + Netlify Blobs)
// Toda la seguridad vive aquí: quién puede ver/editar qué y las vigencias.
// =====================================================================
import crypto from 'node:crypto';

const TZ = 'America/Mexico_City';
const MAX_VOTES = 5;
const cache = new Map(); // instantánea en memoria por taller (2 s)

class E extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // AAAA-MM-DD
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const isActive = c => !!c && c.status === 'activo' && today() >= c.valid_from && today() <= c.valid_to;

// ---------- tokens y contraseñas ----------
function sign(payload, secret) {
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const s = crypto.createHmac('sha256', secret).update(p).digest('base64url');
  return `${p}.${s}`;
}
function verify(token, secret) {
  if (!token || !token.includes('.')) return null;
  const [p, s] = token.split('.');
  const exp = crypto.createHmac('sha256', secret).update(p).digest('base64url');
  const a = Buffer.from(s), b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.exp > Date.now() ? o : null; } catch { return null; }
}
function hashPw(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(pw), salt, 64).toString('hex') };
}
function checkPw(pw, u) {
  const h = crypto.scryptSync(String(pw), u.salt, 64), t = Buffer.from(u.hash, 'hex');
  return h.length === t.length && crypto.timingSafeEqual(h, t);
}
function safeEq(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => A[crypto.randomInt(A.length)]).join('');
}

// ---------- almacenamiento ----------
const getJ = (s, k) => s.get(k, { type: 'json' });
const setJ = (s, k, v) => s.setJSON(k, v);
const keys = async (s, prefix) => (await s.list({ prefix })).blobs.map(b => b.key);
const getAll = async (s, prefix) => (await Promise.all((await keys(s, prefix)).map(k => getJ(s, k)))).filter(Boolean);
const getClients = async s => (await getJ(s, 'clients')) || [];
const getUsers = async s => (await getJ(s, 'users')) || {};
const wsList = async (s, cid) => (await getJ(s, `wsl/${cid}`)) || [];
async function wsByCode(s, code) {
  const m = await getJ(s, `code/${str(code, 10).toUpperCase()}`);
  return m ? getJ(s, `ws/${m.ws_id}`) : null;
}
async function clientOf(s, cid) { return (await getClients(s)).find(c => c.id === cid) || null; }
function pub(w, c) {
  return { id: w.id, name: w.name, area: w.area, period_label: w.period_label, phase: w.phase, idea_step: (w.data && w.data.ideaStep) || 'proponer', active: isActive(c) };
}
async function snapshot(s, wsId) {
  const hit = cache.get(wsId);
  if (hit && Date.now() - hit.t < 2000) return hit.v;
  const [parts, ideas, voteKeys, fv] = await Promise.all([getAll(s, `part/${wsId}/`), getAll(s, `idea/${wsId}/`), keys(s, `vote/${wsId}/`), getJ(s, `fvote/${wsId}`)]);
  const ideaIds = new Set(ideas.map(i => i.id)), votesBy = {}, count = {};
  await Promise.all(voteKeys.map(async k => { votesBy[k.split('/').pop()] = ((await getJ(s, k)) || []).filter(id => ideaIds.has(id)); }));
  Object.values(votesBy).forEach(arr => arr.forEach(id => { count[id] = (count[id] || 0) + 1; }));
  Object.entries(fv || {}).forEach(([id, n]) => { if (ideaIds.has(id)) count[id] = (count[id] || 0) + n; });
  ideas.sort((a, b) => a.created_at.localeCompare(b.created_at));
  const v = { parts, ideas, votesBy, count };
  cache.set(wsId, { t: Date.now(), v });
  return v;
}
const mapIdeas = (sn, pid) => sn.ideas.map(i => ({ id: i.id, author: i.author, avatar: i.avatar, text: i.text, votes: sn.count[i.id] || 0, created_at: i.created_at, mine: !!pid && i.pid === pid }));
const mapPeople = (sn, pid) => sn.parts.map(p => ({
  name: p.name, avatar: p.avatar, me: !!pid && p.id === pid,
  xp: 10 * sn.ideas.filter(i => i.pid === p.id).length + 2 * (sn.votesBy[p.id] || []).length
})).sort((a, b) => b.xp - a.xp);
async function deleteWsCascade(s, w) {
  for (const p of [`part/${w.id}/`, `idea/${w.id}/`, `vote/${w.id}/`]) { for (const k of await keys(s, p)) await s.delete(k); }
  await s.delete(`fvote/${w.id}`); await s.delete(`code/${w.code}`); await s.delete(`ws/${w.id}`);
  cache.delete(w.id);
}

// ---------- permisos ----------
function need(ctx) { if (!ctx.user) throw new E('Tu sesión terminó. Vuelve a entrar.', 401); return ctx.user; }
function needSuper(ctx) { const u = need(ctx); if (u.role !== 'superadmin') throw new E('Solo el super administrador puede hacer esto', 403); return u; }
async function needClient(ctx, cid, write) {
  const u = need(ctx), c = await clientOf(ctx.s, cid);
  if (!c) throw new E('Cliente no encontrado', 404);
  if (u.role === 'superadmin') return c;
  if (u.role !== 'client_admin' || u.client_id !== cid) throw new E('No tienes permiso para ver esto', 403);
  if (write && !isActive(c)) throw new E('🔒 La licencia no está vigente: solo lectura', 403);
  return c;
}
async function resolveUser(ctx, p) {
  const adminEmail = String(ctx.env.ADMIN_EMAIL).trim().toLowerCase();
  if (p.role === 'superadmin') return p.sub === adminEmail ? { email: adminEmail, role: 'superadmin', client_id: null } : null;
  const u = (await getUsers(ctx.s))[p.sub];
  if (!u || u.hash.slice(0, 12) !== p.pv) return null; // contraseña cambiada o usuario borrado
  return { email: u.email, role: u.role, client_id: u.client_id || null };
}

// ---------- acciones ----------
const A = {
  async login(ctx, { email, pass }) {
    const e = str(email, 120).toLowerCase(), { env, s } = ctx, exp = Date.now() + 12 * 3600e3;
    if (e === String(env.ADMIN_EMAIL).trim().toLowerCase() && safeEq(pass || '', env.ADMIN_PASSWORD)) {
      return { token: sign({ sub: e, role: 'superadmin', exp }, env.OKR_SECRET), user: { email: e, role: 'superadmin', client_id: null } };
    }
    const u = (await getUsers(s))[e];
    if (!u || !checkPw(pass || '', u)) { await sleep(500); throw new E('Correo o contraseña incorrectos', 401); }
    return { token: sign({ sub: e, role: u.role, pv: u.hash.slice(0, 12), exp }, env.OKR_SECRET), user: { email: e, role: u.role, client_id: u.client_id || null } };
  },
  async me(ctx) { return ctx.user; },

  // --- super admin ---
  async listClients(ctx) {
    const u = need(ctx), cs = await getClients(ctx.s);
    return u.role === 'superadmin' ? cs.sort((a, b) => a.name.localeCompare(b.name)) : cs.filter(c => c.id === u.client_id);
  },
  async getClient(ctx, { id }) { return needClient(ctx, id, false); },
  async saveClient(ctx, { client }) {
    needSuper(ctx);
    const c = { name: str(client.name, 120), contact: str(client.contact, 120), valid_from: client.valid_from, valid_to: client.valid_to, status: client.status === 'suspendido' ? 'suspendido' : 'activo' };
    if (!c.name) throw new E('Escribe el nombre del cliente');
    if (!isDate(c.valid_from) || !isDate(c.valid_to) || c.valid_to < c.valid_from) throw new E('Revisa las fechas de vigencia');
    const cs = await getClients(ctx.s);
    let out;
    if (client.id) { const i = cs.findIndex(x => x.id === client.id); if (i < 0) throw new E('Cliente no encontrado', 404); out = cs[i] = { ...cs[i], ...c }; }
    else { out = { id: uid(), ...c, created_at: now() }; cs.push(out); }
    await setJ(ctx.s, 'clients', cs);
    return out;
  },
  async deleteClient(ctx, { id }) {
    needSuper(ctx);
    const s = ctx.s;
    for (const wid of await wsList(s, id)) { const w = await getJ(s, `ws/${wid}`); if (w) await deleteWsCascade(s, w); }
    await s.delete(`wsl/${id}`);
    await setJ(s, 'clients', (await getClients(s)).filter(c => c.id !== id));
    const users = await getUsers(s);
    Object.keys(users).forEach(k => { if (users[k].client_id === id) delete users[k]; });
    await setJ(s, 'users', users);
    return true;
  },
  async setUser(ctx, { email, password, client_id }) {
    needSuper(ctx);
    const e = str(email, 120).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new E('Correo no válido');
    if (String(password || '').length < 6) throw new E('La contraseña debe tener al menos 6 caracteres');
    if (e === String(ctx.env.ADMIN_EMAIL).trim().toLowerCase()) throw new E('Ese correo es el del super administrador');
    if (!(await clientOf(ctx.s, client_id))) throw new E('Cliente no encontrado', 404);
    const users = await getUsers(ctx.s), existed = !!users[e];
    users[e] = { email: e, role: 'client_admin', client_id, ...hashPw(password), created_at: (users[e] && users[e].created_at) || now() };
    await setJ(ctx.s, 'users', users);
    return existed ? 'Contraseña actualizada y usuario asignado ✅' : 'Usuario creado ✅';
  },
  async deleteUser(ctx, { email }) {
    needSuper(ctx);
    const users = await getUsers(ctx.s); delete users[str(email, 120).toLowerCase()];
    await setJ(ctx.s, 'users', users); return true;
  },
  async adminsMap(ctx) {
    needSuper(ctx);
    const m = {}; Object.values(await getUsers(ctx.s)).forEach(u => { if (u.client_id) (m[u.client_id] = m[u.client_id] || []).push(u.email); });
    return m;
  },
  async workshopCounts(ctx) {
    needSuper(ctx);
    const m = {}; await Promise.all((await getClients(ctx.s)).map(async c => { m[c.id] = (await wsList(ctx.s, c.id)).length; }));
    return m;
  },

  // --- talleres (facilitador) ---
  async listWorkshops(ctx, { client_id }) {
    await needClient(ctx, client_id, false);
    const docs = (await Promise.all((await wsList(ctx.s, client_id)).map(id => getJ(ctx.s, `ws/${id}`)))).filter(Boolean);
    return docs.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  },
  async getWorkshop(ctx, { id }) {
    const w = await getJ(ctx.s, `ws/${id}`); if (!w) throw new E('Taller no encontrado', 404);
    await needClient(ctx, w.client_id, false); return w;
  },
  async createWorkshop(ctx, { ws }) {
    await needClient(ctx, ws.client_id, true);
    const s = ctx.s, id = uid();
    let code; do { code = newCode(); } while (await getJ(s, `code/${code}`));
    const doc = {
      id, client_id: ws.client_id, name: str(ws.name, 120) || 'Taller', area: str(ws.area, 120), level: str(ws.level, 20),
      period_type: str(ws.period_type, 20), period_label: str(ws.period_label, 60),
      period_start: isDate(ws.period_start) ? ws.period_start : today(), period_end: isDate(ws.period_end) ? ws.period_end : today(),
      phase: 0, data: ws.data || {}, code, created_at: now(), updated_at: now()
    };
    await setJ(s, `ws/${id}`, doc);
    await setJ(s, `code/${code}`, { ws_id: id, client_id: ws.client_id });
    const list = await wsList(s, ws.client_id); list.push(id); await setJ(s, `wsl/${ws.client_id}`, list);
    return doc;
  },
  async saveWorkshop(ctx, { ws }) {
    const s = ctx.s, cur = await getJ(s, `ws/${ws.id}`); if (!cur) throw new E('Taller no encontrado', 404);
    await needClient(ctx, cur.client_id, true);
    const data = ws.data || {};
    if (JSON.stringify(data).length > 1500000) throw new E('El taller es demasiado grande');
    Object.assign(cur, { name: str(ws.name, 120) || cur.name, phase: Math.max(0, Math.min(7, parseInt(ws.phase, 10) || 0)), data, updated_at: now() });
    await setJ(s, `ws/${cur.id}`, cur); cache.delete(cur.id);
    return { updated_at: cur.updated_at };
  },
  async deleteWorkshop(ctx, { id }) {
    const s = ctx.s, w = await getJ(s, `ws/${id}`); if (!w) return true;
    await needClient(ctx, w.client_id, true);
    await deleteWsCascade(s, w);
    await setJ(s, `wsl/${w.client_id}`, (await wsList(s, w.client_id)).filter(x => x !== id));
    return true;
  },
  async workshopStats(ctx, { client_id }) {
    await needClient(ctx, client_id, false);
    const m = {};
    await Promise.all((await wsList(ctx.s, client_id)).map(async id => {
      const [i, p] = await Promise.all([keys(ctx.s, `idea/${id}/`), keys(ctx.s, `part/${id}/`)]);
      m[id] = { ideas: i.length, participants: p.length };
    }));
    return m;
  },

  // --- participantes (solo con código) ---
  async wsPublic(ctx, { code }) {
    const w = await wsByCode(ctx.s, code); if (!w) return null;
    return pub(w, await clientOf(ctx.s, w.client_id));
  },
  async join(ctx, { code, name, avatar }) {
    const s = ctx.s, w = await wsByCode(s, code);
    if (!w) throw new E('No encontramos ese código 🤔', 404);
    const c = await clientOf(s, w.client_id);
    if (!isActive(c)) throw new E('La licencia de este taller no está vigente', 403);
    const n = str(name, 40); if (!n) throw new E('Escribe tu nombre');
    if ((await keys(s, `part/${w.id}/`)).length >= 300) throw new E('El taller llegó al máximo de participantes');
    const p = { id: uid(), name: n, avatar: str(avatar, 8) || '🙂', created_at: now() };
    await setJ(s, `part/${w.id}/${p.id}`, p); cache.delete(w.id);
    return { participant: { ...p, xp: 0 }, workshop: pub(w, c) };
  },
  async live(ctx, { code, pid }) {
    const s = ctx.s, w = await wsByCode(s, code);
    if (!w) return { pub: null, ideas: [], people: [], myVotes: [] };
    const sn = await snapshot(s, w.id);
    return { pub: pub(w, await clientOf(s, w.client_id)), ideas: mapIdeas(sn, pid), people: mapPeople(sn, pid), myVotes: pid ? (sn.votesBy[pid] || []) : [] };
  },
  async addIdea(ctx, { code, pid, author, avatar, text }) {
    const s = ctx.s, w = await wsByCode(s, code); if (!w) throw new E('Código no encontrado', 404);
    if (pid) {
      if (!isActive(await clientOf(s, w.client_id))) throw new E('La licencia no está vigente', 403);
      if (!(await getJ(s, `part/${w.id}/${pid}`))) throw new E('Vuelve a entrar al taller', 403);
      const mine = (await getAll(s, `idea/${w.id}/`)).filter(i => i.pid === pid).length;
      if (mine >= 40) throw new E('Ya enviaste muchas ideas 😄');
    } else await needClient(ctx, w.client_id, true);
    const t = str(text, 200); if (!t) throw new E('Escribe tu idea');
    const idea = { id: uid(), pid: pid || null, author: str(author, 40), avatar: str(avatar, 8), text: t, created_at: now() };
    await setJ(s, `idea/${w.id}/${idea.id}`, idea); cache.delete(w.id);
    return { id: idea.id };
  },
  async voteIdea(ctx, { code, pid, idea_id }) {
    const s = ctx.s, w = await wsByCode(s, code); if (!w) throw new E('Código no encontrado', 404);
    if (!(await getJ(s, `idea/${w.id}/${idea_id}`))) throw new E('Esa idea ya no existe', 404);
    if (!pid) {
      await needClient(ctx, w.client_id, true);
      const fv = (await getJ(s, `fvote/${w.id}`)) || {}; fv[idea_id] = (fv[idea_id] || 0) + 1;
      await setJ(s, `fvote/${w.id}`, fv); cache.delete(w.id);
      return { ok: true };
    }
    if (!isActive(await clientOf(s, w.client_id))) throw new E('La licencia no está vigente', 403);
    if (!(await getJ(s, `part/${w.id}/${pid}`))) throw new E('Vuelve a entrar al taller', 403);
    const live = new Set(await keys(s, `idea/${w.id}/`).then(ks => ks.map(k => k.split('/').pop())));
    let arr = ((await getJ(s, `vote/${w.id}/${pid}`)) || []).filter(id => live.has(id));
    let voted;
    if (arr.includes(idea_id)) { arr = arr.filter(x => x !== idea_id); voted = false; }
    else {
      if (arr.length >= MAX_VOTES) return { ok: false, msg: `Ya usaste tus ${MAX_VOTES} estrellas. Quita una para mover tu voto.`, remaining: 0 };
      arr.push(idea_id); voted = true;
    }
    await setJ(s, `vote/${w.id}/${pid}`, arr); cache.delete(w.id);
    return { ok: true, voted, remaining: MAX_VOTES - arr.length };
  },
  async deleteIdea(ctx, { code, id }) {
    const s = ctx.s, w = await wsByCode(s, code); if (!w) throw new E('Código no encontrado', 404);
    await needClient(ctx, w.client_id, true);
    await s.delete(`idea/${w.id}/${id}`);
    const fv = await getJ(s, `fvote/${w.id}`); if (fv && fv[id]) { delete fv[id]; await setJ(s, `fvote/${w.id}`, fv); }
    cache.delete(w.id); return true;
  }
};

// ---------- punto de entrada ----------
export async function handle(req, store, env) {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  let body; try { body = await req.json(); } catch { return json({ error: 'Solicitud inválida' }, 400); }
  const configured = !!(env.OKR_SECRET && env.ADMIN_EMAIL && env.ADMIN_PASSWORD);
  if (body.action === 'ping') return json({ ok: true, configured });
  if (!configured) return json({ error: 'Falta configurar OKR_SECRET, ADMIN_EMAIL y ADMIN_PASSWORD en Netlify (Environment variables).' }, 500);
  const fn = Object.prototype.hasOwnProperty.call(A, body.action) ? A[body.action] : null;
  if (!fn) return json({ error: 'Acción desconocida' }, 400);
  const ctx = { s: store, env, user: null };
  try {
    const p = verify((req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''), env.OKR_SECRET);
    if (p) ctx.user = await resolveUser(ctx, p);
    const data = await fn(ctx, body);
    return json({ ok: true, data: data === undefined ? null : data });
  } catch (e) {
    if (!e.status) console.error(e);
    return json({ error: e.status ? e.message : 'Error del servidor. Intenta de nuevo.' }, e.status || 500);
  }
}
