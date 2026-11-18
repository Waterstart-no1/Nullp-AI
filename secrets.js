// 🔒 Secrets Nullp must never say — not even when they're sitting in a game file, a GitHub page or a pasted
// file. The games are public on GitHub, so their source holds a few things only the owner should know (the
// admin codes; the owner code is only kept as a hash). Nullp:
//   1. refuses questions that ask for a secret (asksForSecret → secretRefusal),
//   2. strips secrets out of everything it reads before the model sees it (redact),
//   3. checks every answer on the way out, even when a secret is split across streamed chunks (Redactor).
// The owner code is NOT written here either: an answer word is hashed and compared with the owner-code hashes.
import fs from "node:fs";
import path from "node:path";

// cyrb53 — the same one-way hash the games use for the owner code (seed 67).
export function codeHash(str, seed = 67) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const LOCK = "🔒";
// Owner- and admin-code hashes, read from the games (OWNER_HASH / ADMIN_HASH / …_CODE_HASH) plus the one known today.
const BASE_HASHES = ["1nzwpznwvfj"];
// Keys and tokens that should never be repeated, wherever they came from.
const KEY_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g,                      // Anthropic API keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,                  // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,                            // AWS keys
  /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g,                 // Slack tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(ANTHROPIC_API_KEY|API_KEY|SECRET|TOKEN|PASSWORD|PASSWD)\s*[=:]\s*["']?[^\s"']{6,}/gi,   // KEY=value lines
];

const cache = new Map();
function fromFile(file, read, tag) {
  const key = file + "#" + tag;
  try {
    const mtime = fs.statSync(file).mtimeMs, hit = cache.get(key);
    if (hit && hit.mtime === mtime) return hit.value;
    const value = read(fs.readFileSync(file, "utf8"));
    cache.set(key, { mtime, value });
    return value;
  } catch {
    return [];
  }
}

/** The secret strings in Daniel's games: admin codes (written in plain text), and the owner-code hashes. */
export function gameSecrets(root) {
  const plain = new Set(), hashes = new Set(BASE_HASHES);
  const add = (list) => list.forEach((s) => s && plain.add(s));
  const games = [
    path.join(root, "monster-city", "index.html"),
    path.join(root, "arcade", "island", "index.html"),
    path.join(root, "arcade", "index.html"),
    path.join(root, "arcade", "arcade-shop.js"),
    path.join(root, "rebuild", "index.html"),
  ];
  for (const file of games) {
    add(fromFile(file, (src) => {
      const out = [];
      for (const m of src.matchAll(/\bADMIN_(?:CODE|PASS(?:WORD)?)\s*=\s*["']([^"']{4,})["']/g)) out.push(m[1]);
      // a code whose reward opens a panel (Monster Attack!'s CODES: 'XYZ': { reward: 'panel', ... })
      for (const m of src.matchAll(/['"]([A-Z0-9_]{4,})['"]\s*:\s*\{\s*reward:\s*['"](?:panel|ownerpanel|adminpanel)['"]/g)) out.push(m[1]);
      return out;
    }, "plain"));
    for (const h of fromFile(file, (src) => [...src.matchAll(/(?:OWNER|ADMIN)_(?:CODE_)?HASH\s*=\s*["']([a-z0-9]{6,})["']/g)].map((m) => m[1]), "hash")) hashes.add(h);
  }
  return { plain: [...plain], hashes: [...hashes] };
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isOwnerWord = (w, hashes) => {
  // the word as written, and without punctuation stuck to its ends ("CODE!", "(code)", "code.")
  for (const base of new Set([w, w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")])) {
    if (base.length < 6 || base.length > 40) continue;
    for (const v of new Set([base, base.toUpperCase(), base.toLowerCase()])) if (hashes.includes(codeHash(v))) return true;
  }
  return false;
};

/** Text with every secret replaced by 🔒. */
export function redact(text, secrets) {
  if (!text) return text;
  let out = String(text);
  for (const s of secrets.plain) out = out.replace(new RegExp(esc(s), "gi"), LOCK);
  for (const h of secrets.hashes) out = out.replace(new RegExp(esc(h), "gi"), LOCK);   // the hash itself is a clue too
  for (const re of KEY_PATTERNS) out = out.replace(re, LOCK);
  out = out.replace(/[A-Za-z0-9!@#$%^&*_+=.-]{6,40}/g, (w) => (isOwnerWord(w, secrets.hashes) ? LOCK : w));
  return out;
}

/** Is the person asking Nullp to give away a secret code, a password or a key? */
export function asksForSecret(text) {
  const t = String(text || "");
  const target = /\b(admin|owner|admins|owners)\s*(panel\s*)?(code|codes|password|passwords|pass|key|keys|hash)\b|\b(code|password)s?\s*(for|of|to)\s*(the\s*)?(admin|owner)|\bpasswords?\b|\bsecret\s*(code|codes|key|keys)\b|\bpanel\s*(code|codes|password)\b|\bapi\s*keys?\b|\b(access\s*)?tokens?\b/i;
  const reveal = /\b(what|whats|what's|tell|give|say|show|reveal|share|find|leak|know|list|read|type|enter|is|are|get|need|want|hack|crack|guess|spell)\b/i;
  return target.test(t) && reveal.test(t);
}

export const secretRefusal = [
  "[warn] Nullp never shares secret codes, passwords or keys — not even ones that are in the games' code on GitHub.",
  "[info] The 🛠️ Admin and 👑 Owner panels belong to the game's owner. Ask them if you think you should have access.",
  "[info] Forgot your arcade password? A grown-up can reset it on the computer with Reset Arcade Password.",
].join("\n");

/**
 * Checks streamed answer text on its way to the screen. A secret can arrive split over several chunks, so it
 * holds back the end of the text (after the last space) until more arrives, and checks each finished piece.
 */
export class Redactor {
  constructor(secrets, emit) { this.secrets = secrets; this.emit = emit; this.buf = ""; }
  push(text) {
    this.buf += text;
    const cut = Math.max(this.buf.lastIndexOf(" "), this.buf.lastIndexOf("\n"));
    if (cut < 0 && this.buf.length < 120) return;   // still in the middle of a word
    const keep = cut < 0 ? "" : this.buf.slice(cut + 1);
    const ready = cut < 0 ? this.buf : this.buf.slice(0, cut + 1);
    this.buf = keep;
    if (ready) this.emit(redact(ready, this.secrets));
  }
  flush() { if (this.buf) this.emit(redact(this.buf, this.secrets)); this.buf = ""; }
}
