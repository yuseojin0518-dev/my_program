/* 공유 달력: 나이스 학교 공식 학사일정(고정) + 우리 반 공유 일정(누구나 추가·수정, 실시간) */
(function () {
  "use strict";
  const A = window.App, esc = A.esc, D = A.drawer;
  const CAT = {
    neis: { label: "학교 공식", ico: "🏫" }, exam: { label: "시험", ico: "✏️" }, performance: { label: "수행평가", ico: "📝" },
    assignment: { label: "과제", ico: "📚" }, event: { label: "행사", ico: "🎉" },
  };
  A.CAT = CAT;
  const C = (A.cal = { month: null, sel: null, layers: { neis: true, cls: true }, events: [], neis: [], neisSrc: "", neisCache: {} });

  function gridRange(month) {
    const first = month + "-01";
    const start = A.addDays(first, -A.dow(first));
    return [start, A.addDays(start, 41)];
  }

  A.views.calendar = {
    async load() {
      const t = A.today();
      C.month = C.month || t.slice(0, 7);
      C.sel = C.sel || t;
      const [from, to] = gridRange(C.month);
      const p = A.scopeParts(A.scope);
      const key = `${p.office}-${p.school}-${p.grade}-${from}`;
      const evP = A.api(`/api/events?scope=${encodeURIComponent(A.scope)}&from=${from}&to=${to}`);
      const dueP = A.api(`/api/class/due?scope=${encodeURIComponent(A.scope)}&from=${from}&to=${to}`).catch(() => ({ due: [] }));
      const nP = C.neisCache[key] ? Promise.resolve(C.neisCache[key]) : A.api(`/api/neis/schedule?office=${p.office}&school=${p.school}&grade=${p.grade}&from=${from}&to=${to}`).catch(() => ({ events: [], source: "error" }));
      const [ev, ne, du] = await Promise.all([evP, nP, dueP]);
      C.due = du.due;
      C.neisCache[key] = ne;
      C.events = ev.events; C.neis = ne.events; C.neisSrc = ne.source;
    },
    render() {
      const [from] = gridRange(C.month);
      const t = A.today(), [y, m] = C.month.split("-").map(Number);
      let cells = "";
      for (let i = 0; i < 42; i++) {
        const d = A.addDays(from, i);
        const items = dayItems(d);
        const hol = items.some((x) => x.neis && x.type === "holiday");
        const out = d.slice(0, 7) !== C.month;
        cells += `<div class="cell ${out ? "out" : ""} ${d === t ? "today" : ""} ${d === C.sel ? "sel" : ""}" role="gridcell" aria-selected="${d === C.sel}">
          <button class="cell-hit" data-act="calSel" data-d="${d}" aria-label="${A.fmtDate(d)} · 일정 ${items.length}개"></button>
          <span class="dn ${A.dow(d) === 0 || hol ? "red" : A.dow(d) === 6 ? "blue-d" : ""}">${Number(d.slice(8))}</span>
          <div class="chips">${items.slice(0, 3).map(chip).join("")}${items.length > 3 ? `<span class="more">+${items.length - 3}</span>` : ""}</div>
          <span class="dots">${items.slice(0, 4).map((x) => `<i class="cat-dot ${x.neis ? "neis" : x.category}"></i>`).join("")}</span>
          ${A.canWrite() ? `<button class="cell-add" data-act="newEvent" data-d="${d}" aria-label="${A.fmtDate(d)}에 일정 추가">＋</button>` : ""}
        </div>`;
      }
      const sel = dayItems(C.sel);
      return `<header class="page-h"><div><p class="eyebrow">${esc(A.me.schoolName)} · ${esc(A.scopeLabel(A.scope))}</p><h1>공유 달력</h1>
          <p class="page-sub">파란 일정은 나이스 학교 공식 일정(고칠 수 없어요), 나머지는 우리 반이 함께 적는 일정이에요.</p></div>
          ${A.canWrite() ? `<button class="btn primary" data-act="newEvent" data-d="${C.sel}">＋ 일정 추가</button>` : ""}</header>
        <div class="m-only" id="m-widgets">${A.mealCard()}</div>
        <div class="cal-wrap">
          <section class="card cal" aria-label="${y}년 ${m}월 달력">
            <div class="cal-h"><h2>${y}년 ${m}월</h2>
              <div class="row"><button class="icon-btn" data-act="calMove" data-d="-1" aria-label="지난달">‹</button><button class="btn small" data-act="calToday">오늘</button><button class="icon-btn" data-act="calMove" data-d="1" aria-label="다음 달">›</button></div></div>
            <div class="legend">${[["neis", "학교 공식"], ["exam", "시험"], ["performance", "수행평가"], ["assignment", "과제"], ["event", "행사"], ["due", "클래스룸 마감"]].map(([k, l]) => `<span><i class="cat-dot ${k}"></i>${l}</span>`).join("")}
              <span class="sp-f"></span>
              <label class="tgl"><input type="checkbox" data-ch="layer" data-k="neis" ${C.layers.neis ? "checked" : ""}> 학교 공식</label>
              <label class="tgl"><input type="checkbox" data-ch="layer" data-k="cls" ${C.layers.cls ? "checked" : ""}> 우리 반</label></div>
            <div class="grid-h" aria-hidden="true">${"일월화수목금토".split("").map((x, i) => `<span class="${i === 0 ? "red" : i === 6 ? "blue-d" : ""}">${x}</span>`).join("")}</div>
            <div class="grid" role="grid">${cells}</div>
            ${C.neisSrc === "sample" ? `<p class="hint"><span class="tag">예시</span> 나이스에 연결되지 않아 예시 학사일정을 보여요.</p>` : ""}
          </section>
          <aside class="cal-side">
            <section class="card day">
              <div class="cal-h"><h2>${esc(A.fmtDate(C.sel))}<small>${C.sel === t ? " 오늘" : " · " + A.dday(C.sel)}</small></h2>${A.canWrite() ? `<button class="btn small tinted" data-act="newEvent" data-d="${C.sel}">＋ 추가</button>` : ""}</div>
              ${sel.length ? `<ul class="ev-list">${sel.map(row).join("")}</ul>` : `<div class="empty-mini"><span>🗓️</span><p>이 날은 일정이 없어요.</p></div>`}
            </section>
            <section class="card up"><h2>다가오는 일정</h2>${upcoming()}</section>
          </aside>
        </div>`;
    },
    onChanged(kind, id) {
      if (kind === "events" || kind === "classroom") A.views.calendar.load().then(() => { if (A.route.tab === "calendar") { const y = window.scrollY; A.renderMain(); window.scrollTo(0, y); } });
    },
  };

  function dayItems(d) {
    const out = [];
    if (C.layers.neis) {
      const seen = new Set();
      C.neis.forEach((e, i) => { if (e.date === d && !seen.has(e.name)) { seen.add(e.name); out.push({ neis: true, i, title: e.name, type: e.type }); } });
    }
    if (C.layers.cls) for (const e of C.events) if (e.date <= d && (e.endDate || e.date) >= d) out.push(Object.assign({ neis: false }, e));
    if (C.layers.cls) for (const x of C.due || []) if (x.due.slice(0, 10) === d) out.push({ neis: false, due: x, category: "due", title: `${x.icon} ${x.title}` });
    return out;
  }
  function chip(x) {
    if (x.due) return `<button class="chip due ${doneDue(x.due) ? "done" : ""}" data-act="go" data-to="class/${x.due.subjectId}/${x.due.id}" title="${esc(x.title)} 마감">${esc(x.title)}</button>`;
    if (x.neis) return `<button class="chip neis ${x.type === "holiday" ? "hol" : ""}" data-act="openNeis" data-i="${x.i}" title="${esc(x.title)}">${esc(x.title)}</button>`;
    return `<button class="chip ${esc(x.category)}" data-act="openEvent" data-id="${x.id}" title="${esc(x.title)}">${esc(x.title)}</button>`;
  }
  const doneDue = (d) => ["submitted", "late", "returned"].includes(d.status);
  function row(x) {
    if (x.due) return `<li><button class="ev-row" data-act="go" data-to="class/${x.due.subjectId}/${x.due.id}"><i class="cat-dot due"></i><span class="er-m"><b>${esc(x.title)}</b><small>🏫 클래스룸 ${x.due.kind === "question" ? "질문" : "과제"} · ${esc(x.due.subject)} · ${esc(x.due.due.slice(11, 16))} 마감${x.due.points ? ` · ${x.due.points}점` : ""}</small></span>${x.due.status ? `<span class="badge ${doneDue(x.due) ? "event" : "performance"}">${doneDue(x.due) ? "냄" : x.due.status === "missing" ? "안 냄" : "할 일"}</span>` : ""}</button></li>`;
    if (x.neis) return `<li><button class="ev-row" data-act="openNeis" data-i="${x.i}"><i class="cat-dot neis"></i><span class="er-m"><b>${esc(x.title)}</b><small>🏫 학교 공식 · 나이스</small></span><span class="badge neis">고정</span></button></li>`;
    return `<li><button class="ev-row" data-act="openEvent" data-id="${x.id}"><i class="cat-dot ${esc(x.category)}"></i><span class="er-m"><b>${esc(x.title)}</b>
      <small>${CAT[x.category].label}${x.endDate ? ` · ~${A.fmtDate(x.endDate)}` : ""}${x.attachments.length + x.images.length ? ` · 📎${x.attachments.length + x.images.length}` : ""}${x.comments ? ` · 💬${x.comments}` : ""}</small></span>${A.avatar(x.updatedBy, "sm")}</button></li>`;
  }
  function upcoming() {
    const t = A.today(), end = A.addDays(t, 30);
    const list = [];
    const seen = new Set();
    if (C.layers.neis) C.neis.forEach((e, i) => { if (e.date >= t && e.date <= end && e.type !== "holiday" && !seen.has(e.name)) { seen.add(e.name); list.push({ neis: true, i, title: e.name, date: e.date, type: e.type }); } });
    if (C.layers.cls) for (const e of C.events) if (e.date >= t && e.date <= end) list.push(Object.assign({ neis: false }, e));
    if (C.layers.cls) for (const x of C.due || []) if (x.due.slice(0, 10) >= t && x.due.slice(0, 10) <= end && !doneDue(x)) list.push({ dueItem: x, title: `${x.icon} ${x.title}`, date: x.due.slice(0, 10) });
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!list.length) return `<p class="muted small">30일 안에 일정이 없어요.</p>`;
    return `<ul class="up-list">${list.slice(0, 8).map((x) => `<li><button ${x.dueItem ? `data-act="go" data-to="class/${x.dueItem.subjectId}/${x.dueItem.id}"` : `data-act="${x.neis ? "openNeis" : "openEvent"}" ${x.neis ? `data-i="${x.i}"` : `data-id="${x.id}"`}`}>
      <span class="ud ${A.daysBetween(t, x.date) <= 3 ? "soon" : ""}">${A.dday(x.date)}</span><span class="um"><b>${esc(x.title)}</b><small>${esc(A.fmtDate(x.date))} · ${x.dueItem ? "클래스룸 마감" : x.neis ? "학교 공식" : CAT[x.category].label}</small></span></button></li>`).join("")}</ul>`;
  }

  A.acts.calSel = (el) => { C.sel = el.dataset.d; const y = window.scrollY; A.renderMain(); window.scrollTo(0, y); if (window.innerWidth < 900) { const d = A.$(".card.day"); if (d) d.scrollIntoView({ behavior: "smooth", block: "start" }); } };
  A.acts.calMove = (el) => {
    const [y, m] = C.month.split("-").map(Number);
    const n = new Date(Date.UTC(y, m - 1 + Number(el.dataset.d), 1));
    C.month = n.toISOString().slice(0, 7);
    C.sel = C.month === A.today().slice(0, 7) ? A.today() : C.month + "-01";
    A.renderMain(true);
  };
  A.acts.calToday = () => { C.month = A.today().slice(0, 7); C.sel = A.today(); A.renderMain(true); };
  A.changes.layer = (el) => { C.layers[el.dataset.k] = el.checked; A.renderMain(); };

  // ───── 상세 패널 ─────
  A.acts.openNeis = (el) => {
    const e = C.neis[Number(el.dataset.i)];
    if (!e) return;
    const days = C.neis.filter((x) => x.name === e.name).map((x) => x.date);
    D.onChanged = null;
    D.open("neis", () => `<div class="dr-top"><span class="badge neis">🏫 학교 공식 학사일정</span><button class="icon-btn" data-act="closeDrawer" aria-label="닫기">✕</button></div>
      <h2 class="dr-title">${esc(e.name)}</h2>
      <p class="dr-date">${days.length > 1 ? `${esc(A.fmtDate(days[0]))} ~ ${esc(A.fmtDate(days[days.length - 1]))} · ${days.length}일` : esc(A.fmtDate(e.date))} · ${A.dday(days[0])}</p>
      <div class="info-box">${{ exam: "✏️ 지필고사 기간이에요. 시험 범위·수행평가 일정을 우리 반 일정으로 함께 적어 두면 좋아요.", holiday: "🏖️ 쉬는 날(휴업일·공휴일)이에요.", mock: "📝 전국연합학력평가(모의고사) 날이에요.", event: "📌 학교 행사예요." }[e.type] || ""}</div>
      <p class="muted small">${C.neisSrc === "sample" ? "예시 학사일정이에요 (나이스 연결 안 됨)." : "나이스 교육정보 개방 포털의 학교 공식 일정이라 여기서는 고칠 수 없어요."}</p>
      ${A.canWrite() ? `<button class="btn tinted wide" data-act="newEvent" data-d="${e.date}" data-title="${esc(e.name.replace(/\(.*\)/, ""))} 준비">＋ 이 날 우리 반 일정 추가</button>` : ""}`);
  };

  A.acts.openEvent = async (el) => {
    const id = Number(el.dataset.id);
    try {
      const [ev] = await Promise.all([A.api("/api/events/" + id), A.loadComments("event:" + id)]);
      showEvent(ev);
    } catch (e) { A.toast(e.message, "err"); }
  };
  function showEvent(ev, notice) {
    D.onChanged = async (kind, id) => {
      if (kind === "comments" && id === "event:" + ev.id) { await A.loadComments("event:" + ev.id); A.paintComments(); }
      if (kind === "events" && id === ev.id) {
        if (D.editing) { const n = A.$("#dr-notice"); if (n) n.innerHTML = `<div class="notice">✏️ 다른 친구가 방금 이 일정을 고쳤어요. 저장하면 내 내용으로 바뀌어요.</div>`; return; }
        try { const fresh = await A.api("/api/events/" + ev.id); showEvent(fresh, true); } catch (e) { D.close(); A.toast("이 일정이 지워졌어요."); }
      }
    };
    const render = () => `<div class="dr-top"><span class="badge ${esc(ev.category)}">${CAT[ev.category].ico} ${CAT[ev.category].label}</span><span class="sp-f"></span>
        ${A.canWrite() ? `<button class="btn small" data-act="editEvent">수정</button>` : ""}${A.canWrite() && A.isMine(ev.createdBy) ? `<button class="btn small danger" data-act="delEvent">삭제</button>` : ""}
        <button class="icon-btn" data-act="closeDrawer" aria-label="닫기">✕</button></div>
      ${notice ? `<div class="notice live-n">🔄 방금 다른 친구가 고친 내용으로 바뀌었어요.</div>` : ""}
      <h2 class="dr-title">${esc(ev.title)}</h2>
      <p class="dr-date">📅 ${esc(A.fmtDate(ev.date))}${ev.endDate ? ` ~ ${esc(A.fmtDate(ev.endDate))}` : ""} · ${A.dday(ev.date)}</p>
      ${ev.description ? `<div class="md">${A.md(ev.description)}</div>` : `<p class="muted">설명이 없어요.</p>`}
      ${ev.images.length ? `<h3>사진 ${ev.images.length}</h3>${A.gallery(ev.images)}` : ""}
      ${ev.attachments.length ? `<h3>첨부 파일 ${ev.attachments.length}</h3>${A.fileList(ev.attachments)}` : ""}
      <p class="edited">${A.avatar(ev.updatedBy, "sm")}<span><b>${esc(ev.updatedBy.name)}</b>님이 ${A.ago(ev.updatedAt)} 마지막으로 고쳤어요${ev.createdBy.id !== ev.updatedBy.id ? ` · 처음 만든 사람 ${esc(ev.createdBy.name)}` : ""}</span></p>
      ${A.commentsHtml()}`;
    A.cur = ev;
    if (D.key === "event:" + ev.id) { D.render = render; D.paint(); }
    else D.open("event:" + ev.id, render);
  }
  A.acts.editEvent = () => eventForm(A.cur);
  A.acts.newEvent = (el) => eventForm(null, el.dataset.d || C.sel || A.today(), el.dataset.title);
  A.acts.delEvent = async () => {
    if (!(await A.confirm("이 일정을 지울까요?", "댓글과 첨부도 함께 사라져요."))) return;
    try { await A.api("/api/events/" + A.cur.id, { method: "DELETE" }); D.close(); A.toast("지웠어요."); A.views.calendar.onChanged("events"); }
    catch (e) { A.toast(e.message, "err"); }
  };

  function eventForm(ev, date, title) {
    const st = { images: ev ? ev.images.slice() : [], attachments: ev ? ev.attachments.slice() : [] };
    A.attState = st;
    A.attRepaint = () => { const b = A.$("#att-box"); if (b) b.innerHTML = A.attachEditor(st); };
    const cat = ev ? ev.category : "performance";
    const render = () => `<div class="dr-top"><b>${ev ? "일정 고치기" : "새 일정"}</b><span class="sp-f"></span><button class="icon-btn" data-act="${ev ? "cancelEdit" : "closeDrawer"}" aria-label="닫기">✕</button></div>
      <div id="dr-notice"></div>
      <form id="ev-form" class="form">
        <label class="fld">제목<input id="ef-title" maxlength="60" required value="${esc(ev ? ev.title : title || "")}" placeholder="예: 통합과학 실험 보고서 제출"></label>
        <div class="fld"><span>종류</span><div class="seg wide" role="radiogroup">${["performance", "assignment", "exam", "event"].map((k) => `<button type="button" role="radio" aria-checked="${k === cat}" class="${k === cat ? "on" : ""}" data-act="efCat" data-v="${k}"><i class="cat-dot ${k}"></i>${CAT[k].label}</button>`).join("")}</div></div>
        <div class="row2"><label class="fld">날짜<input type="date" id="ef-date" required value="${esc(ev ? ev.date : date)}"></label>
          <label class="fld">끝나는 날 <small class="muted">(선택)</small><input type="date" id="ef-end" value="${esc(ev && ev.endDate ? ev.endDate : "")}"></label></div>
        <label class="fld">설명 <small class="muted">**굵게**, - 목록 을 쓸 수 있어요</small><textarea id="ef-desc" rows="6" maxlength="5000" placeholder="준비물, 범위, 제출 방법 등">${esc(ev ? ev.description : "")}</textarea></label>
        <div class="fld"><span>사진·첨부 파일</span><div id="att-box">${A.attachEditor(st)}</div></div>
        <div class="form-btns"><button type="button" class="btn" data-act="${ev ? "cancelEdit" : "closeDrawer"}">취소</button><button class="btn primary" type="submit">${ev ? "저장" : "추가"}</button></div>
      </form>`;
    if (ev) { D.editing = true; D.render = render; D.paint(); }
    else { D.onChanged = null; D.open("new-event", render); D.editing = true; }
    A.efCat = cat;
  }
  A.acts.efCat = (el) => { A.efCat = el.dataset.v; A.$$("[data-act=efCat]").forEach((b) => { b.classList.toggle("on", b === el); b.setAttribute("aria-checked", b === el); }); };
  A.acts.cancelEdit = () => { D.editing = false; showEvent(A.cur); };
  document.addEventListener("submit", async (ev) => {
    if (ev.target.id !== "ev-form") return;
    ev.preventDefault();
    const st = A.attState;
    const body = { scope: A.scope, title: A.$("#ef-title").value, category: A.efCat, date: A.$("#ef-date").value, endDate: A.$("#ef-end").value || null,
      description: A.$("#ef-desc").value, images: st.images.map((m) => m.id), attachments: st.attachments.map((m) => m.id) };
    const editing = D.key && D.key.startsWith("event:") && A.cur;
    try {
      const r = await A.api(editing ? "/api/events/" + A.cur.id : "/api/events", { method: editing ? "PATCH" : "POST", body });
      D.editing = false;
      await A.loadComments("event:" + r.id);
      C.sel = r.date; C.month = r.date.slice(0, 7);
      showEvent(r);
      if (!editing) D.key = "event:" + r.id;
      A.toast(editing ? "저장했어요. 반 친구들 화면에도 바로 보여요." : "일정을 추가했어요. 반 친구들 화면에도 바로 보여요.");
      await A.views.calendar.load(); if (A.route.tab === "calendar") A.renderMain();
    } catch (e) { A.toast(e.message, "err"); }
  });
})();
