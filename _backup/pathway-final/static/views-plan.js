/* 공부 계획: 주간 캘린더, 배분 근거("왜?"), 학사일정(나이스), 시험 시간표, 공부 가능 시간, 재조정 기록 */
(function () {
  "use strict";
  const A = window.App, PE = window.PE, UI = window.UI;
  const esc = UI.esc;
  const REASON = { new: "처음 계획", edit: "입력이 바뀌어 다시 맞춤", missed: "밀린 계획 자동 재조정", replan: "직접 다시 짜기" };

  A.views.plan = {
    render() {
      const st = A.state, today = A.today(), c = A.calc();
      let html = `<div class="page-h large-title"><h1>공부 계획</h1><div class="row gap wrap">
        <button class="btn small" data-act="availModal">⏱ 공부 가능 시간</button>
        <button class="btn small primary" data-act="replanNow">🔁 다시 짜기</button></div></div>`;
      if (!st.plan) {
        html += `<div class="vg"><div class="card empty c-12"><p>아직 계획이 없어요. 과목에 다음 시험 날짜가 있어야 계획을 만들 수 있어요.</p><button class="btn primary" data-act="replanNow">계획 만들기</button></div>`;
        html += calendarCard() + examTable() + `</div>`;
        return html;
      }
      const alloc = Object.values(st.plan.alloc || {}).reduce((a, b) => a + b, 0);
      const last = c.upcoming.length ? c.upcoming[c.upcoming.length - 1].ex.date : null;
      html += `<div class="vg">`;
      html += planStats(c);
      html += `<p class="muted intro c-12">${UI.fmtDate(st.plan.from)}부터 ${last ? UI.fmtDate(last) + " 시험까지" : ""} 총 <b>${UI.fmtHShort(alloc)}</b>을 배정했어요${st.plan.free >= 60 ? `, 여유 ${UI.fmtHShort(st.plan.free)}는 쉬는 시간으로 남겼어요` : ""}.</p>`;
      if (c.missed.min > 0 && PE.needsReplan(st, today)) html += `<section class="banner warn c-12"><div><b>밀린 공부 ${UI.fmtH(c.missed.min)}</b><p>남은 기간에 맞춰 다시 나눌 수 있어요.</p></div><button class="btn primary" data-act="replanNow">다시 짜기</button></section>`;
      html += weekCard();
      html += whyCard();
      html += calendarCard();
      html += examTable();
      html += historyCard();
      html += `</div>`;
      return html;
    },
  };

  // 위의 숫자 칸
  function planStats(c) {
    const st = A.state, today = A.today();
    const fut = st.plan.items.filter((it) => it.date >= today && A.subject(it.sid));
    const left = fut.reduce((a, it) => a + it.min - (it.date === today ? PE.itemDone(st, it.id) : 0), 0);
    const days = new Set(fut.map((it) => it.date)).size;
    const done = Object.values(c.done).reduce((a, b) => a + b, 0);
    const last = c.upcoming.length ? c.upcoming[c.upcoming.length - 1].ex.date : null;
    return `<section class="kpis c-12" aria-label="계획 요약">
      <div class="kpi"><span class="kpi-lab">시험까지 남은 공부</span><b class="kpi-big">${UI.fmtHShort(left)}</b><span class="kpi-sub">${days}일에 나눔</span></div>
      <div class="kpi"><span class="kpi-lab">지금까지 한 공부</span><b class="kpi-big">${UI.fmtHShort(done)}</b><span class="kpi-sub">이번 시험 준비</span></div>
      <div class="kpi"><span class="kpi-lab">하루 평균</span><b class="kpi-big">${UI.fmtHShort(days ? left / days : 0)}</b><span class="kpi-sub">평일 ${UI.fmtHShort(st.availability.weekday)} · 주말 ${UI.fmtHShort(st.availability.weekend)} 가능</span></div>
      <div class="kpi"><span class="kpi-lab">마지막 시험</span><b class="kpi-big">${last ? UI.dday(today, last) : "–"}</b><span class="kpi-sub">${last ? UI.fmtDate(last) : ""}${st.plan.free >= 60 ? " · 여유 " + UI.fmtHShort(st.plan.free) : ""}</span></div>
    </section>`;
  }

  // ───── 주간 캘린더 ─────
  function weekCard() {
    const st = A.state, today = A.today();
    const off = A.ui.weekOffset || 0;
    const start = PE.addDays(today, -((PE.dow(today) + 6) % 7) + off * 7);
    const evs = st.calendar.events || [];
    let cols = "";
    for (let i = 0; i < 7; i++) {
      const d = PE.addDays(start, i);
      const items = st.plan.items.filter((it) => it.date === d && A.subject(it.sid));
      const dayEv = evs.filter((e) => e.date === d);
      const exams = A.subjects().map((s) => ({ s, e: (s.components || []).find((c) => c.kind === "exam" && c.date === d) })).filter((x) => x.e);
      const cap = PE.capacityOf(d, st.availability, st.calendar);
      const planned = items.reduce((a, it) => a + it.min, 0);
      const doneAll = st.log.filter((l) => l.date === d).reduce((a, l) => a + l.min, 0);
      const cls = [d === today ? "today" : "", d < today ? "past" : "", PE.dayKind(d, st.calendar) !== "weekday" ? "off" : ""].join(" ");
      cols += `<div class="wk-day ${cls}" role="listitem" aria-label="${UI.fmtDate(d)}">
        <div class="wk-h"><b>${UI.fmtDate(d, false)} <small class="muted">${"일월화수목금토"[PE.dow(d)]}</small></b>${d === today ? `<span class="tag">오늘</span>` : ""}<button class="link small" data-act="dayCap" data-d="${d}" aria-label="${UI.fmtDate(d)} 공부 가능 시간 바꾸기">${UI.fmtHShort(cap)}</button></div>
        ${dayEv.filter((e) => e.type !== "exam").map((e) => `<div class="wk-ev ${e.type}">${e.type === "holiday" ? "🏖" : e.type === "mock" ? "📝" : "📌"} ${esc(e.name)}</div>`).join("")}
        ${exams.map((x) => `<div class="wk-ev exam">✏️ ${esc(x.s.name)} 시험</div>`).join("")}
        ${items.map((it) => {
          const s = A.subject(it.sid), dn = PE.itemDone(st, it.id), full = dn >= it.min;
          return `<button class="wk-it ${full ? "done" : dn > 0 ? "part" : d < today ? "miss" : ""}" style="--sc:${UI.colorOf(st, it.sid)}" data-act="toggleItemWk" data-id="${it.id}" aria-pressed="${full}"
            title="${esc(s.name)} · ${esc(it.task)}"><b>${esc(s.name)}</b><span>${UI.fmtH(it.min)}${dn > 0 && !full ? ` (${UI.fmtH(dn)})` : ""}</span><small>${esc(it.task)}</small></button>`;
        }).join("") || (d >= today ? `<p class="muted small wk-empty">쉬는 날</p>` : "")}
        ${d <= today && (planned || doneAll) ? `<div class="wk-f">${planned ? UI.bar(Math.min(1, doneAll / planned), "var(--good)", "달성 " + UI.pct(Math.min(1, doneAll / planned))) : ""}<small>${UI.fmtHShort(doneAll)} 함</small></div>` : ""}
      </div>`;
    }
    return `<section class="card c-12"><div class="card-h"><h2>주간 캘린더</h2>
      <div class="row gap"><button class="icon-btn" data-act="wkPrev" aria-label="지난주">‹</button><span class="small">${UI.fmtDate(start, false)} ~ ${UI.fmtDate(PE.addDays(start, 6), false)}</span><button class="icon-btn" data-act="wkNext" aria-label="다음 주">›</button>${off ? `<button class="btn small" data-act="wkToday">이번 주</button>` : ""}</div></div>
      <div class="week" role="list">${cols}</div>
      <p class="muted small">칸을 누르면 완료/취소. 빨간 테두리는 못 한 계획이에요 — 다음 날 들어오면 자동으로 다시 나눠요.</p></section>`;
  }
  A.acts.wkPrev = () => { A.ui.weekOffset = (A.ui.weekOffset || 0) - 1; A.rerender(); };
  A.acts.wkNext = () => { A.ui.weekOffset = (A.ui.weekOffset || 0) + 1; A.rerender(); };
  A.acts.wkToday = () => { A.ui.weekOffset = 0; A.rerender(); };
  A.acts.toggleItemWk = (el) => { A.toggleItem(el.dataset.id); A.rerender(); };

  // ───── 왜 이 과목에 이만큼? ─────
  function whyCard() {
    const st = A.state, c = A.calc(), n = A.n(), m = A.major();
    const rows = c.ex.rows;
    if (!rows.length) return "";
    const maxM = Math.max(1e-9, ...rows.map((r) => r.marginal));
    return `<section class="card why-full c-12"><h2>왜 이 과목에 이만큼? <small class="muted">③ 내신 역산 → ④ 시간 배분</small></h2>
      <div class="why-rows">${rows.map((r) => `
        <div class="why-r" style="--sc:${UI.colorOf(st, r.sid)}">
          <div class="why-top"><span class="why-rank">${r.priority}</span><b>${esc(r.name)}</b>
            <span class="why-h">${UI.fmtHShort(r.future)} 남음${r.done ? ` · ${UI.fmtHShort(r.done)} 함` : ""}</span>
            <span class="why-g"><span class="gbadge ${UI.gradeTone(r.now.expGrade, r.now.cuts.length + 1)}">${r.now.expGrade.toFixed(2)}</span> → <span class="gbadge ${UI.gradeTone(r.fin.expGrade, r.fin.cuts.length + 1)}">${r.fin.expGrade.toFixed(2)}</span></span></div>
          <p class="why-txt">${esc(A.whyLine(r, n))}</p>
          <div class="why-meta">
            <span>목표 ${r.req.target}등급 달성 확률 <b>${UI.pct(r.fin.pTarget)}</b></span>
            <span>무게 ${r.weight.toFixed(1)} <small class="muted">(${r.credits}학점${r.careerW > 1 && st.profile.careerWeight !== false ? " × 진로 " + r.careerW : ""})</small></span>
            <span class="why-mv">1시간 더 하면 ${UI.bar(r.marginal / maxM, "var(--sc)", "1시간 가치")} <small>평균 −${(r.marginal).toFixed(4)}</small></span>
          </div>
        </div>`).join("")}</div>
      <details class="how"><summary>이렇게 계산해요 (알고리즘)</summary>
        <ol>
          <li><b>과목 무게</b> = 학점 × 진로 가중치${m ? ` (${esc(m.name)}: ${Object.entries(m.areaWeights).map(([k, v]) => k + " ×" + v).join(", ")})` : ""} × (성취도만 나오는 과목은 0.5)</li>
          <li><b>공부 효과 모델</b>: 점수(H) = 100 − (100 − 지난 점수) × 0.6<sup>(H − 지난 공부 시간) ÷ 범위 한 번 공부 시간</sup> — 범위를 한 번 더 공부할 때마다 모자란 점수의 40%를 채워요</li>
          <li><b>예상 등급</b>: 반 점수 분포(평균·표준편차) → 등급 경계 점수, 시험 운(±σ)을 정규분포로 보고 등급마다 확률을 더해요</li>
          <li><b>최적 배분</b>: 30분씩, 평균등급(무게 가중)을 가장 많이 내리는 과목에 줘요. 등급 경계 너머 이득도 보려고 30분~16시간 덩어리를 같이 비교해요</li>
          <li><b>바꿔 보기</b>: 어느 과목에서 어느 과목으로 시간을 옮겨도 더 나아지지 않을 때까지 교환해요 → 위의 '1시간 가치'가 비슷해져요</li>
          <li><b>시험 날짜 제약</b>: 시험이 빠른 과목들 시간의 합 ≤ 그 시험 전날까지 공부할 수 있는 시간</li>
          <li><b>일별 계획표</b>: 날마다 꼭 해야 하는 양을 먼저 넣고, 나머지는 '남은 양 ÷ 남은 시간'이 큰 과목부터. 단원 개념 60% → 문제 풀이 30% → 총정리 10%</li>
          <li><b>자동 재조정</b>: 못 한 시간은 사라지는 게 아니라, 오늘부터 남은 시간으로 1~7을 다시 풀어요</li>
        </ol></details>
    </section>`;
  }

  // ───── 학사일정 ─────
  function calendarCard() {
    const st = A.state, today = A.today(), cal = st.calendar;
    const evs = (cal.events || []).filter((e) => e.date >= today).slice(0, 400);
    // 같은 이름이 이어지는 날은 한 줄로 (예: 겨울방학)
    const groups = [];
    for (const e of evs) {
      const g = groups[groups.length - 1];
      if (g && g.name === e.name && PE.daysBetween(g.end, e.date) <= 3) g.end = e.date;
      else groups.push({ name: e.name, type: e.type, start: e.date, end: e.date });
    }
    const src = { neis: "나이스 학사일정 (실제)", sample: "체험용 일정 (나이스 기준)", manual: "직접 넣은 일정", none: "일정 없음" }[cal.source] || "일정";
    const sc = st.profile.school;
    return `<section class="card c-6"><div class="card-h"><h2>학사일정 <small class="muted">${esc(src)}${sc ? " · " + esc(sc.name) + " " + st.profile.grade + "학년" : ""}</small></h2>
      <div class="row gap"><button class="btn small" data-act="neisReload">${sc ? "나이스에서 다시 불러오기" : "학교 정하고 불러오기"}</button><button class="btn small" data-act="eventAdd">+ 직접 추가</button></div></div>
      ${groups.length ? `<ul class="ev-list">${groups.slice(0, 14).map((g) => `<li class="${g.type}"><span class="ev-d">${UI.fmtDate(g.start)}${g.end !== g.start ? " ~ " + UI.fmtDate(g.end) : ""}</span><span>${g.type === "exam" ? "✏️" : g.type === "holiday" ? "🏖" : g.type === "mock" ? "📝" : "📌"} ${esc(g.name)}</span><span class="muted small">${UI.dday(today, g.start)}</span></li>`).join("")}</ul>`
        : `<p class="muted">다가오는 일정이 없어요. 시험 날짜는 아래 '시험 시간표'에서 직접 넣을 수 있어요.</p>`}
      <p class="muted small">공휴일·휴업일은 주말처럼 공부 시간을 계산해요. ${cal.fetchedAt ? "불러온 날: " + esc(String(cal.fetchedAt).slice(0, 10)) : ""}</p></section>`;
  }

  A.acts.neisReload = async () => {
    const st = A.state, sc = st.profile.school;
    if (!sc) { schoolModal(); return; }
    A.toast("나이스에서 불러오는 중…");
    try {
      const r = await A.api(`/api/neis/schedule?office=${encodeURIComponent(sc.office)}&school=${encodeURIComponent(sc.code)}&grade=${st.profile.grade}`);
      const manual = (st.calendar.events || []).filter((e) => e.manual);
      st.calendar = { source: "neis", events: r.events.concat(manual), exams: r.exams, fetchedAt: r.fetchedAt };
      A.save(); A.rev++;
      const next = (r.exams || []).find((e) => e.end >= A.today());
      A.toast(`일정 ${r.events.length}개를 불러왔어요${next ? ` · 다음 시험 ${UI.fmtDate(next.start)}~${UI.fmtDate(next.end)}` : ""}`);
      A.rebuild("edit", { quiet: true });
      A.rerender();
    } catch (e) { A.toast(e.message + " 일정은 직접 넣을 수 있어요."); }
  };

  function schoolModal() {
    A.modal(`<h2>학교 찾기</h2><label class="field">학교 이름 <input id="sm-q" data-in="smQ" placeholder="예: 춘천고" autocomplete="off"></label><div id="sm-res" aria-live="polite"></div>
      <div class="field"><span>학년</span><div class="seg">${[1, 2, 3].map((g) => `<button class="${A.state.profile.grade === g ? "on" : ""}" data-act="smGrade" data-v="${g}">${g}학년</button>`).join("")}</div></div>`);
  }
  let smT = 0, smList = [];
  A.inputs.smQ = (el) => {
    clearTimeout(smT);
    const q = el.value.trim();
    if (q.length < 2) return;
    smT = setTimeout(async () => {
      try {
        const r = await A.api("/api/neis/schools?q=" + encodeURIComponent(q));
        smList = r.schools;
        A.$("#sm-res").innerHTML = smList.length ? `<ul class="list-plain">${smList.map((s, i) => `<li><button class="school-opt" data-act="smPick" data-i="${i}"><b>${esc(s.name)}</b><small>${esc(s.region)} · ${esc(s.address)}</small></button></li>`).join("")}</ul>` : `<p class="muted small">찾은 학교가 없어요.</p>`;
      } catch (e) { A.$("#sm-res").innerHTML = `<p class="warn small">${esc(e.message)}</p>`; }
    }, 350);
  };
  A.acts.smGrade = (el) => { A.state.profile.grade = Number(el.dataset.v); A.save(); for (const b of el.parentNode.children) b.classList.toggle("on", b === el); };
  A.acts.smPick = (el) => { A.state.profile.school = smList[Number(el.dataset.i)]; A.save(); A.closeModal(); A.acts.neisReload(); };

  A.acts.eventAdd = () => {
    A.modal(`<h2>일정 직접 추가</h2>
      <label class="field">날짜 <input type="date" id="ea-d" value="${A.today()}"></label>
      <label class="field">이름 <input id="ea-n" maxlength="30" placeholder="예: 학원 시험, 가족 여행"></label>
      <label class="field">종류 <select id="ea-t"><option value="holiday">쉬는 날 (주말처럼 계산)</option><option value="event">행사</option><option value="exam">시험</option></select></label>
      <div class="row gap"><button class="btn" data-act="closeModal">취소</button><button class="btn primary" data-act="eventAddYes">추가</button></div>`);
  };
  A.acts.eventAddYes = () => {
    const d = A.$("#ea-d").value, n = A.$("#ea-n").value.trim().slice(0, 30), t = A.$("#ea-t").value;
    if (!PE.isValidYmd(d) || !n) { A.toast("날짜와 이름을 넣어 주세요."); return; }
    const cal = A.state.calendar;
    cal.events = (cal.events || []).concat([{ date: d, name: n, type: t, manual: true }]).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (cal.source === "none") cal.source = "manual";
    A.closeModal(); A.rebuild("edit", { quiet: true }); A.rerender();
  };

  // ───── 시험 시간표 (과목별 날짜) ─────
  function examTable() {
    const today = A.today();
    const subs = A.subjects().filter((s) => s.evalType !== "pass");
    const period = (A.state.calendar.exams || []).find((e) => e.end >= today);
    return `<section class="card c-6"><h2>시험 시간표 <small class="muted">과목마다 다음 지필 시험 날짜</small></h2>
      ${period ? `<p class="small">📅 ${esc(period.name)}: ${period.days.map((d) => UI.fmtDate(d)).join(", ")}</p>` : ""}
      <div class="ex-tbl">${subs.map((s) => {
        const nx = PE.nextExam(s);
        return `<div class="ex-r"><span><span class="dot" style="background:${UI.colorOf(A.state, s.id)}"></span>${esc(s.name)}</span>
          ${nx ? `<span class="row gap wrap">${period ? period.days.map((d) => `<button class="chip-btn small ${nx.date === d ? "on" : ""}" data-act="exDay" data-sid="${s.id}" data-d="${d}" aria-pressed="${nx.date === d}">${UI.fmtDate(d)}</button>`).join("") : ""}
            <input type="date" aria-label="${esc(s.name)} 시험 날짜" data-ch="exDate" data-sid="${s.id}" value="${esc(nx.date)}"></span>`
            : `<span class="muted small">남은 지필 시험 없음 <button class="link small" data-act="exAdd" data-sid="${s.id}">+ 시험 추가</button></span>`}</div>`;
      }).join("")}</div></section>`;
  }
  function setExam(sid, d) {
    const s = A.subject(sid), nx = PE.nextExam(s);
    if (!nx || !PE.isValidYmd(d)) return;
    nx.date = d;
    A.rebuild("edit", { quiet: true });
    A.rerender();
  }
  A.acts.exDay = (el) => setExam(el.dataset.sid, el.dataset.d);
  A.changes.exDate = (el) => setExam(el.dataset.sid, el.value);
  A.acts.exAdd = (el) => {
    const s = A.subject(el.dataset.sid);
    const p = (A.state.calendar.exams || []).find((e) => e.start > A.today());
    s.components.push({ id: PE.newId("c"), name: "기말고사", kind: "exam", weight: 40, max: 100, score: null, expected: null, date: p ? p.start : PE.addDays(A.today(), 30) });
    if (!s.prepFrom || s.prepFrom < A.today()) s.prepFrom = A.today();
    A.rebuild("edit", { quiet: true }); A.rerender();
  };

  // ───── 공부 가능 시간 ─────
  A.acts.availModal = () => {
    const av = A.state.availability;
    const opt = (list) => list.map((v) => ({ v, label: UI.fmtH(v), sub: v === 0 ? "공부 안 하는 날" : "" }));
    A.flow({
      steps: [
        { q: "평일에는 하루<br>몇 시간 공부할 수 있나요?", sub: `지금은 ${UI.fmtH(av.weekday)}이에요. 학원·숙제 시간을 빼고 생각해 주세요.`, key: "wd", options: opt([60, 90, 120, 150, 180, 240, 300]) },
        { q: "주말·쉬는 날에는<br>몇 시간 할 수 있나요?", sub: `지금은 ${UI.fmtH(av.weekend)}이에요. 공휴일·휴업일도 이 시간으로 계산해요.`, key: "we", options: opt([120, 180, 240, 300, 360, 480, 600]) },
      ],
      finish: (c) => {
        const before = A.calc().avgPlan;
        av.weekday = c.wd; av.weekend = c.we;
        A.rebuild("edit", { quiet: true });
        return { emoji: "⏱", title: "공부 시간에 맞춰<br>계획을 다시 짰어요", sub: `평일 ${UI.fmtH(c.wd)} · 주말 ${UI.fmtH(c.we)}. 예상 평균등급 ${UI.fmtG(before)} → ${UI.fmtG(A.calc().avgPlan)}` };
      },
    });
  };
  A.acts.dayCap = (el) => {
    const d = el.dataset.d, cur = PE.capacityOf(d, A.state.availability, A.state.calendar);
    A.flow({
      steps: [{ q: `${UI.fmtDate(d)}에는<br>몇 시간 할 수 있나요?`, sub: `지금은 ${UI.fmtH(cur)}이에요. 그날만 바뀌어요.`, key: "m",
        options: [0, 60, 120, 180, 240, 300, 360, 480].map((v) => ({ v, label: UI.fmtH(v), sub: v === 0 ? "이날은 쉴래요" : "" })).concat([{ v: "reset", label: "원래대로", sub: "평일·주말 기본 시간" }]) }],
      finish: (c) => {
        if (c.m === "reset") delete A.state.availability.overrides[d]; else A.state.availability.overrides[d] = c.m;
        A.rebuild("edit", { quiet: true });
        return { emoji: "🗓️", title: `${UI.fmtDate(d)} 계획을<br>다시 나눴어요`, sub: "모자라는 시간은 다른 날로 옮겼어요." };
      },
    });
  };

  // ───── 재조정 기록 ─────
  function historyCard() {
    const h = (A.state.planHistory || []).slice().reverse().filter((x) => x.reason !== "edit").slice(0, 8);
    const edits = (A.state.planHistory || []).filter((x) => x.reason === "edit").length;
    if (!h.length) return "";
    return `<section class="card c-12"><h2>계획 바뀐 기록</h2><ul class="hist">${h.map((x) => `<li><span class="muted small">${UI.fmtDate(x.at)}</span> <b>${esc(REASON[x.reason] || x.reason)}</b>${x.missedMin ? ` · 밀린 ${UI.fmtH(x.missedMin)}` : ""}${x.before !== undefined && x.before !== null && x.after !== undefined && x.after !== null ? ` · 예상 ${UI.fmtG(x.before)} → ${UI.fmtG(x.after)}` : ""}</li>`).join("")}</ul>
      ${edits ? `<p class="muted small">입력이 바뀌어 자동으로 다시 맞춘 횟수: ${edits}번</p>` : ""}</section>`;
  }
})();
