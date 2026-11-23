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
check(v.price === 50 && v.mine === 0 && v.players === 0 && v.rules.GRAND_PLAYERS === 250 && v.rules.SMALL_UNDER === 50 && v.rules.GRAND_CHANCE === 1e-29, "a lotto season: 50 a ticket, 250 players for the Admin Panel draw, under 50 = 100 points");
check((await call("POST", "lotto/buy", { n: 1 })).code === 401, "you have to be logged in to buy");
check((await call("POST", "lotto/buy", { n: 99 }, users[0])).code === 400, "1–20 tickets at a time");
await call("POST", "lotto/buy", { n: 3 }, users[0]); await call("POST", "lotto/buy", { n: 1 }, users[1]);
v = (await call("GET", "lotto", null, users[0])).obj;
check(v.mine === 3 && v.total === 4 && v.players === 2, "tickets count per player (3 + 1, 2 players)");
// the season ends: fewer than 50 players → one ticket wins 100 points (rnd 0.1 → the first ticket = tester0)
const db = _testDb(); db.lotto.season = "2000-01";
const r = lottoRoll(() => 0.1);
check(r && r.players === 2 && r.small === "tester0" && r.grand.length === 0, "new season: under 50 players — tester0's ticket wins 100 points (no Admin draw: under 250 players)");
v = (await call("GET", "lotto", null, users[0])).obj;
check(v.last.iWonSmall && !v.last.claimed && v.mine === 0 && v.total === 0, "you can see you won (and the new season starts empty)");
const c1 = (await call("POST", "lotto/claim", null, users[0])).obj;
check(c1.coins === 100 && !c1.grand && (await call("POST", "lotto/claim", null, users[0])).code === 400, "claim 100 points (once)");
check((await call("POST", "lotto/claim", null, users[1])).code === 400, "someone who didn't win gets nothing");
// 250 players: the grand draw happens — with a pretend "lucky" random it can be won; with a normal one it never is
db.lotto.tickets = {}; for (let i = 0; i < 250; i++) db.lotto.tickets["p" + i] = 1;
db.lotto.season = "2000-02"; let r2 = lottoRoll(Math.random);
check(r2.players === 250 && r2.grand.length === 0 && r2.small === null, "250 players: the Admin Panel draw runs (and with a 1e-29 chance nobody wins), no 100-point prize");
for (let i = 0; i < 250; i++) db.lotto.tickets["p" + i] = 1; db.lotto.tickets.tester2 = 1;
db.users.p0 = { name: "p0" }; db.lotto.season = "2000-03"; let first = true;
const r3 = lottoRoll(() => (first ? ((first = false), 0) : 0.5));
check(r3.grand.length === 1, "…a winning ticket (random 0, impossible in real life) gets the Admin Panel");
for (let i = 0; i < 100; i++) db.lotto.tickets["q" + i] = 1; db.lotto.season = "2000-04";
const r4 = lottoRoll(() => 0);
check(r4.players === 100 && r4.grand.length === 0 && r4.small === null, "50–249 players: no draw");
fs.rmSync(dir, { recursive: true, force: true });
console.log(ok ? "\nLOTTO PASS" : "\nLOTTO FAIL");
process.exit(ok ? 0 : 1);
