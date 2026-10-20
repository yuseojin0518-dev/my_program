/* EduSpace 뼈대: 상태·서버 요청·실시간 연결·화면 이동·사이드바(급식·학사일정)·로그인·오른쪽 패널·공통 부품 */
(function () {
  "use strict";
  const A = (window.App = {
    me: null, cfg: {}, scope: null, route: { tab: "calendar" }, subjects: [], online: [],
    acts: {}, inputs: {}, changes: {}, views: {}, data: {}, clientId: "c" + Math.random().toString(36).slice(2, 12),
  });
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  A.$ = $; A.$$ = $$; A.esc = esc;

  // ───── 날짜·숫자 ─────
  A.today = () => {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  };
  const P = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  A.addDays = (s, n) => new Date(P(s) + n * 86400000).toISOString().slice(0, 10);
  A.daysBetween = (a, b) => Math.round((P(b) - P(a)) / 86400000);
  A.dow = (s) => new Date(P(s)).getUTCDay();
  A.fmtDate = (s, dow) => { if (!s) return ""; const [, m, d] = s.split("-").map(Number); return m + "/" + d + (dow === false ? "" : "(" + "일월화수목금토"[A.dow(s)] + ")"); };
  A.dday = (s) => { const k = A.daysBetween(A.today(), s); return k === 0 ? "오늘" : k > 0 ? "D-" + k : "D+" + -k; };
  A.ago = (iso) => {
    if (!iso) return "";
    const sec = (Date.now() - new Date(iso).getTime()) / 1000;
    if (sec < 50) return "방금";
    if (sec < 3600) return Math.round(sec / 60) + "분 전";
    if (sec < 86400) return Math.round(sec / 3600) + "시간 전";
    if (sec < 86400 * 2) return "어제";
    return A.fmtDate(iso.slice(0, 10));
  };
  A.size = (b) => (b < 1024 ? b + "B" : b < 1048576 ? (b / 1024).toFixed(0) + "KB" : (b / 1048576).toFixed(1) + "MB");
  A.avatar = (u, cls) => `<span class="av ${cls || ""}" style="--c:${esc((u && u.color) || "#b0b8c1")}" title="${esc((u && u.name) || "")}">${esc(((u && u.name) || "?").slice(0, 1))}</span>`;
  A.canWrite = () => !!(A.me && (A.scope === A.me.scope || A.me.role === "teacher"));
  A.isMine = (u) => !!(A.me && u && (u.id === A.me.id || A.me.role === "teacher"));
  A.scopeParts = (s) => { const m = /^(\w+)-(\d+)-(\d)-(\d+)$/.exec(s || ""); return m ? { office: m[1], school: m[2], grade: +m[3], cls: +m[4] } : null; };
  A.scopeLabel = (s) => { const p = A.scopeParts(s); return p ? `${p.grade}학년 ${p.cls}반` : ""; };

  // ───── 서버 요청 ─────
  A.api = async (url, opt) => {
    opt = opt || {};
    const init = { method: opt.method || "GET", headers: { "X-ES": "1" }, credentials: "same-origin" };
    if (opt.form) init.body = opt.form;
    else if (opt.body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opt.body); }
    let r;
    try { r = await fetch(url, init); } catch (e) { const err = new Error("인터넷 연결을 확인해 주세요."); err.status = 0; throw err; }
    let data = {};
    try { data = await r.json(); } catch (e) { data = {}; }
    if (!r.ok) {
      const err = new Error(data.error || "문제가 생겼어요 (" + r.status + ")"); err.status = r.status; err.data = data;
      if (r.status === 401 && A.me) { A.me = null; A.render(); }
      throw err;
    }
    return data;
  };
  A.safe = (p) => p.catch((e) => { A.toast(e.message, "err"); throw e; });

  // ───── 알림·창 ─────
  let toastT = 0;
  A.toast = (msg, kind) => {
    const t = $("#toast");
    t.innerHTML = `<span>${esc(msg)}</span>`;
    t.className = "show " + (kind || "");
    clearTimeout(toastT);
    toastT = setTimeout(() => (t.className = ""), 2600);
  };
  A.confirm = (title, text, okLabel) => new Promise((res) => {
    const m = $("#modal");
    m.innerHTML = `<div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t"><h2 id="dlg-t">${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ""}
      <div class="dlg-btns"><button class="btn" data-r="0">취소</button><button class="btn danger-fill" data-r="1">${esc(okLabel || "지우기")}</button></div></div>`;
    m.classList.add("open");
    m.querySelector("[data-r='1']").focus();
    m.onclick = (ev) => { const b = ev.target.closest("[data-r]"); if (b || ev.target === m) { m.classList.remove("open"); m.innerHTML = ""; m.onclick = null; res(b && b.dataset.r === "1"); } };
  });
  A.modal = (html, cls) => {
    const m = $("#modal");
    m.innerHTML = `<div class="dialog ${cls || ""}" role="dialog" aria-modal="true">${html}</div>`;
    m.classList.add("open");
    m.onclick = (ev) => { if (ev.target === m) A.closeModal(); };
    const f = m.querySelector("input,textarea,select,button"); if (f) f.focus();
  };
  A.closeModal = () => { const m = $("#modal"); m.classList.remove("open"); m.innerHTML = ""; };
  A.acts.closeModal = () => A.closeModal();

  // 오른쪽 상세 패널 (페이지를 옮기지 않고 부드럽게 열림)
  const D = (A.drawer = { key: null, render: null, after: null, editing: false });
  D.open = (key, render, after) => {
    D.key = key; D.render = render; D.after = after; D.editing = false;
    D.lastFocus = document.activeElement;
    D.paint();
    $("#drawer").classList.add("open");
    $("#scrim").classList.add("open");
    document.body.classList.add("drawer-open");
    setTimeout(() => { const h = $("#drawer h2"); if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); } }, 50);
  };
  D.paint = () => { const el = $("#drawer-body"); if (!el || !D.render) return; el.innerHTML = D.render(); if (D.after) D.after(el); };
  D.close = () => {
    D.key = null; D.render = null; D.editing = false;
    $("#drawer").classList.remove("open"); $("#scrim").classList.remove("open");
    document.body.classList.remove("drawer-open");
    if (D.lastFocus && D.lastFocus.focus) D.lastFocus.focus();
  };
  A.acts.closeDrawer = () => D.close();

  // 사진 크게 보기
  A.acts.lightbox = (el) => {
    const lb = $("#lightbox");
    lb.innerHTML = `<img src="${esc(el.dataset.src)}" alt="${esc(el.dataset.alt || "첨부 사진")}"><button class="lb-x" aria-label="닫기">✕</button>`;
    lb.classList.add("open");
    lb.onclick = () => { lb.classList.remove("open"); lb.innerHTML = ""; };
  };

  // ───── 이벤트는 한 곳에서 받는다 ─────
  document.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-act]");
    if (!el || el.disabled) return;
    const fn = A.acts[el.dataset.act];
    if (fn) { ev.preventDefault(); fn(el, ev); }
  });
  document.addEventListener("input", (ev) => { const el = ev.target.closest("[data-in]"); if (el && A.inputs[el.dataset.in]) A.inputs[el.dataset.in](el, ev); });
  document.addEventListener("change", (ev) => { const el = ev.target.closest("[data-ch]"); if (el && A.changes[el.dataset.ch]) A.changes[el.dataset.ch](el, ev); });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      if ($("#lightbox").classList.contains("open")) { $("#lightbox").click(); return; }
      if ($("#modal").classList.contains("open")) { A.closeModal(); return; }
      if ($(".switcher-pop")) { closeSwitcher(); return; }
      if (D.key) D.close();
    }
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches("[data-act][role=button]")) { ev.preventDefault(); ev.target.click(); }
  });

  // ───── 실시간 연결 (웹소켓, 안 되면 4초마다 묻기) ─────
  const RT = (A.rt = { ws: null, ok: false, tries: 0, pulse: null, noteHandler: null });
  RT.connect = () => {
    if (!A.me || !A.me.scope) return;
    try { RT.ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws"); }
    catch (e) { RT.fail(); return; }
    const ws = RT.ws;
    ws.onopen = () => { RT.ok = true; RT.tries = 0; RT.send({ type: "join", scope: A.scope }); if (RT.onOpen) RT.onOpen(); paintLive(); };
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } RT.dispatch(m); };
    ws.onclose = () => { if (RT.ws !== ws) return; RT.ok = false; paintLive(); RT.fail(); };
    ws.onerror = () => {};
  };
  RT.fail = () => {
    RT.tries++;
    setTimeout(() => { if (!RT.ok && A.me) RT.connect(); }, Math.min(10000, 800 * RT.tries));
  };
  RT.send = (m) => { if (RT.ok && RT.ws && RT.ws.readyState === 1) { RT.ws.send(JSON.stringify(m)); return true; } return false; };
  RT.dispatch = (m) => {
    if (m.type === "changed") A.onChanged(m.kind, m.id, m.by);
    else if (m.type === "online") { A.online = m.users; paintOnline(); }
    else if (["op", "note_state", "resync", "presence", "ink_live", "ink_add", "ink_del", "ink_meta"].includes(m.type) && RT.noteHandler) RT.noteHandler(m);
    else if (m.type === "error" && m.msg) A.toast(m.msg, "err");
  };
  RT.join = () => RT.send({ type: "join", scope: A.scope });
  // 웹소켓이 안 될 때: 4초마다 '무엇이 바뀌었나' 묻기
  let lastPulse = null;
  setInterval(async () => {
    if (!A.me || !A.scope || RT.ok || document.hidden) return;
    try {
      const r = await A.api("/api/pulse?scope=" + encodeURIComponent(A.scope));
      A.online = r.online; paintOnline();
      if (lastPulse && lastPulse.scope === A.scope) for (const k of Object.keys(r.pulse)) if (r.pulse[k] !== lastPulse.p[k]) A.onChanged(k, null, null);
      lastPulse = { scope: A.scope, p: r.pulse };
    } catch (e) { /* 다음에 다시 */ }
  }, 4000);

  // 다른 사람이 바꾼 것을 화면에 반영
  A.onChanged = (kind, id, by) => {
    const v = A.views[A.route.tab];
    if (v && v.onChanged) v.onChanged(kind, id, by);
    if (["subjects", "docs", "notes"].includes(kind)) { A.subjectsStale = true; if (!A.route.sid) A.loadSubjects().then(() => { if (!A.route.sid && !["calendar", "class"].includes(A.route.tab)) A.renderMain(); }); }
    if (kind === "events" || kind === "classroom") A.loadClassWeek().then(paintWidgets);
    if (kind === "study" && A.route.tab !== "study" && A.loadStudy && by && A.me && by.id === A.me.id) A.loadStudy().catch(() => {});
    if (D.key && D.onChanged) D.onChanged(kind, id, by);
    if (by && A.me && by.id !== A.me.id && ["events", "classroom", "docs"].includes(kind) && typeof id === "number") {
      const what = { events: "달력 일정", classroom: "클래스룸", docs: "문서" }[kind];
      A.activity(`${by.name}${/님$/.test(by.name) ? "" : "님"}이 ${what}을(를) 바꿨어요`);
    }
  };
  let actT = 0;
  A.activity = (msg) => {
    const el = $("#activity"); if (!el) return;
    el.textContent = msg; el.classList.add("show");
    clearTimeout(actT); actT = setTimeout(() => el.classList.remove("show"), 3000);
  };

  // ───── 화면 이동 (#/calendar, #/padlet/과목/주제, #/docs/과목, #/notes/과목/노트) ─────
  const TABS = { calendar: "공유 달력", class: "클래스룸", docs: "공유 문서함", notes: "공유 노트", study: "공부 타이머" };
  A.TABS = TABS;
  function parseHash() {
    const p = (location.hash || "#/calendar").replace(/^#\/?/, "").split("/");
    const tab = TABS[p[0]] ? p[0] : "calendar";
    return { tab, sid: p[1] ? Number(p[1]) || null : null, sub: p[2] ? Number(p[2]) || null : null };
  }
  A.go = (path) => { if (location.hash !== "#/" + path) location.hash = "#/" + path; else A.onRoute(); };
  A.acts.go = (el) => { closeMenu(); A.go(el.dataset.to); };
  A.onRoute = () => {
    const prev = A.route;
    A.route = parseHash();
    if (prev.tab === "notes" && (A.route.tab !== "notes" || A.route.sub !== prev.sub) && A.views.notes.leave) A.views.notes.leave();
    if (D.key) D.close();
    paintNav();
    A.renderMain(true);
    window.scrollTo(0, 0);
  };
  window.addEventListener("hashchange", A.onRoute);

  A.renderMain = async (fresh) => {
    const v = A.views[A.route.tab];
    const main = $("#main");
    if (!main || !v) return;
    if (fresh) main.innerHTML = `<div class="loading" aria-busy="true"><span></span><span></span><span></span></div>`;
    try { if (v.load) await v.load(fresh); } catch (e) { main.innerHTML = `<div class="empty-state"><p>${esc(e.message)}</p><button class="btn" data-act="go" data-to="${A.route.tab}">다시 시도</button></div>`; return; }
    const y = window.scrollY;
    main.innerHTML = (A.canWrite() ? "" : readonlyBanner()) + v.render();
    if (v.after) v.after(main);
    if (!fresh) window.scrollTo(0, y);
  };
  function readonlyBanner() {
    return `<div class="ro-banner" role="status"><span>👀 <b>${esc(A.scopeLabel(A.scope))}</b>을(를) 보고 있어요 · 보기만 할 수 있어요</span><button class="btn small" data-act="myClass">내 반으로 돌아가기</button></div>`;
  }

  // ───── 과목 (패들렛·문서함·노트 공통 첫 화면) ─────
  A.loadSubjects = async () => {
    const r = await A.api("/api/subjects?scope=" + encodeURIComponent(A.scope));
    A.subjects = r.subjects; A.subjectsStale = false;
    return A.subjects;
  };
  A.subject = (id) => A.subjects.find((s) => s.id === id);
  const TAB_COUNT = { class: ["work", "개의 과제"], docs: ["docs", "개의 문서"], notes: ["notes", "개의 노트"] };
  A.subjectGrid = (tab, title, desc) => {
    const [k, unit] = TAB_COUNT[tab];
    return `<header class="page-h"><div><p class="eyebrow">${esc(A.scopeLabel(A.scope))} · ${esc(A.me.schoolName)}</p><h1>${esc(title)}</h1><p class="page-sub">${esc(desc)}</p></div></header>
      <div class="subj-grid">${A.subjects.map((s, i) => `<button class="subj-card" style="--c:${esc(s.color)};--i:${i}" data-act="go" data-to="${tab}/${s.id}">
        <span class="sc-ico" aria-hidden="true">${esc(s.icon)}</span><b>${esc(s.name)}</b><small>${esc(s.description || "")}</small>
        <span class="sc-n">${s.counts[k]}${unit}</span></button>`).join("")}
        ${A.canWrite() ? `<button class="subj-card add" data-act="subjectAdd"><span class="sc-ico" aria-hidden="true">＋</span><b>과목 추가</b><small>동아리·방과후·선택 과목도 만들 수 있어요</small></button>` : ""}
      </div>`;
  };
  A.subjectHead = (tab, s, extra) => `<nav class="crumb" aria-label="위치"><button class="link back" data-act="go" data-to="${tab}">← 과목 목록으로</button><span>${esc(TABS[tab])}</span><span>›</span><b>${esc(s.name)}</b></nav>
    <div class="subj-tabs" role="tablist" aria-label="과목 빠르게 바꾸기">${A.subjects.map((x) => `<button role="tab" aria-selected="${x.id === s.id}" class="st ${x.id === s.id ? "on" : ""}" style="--c:${esc(x.color)}" data-act="go" data-to="${tab}/${x.id}">${esc(x.icon)} ${esc(x.name)}</button>`).join("")}</div>
    <header class="page-h"><div class="ph-title"><span class="ph-ico" style="--c:${esc(s.color)}" aria-hidden="true">${esc(s.icon)}</span><div><h1>${esc(s.name)}</h1><p class="page-sub">${esc(s.description || TABS[tab])}</p></div></div>${extra || ""}</header>`;

  const ICONS = ["📘", "📖", "📐", "🔤", "🏯", "🌏", "🔬", "💻", "🎨", "🎵", "⚽", "🧪", "🌱", "📊", "🗣️", "💡", "🎬", "🧭"];
  const SCOLORS = ["#3182f6", "#f472b6", "#8b5cf6", "#15c47e", "#fe9800", "#06b6d4", "#6366f1", "#a16207", "#f04452", "#84cc16"];
  A.acts.subjectAdd = () => {
    A.modal(`<h2>과목 추가</h2>
      <label class="fld">과목 이름<input id="sa-name" maxlength="20" placeholder="예: 미적분Ⅰ, 방송부"></label>
      <label class="fld">한 줄 설명<input id="sa-desc" maxlength="60" placeholder="예: 3교시 · 김OO 선생님"></label>
      <div class="fld"><span>아이콘</span><div class="pick" id="sa-ico">${ICONS.map((x, i) => `<button type="button" class="pk ${i === 0 ? "on" : ""}" data-act="pick" data-v="${x}">${x}</button>`).join("")}</div></div>
      <div class="fld"><span>색</span><div class="pick" id="sa-col">${SCOLORS.map((x, i) => `<button type="button" class="pk dot ${i === 0 ? "on" : ""}" style="--c:${x}" data-act="pick" data-v="${x}" aria-label="색 ${i + 1}"></button>`).join("")}</div></div>
      <div class="dlg-btns"><button class="btn" data-act="closeModal">취소</button><button class="btn primary" data-act="subjectAddYes">만들기</button></div>`);
  };
  A.acts.pick = (el) => { $$(".pk", el.parentNode).forEach((b) => b.classList.toggle("on", b === el)); };
  A.acts.subjectAddYes = async () => {
    const pickV = (id) => { const b = $(`#${id} .pk.on`); return b ? b.dataset.v : ""; };
    try {
      await A.api("/api/subjects", { method: "POST", body: { scope: A.scope, name: $("#sa-name").value, description: $("#sa-desc").value, icon: pickV("sa-ico"), color: pickV("sa-col") } });
      A.closeModal(); await A.loadSubjects(); A.renderMain(); A.toast("과목을 만들었어요.");
    } catch (e) { A.toast(e.message, "err"); }
  };

  // ───── 첨부 (사진·파일 올리기) ─────
  const ACCEPT = ".pdf,.hwp,.hwpx,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.csv,.png,.jpg,.jpeg,.gif,.webp,.zip";
  A.ACCEPT = ACCEPT;
  A.upload = async (file) => {
    if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name}: 10MB까지 올릴 수 있어요.`);
    const fd = new FormData(); fd.append("scope", A.scope); fd.append("file", file);
    return A.api("/api/upload", { method: "POST", form: fd });
  };
  const FT = { pdf: "📕", hwp: "📘", hwpx: "📘", doc: "📘", docx: "📘", ppt: "📙", pptx: "📙", xls: "📗", xlsx: "📗", csv: "📗", txt: "📄", md: "📄", zip: "🗜️" };
  A.fileIcon = (t) => FT[t] || (["png", "jpg", "jpeg", "gif", "webp"].includes(t) ? "🖼️" : "📎");
  A.gallery = (imgs) => (imgs && imgs.length ? `<div class="gallery">${imgs.map((m) => `<button class="g-img" data-act="lightbox" data-src="${esc(m.url)}" data-alt="${esc(m.name)}"><img src="${esc(m.url)}" alt="${esc(m.name)}" loading="lazy"></button>`).join("")}</div>` : "");
  A.fileList = (atts) => (atts && atts.length ? `<ul class="files">${atts.map((f) => `<li><span class="f-ico" aria-hidden="true">${A.fileIcon(f.type)}</span><span class="f-name">${esc(f.name)}<small>${A.size(f.size)}</small></span>
      ${["pdf", "txt", "md", "csv", "png", "jpg", "jpeg", "gif", "webp"].includes(f.type) ? `<a class="btn small" href="${esc(f.url)}" target="_blank" rel="noopener">열기</a>` : ""}<a class="btn small" href="${esc(f.url)}?dl=1" download>받기</a></li>`).join("")}</ul>` : "");
  // 편집 폼 안의 첨부 고르기: state = {images:[meta], attachments:[meta]}
  A.attachEditor = (st) => `<div class="att-ed">
      <div class="att-row">${st.images.map((m, i) => `<span class="att-th"><img src="${esc(m.url)}" alt=""><button type="button" data-act="attDel" data-k="images" data-i="${i}" aria-label="사진 빼기">✕</button></span>`).join("")}
        <label class="att-add"><input type="file" accept="image/*" multiple hidden data-ch="attPick" data-k="images">＋ 사진</label></div>
      <ul class="files edit">${st.attachments.map((f, i) => `<li><span class="f-ico">${A.fileIcon(f.type)}</span><span class="f-name">${esc(f.name)}<small>${A.size(f.size)}</small></span><button type="button" class="link" data-act="attDel" data-k="attachments" data-i="${i}">빼기</button></li>`).join("")}</ul>
      <label class="btn small att-file"><input type="file" accept="${ACCEPT}" multiple hidden data-ch="attPick" data-k="attachments">📎 파일 첨부 (PDF·한글·PPT 등)</label>
      <p class="hint" id="att-msg"></p></div>`;
  A.changes.attPick = async (el) => {
    const st = A.attState; if (!st) return;
    const files = Array.from(el.files || []);
    const msg = $("#att-msg");
    for (const f of files) {
      if (msg) msg.textContent = `${f.name} 올리는 중…`;
      try { const m = await A.upload(f); st[el.dataset.k].push(m); }
      catch (e) { A.toast(e.message, "err"); }
    }
    if (msg) msg.textContent = "";
    if (A.attRepaint) A.attRepaint();
  };
  A.acts.attDel = (el) => { const st = A.attState; st[el.dataset.k].splice(Number(el.dataset.i), 1); if (A.attRepaint) A.attRepaint(); };

  // ───── 댓글 (일정·카드·문서 공통) ─────
  A.comments = { target: null, list: [] };
  A.loadComments = async (target) => { const r = await A.api("/api/comments?target=" + encodeURIComponent(target)); A.comments = { target, list: r.comments }; return r.comments; };
  A.commentsHtml = () => {
    const c = A.comments;
    return `<section class="cmts" aria-label="댓글"><h3>댓글 ${c.list.length}</h3>
      <ul>${c.list.map((x) => `<li>${A.avatar(x.author)}<div class="cm-b"><p><b>${esc(x.author.name)}</b><small>${A.ago(x.createdAt)}</small>${A.isMine(x.author) && A.canWrite() ? `<button class="link small" data-act="cmtDel" data-id="${x.id}">지우기</button>` : ""}</p><div>${esc(x.text)}</div></div></li>`).join("") || `<li class="muted">첫 댓글을 남겨 보세요.</li>`}</ul>
      ${A.canWrite() ? `<form class="cm-form" id="cm-form"><input id="cm-text" maxlength="500" placeholder="댓글 달기" aria-label="댓글"><button class="btn primary small" type="submit">등록</button></form>` : ""}</section>`;
  };
  document.addEventListener("submit", async (ev) => {
    if (ev.target.id !== "cm-form") return;
    ev.preventDefault();
    const inp = $("#cm-text"), text = inp.value.trim();
    if (!text) return;
    try { await A.api("/api/comments", { method: "POST", body: { target: A.comments.target, text } }); inp.value = ""; await A.loadComments(A.comments.target); paintComments(); }
    catch (e) { A.toast(e.message, "err"); }
  });
  A.acts.cmtDel = async (el) => { try { await A.api("/api/comments/" + el.dataset.id, { method: "DELETE" }); await A.loadComments(A.comments.target); paintComments(); } catch (e) { A.toast(e.message, "err"); } };
  function paintComments() {
    const box = $("#drawer .cmts");
    if (!box) return;
    const typed = $("#cm-text") ? $("#cm-text").value : "";
    box.outerHTML = A.commentsHtml();
    if (typed && $("#cm-text")) $("#cm-text").value = typed;
    const ul = $("#drawer .cmts ul"); if (ul) ul.lastElementChild && ul.lastElementChild.scrollIntoView({ block: "nearest" });
  }
  A.paintComments = paintComments;

  // ───── 간단한 마크다운 (글자로만 표시: HTML은 모두 막는다) ─────
  A.md = (src) => {
    const lines = esc(src || "").split("\n");
    let out = "", list = null;
    const inline = (s) => s.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*]+)\*/g, "$1<i>$2</i>");
    const close = () => { if (list) { out += `</${list}>`; list = null; } };
    for (const ln of lines) {
      let m;
      if ((m = /^(#{1,3})\s+(.*)$/.exec(ln))) { close(); out += `<h${m[1].length + 2}>${inline(m[2])}</h${m[1].length + 2}>`; }
      else if ((m = /^\s*[-*]\s+\[( |x)\]\s*(.*)$/i.exec(ln))) { if (list !== "ul") { close(); out += `<ul class="chk">`; list = "ul"; } out += `<li class="${m[1].trim() ? "done" : ""}"><span class="cb">${m[1].trim() ? "✓" : ""}</span>${inline(m[2])}</li>`; }
      else if ((m = /^\s*[-*]\s+(.*)$/.exec(ln))) { if (list !== "ul") { close(); out += "<ul>"; list = "ul"; } out += `<li>${inline(m[1])}</li>`; }
      else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(ln))) { if (list !== "ol") { close(); out += "<ol>"; list = "ol"; } out += `<li>${inline(m[1])}</li>`; }
      else if (/^&gt;\s?/.test(ln)) { close(); out += `<blockquote>${inline(ln.replace(/^&gt;\s?/, ""))}</blockquote>`; }
      else if (!ln.trim()) { close(); out += `<div class="sp"></div>`; }
      else { close(); out += `<p>${inline(ln)}</p>`; }
    }
    close();
    return out;
  };

  // ───── 사이드바 (프로필·반 바꾸기·메뉴·접속자·급식·이번 주 학사일정) ─────
  const NAV = [["calendar", "📅", "공유 달력"], ["class", "🏫", "클래스룸"], ["docs", "📁", "공유 문서함"], ["notes", "📝", "공유 노트"], ["study", "⏱️", "공부 타이머"]];
  function shell() {
    $("#app").innerHTML = `
      <header id="mtop"><button class="icon-btn" data-act="menu" aria-label="메뉴 열기">☰</button><button class="mt-class" data-act="switcher">${esc(A.scopeLabel(A.scope))} ▾</button><span id="live-m" class="live"></span></header>
      <div id="menu-scrim" data-act="menu"></div>
      <aside id="side" aria-label="사이드바">
        <div class="brand"><span class="logo" aria-hidden="true">${logo(30)}</span><b>EduSpace</b><span id="live" class="live"></span></div>
        <div id="side-profile"></div>
        <nav class="nav" id="nav" aria-label="주요 메뉴">${NAV.map(([k, ic, n]) => `<button data-act="go" data-to="${k}" data-tab="${k}"><span aria-hidden="true">${ic}</span>${n}</button>`).join("")}</nav>
        <div id="side-timer"></div>
        <div id="side-online"></div>
        <div id="widgets"></div>
      </aside>
      <main id="main" tabindex="-1"></main>
      <nav id="bnav" aria-label="주요 메뉴">${NAV.map(([k, ic, n]) => `<button data-act="go" data-to="${k}" data-tab="${k}"><span aria-hidden="true">${ic}</span><b>${n.replace("공유 ", "").replace("공부 ", "")}</b></button>`).join("")}</nav>
      <div id="scrim" data-act="closeDrawer"></div>
      <aside id="drawer" aria-label="상세 보기" role="dialog"><div id="drawer-body"></div></aside>
      <div id="activity" role="status" aria-live="polite"></div>`;
    paintProfile(); paintNav(); paintOnline(); paintWidgets(); paintLive();
  }
  function logo(s) {
    return `<svg width="${s}" height="${s}" viewBox="0 0 48 48"><rect width="48" height="48" rx="14" fill="#3182f6"/><rect x="11" y="12" width="12" height="12" rx="4" fill="#fff"/><rect x="25" y="12" width="12" height="12" rx="4" fill="#fff" opacity=".65"/><rect x="11" y="26" width="12" height="12" rx="4" fill="#fff" opacity=".65"/><circle cx="31" cy="32" r="6" fill="#fff"/></svg>`;
  }
  A.logo = logo;
  function paintProfile() {
    const el = $("#side-profile"); if (!el) return;
    const m = A.me;
    el.innerHTML = `<div class="profile">${A.avatar(m, "lg")}<div><b>${esc(m.name)}${m.role === "teacher" ? ` <span class="tag">선생님</span>` : ""}</b><small>${esc(m.schoolName)}</small></div>
        <button class="icon-btn" data-act="account" aria-label="내 계정">⋯</button></div>
      <button class="class-switch" data-act="switcher" aria-haspopup="true"><span><small>지금 보는 반</small><b>${esc(A.scopeLabel(A.scope))}</b></span>${A.scope !== m.scope ? `<span class="tag ro">보기만</span>` : `<span class="tag mine">내 반</span>`}<span aria-hidden="true">▾</span></button>`;
    const mc = $(".mt-class"); if (mc) mc.textContent = A.scopeLabel(A.scope) + " ▾";
  }
  function paintNav() { $$("[data-tab]").forEach((b) => { const on = b.dataset.tab === A.route.tab; b.classList.toggle("on", on); if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); }); }
  function paintOnline() {
    const el = $("#side-online"); if (!el) return;
    const us = A.online || [];
    el.innerHTML = `<div class="online"><span class="dot-live"></span><b>지금 접속 ${us.length}명</b><span class="av-stack">${us.slice(0, 6).map((u) => A.avatar(u, "sm")).join("")}${us.length > 6 ? `<span class="av sm more">+${us.length - 6}</span>` : ""}</span></div>`;
    const v = A.views[A.route.tab]; if (v && v.onOnline) v.onOnline();
  }
  function paintLive() {
    for (const id of ["#live", "#live-m"]) { const el = $(id); if (el) { el.className = "live " + (RT.ok ? "on" : "off"); el.title = RT.ok ? "실시간 연결됨" : "연결 중… (잠깐 동안은 몇 초마다 새로 고침)"; el.textContent = RT.ok ? "실시간" : "연결 중"; } }
  }

  // 반 바꾸기
  function closeSwitcher() { const p = $(".switcher-pop"); if (p) p.remove(); }
  A.acts.switcher = (el) => {
    if ($(".switcher-pop")) return closeSwitcher();
    const cur = A.scopeParts(A.scope), mine = A.scopeParts(A.me.scope);
    const pop = document.createElement("div");
    pop.className = "switcher-pop"; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "반 바꾸기");
    pop.innerHTML = `<p class="sp-h">${esc(A.me.schoolName)}</p>
      <div class="seg" role="group" aria-label="학년">${[1, 2, 3].map((g) => `<button class="${cur.grade === g ? "on" : ""}" data-act="swGrade" data-g="${g}">${g}학년</button>`).join("")}</div>
      <div class="cls-grid" id="sw-cls">${clsButtons(cur.grade, cur.cls, mine)}</div>
      ${A.scope !== A.me.scope ? `<button class="btn primary wide" data-act="myClass">내 반(${mine.grade}학년 ${mine.cls}반)으로</button>` : `<p class="hint">다른 반은 보기만 할 수 있어요. 내 반을 바꾸려면 ⋯ › 내 반 바꾸기</p>`}`;
    document.body.appendChild(pop);
    const r = el.getBoundingClientRect();
    pop.style.top = Math.min(window.innerHeight - pop.offsetHeight - 10, r.bottom + 8) + "px";
    pop.style.left = Math.max(10, Math.min(window.innerWidth - pop.offsetWidth - 10, r.left)) + "px";
    pop.dataset.g = cur.grade;
    setTimeout(() => document.addEventListener("click", outside), 0);
    function outside(ev) { if (!ev.target.closest(".switcher-pop")) { closeSwitcher(); document.removeEventListener("click", outside); } }
  };
  function clsButtons(g, sel, mine) {
    return Array.from({ length: 12 }, (_, i) => i + 1).map((c) => `<button class="${c === sel && A.scopeParts(A.scope).grade === g ? "on" : ""} ${g === mine.grade && c === mine.cls ? "mine" : ""}" data-act="swClass" data-c="${c}">${c}반</button>`).join("");
  }
  A.acts.swGrade = (el) => {
    const pop = $(".switcher-pop"); pop.dataset.g = el.dataset.g;
    $$(".seg button", pop).forEach((b) => b.classList.toggle("on", b === el));
    $("#sw-cls").innerHTML = clsButtons(Number(el.dataset.g), 0, A.scopeParts(A.me.scope));
  };
  A.acts.swClass = (el) => {
    const pop = $(".switcher-pop"), p = A.scopeParts(A.me.scope);
    A.setScope(`${p.office}-${p.school}-${pop.dataset.g}-${el.dataset.c}`);
    closeSwitcher();
  };
  A.acts.myClass = () => { closeSwitcher(); A.setScope(A.me.scope); };
  A.setScope = async (scope) => {
    if (scope === A.scope) return;
    if (A.views.notes.leave) A.views.notes.leave();
    A.scope = scope;
    sessionStorage.setItem("es.scope", scope);
    A.data = {};
    RT.join();
    paintProfile();
    await A.loadSubjects();
    A.loadWidgets();
    A.toast(`${A.scopeLabel(scope)}${scope === A.me.scope ? "(내 반)" : ""}으로 바꿨어요.`);
    if (A.route.sid) A.go(A.route.tab); else A.renderMain(true);
  };

  // 휴대폰 메뉴
  function closeMenu() { document.body.classList.remove("menu-open"); }
  A.acts.menu = () => document.body.classList.toggle("menu-open");

  // 내 계정
  A.acts.account = () => {
    const m = A.me, p = A.scopeParts(m.scope);
    A.modal(`<h2>내 계정</h2><div class="acc">${A.avatar(m, "lg")}<div><b>${esc(m.name)}</b><small>${esc(m.schoolName)} · ${p.grade}학년 ${p.cls}반${m.role === "teacher" ? " · 선생님" : ""}${m.email ? " · " + esc(m.email) : ""}</small></div></div>
      <label class="fld">이름<input id="ac-name" maxlength="12" value="${esc(m.name)}"></label>
      <div class="row2"><label class="fld">내 학년<select id="ac-g">${[1, 2, 3].map((g) => `<option ${g === p.grade ? "selected" : ""}>${g}</option>`).join("")}</select></label>
      <label class="fld">내 반<select id="ac-c">${Array.from({ length: 15 }, (_, i) => `<option ${i + 1 === p.cls ? "selected" : ""}>${i + 1}</option>`).join("")}</select></label></div>
      ${m.demo ? `<p class="hint">체험 계정이에요. 로그아웃하면 이 계정으로 다시 들어올 수 없어요.</p>` : ""}
      <div class="dlg-btns"><button class="btn" data-act="logout">로그아웃</button><button class="btn primary" data-act="accSave">저장</button></div>`);
  };
  A.acts.accSave = async () => {
    try {
      const r = await A.api("/api/me", { method: "PATCH", body: { name: $("#ac-name").value, grade: Number($("#ac-g").value), classNum: Number($("#ac-c").value) } });
      const moved = r.user.scope !== A.me.scope;
      A.me = r.user; A.closeModal();
      if (moved) { A.scope = null; await A.setScope(A.me.scope); } else paintProfile();
      A.toast("저장했어요.");
    } catch (e) { A.toast(e.message, "err"); }
  };
  A.acts.logout = async () => {
    try { await A.api("/api/logout", { method: "POST", body: {} }); } catch (e) { /* 무시 */ }
    A.closeModal(); A.me = null; if (RT.ws) { const w = RT.ws; RT.ws = null; w.close(); } RT.ok = false; sessionStorage.removeItem("es.scope"); A.render();
  };

  // ───── 위젯: 오늘의 급식 · 이번 주 학사일정 ─────
  const W = (A.w = { meals: null, mealSrc: "", allergy: {}, mealDay: null, kind: "중식", sched: null, schedSrc: "", classWeek: [] });
  A.loadWidgets = async () => {
    const p = A.scopeParts(A.scope), t = A.today();
    const mon = A.addDays(t, -((A.dow(t) + 6) % 7));
    W.mealDay = W.mealDay || t;
    const q = `office=${p.office}&school=${p.school}`;
    await Promise.all([
      A.api(`/api/neis/meal?${q}&from=${mon}&days=14`).then((r) => { W.meals = r.meals; W.mealSrc = r.source; W.allergy = r.allergy; }).catch(() => { W.meals = []; }),
      A.api(`/api/neis/schedule?${q}&grade=${p.grade}&from=${mon}&to=${A.addDays(mon, 41)}`).then((r) => { W.sched = r.events; W.schedSrc = r.source; }).catch(() => { W.sched = []; }),
      A.loadClassWeek(),
    ]);
    paintWidgets();
  };
  A.loadClassWeek = async () => {
    const t = A.today();
    try { const r = await A.api(`/api/events?scope=${encodeURIComponent(A.scope)}&from=${t}&to=${A.addDays(t, 7)}`); W.classWeek = r.events; } catch (e) { W.classWeek = []; }
    try { W.due = (await A.api(`/api/class/due?scope=${encodeURIComponent(A.scope)}&from=${t}&to=${A.addDays(t, 7)}`)).due; } catch (e) { W.due = []; }
  };
  A.mealCard = () => {
    if (!W.meals) return `<section class="wcard"><h3>🍚 오늘의 급식</h3><p class="muted small">불러오는 중…</p></section>`;
    const d = W.mealDay, kinds = W.meals.filter((m) => m.date === d);
    const k = kinds.find((m) => m.kind === W.kind) || kinds[0];
    const next = W.meals.find((m) => m.date > d);
    return `<section class="wcard meal-card" aria-label="급식">
      <div class="wc-h"><h3>🍚 ${d === A.today() ? "오늘의" : esc(A.fmtDate(d))} 급식</h3>
        <span class="wc-nav"><button class="icon-btn sm" data-act="mealDay" data-d="-1" aria-label="전날">‹</button><button class="icon-btn sm" data-act="mealDay" data-d="1" aria-label="다음 날">›</button></span></div>
      <div class="seg sm" role="tablist" aria-label="급식 종류">${["중식", "석식"].map((x) => `<button role="tab" aria-selected="${W.kind === x}" class="${W.kind === x ? "on" : ""}" data-act="mealKind" data-k="${x}">${x}</button>`).join("")}</div>
      ${k && k.kind === W.kind ? `<ul class="menu">${k.dishes.map((x) => `<li><span>${esc(x.name)}</span>${x.allergy.length ? `<small title="${esc(x.allergy.map((n) => W.allergy[n]).join(", "))}">${x.allergy.join(".")}</small>` : ""}</li>`).join("")}</ul>
        <p class="wc-f"><b>${esc(k.cal)}</b>${W.mealSrc === "sample" ? ` · <span class="tag">예시</span>` : " · 나이스"}<button class="link small" data-act="allergy">알레르기 번호</button></p>`
        : `<p class="muted small empty-meal">${kinds.length ? W.kind + " 정보가 없어요." : "이 날은 급식이 없어요."}</p>${next && !kinds.length ? `<button class="link small" data-act="mealGo" data-d="${next.date}">다음 급식 ${esc(A.fmtDate(next.date))} 보기 ›</button>` : ""}`}
    </section>`;
  };
  A.acts.mealDay = (el) => { W.mealDay = A.addDays(W.mealDay, Number(el.dataset.d)); paintWidgets(); };
  A.acts.mealGo = (el) => { W.mealDay = el.dataset.d; paintWidgets(); };
  A.acts.mealKind = (el) => { W.kind = el.dataset.k; paintWidgets(); };
  A.acts.allergy = () => A.modal(`<h2>알레르기 번호</h2><p class="muted">메뉴 옆 숫자는 들어간 알레르기 유발 식품이에요 (식품의약품안전처 기준).</p>
    <div class="allergy">${Object.entries(W.allergy).map(([n, v]) => `<span><b>${n}</b>${esc(v)}</span>`).join("")}</div><div class="dlg-btns"><button class="btn primary" data-act="closeModal">확인</button></div>`);
  A.weekCard = () => {
    const t = A.today(), end = A.addDays(t, 7);
    const list = [];
    const named = new Set();
    for (const e of W.sched || []) {
      if (e.date < t || e.date > end || named.has(e.name)) continue; // 여러 날 이어지는 일정(시험·방학)은 첫날만
      named.add(e.name);
      list.push({ date: e.date, name: e.name, neis: true, type: e.type });
    }
    for (const e of W.classWeek || []) if (e.date >= t && e.date <= end) list.push({ date: e.date, name: e.title, neis: false, type: e.category, id: e.id });
    for (const x of W.due || []) if (x.status !== "submitted" && x.status !== "late" && x.status !== "returned") list.push({ date: x.due.slice(0, 10), name: `${x.icon} ${x.title}`, neis: false, type: "due", due: x });
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.neis ? -1 : 1));
    const seen = new Set(), rows = list.filter((x) => { const k = x.date + x.name; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 7);
    const nextExam = (W.sched || []).find((e) => e.type === "exam" && e.date >= t);
    return `<section class="wcard" aria-label="이번 주 학사일정"><div class="wc-h"><h3>🗓️ 이번 주 일정</h3>${nextExam ? `<span class="dd">${esc(nextExam.name.replace(/\(.*\)/, ""))} ${A.dday(nextExam.date)}</span>` : ""}</div>
      ${rows.length ? `<ul class="wk">${rows.map((x) => `<li ${x.due ? `data-act="go" data-to="class/${x.due.subjectId}/${x.due.id}" role="button" tabindex="0"` : x.id ? `data-act="openEvent" data-id="${x.id}" role="button" tabindex="0"` : ""}><span class="wk-d ${A.dow(x.date) === 0 || x.type === "holiday" ? "red" : ""}">${esc(A.fmtDate(x.date))}</span><span class="wk-n"><i class="cat-dot ${x.neis ? "neis" : esc(x.type)}"></i>${esc(x.name)}</span></li>`).join("")}</ul>`
        : `<p class="muted small">이번 주엔 일정이 없어요.</p>`}
      ${W.schedSrc === "sample" ? `<p class="wc-f"><span class="tag">예시</span> 나이스에 연결되지 않아 예시 학사일정을 보여요</p>` : ""}</section>`;
  };
  function paintWidgets() { const el = $("#widgets"); if (el) el.innerHTML = A.mealCard() + A.weekCard(); const m = $("#m-widgets"); if (m) m.innerHTML = A.mealCard(); }
  A.paintWidgets = paintWidgets;

  // ───── 로그인 (한 화면에 질문 하나) ─────
  const L = (A.login = { step: "start", name: "", role: "student", code: "", q: "", schools: [], school: null, grade: 2, cls: 1, err: "", google: false });
  function loginView() {
    const steps = { start: startScreen, name: qName, role: qRole, code: qCode, school: qSchool, grade: qGrade, cls: qClass };
    $("#app").innerHTML = `<div class="login">${(steps[L.step] || startScreen)()}</div>`;
    const f = $(".login input"); if (f) f.focus();
  }
  function startScreen() {
    const err = /err=google/.test(location.search) ? `<p class="err">구글 로그인을 하지 못했어요.</p>` : "";
    return `<section class="hero">
      <div class="hero-l"><span class="logo-xl" aria-hidden="true">${logo(64)}</span><p class="eyebrow">나이스 학사 데이터 + 실시간 학급 협업</p>
        <h1>우리 반의 모든 것이<br><span class="blue">한 화면에.</span></h1>
        <p class="lead">학교 공식 학사일정과 급식은 나이스에서 자동으로, 수행평가 마감·모둠 과제는 반 친구들과 함께 적는 공유 달력. 과제를 내고 채점하는 클래스룸, 문서함, 펜으로도 함께 쓰는 노트까지.</p>
        <div class="cta"><button class="btn primary big" data-act="loginDemo">체험 반으로 바로 들어가기</button><button class="btn big tinted" data-act="loginStart">우리 학교로 시작하기</button></div>
        <button class="link demo-t" data-act="loginDemo" data-role="teacher">🧑‍🏫 체험 선생님으로 들어가기 (과제 내기·채점해 보기)</button>
        ${A.cfg.google ? `<a class="btn big google" href="/auth/google"><span aria-hidden="true">G</span> 구글로 로그인</a>` : `<p class="hint">구글 로그인은 관리자가 키를 넣으면 켜져요.</p>`}${err}</div>
      <div class="hero-r" aria-hidden="true">
        <div class="mock"><div class="mk-side"><div class="mk-p"></div><div class="mk-n on"></div><div class="mk-n"></div><div class="mk-n"></div><div class="mk-n"></div><div class="mk-w"><b>🍚 오늘의 급식</b><i></i><i></i><i></i></div></div>
          <div class="mk-main"><div class="mk-h"></div><div class="mk-cal">${Array.from({ length: 35 }, (_, i) => `<span>${[3, 9, 12, 17, 24].includes(i) ? `<em class="c${i % 4}"></em>` : ""}${[10, 11, 12, 13].includes(i) ? `<em class="neis"></em>` : ""}</span>`).join("")}</div></div></div>
        <div class="feat">${[["📅", "공유 달력", "나이스 학사일정 + 우리 반 일정"], ["🏫", "클래스룸", "과제 제출·채점·반환"], ["📁", "문서함", "태그·버전·미리보기"], ["📝", "공유 노트", "여럿이 동시에 타이핑"]].map(([i, t, s]) => `<div><span>${i}</span><b>${t}</b><small>${s}</small></div>`).join("")}</div>
      </div></section>`;
  }
  const qWrap = (title, sub, body, cta, back) => `<section class="q"><div class="q-top"><button class="icon-btn" data-act="loginBack" aria-label="이전">‹</button><div class="q-prog"><span style="width:${progress()}%"></span></div></div>
    <h1 class="q-t">${title}</h1>${sub ? `<p class="q-s">${sub}</p>` : ""}${body}${L.err ? `<p class="err" role="alert">${esc(L.err)}</p>` : ""}
    ${cta ? `<div class="q-cta"><button class="btn primary cta" data-act="loginNext">${esc(cta)}</button></div>` : ""}</section>`;
  const ORDER = () => (A.loginNeedsSetup ? ["school", "grade", "cls"] : ["name", "role"].concat(L.role === "teacher" ? ["code"] : []).concat(["school", "grade", "cls"]));
  const progress = () => { const o = ORDER(); return ((o.indexOf(L.step) + 1) / o.length) * 100; };
  const qName = () => qWrap("이름이 뭐예요?", "반 친구들에게 보일 이름이에요.", `<input class="big-in" id="lg-name" maxlength="12" value="${esc(L.name)}" placeholder="예: 김지민" autocomplete="nickname">`, "다음");
  const qRole = () => qWrap("학생인가요,<br>선생님인가요?", "", `<ul class="opts"><li><button class="opt" data-act="loginRole" data-v="student"><span>🎒</span><b>학생</b><small>내 반에 일정·글·파일을 올려요</small></button></li>
    <li><button class="opt" data-act="loginRole" data-v="teacher" ${A.cfg.teacherEnabled ? "" : "disabled"}><span>🧑‍🏫</span><b>선생님</b><small>${A.cfg.teacherEnabled ? "학교의 모든 반에 쓰고 지울 수 있어요 (교사 코드 필요)" : "관리자가 교사 코드를 설정하면 켜져요"}</small></button></li></ul>`);
  const qCode = () => qWrap("교사 코드를 넣어 주세요", "학교 관리자에게 받은 코드예요.", `<input class="big-in" id="lg-code" type="password" maxlength="40" autocomplete="off">`, "다음");
  const qSchool = () => qWrap("어느 학교예요?", "나이스에서 찾아요. 학사일정과 급식을 자동으로 불러올게요.", `<input class="big-in" id="lg-q" data-in="loginQ" value="${esc(L.q)}" placeholder="학교 이름 (예: 춘천고)" autocomplete="off"><ul class="opts" id="lg-res">${schoolOpts()}</ul>`);
  function schoolOpts() {
    if (L.searching) return `<li class="muted">찾는 중…</li>`;
    return L.schools.map((s, i) => `<li><button class="opt" data-act="loginSchool" data-i="${i}"><span>🏫</span><b>${esc(s.name)}</b><small>${esc(s.region)} · ${esc(s.address)}</small></button></li>`).join("") + (L.q.length >= 2 && !L.schools.length ? `<li class="muted">찾은 학교가 없어요.</li>` : "") + (L.sample ? `<li class="muted small">나이스에 연결되지 않아 예시 학교를 보여요.</li>` : "");
  }
  const qGrade = () => qWrap("몇 학년이에요?", esc(L.school.name), `<ul class="opts">${[1, 2, 3].map((g) => `<li><button class="opt" data-act="loginGrade" data-v="${g}"><span>${["🌱", "🌿", "🌳"][g - 1]}</span><b>${g}학년</b></button></li>`).join("")}</ul>`);
  const qClass = () => qWrap("몇 반이에요?", `${esc(L.school.name)} ${L.grade}학년`, `<div class="cls-big">${Array.from({ length: 15 }, (_, i) => `<button class="${L.cls === i + 1 ? "on" : ""}" data-act="loginClass" data-v="${i + 1}">${i + 1}반</button>`).join("")}</div>`, "시작하기");

  A.acts.loginStart = () => { L.step = A.loginNeedsSetup ? "school" : "name"; L.err = ""; loginView(); };
  A.acts.loginBack = () => { const o = ORDER(), i = o.indexOf(L.step); L.err = ""; L.step = i > 0 ? o[i - 1] : "start"; loginView(); };
  function nextStep() { const o = ORDER(); L.step = o[o.indexOf(L.step) + 1]; L.err = ""; loginView(); }
  A.acts.loginNext = () => {
    if (L.step === "name") { L.name = $("#lg-name").value.trim(); if (!L.name) { L.err = "이름을 써 주세요."; return loginView(); } return nextStep(); }
    if (L.step === "code") { L.code = $("#lg-code").value; if (!L.code) { L.err = "코드를 넣어 주세요."; return loginView(); } return nextStep(); }
    if (L.step === "cls") return finishLogin();
  };
  document.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.closest && ev.target.closest(".login .big-in") && ev.target.id !== "lg-q") { ev.preventDefault(); A.acts.loginNext(); } });
  A.acts.loginRole = (el) => { L.role = el.dataset.v; nextStep(); };
  let qT = 0;
  A.inputs.loginQ = (el) => {
    L.q = el.value.trim(); clearTimeout(qT);
    if (L.q.length < 2) { L.schools = []; $("#lg-res").innerHTML = ""; return; }
    qT = setTimeout(async () => {
      L.searching = true; $("#lg-res").innerHTML = schoolOpts();
      try { const r = await A.api("/api/neis/schools?q=" + encodeURIComponent(L.q)); L.schools = r.schools; L.sample = r.source === "sample"; } catch (e) { L.schools = []; }
      L.searching = false; const box = $("#lg-res"); if (box) box.innerHTML = schoolOpts();
    }, 300);
  };
  A.acts.loginSchool = (el) => { L.school = L.schools[Number(el.dataset.i)]; nextStep(); };
  A.acts.loginGrade = (el) => { L.grade = Number(el.dataset.v); nextStep(); };
  A.acts.loginClass = (el) => { L.cls = Number(el.dataset.v); $$(".cls-big button").forEach((b) => b.classList.toggle("on", b === el)); };
  async function finishLogin() {
    const body = { name: L.name, role: L.role, teacherCode: L.code, school: L.school, grade: L.grade, classNum: L.cls };
    try {
      const r = await A.api(A.loginNeedsSetup ? "/api/me/setup" : "/api/login/quick", { method: "POST", body });
      A.cfg = r; A.me = r.user; A.loginNeedsSetup = false; L.step = "start"; A.render();
      A.toast(`${A.me.name}님, 어서 와요! 🎉`);
    } catch (e) { L.err = e.message; loginView(); }
  }
  A.acts.loginDemo = async (el) => {
    const label = el.textContent;
    el.disabled = true; el.textContent = "체험 반을 준비하는 중…";
    try { const r = await A.api("/api/login/demo", { method: "POST", body: { role: el.dataset.role || "student" } }); A.cfg = r; A.me = r.user; A.render(); A.toast("춘천고 2학년 1반 체험 반이에요. 마음껏 눌러 보세요!"); }
    catch (e) { A.toast(e.message, "err"); el.disabled = false; el.textContent = label; }
  };

  // ───── 시작 ─────
  A.render = async () => {
    if (!A.me) { L.step = "start"; return loginView(); }
    if (!A.me.scope) { A.loginNeedsSetup = true; if (L.step === "start" || L.step === "name") L.step = "school"; L.name = A.me.name; return loginView(); }
    const saved = sessionStorage.getItem("es.scope");
    A.scope = saved && A.scopeParts(saved) && A.scopeParts(saved).school === A.scopeParts(A.me.scope).school ? saved : A.me.scope;
    A.route = parseHash();
    shell();
    if (!RT.ws) RT.connect(); else RT.join();
    await A.loadSubjects().catch(() => {});
    A.renderMain(true);
    A.loadWidgets();
    if (A.loadStudy) A.loadStudy().catch(() => {});
  };
  A.boot = async () => {
    try { const r = await A.api("/api/me"); A.cfg = r; A.me = r.user; } catch (e) { A.me = null; }
    A.render();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  };
})();
