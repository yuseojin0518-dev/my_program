/* 리포트: 주간 달성률, 진행률 그래프, 과목별 투자 시간 대비 성적 변화, 시험 결과 기록, 사용자 검증 */
(function () {
  "use strict";
  const A = window.App, PE = window.PE, UI = window.UI;
  const esc = UI.esc;

  A.views.report = {
    render() {
      let html = `<div class="page-h large-title"><h1>리포트</h1></div><div class="vg">`;
      html += reportKpis();
      html += weekCard();
      html += progressCard();
      html += heatCard();
      html += shareCard();
      html += dowCard();
      html += subjectCard();
      html += resultsCard();
      html += `<section class="card c-7" id="fb-sum"><h2>사용자 검증 숫자 <small class="muted">모든 사용자 익명 합계</small></h2><p class="muted">불러오는 중…</p></section>`;
      html += `<section class="card c-5" id="fb-card">${feedbackForm()}</section>`;
      html += `</div>`;
      return html;
    },
    after() { loadSummary(); },
  };

  function weekCard() {
    const st = A.state, today = A.today();
    const off = A.ui.repWeek || 0;
    const w = A.weekData(off);
    const rate = w.planPast ? Math.min(1, w.done / w.planPast) : 0;
    const end = PE.addDays(w.start, 6);
    const bySub = {};
    for (const l of st.log) if (l.date >= w.start && l.date <= end && l.date <= today) bySub[l.sid] = (bySub[l.sid] || 0) + l.min;
    const subs = Object.entries(bySub).filter(([sid]) => A.subject(sid)).sort((a, b) => b[1] - a[1]);
    const mx = Math.max(1, ...subs.map((x) => x[1]));
    return `<section class="card c-6"><div class="card-h"><h2>주간 달성률</h2>
      <div class="row gap"><button class="icon-btn" data-act="repPrev" aria-label="지난주">‹</button><span class="small">${UI.fmtDate(w.start, false)} ~ ${UI.fmtDate(end, false)}</span><button class="icon-btn" data-act="repNext" aria-label="다음 주" ${off >= 0 ? "disabled" : ""}>›</button></div></div>
      <p class="wk-big"><b>${UI.pct(rate)}</b> 지켰어요</p>
      <p class="wk-small">계획 ${UI.fmtH(w.planPast)} 중 ${UI.fmtH(w.done)} · 연속 ${streakDays()}일 공부</p>
      ${UI.weekBars(w.cols, { aria: "요일별 계획과 실제 공부 시간" })}
      ${subs.length ? `<ul class="sub-bars">${subs.map(([sid, v]) => `<li><span class="dot" style="background:${UI.colorOf(st, sid)}"></span><span class="sb-n">${esc(A.subject(sid).name)}</span><span class="sb-t"><span style="width:${(v / mx * 100).toFixed(1)}%;background:${UI.colorOf(st, sid)}"></span></span><b>${UI.fmtHShort(v)}</b></li>`).join("")}</ul>` : ""}
    </section>`;
  }
  A.acts.repPrev = () => { A.ui.repWeek = (A.ui.repWeek || 0) - 1; A.rerender(); };
  A.acts.repNext = () => { A.ui.repWeek = Math.min(0, (A.ui.repWeek || 0) + 1); A.rerender(); };

  function streakDays() {
    const st = A.state;
    const days = new Set(st.log.filter((l) => l.min > 0).map((l) => l.date));
    let d = A.today(), k = 0;
    if (!days.has(d)) d = PE.addDays(d, -1);
    while (days.has(d)) { k++; d = PE.addDays(d, -1); }
    return k;
  }

  function reportKpis() {
    const st = A.state, today = A.today(), by = A.byDateMinutes();
    const days = Object.keys(by).filter((d) => d <= today && by[d] > 0);
    const total = days.reduce((a, d) => a + by[d], 0);
    const d30 = PE.addDays(today, -29);
    const m30 = days.filter((d) => d >= d30).reduce((a, d) => a + by[d], 0);
    const items = ((st.plan && st.plan.items) || []).filter((it) => it.date < today && A.subject(it.sid));
    const pl = items.reduce((a, it) => a + it.min, 0), dn = items.reduce((a, it) => a + Math.min(it.min, PE.itemDone(st, it.id)), 0);
    const rs = st.results || [];
    const err = rs.length ? rs.reduce((a, r) => a + Math.abs(r.actual - r.predicted), 0) / rs.length : null;
    return `<section class="kpis c-12" aria-label="리포트 요약">
      <div class="kpi kpi-dday"><span class="kpi-lab">총 공부 시간</span><b class="kpi-big">${UI.fmtHShort(total)}</b><span class="kpi-sub">${days.length}일 동안</span></div>
      <div class="kpi"><span class="kpi-lab">최근 30일 하루 평균</span><b class="kpi-big">${UI.fmtHShort(m30 / 30)}</b><span class="kpi-sub">30일 합계 ${UI.fmtHShort(m30)}</span></div>
      <div class="kpi"><span class="kpi-lab">지난 계획 지킨 비율</span><b class="kpi-big">${pl ? UI.pct(dn / pl) : "–"}</b><span class="kpi-sub">${UI.fmtHShort(dn)} / ${UI.fmtHShort(pl)}</span></div>
      <div class="kpi"><span class="kpi-lab">예측 오차 (시험 결과)</span><b class="kpi-big">${err !== null ? "±" + err.toFixed(1) + "<small>점</small>" : "–"}</b><span class="kpi-sub">${rs.length}번의 시험으로 보정</span></div>
    </section>`;
  }

  function heatCard() {
    const by = A.byDateMinutes();
    return `<section class="card c-12"><div class="card-h"><h2>공부 잔디 <small class="muted">최근 16주</small></h2></div>
      <div class="heat-wrap">${UI.heatmap(by, A.today(), 16, { cell: 16, aria: "최근 16주 날짜별 공부 시간" })}</div>
      <p class="legend muted small">적음 <span class="hm-l hm1"></span><span class="hm-l hm2"></span><span class="hm-l hm3"></span><span class="hm-l hm4"></span> 많음 · 칸에 마우스를 올리면 그날 공부 시간이 보여요</p></section>`;
  }

  // 과목별 시간 비중: 실제로 한 것 vs 계획(시험까지)
  function shareCard() {
    const st = A.state, c = A.calc();
    const subs = A.subjects().filter((s) => (c.done[s.id] || 0) > 0 || (c.planH[s.id] || 0) > 0);
    if (!subs.length) return "";
    const done = subs.map((s) => ({ v: c.done[s.id] || 0, color: UI.colorOf(st, s.id), label: s.name + " " + UI.fmtHShort(c.done[s.id] || 0) }));
    const plan = subs.map((s) => ({ v: c.planH[s.id] || 0, color: UI.colorOf(st, s.id), label: s.name + " " + UI.fmtHShort(c.planH[s.id] || 0) }));
    const tD = done.reduce((a, p) => a + p.v, 0), tP = plan.reduce((a, p) => a + p.v, 0);
    return `<section class="card c-6"><h2>과목별 시간 비중</h2>
      <div class="donuts"><figure>${UI.donut(done, 150, UI.fmtHShort(tD), "지금까지")}<figcaption>실제로 한 공부</figcaption></figure>
        <figure>${UI.donut(plan, 150, UI.fmtHShort(tP), "시험까지")}<figcaption>계획 전체</figcaption></figure></div>
      <ul class="share-list">${subs.map((s) => `<li><span class="dot" style="background:${UI.colorOf(st, s.id)}"></span><span>${esc(s.name)}</span><b>${tD ? UI.pct((c.done[s.id] || 0) / tD) : "0%"}</b><small class="muted">→ ${tP ? UI.pct((c.planH[s.id] || 0) / tP) : "0%"}</small></li>`).join("")}</ul></section>`;
  }

  // 요일별 평균 공부 시간
  function dowCard() {
    const by = A.byDateMinutes(), today = A.today();
    const sum = [0, 0, 0, 0, 0, 0, 0], cnt = [0, 0, 0, 0, 0, 0, 0];
    const dates = Object.keys(by).sort();
    if (!dates.length) return "";
    for (let d = dates[0]; d <= today; d = PE.addDays(d, 1)) { const w = (PE.dow(d) + 6) % 7; sum[w] += by[d] || 0; cnt[w]++; }
    const avg = sum.map((v, i) => (cnt[i] ? v / cnt[i] : 0));
    const best = avg.indexOf(Math.max(...avg)), worst = avg.indexOf(Math.min(...avg));
    const names = "월화수목금토일";
    return `<section class="card c-6"><h2>요일별 공부 패턴</h2>
      ${UI.weekBars(avg.map((v, i) => ({ label: names[i], done: v, hl: i === best })), { aria: "요일별 평균 공부 시간" })}
      <div class="mini-stats"><div><small>가장 많이 하는 요일</small><b>${names[best]}요일</b></div><div><small>평균</small><b>${UI.fmtHShort(avg[best])}</b></div><div><small>가장 적은 요일</small><b>${names[worst]}요일</b></div><div><small>평균</small><b>${UI.fmtHShort(avg[worst])}</b></div></div>
      <p class="muted small">${names[worst]}요일에 계획이 자주 밀린다면 계획 탭의 '공부 가능 시간'에서 그날 시간을 줄여 보세요. 계획이 더 잘 지켜져요.</p></section>`;
  }

  // 누적 계획 vs 누적 실제
  function progressCard() {
    const st = A.state, today = A.today();
    if (!st.plan || !st.plan.items.length) return "";
    const items = st.plan.items.filter((it) => A.subject(it.sid));
    const logs = st.log.filter((l) => A.subject(l.sid));
    const first = items[0].date;
    const last = items[items.length - 1].date;
    const total = PE.daysBetween(first, last);
    if (total < 1) return "";
    const plan = [], act = [];
    let p = 0, a = 0;
    for (let i = 0; i <= total; i++) {
      const d = PE.addDays(first, i);
      p += items.filter((it) => it.date === d).reduce((s, it) => s + it.min, 0);
      plan.push([i, p / 60]);
      if (d <= today) { a += logs.filter((l) => l.date === d).reduce((s, l) => s + l.min, 0); act.push([i, a / 60]); }
    }
    const ti = PE.daysBetween(first, today);
    const marks = [{ x: ti, label: "오늘", color: "#8b95a1" }];
    const exams = Array.from(new Set(A.subjects().map((s) => PE.nextExam(s)).filter(Boolean).map((e) => e.date))).sort();
    if (exams[0]) marks.push({ x: PE.daysBetween(first, exams[0]), label: "시험", color: "#5a9cf8" });
    const pNow = (plan[Math.max(0, Math.min(ti, plan.length - 1))] || [0, 0])[1], aNow = a / 60;
    return `<section class="card c-6"><h2>진행률 그래프 <small class="muted">누적 공부 시간</small></h2>
      ${UI.lineChart({ series: [{ name: "계획", color: "#c5ccd4", points: plan, dash: "4 4", width: 2 }, { name: "실제", color: "#5a9cf8", points: act, width: 3 }], marks, fmtY: (v) => Math.round(v) + "h", h: 170, aria: "누적 계획과 실제 공부 시간" })}
      <p class="legend muted small"><span class="lg-dash"></span> 계획 누적 <span class="lg-line accent"></span> 실제 누적</p>
      <p>오늘까지 계획 <b>${pNow.toFixed(1)}시간</b> 중 <b>${aNow.toFixed(1)}시간</b> (${pNow ? Math.round(aNow / pNow * 100) : 0}%) · 전체 계획 ${(p / 60).toFixed(0)}시간</p></section>`;
  }

  // 과목별: 지금까지 한 시간과 그 덕분에 오른 예상 점수
  function subjectCard() {
    const st = A.state, c = A.calc(), n = A.n();
    const rows = A.subjects().filter((s) => s.evalType !== "pass" && PE.nextExam(s)).map((s) => {
      const h = (c.done[s.id] || 0) / 60;
      const o0 = PE.outlook(s, 0, n), o1 = PE.outlook(s, h, n), oP = PE.outlook(s, (c.planH[s.id] || 0) / 60, n);
      return { s, h, o0, o1, oP };
    });
    if (!rows.length) return "";
    const maxH = Math.max(1, ...rows.map((r) => r.h));
    return `<section class="card c-6"><h2>과목별 투자 시간 대비 성적 변화</h2>
      <table class="tbl"><thead><tr><th>과목</th><th>한 시간</th><th>예상 점수 변화</th><th>예상 등급</th><th>계획 끝까지</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td><span class="dot" style="background:${UI.colorOf(st, r.s.id)}"></span>${esc(r.s.name)}</td>
        <td>${UI.bar(r.h / maxH, UI.colorOf(st, r.s.id), UI.fmtHShort(r.h * 60))} ${UI.fmtHShort(r.h * 60)}</td>
        <td>${r.o0.mu.toFixed(1)} → <b>${r.o1.mu.toFixed(1)}</b> <small class="up">(+${(r.o1.mu - r.o0.mu).toFixed(1)})</small></td>
        <td>${r.o0.expGrade.toFixed(2)} → <b>${r.o1.expGrade.toFixed(2)}</b></td>
        <td>${r.oP.expGrade.toFixed(2)}등급</td></tr>`).join("")}</tbody></table>
      <p class="muted small">'예상 점수 변화'는 이번 시험 준비로 한 시간이 0일 때와 지금을 비교한 공부 효과 모델 값이에요. 시험 결과를 넣으면 실제와 비교해 모델을 고쳐요.</p></section>`;
  }

  function resultsCard() {
    const rs = (A.state.results || []).slice().reverse();
    const c = A.calc();
    const pending = c.awaiting.filter((x) => x.ex.date < A.today());
    return `<section class="card c-6"><h2>시험 결과와 효율 보정 <small class="muted">피드백 루프</small></h2>
      ${pending.length ? `<div class="row gap wrap">${pending.map((x) => `<button class="btn small primary" data-act="resultInput" data-sid="${x.s.id}">${esc(x.s.name)} ${esc(x.ex.name)} 점수 넣기</button>`).join("")}</div>` : ""}
      ${rs.length ? `<table class="tbl"><thead><tr><th>과목</th><th>공부</th><th>예측</th><th>실제</th><th>효율</th></tr></thead><tbody>${rs.map((r) => `<tr><td>${esc(r.name)} <small class="muted">${esc(r.exam)}</small></td><td>${r.hours}h</td><td>${r.predicted}%</td><td><b>${r.actual}%</b> <small class="${r.actual >= r.predicted ? "up" : "down"}">${r.actual >= r.predicted ? "+" : ""}${(r.actual - r.predicted).toFixed(1)}</small></td><td>×${r.effBefore} → ×${r.effAfter}</td></tr>`).join("")}</tbody></table>`
        : `<p class="muted">시험이 끝나면 점수를 넣어 주세요. 예측보다 잘 보면 그 과목은 '같은 시간에 더 오르는 과목'으로, 못 보면 '시간이 더 필요한 과목'으로 보정해서 다음 계획에 반영해요.</p>`}</section>`;
  }

  // ───── 사용자 검증 ─────
  const FEATS = ["역산", "최적 배분", "근거 설명", "자동 재조정", "선택과목 추천", "학사일정 연동", "시뮬레이터", "리포트"];
  function feedbackForm() {
    if (A.ui.fbDone) return `<h2>고마워요! 🙏</h2><p>보내 준 의견은 앱을 고치는 데 써요.</p>`;
    return `<h2>써 보니 어땠나요? <small class="muted">1분 설문 · 익명</small></h2>
      <form id="fb-form" class="form">
        <fieldset class="stars"><legend>얼마나 도움이 됐나요?</legend>${[1, 2, 3, 4, 5].map((v) => `<label><input type="radio" name="rating" value="${v}" required><span aria-hidden="true">★</span><span class="sr-only">${v}점</span></label>`).join("")}</fieldset>
        <label class="field">예전엔 시험 공부 계획 세우는 데 몇 분 걸렸나요? <input type="number" name="beforeMin" min="0" max="600" inputmode="numeric" placeholder="예: 20"></label>
        <fieldset class="chips"><legend>도움이 된 기능 (여러 개)</legend>${FEATS.map((f) => `<label class="chip-btn"><input type="checkbox" name="helpful" value="${f}"> ${f}</label>`).join("")}</fieldset>
        <label class="field">불편했던 점·바라는 점 <textarea name="comment" maxlength="500" rows="3"></textarea></label>
        <p class="form-err" role="alert" id="fb-err"></p>
        <button class="btn primary" type="submit">보내기</button>
      </form>`;
  }
  document.addEventListener("submit", async (ev) => {
    if (ev.target.id !== "fb-form") return;
    ev.preventDefault();
    const f = new FormData(ev.target);
    const body = { clientId: A.clientId(), rating: Number(f.get("rating")), beforeMin: f.get("beforeMin"), helpful: f.getAll("helpful"), comment: f.get("comment") };
    if (!body.rating) { A.$("#fb-err").textContent = "별점을 골라 주세요."; return; }
    try { await A.api("/api/feedback", { method: "POST", body }); A.ui.fbDone = true; A.$("#fb-card").innerHTML = feedbackForm(); loadSummary(); }
    catch (e) { A.$("#fb-err").textContent = e.message; }
  });

  async function loadSummary() {
    const box = A.$("#fb-sum");
    if (!box) return;
    try {
      const s = await A.api("/api/feedback/summary");
      box.innerHTML = `<h2>사용자 검증 숫자 <small class="muted">모든 사용자 익명 합계</small></h2>
        <div class="stat-grid">
          <div><span class="kpi-lab">써 본 기기</span><b>${s.users}</b></div>
          <div><span class="kpi-lab">첫 계획까지 (중앙값)</span><b>${s.onboardMedianSec !== null ? s.onboardMedianSec + "초" : "–"}</b><small class="muted">${s.onboardCount}명</small></div>
          <div><span class="kpi-lab">예전 계획 시간 (중앙값)</span><b>${s.beforeMedianMin !== null ? s.beforeMedianMin + "분" : "–"}</b></div>
          <div><span class="kpi-lab">만족도</span><b>${s.ratingAvg !== null ? s.ratingAvg + " / 5" : "–"}</b><small class="muted">${s.feedbackCount}명</small></div>
          <div><span class="kpi-lab">자동 재조정</span><b>${(s.counts.replan || 0)}번</b></div>
          <div><span class="kpi-lab">완료한 할 일</span><b>${(s.counts.task_done || 0)}개</b></div>
        </div>
        ${s.helpful.length ? `<h3>도움이 된 기능</h3>${UI.hbars(s.helpful.map(([k, v]) => ({ label: k, values: [{ v, color: "var(--accent)", text: v + "명" }] })))}` : ""}
        ${s.comments ? `<h3>의견 (관리자만 보여요)</h3><ul class="comments">${s.comments.map((c) => `<li><span class="muted small">${"★".repeat(c.rating)} ${esc(c.at.slice(0, 10))}</span><p>${esc(c.comment)}</p></li>`).join("")}</ul>` : ""}`;
    } catch (e) { box.innerHTML = `<h2>사용자 검증 숫자</h2><p class="muted">불러오지 못했어요.</p>`; }
  }
})();
