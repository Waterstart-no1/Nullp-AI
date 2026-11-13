// Reset an arcade account's password — run it yourself in a Terminal (it asks for the new password,
// hidden while you type). Saved progress on the account is kept; every place that was logged in to
// the account is logged out, so log in again with the new password.
//
//   node reset-password.js <account name>        (or double-click "Reset Arcade Password.command")
//
// The Nullp server keeps the accounts in memory and writes them back to disk, so this stops the
// server, changes the file, and starts the server again.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";
import { execFileSync } from "node:child_process";

const DIR = process.env.ARCADE_DATA_DIR || path.join(os.homedir(), ".daniels-arcade");
const FILE = path.join(DIR, "accounts.json");
const SERVICE = `gui/${process.getuid()}/com.daniel.nullp`;
const MANAGE_SERVER = !process.env.ARCADE_DATA_DIR;   // a test data folder: leave the real server alone

// One reader for every question (a second one would miss lines the first had already read).
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
let hideTyping = false;
const show = rl._writeToOutput.bind(rl);
rl._writeToOutput = (s) => { if (!hideTyping || /\r|\n/.test(s)) show(s); };   // hidden: nothing you type is shown
const lines = [], waiting = [];   // every line typed is queued, so none is lost between questions
rl.on("line", (l) => { if (waiting.length) waiting.shift()(l); else lines.push(l); });
rl.on("close", () => { while (waiting.length) waiting.shift()(""); });
function ask(question, hidden) {
  process.stdout.write(question);
  hideTyping = !!hidden;
  return new Promise((resolve) => {
    const take = (l) => { hideTyping = false; if (hidden && !process.stdin.isTTY) process.stdout.write("\n"); resolve(l); };
    if (lines.length) take(lines.shift()); else waiting.push(take);
  });
}
const done = (code, msg) => { if (msg) console.log(msg); rl.close(); process.exit(code); };
const launchctl = (...args) => { try { execFileSync("launchctl", args, { stdio: "ignore" }); return true; } catch { return false; } };

const db = JSON.parse(fs.readFileSync(FILE, "utf8"));
let name = (process.argv[2] || "").trim();
if (!name) name = (await ask("Account name: ")).trim();
const key = name.toLowerCase();
if (!db.users || !db.users[key]) {
  done(1, `No account called "${name}". Accounts here: ${Object.values(db.users || {}).map((u) => u.name).join(", ") || "none"}`);
}

const pw = await ask(`New password for ${db.users[key].name}: `, true);
if (pw.length < 4 || pw.length > 100) done(1, "The password needs at least 4 characters. Nothing changed.");
const again = await ask("Type it again: ", true);
if (pw !== again) done(1, "They don't match. Nothing changed.");

// Stop the server so it can't write its old copy over ours, change the file, start it again.
const running = MANAGE_SERVER && launchctl("kill", "SIGTERM", SERVICE);
if (running) await new Promise((r) => setTimeout(r, 1500));
const fresh = JSON.parse(fs.readFileSync(FILE, "utf8"));   // re-read: the server may have just saved
const user = fresh.users[key];
user.salt = crypto.randomBytes(16).toString("hex");
user.hash = crypto.scryptSync(pw, user.salt, 64).toString("hex");
for (const [token, k] of Object.entries(fresh.sessions || {})) if (k === key) delete fresh.sessions[token];
const tmp = FILE + ".tmp";
fs.writeFileSync(tmp, JSON.stringify(fresh), { mode: 0o600 });
fs.renameSync(tmp, FILE);
if (running) launchctl("kickstart", "-k", SERVICE);

done(0, `✅ ${user.name}'s password is changed. Your saved progress is still there — log in with the new password.`);
