/* 과목별 공유 노트: 여러 명이 한 노트를 동시에 고친다 (OT). 함께 보는 사람·커서 위치·마크다운 미리보기 */
(function () {
  "use strict";
  const A = window.App, esc = A.esc, OT = window.OT, RT = A.rt;
  const N = (A.notes = { sid: null, list: [], meta: null, sess: null, mode: localStorage.getItem("es.noteMode") || "split" });

  A.views.notes = {
    async load(fresh) {
      if (!A.route.sid) { if (A.subjectsStale || !A.subjects.length) await A.loadSubjects(); return; }
      if (!A.subject(A.route.sid)) await A.loadSubjects();
      if (!A.subject(A.route.sid)) throw new Error("과목을 찾을 수 없어요.");
      N.sid = A.route.sid;
      N.list = (await A.api("/api/notes?subject=" + N.sid)).notes;
      if (A.route.sub && (fresh || !N.sess || N.sess.id !== A.route.sub)) {
        const m = await A.api("/api/notes/" + A.route.sub);
        N.meta = m;
        startSession(m);
      } else if (!A.route.sub) { N.meta = null; }
    },
    render() {
      if (!A.route.sid) return A.subjectGrid("notes", "공유 노트", "과목마다 노트를 만들고 반 친구들과 동시에 고쳐요. 누가 어디를 쓰는지 실시간으로 보여요.");
      const s = A.subject(N.sid);
      return A.subjectHead("notes", s, A.canWrite() ? `<button class="btn primary" data-act="noteNew">＋ 새 노트</button>` : "") +
        `<div class="notes ${A.route.sub ? "has-note" : ""}"><aside class="nlist" aria-label="노트 목록">${listHtml()}</aside>
          <section class="neditor" aria-label="노트 편집">${A.route.sub && N.meta ? editorHtml() : `<div class="empty-state"><span>📝</span><p>${N.list.length ? "왼쪽에서 노트를 골라 주세요." : "아직 노트가 없어요. 새 노트를 만들어 함께 정리해 보세요."}</p>${A.canWrite() ? `<button class="btn primary" data-act="noteNew">＋ 새 노트</button>` : ""}</div>`}</section></div>`;
    },
    after() {
      if (!(N.sess && A.route.sub === N.sess.id)) return;
      const host = A.$("#ink-host");
      if (host) { window.Ink.mount(host, { id: N.sess.id }); paintPeople(); bindTitle(); }
    },
    onChanged(kind, id) {
      if (kind !== "notes" || !A.route.sid) return;
      A.api("/api/notes?subject=" + N.sid).then((r) => {
        N.list = r.notes;
        const l = A.$(".nlist"); if (l) l.innerHTML = listHtml();
        if (N.sess && id === N.sess.id) {
          const cur = N.list.find((x) => x.id === id);
          if (!cur) { A.toast("이 노트가 지워졌어요."); A.go("notes/" + N.sid); return; }
          const t = A.$("#nt-title");
          if (t && document.activeElement !== t && t.value !== cur.title) { t.value = cur.title; N.meta.title = cur.title; }
        }
      }).catch(() => {});
    },
    onOnline() {},
    leave() { if (window.Ink) window.Ink.unmount(); endSession(); },
  };

  function listHtml() {
    return `<div class="nl-h"><b>노트 ${N.list.length}</b></div>` + (N.list.map((n) => `<div class="nl-wrap"><button class="nl ${A.route.sub === n.id ? "on" : ""}" data-act="go" data-to="notes/${N.sid}/${n.id}">
      <b>${esc(n.title)}</b><span>✏️ ${n.inkPages || 1}쪽${n.preview ? " · " + esc(n.preview) : ""}</span><small>${A.avatar(n.lastEditedBy, "xs")} ${esc(n.lastEditedBy.name)} · ${A.ago(n.updatedAt)}${n.viewers ? ` · <i class="dot-live"></i>${n.viewers}명 보는 중` : ""}</small></button>
      ${A.canWrite() && A.isMine(n.createdBy) ? `<button class="nl-del" data-act="noteDelId" data-id="${n.id}" data-t="${esc(n.title)}" aria-label="${esc(n.title)} 지우기" title="지우기">🗑</button>` : ""}</div>`).join("") || `<p class="muted small pad">노트가 없어요.</p>`);
  }

  // 노트는 필기 화면 하나: 펜 + 글상자 + 사진
  function editorHtml() {
    const m = N.meta, ro = !A.canWrite();
    const canDel = A.canWrite() && A.isMine(m.createdBy);
    return `<div class="ne-top"><button class="link back m-only" data-act="go" data-to="notes/${N.sid}">← 목록</button>
        <input id="nt-title" class="nt-title" maxlength="60" value="${esc(m.title)}" aria-label="노트 제목" ${ro ? "readonly" : ""}>
        <span class="sp-f"></span><span id="nt-people" class="av-stack" aria-label="함께 보는 사람"></span><span id="nt-status" class="nt-status ok">실시간 저장됨</span>
        ${canDel ? `<button class="btn small danger" data-act="noteDel" title="노트 지우기">🗑 지우기</button>` : ""}</div>
      <div class="ink-host" id="ink-host"></div>
      <p class="ne-foot muted small">✏️ 펜으로 쓰고, 🔤 글상자로 글을 넣고, 🖼 사진을 붙여요 · 애플 펜슬·S펜 필압 · 두 손가락 확대 · 처음 만든 사람 ${esc(m.createdBy.name)} · 마지막으로 고친 사람 <b id="nt-last">${esc(m.lastEditedBy.name)}</b></p>`;
  }

  // ───── 편집 세션 ─────
  function startSession(m) {
    endSession();
    N.sess = { id: m.id, text: m.content, v: m.v, pending: null, pendingV: 0, pendingSeq: 0, buffer: [], seq: Math.floor(Math.random() * 1e6), users: [], typing: {}, pollT: 0, retryT: 0 };
    RT.noteHandler = onMsg;
    RT.onOpen = () => { if (N.sess) { openOnServer(); if (N.sess.pending) resend(); } };
    openOnServer();
    poll();
  }
  function endSession() {
    if (!N.sess) return;
    RT.send({ type: "note_close" });
    clearTimeout(N.sess.pollT); clearTimeout(N.sess.retryT);
    N.sess = null; RT.noteHandler = null; RT.onOpen = null;
  }
  function openOnServer() { const s = N.sess; RT.send({ type: "note_open", noteId: s.id, clientId: A.clientId, since: s.v, pos: caretPos() }); }

  // 웹소켓이 안 될 때 1.2초마다 새 편집을 가져온다
  async function poll() {
    const s = N.sess; if (!s) return;
    if (!RT.ok) {
      try {
        const r = await A.api(`/api/notes/${s.id}/ops?since=${s.v}&clientId=${A.clientId}&pos=${caretPos()}`);
        if (N.sess !== s) return;
        if (r.resync) onMsg({ type: "resync", noteId: s.id, content: r.content, v: r.v });
        else for (const m of r.ops) onMsg(m);
        onMsg({ type: "presence", noteId: s.id, users: r.presence });
        if (s.pending && !s.inflight) resend();
      } catch (e) { setStatus("off"); }
    }
    s.pollT = setTimeout(poll, RT.ok ? 3000 : 1200);
  }

  function onMsg(m) {
    const s = N.sess;
    if (!s || m.noteId !== s.id) return;
    if (m.type && m.type.startsWith("ink_")) {
      if (window.Ink) window.Ink.onMsg(m);
      if (m.type !== "ink_live") { const l = A.$("#nt-last"); const who = (m.strokes && m.strokes[0] && m.strokes[0].author) || (m.stroke && m.stroke.author); if (l && who) l.textContent = who.name; }
      if (m.type === "ink_live" && m.by) { s.typing[m.by.id] = Date.now(); }
      return;
    }
    if (m.type === "presence") { s.users = (m.users || []).filter((u) => u.clientId !== A.clientId); paintPeople(); paintCarets(); return; }
    if (m.type === "note_state") { if (!s.pending && !s.buffer.length && m.v !== s.v) replaceAll(m.content, m.v); return; }
    if (m.type === "resync") { const lost = s.pending || s.buffer.length; replaceAll(m.content, m.v); s.pending = null; s.buffer = []; if (lost) A.toast("연결이 끊겨 노트를 다시 맞췄어요. 마지막 몇 글자를 확인해 주세요."); return; }
    if (m.type !== "op" || m.v <= s.v) return;
    if (m.v !== s.v + 1) { openOnServer(); if (!RT.ok) clearTimeout(s.pollT), poll(); return; }
    if (m.clientId === A.clientId && s.pending && m.seq === s.pendingSeq) {
      s.v = m.v; s.pending = null; s.inflight = false; clearTimeout(s.retryT);
      flush();
      if (!s.pending) setStatus("ok");
      const l = A.$("#nt-last"); if (l) l.textContent = A.me.name;
      return;
    }
    if (m.clientId === A.clientId) { s.v = m.v; return; } // 예전에 보낸 같은 편집 (이미 글에 들어 있음)
    let r = m.ops;
    if (s.pending) [r, s.pending] = OT.xform(r, s.pending, true);
    if (s.buffer.length) [r, s.buffer] = OT.xform(r, s.buffer, true);
    s.v = m.v;
    applyRemote(r);
    for (const u of s.users) u.pos = OT.xpos(u.pos, r);
    if (m.by) { s.typing[m.by.id] = Date.now(); const l = A.$("#nt-last"); if (l) l.textContent = m.by.name; paintPeople(); }
    paintCarets();
  }

  function flush() {
    const s = N.sess;
    if (!s || s.pending || !s.buffer.length || !A.canWrite()) return;
    s.pending = s.buffer; s.buffer = []; s.pendingV = s.v; s.pendingSeq = ++s.seq;
    setStatus("saving");
    resend();
  }
  async function resend() {
    const s = N.sess; if (!s || !s.pending) return;
    const msg = { type: "op", noteId: s.id, v: s.pendingV, ops: s.pending, clientId: A.clientId, seq: s.pendingSeq };
    clearTimeout(s.retryT);
    s.retryT = setTimeout(() => { if (N.sess === s && s.pending) { setStatus("off"); s.inflight = false; resend(); } }, 4000);
    if (RT.send(msg)) return;
    s.inflight = true;
    try {
      const r = await A.api(`/api/notes/${s.id}/ops`, { method: "POST", body: msg });
      if (N.sess !== s) return;
      if (r.resync) onMsg({ type: "resync", noteId: s.id, content: r.content, v: r.v });
      else if (r.v > s.v + 1) { s.inflight = false; clearTimeout(s.pollT); poll(); }  // 그 사이 다른 편집이 있었다 → 먼저 받아 오기 (내 것은 그 안에서 확인됨)
      else onMsg(r);
    } catch (e) { s.inflight = false; setStatus("off"); }
  }

  function replaceAll(text, v) {
    const s = N.sess; s.text = text; s.v = v;
    const ta = A.$("#ed");
    if (ta) { const p = Math.min(ta.selectionStart, text.length); ta.value = text; if (document.activeElement === ta) ta.setSelectionRange(p, p); }
    paintPreview();
  }
  function applyRemote(r) {
    const s = N.sess, ta = A.$("#ed");
    s.text = OT.apply(s.text, r);
    if (ta) {
      const a = OT.xpos(ta.selectionStart, r), b = OT.xpos(ta.selectionEnd, r), st = ta.scrollTop, focused = document.activeElement === ta;
      ta.value = s.text;
      if (focused) ta.setSelectionRange(a, b);
      ta.scrollTop = st;
    }
    schedulePreview();
  }

  // 내가 고친 것
  function onLocal() {
    const s = N.sess, ta = A.$("#ed");
    if (!s || !ta) return;
    const ops = OT.diff(s.text, ta.value);
    if (!ops.length) return;
    s.text = ta.value;
    s.buffer = s.buffer.concat(ops);
    for (const u of s.users) u.pos = OT.xpos(u.pos, ops);
    flush();
    if (s.buffer.length) setStatus("saving");
    schedulePreview(); paintCarets(); sendCursor();
  }

  let curT = 0;
  function sendCursor() {
    clearTimeout(curT);
    curT = setTimeout(() => { const s = N.sess; if (s) RT.send({ type: "cursor", noteId: s.id, pos: caretPos() }); }, 120);
  }
  function caretPos() { const ta = A.$("#ed"); return ta ? ta.selectionStart : 0; }

  function setStatus(k) {
    const el = A.$("#nt-status"); if (!el) return;
    const t = { ok: ["실시간 저장됨", "ok"], saving: ["저장 중…", "saving"], off: ["연결이 끊겼어요 · 다시 보내는 중", "off"] }[k];
    el.textContent = t[0]; el.className = "nt-status " + t[1];
  }

  let pvT = 0;
  function schedulePreview() { clearTimeout(pvT); pvT = setTimeout(paintPreview, 150); }
  function paintPreview() { const pv = A.$("#pv"); if (pv && N.sess) pv.innerHTML = A.md(N.sess.text) || `<p class="muted">미리보기가 여기에 보여요.</p>`; }

  function paintPeople() {
    const el = A.$("#nt-people"), s = N.sess; if (!el || !s) return;
    const seen = new Map([[A.me.id, { id: A.me.id, name: A.me.name + " (나)", color: A.me.color }]]);
    for (const u of s.users) if (!seen.has(u.id)) seen.set(u.id, u);
    const now = Date.now();
    el.innerHTML = Array.from(seen.values()).map((u) => `<span class="pp ${now - (s.typing[u.id] || 0) < 1500 ? "typing" : ""}">${A.avatar(u, "sm")}</span>`).join("") + `<span class="pp-n">${seen.size}명 보는 중</span>`;
  }
  setInterval(() => { if (N.sess && A.$("#nt-people")) paintPeople(); }, 1500);

  // 다른 사람 커서 (글자 자리 위에 색 막대와 이름)
  let mirror = null;
  function caretXY(ta, pos) {
    if (!mirror) { mirror = document.createElement("div"); document.body.appendChild(mirror); }
    const cs = getComputedStyle(ta);
    for (const p of ["boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
      "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "wordSpacing", "tabSize", "textIndent"]) mirror.style[p] = cs[p];
    Object.assign(mirror.style, { position: "absolute", visibility: "hidden", top: "0", left: "-9999px", whiteSpace: "pre-wrap", wordWrap: "break-word", overflowWrap: "break-word", height: "auto", overflow: "hidden" });
    mirror.textContent = ta.value.slice(0, pos);
    const sp = document.createElement("span"); sp.textContent = ta.value.slice(pos, pos + 1) || "."; mirror.appendChild(sp);
    return { x: sp.offsetLeft - ta.scrollLeft, y: sp.offsetTop - ta.scrollTop, h: parseFloat(cs.lineHeight) || 24 };
  }
  function paintCarets() {
    const box = A.$("#carets"), ta = A.$("#ed"), s = N.sess;
    if (!box || !ta || !s) return;
    if (N.mode === "preview") { box.innerHTML = ""; return; }
    box.innerHTML = s.users.map((u) => {
      const p = caretXY(ta, Math.min(u.pos, ta.value.length));
      if (p.y < -10 || p.y > ta.clientHeight) return "";
      return `<span class="rc" style="--c:${esc(u.color)};left:${p.x}px;top:${p.y}px;height:${p.h}px"><b>${esc(u.name)}</b></span>`;
    }).join("");
  }

  function bindEditor() {
    const ta = A.$("#ed"), s = N.sess;
    if (!ta || !s) return;
    ta.value = s.text;
    paintPreview(); paintPeople();
    ta.addEventListener("input", onLocal);
    ["keyup", "click", "select"].forEach((e) => ta.addEventListener(e, sendCursor));
    ta.addEventListener("scroll", paintCarets);
    ta.addEventListener("keydown", (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && (ev.key === "b" || ev.key === "i")) { ev.preventDefault(); fmt(ev.key); }
      if (ev.key === "Tab") { ev.preventDefault(); insertAt("  "); }
      if (ev.key === "Enter") {  // 목록에서 Enter → 다음 줄도 목록
        const before = ta.value.slice(0, ta.selectionStart), line = before.slice(before.lastIndexOf("\n") + 1);
        const m = /^(\s*)([-*] \[[ x]\] |[-*] |\d+\. )/.exec(line);
        if (m && ta.selectionStart === ta.selectionEnd) {
          ev.preventDefault();
          if (line.trim() === m[2].trim()) { ta.setRangeText("", ta.selectionStart - line.length, ta.selectionStart, "end"); onLocal(); return; }
          let mk = m[2].replace("[x]", "[ ]");
          const num = /^(\d+)\./.exec(mk); if (num) mk = Number(num[1]) + 1 + ". ";
          insertAt("\n" + m[1] + mk);
        }
      }
    });
    window.addEventListener("resize", paintCarets);
    bindTitle();
    if (!s.text) setTimeout(() => ta.focus(), 50);
  }
  function bindTitle() {
    const s = N.sess, t = A.$("#nt-title");
    let tt = 0;
    if (t && A.canWrite()) t.addEventListener("input", () => {
      clearTimeout(tt);
      tt = setTimeout(async () => { try { await A.api("/api/notes/" + s.id, { method: "PATCH", body: { title: t.value || "제목 없는 노트" } }); N.meta.title = t.value; } catch (e) { A.toast(e.message, "err"); } }, 600);
    });
  }
  function insertAt(str) { const ta = A.$("#ed"); ta.setRangeText(str, ta.selectionStart, ta.selectionEnd, "end"); onLocal(); }
  function fmt(k) {
    const ta = A.$("#ed"); if (!ta || ta.readOnly) return;
    const a = ta.selectionStart, b = ta.selectionEnd, sel = ta.value.slice(a, b);
    const wrap = { b: "**", i: "*", code: "`" }[k];
    if (wrap) { ta.setRangeText(wrap + (sel || "글자") + wrap, a, b, "select"); if (!sel) ta.setSelectionRange(a + wrap.length, a + wrap.length + 2); }
    else {
      const pre = { h: "## ", ul: "- ", ck: "- [ ] " }[k];
      const ls = ta.value.lastIndexOf("\n", a - 1) + 1;
      ta.setRangeText(pre, ls, ls, "end");
    }
    ta.focus(); onLocal();
  }
  A.acts.fmt = (el) => fmt(el.dataset.k);
  A.acts.noteMode = (el) => {
    N.mode = el.dataset.v; localStorage.setItem("es.noteMode", N.mode);
    const body = A.$(".ne-body"); if (body) body.className = "ne-body mode-" + N.mode;
    A.$$("[data-act=noteMode]").forEach((b) => b.classList.toggle("on", b === el));
    paintCarets();
  };
  // 미리보기의 할 일 칸을 누르면 체크 (노트 글도 바뀐다)
  document.addEventListener("click", (ev) => {
    const li = ev.target.closest("#pv ul.chk li");
    if (!li || !A.canWrite() || !N.sess) return;
    const idx = A.$$("#pv ul.chk li").indexOf(li);
    const ta = A.$("#ed"); let k = -1;
    const lines = ta.value.split("\n");
    for (let i = 0; i < lines.length; i++) if (/^\s*[-*]\s+\[( |x)\]/i.test(lines[i]) && ++k === idx) { lines[i] = lines[i].replace(/\[( |x)\]/i, (m) => (m.toLowerCase() === "[x]" ? "[ ]" : "[x]")); break; }
    ta.value = lines.join("\n"); onLocal();
  });

  // 새 노트: 쪽 모양(줄·무지·수학…)을 먼저 고른다
  A.acts.noteNew = () => {
    window.Ink.pickTemplate("새 노트 · 쪽 모양 고르기", async (bg) => {
      try {
        const r = await A.api("/api/notes", { method: "POST", body: { subject: N.sid, title: "새 노트 " + A.fmtDate(A.today(), false) } });
        if (bg !== "lined") await A.api(`/api/notes/${r.id}/pages`, { method: "POST", body: { action: "set", at: 0, bg } });
        A.go(`notes/${N.sid}/${r.id}`);
        setTimeout(() => { const t = A.$("#nt-title"); if (t) t.select(); }, 400);
      } catch (e) { A.toast(e.message, "err"); }
    }, true);
  };
  async function delNote(id, title) {
    if (!(await A.confirm(`'${title}' 노트를 지울까요?`, "필기·글상자·사진이 모두 사라지고 되돌릴 수 없어요."))) return;
    try {
      if (N.sess && N.sess.id === id) { if (window.Ink) window.Ink.unmount(); endSession(); }
      await A.api("/api/notes/" + id, { method: "DELETE" });
      A.toast("노트를 지웠어요.");
      if (A.route.sub === id) A.go("notes/" + N.sid); else { await A.views.notes.load(); A.renderMain(); }
    } catch (e) { A.toast(e.message, "err"); }
  }
  A.acts.noteDel = () => delNote(N.meta.id, N.meta.title);
  A.acts.noteDelId = (el, ev) => { ev.stopPropagation(); delNote(Number(el.dataset.id), el.dataset.t); };
})();
