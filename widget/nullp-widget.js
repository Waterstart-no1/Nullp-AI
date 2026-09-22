/*
 * Nullp widget - drop-in companion for a browser game.
 *
 *   <script defer src="nullp-widget.js" data-game="Monster City"></script>
 *
 * Adds a mic button in the top-right corner (talk to Nullp) and a status
 * indicator in the bottom-left while it listens or speaks. Answers arrive as
 * Nullp's tagged lines: [warn] / [info] / [do].
 *
 * Needs the Nullp server running (npm start in Nullp-AI). If it isn't, the
 * widget says so and the game is otherwise untouched. Everything lives in a
 * shadow root, so it cannot collide with the game's own CSS, and it never
 * listens for game keys - only the button and its own input.
 */
(() => {
  const script =
    document.currentScript ||
    document.querySelector('script[src*="nullp-widget"]');
  const GAME =
    script?.dataset.game || document.title || "an unnamed browser game";
  // Where Nullp lives. Served from the Nullp server itself, that is just this
  // origin; opened any other way, fall back to the default port.
  const FALLBACK_API = "http://localhost:4173";
  let API = script?.dataset.api || window.NULLP_API || null;

  async function resolveApi() {
    if (API) return API;
    const tries = [];
    if (location.protocol.startsWith("http")) tries.push(location.origin);
    tries.push(FALLBACK_API);
    for (const base of tries) {
      try {
        const probe = await fetch(`${base}/api/health`, { cache: "no-store" });
        if (probe.ok) return (API = base);
      } catch {
        /* try the next one */
      }
    }
    return (API = FALLBACK_API);
  }
  const MODE = script?.dataset.mode || "brief";
  const WATCH = (script?.dataset.watch || "on") !== "off";

  if (window.__nullp) return; // never install twice

  // ------------------------------------------------------------------ shell

  const host = document.createElement("div");
  host.id = "nullp-widget";
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483000";
  const root = host.attachShadow({ mode: "open" });

  root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif; }

  .btn {
    position: fixed; top: 14px; right: 14px;
    width: 40px; height: 40px;
    display: grid; place-items: center;
    border-radius: 50%; border: 1px solid rgba(255,255,255,.22);
    background: rgba(18,19,17,.82); color: #ece9e2;
    font-size: 17px; cursor: pointer; pointer-events: auto;
    backdrop-filter: blur(6px);
    transition: transform .12s, background .12s;
  }
  .btn:hover { transform: scale(1.07); border-color: #7aa7d8; }
  .btn.listening { background: #b3342a; border-color: #b3342a; animation: pulse 1.1s infinite; }
  .btn.talking   { background: #2f7d4f; border-color: #2f7d4f; }
  @keyframes pulse {
    0%,100% { box-shadow: 0 0 0 0 rgba(179,52,42,.6); }
    60%     { box-shadow: 0 0 0 10px rgba(179,52,42,0); }
  }

  .panel {
    position: fixed; top: 62px; right: 14px; width: min(340px, calc(100vw - 28px));
    max-height: min(56vh, 460px); overflow-y: auto;
    padding: 12px; pointer-events: auto;
    border-radius: 12px; border: 1px solid rgba(255,255,255,.16);
    background: rgba(18,19,17,.94); color: #ece9e2;
    box-shadow: 0 12px 40px rgba(0,0,0,.45);
    font-size: 13px; line-height: 1.5;
  }
  .panel[hidden] { display: none; }
  .head { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; font-size: 11px;
          letter-spacing: .1em; text-transform: uppercase; color: #97938a; }
  .head b { color: #7aa7d8; font-size: 14px; letter-spacing: 0; }
  .head .sp { flex: 1; }
  .x { border: 0; background: none; color: #97938a; cursor: pointer; font-size: 14px; padding: 0 2px; }
  .x:hover { color: #e08078; }

  .you { color: #97938a; font-style: italic; margin-bottom: 8px; overflow-wrap: anywhere; }

  .line { display: grid; grid-template-columns: 50px 1fr; gap: 8px;
          padding: 7px 9px; margin-bottom: 5px; border-radius: 8px; border-left: 3px solid transparent; }
  .line .t { font-size: 9.5px; letter-spacing: .07em; text-transform: uppercase; font-weight: 700; padding-top: 2px; }
  .line .b { overflow-wrap: anywhere; }
  .warn  { background: rgba(231,160,122,.13); border-left-color: #e7a07a; }
  .warn .t { color: #e7a07a; }
  .info  { background: rgba(122,167,216,.13); border-left-color: #7aa7d8; }
  .info .t { color: #7aa7d8; }
  .do    { background: rgba(127,199,155,.13); border-left-color: #7fc79b; }
  .do .t { color: #7fc79b; }
  .plain { background: rgba(255,255,255,.06); }
  .plain .t { color: #97938a; }
  .err   { background: rgba(224,128,120,.14); border-left-color: #e08078; }
  .err .t { color: #e08078; }

  .ask { display: flex; gap: 6px; margin-top: 9px; }
  .ask input {
    flex: 1; padding: 7px 9px; font-size: 13px;
    border-radius: 8px; border: 1px solid rgba(255,255,255,.18);
    background: rgba(255,255,255,.06); color: #ece9e2;
  }
  .ask input:focus { outline: 1px solid #7aa7d8; }
  .ask button {
    border: 0; border-radius: 8px; padding: 7px 11px; cursor: pointer;
    background: #3a6ea5; color: #fff; font-size: 12.5px; font-weight: 600;
  }

  .pill {
    position: fixed; left: 14px; bottom: 14px; pointer-events: auto;
    display: flex; align-items: center; gap: 8px;
    padding: 7px 10px 7px 11px; border-radius: 999px;
    border: 1px solid rgba(255,255,255,.16); background: rgba(18,19,17,.92);
    color: #ece9e2; font-size: 12px; box-shadow: 0 6px 22px rgba(0,0,0,.4);
  }
  .pill[hidden] { display: none; }
  .bars { display: flex; align-items: flex-end; gap: 2px; height: 13px; }
  .bars i { width: 3px; height: 4px; border-radius: 2px; background: #7aa7d8; animation: bounce .9s infinite; }
  .bars i:nth-child(2) { animation-delay: .15s; }
  .bars i:nth-child(3) { animation-delay: .3s; }
  .bars i:nth-child(4) { animation-delay: .45s; }
  .pill.listen .bars i { background: #e08078; }
  .pill.talk   .bars i { background: #7fc79b; }
  @keyframes bounce { 0%,100% { height: 4px; } 50% { height: 13px; } }

  @media (prefers-reduced-motion: reduce) {
    .bars i, .btn.listening { animation: none; }
  }
</style>

<button class="btn" id="btn" title="Talk to Nullp" aria-label="Talk to Nullp">🎙</button>

<div class="panel" id="panel" hidden>
  <div class="head"><b>⬡ Nullp</b><span class="sp"></span>
    <button class="x" id="close" title="Close">✕</button>
  </div>
  <div class="you" id="you" hidden></div>
  <div id="out"></div>
  <form class="ask" id="ask">
    <input id="q" placeholder="Ask Nullp about this game…" autocomplete="off" />
    <button type="submit">Ask</button>
  </form>
</div>

<div class="pill" id="pill" hidden>
  <span class="bars"><i></i><i></i><i></i><i></i></span>
  <span id="pillText">Listening…</span>
  <button class="x" id="pillStop" title="Stop">✕</button>
</div>`;

  (document.body || document.documentElement).append(host);
  const $ = (id) => root.getElementById(id);

  // ------------------------------------------------------------------ state

  const history = [];
  let listening = false;
  let recognition = null;
  let spoke = false; // reply should be read aloud
  let busy = false;

  // Typing in the widget must never reach the game.
  for (const type of ["keydown", "keyup", "keypress"]) {
    $("q").addEventListener(type, (e) => e.stopPropagation());
  }

  const canHear = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  const canTalk = "speechSynthesis" in window;
  if (!canHear) $("btn").textContent = "⬡";

  // ------------------------------------------------------------------ render

  function showPanel(on = true) {
    $("panel").hidden = !on;
  }

  function renderReply(text) {
    const out = $("out");
    out.textContent = "";
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const m = /^\[(warn|info|do|error)\]\s*(.*)$/i.exec(line);
      const kind = m ? m[1].toLowerCase() : "plain";
      const row = document.createElement("div");
      row.className = `line ${kind === "error" ? "err" : kind}`;
      const tag = document.createElement("div");
      tag.className = "t";
      tag.textContent = { warn: "warn", info: "info", do: "do", error: "error", plain: "·" }[kind];
      const body = document.createElement("div");
      body.className = "b";
      body.textContent = m ? m[2] : line;
      row.append(tag, body);
      out.append(row);
    }
  }

  function pill(kind, label) {
    $("pill").className = `pill ${kind}`;
    $("pillText").textContent = label;
    $("pill").hidden = false;
  }
  const hidePill = () => ($("pill").hidden = true);

  // --------------------------------------------------------------- the model

  async function ask(question, opts = {}) {
    if (!question.trim()) return;
    if (busy) {
      pill("talk", "Nullp is still thinking…");
      setTimeout(hidePill, 1600);
      return;
    }
    busy = true;
    history.push({ role: "user", content: question.trim() });

    $("you").textContent = opts.silentQuestion ? "Nullp noticed something" : `“${question.trim()}”`;
    $("you").hidden = false;
    renderReply("[info] thinking…");
    showPanel(true);

    let text = "";
    try {
      await resolveApi();
      const res = await fetch(`${API}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.slice(-16),
          mode: MODE,
          context: describeGame(),
        }),
      });
      if (!res.ok || !res.body) throw new Error(`server said ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          let event = "message";
          let data = "";
          for (const l of block.split("\n")) {
            if (l.startsWith("event:")) event = l.slice(6).trim();
            else if (l.startsWith("data:")) data += l.slice(5).trim();
          }
          if (!data) continue;
          const payload = JSON.parse(data);
          if (event === "delta") {
            text += payload.text;
            renderReply(text);
          } else if (event === "error") {
            text += `${text ? "\n" : ""}[error] ${payload.message}`;
            renderReply(text);
          }
        }
      }
    } catch (err) {
      text =
        `[error] Can't reach Nullp at ${API}.\n` +
        `[do] Start it: double-click start-nullp.command in the Nullp-AI folder.\n` +
        `[do] Then open this game from http://localhost:4173/games`;
      renderReply(text);
    }

    const failed = !text.trim() || /^\[error\]/m.test(text);
    if (failed) history.pop(); // drop the question too, so the thread stays clean
    else history.push({ role: "assistant", content: text.trim() });

    busy = false;
    if (spoke && !failed) say(text);
    spoke = false;
  }

  // ----------------------------------------------------------- game sensing
  // Nullp reads the game by itself, from three sources in order of trust:
  //   1. window.nullpState() - anything the game chooses to hand over
  //   2. globals that look like game state (catches `var`, not script-scoped `let`)
  //   3. what is actually on screen, plus saved numbers in localStorage
  // All of it is local to this page and only travels with a question you asked.

  const STAT = /^(hp|health|lives|score|coins|money|gold|cash|level|lvl|wave|round|xp|exp|ammo|shield|energy|stage|streak|combo|kills|deaths|day|fuel|power|hunger|stars|best|high ?score)$/i;
  const FLAG = /^(gameover|game_over|isdead|dead|lost|won|win|paused|playing|started)$/i;
  const BAD_TEXT = /\b(game over|you died|you lose|defeat|wasted|eliminated|out of (lives|ammo|fuel|time)|last life)\b/i;

  const plain = (v) =>
    typeof v === "bigint" ? v.toString() : typeof v === "string" ? v.slice(0, 40) : v;

  function declaredState() {
    try {
      const raw = typeof window.nullpState === "function" ? window.nullpState() : null;
      return raw && typeof raw === "object" ? raw : null;
    } catch {
      return null;
    }
  }

  function globalState() {
    const out = {};
    for (const key of Object.keys(window)) {
      try {
        const v = window[key];
        if ((typeof v === "number" && Number.isFinite(v)) || typeof v === "bigint") {
          if (STAT.test(key)) out[key] = plain(v);
        } else if (typeof v === "boolean" && FLAG.test(key)) {
          out[key] = v;
        } else if (v && typeof v === "object" && /^(player|hero|game|state|stats|world|save)$/i.test(key)) {
          const nested = {};
          for (const k of Object.keys(v).slice(0, 30)) {
            const val = v[k];
            if (["number", "boolean", "bigint", "string"].includes(typeof val)) nested[k] = plain(val);
          }
          if (Object.keys(nested).length) out[key] = nested;
        }
      } catch {
        /* some globals throw on access - skip them */
      }
    }
    return out;
  }

  // What the player can actually see. Canvas games keep their HUD in the DOM.
  function onScreen() {
    const bits = [];
    const seen = new Set();
    for (const node of document.body.querySelectorAll("*")) {
      if (bits.length >= 22) break;
      if (node.children.length || node === host) continue;
      const text = (node.textContent || "").trim().replace(/\s+/g, " ");
      if (!text || text.length > 46 || seen.has(text)) continue;
      const box = node.getBoundingClientRect();
      if (!box.width || !box.height || box.bottom < 0 || box.top > innerHeight) continue;
      const style = getComputedStyle(node);
      if (style.visibility === "hidden" || style.opacity === "0") continue;
      seen.add(text);
      bits.push(text);
    }
    return bits;
  }

  function savedNumbers() {
    const out = {};
    try {
      for (const key of Object.keys(localStorage).slice(0, 25)) {
        const v = localStorage.getItem(key);
        if (v && v.length < 12 && /^-?\d+(\.\d+)?$/.test(v)) out[key] = Number(v);
      }
    } catch {
      /* storage can be blocked */
    }
    return out;
  }

  function readGame() {
    const state = declaredState() || globalState();
    return { state, screen: onScreen(), saves: savedNumbers() };
  }

  function describeGame() {
    const { state, screen, saves } = readGame();
    const lines = [`The person is playing a browser game called "${GAME}".`];
    if (Object.keys(state).length) lines.push(`Live game state: ${JSON.stringify(state).slice(0, 320)}`);
    if (screen.length) lines.push(`On screen now: ${screen.join(" | ").slice(0, 260)}`);
    if (Object.keys(saves).length) lines.push(`Saved numbers: ${JSON.stringify(saves).slice(0, 140)}`);
    lines.push("They are mid-game and cannot read much text. Answer about this game.");
    return lines.join("\n");
  }

  // ------------------------------------------------------- unprompted warnings

  // Canvas games keep their HP in the HUD, not in a variable Nullp can see -
  // so pull labelled numbers straight off the screen and watch those instead.
  const VITAL = /[\u2764\u{1F499}\u{1FA78}\u{1F49A}\u{1F494}\u{1F6E1}\u26FD\u26A1\u{1F50B}\u{1F552}\u23F1\u{1F52B}]|^(hp|health|life|lives|shield|armou?r|ammo|fuel|energy|time|timer)\b/iu;

  function screenStats(screen) {
    const out = {};
    for (const bit of screen) {
      const m = /^(.{0,14}?)\s*(-?\d+(?:\.\d+)?)\s*(?:\/\s*\d+)?$/u.exec(bit);
      if (!m) continue;
      const label = m[1].trim();
      if (!label || !VITAL.test(label)) continue;
      out[`screen.${label}`] = Number(m[2]);
    }
    return out;
  }

  const peak = new Map(); // highest value seen per stat, to judge "low"
  let lastNag = 0;
  let lastScreen = "";

  function flatten(obj, prefix = "") {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
      if (typeof v === "number" && Number.isFinite(v)) out[prefix + k] = v;
      else if (v && typeof v === "object") Object.assign(out, flatten(v, `${prefix}${k}.`));
    }
    return out;
  }

  function checkGame() {
    if (busy || document.hidden || Date.now() - lastNag < 45000) return;

    const { state, screen } = readGame();
    const alerts = [];

    const numbers = { ...flatten(state), ...screenStats(screen) };
    for (const [key, value] of Object.entries(numbers)) {
      const high = Math.max(peak.get(key) ?? value, value);
      peak.set(key, high);
      // screen.* keys are already filtered down to vitals by screenStats
      if (!key.startsWith("screen.") && !/hp|health|lives|shield|energy|fuel|ammo|time/i.test(key)) continue;
      if (high >= 4 && value > 0 && value <= high * 0.25) {
        alerts.push(`${key} is down to ${value} (was ${high})`);
      }
    }

    const text = screen.join(" | ");
    if (text !== lastScreen && BAD_TEXT.test(text)) {
      alerts.push(`the screen now says: ${BAD_TEXT.exec(text)[0]}`);
    }
    lastScreen = text;

    if (!alerts.length) return;
    lastNag = Date.now();
    spoke = canTalk;
    ask(`Without being asked: ${alerts.join("; ")}. Warn me in one or two lines.`, { silentQuestion: true });
  }

  if (WATCH) setInterval(checkGame, 4000);

  // ------------------------------------------------------------------ voice

  function listen() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new Recognition();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true;
    let heard = "";

    rec.onstart = () => {
      listening = true;
      $("btn").classList.add("listening");
      pill("listen", "Listening…");
    };
    rec.onresult = (e) => {
      heard = [...e.results].map((r) => r[0].transcript).join(" ").trim();
      pill("listen", heard ? `“${heard.slice(0, 38)}”` : "Listening…");
    };
    rec.onerror = (e) => {
      if (e.error === "aborted") return; // the person stopped it
      pill("listen", e.error === "not-allowed" ? "Mic blocked - type instead" : `Mic: ${e.error} - type instead`);
      setTimeout(hidePill, 2000);
      // Without this, a blocked or broken mic leaves no way to ask anything.
      showPanel(true);
      $("q").focus();
    };
    rec.onend = () => {
      listening = false;
      recognition = null;
      $("btn").classList.remove("listening");
      hidePill();
      if (heard) {
        spoke = canTalk;
        ask(heard);
      }
    };

    recognition = rec;
    rec.start();
  }

  function say(text) {
    if (!canTalk) return;
    const spokenText = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) =>
        l
          .replace(/^\[warn\]\s*/i, "Warning. ")
          .replace(/^\[do\]\s*/i, "Do this. ")
          .replace(/^\[info\]\s*/i, "")
          .replace(/^\[error\]\s*/i, "Error. "),
      )
      .join(". ");
    if (!spokenText) return;

    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(spokenText);
    u.rate = 1.03;
    u.pitch = 0.95;
    u.onstart = () => {
      $("btn").classList.add("talking");
      pill("talk", "Nullp is speaking");
    };
    u.onend = u.onerror = () => {
      $("btn").classList.remove("talking");
      hidePill();
    };
    speechSynthesis.speak(u);
  }

  function stopAll() {
    recognition?.abort();
    listening = false;
    if (canTalk) speechSynthesis.cancel();
    $("btn").classList.remove("listening", "talking");
    hidePill();
  }

  // ----------------------------------------------------------------- wiring

  $("btn").onclick = () => {
    if (listening || (canTalk && speechSynthesis.speaking)) return stopAll();
    if (canHear) return listen();
    showPanel($("panel").hidden); // no mic: the button just opens the panel
    if (!$("panel").hidden) $("q").focus();
  };
  $("close").onclick = () => showPanel(false);
  $("pillStop").onclick = stopAll;
  $("ask").onsubmit = (e) => {
    e.preventDefault();
    const q = $("q").value;
    $("q").value = "";
    ask(q);
  };

  window.__nullp = {
    ask, say, stopAll, show: showPanel, game: GAME,
    read: readGame, describe: describeGame, check: checkGame, stats: () => ({ ...flatten(declaredState() || globalState()), ...screenStats(onScreen()) }),
    get api() { return API || FALLBACK_API; },
  };
  resolveApi(); // warm up, so the first question does not pay for the probe
})();
