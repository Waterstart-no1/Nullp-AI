// 🎟️ The arcade lotto on the server. Run: node test-lotto.mjs   (uses a throwaway accounts folder)
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lotto-test-"));
process.env.ARCADE_DATA_DIR = dir;
const { handleArcade, lottoRoll, LOTTO, _testDb } = await import("./arcade-accounts.js");

let ok = true;
const check = (p, l, x) => { if (!p) ok = false; console.log(`  ${p ? "PASS" : "FAIL"} ${l}${x ? `  (${x})` : ""}`); };
async function call(method, route, body, token) {
  const out = {}, req = { method, headers: token ? { "x-arcade-token": token } : {} };
  await handleArcade(req, out, new URL("http://x/api/arcade/" + route), { json: (res, code, obj) => { res.code = code; res.obj = obj; }, readBody: async () => JSON.stringify(body || {}) });
  return out;
}
const users = [];
for (let i = 0; i < 3; i++) users.push((await call("POST", "signup", { name: "tester" + i, password: "pass" + i })).obj.token);

let v = (await call("GET", "lotto", null, users[0])).obj;
check(v.price === 50 && v.mine === 0 && v.players === 0 && v.rules.GRAND_PLAYERS === 250 && v.rules.SMALL_UNDER === 50 && v.rules.GRAND_CHANCE === 1e-29 && v.rules.SMALL_CHANCE === 0.01 && v.season === String(new Date().getFullYear()) && v.endsAt === new Date(new Date().getFullYear() + 1, 0, 1).getTime(), "a lotto season (a year): 50 a ticket, 250 players for the Admin Panel draw, under 50 = a 1% chance a player of 75 points");
check((await call("POST", "lotto/buy", { n: 1 })).code === 401, "you have to be logged in to buy");
check((await call("POST", "lotto/buy", { n: 99 }, users[0])).code === 400, "1–20 tickets at a time");
await call("POST", "lotto/buy", { n: 3 }, users[0]); await call("POST", "lotto/buy", { n: 1 }, users[1]);
v = (await call("GET", "lotto", null, users[0])).obj;
check(v.mine === 3 && v.total === 4 && v.players === 2, "tickets count per player (3 + 1, 2 players)");
// the season ends: fewer than 50 players → each player has a 1% chance (tester0 rolls lucky: 0.005, tester1 doesn't)
const db = _testDb(); db.lotto.season = "2000"; db.lotto.endsAt = 1;
const rolls = [0.005, 0.5]; let ri = 0;
const r = lottoRoll(() => (ri < rolls.length ? rolls[ri++] : 0.5));
check(r && r.players === 2 && r.small.join() === "tester0" && r.grand.length === 0, "new season: under 50 players — tester0 is lucky and wins 75 points (no Admin draw: under 250 players)", r && r.small);
v = (await call("GET", "lotto", null, users[0])).obj;
check(v.last.iWonSmall && !v.last.claimed && v.mine === 0 && v.total === 0 && v.last.myTickets === 3, "you can see you won with your 3 tickets (and the new season starts with 0 tickets)");
const c1 = (await call("POST", "lotto/claim", null, users[0])).obj;
check(c1.coins === 75 && !c1.grand && (await call("POST", "lotto/claim", null, users[0])).code === 400, "claim 75 points (once)");
check((await call("POST", "lotto/claim", null, users[1])).code === 400, "someone who didn't win gets nothing");
// 250 players: the grand draw happens — with a pretend "lucky" random it can be won; with a normal one it never is
db.lotto.tickets = {}; for (let i = 0; i < 250; i++) db.lotto.tickets["p" + i] = 1;
db.lotto.season = "2001"; db.lotto.endsAt = 1; let r2 = lottoRoll(Math.random);
check(r2.players === 250 && r2.grand.length === 0 && r2.small.length === 0, "250 players: the Admin Panel draw runs (and with a 1e-29 chance nobody wins), no 75-point prize");
for (let i = 0; i < 250; i++) db.lotto.tickets["p" + i] = 1; db.lotto.tickets.tester2 = 1;
db.users.p0 = { name: "p0" }; db.lotto.season = "2002"; db.lotto.endsAt = 1; let first = true;
const r3 = lottoRoll(() => (first ? ((first = false), 0) : 0.5));
check(r3.grand.length === 1, "…a winning ticket (random 0, impossible in real life) gets the Admin Panel");
for (let i = 0; i < 100; i++) db.lotto.tickets["q" + i] = 1; db.lotto.season = "2003"; db.lotto.endsAt = 1;
const r4 = lottoRoll(() => 0);
check(r4.players === 100 && r4.grand.length === 0 && r4.small.length === 0, "50–249 players: no draw");
// 🛠️ the Admin Panel picks when the lotto opens
const soon = Date.now() + 3 * 864e5;
v = (await call("POST", "lotto/schedule", { at: soon }, users[0])).obj;
check(v.endsAt === soon, "an admin can set the draw time", v.endsAt);
check((await call("POST", "lotto/schedule", { at: 5 }, users[0])).code === 400 && (await call("POST", "lotto/schedule", { now: true })).code === 401, "…not in the past, and only logged in");
await call("POST", "lotto/buy", { n: 2 }, users[2]); const before = db.lotto.season;
v = (await call("POST", "lotto/schedule", { now: true }, users[0])).obj;
check(v.season !== before && v.last.season === before && v.last.players === 1 && v.total === 0, "“Draw now” draws the season straight away", v.season);
v = (await call("GET", "lotto", null, users[0])).obj;
check(v.total === 0 && v.endsAt > Date.now(), "…and the next season ends at the end of the year (not drawn again)");
v = (await call("POST", "lotto/schedule", { yearly: true }, users[0])).obj;
check(v.endsAt === new Date(new Date().getFullYear() + 1, 0, 1).getTime(), "“Yearly” puts it back to the end of the year");
// 1% a player, however many tickets: 2,000 player-draws (40 players × 50 seasons, 20 tickets each) → about 20 winners
let wins = 0; for (let t = 0; t < 50; t++) { db.lotto.tickets = {}; for (let i = 0; i < 40; i++) db.lotto.tickets["w" + i] = 20; db.lotto.season = "y" + t; db.lotto.endsAt = 1; wins += lottoRoll(Math.random).small.length; }
check(wins >= 5 && wins <= 45, "1% a player — 20 tickets don't make it 20×", wins + " of 2000");
// an old season (from when seasons were months) moves to the end of its year
db.lotto.yearly = false; db.lotto.season = "2031-11"; db.lotto.endsAt = new Date(2031, 11, 1).getTime();
lottoRoll(() => 0.5, new Date(2031, 10, 25));
check(db.lotto.endsAt === new Date(2032, 0, 1).getTime() && db.lotto.yearly && db.lotto.season === "2031", "an old month season (2031-11) is now season 2031 and ends at the end of the year", db.lotto.season);
db.lotto.season = "2033-05"; lottoRoll(() => 0.5, new Date(2031, 10, 26));
check(db.lotto.season === "2033", "an already-yearly season with a month name is renamed too");
fs.rmSync(dir, { recursive: true, force: true });
console.log(ok ? "\nLOTTO PASS" : "\nLOTTO FAIL");
process.exit(ok ? 0 : 1);
