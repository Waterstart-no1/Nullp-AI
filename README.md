# Nullp

An AI that **warns you**, **informs you**, and — sometimes — **tells you what to do**.

Every answer Nullp gives comes back as tagged lines, colour-coded in the UI:

| Tag | Meaning |
| --- | --- |
| `[warn]` | A risk, a catch, the thing that will bite you |
| `[info]` | A fact, some context, or a direct answer |
| `[do]` | A concrete next action — only when the action is actually clear |

## Run it

```bash
npm install
npm start
```

No key needed. Nullp runs on a local model through
[Ollama](https://ollama.com) - free, offline, private. Set up here already:
`brew install ollama`, `brew services start ollama` (it restarts at login), and
the model `llama3.2:3b`.

For sharper answers, put an Anthropic key in `.env` (copy `.env.example`);
Nullp prefers Claude whenever a key is present and falls back to the local
model when it is not. Nothing else changes.

It opens **http://localhost:4173/games** — every game next to `Nullp-AI`, with
Nullp already inside it. Play from there, not by double-clicking the game's
`index.html`: on a `file://` page the browser blocks the mic and the calls to
Nullp, so the widget goes quiet.

Or double-click **`start-nullp.command`** — it installs if needed, then starts
the server. Keep that window open while you use Nullp or play a game; closing
it stops the server, and the in-game widget will say it can't reach Nullp.

Open http://localhost:4173.

Without a key Nullp still runs — the whole interface works and it replies in
character telling you how to connect it to a model.

## Modes

- **Balanced** — normal Nullp.
- **Paranoid** — every failure mode it can defend, worst first.
- **Brief** — one warning, one fact, one action. Nothing else.
- **Explain** — teaching mode, heavy on `[info]`.

## Camera mode

The 📷 button next to the message box opens the camera.

- **Snap & ask** — Nullp looks at one frame and answers whatever you typed
  (or, with the box empty, "what do you see, warn me about anything risky").
  The frame shows in the chat, with a line saying what Nullp saw.
- **👁 Watch** — Nullp looks every 12 seconds and stays silent unless
  something is wrong; then it drops the warning into the chat and says it out
  loud (at most every 30 seconds). A red "watching" badge shows while it runs.
- **⟲** switches between front and back cameras.

Locally, a small vision model (`moondream`, 1.7 GB) describes the frame and the
text model judges it - moondream on its own gets danger backwards. With an
Anthropic key, Claude sees the frame directly. Frames stay on this machine
unless a Claude key is set; nothing is recorded, only the frames you send are
kept, inside that chat.

## Reading files and links

- **📎 or drag-and-drop** any text file (scripts, configs, contracts saved as
  text, logs - up to 300 KB). Binary files are refused, not guessed at.
- **Paste a link** in your message and Nullp fetches the page first - check an
  install script before you `curl | bash` it.
- A huge paste becomes an attachment instead of flooding the box.

Everything attached is handed to the model as *data*, explicitly not as
instructions, so a page that says "ignore your rules" gets flagged, not obeyed.

## Other controls

- **📌 What Nullp remembers** — standing facts applied to every answer, in every
  chat and in the games (`notes.json`, git-ignored). `Cmd/Ctrl+S` saves.
- **Brain** — pick the model that answers: any installed local model, or
  Claude when a key is set.
- **Severity badge** on every answer: *all clear*, *N warnings*, or red for 3+.
- **⇩ Backup / ⇧ Restore** — every chat to a JSON file and back; restoring
  merges and skips chats you already have.

## Talking to it

The small 🎙 button in the **top-right corner** opens the mic. Speak, and what
you said drops into the input and sends itself. Nullp then reads its answer
back out loud — `[warn]` lines come out as "Warning…", `[do]` lines as
"Do this…".

While the mic is open or Nullp is talking, a small indicator sits in the
**bottom-left corner** — red bars for listening, green for speaking. Click the
✕ on it (or the corner button again) to stop.

Uses the browser's built-in speech APIs, so it works best in Chrome and needs
no key or extra install. In a browser without mic support the button falls back
to reading the last answer aloud; with neither API it hides itself.

## How Nullp knows what's happening in a game

The widget reads the game by itself - you never have to describe it. Three
sources, in order of trust:

1. `window.nullpState()` - if the game defines it, whatever it returns is used
   verbatim. The precise option:

   ```js
   window.nullpState = () => ({ hp, maxHp, wave, coins: String(coins) });
   ```

2. Globals that look like game state (`hp`, `score`, `wave`, `player`, ...).
   Catches `var` and `window.x`, but not script-scoped `let`/`const`.
3. **What is on screen** - the HUD text the player can see, plus numbers saved
   in `localStorage`. This is what carries most single-file canvas games.

Whatever it finds rides along as context with every question.

### Unprompted warnings

Nullp also watches, every 4 seconds, and speaks up on its own when something
turns bad - a vital (`❤️`, `🛡`, ammo, fuel, time) falling to a quarter of its
peak, or "GAME OVER" appearing on screen. It stays quiet while the tab is in
the background, waits 45 seconds between warnings, and never interrupts an
answer in progress. Turn it off per game with `data-watch="off"`.

## What's in it

Streaming replies · multiple saved chats · search · rename (double-click) ·
delete · regenerate · edit & resend · stop mid-answer · copy · export to
Markdown · token usage · light/dark theme · keyboard shortcuts
(`Enter` send, `Shift+Enter` newline, `Ctrl/Cmd+K` new chat, `Esc` stop) ·
offline fallback · voice in and voice out · camera mode with watch · reads
files and links · standing notes · model picker · severity badges ·
backup and restore.

Chats are stored in your browser's `localStorage`. The API key stays on the
server and is never sent to the page.

## Layout

```
server.js          Node server: static files + streaming /api/chat
public/            The UI (index.html, style.css, app.js)
.env               Your key (git-ignored)
```

## Putting Nullp in a game

`widget/nullp-widget.js` is a drop-in companion for any browser game. It is
already installed in these:

| Game | Page |
| --- | --- |
| Learn English | `english-program/index.html` |
| Monster Attack! | `monster-city/index.html` |
| Track Run | `Pocket-Dice/index.html` |
| REBUILD | `rebuild/index.html` |
| Buckshot Roulette | `shooting-game/public/index.html` |

To add it to a new game, copy the file next to the game's `index.html` and put
one line before `</body>`:

```html
<script defer src="nullp-widget.js" data-game="My Game"></script>
```

Optional attributes: `data-api="http://localhost:4173"` (where Nullp lives),
`data-mode="brief"` (any of the four modes).

In game it gives you the same two corners: 🎙 in the **top-right** to talk, a
status pill in the **bottom-left** while it listens or speaks. A small panel
drops down under the button with the answer and a text box, so you can ask by
typing too. The `data-game` name is sent as context, so Nullp knows which game
you are in.

It lives in a shadow root, so it cannot inherit or leak CSS, and it registers
no global key handlers - your game keys stay yours. Typing in its box is
stopped from reaching the game.

**Nullp must be running** (`npm start`) for the widget to answer; if it is not,
the widget says so and the game is otherwise unaffected. Because the game and
Nullp are different origins, the server allows cross-origin calls - but only
from pages on this machine (`localhost`, `127.0.0.1`, `file://`). Any other
website is refused, so it cannot read your notes or spend your key. The server
listens on `127.0.0.1` only; set `HOST=0.0.0.0` to expose it deliberately.

The server also hosts the games themselves at `/games`, so the widget runs
same-origin - no CORS, no `file://` restrictions, one thing to start. A game
folder is picked up automatically if it has an `index.html` (directly, or in
`public/` or `src/`). Opened from `/games`, a game always gets the current
`widget/nullp-widget.js`, whatever copy sits in its folder - the copy only
matters when the game is opened as a file. Opened any other way, the widget
probes its own origin first and falls back to `http://localhost:4173`.
