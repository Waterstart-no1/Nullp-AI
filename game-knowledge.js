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
- Play coins: 1 per 15 minutes of play inside the arcade (max 24 a day; pauses after 5 minutes idle). Arcade codes give coins too.
- 🛒 Shop: themes, avatars, titles, gun/ability/background skins (work in Monster Attack!, Buckshot, REBUILD), ⚡ abilities (levels 1–5, max 3 switched on per game in the ⚡ bar on the left), and trading coins for each game's money (max 20 coins a day per game).
- Quests (open from the invisible bottom-left corner of Shop → 🎁 Codes): Hard Quest → Medium Quests (unlocked by an invisible secret near spawn in Monster Attack!'s Astral Temple) → Easy Quest → 🛠️ Admin Panel.
- Easy Quest = unlock 3 titles: 🏆 Champion (win Buckshot 10 times in a row, then wear the Shadow gun skin), ⚡ Fast Comebacker (win a REBUILD battle after your base hit 1 HP), ⚔️ Revenge (die to the ☠️ Reaper boss in Monster Attack!, then beat it in your very next match).
- 👤 Log in / Sign up saves all progress to an account on this computer.`;

// Monster Attack!'s seasonal castles and their boss loot (kept in step with monster-city/index.html).
const CASTLE_FACTS = `MONSTER ATTACK! EVENTS, CASTLES AND BOSS LOOT
- 🎃 Halloween (1 Oct – 7 Nov) uses 🍬 candy; 🎄 Christmas (1 Dec – 7 Jan) uses ❄️ snowflakes. Both have a 50-tier season pass. At Halloween each wave has a 🚪 trick-or-treat door to walk to (a treat of 3–8 candy, or a trick); at Christmas every new wave simply GIVES you a 🎁 present of 3–8 snowflakes.
- The castle: at Halloween a 🎃 candy castle, at Christmas a ❄️ ice castle. It turns up in 5% of runs on any map (watch the minimap). Inside: 4 Castle Guards (beat them: +10 points), then the door opens on one boss. Beating the boss: +100 candy / snowflakes.
- 🏚️ Trick-or-Treat Street (Halloween map, once a Halloween): the road carries you forward; knock on doors until your candy doubles, then the candy castle.
- 🛷 Santa's Sleigh Road (Christmas map, once a Christmas): say "santa" to Nullp at Christmas to open it. No houses to knock on: ride straight to the ice castle, no guards — straight to the boss. Beat it and your snowflakes DOUBLE (at least +20).
- Bosses (chance it is the boss) — Halloween / Christmas twin: 50% Slimy the Jelly / Sleety the Slush · 25% Biscuit the Cerberus / Ginger the Cerberus · 14% Mr Roll / Mr Candy Cane · 10% Mr Blob / Mr Figgy · 1% Mrs Gum / Mrs Frost.
- Each drop rolls on its own. Twins drop the same things at the same chances; only the pet, skill and item are the Christmas version (Halloween / Christmas):
  • Slimy / Sleety: 25% 💧 Little Blue Slime / ❄️ Little Snow Slime pet (eats 20% of attacks and fires them back; name and colour it in Pets; if owned, 50% it levels up) · 10% 💎 Upgrade Crystal · 30% 🩸 64 blood / 🧊 64 ice ([B] builds a 10-HP wall) · 60% 500 flesh + 5 points.
  • Biscuit / Ginger: 10% 🐕 Cookie / Gingersnap pet (eats the corpses of monsters killed near it, +1 level per 3) · 20% 🍪🐕 Cookie Dogs / 🍪 Gingerbread Men skill (click its button: 5 helpers with 30% of your stats, 50% if you own a corpse-eating pet; 45 s cooldown) · 30% 🍪 10 Crumbles / ⛄ 10 Snowballs ([T] throws one: damage + a wall; snowballs also freeze) · 40% 👑 Cookie King avatar.
  • Mr Roll / Mr Candy Cane: 10% 🍥 Rolly / 🔔 Jingle pet (blocks 40% of attacks, levels up from blocking, +20% XP while out) · 30% 🧱 10 Candy Blocks / 🧊 10 Ice Blocks ([C] places a wall that takes 20 shots) · 40% 3000 flesh + 3 blocks · 50% 🍥 Master of Rolls title (+3% candy).
  • Mr Blob / Mr Figgy: 10% 🍮 Mr Blob / 🎄 Mr Figgy pet (eats 60% of attacks; then 20% it turns giant and jumps: every monster dies, bosses lose 25%) · 30% 🏅 Master of Candy Grinding title (+10% candy) · 40% 🤝 Friendship / 🦌 Reindeer Call skill (HOLD F for 1 s: Mr Gum / Rudolph, 20% of Mrs Gum's / Mrs Frost's stats; a quick tap of F is still fullscreen) · 60% 🟤 3 Blobs / 🧦 3 Stockings (each blocks one hit; 10% it levels up one of your pets).
  • Mrs Gum / Mrs Frost: 10% 🐻 Gumdrop / ❄️ Snowdrop pet (has all four pet powers) · 5% 💠 Candy / Frost Combination Crystal (in Pets, fuses that castle's 4 boss pets into 👑 the Candy Lord / Frost Lord: all powers +80%) · 20% 💎 3 Upgrade Crystals · 40% 👑 Boss Summon / 🎅 Christmas Boss Summon ([H]: a random boss of that castle fights for you, 50% of its stats, 30 s) · 50% 50,000 flesh + 5 arcade play coins.
- Boss pets are LIMITED rarity (above SSS) and do NOT count toward the 5 equipped battle pets — you can have every LIMITED pet out as well. Pets level 1 → 10 (max 10); each level makes a pet's shots 15% stronger; 💎 Upgrade Crystals level a pet in Pets.
- Owners/admins: the 🛠️ Admin Panel and 👑 Owner Panel have 🏰 Castle Boss Loot and 🗺️ Event Maps sections, and [U] in a game is Admin Unlocks.`;
const CASTLE_WORDS = /\b(castle|boss(es)?|drops?|loot|pets?|limited|slim(e|y)|sleety|biscuit|ginger(snap|bread)?|cookie|rolly|jingle|mr ?roll|candy ?cane|mr ?blob|figgy|mrs ?gum|mrs ?frost|gumdrop|snowdrop|candy ?lord|frost ?lord|crystal|crumbles?|snowballs?|candy ?blocks?|ice ?blocks?|blobs?|stockings?|summon|halloween|christmas|candy|snowflakes?|santa|sleigh|trick|treat|reindeer|rudolph|friendship|cerberus|event|season pass)\b/i;

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
  if (!GAME_WORDS.test(text) && !CASTLE_WORDS.test(text)) return "";

  const parts = [ARCADE_FACTS];
  if (CASTLE_WORDS.test(text)) parts.push(CASTLE_FACTS);
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

// ---------------------------------------------------------------- exact boss / pet / loot answers
// The small local model mixes up which twin drops what, so a question that names a castle boss, a boss pet
// or a boss item is answered straight from this table (like the code lists above).
const H = "🎃 candy castle (Halloween)", X = "❄️ ice castle (Christmas)";
const BOSSES = [
  { names: ["slimy the jelly", "slimy"], name: "Slimy the Jelly", castle: H, pct: 50, drops: ["25% 💧 Little Blue Slime pet (if you have it: 50% it levels up)", "10% 💎 an Upgrade Crystal", "30% 🩸 64 blood ([B] = blood wall)", "60% 🍖 500 flesh + 🏆 5 points"] },
  { names: ["sleety the slush", "sleety"], name: "Sleety the Slush", castle: X, pct: 50, drops: ["25% ❄️ Little Snow Slime pet (if you have it: 50% it levels up)", "10% 💎 an Upgrade Crystal", "30% 🧊 64 ice ([B] = ice wall)", "60% 🍖 500 flesh + 🏆 5 points"] },
  { names: ["biscuit the cerberus", "biscuit"], name: "Biscuit the Cerberus", castle: H, pct: 25, drops: ["10% 🐕 Cookie the Cerberus pet", "20% 🍪🐕 the Cookie Dogs skill", "30% 🍪 10 Crumbles ([T])", "40% 👑 the Cookie King avatar"] },
  { names: ["ginger the cerberus", "ginger"], name: "Ginger the Cerberus", castle: X, pct: 25, drops: ["10% 🐕 Gingersnap the Cerberus pet", "20% 🍪 the Gingerbread Men skill", "30% ⛄ 10 Snowballs ([T])", "40% 👑 the Cookie King avatar"] },
  { names: ["mr roll"], name: "Mr Roll", castle: H, pct: 14, drops: ["10% 🍥 Rolly pet", "30% 🧱 10 Candy Blocks ([C])", "40% 🍖 3000 flesh + 3 Candy Blocks", "50% 🍥 the Master of Rolls title (+3% candy)"] },
  { names: ["mr candy cane", "candy cane"], name: "Mr Candy Cane", castle: X, pct: 14, drops: ["10% 🔔 Jingle pet", "30% 🧊 10 Ice Blocks ([C])", "40% 🍖 3000 flesh + 3 Ice Blocks", "50% 🍥 the Master of Rolls title (+3% candy)"] },
  { names: ["mr blob"], name: "Mr Blob", castle: H, pct: 10, drops: ["10% 🍮 Mr Blob pet", "30% 🏅 the Master of Candy Grinding title (+10% candy)", "40% 🤝 the Friendship skill (hold F: Mr Gum)", "60% 🟤 3 Blobs"] },
  { names: ["mr figgy", "figgy"], name: "Mr Figgy", castle: X, pct: 10, drops: ["10% 🎄 Mr Figgy pet", "30% 🏅 the Master of Candy Grinding title (+10% candy)", "40% 🦌 the Reindeer Call skill (hold F: Rudolph)", "60% 🧦 3 Stockings"] },
  { names: ["mrs gum"], name: "Mrs Gum", castle: H, pct: 1, drops: ["10% 🐻 Gumdrop pet", "5% 💠 a Candy Combination Crystal", "20% 💎 3 Upgrade Crystals", "40% 👑 a Boss Summon ([H])", "50% 🍖 50,000 flesh + 🪙 5 arcade play coins"] },
  { names: ["mrs frost"], name: "Mrs Frost", castle: X, pct: 1, drops: ["10% ❄️ Snowdrop pet", "5% 💠 a Frost Combination Crystal", "20% 💎 3 Upgrade Crystals", "40% 🎅 a Christmas Boss Summon ([H])", "50% 🍖 50,000 flesh + 🪙 5 arcade play coins"] },
];
// Things you can get → [match, where from, what it does, drop chance]
const LOOT = [
  [/\b(little )?blue slime\b/, "Slimy the Jelly", "a LIMITED pet: eats 20% of the attacks aimed at you and fires them back (you can name it and pick its colour and hat in 🐾 Pets)", "25%"],
  [/\b(little )?snow slime\b/, "Sleety the Slush", "a LIMITED pet: eats 20% of the attacks aimed at you and fires them back (name and look in 🐾 Pets)", "25%"],
  [/\bcookie the cerberus\b|\bcookie (pet|dog)\b(?!s)/, "Biscuit the Cerberus", "a LIMITED pet: eats the corpses of monsters killed near it (+1 level per 3)", "10%"],
  [/\bgingersnap\b/, "Ginger the Cerberus", "a LIMITED pet: eats the corpses of monsters killed near it (+1 level per 3)", "10%"],
  [/\bcookie dogs\b/, "Biscuit the Cerberus", "a skill: click its button for 5 cookie dogs with 30% of your stats (50% if you own a corpse-eating pet); 45 s cooldown", "20%"],
  [/\bgingerbread men\b/, "Ginger the Cerberus", "a skill: click its button for 5 gingerbread men with 30% of your stats (50% with a corpse-eating pet); 45 s cooldown", "20%"],
  [/\bcrumbles?\b/, "Biscuit the Cerberus", "10 of them; [T] throws one: 25 damage where it lands and a cookie wall", "30%"],
  [/\bsnowballs?\b/, "Ginger the Cerberus", "10 of them; [T] throws one: 25 damage, freezes monsters there and leaves a snow wall", "30%"],
  [/\bcookie king\b/, "Biscuit the Cerberus or Ginger the Cerberus", "an arcade avatar (40%)", "40%"],
  [/\brolly\b/, "Mr Roll", "a LIMITED pet: blocks 40% of the attacks aimed at you, levels up from blocking, +20% XP while it is out", "10%"],
  [/\bjingle\b/, "Mr Candy Cane", "a LIMITED pet: blocks 40% of the attacks aimed at you, levels up from blocking, +20% XP while it is out", "10%"],
  [/\bcandy blocks?\b/, "Mr Roll", "[C] places one: a wall that takes 20 shots", "30%"],
  [/\bice blocks?\b/, "Mr Candy Cane", "[C] places one: a wall that takes 20 shots", "30%"],
  [/\bmaster of rolls\b/, "Mr Roll or Mr Candy Cane", "an arcade title (50%): +3% candy", "50%"],
  [/\bmr blob pet\b|\bpudding pet\b/, "Mr Blob", "a LIMITED pet: eats 60% of the attacks aimed at you; then 20% it goes GIANT and jumps — every monster dies, bosses lose 25%", "10%"],
  [/\bmaster of candy grinding\b|\bcandy grinding\b/, "Mr Blob or Mr Figgy", "an arcade title (30%): +10% candy", "30%"],
  [/\bfriendship\b|\bmr gum\b/, "Mr Blob", "the Friendship skill: HOLD F for 1 second to summon Mr Gum (20% of Mrs Gum's stats); 30 s cooldown", "40%"],
  [/\breindeer call\b|\brudolph\b/, "Mr Figgy", "the Reindeer Call skill: HOLD F for 1 second to summon Rudolph (20% of Mrs Frost's stats); 30 s cooldown", "40%"],
  [/\bblobs\b/, "Mr Blob", "3 of them; each blocks one attack aimed at you (10% it levels up one of your pets)", "60%"],
  [/\bstockings?\b/, "Mr Figgy", "3 of them; each blocks one attack aimed at you (10% it levels up one of your pets)", "60%"],
  [/\bgumdrop\b/, "Mrs Gum", "a LIMITED pet with all four boss-pet powers", "10%"],
  [/\bsnowdrop\b/, "Mrs Frost", "a LIMITED pet with all four boss-pet powers", "10%"],
  [/\bcandy lord\b|\bcandy combination\b/, "Mrs Gum (5%: a Candy Combination Crystal)", "in 🐾 Pets the crystal fuses 💧 Little Blue Slime + 🐕 Cookie + 🍥 Rolly + 🍮 Mr Blob into 👑 the Candy Lord: every power +80%", "5%"],
  [/\bfrost lord\b|\bfrost (combination )?crystal\b/, "Mrs Frost (5%: a Frost Combination Crystal)", "in 🐾 Pets the crystal fuses ❄️ Little Snow Slime + 🐕 Gingersnap + 🔔 Jingle + 🎄 Mr Figgy into 👑 the Frost Lord: every power +80%", "5%"],
  [/\bboss summons?\b/, "Mrs Gum (Boss Summon) or Mrs Frost (Christmas Boss Summon)", "[H]: a random boss of that castle fights for you with 50% of its stats for 30 s", "40%"],
  [/\bupgrade crystals?\b/, "Slimy / Sleety (10%: 1) and Mrs Gum / Mrs Frost (20%: 3)", "levels up a pet by 1 in 🐾 Pets (pets go up to level 10; each level = +15% shot damage)", ""],
];
export function bossAnswer(history, context) {
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  const q = (typeof lastUser?.content === "string" ? lastUser.content : "").toLowerCase();
  if (!q.trim()) return null;
  const lines = [];
  const bossLine = (b) => `[info] ${b.name} — ${b.castle}, ${b.pct}% chance to be the castle boss. Its drops (each rolls on its own): ${b.drops.join(" · ")}`;
  const named = BOSSES.filter((b) => b.names.some((n) => new RegExp(`\\b${n}\\b`).test(q)) && !(b.name === "Mr Blob" && /\bmr blob pet\b/.test(q)));
  // "what are the bosses" / "all bosses and drops"
  if (!named.length && /\bboss(es)?\b/.test(q) && /\b(all|list|every|what|which)\b/.test(q) && /\b(castle|drops?|loot|bosses)\b/.test(q)) {
    lines.push("[info] The castle bosses (Halloween 🎃 candy castle / Christmas ❄️ ice castle twins drop the same things at the same chances, Christmas versions of the pet, skill and item):");
    for (const b of BOSSES) lines.push(bossLine(b));
    return lines.join("\n");
  }
  for (const b of named) lines.push(bossLine(b));
  if (!named.length) {
    for (const [re, from, what, pct] of LOOT) {
      if (!re.test(q)) continue;
      const b = BOSSES.find((x) => x.name === from);   // one boss: say which castle and its chance
      lines.push(`[info] ${from}${b ? ` (the ${b.castle} boss, ${b.pct}% of castles)` : ""} drops it${pct ? ` — ${pct} chance` : ""}: ${what}.`);
    }
  }
  if (/\bsanta'?s? sleigh|sleigh road\b/.test(q)) lines.push(`[info] 🛷 Santa's Sleigh Road: at Christmas, say "santa" to Nullp to open it (Monster Attack! → Worlds). Ride straight to the ice castle — no guards — and beat the boss to DOUBLE your ❄️ snowflakes. Once a Christmas.`);
  return lines.length ? lines.join("\n") : null;
}
