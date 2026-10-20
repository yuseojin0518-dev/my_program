/* 진로·과목: 진로 목표(앱 전체의 기준), 선택과목 조합 탐색(가지치기) TOP 5 */
(function () {
  "use strict";
  const A = window.App, PE = window.PE, PD = window.PD, UI = window.UI;
  const esc = UI.esc;

  // ③ 내신 → ② 과목: 지금 예상 성적으로 교과별 '위에서부터 몇 %'
  function strength() {
    const c = A.calc(), n = A.n(), out = {}, cnt = {};
    for (const s of A.subjects()) {
      if (s.evalType === "pass") continue;
      const o = PE.outlook(s, (c.planH[s.id] || 0) / 60, n);
      out[s.area] = (out[s.area] || 0) + o.pTop;
      cnt[s.area] = (cnt[s.area] || 0) + 1;
    }
    for (const k of Object.keys(out)) out[k] = out[k] / cnt[k];
    return out;
  }

  function takenList() {
    const st = A.state;
    const cur = A.subjects().map((s) => ({ name: s.name, area: s.area, credits: Number(s.credits) || 0, sem: "지금" }));
    const names = new Set(cur.map((x) => x.name));
    return (st.taken || []).filter((t) => !names.has(t.name)).concat(cur);
  }

  A.views.path = {
    render() {
      const st = A.state, m = A.major();
      if (!st.taken || !st.taken.length) { st.taken = PD.DEMO_TAKEN.map((t) => Object.assign({}, t)); st.takenAssumed = true; A.save({ local: true }); }
      let html = `<div class="page-h large-title"><h1>진로·과목</h1></div><div class="vg">`;
      html += goalCard(m);
      html += courseCard();
      html += `</div>`;
      return html;
    },
  };

  function goalCard(m) {
    const st = A.state;
    if (!m) return `<section class="card c-12"><h2>🎯 진로 목표</h2><p>희망 진로를 정하면 그 진로에 중요한 교과에 공부 시간을 더 주고, 선택과목도 맞춰 추천해요.</p><button class="btn primary" data-act="majorModal">진로 정하기</button></section>`;
    const taken = new Set(takenList().map((t) => t.name));
    const picked = new Set(((st.courses.picked && st.courses.picked.courses) || []));
    const mark = (x) => (taken.has(x) ? `<span class="cs ok" title="들었거나 듣는 중">✓</span>` : picked.has(x) ? `<span class="cs plan" title="고른 조합에 있음">🧩</span>` : `<span class="cs no" title="아직">○</span>`);
    const aw = Object.entries(m.areaWeights).sort((a, b) => b[1] - a[1]);
    return `<section class="card goal c-12"><div class="card-h"><h2>🎯 진로 목표: ${m.emoji} ${esc(m.name)}</h2><button class="btn small" data-act="majorModal">바꾸기</button></div>
      <p>${esc(m.desc)}</p>
      <div class="grid3 goal-grid">
        <div><h3>교과 비중 <small class="muted">공부 시간 배분에 곱해져요</small></h3>
          ${UI.hbars(aw.map(([k, v]) => ({ label: k, values: [{ v: v - 0.9, color: "var(--accent)", text: "×" + v }] })), 0.7)}
          <label class="row gap small"><input type="checkbox" data-ch="setCareer" ${st.profile.careerWeight !== false ? "checked" : ""}> 진로 비중을 계획에 반영하기</label></div>
        <div><h3>핵심 권장 과목</h3><ul class="course-chk">${m.core.map((x) => `<li>${mark(x)} ${esc(x)}</li>`).join("")}</ul>
          </div><div><h3>권장 과목</h3><ul class="course-chk two">${m.recommended.map((x) => `<li>${mark(x)} ${esc(x)}</li>`).join("")}</ul></div>
      </div>
      <p class="muted small">권장 과목은 여러 대학이 발표한 '전공 연계 권장 과목' 자료를 참고해 만든 예시예요. 지원할 대학의 최신 안내를 꼭 함께 보세요.</p></section>`;
  }

  A.acts.majorModal = () => {
    const cur = A.state.profile.majorId;
    A.modal(`<h2>희망 진로</h2><div class="major-grid">${PD.MAJORS.map((m) => `<button class="major-chip ${cur === m.id ? "on" : ""}" data-act="setMajor" data-id="${m.id}" aria-pressed="${cur === m.id}"><span class="mc-emoji" aria-hidden="true">${m.emoji}</span><b>${esc(m.name)}</b><small>${esc(m.field)}</small></button>`).join("")}</div>`, { wide: true });
  };
  A.acts.setMajor = (el) => {
    const before = A.calc().avgPlan;
    A.state.profile.majorId = el.dataset.id;
    A.ui.courseRes = null;
    A.closeModal();
    A.rebuild("edit", { quiet: true });
    const m = A.major();
    A.toast(`진로를 ${m.name}(으)로 바꿨어요. 교과 비중이 바뀌어 계획도 다시 나눴어요.`);
    void before;
    A.rerender();
  };

  // ───── 선택과목 설계 ─────
  function allCourses() {
    const set = new Map();
    for (const sem of PD.CATALOG.semesters) for (const g of sem.groups) for (const o of g.options) set.set(o.name, o);
    return Array.from(set.values());
  }

  function courseCard() {
    const st = A.state, cs = st.courses, m = A.major();
    const groups = PD.CATALOG.semesters.reduce((a, s) => a + s.groups.length, 0);
    const total = PD.CATALOG.semesters.reduce((a, s) => s.groups.reduce((b, g) => b * g.options.length, a), 1);
    const str = strength();
    const taken = takenList();
    const res = A.ui.courseRes;
    const prefMark = (name) => (cs.must.includes(name) ? "must" : cs.ban.includes(name) ? "ban" : "");
    return `<section class="card c-12"><h2>🧩 3학년 선택과목 설계 <small class="muted">고교학점제</small></h2>
      <p class="muted">${esc(PD.CATALOG.name)} · 묶음 ${groups}개에서 하나씩 고르면 <b>${UI.fmtNum(total)}가지</b> 조합이 나와요. 시간대(같은 묶음)·선수 과목·졸업 요건·진로 적합도를 모두 따져 TOP 5를 찾아요.</p>
      <div class="grid2">
        <div class="field"><span>무엇을 더 중요하게?</span>
          <div class="alpha"><small>내신 유리</small><input type="range" min="0" max="100" step="5" value="${Math.round(cs.alpha * 100)}" data-in="alpha" aria-label="진로 적합과 내신 유리 사이 비중"><small>진로 적합</small></div>
          <p class="muted small" id="alpha-txt">${alphaText(cs.alpha)}</p></div>
        <div class="field"><span>지금 성적으로 본 교과별 위치 <small class="muted">③에서 받아 와요</small></span>
          <div class="chips">${Object.keys(str).length ? Object.entries(str).sort((a, b) => a[1] - b[1]).map(([k, v]) => `<span class="chip">${esc(k)} 상위 ${Math.max(1, Math.round(v * 100))}%</span>`).join("") : `<span class="muted small">성적을 넣으면 반영돼요</span>`}</div>
          <p class="muted small">수강자가 적은 과목은 1등급 인원이 적어서(예: 12명이면 1명) 같은 실력이어도 등급이 낮게 나올 수 있어요.</p></div>
      </div>
      <details class="more"><summary>꼭 들을 과목 · 빼고 싶은 과목 ${cs.must.length + cs.ban.length ? `(${cs.must.length + cs.ban.length})` : ""}</summary>
        <p class="muted small">누를 때마다 보통 → <b class="must-t">꼭</b> → <b class="ban-t">빼기</b> → 보통</p>
        <div class="chips">${allCourses().map((o) => `<button class="chip-btn pref ${prefMark(o.name)}" data-act="prefCycle" data-name="${esc(o.name)}">${prefMark(o.name) === "must" ? "★ " : prefMark(o.name) === "ban" ? "✕ " : ""}${esc(o.name)}</button>`).join("")}</div></details>
      <details class="more"><summary>1~2학년에 들은 과목 ${taken.length}개 ${st.takenAssumed ? "<small class='warn'>(표준 편성으로 가정)</small>" : ""}</summary>
        <p class="muted small">졸업 요건(교과 174학점, 교과군별 필수 학점)과 선수 과목을 따질 때 써요. 이번 학기 과목은 자동으로 들어가요.</p>
        <div class="chips">${taken.map((t) => `<span class="chip">${esc(t.name)} <small>${t.credits}</small>${t.sem === "지금" ? "" : ` <button class="chip-x" data-act="takenDel" data-name="${esc(t.name)}" aria-label="${esc(t.name)} 빼기">✕</button>`}</span>`).join("")}</div>
        <form class="row gap" id="taken-add"><select id="ta-name" aria-label="들은 과목 추가">${PD.SUBJECTS.filter((s) => !taken.some((t) => t.name === s.name)).map((s) => `<option>${esc(s.name)}</option>`).join("")}</select><button class="btn small" type="submit">추가</button></form></details>
      <div class="row gap"><button class="btn primary" data-act="courseSearch" ${m ? "" : "disabled"}>${res ? "다시 찾기" : "조합 찾기"}</button>${m ? "" : `<span class="muted small">진로를 먼저 정해 주세요</span>`}</div>
      <div id="course-res">${res ? resultsHtml(res) : ""}</div>
    </section>`;
  }

  function alphaText(a) {
    const p = Math.round(a * 100);
    return p >= 80 ? `진로 적합 ${p}% : 내신 ${100 - p}% — 권장 과목을 최대한 챙겨요` : p <= 30 ? `진로 적합 ${p}% : 내신 ${100 - p}% — 등급 받기 유리한 과목 위주` : `진로 적합 ${p}% : 내신 ${100 - p}% — 둘 다 고르게`;
  }

  let alphaT = 0;
  A.inputs.alpha = (el) => {
    A.state.courses.alpha = Number(el.value) / 100;
    A.$("#alpha-txt").textContent = alphaText(A.state.courses.alpha);
    A.save();
    clearTimeout(alphaT);
    if (A.ui.courseRes) alphaT = setTimeout(() => runSearch(true), 250);
  };
  A.acts.prefCycle = (el) => {
    const cs = A.state.courses, n = el.dataset.name;
    if (cs.must.includes(n)) { cs.must = cs.must.filter((x) => x !== n); cs.ban.push(n); }
    else if (cs.ban.includes(n)) cs.ban = cs.ban.filter((x) => x !== n);
    else cs.must.push(n);
    A.save();
    if (A.ui.courseRes) runSearch(true); else A.rerender();
  };
  A.acts.takenDel = (el) => { A.state.taken = A.state.taken.filter((t) => t.name !== el.dataset.name); A.state.takenAssumed = false; A.save(); A.ui.courseRes = null; A.rerender(); };
  document.addEventListener("submit", (ev) => {
    if (ev.target.id !== "taken-add") return;
    ev.preventDefault();
    const name = A.$("#ta-name").value, info = PD.subjectInfo(name);
    if (info) { A.state.taken.push(Object.assign({}, info, { sem: "직접" })); A.state.takenAssumed = false; A.save(); A.ui.courseRes = null; A.rerender(); }
  });

  A.acts.courseSearch = () => runSearch(false);

  function runSearch(quiet) {
    const box = A.$("#course-res");
    if (box && !quiet) box.innerHTML = `<p class="muted">조합을 찾는 중…</p>`;
    setTimeout(() => {
      const st = A.state;
      const t0 = performance.now();
      const r = PE.searchCourses({
        catalog: PD.CATALOG, major: A.major(), taken: takenList(), requirements: PD.REQUIREMENTS, reqMap: PD.REQ_MAP,
        prefs: { alpha: st.courses.alpha, must: st.courses.must, ban: st.courses.ban }, strength: strength(), gradeSystem: A.n(), topK: 5,
      });
      r.ms = Math.round(performance.now() - t0);
      A.ui.courseRes = r;
      A.ui.courseSel = 0;
      A.metric("course_search", r.ms);
      A.rerender();
    }, 20);
  }

  function resultsHtml(r) {
    if (!r.results.length) return `<div class="banner warn"><div><b>조건을 모두 만족하는 조합이 없어요</b><p>'꼭 들을 과목'을 줄이거나 '빼고 싶은 과목'을 풀어 보세요. 졸업 요건(예: 사회 16학점)을 채울 과목이 빠졌을 수 있어요.</p></div></div>`;
    const p = r.stats.pruned;
    const prunedSum = p.duplicate + p.prereq + p.requirement + p.bound + p.must + p.banned;
    const skipped = 1 - r.stats.leaves / r.stats.total;
    const sel = A.ui.courseSel || 0;
    const best = r.results[0];
    const x = r.results[sel];
    const bestNames = new Set(best.courses.map((c) => c.name));
    const segs = [["bound", "점수 상한", "#007aff"], ["requirement", "졸업 요건", "#ff3b30"], ["duplicate", "중복 과목", "#ff9500"], ["prereq", "선수 과목", "#34c759"], ["must", "꼭 들을 과목", "#af52de"], ["banned", "뺀 과목", "#a2845e"]];
    return `<div class="res-split"><div class="prune">
        <p><b>${UI.fmtNum(r.stats.total)}</b>가지 중 끝까지 따져 본 조합은 <b>${UI.fmtNum(r.stats.leaves)}</b>개 · 살펴본 갈림길 ${UI.fmtNum(r.stats.visited)}개 · ${r.ms}ms</p>
        <p class="muted small">가지치기로 ${(skipped * 100).toFixed(4)}%를 건너뛰었어요. 갈림길에서 "여기서 더 가도 안 된다"를 미리 알아채고 통째로 잘라요:</p>
        <div class="stack-bar" role="img" aria-label="가지치기 이유 비율">${segs.filter(([k]) => p[k]).map(([k, l, c]) => `<span style="flex:${p[k]};background:${c}" title="${l} ${p[k]}"></span>`).join("")}</div>
        <ul class="legend-list">${segs.filter(([k]) => p[k]).map(([k, l, c]) => `<li><span class="lg-dot" style="background:${c}"></span>${l} ${UI.fmtNum(p[k])}번 <small class="muted">${pruneWhy(k)}</small></li>`).join("")}</ul>
        <p class="muted small">총 ${UI.fmtNum(prunedSum)}번 잘랐어요.</p>
      </div><div>
      <div class="tabs" role="tablist" aria-label="추천 조합">${r.results.map((y, i) => `<button role="tab" class="tab ${i === sel ? "on" : ""}" aria-selected="${i === sel}" data-act="courseSel" data-i="${i}">${i + 1}위 <small>${y.scorePct}점</small></button>`).join("")}</div>
      <div class="combo" role="tabpanel">
        <ul class="reasons">${x.reasons.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
        ${sel > 0 ? `<p class="small">1위와 다른 과목은 <mark>노란색</mark>이에요.</p>` : ""}
        <div class="sem-grid">${PD.CATALOG.semesters.map((sem, si) => `<div><h3>${esc(sem.name)}</h3><ul class="combo-list">
          ${sem.fixed.map((f) => `<li class="fixed"><span class="grp">지정</span>${esc(f.name)} <small>${f.credits}</small></li>`).join("")}
          ${sem.groups.map((g) => { const c = x.courses.find((y) => y.group === g.id); return c ? `<li class="${sel > 0 && !bestNames.has(c.name) ? "diff" : ""}"><span class="grp">${esc(g.name.split(" ")[0])}</span>${courseTag(c)}</li>` : ""; }).join("")}
        </ul></div>`).join("")}</div>
        ${x.alts.length ? `<p class="muted small">예술·교양은 이렇게 바꿔도 점수가 같아요: ${x.alts.slice(0, 3).map(esc).join(" / ")}</p>` : ""}
        <h3>졸업 요건</h3>
        <div class="req-grid">${x.reqCheck.map((q) => `<div class="req ${q.ok ? "ok" : "no"}"><span>${esc(q.area)}</span>${UI.bar(Math.min(1, q.have / q.need), q.ok ? "var(--good)" : "var(--bad)", q.have + "/" + q.need)}<small>${q.have}/${q.need}${q.have > q.before ? ` (+${q.have - q.before})` : ""}</small></div>`).join("")}</div>
        <div class="row gap wrap"><button class="btn primary" data-act="coursePick" data-i="${sel}">${A.state.courses.picked && A.state.courses.picked.key === keyOf(x) ? "✓ 고른 조합" : "이 조합으로 정하기"}</button>
          <button class="btn" data-act="courseToTerm" data-i="${sel}">3학년 1학기 과목을 성적 시뮬레이터에 미리 넣기 →</button></div>
      </div></div></div>`;
  }
  function pruneWhy(k) {
    return { bound: "남은 묶음에서 다 최고를 골라도 5위 안에 못 듦", requirement: "남은 묶음으로는 졸업 학점을 못 채움", duplicate: "이미 들었거나 같은 조합에 있는 과목", prereq: "먼저 들어야 할 과목을 안 들음", must: "꼭 들을 과목이 남은 묶음에 없음", banned: "빼기로 한 과목" }[k];
  }
  function courseTag(c) {
    const m = A.major() || {};
    const core = (m.core || []).includes(c.name), rec = (m.recommended || []).includes(c.name);
    const g = c.evalType === "rank" ? PE.expectedCourseGrade(c, strength(), A.n()) : null;
    return `${core ? `<span class="star" title="핵심 권장">★</span>` : rec ? `<span class="star soft" title="권장">☆</span>` : ""}<b>${esc(c.name)}</b>
      <small class="muted">${c.credits}학점 · ${c.students}명${c.evalType === "achv" ? " · 성취도만" : c.evalType === "pass" ? " · 등급 없음" : " · 예상 " + g + "등급"}${(c.prereq || []).length ? " · 선수: " + c.prereq.map(esc).join(",") : ""}</small>${c.students < 13 && c.evalType === "rank" ? ` <span class="warn small" title="수강자가 적어요">⚠ 소수</span>` : ""}`;
  }
  function keyOf(x) { return x.courses.map((c) => c.name).sort().join("|"); }

  A.acts.courseSel = (el) => { A.ui.courseSel = Number(el.dataset.i); A.rerender(); };
  A.acts.coursePick = (el) => {
    const x = A.ui.courseRes.results[Number(el.dataset.i)];
    A.state.courses.picked = { rank: x.rank, key: keyOf(x), courses: x.courses.map((c) => c.name), coreHave: x.coreHave.length, coreTotal: ((A.major() || {}).core || []).length, at: A.today(), majorId: A.state.profile.majorId };
    A.save();
    A.toast(`${x.rank}위 조합으로 정했어요. 대시보드 흐름에 이어져요.`);
    A.rerender();
  };
  // ② → ③: 고른 조합의 다음 학기 과목을 새 학기로 만들어 성적 시뮬레이터에 넣는다
  A.acts.courseToTerm = (el) => {
    const x = A.ui.courseRes.results[Number(el.dataset.i)];
    const sem = PD.CATALOG.semesters[0];
    const st = A.state;
    const name = "3학년 1학기 (예정)";
    st.terms = st.terms.filter((t) => t.name !== name);
    const subjects = sem.fixed.concat(x.courses.filter((c) => c.sem === 0)).map((c) => PD.makeSubject({
      name: c.name, area: c.area, credits: c.credits, evalType: c.evalType, students: c.students, target: A.n() === 9 ? 3 : 2,
      components: c.evalType === "pass" ? [{ name: "수행평가", kind: "perf", weight: 100, expected: 85 }] : [{ name: "중간고사", kind: "exam", weight: 35, date: null }, { name: "기말고사", kind: "exam", weight: 35, date: null }, { name: "수행평가", kind: "perf", weight: 30, expected: 24, max: 30 }],
    }));
    const id = "t" + Date.now().toString(36);
    st.terms.push({ id, name, subjects, planned: true });
    A.save();
    A.toast(`'${name}' 학기에 ${subjects.length}과목을 넣었어요.`, { action: { label: "성적에서 보기", fn: () => { st.activeTermId = id; A.rev++; A.rebuild("edit", { quiet: true }); A.go("grades"); } } });
  };
})();
