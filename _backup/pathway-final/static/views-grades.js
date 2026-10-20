/* 성적 시뮬레이터: 과목별 점수 합치기, 등급 분포, 목표 역산, 슬라이더 '만약에', 시간 옮겨 보기 */
(function () {
  "use strict";
  const A = window.App, PE = window.PE, PD = window.PD, UI = window.UI;
  const esc = UI.esc;

  function gLabel(s, g) { return s.evalType === "achv" ? "ABCDE"[g - 1] : g + "등급"; }

  A.views.grades = {
    render() {
      const st = A.state, subs = A.subjects(), n = A.n();
      const terms = st.terms || [];
      let html = `<div class="page-h large-title"><h1>성적 시뮬레이터</h1>
        <div class="row gap wrap">${terms.length > 1 ? `<label class="sr-only" for="term-sel">학기</label><select id="term-sel" data-ch="termSel">${terms.map((t) => `<option value="${t.id}" ${t.id === st.activeTermId ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>` : `<span class="badge">${esc(A.term().name)}</span>`}
        <span class="badge">${PE.SYSTEMS[n].name}</span></div></div>`;
      html += `<p class="muted intro c-12">점수를 넣거나 슬라이더를 움직이면 등급과 공부 계획이 바로 바뀌어요. 성적표의 <b>원점수·과목평균·표준편차</b>로 반 친구들 점수 분포를 추정해 등급을 계산해요.</p>`;
      html += `<div class="vg">`;
      html += `<section class="card c-7" id="sum">${summary()}</section>`;
      html += `<section class="card c-5" id="preview-card"><div class="card-h"><h2>계획 미리보기 <small class="muted">③ → ④ 연결</small></h2><button class="link" data-act="go" data-tab="plan">계획 보기 →</button></div><div id="preview">${preview()}</div></section>`;
      html += `<div class="section-h c-12"><h2>과목</h2><button class="btn small" data-act="addSubject">+ 과목 추가</button></div>`;
      html += `<div class="subj-list c-12">${subs.map((s) => subjectCard(s)).join("")}<button class="subj-add" data-act="addSubject"><span aria-hidden="true">＋</span>과목 추가</button></div>`;
      html += `<section class="card c-12" id="scen">${scenarios()}</section>`;
      html += `</div>`;
      return html;
    },
    refreshPreview() {
      const p = A.$("#preview"); if (p) p.innerHTML = preview();
      const s = A.$("#sum"); if (s) s.innerHTML = summary();
      const sc = A.$("#scen-res"); if (sc) sc.innerHTML = scenarioResult();
      const cmp = A.$("#cmp"); if (cmp) cmp.innerHTML = compareMethods();
    },
  };

  // 평균등급 요약
  function summary() {
    const c = A.calc(), subs = A.subjects(), n = A.n();
    const rank = subs.filter((s) => s.evalType === "rank");
    const credits = rank.reduce((a, s) => a + Number(s.credits || 0), 0);
    return `<div class="sum-top"><div><span class="kpi-lab">계획대로 하면 예상 평균등급</span><b class="kpi-big">${UI.fmtG(c.avgPlan)}</b>
        <span class="muted small">석차등급 과목 ${rank.length}개 · ${credits}학점 가중 평균</span></div>
        <div class="sum-alt"><span>오늘 멈추면 <b>${UI.fmtG(c.avgNow)}</b></span><span>지난번처럼 하면 <b>${UI.fmtG(c.avgSame)}</b></span></div></div>
      <table class="tbl compact"><thead><tr><th>과목</th><th>학점</th><th>예상</th><th>목표</th><th>달성 확률</th></tr></thead><tbody>
      ${subs.filter((s) => s.evalType !== "pass").map((s) => {
        const o = PE.outlook(s, (c.planH[s.id] || 0) / 60, n);
        return `<tr><td><span class="dot" style="background:${UI.colorOf(A.state, s.id)}"></span>${esc(s.name)}</td><td>${s.credits}</td>
          <td><span class="gbadge ${UI.gradeTone(o.expGrade, o.cuts.length + 1)}">${s.evalType === "achv" ? o.achv : o.expGrade.toFixed(2)}</span></td>
          <td>${gLabel(s, o.target)}</td><td>${UI.bar(o.pTarget, o.pTarget >= 0.7 ? "var(--good)" : o.pTarget >= 0.4 ? "var(--warn)" : "var(--bad)", "목표 달성 확률 " + UI.pct(o.pTarget))} ${UI.pct(o.pTarget)}</td></tr>`;
      }).join("")}</tbody></table>`;
  }

  // 지금 입력으로 다시 계산한 배분 (저장된 계획이 아니라 미리보기)
  function preview() {
    const st = A.state, today = A.today();
    const subs = A.subjects().filter(PE.plannable);
    if (!subs.length) return `<p class="muted">시험 날짜가 있는 과목이 없어요. 과목을 열어 '기말고사' 날짜를 넣어 주세요.</p>`;
    const ctx = PE.ctxOf(st, today, A.major());
    const o = PE.optimize(ctx);
    const n = A.n();
    const rows = o.P.subs.map((x) => {
      const h = (x.done + (o.alloc[x.id] || 0)) / 60;
      const out = PE.outlook(x.s, h, n);
      return { x, min: o.alloc[x.id] || 0, out };
    }).sort((a, b) => b.min - a.min);
    const max = Math.max(60, ...rows.map((r) => r.min));
    return `${UI.hbars(rows.map((r) => ({ label: r.x.s.name, values: [{ v: r.min, color: UI.colorOf(st, r.x.id), text: UI.fmtHShort(r.min) + " → " + (r.x.s.evalType === "achv" ? r.out.achv : r.out.expGrade.toFixed(2) + "등급") }] })), max)}
      <p class="muted small">시험까지 공부 가능 ${UI.fmtHShort(o.totalCap)} 중 ${UI.fmtHShort(o.totalCap - o.free)} 배정${o.free >= 60 ? ` · 여유 ${UI.fmtHShort(o.free)} (더 해도 등급이 거의 안 바뀌어요)` : ""}</p>`;
  }

  // ───── 과목 카드 ─────
  function subjectCard(s) {
    const open = !!A.ui.open[s.id];
    return `<article class="card subj ${open ? "open" : ""}" id="card-${s.id}" style="--sc:${UI.colorOf(A.state, s.id)}">
      <button class="subj-h" data-act="toggleSubj" data-sid="${s.id}" aria-expanded="${open}" aria-controls="body-${s.id}">
        <span class="dot"></span><span class="subj-name"><b>${esc(s.name)}</b><small>${esc(s.area)} · ${s.credits}학점 · ${s.evalType === "rank" ? "석차등급" : s.evalType === "achv" ? "성취도만" : "등급 없음"}</small></span>
        <span id="hdr-${s.id}">${headBadge(s)}</span><span class="chev" aria-hidden="true">▾</span></button>
      ${open ? `<div class="subj-b" id="body-${s.id}">${subjectBody(s)}</div>` : ""}
    </article>`;
  }

  function hoursOf(s) { const c = A.calc(); return (c.planH[s.id] || 0) / 60; }

  function headBadge(s) {
    if (s.evalType === "pass") return `<span class="gbadge g3">P</span>`;
    const n = A.n();
    const wi = A.ui.whatIf[s.id];
    const o = PE.outlook(s, wi && wi.hours !== undefined ? wi.hours : hoursOf(s), n, wi && wi.pct !== undefined ? wi.pct : undefined);
    return `<span class="gbadge ${UI.gradeTone(o.expGrade, o.cuts.length + 1)}" title="예상 등급">${s.evalType === "achv" ? o.achv : o.expGrade.toFixed(1)}</span>`;
  }

  function subjectBody(s) {
    const n = A.n(), G = PE.gradeCount(n);
    const nx = PE.nextExam(s);
    const comps = s.components || [];
    const wsum = PE.weightSum(s);
    let h = "";
    if (s.evalType !== "pass") {
      h += `<div class="live" id="live-${s.id}" aria-live="polite">${liveBlock(s)}</div>`;
      h += whatIf(s);
      h += `<div class="row gap wrap"><label class="field small-field">목표 <select data-ch="subTarget" data-sid="${s.id}">${Array.from({ length: s.evalType === "achv" ? 5 : G }, (_, i) => `<option value="${i + 1}" ${Number(s.target) === i + 1 ? "selected" : ""}>${gLabel(s, i + 1)}</option>`).join("")}</select></label>
        <label class="field small-field">학점 <input type="number" min="1" max="8" data-in="subNum" data-sid="${s.id}" data-f="credits" value="${s.credits}"></label>
        <label class="field small-field">평가 <select data-ch="subEval" data-sid="${s.id}"><option value="rank" ${s.evalType === "rank" ? "selected" : ""}>석차등급</option><option value="achv" ${s.evalType === "achv" ? "selected" : ""}>성취도만</option><option value="pass" ${s.evalType === "pass" ? "selected" : ""}>등급 없음</option></select></label></div>`;
    }
    // 점수 구성
    h += `<h3>점수 구성 <small class="${wsum === 100 ? "muted" : "warn"}">반영 비율 합 ${wsum}%${wsum === 100 ? "" : " (100%로 맞춰 계산)"}</small></h3>
      <div class="comp-tbl" role="table">
        <div class="comp-r head" role="row"><span role="columnheader">이름</span><span role="columnheader">반영%</span><span role="columnheader">만점</span><span role="columnheader">받은 점수</span><span role="columnheader">예상·날짜</span><span></span></div>
        ${comps.map((c) => `<div class="comp-r ${nx && nx.id === c.id ? "next" : ""}" role="row">
          <input role="cell" aria-label="이름" data-in="compTxt" data-sid="${s.id}" data-cid="${c.id}" data-f="name" value="${esc(c.name)}" maxlength="20">
          <input role="cell" aria-label="반영 비율" type="number" min="0" max="100" data-in="compNum" data-sid="${s.id}" data-cid="${c.id}" data-f="weight" value="${c.weight}">
          <input role="cell" aria-label="만점" type="number" min="1" max="1000" data-in="compNum" data-sid="${s.id}" data-cid="${c.id}" data-f="max" value="${c.max}">
          <input role="cell" aria-label="받은 점수 (아직이면 비움)" type="number" min="0" max="${c.max}" step="0.1" data-in="compNum" data-sid="${s.id}" data-cid="${c.id}" data-f="score" value="${c.score === null || c.score === undefined ? "" : c.score}" placeholder="아직">
          ${c.kind === "exam" ? `<input role="cell" aria-label="시험 날짜" type="date" data-in="compDate" data-sid="${s.id}" data-cid="${c.id}" value="${esc(c.date || "")}">`
            : `<input role="cell" aria-label="예상 점수" type="number" min="0" max="${c.max}" data-in="compNum" data-sid="${s.id}" data-cid="${c.id}" data-f="expected" value="${c.expected === null || c.expected === undefined ? "" : c.expected}" placeholder="예상">`}
          <button class="icon-btn" data-act="delComp" data-sid="${s.id}" data-cid="${c.id}" aria-label="${esc(c.name)} 지우기">✕</button></div>`).join("")}
      </div>
      <div class="row gap"><button class="btn small" data-act="addComp" data-sid="${s.id}" data-kind="exam">+ 지필</button><button class="btn small" data-act="addComp" data-sid="${s.id}" data-kind="perf">+ 수행</button></div>`;
    if (s.evalType !== "pass") {
      h += `<details class="more"><summary>반 성적 분포와 공부 효과 설정</summary>
        <div class="grid3">
          <label class="field">과목 평균 <input type="number" min="0" max="100" step="0.1" data-in="subNum" data-sid="${s.id}" data-f="mean" value="${s.mean}"></label>
          <label class="field">표준편차 <input type="number" min="1" max="40" step="0.1" data-in="subNum" data-sid="${s.id}" data-f="sd" value="${s.sd}"></label>
          <label class="field">수강자 수 <input type="number" min="1" max="999" data-in="subNum" data-sid="${s.id}" data-f="students" value="${s.students}"></label>
          <label class="field">지난 시험 점수(%) <input type="number" min="0" max="100" data-in="subNum" data-sid="${s.id}" data-f="lastScore" value="${s.lastScore}"></label>
          <label class="field">그때 공부한 시간 <input type="number" min="0" max="300" data-in="subNum" data-sid="${s.id}" data-f="lastHours" value="${s.lastHours}"></label>
          <label class="field">범위 한 번 공부 시간 <input type="number" min="1" max="200" data-in="subNum" data-sid="${s.id}" data-f="passHours" value="${s.passHours || ""}" placeholder="${Math.max(4, s.credits * 2.5)}"></label>
        </div>
        <p class="muted small">공부 효과 모델: 지난번만큼 공부하면 지난 점수가 나오고, 범위를 한 번 더 제대로 공부할 때마다 <b>모자란 점수의 40%</b>를 채운다고 봐요(갈수록 덜 오름).${Number(s.eff) && Number(s.eff) !== 1 ? ` 지난 시험 결과로 보정한 효율: <b>×${s.eff}</b> (${s.eff > 1 ? "예상보다 시간이 더 드는 과목" : "예상보다 잘 오르는 과목"})` : ""}</p>
        <label class="field">시험 범위 단원 <small class="muted">한 줄에 하나 · 시험 범위 공지를 그대로 붙여넣어도 나눠 줘요</small>
          <textarea rows="3" data-ch="subUnits" data-sid="${s.id}" placeholder="예: 1. 함수의 극한 (p.10~35)&#10;2. 함수의 연속">${esc((s.units || []).map((u) => u.name + (u.size > 1 ? ` (${u.size})` : "")).join("\n"))}</textarea></label>
      </details>`;
    }
    h += `<div class="row gap end"><button class="btn small danger" data-act="delSubject" data-sid="${s.id}">과목 지우기</button></div>`;
    return h;
  }

  // 등급 분포 + 역산 결과 (슬라이더를 움직일 때 이 부분만 다시 그린다)
  function liveBlock(s) {
    const n = A.n();
    const wi = A.ui.whatIf[s.id] || {};
    const H = wi.hours !== undefined ? wi.hours : hoursOf(s);
    const o = PE.outlook(s, H, n, wi.pct);
    const req = PE.required(s, n);
    const G = o.cuts.length + 1;
    const labels = s.evalType === "achv" ? ["A", "B", "C", "D", "E"] : Array.from({ length: G }, (_, i) => String(i + 1));
    let reqTxt = "";
    if (req.status === "possible") reqTxt = `🎯 목표 <b>${gLabel(s, req.target)}</b>: ${esc(req.next.name)}에서 <b>${req.needScore}점</b> 이상 (만점 ${req.max}) 필요 · 공부 효과 모델로는 약 <b>${UI.fmtHShort(Math.max(0, req.hours * 60 - (A.calc().done[s.id] || 0)))}</b> 더`;
    else if (req.status === "secured") reqTxt = `✅ 목표 <b>${gLabel(s, req.target)}</b>는 남은 시험을 웬만큼만 봐도 안정권이에요`;
    else if (req.status === "impossible") reqTxt = `⚠️ 목표 <b>${gLabel(s, req.target)}</b>는 ${esc(req.next.name)} 만점이어도 ${req.shortRaw}점 모자라요. 한 등급 아래를 지키는 계획으로 가요`;
    else if (req.status === "closed") reqTxt = `남은 시험이 없어요. 최종 원점수 ${req.now}점`;
    const distBars = o.dist.map((p, i) => `<div class="dist-c" title="${labels[i]}: ${UI.pct(p)}"><span style="height:${Math.max(2, p * 100)}%" class="${i + 1 <= o.target ? "hit" : ""}"></span><small>${labels[i]}</small></div>`).join("");
    return `<div class="live-grid">
      <div>${UI.bell({ mean: Number(s.mean) || 65, sd: Number(s.sd) || 15, cuts: s.evalType === "achv" ? [90, 80, 70, 60] : o.cuts, me: o.mu, sigma: o.sigma, labels, aria: `${s.name} 반 점수 분포와 내 예상 점수 ${o.mu.toFixed(1)}점` })}
        <p class="muted small center">반 점수 분포(추정) · <span class="me-mark">●</span> 내 예상 ${o.mu.toFixed(1)}점 ±${o.sigma.toFixed(1)}</p></div>
      <div class="live-nums">
        <div><span class="kpi-lab">예상 ${s.evalType === "achv" ? "성취도" : "등급"}</span><b class="kpi-big">${s.evalType === "achv" ? o.achv : o.expGrade.toFixed(2)}</b>
          <span class="muted small">${s.evalType === "rank" ? `성취도 ${o.achv}${o.rank ? ` · 약 ${o.rank}등 / ${s.students}명` : ""}` : `원점수 ${o.mu.toFixed(1)}`}</span></div>
        <div class="dist" role="img" aria-label="등급별 확률">${distBars}</div>
        <span class="small">목표 달성 확률 <b>${UI.pct(o.pTarget)}</b></span>
      </div></div>
      <p class="req">${reqTxt}</p>
      ${o.lowRisk ? `<p class="warn small">⚠️ 학업성취율 40% 미만이면 미이수(최소 성취수준 보장지도) 대상이 될 수 있어요.</p>` : ""}`;
  }

  function whatIf(s) {
    const nx = PE.nextExam(s);
    if (!nx) return "";
    const wi = A.ui.whatIf[s.id] || {};
    const H = wi.hours !== undefined ? wi.hours : hoursOf(s);
    const pct = wi.pct !== undefined ? wi.pct : PE.examPct(s, H);
    const mx = Number(nx.max) || 100;
    return `<div class="whatif">
      <label class="field"><span>만약 <b>${esc(nx.name)}</b> 점수가 <output id="wi-s-${s.id}">${Math.round(pct / 100 * mx)}</output>점이면? <small class="muted">(${UI.fmtDate(nx.date)})</small></span>
        <input type="range" min="0" max="100" step="1" value="${pct.toFixed(0)}" data-in="wiScore" data-sid="${s.id}" aria-label="${esc(nx.name)} 예상 점수"></label>
      <label class="field"><span>만약 시험까지 <output id="wi-h-${s.id}">${UI.fmtHShort(H * 60)}</output> 공부하면? <small class="muted">(계획: ${UI.fmtHShort(hoursOf(s) * 60)})</small></span>
        <input type="range" min="0" max="${Math.max(60, Math.ceil(hoursOf(s) * 1.8))}" step="0.5" value="${H}" data-in="wiHours" data-sid="${s.id}" aria-label="공부 시간"></label>
      ${wi.pct !== undefined || wi.hours !== undefined ? `<button class="link small" data-act="wiReset" data-sid="${s.id}">계획대로 보기</button>` : ""}
    </div>`;
  }

  function refreshSubject(sid) {
    const s = A.subject(sid);
    if (!s) return;
    const live = A.$("#live-" + sid); if (live) live.innerHTML = liveBlock(s);
    const hb = A.$("#hdr-" + sid); if (hb) hb.innerHTML = headBadge(s);
  }

  let raf = 0;
  function soon(fn) { cancelAnimationFrame(raf); raf = requestAnimationFrame(fn); }

  A.acts.toggleSubj = (el) => { const id = el.dataset.sid; A.ui.open[id] = !A.ui.open[id]; A.rerender(); };
  // 학기를 바꾸면 그 학기가 '지금 학기'가 되고 계획도 그 학기 기준으로 다시 짠다
  A.changes.termSel = (el) => { A.state.activeTermId = el.value; A.rev++; A.rebuild("edit", { quiet: true }); A.rerender(); };

  // 만약에 슬라이더 (계획은 그대로, 보기만)
  A.inputs.wiScore = (el) => {
    const s = A.subject(el.dataset.sid), nx = PE.nextExam(s);
    A.ui.whatIf[s.id] = { pct: Number(el.value) };
    A.$("#wi-s-" + s.id).textContent = Math.round(Number(el.value) / 100 * (Number(nx.max) || 100));
    const hs = A.$(`[data-in=wiHours][data-sid="${s.id}"]`);
    if (hs) { const h = PE.hoursForPct(s, Number(el.value)); A.$("#wi-h-" + s.id).textContent = isFinite(h) ? "약 " + UI.fmtHShort(h * 60) : "만점은 어려움"; hs.value = isFinite(h) ? h : hs.max; }
    soon(() => refreshSubject(s.id));
    A.metric && (A._simUsed || (A._simUsed = true, A.metric("sim_use", 1)));
  };
  A.inputs.wiHours = (el) => {
    const s = A.subject(el.dataset.sid);
    const h = Number(el.value);
    A.ui.whatIf[s.id] = { hours: h };
    A.$("#wi-h-" + s.id).textContent = UI.fmtHShort(h * 60);
    const nx = PE.nextExam(s);
    const pct = PE.examPct(s, h);
    const ss = A.$(`[data-in=wiScore][data-sid="${s.id}"]`);
    if (ss) { ss.value = pct.toFixed(0); A.$("#wi-s-" + s.id).textContent = Math.round(pct / 100 * (Number(nx.max) || 100)); }
    soon(() => refreshSubject(s.id));
  };
  A.acts.wiReset = (el) => { delete A.ui.whatIf[el.dataset.sid]; A.rerender(); };

  // 값 바꾸기 → 저장하고 계획 다시 맞추기
  function edited(sid) {
    A.rev++;
    soon(() => { refreshSubject(sid); A.views.grades.refreshPreview(); });
    A.touchPlan();
  }
  const numOr = (v, d) => (v === "" || v === null || !isFinite(Number(v)) ? d : Number(v));
  A.inputs.subNum = (el) => {
    const s = A.subject(el.dataset.sid), f = el.dataset.f;
    const lim = { credits: [1, 8], mean: [0, 100], sd: [1, 40], students: [1, 999], lastScore: [0, 100], lastHours: [0, 300], passHours: [1, 200] }[f];
    if (el.value === "" && f === "passHours") s.passHours = null;
    else { const v = numOr(el.value, null); if (v === null) return; s[f] = PE.clamp(v, lim[0], lim[1]); }
    edited(s.id);
  };
  A.changes.subTarget = (el) => { const s = A.subject(el.dataset.sid); s.target = Number(el.value); edited(s.id); };
  A.changes.subEval = (el) => { const s = A.subject(el.dataset.sid); s.evalType = el.value; A.save(); A.touchPlan(); A.rerender(); };
  A.changes.subUnits = (el) => { const s = A.subject(el.dataset.sid); s.units = parseUnits(el.value); A.save(); A.touchPlan(); A.toast("단원 " + s.units.length + "개로 나눴어요."); A.rerender(); };

  function comp(el) { const s = A.subject(el.dataset.sid); return [s, s.components.find((c) => c.id === el.dataset.cid)]; }
  A.inputs.compTxt = (el) => { const [s, c] = comp(el); c.name = el.value.slice(0, 20); A.save(); };
  A.inputs.compNum = (el) => {
    const [s, c] = comp(el), f = el.dataset.f;
    if (el.value === "") { if (f === "score" || f === "expected") c[f] = null; else return; }
    else {
      const v = Number(el.value);
      if (!isFinite(v)) return;
      c[f] = f === "weight" ? PE.clamp(v, 0, 100) : f === "max" ? PE.clamp(v, 1, 1000) : PE.clamp(v, 0, Number(c.max) || 100);
    }
    edited(s.id);
  };
  A.inputs.compDate = (el) => { const [s, c] = comp(el); if (el.value && !PE.isValidYmd(el.value)) return; c.date = el.value || null; edited(s.id); };
  A.acts.addComp = (el) => {
    const s = A.subject(el.dataset.sid), exam = el.dataset.kind === "exam";
    s.components.push({ id: PE.newId("c"), name: exam ? "지필평가" : "수행평가", kind: exam ? "exam" : "perf", weight: 0, max: 100, score: null, expected: exam ? null : 80, date: exam ? defaultExamDate() : null });
    A.save(); A.rerender();
  };
  A.acts.delComp = (el) => { const [s, c] = comp(el); s.components = s.components.filter((x) => x !== c); A.touchPlan(); A.rerender(); };
  A.acts.delSubject = (el) => {
    const s = A.subject(el.dataset.sid);
    A.modal(`<h2>${esc(s.name)} 지울까요?</h2><p>점수와 계획에서 빠져요. 공부 기록은 남아요.</p><div class="row gap"><button class="btn" data-act="closeModal">그만두기</button><button class="btn danger" data-act="delSubjectYes" data-sid="${s.id}">지우기</button></div>`);
  };
  A.acts.delSubjectYes = (el) => {
    const t = A.term();
    t.subjects = t.subjects.filter((x) => x.id !== el.dataset.sid);
    A.closeModal(); A.rebuild("edit", { quiet: true }); A.rerender();
  };

  // 시험 범위 글 → 단원 목록 ("1. 함수의 극한 (p.10~35), 2. ..." 도 나눠 준다)
  function parseUnits(text) {
    let parts = String(text || "").split(/\n+/).map((x) => x.trim()).filter(Boolean);
    if (parts.length <= 1 && parts[0]) {
      const one = parts[0];
      const byNum = one.split(/\s*(?=(?:\d{1,2}|[Ⅰ-Ⅹ])\s*[.)]\s)/).map((x) => x.trim()).filter(Boolean);
      parts = byNum.length > 1 ? byNum : one.split(/\s*[,·/]\s*/).filter(Boolean);
    }
    return parts.slice(0, 20).map((p) => {
      let size = 1;
      const pg = p.match(/p?\.?\s*(\d{1,4})\s*[~\-–]\s*(\d{1,4})\s*(쪽|p)?/i);
      const paren = p.match(/\((\d{1,2}(?:\.\d)?)\)\s*$/);
      if (pg) size = Math.max(1, Math.round((Number(pg[2]) - Number(pg[1]) + 1) / 15 * 10) / 10);
      else if (paren) size = Number(paren[1]);
      const name = p.replace(/^\s*(?:\d{1,2}|[Ⅰ-Ⅹ])\s*[.)]\s*/, "").replace(/\(\s*p?\.?\s*\d[^)]*\)/gi, "").replace(/\((\d{1,2}(?:\.\d)?)\)\s*$/, "").replace(/[-–]\s*$/, "").trim().slice(0, 30);
      return { name: name || p.slice(0, 30), size: PE.clamp(size, 0.5, 10) };
    });
  }
  A.parseUnits = parseUnits;

  function defaultExamDate() {
    const today = A.today();
    const ex = (A.state.calendar.exams || []).find((e) => e.start > today);
    if (ex) return ex.start;
    const ds = A.subjects().map((s) => PE.nextExam(s)).filter(Boolean).map((e) => e.date).filter((d) => d > today).sort();
    return ds[0] || PE.addDays(today, 30);
  }

  // 과목 추가: 교과 → 과목 → 시험 날짜 (한 화면에 하나씩)
  A.acts.addSubject = () => {
    const have = new Set(A.subjects().map((s) => s.name));
    const areas = PD.AREAS.filter((a) => PD.SUBJECTS.some((s) => s.area === a && !have.has(s.name)));
    const icons = { 국어: "📖", 수학: "📐", 영어: "🔤", 사회: "🌏", 과학: "🔬", 정보: "💻", 제2외국어: "🗣️", 체육: "🏃", 예술: "🎨", 교양: "🧠" };
    A.flow({
      steps: [
        { q: "어떤 교과 과목인가요?", key: "area", options: areas.map((a) => ({ v: a, label: a, emoji: icons[a] || "📘" })).concat([{ v: "_", label: "직접 쓸게요", emoji: "✏️" }]) },
        { q: (c) => (c.area === "_" ? "과목 이름을 써 주세요" : "어떤 과목을 추가할까요?"),
          html: (c) => c.area === "_" ? `<input id="as-name" class="big-text" maxlength="20" placeholder="예: 물리학 실험">`
            : `<ul class="fl-opts">${PD.SUBJECTS.filter((x) => x.area === c.area && !have.has(x.name)).map((x) => `<li><button class="fl-opt" data-act="asPick" data-name="${esc(x.name)}"><span class="fl-txt"><b>${esc(x.name)}</b><small>${x.credits}학점 · ${x.evalType === "rank" ? "석차등급" : x.evalType === "achv" ? "성취도만" : "등급 없음"}</small></span><span class="fl-chev">›</span></button></li>`).join("")}</ul>`,
          read: (r, c) => { if (c.area === "_") c.name = A.$("#as-name").value.trim().slice(0, 20); return c.name ? null : "과목 이름을 써 주세요."; },
          cta: (c) => (c.area === "_" ? "다음" : "고른 과목으로") },
        { q: (c) => `${esc(c.name)}<br>다음 시험은 언제예요?`, sub: "학사일정의 시험 기간으로 먼저 채웠어요.",
          html: () => `<input id="as-date" type="date" class="big-text" value="${defaultExamDate()}">`,
          read: (r, c) => { c.date = A.$("#as-date").value; return PE.isValidYmd(c.date) ? null : "날짜를 골라 주세요."; }, cta: "추가하기" },
      ],
      finish: (c) => {
        const info = A.infoFor(c.name), pass = info.evalType === "pass";
        const sub = PD.makeSubject({
          name: c.name, area: info.area, credits: info.credits, evalType: info.evalType, target: A.n() === 9 ? 3 : 2, prepFrom: A.today(),
          components: pass ? [{ name: "수행평가", kind: "perf", weight: 100, expected: 85 }] : [{ name: "기말고사", kind: "exam", weight: 60, date: c.date }, { name: "수행평가", kind: "perf", weight: 40, expected: 32, max: 40 }],
        });
        A.term().subjects.push(sub);
        A.ui.open[sub.id] = true;
        A.rebuild("edit", { quiet: true });
        return { emoji: "➕", title: `${esc(c.name)}을(를)<br>추가했어요`, sub: "계획에도 바로 들어갔어요. 과목을 열어 점수 구성을 맞춰 주세요." };
      },
    });
  };
  A.acts.asPick = (el) => { el.classList.add("on"); A.$("#modal .fl-body").dataset.name = el.dataset.name; setTimeout(() => { const btn = A.$("[data-act=flowNext]"); A.flowCtx().name = el.dataset.name; btn.click(); }, 120); };

  // ───── 시나리오 ─────
  function scenarios() {
    const subs = A.subjects().filter(PE.plannable);
    if (subs.length < 2 || !A.state.plan) return `<h2>시나리오 비교</h2><p class="muted">시험이 있는 과목이 2개 이상이고 계획이 있으면 비교할 수 있어요.</p>`;
    const ui = A.ui.swap || (A.ui.swap = { from: (A.calc().ex.rows[A.calc().ex.rows.length - 1] || {}).sid || subs[1].id, to: (A.calc().ex.rows[0] || {}).sid || subs[0].id, min: 60 });
    const opt = (sel) => subs.map((s) => `<option value="${s.id}" ${s.id === sel ? "selected" : ""}>${esc(s.name)}</option>`).join("");
    return `<h2>시나리오 비교</h2><div class="split"><div>
      <h3>시간 옮겨 보기</h3>
      <div class="swap">
        <label class="field"><select data-ch="swapFrom" aria-label="시간을 뺄 과목">${opt(ui.from)}</select></label>
        <span>에서</span>
        <label class="field"><select data-ch="swapTo" aria-label="시간을 더할 과목">${opt(ui.to)}</select></label>
        <span>로</span>
        <label class="field grow"><output id="swap-out">${UI.fmtHShort(ui.min)}</output><input type="range" min="30" max="600" step="30" value="${ui.min}" data-in="swapMin" aria-label="옮길 시간"></label>
      </div>
      <div id="scen-res" aria-live="polite">${scenarioResult()}</div></div>
      <div><h3>공부 방법 세 가지 비교 <small class="muted">같은 시간을 어떻게 나누느냐에 따라</small></h3>
      <div id="cmp">${compareMethods()}</div></div></div>`;
  }
  A.changes.swapFrom = (el) => { A.ui.swap.from = el.value; A.$("#scen-res").innerHTML = scenarioResult(); };
  A.changes.swapTo = (el) => { A.ui.swap.to = el.value; A.$("#scen-res").innerHTML = scenarioResult(); };
  A.inputs.swapMin = (el) => { A.ui.swap.min = Number(el.value); A.$("#swap-out").textContent = UI.fmtHShort(A.ui.swap.min); soon(() => (A.$("#scen-res").innerHTML = scenarioResult())); };

  function scenarioResult() {
    const ui = A.ui.swap;
    if (!ui) return "";
    if (ui.from === ui.to) return `<p class="muted">서로 다른 과목을 골라 주세요.</p>`;
    const r = PE.swapEffect(A.state, A.today(), A.major(), ui.from, ui.to, ui.min);
    const a = A.subject(ui.from), b = A.subject(ui.to), n = A.n(), c = A.calc();
    const ha = (c.planH[a.id] || 0) / 60, hb = (c.planH[b.id] || 0) / 60, m = r.minutes / 60;
    const oa0 = PE.outlook(a, ha, n), oa1 = PE.outlook(a, ha - m, n), ob0 = PE.outlook(b, hb, n), ob1 = PE.outlook(b, hb + m, n);
    const better = r.delta < -0.0005, worse = r.delta > 0.0005;
    return `<div class="scen-box ${better ? "good" : worse ? "bad" : ""}">
      <p class="scen-main">${esc(a.name)} ${UI.fmtHShort(r.minutes)}을 ${esc(b.name)}으로 옮기면 예상 평균등급 <b>${UI.fmtG(r.before)} → ${UI.fmtG(r.after)}</b>
        <span class="delta">(${r.delta > 0 ? "+" : ""}${r.delta.toFixed(3)} · ${better ? "더 좋아져요" : worse ? "나빠져요" : "거의 같아요"})</span></p>
      <ul class="scen-sub"><li>${esc(a.name)}: ${oa0.expGrade.toFixed(2)} → ${oa1.expGrade.toFixed(2)}등급</li><li>${esc(b.name)}: ${ob0.expGrade.toFixed(2)} → ${ob1.expGrade.toFixed(2)}등급</li></ul>
      ${worse ? `<p class="muted small">지금 계획은 이미 '어느 과목에서 어느 과목으로 옮겨도 나빠지는' 상태로 맞춰져 있어요.</p>` : better ? `<p class="muted small">진로 가중치나 목표 모드 때문에 평균등급만으로는 이쪽이 나을 수 있어요. 설정에서 기준을 바꿔 볼 수 있어요.</p>` : ""}
    </div>`;
  }

  function compareMethods() {
    const st = A.state, c = A.calc(), n = A.n(), subs = A.subjects();
    const plan = subs.filter(PE.plannable);
    const fut = {};
    for (const s of plan) fut[s.id] = Math.max(0, (c.planH[s.id] || 0) - (c.done[s.id] || 0));
    const total = Object.values(fut).reduce((a, b) => a + b, 0);
    const mk = (f) => { const o = {}; for (const s of subs) o[s.id] = (c.done[s.id] || 0) + (f(s) || 0); return o; };
    const credSum = plan.reduce((a, s) => a + Number(s.credits || 1), 0) || 1;
    const methods = [
      { name: "Pathway 추천", color: "var(--accent)", g: c.avgPlan },
      { name: "학점 비례로 나누기", color: "#aeaeb2", g: PE.averageGrade(subs, mk((s) => (plan.includes(s) ? total * Number(s.credits || 1) / credSum : 0)), n) },
      { name: "똑같이 나누기", color: "#c7c7cc", g: PE.averageGrade(subs, mk((s) => (plan.includes(s) ? total / plan.length : 0)), n) },
    ];
    const G = PE.gradeCount(n);
    const best = Math.min(...methods.map((m) => m.g));
    return UI.hbars(methods.map((m) => ({ label: m.name, values: [{ v: G + 1 - m.g, color: m.color, text: UI.fmtG(m.g) + "등급" + (m.g === best ? " ✓" : ` (+${(m.g - best).toFixed(2)})`) }] })), G) +
      `<p class="muted small">같은 ${UI.fmtHShort(total)}을 쓰더라도, 등급 경계에 가까운 과목·학점이 큰 과목·진로 과목에 몰아주면 평균등급이 더 낮아져요. 막대가 길수록 좋아요.</p>`;
  }

  // ───── 시험 결과 입력 → 효율 보정 (피드백 루프) ─────
  A.acts.resultInput = (el) => {
    const s = A.subject(el.dataset.sid), nx = PE.nextExam(s);
    if (!nx) return;
    const hours = (A.calc().done[s.id] || 0) / 60;
    const pred = PE.examPct(s, hours);
    A.flow({
      steps: [
        { q: `${esc(s.name)} ${esc(nx.name)},<br>몇 점 받았나요?`, sub: `이번 시험 준비로 ${UI.fmtH(hours * 60)} 공부했어요. Pathway는 <b>${(pred / 100 * nx.max).toFixed(1)}점</b>을 예상했어요.`,
          html: () => A.bigInput("ri-score", "", "점 / " + nx.max, `min="0" max="${nx.max}" step="0.1" placeholder="0"`),
          read: (r, c) => { const x = A.$("#ri-score").value, v = Number(x); if (x === "" || !(v >= 0 && v <= nx.max)) return `0~${nx.max} 사이로 넣어 주세요.`; c.v = v; return null; } },
        { q: "반 평균과 표준편차도<br>알고 있나요?", sub: "성적표에 있어요. 다음 등급 계산이 더 정확해져요.", skip: "몰라요",
          html: () => `<div class="sub-ins two"><label>반 평균<input id="ri-mean" type="number" inputmode="decimal" min="0" max="100" step="0.1" placeholder="${s.mean}"></label><label>표준편차<input id="ri-sd" type="number" inputmode="decimal" min="1" max="40" step="0.1" placeholder="${s.sd}"></label></div>`,
          read: (r, c) => { c.mean = A.$("#ri-mean").value; c.sd = A.$("#ri-sd").value; return null; }, cta: "결과 보기" },
      ],
      finish: (c) => {
        const pct = c.v / nx.max * 100;
        const cal = PE.calibrate(s, hours, pct);
        nx.score = c.v;
        if (c.mean) s.mean = PE.clamp(Number(c.mean), 0, 100);
        if (c.sd) s.sd = PE.clamp(Number(c.sd), 1, 40);
        A.state.results.push({ id: PE.newId("r"), sid: s.id, name: s.name, exam: nx.name, date: nx.date, hours: Math.round(hours * 10) / 10, predicted: cal.predicted, actual: cal.actual, effBefore: cal.oldEff, effAfter: cal.eff });
        s.eff = cal.eff;
        s.lastScore = Math.round(pct * 10) / 10;
        s.lastHours = Math.round(hours * 10) / 10;
        s.prepFrom = PE.addDays(nx.date, 1);
        A.metric("result_input", pct);
        A.rebuild("edit", { quiet: true });
        const diff = cal.actual - cal.predicted;
        return {
          emoji: diff >= 0 ? "🎉" : "💪",
          title: diff >= 0 ? `예상보다 ${diff.toFixed(1)}%<br>더 잘 봤어요` : `예상보다 ${(-diff).toFixed(1)}%<br>아쉬웠어요`,
          sub: `${esc(s.name)}은(는) ${cal.eff < cal.oldEff ? "같은 시간에 더 잘 오르는 과목" : cal.eff > cal.oldEff ? "시간이 조금 더 필요한 과목" : "예상대로 오르는 과목"}으로 보고, 다음 계획부터 반영할게요.`,
          html: `<div class="cmp-big"><div><small>예상</small><b>${cal.predicted}%</b></div><span>→</span><div><small>실제</small><b class="${diff >= 0 ? "up" : "down"}">${cal.actual}%</b></div><div><small>공부 효율</small><b>×${cal.oldEff} → ×${cal.eff}</b></div></div>`,
        };
      },
    });
  };
})();
