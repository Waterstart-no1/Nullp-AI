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
    return { users: d.users || {}, sessions: d.sessions || {} };
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

  if (req.method === "POST" && route === "logout") {
    delete db.sessions[me.token];
    persist();
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: "Not found." });
}
