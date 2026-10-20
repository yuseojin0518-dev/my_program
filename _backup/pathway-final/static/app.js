/* Pathway 앱 뼈대: 상태 저장·동기화, 화면 이동, 창, 계획 다시 짜기, 공부 기록 */
(function () {
  "use strict";
  const PE = window.PE, PD = window.PD, UI = window.UI;
  const LS_STATE = "pw.state.v1", LS_CLIENT = "pw.client", LS_THEME = "pw.theme";
  const TABS = ["home", "path", "grades", "plan", "report"];

  const A = (window.App = {
    state: null, user: null, version: 0, tab: "home", rev: 0,
    views: {}, acts: {}, inputs: {}, changes: {},
    ui: { whatIf: {}, open: {}, weekOffset: 0, courseRes: null, replanInfo: null, undoPlan: null },
    serverToday: null,
  });

  // ───── 오늘 (한국 날짜). 체험 모드에선 '하루 넘기기'로 날짜를 옮길 수 있다 ─────
  function kstToday() {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  A.realToday = () => A.serverToday || kstToday();
  A.today = () => {
    const q = new URLSearchParams(location.search).get("today");
    if (q && PE.isValidYmd(q)) return q;
    if (A.state && A.state.demo && A.state.demoToday && PE.isValidYmd(A.state.demoToday)) return A.state.demoToday;
    return A.realToday();
  };

  A.major = () => (A.state && PD.MAJORS.find((m) => m.id === A.state.profile.majorId)) || null;
  A.subjects = () => PE.activeSubjects(A.state);
  A.subject = (id) => A.subjects().find((s) => s.id === id);
  A.term = () => PE.activeTerm(A.state);
  A.n = () => Number(A.state.profile.gradeSystem) || 5;

  // ───── 익명 사용 기록 (사용자 검증용) ─────
  function clientId() {
    let c = localStorage.getItem(LS_CLIENT);
    if (!c) { c = "c" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); localStorage.setItem(LS_CLIENT, c); }
    return c;
  }
  A.clientId = clientId;
  A.metric = (kind, value) => {
    try {
      fetch("/api/metrics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, value, clientId: clientId() }), keepalive: true }).catch(() => {});
    } catch (e) { /* 기록 실패는 무시 */ }
  };

  // ───── 서버 요청 ─────
  A.api = async (url, opt) => {
    opt = opt || {};
    const init = { method: opt.method || "GET", headers: {}, credentials: "same-origin" };
    if (opt.body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opt.body); }
    let r;
    try { r = await fetch(url, init); } catch (e) { const err = new Error("인터넷 연결을 확인해 주세요."); err.status = 0; throw err; }
    let data = {};
    try { data = await r.json(); } catch (e) { data = {}; }
    if (!r.ok) { const err = new Error(data.error || "문제가 생겼어요 (" + r.status + ")"); err.status = r.status; err.data = data; throw err; }
    return data;
  };

  // ───── 저장 ─────
  let pushTimer = null;
  A.syncState = "local"; // local | saving | saved | error | conflict
  A.save = (opts) => {
    A.rev++;
    try { localStorage.setItem(LS_STATE, JSON.stringify(A.state)); } catch (e) { A.toast("이 기기에 저장하지 못했어요 (저장 공간 부족)."); }
    if (A.user && !(opts && opts.local)) {
      clearTimeout(pushTimer);
      A.syncState = "saving"; paintSync();
      pushTimer = setTimeout(push, 1200);
    }
  };
  async function push(force) {
    if (!A.user) return;
    try {
      const r = await A.api("/api/state", { method: "PUT", body: { state: A.state, version: A.version, force: !!force } });
      A.version = r.version; A.syncState = "saved";
    } catch (e) {
      if (e.status === 409) { A.syncState = "conflict"; conflict(e.data); }
      else if (e.status === 401) { A.user = null; A.syncState = "local"; paintTop(); }
      else A.syncState = "error";
    }
    paintSync();
  }
  function conflict(data) {
    A.modal(`<h2>다른 기기에서 먼저 저장했어요</h2>
      <p>어느 쪽 데이터를 쓸까요?</p>
      <div class="row gap"><button class="btn" data-act="useServer">다른 기기 것 쓰기</button><button class="btn primary" data-act="useLocal">이 기기 것으로 덮기</button></div>`);
    A.acts.useServer = () => { A.state = migrate(data.state); A.version = data.version; A.save({ local: true }); A.closeModal(); A.render(); A.syncState = "saved"; paintSync(); };
    A.acts.useLocal = () => { A.version = data.version; A.closeModal(); push(true); };
  }

  function migrate(st) {
    if (!st || st.v !== 1) return null;
    st.profile = Object.assign({ gradeSystem: 5, careerWeight: true, objective: "avg", autoReplan: true, grade: 2 }, st.profile || {});
    st.availability = Object.assign({ weekday: 180, weekend: 300, overrides: {} }, st.availability || {});
    st.calendar = st.calendar || { source: "none", events: [] };
    st.calendar.events = st.calendar.events || [];
    st.log = st.log || []; st.notes = st.notes || []; st.results = st.results || []; st.planHistory = st.planHistory || []; st.taken = st.taken || [];
    st.courses = Object.assign({ alpha: 0.7, must: [], ban: [], picked: null }, st.courses || {});
    st.terms = st.terms && st.terms.length ? st.terms : [{ id: "t1", name: "이번 학기", subjects: [] }];
    if (!st.terms.find((t) => t.id === st.activeTermId)) st.activeTermId = st.terms[0].id;
    return st;
  }
  A.migrate = migrate;

  // ───── 계산 묶음 (상태가 바뀔 때만 다시) ─────
  let calcKey = null, calcVal = null;
  A.calc = () => {
    const key = A.rev + "|" + A.today();
    if (key === calcKey) return calcVal;
    const st = A.state, today = A.today(), major = A.major(), n = A.n();
    const subs = A.subjects();
    const ex = st.plan ? PE.explain(st, today, major) : { rows: [] };
    const done = PE.doneBySubject(st);
    const fut = {};
    for (const it of (st.plan && st.plan.items) || []) if (it.date >= today) fut[it.sid] = (fut[it.sid] || 0) + it.min - (it.date === today ? PE.itemDone(st, it.id) : 0);
    const planH = {}, nowH = {}, sameH = {};
    for (const s of subs) {
      planH[s.id] = (done[s.id] || 0) + Math.max(0, fut[s.id] || 0);
      nowH[s.id] = done[s.id] || 0;
      sameH[s.id] = Math.max(done[s.id] || 0, (Number(s.lastHours) || 0) * 60);
    }
    const exams = subs.map((s) => ({ s, ex: PE.nextExam(s) })).filter((x) => x.ex);
    const upcoming = exams.filter((x) => x.ex.date >= today).sort((a, b) => (a.ex.date < b.ex.date ? -1 : 1));
    const awaiting = exams.filter((x) => x.ex.date < today || (x.ex.date === today));
    const todayItems = ((st.plan && st.plan.items) || []).filter((it) => it.date === today && A.subject(it.sid));
    calcVal = {
      ex, done, planH, nowH, sameH,
      avgPlan: PE.averageGrade(subs, planH, n),
      avgNow: PE.averageGrade(subs, nowH, n),
      avgSame: PE.averageGrade(subs, sameH, n),
      upcoming, awaiting, todayItems,
      missed: PE.missed(st, today),
    };
    calcKey = key;
    return calcVal;
  };

  // ───── 계획 ─────
  A.rebuild = (reason, opts) => {
    const st = A.state, today = A.today();
    if (!A.subjects().some((s) => PE.plannable(s))) { st.plan = null; A.save(); return null; }
    const old = st.plan;
    const before = A.calc().avgPlan;
    const missed = PE.missed(st, today).min;
    const plan = PE.buildPlan(st, today, A.major(), reason || "edit");
    st.plan = plan;
    A.rev++;
    const after = A.calc().avgPlan;
    st.planHistory = (st.planHistory || []).concat([{ at: today, reason: reason || "edit", missedMin: missed, before, after }]).slice(-40);
    if (!(opts && opts.quiet)) A.ui.undoPlan = old;
    A.save();
    A.metric(reason === "missed" || reason === "replan" ? "replan" : "plan_build", missed);
    return { old, plan, missed, before, after, diff: PE.planDiff(old, plan, A.subjects(), today) };
  };

  // 입력이 바뀌면 잠깐 뒤 계획을 다시 맞춘다 (슬라이더를 움직이는 동안은 미리보기만)
  let editTimer = null;
  A.touchPlan = () => {
    A.save();
    clearTimeout(editTimer);
    editTimer = setTimeout(() => { if (A.state.plan || A.subjects().some(PE.plannable)) { A.rebuild("edit", { quiet: true }); paintAfterEdit(); } }, 700);
  };
  function paintAfterEdit() {
    if (A.tab !== "grades") A.render();
    else if (A.views.grades.refreshPreview) A.views.grades.refreshPreview();
  }

  // 날짜가 바뀌었거나 들어왔을 때: 밀린 계획이 있으면 자동으로 다시 짠다
  A.autoReplan = () => {
    const st = A.state, today = A.today();
    if (!st || !st.plan) return;
    if (!PE.needsReplan(st, today)) return;
    if (st.profile.autoReplan === false) { A.ui.replanInfo = { pending: true, missed: PE.missed(st, today).min }; return; }
    const r = A.rebuild("missed");
    if (r) A.ui.replanInfo = { missed: r.missed, diff: r.diff, before: r.before, after: r.after, auto: true };
  };

  // ───── 공부 기록 ─────
  A.logItem = (itemId, minutes) => {
    const st = A.state, today = A.today();
    const it = ((st.plan && st.plan.items) || []).find((x) => x.id === itemId);
    if (!it) return;
    st.log = st.log.filter((l) => l.itemId !== itemId);
    if (minutes > 0) st.log.push({ id: PE.newId("l"), date: it.date <= today ? (it.date < today ? today : it.date) : today, sid: it.sid, min: Math.round(minutes), itemId });
    A.save();
    A.metric("task_done", minutes);
  };
  A.toggleItem = (itemId) => {
    const st = A.state;
    const it = st.plan.items.find((x) => x.id === itemId);
    if (!it) return;
    const d = PE.itemDone(st, itemId);
    A.logItem(itemId, d >= it.min ? 0 : it.min);
    if (d < it.min) A.toast("👏 " + (A.subject(it.sid) || {}).name + " " + UI.fmtH(it.min) + " 완료!");
  };

  // ───── 창·알림 ─────
  const $ = (s, r) => (r || document).querySelector(s);
  A.$ = $;
  let lastFocus = null;
  A.modal = (html, opt) => {
    opt = opt || {};
    lastFocus = document.activeElement;
    const m = $("#modal");
    m.innerHTML = `<div class="modal-card ${opt.wide ? "wide" : ""}" role="dialog" aria-modal="true" tabindex="-1">
      <button class="icon-btn modal-x" data-act="closeModal" aria-label="닫기">✕</button>${html}</div>`;
    m.classList.add("open");
    document.body.classList.add("noscroll");
    const card = m.querySelector(".modal-card");
    const first = card.querySelector("input,select,textarea,button:not(.modal-x)");
    (first || card).focus();
  };
  A.closeModal = () => {
    F = null;
    const m = $("#modal");
    m.classList.remove("open");
    m.innerHTML = "";
    document.body.classList.remove("noscroll");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  };
  A.acts.closeModal = () => A.closeModal();

  // ───── 한 화면 한 질문 (토스 스타일 흐름) ─────
  // A.flow({ steps:[{ q, sub, key, options:[{v,label,sub,emoji}] | html(ctx) + read(root, ctx) → 오류 글/null, cta, skip }], finish(ctx) → {emoji,title,sub,cta} })
  //  · 고르는 질문은 누르면 바로 다음으로, 입력 질문은 아래에 꽉 찬 버튼 하나
  let F = null;
  A.flow = (def) => {
    lastFocus = document.activeElement;
    F = { def, i: 0, ctx: Object.assign({}, def.ctx || {}), dir: 1 };
    paintFlow();
  };
  function paintFlow() {
    const m = $("#modal");
    const { def, i, ctx } = F;
    const n = def.steps.length;
    let inner;
    if (F.done) {
      const d = F.done;
      inner = `<div class="fl-body fl-done"><div class="done-mark" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg></div>
        ${d.emoji ? `<div class="done-emoji" aria-hidden="true">${d.emoji}</div>` : ""}<h2 class="fl-q">${d.title}</h2>${d.sub ? `<p class="fl-sub">${d.sub}</p>` : ""}${d.html || ""}</div>
        <div class="fl-cta"><button class="btn primary cta" data-act="flowClose">${UI.esc(d.cta || "확인")}</button></div>`;
    } else {
      const st = def.steps[i];
      const opts = typeof st.options === "function" ? st.options(ctx) : st.options;
      const body = opts
        ? `<ul class="fl-opts">${opts.map((o, k) => `<li><button class="fl-opt ${ctx[st.key] === o.v ? "on" : ""}" data-act="flowPick" data-k="${k}">${o.emoji ? `<span class="fl-emoji" aria-hidden="true">${o.emoji}</span>` : ""}<span class="fl-txt"><b>${UI.esc(o.label)}</b>${o.sub ? `<small>${UI.esc(o.sub)}</small>` : ""}</span><span class="fl-chev" aria-hidden="true">›</span></button></li>`).join("")}</ul>`
        : st.html(ctx);
      const q = typeof st.q === "function" ? st.q(ctx) : st.q;
      const sub = typeof st.sub === "function" ? st.sub(ctx) : st.sub;
      inner = `<div class="fl-top"><button class="icon-btn" data-act="${i ? "flowBack" : "flowClose"}" aria-label="${i ? "이전" : "닫기"}">${i ? "‹" : "✕"}</button>
          <div class="fl-prog" role="progressbar" aria-valuemin="1" aria-valuemax="${n}" aria-valuenow="${i + 1}"><span style="width:${((i + 1) / n * 100).toFixed(1)}%"></span></div>
          ${st.skip ? `<button class="link" data-act="flowSkip">${UI.esc(st.skip)}</button>` : `<span class="fl-count">${i + 1}/${n}</span>`}</div>
        <div class="fl-body ${F.dir > 0 ? "in-r" : "in-l"}"><h2 class="fl-q" id="fl-q">${q}</h2>${sub ? `<p class="fl-sub">${sub}</p>` : ""}${body}<p class="fl-err" role="alert" id="fl-err"></p></div>
        ${opts ? "" : `<div class="fl-cta"><button class="btn primary cta" data-act="flowNext">${UI.esc((typeof st.cta === "function" ? st.cta(ctx) : st.cta) || (i === n - 1 ? "완료" : "다음"))}</button></div>`}`;
    }
    m.innerHTML = `<div class="modal-card flow-card" role="dialog" aria-modal="true" aria-labelledby="fl-q" tabindex="-1">${inner}</div>`;
    m.classList.add("open");
    document.body.classList.add("noscroll");
    const card = m.querySelector(".modal-card");
    const first = card.querySelector(".fl-body input, .fl-body select, .fl-body textarea");
    (first || card).focus();
    if (first && first.select) try { first.select(); } catch (e) { /* 날짜 칸 */ }
    if (F.def.steps[i] && F.def.steps[i].after) F.def.steps[i].after(card, ctx);
  }
  function flowAdvance() {
    if (F.i < F.def.steps.length - 1) { F.i++; F.dir = 1; paintFlow(); return; }
    const r = F.def.finish(F.ctx);
    if (r) { F.done = r; paintFlow(); } else A.acts.flowClose();
  }
  A.flowCtx = () => (F ? F.ctx : {});
  A.flowStep = () => (F && !F.done ? F.i : -1);
  A.flowRepaint = () => { if (F) paintFlow(); };
  A.acts.flowPick = (el) => {
    const st = F.def.steps[F.i];
    const opts = typeof st.options === "function" ? st.options(F.ctx) : st.options;
    const o = opts[Number(el.dataset.k)];
    F.ctx[st.key] = o.v;
    el.classList.add("on");
    setTimeout(flowAdvance, 140);
  };
  A.acts.flowNext = () => {
    const st = F.def.steps[F.i];
    const err = st.read ? st.read($("#modal .modal-card"), F.ctx) : null;
    if (err) { const e = $("#fl-err"); e.textContent = err; e.classList.remove("shake"); void e.offsetWidth; e.classList.add("shake"); return; }
    flowAdvance();
  };
  A.acts.flowSkip = () => { const st = F.def.steps[F.i]; if (st.onSkip) st.onSkip(F.ctx); flowAdvance(); };
  A.acts.flowBack = () => { if (F.i > 0) { F.i--; F.dir = -1; paintFlow(); } };
  A.acts.flowClose = () => { const after = F && F.done && F.def.afterDone; F = null; A.closeModal(); A.rerender(); if (after) after(); };
  document.addEventListener("keydown", (ev) => {
    if (!F || F.done || ev.key !== "Enter" || ev.target.tagName === "TEXTAREA") return;
    if (ev.target.closest && ev.target.closest(".fl-body") && ev.target.tagName === "INPUT") { ev.preventDefault(); A.acts.flowNext(); }
  });

  // 큰 숫자 입력칸 (단위가 옆에 붙는다)
  A.bigInput = (id, value, unit, attrs) => `<div class="big-in"><input id="${id}" type="number" inputmode="decimal" value="${value === null || value === undefined ? "" : value}" ${attrs || ""}><span>${UI.esc(unit || "")}</span></div>`;
  // 시간 고르기 (자주 쓰는 값은 버튼, 그 밖은 슬라이더)
  A.timeChips = (id, value, list) => `<div class="time-pick" data-id="${id}">${list.map((v) => `<button type="button" class="chip-btn ${v === value ? "on" : ""}" data-act="timePick" data-v="${v}">${UI.fmtH(v)}</button>`).join("")}</div><input type="hidden" id="${id}" value="${value}">`;
  A.acts.timePick = (el) => {
    const box = el.closest(".time-pick");
    box.querySelectorAll(".chip-btn").forEach((b) => b.classList.toggle("on", b === el));
    $("#" + box.dataset.id).value = el.dataset.v;
    const big = $("#" + box.dataset.id + "-show"); if (big) big.textContent = UI.fmtH(Number(el.dataset.v));
  };

  let toastTimer = null;
  A.toast = (msg, opt) => {
    const t = $("#toast");
    t.innerHTML = `<span>${UI.esc(msg)}</span>` + (opt && opt.action ? `<button class="toast-btn" data-act="toastAction">${UI.esc(opt.action.label)}</button>` : "");
    A.acts.toastAction = () => { t.classList.remove("show"); opt.action.fn(); };
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), opt && opt.action ? 6500 : 2600);
  };

  // ───── 화면 그리기 ─────
  function paintSync() {
    const el = $("#sync");
    if (!el) return;
    const map = { local: ["이 기기에 저장", "local"], saving: ["저장 중…", "saving"], saved: ["저장됨", "saved"], error: ["저장 실패 · 다시 시도", "error"], conflict: ["저장 충돌", "error"] };
    const [t, c] = map[A.syncState] || map.local;
    el.textContent = A.user ? t : "이 기기에 저장";
    el.className = "sync " + (A.user ? c : "local");
  }
  function paintTop() {
    const u = $("#btn-account");
    u.textContent = A.user ? A.user.nickname : "로그인";
    u.setAttribute("aria-label", A.user ? "내 계정: " + A.user.nickname : "로그인");
    const goal = $("#goal-chip");
    const m = A.state && A.major();
    goal.innerHTML = m ? `<span aria-hidden="true">${m.emoji}</span> ${UI.esc(m.name)}` : "진로 정하기";
    goal.hidden = !A.state;
    paintSync();
  }
  A.paintTop = paintTop;

  A.render = () => {
    paintTop();
    const main = $("#main");
    const nav = $("#nav");
    if (!A.state) {
      nav.hidden = true;
      document.body.classList.add("no-nav");
      main.innerHTML = A.views.start.render();
      A.views.start.after && A.views.start.after();
      return;
    }
    nav.hidden = false;
    document.body.classList.remove("no-nav");
    for (const b of nav.querySelectorAll("[data-tab]")) {
      const on = b.dataset.tab === A.tab;
      b.classList.toggle("on", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    }
    paintSide();
    const v = A.views[A.tab] || A.views.home;
    const y = window.scrollY;
    main.innerHTML = v.render();
    if (v.after) v.after();
    if (A._keepScroll) window.scrollTo(0, y);
    A._keepScroll = false;
  };
  // 넓은 화면 사이드바 아래 요약 (다음 시험, 오늘 진행, 예상 평균, 시험 순서)
  function paintSide() {
    const box = $("#side-extra");
    if (!box || !A.state) return;
    let html = "";
    try {
      const c = A.calc(), today = A.today(), st = A.state;
      const items = c.todayItems;
      const p = items.reduce((a, it) => a + it.min, 0), d = items.reduce((a, it) => a + Math.min(it.min, PE.itemDone(st, it.id)), 0);
      const next = c.upcoming[0];
      html += `<div class="side-h">요약</div>`;
      if (next) html += `<button class="side-card blue" data-act="go" data-tab="plan"><small>${UI.esc((next.ex.name || "시험").replace(/\(.*\)/, ""))}</small><b>${UI.dday(today, next.ex.date)}</b><small>${UI.fmtDate(next.ex.date)} ${UI.esc(next.s.name)}</small></button>`;
      html += `<button class="side-card" data-act="go" data-tab="home"><small>오늘 공부</small><b>${UI.fmtHShort(d)}<i> / ${UI.fmtHShort(p)}</i></b><span class="bar wide"><span style="width:${p ? Math.min(100, d / p * 100) : 0}%;background:var(--good)"></span></span></button>`;
      html += `<button class="side-card" data-act="go" data-tab="grades"><small>예상 평균등급</small><b>${UI.fmtG(c.avgPlan)}</b><small>지난번처럼이면 ${UI.fmtG(c.avgSame)}</small></button>`;
      if (c.upcoming.length) html += `<div class="side-h">시험 순서</div><ul class="side-list">${c.upcoming.slice(0, 7).map((x) => `<li><span class="dot" style="background:${UI.colorOf(st, x.s.id)}"></span><span>${UI.esc(x.s.name)}</span><small>${UI.fmtDate(x.ex.date, false)}</small></li>`).join("")}</ul>`;
    } catch (e) { html = ""; }
    box.innerHTML = html;
  }

  A.rerender = () => { A._keepScroll = true; A.render(); };

  A.go = (tab) => {
    if (!TABS.includes(tab)) tab = "home";
    if (location.hash !== "#" + tab) history.pushState(null, "", "#" + tab + location.search.replace(/^(?!\?)/, ""));
    A.tab = tab;
    A.render();
    window.scrollTo(0, 0);
    const h = $("#main h1");
    if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
  };
  A.acts.go = (el) => A.go(el.dataset.tab);
  window.addEventListener("popstate", () => { A.tab = (location.hash || "#home").slice(1).split("?")[0]; if (!TABS.includes(A.tab)) A.tab = "home"; A.render(); });

  // 이벤트는 한 곳에서 받는다
  document.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-act]");
    if (!el || el.disabled) return;
    const fn = A.acts[el.dataset.act];
    if (fn) { ev.preventDefault(); fn(el, ev); }
  });
  // 슬라이더 왼쪽(채운 부분)을 파랗게 보여 주기 (iOS 슬라이더처럼)
  function paintRange(el) {
    const min = Number(el.min || 0), max = Number(el.max || 100), v = Number(el.value);
    el.style.setProperty("--p", ((v - min) / Math.max(1e-9, max - min) * 100).toFixed(1) + "%");
  }
  A.paintRanges = (root) => (root || document).querySelectorAll("input[type=range]").forEach(paintRange);
  new MutationObserver(() => A.paintRanges()).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("input", (ev) => {
    if (ev.target.type === "range") paintRange(ev.target);
    const el = ev.target.closest("[data-in]");
    if (!el) return;
    const fn = A.inputs[el.dataset.in];
    if (fn) fn(el, ev);
  });
  document.addEventListener("change", (ev) => {
    const el = ev.target.closest("[data-ch]");
    if (!el) return;
    const fn = A.changes[el.dataset.ch];
    if (fn) fn(el, ev);
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && $("#modal").classList.contains("open")) { if (F) A.acts.flowClose(); else A.closeModal(); }
    // 카드처럼 생긴 버튼이 아닌 요소도 Enter로 누를 수 있게
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches("[data-act][role=button]")) { ev.preventDefault(); ev.target.click(); }
  });
  document.addEventListener("click", (ev) => { if (ev.target.id === "modal") { if (F) A.acts.flowClose(); else A.closeModal(); } });

  // ───── 계정 ─────
  A.acts.account = () => {
    if (A.user) {
      A.modal(`<h2>내 계정</h2><p><b>${UI.esc(A.user.nickname)}</b> (${UI.esc(A.user.username)})로 로그인했어요. 데이터는 서버에 저장되어 다른 기기에서도 이어서 쓸 수 있어요.</p>
        <div class="row gap"><button class="btn" data-act="logout">로그아웃</button><button class="btn" data-act="settings">설정</button></div>`);
      return;
    }
    authModal("login");
  };
  function authModal(mode) {
    const su = mode === "signup";
    A.modal(`<h2>${su ? "회원가입" : "로그인"}</h2>
      <p class="muted">${su ? "가입하면 지금 이 기기의 데이터를 그대로 옮겨서 서버에 저장해요." : "로그인하면 다른 기기에서도 내 계획을 이어서 볼 수 있어요."}</p>
      <form id="auth-form" class="form" novalidate>
        <label>아이디 <input name="username" autocomplete="username" required minlength="3" maxlength="20" pattern="[a-z0-9_]{3,20}" inputmode="latin" placeholder="영어 소문자·숫자 3~20자"></label>
        <label>비밀번호 <input name="password" type="password" autocomplete="${su ? "new-password" : "current-password"}" required minlength="6" maxlength="72"></label>
        ${su ? `<label>닉네임 <input name="nickname" maxlength="12" placeholder="화면에 보일 이름"></label>` : ""}
        <p class="form-err" role="alert" id="auth-err"></p>
        <button class="btn primary wide" type="submit">${su ? "가입하기" : "로그인"}</button>
      </form>
      <p class="center small">${su ? "이미 계정이 있나요?" : "처음인가요?"} <button class="link" data-act="${su ? "showLogin" : "showSignup"}">${su ? "로그인" : "회원가입"}</button></p>`);
    $("#auth-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const b = { username: (f.get("username") || "").trim().toLowerCase(), password: f.get("password") || "" };
      if (su) { b.nickname = (f.get("nickname") || "").trim(); b.state = A.state; }
      const err = $("#auth-err");
      err.textContent = "";
      try {
        const r = await A.api(su ? "/signup" : "/login", { method: "POST", body: b });
        A.user = r.user;
        A.closeModal();
        await pull(true);
        A.toast(su ? "가입했어요! 이제 서버에 저장돼요." : "어서 와요, " + A.user.nickname + "!");
        A.render();
      } catch (e) { err.textContent = e.message; }
    });
  }
  A.acts.showLogin = () => authModal("login");
  A.acts.showSignup = () => authModal("signup");
  A.acts.logout = async () => {
    try { await A.api("/logout", { method: "POST", body: {} }); } catch (e) { /* 무시 */ }
    A.user = null; A.version = 0; A.syncState = "local";
    A.closeModal(); A.toast("로그아웃했어요. 이 기기에 있는 데이터는 그대로 남아요."); A.render();
  };

  // 서버의 내 데이터 받아오기. 서버에 없으면 이 기기 것을 올린다
  async function pull(afterLogin) {
    try {
      const r = await A.api("/api/state");
      if (r.state) {
        const local = A.state;
        A.state = migrate(r.state);
        A.version = r.version;
        if (afterLogin && local && !local.demo && local !== A.state && JSON.stringify(local) !== JSON.stringify(r.state)) {
          // 서버 것을 쓰되, 이 기기 것은 되돌릴 수 있게 남겨 둔다
          localStorage.setItem(LS_STATE + ".before-login", JSON.stringify(local));
        }
        A.save({ local: true });
        A.syncState = "saved";
      } else if (A.state) {
        A.version = 0;
        await push(true);
      }
    } catch (e) { A.syncState = "error"; }
    paintSync();
  }

  // ───── 설정 ─────
  A.acts.settings = () => {
    const p = A.state ? A.state.profile : {};
    const theme = localStorage.getItem(LS_THEME) || "light";
    A.modal(`<h2>설정</h2>
      ${A.state ? `
      <div class="set-group">
        <div class="set-row"><div><b>등급 제도</b><p class="muted small">2025년 이후 입학은 5등급제, 그 전은 9등급제</p></div>
          <div class="seg" role="group" aria-label="등급 제도">
            <button class="${A.n() === 5 ? "on" : ""}" data-act="setSys" data-v="5" aria-pressed="${A.n() === 5}">5등급</button>
            <button class="${A.n() === 9 ? "on" : ""}" data-act="setSys" data-v="9" aria-pressed="${A.n() === 9}">9등급</button></div></div>
        <div class="set-row"><div><b>배분 기준</b><p class="muted small">평균등급을 최대한 낮추기 / 과목마다 정한 목표 등급 달성 확률 높이기</p></div>
          <div class="seg" role="group" aria-label="배분 기준">
            <button class="${p.objective !== "target" ? "on" : ""}" data-act="setObj" data-v="avg" aria-pressed="${p.objective !== "target"}">평균등급</button>
            <button class="${p.objective === "target" ? "on" : ""}" data-act="setObj" data-v="target" aria-pressed="${p.objective === "target"}">목표 달성</button></div></div>
        <label class="set-row"><div><b>진로 과목 더 중요하게</b><p class="muted small">희망 진로에 중요한 교과(예: AI → 수학·정보 ×1.4)에 시간을 더 줘요</p></div>
          <input type="checkbox" class="switch" data-ch="setCareer" ${p.careerWeight !== false ? "checked" : ""}></label>
        <label class="set-row"><div><b>자동 재조정</b><p class="muted small">못 한 계획이 있으면 들어올 때 남은 기간에 맞춰 바로 다시 짜요</p></div>
          <input type="checkbox" class="switch" data-ch="setAuto" ${p.autoReplan !== false ? "checked" : ""}></label>
      </div>` : ""}
      <div class="set-group">
        <div class="set-row"><div><b>화면</b></div>
          <div class="seg" role="group" aria-label="화면 밝기">
            <button class="${theme === "light" ? "on" : ""}" data-act="setTheme" data-v="light" aria-pressed="${theme === "light"}">밝게</button>
            <button class="${theme === "dark" ? "on" : ""}" data-act="setTheme" data-v="dark" aria-pressed="${theme === "dark"}">어둡게</button></div></div>
      </div>
      ${A.state ? `<div class="set-group">
        <div class="row gap wrap"><button class="btn" data-act="exportData">데이터 내려받기</button>
        <label class="btn">데이터 불러오기<input type="file" accept="application/json" hidden data-ch="importData"></label>
        <button class="btn danger" data-act="resetAll">처음부터 다시</button></div>
        <p class="muted small">${A.user ? "로그인 중이라 서버에도 저장돼요." : "로그인하지 않으면 이 기기(브라우저)에만 저장돼요."}</p>
      </div>` : ""}`);
  };
  A.acts.setSys = (el) => { A.state.profile.gradeSystem = Number(el.dataset.v); A.touchPlan(); A.acts.settings(); A.rerender(); };
  A.acts.setObj = (el) => { A.state.profile.objective = el.dataset.v; A.rebuild("edit", { quiet: true }); A.acts.settings(); A.rerender(); };
  A.changes.setCareer = (el) => { A.state.profile.careerWeight = el.checked; A.rebuild("edit", { quiet: true }); A.rerender(); };
  A.changes.setAuto = (el) => { A.state.profile.autoReplan = el.checked; A.save(); };
  A.acts.setTheme = (el) => { localStorage.setItem(LS_THEME, el.dataset.v); applyTheme(); A.acts.settings(); };
  function applyTheme() {
    const t = localStorage.getItem(LS_THEME) || "light";
    document.documentElement.dataset.theme = t;
    const meta = document.querySelector("meta[name=theme-color]");
    if (meta) meta.content = t === "dark" ? "#17171c" : "#f2f4f6";
  }
  A.acts.exportData = () => {
    const blob = new Blob([JSON.stringify(A.state, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pathway-" + A.today() + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  A.changes.importData = (el) => {
    const f = el.files && el.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const st = migrate(JSON.parse(rd.result));
        if (!st) throw new Error();
        A.state = st; A.save(); A.closeModal(); A.toast("불러왔어요."); A.go("home");
      } catch (e) { A.toast("Pathway 데이터 파일이 아니에요."); }
    };
    rd.readAsText(f);
  };
  A.acts.resetAll = () => {
    A.modal(`<h2>처음부터 다시 할까요?</h2><p>과목·성적·계획·기록이 모두 지워져요. ${A.user ? "서버에 저장된 것도 지워져요." : ""} 먼저 [데이터 내려받기]로 보관해 둘 수 있어요.</p>
      <div class="row gap"><button class="btn" data-act="closeModal">그만두기</button><button class="btn danger" data-act="resetYes">모두 지우기</button></div>`);
  };
  A.acts.resetYes = () => {
    A.state = null;
    localStorage.removeItem(LS_STATE);
    if (A.user) A.api("/api/state", { method: "PUT", body: { state: PD.emptyState(A.realToday()), version: A.version, force: true } }).then((r) => (A.version = r.version)).catch(() => {});
    A.closeModal(); A.ui = { whatIf: {}, open: {}, weekOffset: 0 }; A.tab = "home"; history.replaceState(null, "", "#home"); A.render();
  };

  // 체험 모드: 하루 넘기기 (계획을 안 지킨 날이 생기면 자동 재조정을 볼 수 있다)
  A.acts.demoNextDay = () => {
    const st = A.state;
    st.demoToday = PE.addDays(A.today(), 1);
    A.save();
    A.autoReplan();
    A.toast("하루가 지났어요: " + UI.fmtDate(A.today()));
    A.rerender();
  };
  A.acts.demoReset = () => { A.startDemo(); };
  A.startDemo = () => {
    A.state = migrate(PD.demoState(A.realToday()));
    A.ui = { whatIf: {}, open: {}, weekOffset: 0 };
    A.save();
    A.metric("demo_start", 1);
    A.autoReplan();
    A.go("home");
    // 실제 나이스 학사일정으로 바꿔 보기 (실패해도 체험 데이터 그대로)
    refreshCalendarQuiet();
  };
  async function refreshCalendarQuiet() {
    const st = A.state, sc = st.profile.school;
    if (!sc) return;
    try {
      const r = await A.api(`/api/neis/schedule?office=${encodeURIComponent(sc.office)}&school=${encodeURIComponent(sc.code)}&grade=${st.profile.grade}`);
      if (r.events && r.events.length && A.state === st && !shifted(st)) {
        st.calendar = { source: "neis", events: r.events, exams: r.exams, fetchedAt: r.fetchedAt };
        A.save(); A.rev++; A.rerender();
      }
    } catch (e) { /* 체험 데이터의 일정 그대로 */ }
  }
  function shifted(st) { return PE.daysBetween(PD.REAL_TODAY, A.realToday()) > 40 || PE.daysBetween(PD.REAL_TODAY, A.realToday()) < -10 || !st.demo; }

  // ───── 시작 ─────
  async function boot() {
    applyTheme();
    try { A.state = migrate(JSON.parse(localStorage.getItem(LS_STATE) || "null")); } catch (e) { A.state = null; }
    A.tab = (location.hash || "#home").slice(1).split("?")[0];
    if (!TABS.includes(A.tab)) A.tab = "home";
    A.render();
    try { const t = await A.api("/api/time"); A.serverToday = t.today; } catch (e) { /* 기기 시계 */ }
    try {
      const me = await A.api("/me");
      A.user = me.user;
      if (A.user) await pull(false);
    } catch (e) { /* 손님 */ }
    if (A.state) A.autoReplan();
    A.rev++;
    A.render();
    A.metric("visit", 1);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  document.addEventListener("DOMContentLoaded", boot);
})();
