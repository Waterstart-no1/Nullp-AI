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
  wrap.append(who);

  if (msg.role === "user") {
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = msg.content;
    wrap.append(bubble);
  } else {
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
  if (!text || inFlight) return;

  const chat = active();
  chat.messages.push({ role: "user", content: text });
  if (chat.title === "New chat") {
    chat.title = text.length > 38 ? `${text.slice(0, 38)}…` : text;
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
  inFlight = new AbortController();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Failed turns stay on screen but never go back to the model.
        messages: chat.messages.filter((m) => !m.failed),
        mode: el.mode.value,
      }),
      signal: inFlight.signal,
    });
    if (!res.ok || !res.body) throw new Error(`server responded ${res.status}`);

    for await (const evt of sse(res.body)) {
      if (evt.event === "delta") {
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
      const turn = { role: "assistant", content: text.trim() };
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
  URL.revokeObjectURL(url);
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
