// Facts about Daniel's games, handed to Nullp when a question is about them, so it answers from
// the real games instead of guessing. Codes are read straight from the game files (re-read when
// a file changes), so this never goes stale.

import fs from "node:fs";
import path from "node:path";

const cache = new Map(); // file -> { mtime, value }
function fromFile(file, parse) {
  try {
    const mtime = fs.statSync(file).mtimeMs;
    const hit = cache.get(file);
    if (hit && hit.mtime === mtime) return hit.value;
    const value = parse(fs.readFileSync(file, "utf8"));
    cache.set(file, { mtime, value });
    return value;
  } catch {
    return null;
  }
}

/** Monster Attack! codes: `'CODE': { ..., msg: 'What it gives' }` inside `const CODES = {`. */
function monsterCodes(root) {
  return fromFile(path.join(root, "monster-city", "index.html"), (src) => {
    const start = src.indexOf("const CODES = {");
    if (start < 0) return [];
    const block = src.slice(start, src.indexOf("\n    };", start));
    const out = [];
    for (const m of block.matchAll(/'([A-Z0-9_]+)'\s*:\s*\{[^}]*?msg:\s*'([^']*)'/g)) out.push(`${m[1]} — ${m[2]}`);
    return out;
  });
}

/** Arcade codes: `NAME: coins` inside `const CODES = {` in arcade/arcade-shop.js. */
function arcadeCodes(root) {
  return fromFile(path.join(root, "arcade", "arcade-shop.js"), (src) => {
    const start = src.indexOf("const CODES = {");
    if (start < 0) return [];
    const block = src.slice(start, src.indexOf("};", start));
    return [...block.matchAll(/\b([A-Z0-9]{3,}):\s*(\d+)/g)].map((m) => `${m[1]} (+${m[2]} play coin${m[2] === "1" ? "" : "s"})`);
  });
}

const ARCADE_FACTS = `DANIEL'S ARCADE (localhost:4173/games/arcade/) — hub for Daniel's games: Monster Attack!, REBUILD, Buckshot Roulette, Track Run, Learn English.
- Play coins: 1 per 10 minutes of play inside the arcade (max 24 a day; pauses after 5 minutes idle). Arcade codes give coins too.
- 🛒 Shop: themes, avatars, titles, gun/ability/background skins (work in Monster Attack!, Buckshot, REBUILD), ⚡ abilities (levels 1–5, max 3 switched on per game in the ⚡ bar on the left), and trading coins for each game's money (max 20 coins a day per game).
- Quests (open from the invisible bottom-left corner of Shop → 🎁 Codes): Hard Quest → Medium Quests (unlocked by an invisible secret near spawn in Monster Attack!'s Astral Temple) → Easy Quest → 🛠️ Admin Panel.
- Easy Quest = unlock 3 titles: 🏆 Champion (win Buckshot 10 times in a row, then wear the Shadow gun skin), ⚡ Fast Comebacker (win a REBUILD battle after your base hit 1 HP), ⚔️ Revenge (die to the ☠️ Reaper boss in Monster Attack!, then beat it in your very next match).
- 👤 Log in / Sign up saves all progress to an account on this computer.`;

const GAME_WORDS = /\b(arcade|monster|attack|buckshot|roulette|rebuild|track run|learn english|code|codes|title|titles|quest|quests|skin|skins|abilit|coin|coins|shop|reaper|champion|comeback|revenge|admin|astral|flesh|shard)/i;

/**
 * Facts for this turn, or "" when the conversation isn't about the games.
 * @param {Array<{role:string,content:string}>} history
 * @param {string} context  what the in-game widget says it is sitting in (may name the game)
 * @param {string} root     the folder that holds the game folders
 */
export function gameKnowledge(history, context, root) {
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  const text = `${context || ""} ${typeof lastUser?.content === "string" ? lastUser.content : ""}`;
  if (!GAME_WORDS.test(text)) return "";

  const parts = [ARCADE_FACTS];
  if (/\bcodes?\b/i.test(text)) {
    const inMonster = /monster|attack/i.test(text);
    const inArcade = /arcade/i.test(text);
    const mc = monsterCodes(root) || [];
    const ac = arcadeCodes(root) || [];
    if ((inMonster || !inArcade) && mc.length) {
      parts.push(`MONSTER ATTACK! CODES (type them in the game's "Enter Code" box on the main menu; each works up to 10 times a day):\n${mc.join("\n")}`);
    }
    if ((inArcade || !inMonster) && ac.length) {
      parts.push(`ARCADE CODES (type them in the arcade's Shop → 🎁 Codes tab; each works once; finding all ${ac.length} unlocks the 🕵️ Secret Agent pack):\n${ac.join("\n")}`);
    }
  }
  return `FACTS ABOUT DANIEL'S GAMES (answer game questions ONLY from these facts; never invent codes, prices or features — if something isn't here, say you don't know it. When asked for codes, list them: one [info] line per code, written exactly as "CODE — reward"; "all codes" means every code below, in this order, even in brief mode):\n${parts.join("\n\n")}`;
}

/**
 * A request to LIST codes ("all codes", "list the codes", "what codes are there") gets an exact
 * answer straight from the game files — the small local model drops or mangles long lists.
 * Returns Nullp-formatted lines, or null when this isn't a code-list request.
 */
export function codeListAnswer(history, context, root) {
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  const q = typeof lastUser?.content === "string" ? lastUser.content : "";
  if (!/\bcodes\b/i.test(q) || !/\b(all|list|every|what|which|give|show|tell)\b/i.test(q)) return null;
  const where = `${context || ""} ${q}`;
  const inMonster = /monster|attack/i.test(where), inArcade = /arcade/i.test(where);
  if (!inMonster && !inArcade) return null;
  const lines = [];
  if (inMonster) {
    const mc = monsterCodes(root) || [];
    if (mc.length) {
      lines.push(`[info] Monster Attack! has ${mc.length} codes. Type them in the "Enter Code" box on the main menu — each works up to 10 times a day.`);
      for (const c of mc) lines.push(`[info] ${c}`);
    }
  }
  if (inArcade) {
    const ac = arcadeCodes(root) || [];
    if (ac.length) {
      lines.push(`[info] The arcade has ${ac.length} codes. Type them in Shop → 🎁 Codes — each works once, and finding all of them unlocks the 🕵️ Secret Agent pack.`);
      for (const c of ac) lines.push(`[info] ${c}`);
    }
  }
  return lines.length ? lines.join("\n") : null;
}
