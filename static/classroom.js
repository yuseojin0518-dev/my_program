/* 클래스룸: 할 일 / 수업 카드 → 수업(스트림·수업 과제·사람·성적) → 과제 상세(제출·채점·반환·비공개 댓글) */
(function () {
  "use strict";
  const A = window.App, esc = A.esc, D = A.drawer;
  const C = (A.cls = { ov: null, sid: null, tab: "stream", stream: null, work: null, people: null, grades: null, detail: null, todoTab: "assigned", topic: "", threads: {}, composer: false, sel: new Set() });
  const KIND = { assignment: ["📝", "과제"], question: ["❓", "질문"], material: ["📎", "자료"] };
  const STATUS = { assigned: ["할 일", "st-as"], submitted: ["제출함", "st-ok"], late: ["늦게 제출", "st-late"], missing: ["안 냄", "st-miss"], returned: ["돌려받음", "st-ret"] };
  const TSTATUS = { assigned: "할당됨", submitted: "제출함", late: "늦게 제출", missing: "안 냄", returned: "반환함" };

  // ───── 날짜 ─────
  const nowLocal = () => { const t = A.today(); const d = new Date(); return t + "T" + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
  function dueText(due, short) {
    if (!due) return "마감 없음";
    const d = due.slice(0, 10), hm = due.slice(11, 16), k = A.daysBetween(A.today(), d);
    const day = k === 0 ? "오늘" : k === 1 ? "내일" : k === -1 ? "어제" : A.fmtDate(d);
    return (short ? "" : "마감 ") + day + (hm && hm !== "23:59" ? " " + hm : "") + (k > 1 && k <= 14 && !short ? ` · D-${k}` : "");
  }
  const late = (due) => due && nowLocal() > due;
  const statusBadge = (st) => (st && STATUS[st] ? `<span class="stb ${STATUS[st][1]}">${STATUS[st][0]}</span>` : "");
  const subjBy = (id) => A.subject(id) || { name: "", icon: "📘", color: "#3182f6" };
  const isT = () => !!(C.ov && C.ov.teacher);

  // 실시간으로 다시 그릴 때 쓰던 글과 커서를 지킨다
  function keepFields(fn) {
    const vals = {}, act = document.activeElement, actId = act && act.id, sel = act && act.selectionStart;
    A.$$("#main textarea[id], #main input[id]").forEach((el) => { if (el.type !== "file" && el.type !== "checkbox") vals[el.id] = el.value; });
    fn();
    for (const [id, v] of Object.entries(vals)) { const el = document.getElementById(id); if (el && el.value !== v && el.type !== "file") el.value = v; }
    if (actId) { const el = document.getElementById(actId); if (el) { el.focus(); try { el.setSelectionRange(sel, sel); } catch (e) { /* 숫자 칸 */ } } }
  }

  A.views.class = {
    async load(fresh) {
      if (A.subjectsStale || !A.subjects.length) await A.loadSubjects();
      C.ov = await A.api("/api/class/overview?scope=" + encodeURIComponent(A.scope));
      if (!A.route.sid) return;
      if (!A.subject(A.route.sid)) throw new Error("과목을 찾을 수 없어요.");
      if (C.sid !== A.route.sid) { C.sid = A.route.sid; C.tab = "stream"; C.topic = ""; C.threads = {}; C.composer = false; }
      if (A.route.sub) { C.detail = await A.api("/api/class/work/" + A.route.sub); if (fresh) C.sel = new Set(); if (C.detail.student && C.detail.mine && fresh) C.draft = draftOf(C.detail); return; }
      C.detail = null;
      const sid = C.sid;
      const [st, wk, pp] = await Promise.all([A.api("/api/class/stream?subject=" + sid), A.api("/api/class/work?subject=" + sid), A.api("/api/class/people?scope=" + encodeURIComponent(A.scope))]);
      C.stream = st; C.work = wk; C.people = pp;
      if (C.tab === "grades") C.grades = await A.api("/api/class/grades?subject=" + sid);
      for (const t of Object.keys(C.threads)) await loadThread(t);
    },
    render() {
      if (!A.route.sid) return overview();
      if (A.route.sub && C.detail) return detail();
      return classPage();
    },
    after() { },
    onChanged(kind) {
      if (!["classroom", "comments", "subjects"].includes(kind)) return;
      clearTimeout(C.rt);
      C.rt = setTimeout(() => A.views.class.load(false).then(() => { if (A.route.tab === "class") keepFields(() => A.renderMain()); }).catch(() => {}), 250);
      if (D.key && D.key.startsWith("sub:") && kind !== "subjects") setTimeout(() => openSub(Number(D.key.slice(4)), true), 400);
    },
  };

  // ═══════════ 첫 화면: 할 일 + 수업 카드 ═══════════
  function overview() {
    const ov = C.ov;
    let todo = "";
    if (ov.student) {
      const groups = { assigned: ov.todo.filter((x) => x.status === "assigned"), missing: ov.todo.filter((x) => x.status === "missing"), done: ov.todo.filter((x) => ["submitted", "late", "returned"].includes(x.status)) };
      const list = groups[C.todoTab].slice().sort((a, b) => ((a.due || "9") < (b.due || "9") ? -1 : 1));
      if (C.todoTab === "done") list.reverse();
      todo = `<section class="card todo-card"><div class="cal-h"><h2>할 일</h2><span class="muted small">${esc(A.scopeLabel(A.scope))} 모든 수업</span></div>
        <div class="seg" role="tablist">${[["assigned", "할당됨"], ["missing", "기한 지남"], ["done", "완료"]].map(([k, l]) => `<button role="tab" aria-selected="${C.todoTab === k}" class="${C.todoTab === k ? "on" : ""}" data-act="todoTab" data-v="${k}">${l} <b>${groups[k].length}</b></button>`).join("")}</div>
        ${list.length ? `<ul class="todo-list">${list.slice(0, 8).map(todoRow).join("")}</ul>` : `<div class="empty-mini"><span>${C.todoTab === "missing" ? "👏" : "🎉"}</span><p>${{ assigned: "해야 할 과제가 없어요!", missing: "기한이 지난 과제가 없어요.", done: "아직 낸 과제가 없어요." }[C.todoTab]}</p></div>`}
      </section>`;
    } else if (ov.teacher) {
      todo = `<section class="card todo-card"><div class="cal-h"><h2>검토할 과제</h2><span class="muted small">제출했지만 아직 돌려주지 않은 것</span></div>
        ${ov.todo.length ? `<ul class="todo-list">${ov.todo.slice(0, 8).map((x) => { const s = subjBy(x.subjectId); return `<li><button data-act="go" data-to="class/${x.subjectId}/${x.id}"><span class="tl-ico" style="--c:${esc(s.color)}">${KIND[x.kind][0]}</span><span class="tl-m"><b>${esc(x.title)}</b><small>${esc(s.name)} · ${dueText(x.due)}</small></span><span class="tl-n"><b>${x.pending}</b><small>검토</small></span></button></li>`; }).join("")}</ul>`
          : `<div class="empty-mini"><span>☕️</span><p>검토할 제출물이 없어요.</p></div>`}</section>`;
    }
    const cards = A.subjects.map((s, i) => {
      const v = ov.subjects[String(s.id)] || { next: [], work: 0, review: 0, posts: 0 };
      return `<button class="ccard" style="--c:${esc(s.color)};--i:${i}" data-act="go" data-to="class/${s.id}">
        <div class="cc-top"><span class="cc-ico" aria-hidden="true">${esc(s.icon)}</span><div><b>${esc(s.name)}</b><small>${esc(s.description || "")}</small></div>${ov.teachers.length ? `<span class="cc-t">${A.avatar(ov.teachers[0], "sm")}</span>` : ""}</div>
        <div class="cc-body">${v.next.length ? v.next.map((x) => `<p class="cc-due"><small>${dueText(x.due, true)}</small><span>${esc(x.title)}</span></p>`).join("") : `<p class="muted small">${v.work ? "마감이 다가오는 과제가 없어요" : "아직 올라온 과제가 없어요"}</p>`}</div>
        <div class="cc-foot"><span>📝 ${v.work}</span><span>📢 ${v.posts}</span>${v.review ? `<span class="cc-rev">검토 ${v.review}</span>` : ""}</div></button>`;
    }).join("");
    return `<header class="page-h"><div><p class="eyebrow">${esc(A.scopeLabel(A.scope))} · ${esc(A.me.schoolName)}</p><h1>클래스룸</h1>
        <p class="page-sub">과목마다 공지·과제·질문·자료가 모여요. ${ov.student ? "과제를 내고, 점수와 선생님 피드백을 받아요." : ov.teacher ? "과제를 내고, 제출물을 채점해서 돌려줘요." : "다른 반은 보기만 할 수 있어요."}</p></div>
        ${A.canWrite() ? `<button class="btn tinted" data-act="subjectAdd">＋ 수업 만들기</button>` : ""}</header>
      <div class="ov-grid">${todo}<div class="ccards">${cards}</div></div>`;
  }
  function todoRow(x) {
    const s = subjBy(x.subjectId);
    return `<li><button data-act="go" data-to="class/${x.subjectId}/${x.id}"><span class="tl-ico" style="--c:${esc(s.color)}">${KIND[x.kind][0]}</span>
      <span class="tl-m"><b>${esc(x.title)}</b><small>${esc(s.name)}${x.points ? ` · ${x.points}점` : ""}</small></span><span class="tl-d ${x.status === "missing" ? "red" : ""}">${statusBadge(x.status === "assigned" ? null : x.status)}<small>${dueText(x.due)}</small></span></button></li>`;
  }
  A.acts.todoTab = (el) => { C.todoTab = el.dataset.v; A.renderMain(); };

  // ═══════════ 수업 화면 ═══════════
  function classPage() {
    const s = A.subject(C.sid);
    const tabs = [["stream", "스트림"], ["work", "수업 과제"], ["people", "사람"], ["grades", isT() ? "성적" : "내 성적"]];
    const body = { stream: streamTab, work: workTab, people: peopleTab, grades: gradesTab }[C.tab]();
    return `<nav class="crumb" aria-label="위치"><button class="link back" data-act="go" data-to="class">← 클래스룸</button></nav>
      <div class="subj-tabs" role="tablist" aria-label="수업 바꾸기">${A.subjects.map((x) => `<button role="tab" aria-selected="${x.id === s.id}" class="st ${x.id === s.id ? "on" : ""}" style="--c:${esc(x.color)}" data-act="go" data-to="class/${x.id}">${esc(x.icon)} ${esc(x.name)}</button>`).join("")}</div>
      <section class="banner" style="--c:${esc(s.color)}"><div class="bn-art" aria-hidden="true">${esc(s.icon)}</div><div><h1>${esc(s.name)}</h1><p>${esc(s.description || "")}</p><p class="bn-meta">${esc(A.me.schoolName)} ${esc(A.scopeLabel(A.scope))}${C.ov.teachers.length ? " · " + C.ov.teachers.map((t) => esc(t.name)).join(", ") : ""}</p></div></section>
      <div class="ctabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${C.tab === k}" class="${C.tab === k ? "on" : ""}" data-act="clsTab" data-v="${k}">${l}</button>`).join("")}</div>
      ${body}`;
  }
  A.acts.clsTab = async (el) => {
    C.tab = el.dataset.v;
    if (C.tab === "grades") { try { C.grades = await A.api("/api/class/grades?subject=" + C.sid); } catch (e) { A.toast(e.message, "err"); } }
    A.renderMain();
  };

  // ───── 스트림 ─────
  function streamTab() {
    const st = C.stream;
    const up = `<section class="card up-card"><h3>다가오는 과제</h3>${st.upcoming.length ? `<ul class="mini-up">${st.upcoming.map((x) => `<li><button class="link" data-act="go" data-to="class/${C.sid}/${x.id}"><small>${dueText(x.due, true)}</small>${esc(x.title)}</button></li>`).join("")}</ul>` : `<p class="muted small">${isT() ? "마감이 있는 과제가 없어요." : "곧 마감되는 과제가 없어요. 👍"}</p>`}
      <button class="link small" data-act="clsTab" data-v="work">모두 보기 ›</button></section>`;
    const comp = A.canWrite() ? (C.composer ? `<section class="card composer open">${A.avatar(A.me)}<div class="cp-b">
        <textarea id="cp-text" rows="4" maxlength="3000" placeholder="${isT() ? "반에 공지하기…" : "반 친구들과 선생님께 공유하기…"}"></textarea>
        <div id="cp-att">${A.attachEditor(A.attState)}</div>
        <div class="row gap end"><button class="btn" data-act="cpClose">취소</button><button class="btn primary" data-act="cpPost">게시</button></div></div></section>`
      : `<button class="card composer" data-act="cpOpen">${A.avatar(A.me)}<span>${isT() ? "반에 공지하기…" : "반에 공유하기…"}</span></button>`) : "";
    const items = st.items.map((x) => x.type === "post" ? postHtml(x) : `<article class="card sitem work"><button class="si-w" data-act="go" data-to="class/${C.sid}/${x.id}"><span class="si-ico k-${x.kind}">${KIND[x.kind][0]}</span>
        <span class="si-m"><b>${esc(x.author.name)}${/님$/.test(x.author.name) ? "" : "님"}이 새 ${KIND[x.kind][1]}을(를) 올렸어요: ${esc(x.title)}</b><small>${A.ago(x.createdAt)}${x.due ? " · " + dueText(x.due) : ""}</small></span>${x.mine ? statusBadge(x.mine.status) : ""}</button></article>`).join("");
    return `<div class="stream">${up}<div class="st-main">${comp}${items || `<div class="empty-state"><span>📢</span><p>아직 소식이 없어요. 첫 공지를 올려 보세요.</p></div>`}</div></div>`;
  }
  function postHtml(p) {
    const t = "post:" + p.id;
    return `<article class="card sitem"><header class="si-h">${A.avatar(p.author)}<div><b>${esc(p.author.name)}${p.author.role === "teacher" ? ` <span class="tag">선생님</span>` : ""}</b><small>${A.ago(p.createdAt)}${p.updatedAt !== p.createdAt ? " (수정됨)" : ""}</small></div>
        ${A.canWrite() && A.isMine(p.author) ? `<button class="icon-btn sm" data-act="postDel" data-id="${p.id}" aria-label="글 지우기">🗑</button>` : ""}</header>
      <div class="md si-t">${A.md(p.text)}</div>${A.gallery(p.attachments.filter((f) => f.image))}${A.fileList(p.attachments.filter((f) => !f.image))}
      ${thread(t, p.comments, "수업 댓글")}</article>`;
  }
  A.acts.cpOpen = () => { C.composer = true; A.attState = { images: [], attachments: [] }; A.attRepaint = () => { const b = A.$("#cp-att"); if (b) b.innerHTML = A.attachEditor(A.attState); }; A.renderMain(); setTimeout(() => A.$("#cp-text") && A.$("#cp-text").focus(), 30); };
  A.acts.cpClose = () => { C.composer = false; A.renderMain(); };
  A.acts.cpPost = async (el) => {
    const st = A.attState;
    el.disabled = true;
    try {
      await A.api("/api/class/posts", { method: "POST", body: { subject: C.sid, text: A.$("#cp-text").value, attachments: st.images.concat(st.attachments).map((m) => m.id) } });
      C.composer = false; await A.views.class.load(); A.renderMain(); A.toast("게시했어요.");
    } catch (e) { A.toast(e.message, "err"); el.disabled = false; }
  };
  A.acts.postDel = async (el) => {
    if (!(await A.confirm("이 글을 지울까요?", "댓글도 함께 사라져요."))) return;
    try { await A.api("/api/class/posts/" + el.dataset.id, { method: "DELETE" }); await A.views.class.load(); A.renderMain(); } catch (e) { A.toast(e.message, "err"); }
  };

  // ───── 댓글 (스트림·과제는 반 공개, 제출물은 비공개) ─────
  function thread(target, count, label, privateNote) {
    const th = C.threads[target];
    const list = th ? th.list : null;
    return `<div class="thread">${!th ? (count ? `<button class="link small" data-act="thOpen" data-t="${target}">💬 ${label} ${count}개</button>` : "") : `<ul class="th-list">${list.map((x) => `<li>${A.avatar(x.author, "sm")}<div><p><b>${esc(x.author.name)}</b><small>${A.ago(x.createdAt)}</small>${A.isMine(x.author) ? `<button class="link small" data-act="thDel" data-id="${x.id}" data-t="${target}">지우기</button>` : ""}</p><div>${esc(x.text)}</div></div></li>`).join("")}</ul>`}
      ${A.canWrite() || privateNote ? `<form class="th-form" data-t="${target}">${A.avatar(A.me, "sm")}<input id="th-${target.replace(":", "-")}" maxlength="500" placeholder="${privateNote ? "선생님께만 보이는 댓글…" : label + " 달기…"}" aria-label="${label}"><button class="btn small primary" type="submit">등록</button></form>` : ""}</div>`;
  }
  async function loadThread(t) { try { C.threads[t] = { list: (await A.api("/api/comments?target=" + encodeURIComponent(t))).comments }; } catch (e) { delete C.threads[t]; } }
  A.acts.thOpen = async (el) => { await loadThread(el.dataset.t); keepFields(() => A.renderMain()); };
  A.acts.thDel = async (el) => { try { await A.api("/api/comments/" + el.dataset.id, { method: "DELETE" }); await loadThread(el.dataset.t); keepFields(() => A.renderMain()); } catch (e) { A.toast(e.message, "err"); } };
  document.addEventListener("submit", async (ev) => {
    const f = ev.target.closest(".th-form"); if (!f) return;
    ev.preventDefault();
    const inp = f.querySelector("input"), text = inp.value.trim(), t = f.dataset.t;
    if (!text) return;
    try { await A.api("/api/comments", { method: "POST", body: { target: t, text } }); inp.value = ""; await loadThread(t); A.renderMain(); const ni = document.getElementById(inp.id); if (ni) ni.focus(); }
    catch (e) { A.toast(e.message, "err"); }
  });

  // ───── 수업 과제 ─────
  function workTab() {
    const w = C.work.work;
    const topics = Array.from(new Set(w.map((x) => x.topic).filter(Boolean)));
    const list = C.topic ? w.filter((x) => x.topic === C.topic) : w;
    const groups = new Map();
    for (const x of list) { const k = x.topic || ""; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
    const keys = Array.from(groups.keys()).sort((a, b) => (a === "" ? -1 : b === "" ? 1 : 0));
    return `<div class="work-h">${isT() ? `<div class="mk-menu"><button class="btn primary" data-act="mkMenu">＋ 만들기</button><div class="mk-pop" id="mk-pop" hidden>${Object.entries(KIND).map(([k, [i, l]]) => `<button data-act="cwNew" data-k="${k}"><span>${i}</span>${l}</button>`).join("")}</div></div>` : ""}
        <div class="tags">${["", ...topics].map((t) => `<button class="tagf ${C.topic === t ? "on" : ""}" data-act="topic" data-v="${esc(t)}">${t ? esc(t) : "모든 주제"}</button>`).join("")}</div></div>
      ${keys.length ? keys.map((k) => `<section class="topic"><h2>${k ? esc(k) : (topics.length ? "주제 없음" : "")}</h2><ul class="cw-list">${groups.get(k).map(cwRow).join("")}</ul></section>`).join("")
        : `<div class="empty-state"><span>📝</span><p>${isT() ? "＋ 만들기로 첫 과제를 내 보세요." : "아직 올라온 과제가 없어요."}</p></div>`}`;
  }
  function cwRow(x) {
    const right = x.mine ? `${statusBadge(x.mine.status)}${x.mine.grade !== null && x.mine.status === "returned" && x.points ? `<b class="gr">${x.mine.grade}/${x.points}</b>` : ""}`
      : x.counts ? `<span class="cnt"><b>${x.counts.turnedIn + x.counts.returned}</b><small>제출</small></span><span class="cnt"><b>${x.counts.assigned + x.counts.missing}</b><small>할당됨</small></span>` : "";
    return `<li><button class="cw-row" data-act="go" data-to="class/${C.sid}/${x.id}"><span class="si-ico k-${x.kind}">${KIND[x.kind][0]}</span>
      <span class="cw-m"><b>${esc(x.title)}</b><small>${KIND[x.kind][1]} · ${x.kind === "material" ? "게시 " + A.ago(x.createdAt) : `<span class="${x.mine && x.mine.status === "missing" ? "red" : ""}">${dueText(x.due)}</span>`}${x.points ? ` · ${x.points}점` : ""}${x.comments ? ` · 💬${x.comments}` : ""}</small></span>${right}</button></li>`;
  }
  A.acts.topic = (el) => { C.topic = el.dataset.v; A.renderMain(); };
  A.acts.mkMenu = (ev) => { const p = A.$("#mk-pop"); p.hidden = !p.hidden; void ev; };

  // ───── 사람·성적 ─────
  function peopleTab() {
    const p = C.people;
    return `<section class="card people"><h2>선생님</h2><ul>${p.teachers.map((u) => `<li>${A.avatar(u)}<b>${esc(u.name)}</b></li>`).join("") || `<li class="muted">아직 선생님이 없어요.</li>`}</ul>
      <h2>학생 <small class="muted">${p.students.length}명</small></h2><ul>${p.students.map((u) => `<li>${A.avatar(u)}<b>${esc(u.name)}${A.me.id === u.id ? " (나)" : ""}</b></li>`).join("")}</ul></section>`;
  }
  function gradesTab() {
    const g = C.grades;
    if (!g) return `<div class="loading"><span></span><span></span><span></span></div>`;
    if (!g.work.length) return `<div class="empty-state"><span>📊</span><p>점수가 있는 과제가 아직 없어요.</p></div>`;
    if (!isT()) {
      const r = g.rows[0];
      if (!r) return `<div class="empty-state"><p>이 반 학생만 성적을 볼 수 있어요.</p></div>`;
      return `<section class="card"><div class="my-avg"><small>돌려받은 과제 평균</small><b>${r.avg === null ? "–" : r.avg + "%"}</b></div><ul class="cw-list">${g.work.map((w, i) => { const c = r.cells[i]; return `<li><button class="cw-row" data-act="go" data-to="class/${C.sid}/${w.id}"><span class="si-ico k-${w.kind}">${KIND[w.kind][0]}</span><span class="cw-m"><b>${esc(w.title)}</b><small>${dueText(w.due)}</small></span>${statusBadge(c.status)}<b class="gr">${c.returned && c.grade !== null ? c.grade : "–"}${w.points ? "/" + w.points : ""}</b></button></li>`; }).join("")}</ul></section>`;
    }
    const avgOf = (i) => { const v = g.rows.map((r) => r.cells[i].grade).filter((x) => x !== null); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : "–"; };
    return `<section class="card gtable-wrap"><table class="gtable"><thead><tr><th>학생</th><th>평균</th>${g.work.map((w) => `<th><button class="link small" data-act="go" data-to="class/${C.sid}/${w.id}">${esc(w.title)}</button><small>${w.points ? w.points + "점" : "점수 없음"} · ${dueText(w.due, true)}</small></th>`).join("")}</tr></thead>
      <tbody><tr class="avg"><td>반 평균</td><td></td>${g.work.map((w, i) => `<td>${avgOf(i)}</td>`).join("")}</tr>
      ${g.rows.map((r) => `<tr><td>${A.avatar(r.student, "sm")} ${esc(r.student.name)}</td><td><b>${r.avg === null ? "–" : r.avg + "%"}</b></td>${r.cells.map((c) => `<td class="gc ${c.status}">${c.grade !== null ? `<b>${c.grade}</b>${c.returned ? "" : `<small>임시</small>`}` : `<small>${TSTATUS[c.status] || ""}</small>`}</td>`).join("")}</tr>`).join("")}</tbody></table></section>`;
  }

  // ═══════════ 과제 상세 ═══════════
  function draftOf(d) {
    const m = d.mine || {};
    return { text: m.text || "", attachments: (m.attachments || []).slice(), answer: m.answer === undefined ? null : m.answer };
  }
  function detail() {
    const d = C.detail, s = A.subject(C.sid);
    const head = `<nav class="crumb"><button class="link back" data-act="dBack">← ${esc(s.name)} 수업 과제</button></nav>`;
    const info = `<article class="card d-main"><header class="d-h"><span class="si-ico big k-${d.kind}">${KIND[d.kind][0]}</span><div class="d-ht"><h1>${esc(d.title)}</h1>
        <p class="muted">${esc(d.author.name)} · ${A.ago(d.createdAt)}${d.updatedAt !== d.createdAt ? " (수정됨)" : ""}</p>
        <p class="d-meta">${d.points ? `<b>${d.points}점</b>` : d.kind !== "material" ? "점수 없음" : ""}${d.kind !== "material" ? `<span class="${late(d.due) ? "red" : ""}">${dueText(d.due)}</span>` : ""}${d.topic ? `<span>#${esc(d.topic)}</span>` : ""}</p></div>
        ${d.teacher ? `<div class="row gap"><button class="btn small" data-act="cwEdit">수정</button><button class="btn small danger" data-act="cwDel">삭제</button></div>` : ""}</header>
      ${d.instructions ? `<div class="md">${A.md(d.instructions)}</div>` : ""}
      ${d.question ? questionBlock(d) : ""}
      ${A.gallery(d.attachments.filter((f) => f.image))}${A.fileList(d.attachments.filter((f) => !f.image))}
      <div class="d-cm"><h3>수업 댓글</h3>${thread("cw:" + d.id, d.comments, "수업 댓글")}</div></article>`;
    if (d.teacher && d.kind !== "material") return head + `<div class="d-grid t">${info}${teacherPanel(d)}</div>`;
    if (d.student && d.kind !== "material") return head + `<div class="d-grid">${info}${studentPanel(d)}</div>`;
    return head + `<div class="d-grid one">${info}</div>`;
  }
  A.acts.dBack = () => { C.tab = "work"; A.go("class/" + C.sid); };

  function questionBlock(d) {
    const q = d.question;
    if (d.tally) {
      const tot = d.tally.reduce((a, b) => a + b, 0) || 1;
      return `<div class="q-res"><h3>반 친구들의 답 <small class="muted">${d.classAnswers.length}명</small></h3>${q.options.map((o, i) => `<div class="qr"><span>${esc(o)}</span><div class="qr-bar"><i style="width:${(d.tally[i] / tot * 100).toFixed(0)}%"></i></div><b>${d.tally[i]}</b></div>`).join("")}</div>`;
    }
    if (d.classAnswers) return `<div class="q-res"><h3>반 친구들의 답 <small class="muted">${d.classAnswers.length}명</small></h3><ul class="th-list">${d.classAnswers.map((a) => `<li>${A.avatar(a.student, "sm")}<div><p><b>${esc(a.student.name)}</b></p><div>${esc(a.answer)}</div></div></li>`).join("")}</ul></div>`;
    return "";
  }

  function studentPanel(d) {
    const m = d.mine, st = m.status, done = ["submitted", "late", "returned"].includes(st) && m.submittedAt;
    const dr = C.draft;
    const isQ = d.kind === "question", q = d.question;
    let body;
    if (isQ) {
      if (done) body = `<div class="my-ans"><small>내 답</small><p>${q.type === "choice" ? esc(q.options[m.answer]) : esc(m.answer)}</p></div>`;
      else body = q.type === "choice" ? `<div class="choices" role="radiogroup">${q.options.map((o, i) => `<label class="choice ${dr.answer === i ? "on" : ""}"><input type="radio" name="qa" value="${i}" ${dr.answer === i ? "checked" : ""} data-ch="qaPick"><span>${esc(o)}</span></label>`).join("")}</div>`
        : `<textarea id="qa-text" rows="4" maxlength="1000" placeholder="내 답">${esc(dr.answer || "")}</textarea>`;
    } else {
      body = `<ul class="files">${(done ? m.attachments : dr.attachments).map((f, i) => `<li><span class="f-ico">${A.fileIcon(f.type)}</span><span class="f-name">${esc(f.name)}<small>${A.size(f.size)}</small></span>${done ? `<a class="btn small" href="${esc(f.url)}" target="_blank" rel="noopener">열기</a>` : `<button class="link" data-act="drDel" data-i="${i}">빼기</button>`}</li>`).join("")}</ul>
        ${done ? (m.text ? `<p class="my-memo">${esc(m.text)}</p>` : "") : `<label class="btn wide add-work">＋ 파일 추가 · 사진 찍기<input type="file" hidden multiple accept="${A.ACCEPT}" data-ch="drPick"></label><p class="hint" id="dr-msg"></p>
          <textarea id="dr-text" rows="2" maxlength="3000" placeholder="선생님께 남길 말 (선택)">${esc(dr.text)}</textarea>`}`;
    }
    const btn = done ? (isQ ? `<p class="muted small center">답을 제출했어요.</p>` : `<button class="btn wide" data-act="unsubmit">제출 취소</button>`)
      : `<button class="btn primary wide" data-act="submitWork">${isQ ? "제출" : dr.attachments.length || dr.text ? "제출" : "완료로 표시"}</button>`;
    const grade = st === "returned" && m.grade !== null ? `<div class="grade-big"><b>${m.grade}</b><small>/ ${d.points || "–"}점</small></div>` : st === "returned" ? `<p class="muted small">선생님이 돌려줬어요.</p>` : "";
    return `<aside class="d-side"><section class="card mywork"><div class="mw-h"><h2>내 ${isQ ? "답" : "과제"}</h2>${statusBadge(st)}</div>${grade}
        ${st === "missing" ? `<p class="warn-box">⏰ 마감이 지났어요. 지금 내면 '늦게 제출'로 표시돼요.</p>` : ""}${body}${btn}
        ${m.submittedAt ? `<p class="hint">제출: ${esc(A.fmtDate(m.submittedAt.slice(0, 10)))} ${esc(m.submittedAt.slice(11, 16))}</p>` : ""}</section>
      <section class="card"><h3>🔒 비공개 댓글</h3><p class="hint">나와 선생님만 볼 수 있어요.</p>${thread("sub:" + m.id, m.privateComments, "비공개 댓글", true)}</section></aside>`;
  }
  A.changes.qaPick = (el) => { C.draft.answer = Number(el.value); A.$$(".choice").forEach((c) => c.classList.toggle("on", c.contains(el))); };
  A.changes.drPick = async (el) => {
    const files = Array.from(el.files || []), msg = A.$("#dr-msg");
    for (const f of files) { if (msg) msg.textContent = `${f.name} 올리는 중…`; try { C.draft.attachments.push(await A.upload(f)); } catch (e) { A.toast(e.message, "err"); } }
    keepFields(() => A.renderMain());
  };
  A.acts.drDel = (el) => { C.draft.attachments.splice(Number(el.dataset.i), 1); keepFields(() => A.renderMain()); };
  A.acts.submitWork = async (el) => {
    const d = C.detail, dr = C.draft;
    const body = { text: A.$("#dr-text") ? A.$("#dr-text").value : "", attachments: dr.attachments.map((f) => f.id) };
    if (d.kind === "question") body.answer = d.question.type === "choice" ? dr.answer : A.$("#qa-text").value;
    else if (!body.text && !body.attachments.length) { if (!(await A.confirm("첨부 없이 완료로 표시할까요?", "선생님께 '제출함'으로 보여요.", "완료로 표시"))) return; body.markDone = true; }
    if (d.kind === "question" && (body.answer === null || body.answer === "")) { A.toast("답을 골라 주세요.", "err"); return; }
    el.disabled = true;
    try { C.detail = await A.api(`/api/class/work/${d.id}/submit`, { method: "POST", body }); C.draft = draftOf(C.detail); A.renderMain(); A.toast(C.detail.mine.status === "late" ? "제출했어요 (늦게 제출)." : "제출했어요! 🎉"); }
    catch (e) { A.toast(e.message, "err"); el.disabled = false; }
  };
  A.acts.unsubmit = async () => {
    if (!(await A.confirm("제출을 취소할까요?", "고친 뒤 다시 제출해 주세요. 마감이 지났으면 '늦게 제출'이 돼요.", "제출 취소"))) return;
    try { C.detail = await A.api(`/api/class/work/${C.detail.id}/unsubmit`, { method: "POST", body: {} }); C.draft = draftOf(C.detail); A.renderMain(); } catch (e) { A.toast(e.message, "err"); }
  };

  // ───── 선생님: 학생 제출물 ─────
  function teacherPanel(d) {
    const c = d.counts, subs = d.submissions;
    const filt = C.subFilter || "all";
    const list = subs.filter((x) => filt === "all" || (filt === "in" ? ["submitted", "late"].includes(x.status) : filt === "todo" ? ["assigned", "missing"].includes(x.status) : x.status === "returned"));
    const allSel = list.length && list.every((x) => C.sel.has(x.id));
    return `<aside class="d-side wide"><section class="card subs">
      <div class="sum">${[["in", c.turnedIn, "제출함"], ["todo", c.assigned + c.missing, "할당됨"], ["ret", c.returned, "반환함"]].map(([k, n, l]) => `<button class="${filt === k ? "on" : ""}" data-act="subFilter" data-v="${k}"><b>${n}</b><small>${l}</small></button>`).join("")}</div>
      <div class="subs-bar"><label class="chk"><input type="checkbox" data-ch="selAll" ${allSel ? "checked" : ""}> 모두</label><button class="link small" data-act="subFilter" data-v="all">전체 ${subs.length}명</button><span class="sp-f"></span>
        <button class="btn small primary" data-act="returnSel" ${C.sel.size ? "" : "disabled"}>↩ 반환 ${C.sel.size ? C.sel.size + "명" : ""}</button></div>
      <ul class="sub-list">${list.map((x) => `<li class="${C.sel.has(x.id) ? "sel" : ""}"><input type="checkbox" aria-label="${esc(x.student.name)} 고르기" data-ch="selSub" data-id="${x.id}" ${C.sel.has(x.id) ? "checked" : ""}>
        <button class="sl-open" data-act="openSub" data-id="${x.id}">${A.avatar(x.student, "sm")}<span class="sl-m"><b>${esc(x.student.name)}</b>${statusBadge(x.status === "assigned" ? null : x.status) || `<small class="muted">할당됨</small>`}</span></button>
        <span class="gin"><input type="number" inputmode="decimal" min="0" max="${d.points || 1000}" step="0.5" value="${x.grade === null ? "" : x.grade}" placeholder="–" data-ch="gradeIn" data-id="${x.id}" aria-label="${esc(x.student.name)} 점수"><small>/${d.points || "–"}</small></span></li>`).join("") || `<li class="muted pad">해당하는 학생이 없어요.</li>`}</ul>
      <p class="hint">점수를 넣고 학생을 골라 ‘반환’하면 학생이 점수를 볼 수 있어요. 이름을 누르면 제출물과 비공개 댓글이 열려요.</p></section></aside>`;
  }
  A.acts.subFilter = (el) => { C.subFilter = el.dataset.v; A.renderMain(); };
  A.changes.selSub = (el) => { const id = Number(el.dataset.id); if (el.checked) C.sel.add(id); else C.sel.delete(id); keepFields(() => A.renderMain()); };
  A.changes.selAll = (el) => {
    const d = C.detail, filt = C.subFilter || "all";
    for (const x of d.submissions) if (filt === "all" || (filt === "in" ? ["submitted", "late"].includes(x.status) : filt === "todo" ? ["assigned", "missing"].includes(x.status) : x.status === "returned")) { if (el.checked) C.sel.add(x.id); else C.sel.delete(x.id); }
    A.renderMain();
  };
  A.changes.gradeIn = async (el) => {
    try { const r = await A.api("/api/class/subs/" + el.dataset.id, { method: "PATCH", body: { grade: el.value } }); const x = C.detail.submissions.find((s) => s.id === Number(el.dataset.id)); if (x) x.grade = r.grade; el.classList.add("saved"); setTimeout(() => el.classList.remove("saved"), 900); }
    catch (e) { A.toast(e.message, "err"); }
  };
  A.acts.returnSel = async () => {
    const n = C.sel.size;
    try { await A.api(`/api/class/work/${C.detail.id}/return`, { method: "POST", body: { ids: Array.from(C.sel) } }); C.sel = new Set(); C.detail = await A.api("/api/class/work/" + C.detail.id); A.renderMain(); A.toast(`${n}명에게 돌려줬어요.`); }
    catch (e) { A.toast(e.message, "err"); }
  };
  A.acts.openSub = (el) => openSub(Number(el.dataset.id));
  async function openSub(id, refresh) {
    const d = C.detail; if (!d) return;
    if (refresh) { try { C.detail = await A.api("/api/class/work/" + d.id); } catch (e) { return; } }
    const x = C.detail.submissions.find((s) => s.id === id); if (!x) return;
    await A.loadComments("sub:" + id).catch(() => {});
    const q = C.detail.question;
    const render = () => `<div class="dr-top">${A.avatar(x.student)}<b>${esc(x.student.name)}</b>${statusBadge(x.status)}<span class="sp-f"></span><button class="icon-btn" data-act="closeDrawer" aria-label="닫기">✕</button></div>
      <h2 class="dr-title">${esc(C.detail.title)}</h2>
      <p class="dr-date">${x.submittedAt ? `제출 ${esc(A.fmtDate(x.submittedAt.slice(0, 10)))} ${esc(x.submittedAt.slice(11, 16))}${x.status === "late" ? " · <b class='red'>늦게 제출</b>" : ""}` : "아직 제출하지 않았어요"}</p>
      ${x.answer !== null && x.answer !== undefined && q ? `<div class="my-ans"><small>답</small><p>${q.type === "choice" ? esc(q.options[x.answer]) : esc(x.answer)}</p></div>` : ""}
      ${x.text ? `<p class="my-memo">${esc(x.text)}</p>` : ""}
      ${A.gallery((x.attachments || []).filter((f) => f.image))}${A.fileList((x.attachments || []).filter((f) => !f.image))}
      <div class="fld inline"><span>점수</span><div class="row gap"><input class="grade-in" type="number" min="0" max="${C.detail.points || 1000}" step="0.5" value="${x.grade === null ? "" : x.grade}" data-ch="gradeIn" data-id="${x.id}"><span class="muted">/ ${C.detail.points || "–"}</span>
        <button class="btn primary small" data-act="returnOne" data-id="${x.id}">↩ 반환</button></div></div>
      <h3>🔒 비공개 댓글</h3>${A.commentsHtml().replace('<h3>댓글', '<h3 class="sr-only">댓글')}`;
    D.onChanged = async (kind, tid) => { if (kind === "comments" && tid === "sub:" + id) { await A.loadComments("sub:" + id); A.paintComments(); } };
    if (D.key === "sub:" + id) { D.render = render; D.paint(); } else D.open("sub:" + id, render);
  }
  A.acts.returnOne = async (el) => {
    try { await A.api(`/api/class/work/${C.detail.id}/return`, { method: "POST", body: { ids: [Number(el.dataset.id)] } }); A.toast("돌려줬어요."); C.detail = await A.api("/api/class/work/" + C.detail.id); A.renderMain(); openSub(Number(el.dataset.id)); }
    catch (e) { A.toast(e.message, "err"); }
  };

  // ───── 선생님: 과제·질문·자료 만들기 ─────
  A.acts.cwNew = (el) => { const p = A.$("#mk-pop"); if (p) p.hidden = true; cwForm(null, el.dataset.k); };
  A.acts.cwEdit = () => cwForm(C.detail, C.detail.kind);
  A.acts.cwDel = async () => {
    if (!(await A.confirm("이 " + KIND[C.detail.kind][1] + "을(를) 지울까요?", "학생 제출물과 댓글도 모두 사라져요."))) return;
    try { await A.api("/api/class/work/" + C.detail.id, { method: "DELETE" }); A.toast("지웠어요."); C.tab = "work"; A.go("class/" + C.sid); } catch (e) { A.toast(e.message, "err"); }
  };
  function cwForm(cw, kind) {
    const st = { images: [], attachments: cw ? cw.attachments.slice() : [] };
    A.attState = st;
    A.attRepaint = () => { const b = A.$("#att-box"); if (b) b.innerHTML = A.attachEditor(st); };
    const q = (cw && cw.question) || { type: "choice", options: ["", ""], showAnswers: true };
    A.qDraft = { type: q.type, options: (q.options || ["", ""]).slice(), showAnswers: q.showAnswers };
    const topics = Array.from(new Set(((C.work && C.work.work) || []).map((x) => x.topic).filter(Boolean)));
    const due = cw && cw.due ? cw.due : "";
    const def = A.addDays(A.today(), 7);
    const render = () => `<div class="dr-top"><b>${KIND[kind][0]} ${cw ? KIND[kind][1] + " 고치기" : "새 " + KIND[kind][1]}</b><span class="sp-f"></span><button class="icon-btn" data-act="closeDrawer" aria-label="닫기">✕</button></div>
      <form id="cw-form" class="form">
        <label class="fld">제목<input id="cw-title" maxlength="100" required value="${esc(cw ? cw.title : "")}" placeholder="${kind === "question" ? "예: 오늘 배운 내용 중 가장 어려웠던 것은?" : kind === "material" ? "예: 기말고사 범위 정리" : "예: 실험 보고서 제출"}"></label>
        <label class="fld">${kind === "material" ? "설명" : "안내"} <small class="muted">(선택)</small><textarea id="cw-ins" rows="5" maxlength="5000">${esc(cw ? cw.instructions : "")}</textarea></label>
        ${kind === "question" ? `<div class="fld"><span>답 형식</span><div class="seg wide">${[["choice", "객관식"], ["short", "단답형"]].map(([k, l]) => `<button type="button" class="${A.qDraft.type === k ? "on" : ""}" data-act="qType" data-v="${k}">${l}</button>`).join("")}</div></div>
          <div id="q-opts">${optsHtml()}</div>
          <label class="tgl"><input type="checkbox" id="q-show" ${A.qDraft.showAnswers ? "checked" : ""}> 학생이 답을 낸 뒤 반 친구들 답 보기</label>` : ""}
        ${kind !== "material" ? `<div class="row2"><label class="fld">점수 <small class="muted">(비우면 점수 없음)</small><input id="cw-points" type="number" min="1" max="1000" value="${cw ? cw.points || "" : kind === "assignment" ? 10 : ""}"></label>
          <label class="fld">주제<input id="cw-topic" list="topic-list" maxlength="30" value="${esc(cw ? cw.topic : C.topic || "")}" placeholder="예: 수행평가"><datalist id="topic-list">${topics.map((t) => `<option value="${esc(t)}">`).join("")}</datalist></label></div>
          <div class="row2"><label class="fld">마감 날짜<input id="cw-due-d" type="date" value="${esc(due ? due.slice(0, 10) : cw ? "" : def)}"></label><label class="fld">시간<input id="cw-due-t" type="time" value="${esc(due ? due.slice(11, 16) : "23:59")}"></label></div>
          <p class="hint">마감이 있으면 반 공유 달력에도 자동으로 표시돼요.</p>`
          : `<label class="fld">주제<input id="cw-topic" list="topic-list" maxlength="30" value="${esc(cw ? cw.topic : C.topic || "")}"><datalist id="topic-list">${topics.map((t) => `<option value="${esc(t)}">`).join("")}</datalist></label>`}
        <div class="fld"><span>첨부 (사진·PDF·한글·PPT…)</span><div id="att-box">${A.attachEditor(st)}</div></div>
        <div class="form-btns"><button type="button" class="btn" data-act="closeDrawer">취소</button><button class="btn primary" type="submit">${cw ? "저장" : kind === "material" ? "게시" : "과제 내기"}</button></div>
      </form>`;
    D.onChanged = null;
    D.open("cw-form", render);
    D.editing = true;
    A.cwEditing = { cw, kind };
  }
  function optsHtml() {
    if (A.qDraft.type !== "choice") return "";
    return `<div class="fld"><span>보기</span>${A.qDraft.options.map((o, i) => `<div class="opt-row"><span class="opt-n">${i + 1}</span><input class="q-opt" data-i="${i}" maxlength="100" value="${esc(o)}" placeholder="보기 ${i + 1}" data-in="qOpt">${A.qDraft.options.length > 2 ? `<button type="button" class="icon-btn sm" data-act="qDel" data-i="${i}" aria-label="보기 빼기">✕</button>` : ""}</div>`).join("")}
      ${A.qDraft.options.length < 8 ? `<button type="button" class="link small" data-act="qAdd">＋ 보기 추가</button>` : ""}</div>`;
  }
  const paintOpts = () => { const b = A.$("#q-opts"); if (b) b.innerHTML = optsHtml(); };
  A.acts.qType = (el) => { A.qDraft.type = el.dataset.v; A.$$("[data-act=qType]").forEach((b) => b.classList.toggle("on", b === el)); paintOpts(); };
  A.inputs.qOpt = (el) => { A.qDraft.options[Number(el.dataset.i)] = el.value; };
  A.acts.qAdd = () => { A.qDraft.options.push(""); paintOpts(); const l = A.$$(".q-opt"); l[l.length - 1].focus(); };
  A.acts.qDel = (el) => { A.qDraft.options.splice(Number(el.dataset.i), 1); paintOpts(); };
  document.addEventListener("submit", async (ev) => {
    if (ev.target.id !== "cw-form") return;
    ev.preventDefault();
    const { cw, kind } = A.cwEditing, st = A.attState;
    const v = (id) => (A.$("#" + id) ? A.$("#" + id).value : "");
    const body = { subject: C.sid, kind, title: v("cw-title"), instructions: v("cw-ins"), topic: v("cw-topic"), points: v("cw-points") || null,
      due: v("cw-due-d") ? v("cw-due-d") + "T" + (v("cw-due-t") || "23:59") : null, attachments: st.images.concat(st.attachments).map((m) => m.id) };
    if (kind === "question") body.question = { type: A.qDraft.type, options: A.qDraft.options.filter((o) => o.trim()), showAnswers: A.$("#q-show").checked };
    try {
      const r = await A.api(cw ? "/api/class/work/" + cw.id : "/api/class/work", { method: cw ? "PATCH" : "POST", body });
      D.editing = false; D.close();
      A.toast(cw ? "저장했어요." : `${KIND[kind][1]}을(를) 냈어요. 학생들 화면에 바로 보여요.`);
      if (cw) { C.detail = await A.api("/api/class/work/" + r.id); A.renderMain(); } else A.go(`class/${C.sid}/${r.id}`);
    } catch (e) { A.toast(e.message, "err"); }
  });
  document.addEventListener("click", (ev) => { const p = A.$("#mk-pop"); if (p && !p.hidden && !ev.target.closest(".mk-menu")) p.hidden = true; });
})();
