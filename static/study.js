/* 공부 타이머 (열품타처럼): 과목 골라 시작/멈춤, 오늘 총 공부 시간, 목표, 과목별·요일별 그래프, 반 순위와 '지금 공부 중' */
(function () {
  "use strict";
  const A = window.App, esc = A.esc;
  const S = (A.study = { data: null, subject: localStorage.getItem("es.studySubj") || "", goal: Number(localStorage.getItem("es.studyGoal") || 180), rankTab: "today", offset: 0, busy: false });
  const COLORS = ["#3182f6", "#f04452", "#15c47e", "#fe9800", "#8b5cf6", "#06b6d4", "#ec4899", "#6366f1", "#a16207", "#84cc16"];

  const hms = (sec) => { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`; };
  const hm = (sec) => { const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60); return h ? `${h}시간 ${m}분` : `${m}분`; };
  const nowSrv = () => Date.now() / 1000 + S.offset;
  const myRunning = () => S.data && S.data.me.running;
  const runSec = () => (myRunning() ? nowSrv() - myRunning().start : 0);
  const todaySec = () => S.data ? S.data.me.today - (myRunning() ? S.data.me.running.elapsed : 0) + runSec() : 0;
  const colorOf = (name) => { const i = A.subjects.findIndex((x) => x.name === name); return i >= 0 ? A.subjects[i].color : COLORS[Math.abs([...name].reduce((a, c) => a + c.charCodeAt(0), 0)) % COLORS.length]; };

  async function load() {
    const r = await A.api("/api/study?scope=" + encodeURIComponent(A.scope));
    S.offset = r.now - Date.now() / 1000;
    S.data = r;
    if (!S.subject) S.subject = (A.subjects[0] && A.subjects[0].name) || "자습";
    paintSide();
    return r;
  }
  A.loadStudy = load;

  A.views.study = {
    async load() { if (!A.subjects.length) await A.loadSubjects(); await load(); },
    render() {
      const d = S.data, me = d.me, run = me.running;
      const t = todaySec(), goal = S.goal * 60, pct = Math.min(1, t / goal);
      const R = 118, C = 2 * Math.PI * R;
      const subjects = A.subjects.map((x) => x.name).concat(["자습", "독서"]).filter((v, i, a) => a.indexOf(v) === i);
      const by = Object.entries(me.bySubject).map(([k, v]) => [k, v + (run && run.subject === k ? runSec() - run.elapsed : 0)]).sort((a, b) => b[1] - a[1]);
      const days = [];
      for (let i = 6; i >= 0; i--) { const dd = A.addDays(A.today(), -i); days.push([dd, dd === A.today() ? t : me.days[dd] || 0]); }
      const maxD = Math.max(3600, ...days.map((x) => x[1]));
      const ranking = d.ranking.slice().sort((a, b) => S.rankTab === "today" ? b.today - a.today : b.week - a.week);
      return `<header class="page-h"><div><p class="eyebrow">${esc(A.scopeLabel(A.scope))} · ${esc(A.me.schoolName)}</p><h1>공부 타이머</h1>
          <p class="page-sub">과목을 고르고 시작을 누르면 공부 시간이 쌓여요. 반 친구들과 오늘 몇 시간 했는지 함께 봐요.</p></div>
          <span class="badge study-now"><i class="dot-live"></i> 지금 공부 중 ${d.studying}명</span></header>
        <div class="study-grid">
          <section class="card timer-card ${run ? "running" : ""}">
            <div class="ring-wrap">
              <svg viewBox="0 0 260 260" class="t-ring" aria-hidden="true"><circle cx="130" cy="130" r="${R}" class="tr-bg"/><circle cx="130" cy="130" r="${R}" class="tr-fg" stroke-dasharray="${(C * pct).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 130 130)"/></svg>
              <div class="t-center"><small>오늘 공부한 시간</small><b id="st-total">${hms(t)}</b><span id="st-cur" class="t-cur">${run ? `<i class="dot-live"></i>${esc(run.subject)} ${hms(runSec())}` : "멈춤"}</span></div>
            </div>
            ${d.mine ? `<div class="subj-pick" role="radiogroup" aria-label="과목">${subjects.map((n) => `<button class="sp ${S.subject === n ? "on" : ""}" role="radio" aria-checked="${S.subject === n}" data-act="stSubj" data-v="${esc(n)}" style="--c:${colorOf(n)}">${esc(n)}</button>`).join("")}</div>
              <button class="btn big ${run ? "stop" : "primary"} t-btn" data-act="${run ? "stStop" : "stStart"}">${run ? "⏸ 멈추기" : `▶ ${esc(S.subject)} 공부 시작`}</button>
              ${run && run.subject !== S.subject ? `<button class="link" data-act="stStart">↪ ${esc(S.subject)}(으)로 바꾸기</button>` : ""}
              <p class="hint center">화면을 15분 넘게 닫아 두면 자동으로 멈춰요 (켜 두고 잊는 것 방지)</p>`
              : `<p class="muted center">다른 반은 순위만 볼 수 있어요.</p><button class="btn wide" data-act="myClass">내 반으로 돌아가기</button>`}
          </section>
          <section class="card">
            <div class="goal-row"><div><small class="muted">오늘 목표</small><b>${hm(goal)}</b></div>
              <div class="goal-ctl"><button class="icon-btn sm" data-act="stGoal" data-v="-30" aria-label="목표 줄이기">−</button><b>${Math.round(pct * 100)}%</b><button class="icon-btn sm" data-act="stGoal" data-v="30" aria-label="목표 늘리기">＋</button></div>
              <div><small class="muted">연속 공부</small><b>${me.streak}일 🔥</b></div></div>
            <h3>오늘 과목별</h3>
            ${by.length ? `<ul class="sbars">${by.map(([k, v]) => `<li><span class="sb-name"><i style="background:${colorOf(k)}"></i>${esc(k)}</span><span class="sb-bar"><i style="width:${(v / Math.max(1, by[0][1]) * 100).toFixed(0)}%;background:${colorOf(k)}"></i></span><b>${hm(v)}</b></li>`).join("")}</ul>` : `<p class="muted small">아직 오늘 공부 기록이 없어요.</p>`}
            <h3>최근 7일</h3>
            <div class="wchart">${days.map(([dd, v]) => `<div class="wc ${dd === A.today() ? "today" : ""}"><small>${v ? (v >= 3600 ? (v / 3600).toFixed(1) + "h" : Math.round(v / 60) + "m") : ""}</small><span><i style="height:${(v / maxD * 100).toFixed(0)}%"></i></span><b>${"일월화수목금토"[A.dow(dd)]}</b></div>`).join("")}</div>
            <p class="hint">이번 주(월요일부터) 합계 ${hm(weekSum(days))}</p>
          </section>
          <section class="card rank-card">
            <div class="cal-h"><h2>🏆 ${esc(A.scopeLabel(A.scope))} 순위</h2><div class="seg sm">${[["today", "오늘"], ["week", "이번 주"]].map(([k, l]) => `<button class="${S.rankTab === k ? "on" : ""}" data-act="stRank" data-v="${k}">${l}</button>`).join("")}</div></div>
            ${ranking.length ? `<ol class="rank">${ranking.map((x, i) => {
              const sec = S.rankTab === "today" ? x.today : x.week;
              return `<li class="${x.user.id === A.me.id ? "me" : ""}"><span class="rk ${i < 3 ? "top" + i : ""}">${i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</span>${A.avatar(x.user)}
                <span class="rm"><b>${esc(x.user.name)}${x.user.id === A.me.id ? " (나)" : ""}</b>${x.running ? `<small class="on"><i class="dot-live"></i>${esc(x.running.subject)} 공부 중</small>` : `<small>쉬는 중</small>`}</span>
                <b class="rt" data-uid="${x.user.id}" data-base="${sec}" data-run="${x.running ? x.running.start : ""}" data-snap="${d.now}">${hm(sec)}</b></li>`;
            }).join("")}</ol>` : `<div class="empty-mini"><span>📚</span><p>아직 공부를 시작한 친구가 없어요. 첫 번째가 되어 보세요!</p></div>`}
          </section>
        </div>`;
    },
    onChanged(kind) { if (kind === "study") load().then(() => { if (A.route.tab === "study") A.renderMain(); }).catch(() => {}); },
  };

  function weekSum(days) { const mon = A.addDays(A.today(), -((A.dow(A.today()) + 6) % 7)); return days.filter(([dd]) => dd >= mon).reduce((a, [, v]) => a + v, 0); }
  A.acts.stSubj = (el) => { S.subject = el.dataset.v; localStorage.setItem("es.studySubj", S.subject); A.renderMain(); };
  A.acts.stGoal = (el) => { S.goal = Math.max(30, Math.min(900, S.goal + Number(el.dataset.v))); localStorage.setItem("es.studyGoal", S.goal); A.renderMain(); };
  A.acts.stRank = (el) => { S.rankTab = el.dataset.v; A.renderMain(); };
  A.acts.stStart = async () => {
    if (S.busy) return; S.busy = true;
    try { await A.api("/api/study/start", { method: "POST", body: { subject: S.subject } }); await load(); A.renderMain(); A.toast(`${S.subject} 공부를 시작했어요. 화이팅! 💪`); }
    catch (e) { A.toast(e.message, "err"); }
    S.busy = false;
  };
  A.acts.stStop = async () => {
    if (S.busy) return; S.busy = true;
    try { const r = await A.api("/api/study/stop", { method: "POST", body: {} }); await load(); if (A.route.tab === "study") A.renderMain(); A.toast(`${r.subject} ${hm(r.seconds)} 기록했어요 👏`); }
    catch (e) { A.toast(e.message, "err"); }
    S.busy = false;
  };

  // 사이드바: 공부 중이면 시간이 보이는 알약
  function paintSide() {
    const el = A.$("#side-timer"); if (!el) return;
    const run = myRunning();
    el.innerHTML = run ? `<button class="side-timer" data-act="go" data-to="study"><i class="dot-live"></i><span>${esc(run.subject)} 공부 중</span><b id="side-t">${hms(runSec())}</b></button>` : "";
  }
  A.paintStudySide = paintSide;

  // 1초마다 시계, 1분마다 '아직 공부 중' 알림
  let lastPing = 0;
  setInterval(() => {
    if (!S.data || !A.me) return;
    const run = myRunning();
    const st = A.$("#side-t"); if (st && run) st.textContent = hms(runSec());
    if (A.route.tab === "study") {
      const tot = A.$("#st-total"); if (tot) tot.textContent = hms(todaySec());
      const cur = A.$("#st-cur"); if (cur && run) cur.innerHTML = `<i class="dot-live"></i>${esc(run.subject)} ${hms(runSec())}`;
      A.$$(".rt[data-run]").forEach((b) => { if (b.dataset.run) b.textContent = hm(Number(b.dataset.base) + (nowSrv() - Number(b.dataset.snap))); });
      const ring = A.$(".tr-fg"); if (ring) { const C = 2 * Math.PI * 118; ring.setAttribute("stroke-dasharray", `${(C * Math.min(1, todaySec() / (S.goal * 60))).toFixed(1)} ${C.toFixed(1)}`); }
    }
    if (run && !document.hidden && Date.now() - lastPing > 60000) { lastPing = Date.now(); A.api("/api/study/ping", { method: "POST", body: {} }).then((r) => { if (!r.running) load().then(() => A.route.tab === "study" && A.renderMain()); }).catch(() => {}); }
  }, 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && A.me && S.data) load().then(() => { if (A.route.tab === "study") A.renderMain(); }).catch(() => {}); });
})();
