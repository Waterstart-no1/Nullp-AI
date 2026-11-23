// Daniel's Arcade accounts: sign up / log in, and one saved snapshot of progress per account.
//
// Everything lives in ~/.daniels-arcade/accounts.json (override with ARCADE_DATA_DIR) — outside
// every git repo, so accounts never end up on GitHub. Passwords are stored only as scrypt hashes.
// This is a localhost server for one family's computer, not an internet service.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const DIR = process.env.ARCADE_DATA_DIR || path.join(os.homedir(), ".daniels-arcade");
const FILE = path.join(DIR, "accounts.json");
const MAX_SAVE = 3.5e6;              // characters of saved progress per account
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const LOCK_AFTER = 5, LOCK_MS = 30_000; // wrong passwords before a short lock-out

let db = loadDb(); // { users: { key: { name, salt, hash, created, save, savedAt } }, sessions: { token: key } }
const fails = new Map(); // key -> { n, until }

function loadDb() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return { users: d.users || {}, sessions: d.sessions || {}, lotto: d.lotto };
  } catch {
    return { users: {}, sessions: {} };
  }
}

function persist() {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 });
  fs.renameSync(tmp, FILE); // never leave a half-written file behind
}

const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString("hex");
const keyOf = (name) => String(name || "").toLowerCase();

function newSession(key) {
  const token = crypto.randomBytes(24).toString("hex");
  db.sessions[token] = key;
  return token;
}

function userFromToken(req) {
  const token = req.headers["x-arcade-token"];
  const key = token && db.sessions[token];
  return key && db.users[key] ? { key, token, user: db.users[key] } : null;
}

async function body(req, readBody) {
  try {
    return JSON.parse((await readBody(req)) || "{}");
  } catch {
    return null;
  }
}

// Is a Discord invite still good? Asks Discord's public invite API, at most every 6 hours per code.
const inviteCache = new Map(); // code -> { at, data }
async function discordInvite(code) {
  const hit = inviteCache.get(code);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.data;
  let data;
  try {
    const r = await fetch(`https://discord.com/api/v10/invites/${encodeURIComponent(code)}?with_expiration=true`,
      { signal: AbortSignal.timeout(8000) });
    if (r.status === 404) data = { valid: false, expiresAt: null, server: null };
    else if (!r.ok) return { valid: null, error: `Discord said ${r.status}` }; // unknown: don't cache
    else {
      const d = await r.json();
      const expiresAt = d.expires_at || null;
      data = { valid: !expiresAt || Date.parse(expiresAt) > Date.now(), expiresAt, server: d.guild?.name || null };
    }
  } catch {
    return { valid: null, error: "Couldn't reach Discord" }; // offline: say "unknown", don't cache
  }
  inviteCache.set(code, { at: Date.now(), data });
  return data;
}

// 🐞 Bug reports. The arcade's "Send report" (and crashes it catches inside a game) arrive here, so
// they reach the Admin Panel from ANY browser or address on this computer — they used to stay in the
// browser they were typed in. Kept in ~/.daniels-arcade/bugs.json (newest 300).
const BUGS_FILE = path.join(DIR, "bugs.json");
const MAX_BUGS = 300;
function loadBugs() {
  try { const b = JSON.parse(fs.readFileSync(BUGS_FILE, "utf8")); return Array.isArray(b) ? b : []; } catch { return []; }
}
function saveBugs(list) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const tmp = BUGS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(list.slice(-MAX_BUGS)), { mode: 0o600 });
  fs.renameSync(tmp, BUGS_FILE);
}

/** Handles /api/arcade/*. Returns the response it sent. */
// 🎟️ LOTTO: a ticket costs 50 arcade points (the game takes them; the server keeps the tickets). A season is a
// year; when it ends (or at the time an admin picked: POST lotto/schedule) the season is drawn:
//   • 250+ players: every ticket has a 0.000000000000000000000000001% chance (1e-29) to win the 🛠️ Admin Panel
//     in every game and the arcade;
//   • fewer than 50 players: every player (with a ticket) has a 1% chance to win 75 points — more tickets don't add to it;
//   • (50–249 players: no draw).
export const LOTTO = { PRICE: 50, GRAND_CHANCE: 1e-29, GRAND_PLAYERS: 250, SMALL_UNDER: 50, SMALL_PRIZE: 75, SMALL_CHANCE: 0.01, MAX_BUY: 1000 };
export const seasonOf = (d = new Date()) => String(d.getFullYear());
export const nextYear = (d = new Date()) => new Date(d.getFullYear() + 1, 0, 1).getTime();
const yearAfter = (season) => { const y = parseInt(season, 10); return y ? new Date(y + 1, 0, 1).getTime() : 0; };
export function lottoRoll(rnd = Math.random, now = new Date()) {
  db.lotto = db.lotto || { season: seasonOf(now), tickets: {}, results: {} };
  const L = db.lotto;
  if (!L.yearly) {   // (seasons used to be months: "2026-11" → "2026", ending with the year)
    L.yearly = true; L.endsAt = Math.max(L.endsAt || 0, yearAfter(L.season) || nextYear(now));
  }
  if (/^\d{4}-\d{2}$/.test(L.season) && !L.results[L.season.slice(0, 4)]) L.season = L.season.slice(0, 4);   // "2026-11" → "2026"
  if (!L.endsAt) L.endsAt = yearAfter(L.season) || nextYear(now);
  if (+now < L.endsAt) return null;
  const keys = Object.keys(L.tickets).filter((k) => L.tickets[k] > 0), total = keys.reduce((a, k) => a + L.tickets[k], 0);
  const r = { season: L.season, total, players: keys.length, grand: [], small: [], claimed: {}, tickets: { ...L.tickets } };
  if (keys.length >= LOTTO.GRAND_PLAYERS) for (const k of keys) for (let i = 0; i < Math.min(L.tickets[k], 1e6); i++) if (rnd() < LOTTO.GRAND_CHANCE) { r.grand.push(k); break; }
  if (keys.length < LOTTO.SMALL_UNDER) for (const k of keys) if (rnd() < LOTTO.SMALL_CHANCE) r.small.push(k);   // 1% a player
  L.results[L.season] = r; L.last = L.season; L.tickets = {};
  let s = seasonOf(now); for (let i = 2; L.results[s]; i++) s = `${seasonOf(now)}-${i}`;   // (a 2nd draw in the same year)
  L.season = s; L.endsAt = nextYear(now);
  persist(); return r;
}
export const _testDb = () => db;   // (tests only)
const smallOf = (r) => (Array.isArray(r.small) ? r.small : r.small ? [r.small] : []);   // (older draws had one winner)
function lottoView(me) {
  lottoRoll();
  const L = db.lotto, last = L.last ? L.results[L.last] : null, key = me && me.key, name = (k) => (db.users[k] ? db.users[k].name : "?");
  return { season: L.season, endsAt: L.endsAt, price: LOTTO.PRICE, players: Object.keys(L.tickets).filter((k) => L.tickets[k] > 0).length, total: Object.values(L.tickets).reduce((a, b) => a + b, 0),
           mine: key ? L.tickets[key] || 0 : 0, rules: LOTTO,
           last: last && { season: last.season, players: last.players, total: last.total, grandWinners: last.grand.map(name), smallWinners: smallOf(last).map(name),
                           iWonGrand: !!key && last.grand.includes(key), iWonSmall: !!key && smallOf(last).includes(key), claimed: !!(key && last.claimed[key]), myTickets: key && last.tickets ? last.tickets[key] || 0 : 0 } };
}
export async function handleArcade(req, res, url, { json, readBody }) {
  const route = url.pathname.slice("/api/arcade/".length);

  if (route === "bugs" || route.startsWith("bugs/")) {
    if (req.method === "GET" && route === "bugs") return json(res, 200, { bugs: loadBugs() });
    if (req.method === "POST" && route === "bugs") {
      const b = await body(req, readBody);
      const text = b && typeof b.text === "string" ? b.text.trim().slice(0, 1000) : "";
      const game = b && typeof b.game === "string" ? b.game.slice(0, 40) : "";
      if (text.length < 3 || !/^[A-Za-z0-9_-]+$/.test(game)) return json(res, 400, { error: "A report needs a game and some words." });
      const list = loadBugs();
      const auto = !!b.auto;
      // The same crash over and over is one bug.
      if (auto && list.some((x) => x.auto && x.game === game && x.text === text)) return json(res, 200, { ok: true, dup: true });
      const from = typeof b.from === "string" ? b.from.slice(0, 24) : "";
      const bug = { id: crypto.randomBytes(6).toString("hex"), at: Date.now(), game, text, auto, from };
      saveBugs([...list, bug]);
      return json(res, 200, { ok: true, id: bug.id });
    }
    if (req.method === "DELETE" && route === "bugs") { saveBugs([]); return json(res, 200, { ok: true }); }
    if (req.method === "DELETE") {
      const id = route.slice("bugs/".length);
      saveBugs(loadBugs().filter((x) => x.id !== id));
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: "Not allowed." });
  }

  if (req.method === "GET" && route === "discord") {
    const code = String(url.searchParams.get("invite") || "").replace(/^.*\//, "");
    if (!/^[A-Za-z0-9-]{2,32}$/.test(code)) return json(res, 400, { error: "Bad invite." });
    return json(res, 200, await discordInvite(code));
  }

  if (req.method === "GET" && route === "lotto") return json(res, 200, lottoView(userFromToken(req)));   // 🎟️ (anyone can look)

  // 🏆 Leaderboards (anyone can look): every account's latest numbers for a game.
  if (req.method === "GET" && route === "leaderboard") {
    const game = String(url.searchParams.get("game") || "");
    if (!/^[a-z0-9_-]{2,20}$/.test(game)) return json(res, 400, { error: "Bad game." });
    const players = Object.values(db.users).filter((u) => u.scores && u.scores[game]).map((u) => ({ name: u.name, ...u.scores[game] }));
    return json(res, 200, { players });
  }

  if (req.method === "POST" && route === "signup") {
    const b = await body(req, readBody);
    if (!b) return json(res, 400, { error: "Bad request." });
    const name = String(b.name || "").trim(), password = String(b.password || "");
    if (!NAME_RE.test(name)) return json(res, 400, { error: "Name: 3–16 letters, numbers or _." });
    if (password.length < 4 || password.length > 100) return json(res, 400, { error: "Password: at least 4 characters." });
    const key = keyOf(name);
    if (db.users[key]) return json(res, 409, { error: "That name is taken — try another, or log in." });
    const salt = crypto.randomBytes(16).toString("hex");
    db.users[key] = { name, salt, hash: hashPw(password, salt), created: Date.now(), save: null, savedAt: 0 };
    const token = newSession(key);
    persist();
    return json(res, 200, { name, token });
  }

  if (req.method === "POST" && route === "login") {
    const b = await body(req, readBody);
    if (!b) return json(res, 400, { error: "Bad request." });
    const key = keyOf(b.name), user = db.users[key];
    const f = fails.get(key);
    if (f && f.until > Date.now()) return json(res, 429, { error: "Too many tries — wait 30 seconds." });
    const ok = user && crypto.timingSafeEqual(Buffer.from(hashPw(String(b.password || ""), user.salt), "hex"), Buffer.from(user.hash, "hex"));
    if (!ok) {
      const n = (f ? f.n : 0) + 1;
      // After LOCK_AFTER wrong tries the name is locked for LOCK_MS, then the count starts again.
      fails.set(key, n >= LOCK_AFTER ? { n: 0, until: Date.now() + LOCK_MS } : { n, until: 0 });
      return json(res, 401, { error: "Wrong name or password." });
    }
    fails.delete(key);
    const token = newSession(key);
    persist();
    return json(res, 200, { name: user.name, token, save: user.save, savedAt: user.savedAt });
  }

  const me = userFromToken(req);
  if (!me) return json(res, 401, { error: "Not logged in." });

  if (req.method === "GET" && route === "me") return json(res, 200, { name: me.user.name, savedAt: me.user.savedAt });

  if (req.method === "GET" && route === "save") {
    return json(res, 200, { name: me.user.name, save: me.user.save, savedAt: me.user.savedAt });
  }

  if (req.method === "PUT" && route === "save") {
    const b = await body(req, readBody);
    if (!b || typeof b.save !== "object" || b.save === null) return json(res, 400, { error: "Bad save." });
    if (JSON.stringify(b.save).length > MAX_SAVE) return json(res, 413, { error: "Save is too big." });
    me.user.save = b.save;
    me.user.savedAt = Date.now();
    persist();
    return json(res, 200, { ok: true, savedAt: me.user.savedAt });
  }

  // 🏆 A game sends the logged-in player's numbers for its leaderboard (only whole numbers, only known fields).
  if (req.method === "POST" && route === "score") {
    const b = await body(req, readBody);
    const game = b && String(b.game || "");
    if (!b || !/^[a-z0-9_-]{2,20}$/.test(game)) return json(res, 400, { error: "Bad score." });
    const s = { at: Date.now() };
    for (const k of ["trophies", "rebirths", "prestige", "th"]) s[k] = Math.max(0, Math.min(1e9, Math.floor(Number(b[k]) || 0)));
    if (typeof b.title === "string") s.title = b.title.replace(/[<>&"]/g, "").slice(0, 40);   // the title they wear
    me.user.scores = Object.assign({}, me.user.scores, { [game]: s });
    persist();
    return json(res, 200, { ok: true });
  }

  // 🎟️ buy tickets (the game has already checked and taken the points) / claim last season's prize
  if (req.method === "POST" && route === "lotto/buy") {
    const b = await body(req, readBody); const n = Math.floor(Number(b && b.n) || 0);
    if (n < 1 || n > LOTTO.MAX_BUY) return json(res, 400, { error: `Buy 1–${LOTTO.MAX_BUY} tickets at a time.` });
    lottoRoll(); db.lotto.tickets[me.key] = (db.lotto.tickets[me.key] || 0) + n; persist();
    return json(res, 200, lottoView(me));
  }
  // 🛠️ Admin Panel: pick when this season is drawn — { at: <time> }, { now: true } or { yearly: true }
  if (req.method === "POST" && route === "lotto/schedule") {
    const b = (await body(req, readBody)) || {}; lottoRoll(); const L = db.lotto, at = Number(b.at);
    if (b.now) L.endsAt = Date.now();
    else if (b.yearly) L.endsAt = nextYear();
    else if (at > Date.now() && at < Date.now() + 5 * 366 * 864e5) L.endsAt = Math.floor(at);
    else return json(res, 400, { error: "Pick a time in the future." });
    persist(); lottoRoll(); return json(res, 200, lottoView(me));
  }
  if (req.method === "POST" && route === "lotto/claim") {
    lottoRoll(); const L = db.lotto, last = L.last ? L.results[L.last] : null;
    if (!last || last.claimed[me.key]) return json(res, 400, { error: "Nothing to claim." });
    const grand = last.grand.includes(me.key), coins = smallOf(last).includes(me.key) ? LOTTO.SMALL_PRIZE : 0;
    if (!grand && !coins) return json(res, 400, { error: "No prize this time." });
    last.claimed[me.key] = true; persist();
    return json(res, 200, { grand, coins });
  }

  if (req.method === "POST" && route === "logout") {
    delete db.sessions[me.token];
    persist();
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: "Not found." });
}
