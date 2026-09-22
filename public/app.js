// Nullp - front end. Chats live in localStorage; nothing leaves the machine
// except the message text the server forwards to the model.

// Declared up here as a hoisted function: boot renders before the helper
// section is reached, and the name must not shadow window.scroll.
function scrollToEnd() {
  el.transcript.scrollTop = el.transcript.scrollHeight;
}

const $ = (id) => document.getElementById(id);
const el = {
  status: $("status"), chatList: $("chatList"), search: $("search"),
  newChat: $("newChat"), wipe: $("wipe"), themeToggle: $("themeToggle"),
  menuToggle: $("menuToggle"), sidebar: $("sidebar"), chatTitle: $("chatTitle"),
  mode: $("mode"), exportBtn: $("exportBtn"), transcript: $("transcript"),
  empty: $("empty"), chips: $("chips"), usage: $("usage"), input: $("input"),
  send: $("send"), stop: $("stop"), regen: $("regen"),
  voice: $("voice"), playing: $("playing"), playingText: $("playingText"),
  playingStop: $("playingStop"),
  engine: $("engine"), notesBtn: $("notesBtn"), notesSheet: $("notesSheet"),
  notesText: $("notesText"), notesSave: $("notesSave"), notesClose: $("notesClose"),
  notesState: $("notesState"), backupBtn: $("backupBtn"), restoreBtn: $("restoreBtn"),
  restoreFile: $("restoreFile"), attachBtn: $("attachBtn"), attachFile: $("attachFile"),
  attachments: $("attachments"), drop: $("drop"),
  camBtn: $("camBtn"), camSheet: $("camSheet"), camVideo: $("camVideo"), camSnap: $("camSnap"),
  camWatch: $("camWatch"), camFlip: $("camFlip"), camClose: $("camClose"), camState: $("camState"),
  camLive: $("camLive"),
};

const KEY = "nullp.v1";
const CHIPS = [
  "I'm about to force push to main.",
  "Should I sign this apartment lease today?",
  "Explain what a reverse proxy actually does.",
  "I want to quit my job next week.",
  "Is it safe to run this curl | bash install?",
];

let state = load();
let inFlight = null; // AbortController while streaming

// ------------------------------------------------------------------- storage

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved?.chats?.length) return saved;
  } catch {
    /* corrupt or unavailable storage - start fresh */
  }
  return { chats: [blankChat()], activeId: null, theme: "dark", mode: "balanced" };
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode or full quota - the app still works for this session */
  }
}

function blankChat() {
  return { id: crypto.randomUUID(), title: "New chat", messages: [], updated: Date.now() };
}

const active = () =>
  state.chats.find((c) => c.id === state.activeId) || state.chats[0];

// --------------------------------------------------------------------- boot

state.activeId ||= state.chats[0].id;
document.documentElement.dataset.theme = state.theme || "dark";
el.mode.value = state.mode || "balanced";

CHIPS.forEach((text) => {
  const b = document.createElement("button");
  b.className = "chip";
  b.textContent = text;
  b.onclick = () => {
    el.input.value = text;
    autosize();
    submit();
  };
  el.chips.append(b);
});

fetch("/api/health")
  .then((r) => r.json())
  .then((h) => {
    el.status.className = `status ${h.connected ? "live" : "offline"}`;
    el.status.textContent = !h.connected
      ? "offline - no model"
      : h.engine === "local"
        ? `${h.model} · local`
        : h.model;
  })
  .catch(() => {
    el.status.className = "status offline";
    el.status.textContent = "server unreachable";
  });

renderChats();
renderTranscript();

// ------------------------------------------------------------------ chat list

function renderChats() {
  const q = el.search.value.trim().toLowerCase();
  el.chatList.textContent = "";

  const visible = state.chats
    .filter((c) => !q || c.title.toLowerCase().includes(q) ||
      c.messages.some((m) => m.content.toLowerCase().includes(q)))
    .sort((a, b) => b.updated - a.updated);

  for (const chat of visible) {
    const row = document.createElement("div");
    row.className = `chat-item${chat.id === state.activeId ? " active" : ""}`;
    row.onclick = () => {
      if (inFlight) return;
      state.activeId = chat.id;
      el.usage.textContent = "";
      save();
      renderChats();
      renderTranscript();
      el.sidebar.classList.remove("open");
    };

    const name = document.createElement("span");
    name.textContent = chat.title;
    name.title = "Double-click to rename";
    name.ondblclick = (e) => {
      e.stopPropagation();
      const next = prompt("Rename chat", chat.title);
      if (next?.trim()) {
        chat.title = next.trim();
        save();
        renderChats();
        renderTranscript();
      }
    };

    const del = document.createElement("button");
    del.textContent = "×";
    del.title = "Delete chat";
    del.onclick = (e) => {
      e.stopPropagation();
      if (inFlight) return; // wait for the answer to land
      deleteChat(chat.id);
    };

    row.append(name, del);
    el.chatList.append(row);
  }
}

function deleteChat(id) {
  state.chats = state.chats.filter((c) => c.id !== id);
  if (!state.chats.length) state.chats.push(blankChat());
  if (state.activeId === id) state.activeId = state.chats[0].id;
  save();
  renderChats();
  renderTranscript();
}

function newChat() {
  if (inFlight) return;
  el.usage.textContent = "";
  // Reuse an untouched chat rather than stacking up empty ones.
  const chat = state.chats.find((c) => !c.messages.length) || blankChat();
  if (!state.chats.includes(chat)) state.chats.unshift(chat);
  chat.updated = Date.now();
  state.activeId = chat.id;
  save();
  renderChats();
  renderTranscript();
  el.input.focus();
}

// ----------------------------------------------------------------- transcript

function renderTranscript() {
  const chat = active();
  el.chatTitle.textContent = chat.title;
  el.transcript.textContent = "";
  el.empty.hidden = chat.messages.length > 0;

  chat.messages.forEach((msg, i) => el.transcript.append(turnNode(msg, i)));
  el.regen.hidden = chat.messages.length < 2;
  scrollToEnd();
}

function turnNode(msg, index) {
  const wrap = document.createElement("article");
  wrap.className = `turn ${msg.role}`;

  const who = document.createElement("div");
  who.className = "who";
  who.textContent = msg.role === "user" ? "You" : "Nullp";
  if (msg.role === "assistant" && !msg.failed) who.append(severityBadge(msg.content));
  wrap.append(who);

  if (msg.role === "user") {
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = msg.content;
    wrap.append(bubble);
    if (msg.image) {
      const img = document.createElement("img");
      img.className = "shot";
      img.src = msg.image;
      img.alt = "Camera frame sent to Nullp";
      wrap.append(img);
    }
    if (msg.attachments?.length) {
      const row = document.createElement("div");
      row.className = "attachments";
      row.style.margin = "6px 0 0";
      for (const a of msg.attachments) row.append(fileChip(a));
      wrap.append(row);
    }
  } else {
    if (msg.seen) {
      const seen = document.createElement("div");
      seen.className = "seen";
      seen.textContent = `Nullp saw: ${msg.seen}`;
      wrap.append(seen);
    }
    wrap.append(linesNode(msg.content));
  }

  const tools = document.createElement("div");
  tools.className = "turn-tools";
  tools.append(
    linkButton("Copy", () => navigator.clipboard?.writeText(msg.content)),
  );
  if (msg.role === "user") {
    tools.append(linkButton("Edit & resend", () => {
      if (inFlight) return;
      const chat = active();
      el.input.value = msg.content;
      chat.messages = chat.messages.slice(0, index);
      save();
      renderTranscript();
      autosize();
      el.input.focus();
    }));
  }
  wrap.append(tools);
  return wrap;
}

// Nullp answers in tagged lines: [warn] / [info] / [do].
function linesNode(text) {
  const box = document.createElement("div");
  box.className = "lines";

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    const match = /^\[(warn|info|do|error)\]\s*(.*)$/i.exec(line);
    const kind = match ? match[1].toLowerCase() : "plain";
    const body = match ? match[2] : line;

    const row = document.createElement("div");
    row.className = `line ${kind === "error" ? "err" : kind}`;

    const tag = document.createElement("div");
    tag.className = "tag";
    tag.textContent = { warn: "warn", info: "info", do: "do", error: "error", plain: "·" }[kind];

    const span = document.createElement("div");
    span.className = "text";
    span.textContent = body;

    row.append(tag, span);
    box.append(row);
  }

  if (!box.children.length) {
    const row = document.createElement("div");
    row.className = "line plain";
    const tag = document.createElement("div");
    tag.className = "tag";
    tag.textContent = "·";
    const span = document.createElement("div");
    span.className = "text";
    span.textContent = text;
    row.append(tag, span);
    box.append(row);
  }
  return box;
}

function linkButton(label, onclick) {
  const b = document.createElement("button");
  b.className = "linkbtn";
  b.textContent = label;
  b.onclick = onclick;
  return b;
}

// -------------------------------------------------------------------- sending

async function submit() {
  const text = el.input.value.trim();
  if ((!text && !pending.length) || inFlight) return;
  if (pending.some((a) => a.loading)) return; // still reading a file or link

  await readLinksIn(text);
  if (inFlight) return; // something else started while the links were loading
  const attachments = pending.filter((a) => !a.error).map(({ name, kind, text: body }) => ({ name, kind, text: body }));
  // Only failed attachments and no text: leave them on screen with their errors.
  if (!text && !attachments.length) return;
  clearPending();

  const chat = active();
  const content = text || `(Read ${attachments.map((a) => a.name).join(", ")} and warn me about it.)`;
  chat.messages.push({
    role: "user",
    content,
    ...(attachments.length ? { attachments } : {}),
  });
  if (chat.title === "New chat") {
    chat.title = content.length > 38 ? `${content.slice(0, 38)}…` : content;
  }
  chat.updated = Date.now();
  el.input.value = "";
  autosize();
  save();
  renderChats();
  renderTranscript();
  await stream(chat);
}

async function regenerate() {
  if (inFlight) return;
  const chat = active();
  while (chat.messages.length && chat.messages.at(-1).role === "assistant") {
    chat.messages.pop();
  }
  if (!chat.messages.length) return;
  save();
  renderTranscript();
  await stream(chat);
}

async function stream(chat) {
  setBusy(true);
  el.empty.hidden = true;

  // Live turn, rebuilt from the accumulated text on every chunk.
  const live = document.createElement("article");
  live.className = "turn assistant";
  live.innerHTML = '<div class="who">Nullp</div>';
  let body = document.createElement("div");
  body.className = "lines cursor";
  live.append(body);
  el.transcript.append(live);
  scrollToEnd();

  let text = "";
  let seen = "";
  inFlight = new AbortController();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Failed turns stay on screen but never go back to the model.
        messages: chat.messages
          .filter((m) => !m.failed)
          .map(({ role, content }) => ({ role, content })),
        mode: el.mode.value,
        attachments: [...chat.messages].reverse().find((m) => m.role === "user")?.attachments ?? [],
        image: [...chat.messages].reverse().find((m) => m.role === "user")?.image,
        ...brainChoice(),
      }),
      signal: inFlight.signal,
    });
    if (!res.ok || !res.body) throw new Error(`server responded ${res.status}`);

    for await (const evt of sse(res.body)) {
      if (evt.event === "seen") {
        seen = evt.data.text;
        const note = document.createElement("div");
        note.className = "seen";
        note.textContent = `Nullp saw: ${seen}`;
        live.insertBefore(note, live.querySelector(".lines"));
      } else if (evt.event === "delta") {
        text += evt.data.text;
        body.replaceWith(Object.assign(linesNode(text), { className: "lines cursor" }));
        body = live.querySelector(".lines");
        scrollToEnd();
      } else if (evt.event === "done") {
        showUsage(evt.data.usage, evt.data.offline);
      } else if (evt.event === "error") {
        text += `${text ? "\n" : ""}[error] ${evt.data.message}`;
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      text += `${text ? "\n" : ""}[error] ${err.message}`;
    } else if (text) {
      text += "\n[info] Stopped.";
    }
  } finally {
    inFlight = null;
    live.remove();
    if (text.trim()) {
      const turn = { role: "assistant", content: text.trim(), ...(seen ? { seen } : {}) };
      if (/^\[error\]/m.test(turn.content)) turn.failed = true;
      chat.messages.push(turn);
      chat.updated = Date.now();
      save();
    }
    renderChats();
    renderTranscript();
    setBusy(false);
    if (voice.pendingReply && text.trim()) voice.say(text);
    voice.pendingReply = false;
    el.input.focus();
  }
}

// Minimal SSE reader over the fetch body stream.
async function* sse(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let split;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);

      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (data) yield { event, data: JSON.parse(data) };
    }
  }
}

function showUsage(usage, offline) {
  if (offline) return void (el.usage.textContent = "offline reply - no model was called");
  if (!usage) return void (el.usage.textContent = "");
  const cached = usage.cached ? `, ${usage.cached} cached` : "";
  el.usage.textContent = `${usage.input} in${cached} · ${usage.output} out`;
}

function setBusy(busy) {
  el.send.hidden = busy;
  el.stop.hidden = !busy;
  el.input.disabled = busy;
  el.newChat.disabled = busy;
  el.regen.disabled = busy;
}

// --------------------------------------------------------------------- export

function exportChat() {
  const chat = active();
  if (!chat.messages.length) return;
  const md = [
    `# ${chat.title}`,
    `_Nullp · ${new Date(chat.updated).toLocaleString()}_`,
    "",
    ...chat.messages.map((m) =>
      m.role === "user" ? `**You:** ${m.content}\n` : `**Nullp:**\n${m.content}\n`,
    ),
  ].join("\n");

  const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${chat.title.replace(/[^\w\- ]+/g, "").trim() || "nullp-chat"}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --------------------------------------------------------------------- wiring

function autosize() {
  el.input.style.height = "auto";
  el.input.style.height = `${Math.min(el.input.scrollHeight, 200)}px`;
}

el.send.onclick = submit;
el.stop.onclick = () => inFlight?.abort();
el.regen.onclick = regenerate;
el.newChat.onclick = newChat;
el.exportBtn.onclick = exportChat;
el.search.oninput = renderChats;
el.input.oninput = autosize;
el.menuToggle.onclick = () => el.sidebar.classList.toggle("open");

el.mode.onchange = () => {
  state.mode = el.mode.value;
  save();
};

el.themeToggle.onclick = () => {
  state.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = state.theme;
  save();
};

el.wipe.onclick = () => {
  if (inFlight) return;
  if (!confirm("Delete every saved chat? This cannot be undone.")) return;
  state.chats = [blankChat()];
  state.activeId = state.chats[0].id;
  save();
  renderChats();
  renderTranscript();
};

el.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submit();
  }
});

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    newChat();
  }
  if (e.key === "Escape") inFlight?.abort();
});

el.input.focus();

// ----------------------------------------------------------------------- voice
// Top-right button: hold a spoken conversation with Nullp. While the mic is
// open or Nullp is talking back, a small indicator sits in the bottom-left.

const voice = {
  recognition: null,
  listening: false,
  pendingReply: false,

  get canListen() {
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  },
  get canTalk() {
    return "speechSynthesis" in window;
  },

  init() {
    if (!this.canListen && !this.canTalk) {
      el.voice.hidden = true;
      return;
    }
    if (!this.canListen) {
      el.voice.textContent = "🔊";
      el.voice.title = "Read Nullp's last answer aloud (this browser has no mic support)";
    }
    el.voice.onclick = () => this.toggle();
    el.playingStop.onclick = () => this.stopAll();
    document.addEventListener("keydown", (e) => {
      const node = document.activeElement;
      const typing =
        node &&
        (node.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName));
      if (!typing && e.key.toLowerCase() === "v" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        this.toggle();
      }
    });
  },

  toggle() {
    if (this.listening || window.speechSynthesis?.speaking) return this.stopAll();
    if (this.canListen) return this.listen();
    const last = [...active().messages].reverse().find((m) => m.role === "assistant");
    if (last) this.say(last.content);
  },

  listen() {
    if (inFlight) return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new Recognition();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true;
    rec.continuous = false;

    let transcript = "";

    rec.onstart = () => {
      this.listening = true;
      el.voice.classList.add("listening");
      this.show("listen", "Listening…");
    };

    rec.onresult = (e) => {
      transcript = [...e.results].map((r) => r[0].transcript).join(" ").trim();
      this.show("listen", transcript ? `"${transcript.slice(0, 44)}"` : "Listening…");
      el.input.value = transcript;
      autosize();
    };

    rec.onerror = (e) => {
      this.show("listen", e.error === "not-allowed" ? "Mic blocked" : `Mic error: ${e.error}`);
      setTimeout(() => this.hide(), 2200);
    };

    rec.onend = () => {
      this.listening = false;
      this.recognition = null;
      el.voice.classList.remove("listening");
      this.hide();
      if (transcript) {
        this.pendingReply = this.canTalk; // spoke to it, so it speaks back
        submit();
      }
    };

    this.recognition = rec;
    rec.start();
  },

  // Nullp reads its tagged lines out loud, with the tags turned into words.
  say(text) {
    if (!this.canTalk) return;
    const spoken = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) =>
        line
          .replace(/^\[warn\]\s*/i, "Warning. ")
          .replace(/^\[do\]\s*/i, "Do this. ")
          .replace(/^\[info\]\s*/i, "")
          .replace(/^\[error\]\s*/i, "Error. "),
      )
      .join(". ");
    if (!spoken) return;

    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.rate = 1.02;
    utterance.pitch = 0.95;
    utterance.onstart = () => {
      el.voice.classList.add("talking");
      this.show("talk", "Nullp is speaking");
    };
    utterance.onend = utterance.onerror = () => {
      el.voice.classList.remove("talking");
      this.hide();
    };
    speechSynthesis.speak(utterance);
  },

  stopAll() {
    this.recognition?.abort();
    this.listening = false;
    this.pendingReply = false;
    if (this.canTalk) speechSynthesis.cancel();
    el.voice.classList.remove("listening", "talking");
    this.hide();
  },

  show(kind, label) {
    el.playing.className = `playing ${kind}`;
    el.playingText.textContent = label;
    el.playing.hidden = false;
  },

  hide() {
    el.playing.hidden = true;
  },
};

voice.init();

// ------------------------------------------------------------------ severity
// How bad is it, at a glance: counted from Nullp's own [warn] lines.

function severityBadge(text) {
  const warnings = (text.match(/^\s*\[warn\]/gim) || []).length;
  const badge = document.createElement("span");
  badge.className = "badge";
  if (!warnings) {
    badge.classList.add("clear");
    badge.textContent = "all clear";
  } else if (warnings <= 2) {
    badge.classList.add("caution");
    badge.textContent = `${warnings} warning${warnings > 1 ? "s" : ""}`;
  } else {
    badge.classList.add("high");
    badge.textContent = `${warnings} warnings`;
  }
  return badge;
}

// --------------------------------------------------------------- attachments
// Files you drop or pick, and links in your message, become text Nullp reads.
// The server labels all of it as data, never as instructions.

const pending = [];
const MAX_FILE_BYTES = 300_000;
const URL_RE = /\bhttps?:\/\/[^\s<>"'）)]+/gi;

function fileChip(a, onRemove) {
  const chip = document.createElement("span");
  chip.className = `chip-file${a.loading ? " loading" : ""}${a.error ? " bad" : ""}`;
  chip.title = a.error || (a.kind === "url" ? a.url : `${a.text.length.toLocaleString()} characters`);
  const icon = a.kind === "url" ? "🔗" : "📄";
  const label = document.createElement("b");
  label.textContent = a.loading ? `${a.name} — reading…` : a.error ? `${a.name} — ${a.error}` : a.name;
  chip.append(icon, label);
  if (onRemove) {
    const x = document.createElement("button");
    x.textContent = "×";
    x.title = "Remove";
    x.onclick = onRemove;
    chip.append(x);
  }
  return chip;
}

function renderPending() {
  el.attachments.textContent = "";
  el.attachments.hidden = !pending.length;
  pending.forEach((a, i) =>
    el.attachments.append(
      fileChip(a, () => {
        pending.splice(i, 1);
        renderPending();
      }),
    ),
  );
}

function clearPending() {
  pending.length = 0;
  renderPending();
}

async function addFiles(files) {
  for (const file of files) {
    const entry = { name: file.name, kind: "file", text: "", loading: true };
    pending.push(entry);
    renderPending();

    if (file.size > MAX_FILE_BYTES) {
      Object.assign(entry, { loading: false, error: "too big (max 300 KB)" });
    } else {
      try {
        const text = await file.text();
        // Binary files decode into replacement characters - not worth sending.
        const junk = (text.match(/�/g) || []).length;
        if (!text.trim() || junk > text.length * 0.02) {
          Object.assign(entry, { loading: false, error: "not a text file" });
        } else {
          Object.assign(entry, { loading: false, text: text.slice(0, 8000) });
        }
      } catch {
        Object.assign(entry, { loading: false, error: "could not read" });
      }
    }
    renderPending();
  }
}

// Every link in the message is fetched by the local server and attached.
async function readLinksIn(text) {
  const found = (text.match(URL_RE) || []).map((u) => u.replace(/[.,;:!?。，；：！？]+$/, ""));
  const urls = [...new Set(found)].slice(0, 2);
  const jobs = urls
    .filter((url) => !pending.some((a) => a.url === url))
    .map(async (url) => {
      const entry = { name: new URL(url).hostname, kind: "url", url, text: "", loading: true };
      pending.push(entry);
      renderPending();
      try {
        const res = await fetch("/api/fetch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const page = await res.json();
        if (!res.ok) throw new Error(page.error || `failed (${res.status})`);
        Object.assign(entry, { loading: false, name: page.title || entry.name, text: `${page.url}\n\n${page.text}` });
      } catch (err) {
        Object.assign(entry, { loading: false, error: err.message });
      }
      renderPending();
    });
  await Promise.all(jobs);
}

el.attachBtn.onclick = () => el.attachFile.click();
el.attachFile.onchange = () => {
  addFiles([...el.attachFile.files]);
  el.attachFile.value = "";
};

// A big paste becomes an attachment instead of flooding the input box.
el.input.addEventListener("paste", (e) => {
  const text = e.clipboardData?.getData("text") ?? "";
  if (text.length < 2500) return;
  e.preventDefault();
  pending.push({ name: `pasted text (${text.length.toLocaleString()} chars)`, kind: "file", text: text.slice(0, 8000) });
  renderPending();
});

let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
  dragDepth += 1;
  el.drop.hidden = false;
});
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) el.drop.hidden = true;
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  el.drop.hidden = true;
  if (e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files]);
});

// --------------------------------------------------------------------- brain
// Pick which model answers: Claude when there is a key, or any local model.

function brainChoice() {
  const [engine, ...rest] = (el.engine.value || "").split(":");
  const model = rest.join(":");
  return engine ? { engine, model } : {};
}

async function loadBrains() {
  try {
    const m = await (await fetch("/api/models")).json();
    el.engine.textContent = "";
    if (m.claude) el.engine.append(new Option(`Claude · ${m.claude}`, `claude:${m.claude}`));
    for (const local of m.local) {
      const gb = local.size ? ` · ${(local.size / 1e9).toFixed(1)} GB` : "";
      el.engine.append(new Option(`${local.name} · local${gb}`, `local:${local.name}`));
    }
    if (!el.engine.options.length) el.engine.append(new Option("none — offline", ""));

    const saved = state.brain;
    const fallback = `${m.default.engine}:${m.default.model}`;
    el.engine.value = [...el.engine.options].some((o) => o.value === saved) ? saved : fallback;
    if (!el.engine.value && el.engine.options.length) el.engine.selectedIndex = 0;
  } catch {
    el.engine.textContent = "";
    el.engine.append(new Option("server unreachable", ""));
  }
}

el.engine.onchange = () => {
  state.brain = el.engine.value;
  save();
};

loadBrains();

// --------------------------------------------------------------------- notes
// Standing facts, stored on the server so the games' widget sees them too.

async function openNotes() {
  el.notesSheet.hidden = false;
  el.notesState.textContent = "loading…";
  try {
    const notes = await (await fetch("/api/notes")).json();
    el.notesText.value = notes.text || "";
    el.notesState.textContent = notes.updated
      ? `saved ${new Date(notes.updated).toLocaleString()}`
      : "nothing saved yet";
  } catch {
    el.notesState.textContent = "could not reach the server";
  }
  el.notesText.focus();
}

async function saveNotesNow() {
  el.notesState.textContent = "saving…";
  try {
    const res = await fetch("/api/notes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: el.notesText.value }),
    });
    const notes = await res.json();
    if (!res.ok) throw new Error(notes.error);
    el.notesState.textContent = `saved ${new Date(notes.updated).toLocaleTimeString()}`;
  } catch (err) {
    el.notesState.textContent = `not saved: ${err.message}`;
  }
}

el.notesBtn.onclick = openNotes;
el.notesSave.onclick = saveNotesNow;
el.notesClose.onclick = () => (el.notesSheet.hidden = true);
el.notesSheet.onclick = (e) => {
  if (e.target === el.notesSheet) el.notesSheet.hidden = true;
};
el.notesText.addEventListener("keydown", (e) => {
  e.stopPropagation(); // "v" and Ctrl+K belong to the text here, not the app
  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
    e.preventDefault();
    saveNotesNow();
  }
  if (e.key === "Escape") el.notesSheet.hidden = true;
});

// ------------------------------------------------------------ backup/restore

function backup() {
  const payload = { app: "nullp", version: 1, exported: new Date().toISOString(), chats: state.chats };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `nullp-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function restore(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    el.usage.textContent = "restore failed: that file is not JSON";
    return;
  }
  const incoming = Array.isArray(data?.chats) ? data.chats : [];
  const valid = incoming
    .filter((c) => c && typeof c.id === "string" && Array.isArray(c.messages) && typeof c.title === "string")
    .map((c) => ({
      ...c,
      updated: Number(c.updated) || Date.now(),
      messages: c.messages.filter(
        (m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
      ),
    }));
  const known = new Set(state.chats.map((c) => c.id));
  const added = valid.filter((c) => !known.has(c.id));
  state.chats.push(...added);
  // Drop the untouched blank chat if we just brought real ones in.
  if (added.length) state.chats = state.chats.filter((c) => c.messages.length || c.id === state.activeId);
  save();
  renderChats();
  renderTranscript(); // the active chat may have been the blank one just dropped
  el.usage.textContent = `restored ${added.length} chat${added.length === 1 ? "" : "s"}` +
    (valid.length - added.length ? `, skipped ${valid.length - added.length} already here` : "");
}

el.backupBtn.onclick = backup;
el.restoreBtn.onclick = () => el.restoreFile.click();
el.restoreFile.onchange = () => {
  if (el.restoreFile.files[0]) restore(el.restoreFile.files[0]);
  el.restoreFile.value = "";
};

// -------------------------------------------------------------------- camera
// Nullp looks through the camera. One-off: snap a frame and ask about it.
// Watch mode: look every few seconds, stay silent unless something is wrong.

const cam = { stream: null, facing: "user", watching: false, timer: null, busy: false, lastSpoke: 0 };
const WATCH_EVERY_MS = 12000;
const WATCH_PROMPT =
  "Look at the camera view. If something is actually risky, warn me in one or two lines. " +
  "If nothing is risky, reply exactly: [info] All clear.";

async function openCamera() {
  el.camSheet.hidden = false;
  await startStream();
}

async function startStream() {
  stopStream();
  el.camState.textContent = "starting camera…";
  if (!navigator.mediaDevices?.getUserMedia) {
    el.camState.textContent = "this browser has no camera access";
    return;
  }
  try {
    cam.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: cam.facing, width: { ideal: 1280 } },
      audio: false,
    });
    el.camVideo.srcObject = cam.stream;
    el.camState.textContent = "ready — ask a question in the box, or just snap";
  } catch (err) {
    el.camState.textContent =
      err.name === "NotAllowedError"
        ? "camera blocked — allow it in the browser's site settings"
        : err.name === "NotFoundError"
          ? "no camera found"
          : `camera error: ${err.message}`;
  }
}

function stopStream() {
  cam.stream?.getTracks().forEach((t) => t.stop());
  cam.stream = null;
  el.camVideo.srcObject = null;
}

function closeCamera() {
  stopWatch();
  stopStream();
  el.camSheet.hidden = true;
}

// One size for everything: small enough for localStorage, big enough to read.
function grabFrame() {
  const v = el.camVideo;
  if (!v.videoWidth) return null;
  const scale = Math.min(1, 512 / v.videoWidth);
  const c = document.createElement("canvas");
  c.width = Math.round(v.videoWidth * scale);
  c.height = Math.round(v.videoHeight * scale);
  c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.65);
}

async function snapAndAsk() {
  if (inFlight) return;
  const frame = grabFrame();
  if (!frame) {
    el.camState.textContent = "no picture yet — is the camera on?";
    return;
  }
  const question = el.input.value.trim() || "What do you see? Warn me about anything risky.";
  el.input.value = "";
  autosize();
  closeCamera();

  const chat = active();
  chat.messages.push({ role: "user", content: question, image: frame });
  if (chat.title === "New chat") chat.title = `📷 ${question.slice(0, 34)}`;
  chat.updated = Date.now();
  save();
  renderChats();
  renderTranscript();
  await stream(chat);
}

// A request that does not touch the chat unless it finds something.
async function quietAsk(frame) {
  let text = "";
  let seen = "";
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: WATCH_PROMPT }],
      mode: "brief",
      image: frame,
      ...brainChoice(),
    }),
  });
  if (!res.ok || !res.body) throw new Error(`server responded ${res.status}`);
  for await (const evt of sse(res.body)) {
    if (evt.event === "delta") text += evt.data.text;
    else if (evt.event === "seen") seen = evt.data.text;
    else if (evt.event === "error") throw new Error(evt.data.message);
  }
  return { text: text.trim(), seen };
}

async function watchTick() {
  if (!cam.watching) return;
  if (!inFlight && !cam.busy && !document.hidden) {
    const frame = grabFrame();
    if (frame) {
      cam.busy = true;
      el.camState.textContent = "looking…";
      try {
        const { text, seen } = await quietAsk(frame);
        const stamp = new Date().toLocaleTimeString();
        const warns = (text.match(/^\s*\[warn\]/gim) || []).length;
        if (warns && cam.watching && !inFlight) {
          // The small model sometimes tacks the "all clear" sentinel onto a warning.
          const cleaned = text
            .split("\n")
            .filter((l) => !/^\s*\[info\]\s*all clear\.?\s*$/i.test(l))
            .join("\n");
          const chat = active();
          chat.messages.push({ role: "user", content: "👁 Watch mode", image: frame });
          chat.messages.push({ role: "assistant", content: cleaned, ...(seen ? { seen } : {}) });
          chat.updated = Date.now();
          save();
          renderChats();
          renderTranscript();
          el.camState.textContent = `⚠ ${warns} warning${warns > 1 ? "s" : ""} at ${stamp} — see the chat`;
          // Speak up, but not every tick about the same thing.
          if (voice.canTalk && Date.now() - cam.lastSpoke > 30000) {
            cam.lastSpoke = Date.now();
            voice.say(cleaned);
          }
        } else if (cam.watching) {
          el.camState.textContent = `all clear · ${stamp}`;
        }
      } catch (err) {
        el.camState.textContent = `watch paused: ${err.message}`;
      } finally {
        cam.busy = false;
      }
    }
  }
  clearTimeout(cam.timer);
  if (cam.watching) cam.timer = setTimeout(watchTick, WATCH_EVERY_MS);
}

function startWatch() {
  if (!cam.stream || cam.watching) return;
  cam.watching = true;
  el.camWatch.classList.add("on");
  el.camWatch.textContent = "👁 Stop watching";
  el.camLive.hidden = false;
  watchTick();
}

function stopWatch() {
  cam.watching = false;
  clearTimeout(cam.timer);
  el.camWatch.classList.remove("on");
  el.camWatch.textContent = "👁 Watch";
  el.camLive.hidden = true;
}

el.camBtn.onclick = openCamera;
el.camClose.onclick = closeCamera;
el.camSnap.onclick = snapAndAsk;
el.camWatch.onclick = () => (cam.watching ? stopWatch() : startWatch());
el.camFlip.onclick = () => {
  cam.facing = cam.facing === "user" ? "environment" : "user";
  startStream();
};
el.camSheet.onclick = (e) => {
  if (e.target === el.camSheet) closeCamera();
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !el.camSheet.hidden) closeCamera();
});

// Say up front whether the camera can work, instead of failing on the first snap.
fetch("/api/models")
  .then((r) => r.json())
  .then((m) => {
    if (!m.vision) el.camBtn.title = `Camera mode needs a vision model — run: ollama pull ${m.visionModel}`;
  })
  .catch(() => {});
