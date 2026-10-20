// 계산 엔진 시험: node --test tests/js
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../../static/engine.js");
const D = require("../../static/data.js");

const TODAY = "2026-10-14";
const AI = D.MAJORS.find((m) => m.id === "ai");
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

function subj(o) {
  return D.makeSubject(Object.assign({
    name: "시험과목", credits: 4, mean: 60, sd: 15, target: 2, lastScore: 70, lastHours: 10, passHours: 10,
    components: [
      { name: "중간", weight: 40, score: 70, date: "2026-10-01" },
      { name: "기말", weight: 40, date: "2026-12-07" },
      { name: "수행", kind: "perf", weight: 20, expected: 18, max: 20 },
    ],
  }, o));
}

test("정규분포 Φ와 역함수가 서로 맞는다", () => {
  for (const p of [0.001, 0.04, 0.1, 0.34, 0.5, 0.66, 0.9, 0.999]) near(E.normCdf(E.normInv(p)), p, 1e-6);
  near(E.normCdf(0), 0.5, 1e-7);
  near(E.normInv(0.975), 1.959964, 1e-4);
});

test("등급 환산: 5등급제·9등급제 경계", () => {
  assert.equal(E.gradeFromPercentile(0.10, 5), 1);
  assert.equal(E.gradeFromPercentile(0.1001, 5), 2);
  assert.equal(E.gradeFromPercentile(0.34, 5), 2);
  assert.equal(E.gradeFromPercentile(0.66, 5), 3);
  assert.equal(E.gradeFromPercentile(0.95, 5), 5);
  assert.equal(E.gradeFromPercentile(0.04, 9), 1);
  assert.equal(E.gradeFromPercentile(0.05, 9), 2);
  assert.equal(E.gradeFromPercentile(0.97, 9), 9);
});

test("석차 등급: 누적 인원은 반올림 (수강자가 적으면 1등급이 없을 수 있다)", () => {
  assert.equal(E.gradeFromRank(12, 120, 5), 1);
  assert.equal(E.gradeFromRank(13, 120, 5), 2);
  assert.equal(E.gradeFromRank(1, 4, 5), 2);   // 4 × 10% = 0.4 → 0명
  assert.equal(E.gradeFromRank(1, 8, 5), 1);   // 8 × 10% = 0.8 → 1명
  assert.equal(E.gradeFromRank(2, 12, 5), 2);
  assert.equal(E.gradeFromRank(12, 12, 5), 5);
});

test("성취도 A~E", () => {
  assert.equal(E.achvOf(90), "A");
  assert.equal(E.achvOf(89.9), "B");
  assert.equal(E.achvOf(60), "D");
  assert.equal(E.achvOf(10), "E");
});

test("등급 경계 점수는 높은 등급일수록 높고, 분포 합은 1", () => {
  const cuts = E.rawCuts(60, 15, 5);
  assert.equal(cuts.length, 4);
  for (let i = 1; i < cuts.length; i++) assert.ok(cuts[i - 1] > cuts[i]);
  near(cuts[0], 60 + 15 * E.normInv(0.9), 1e-9);
  for (const mu of [20, 55, 70, 95]) {
    const d = E.gradeDist(mu, 4, cuts);
    near(d.reduce((a, b) => a + b, 0), 1, 1e-9);
  }
  // 운이 없으면(σ=0) 한 등급에 확률 1
  const d0 = E.gradeDist(cuts[0] + 0.1, 0, cuts);
  assert.deepEqual(d0, [1, 0, 0, 0, 0]);
  const d1 = E.gradeDist(cuts[1] - 0.1, 0, cuts);
  assert.equal(d1[2], 1);
});

test("공부 효과 모델: 지난번만큼 하면 지난 점수, 한 번 더 하면 모자란 점수의 40%를 채움, 역함수 일치", () => {
  const s = subj();
  near(E.examPct(s, 10), 70);
  near(E.examPct(s, 20), 100 - 30 * 0.6, 1e-9);
  near(E.examPct(s, 30), 100 - 30 * 0.36, 1e-9);
  assert.ok(E.examPct(s, 0) >= 35); // 바닥: 지난 점수의 절반
  for (const pct of [72, 80, 90, 97]) near(E.examPct(s, E.hoursForPct(s, pct)), pct, 1e-6);
  // 더 하면 늘 오르거나 같다
  let prev = -1;
  for (let h = 0; h < 80; h += 0.5) { const v = E.examPct(s, h); assert.ok(v >= prev - 1e-12); prev = v; }
});

test("목표 역산: 필요한 기말 점수로 계산하면 정확히 경계 점수가 나온다", () => {
  const s = subj();
  const r = E.required(s, 5, 2);
  assert.equal(r.status, "possible");
  const raw = E.predictRaw(s, 0, r.needPct).mu;
  near(raw, E.rawCuts(60, 15, 5)[1], 1e-6);
  // 수동 계산: 40×0.70 + 20×0.9 + 40×x = cut2
  near(r.needPct, (E.rawCuts(60, 15, 5)[1] - 28 - 18) / 40 * 100, 1e-9);
});

test("목표 역산: 만점이어도 안 되면 '불가능', 이미 넘었으면 '안정권'", () => {
  const hard = subj({ mean: 85, sd: 5, components: [{ name: "중간", weight: 60, score: 40, date: "2026-10-01" }, { name: "기말", weight: 40, date: "2026-12-07" }] });
  const r = E.required(hard, 5, 1);
  assert.equal(r.status, "impossible");
  assert.ok(r.shortRaw > 0);
  const easy = subj({ mean: 40, sd: 10, components: [{ name: "중간", weight: 80, score: 100, date: "2026-10-01" }, { name: "기말", weight: 20, date: "2026-12-07" }] });
  assert.equal(E.required(easy, 5, 1).status, "secured");
});

test("반영 비율 합이 100이 아니어도 100점 기준으로 맞춘다", () => {
  const s = subj({ components: [{ name: "중간", weight: 30, score: 80, date: "2026-10-01" }, { name: "기말", weight: 30, score: 60, date: "2026-12-01" }] });
  near(E.predictRaw(s, 0).mu, 70);
});

test("공부할 수 있는 시간: 평일·주말·공휴일·직접 바꾼 날", () => {
  const av = { weekday: 120, weekend: 300, overrides: { "2026-10-15": 30 } };
  const cal = { events: [{ date: "2026-10-09", name: "한글날", type: "holiday" }] };
  assert.equal(E.capacityOf("2026-10-14", av, cal), 120); // 수
  assert.equal(E.capacityOf("2026-10-17", av, cal), 300); // 토
  assert.equal(E.capacityOf("2026-10-09", av, cal), 300); // 공휴일(금)
  assert.equal(E.capacityOf("2026-10-15", av, cal), 30);
});

function demo() { return D.demoState(TODAY); }

test("최적 배분: 시험 날짜 제약을 지키고, 쓸 수 있는 시간을 넘지 않는다", () => {
  const st = demo();
  const ctx = E.ctxOf(st, TODAY, AI);
  const o = E.optimize(ctx);
  assert.ok(E.checkFeasible(ctx, o.alloc).ok);
  const used = Object.values(o.alloc).reduce((a, b) => a + b, 0);
  assert.ok(used <= o.totalCap);
  for (const v of Object.values(o.alloc)) assert.equal(v % 30, 0);
  // 등급 없는 과목(체육)은 계획에 없다
  const pe = ctx.subjects.find((s) => s.evalType === "pass");
  assert.equal(o.alloc[pe.id], undefined);
});

test("최적 배분: 어느 과목에서 어느 과목으로 30분·1시간을 옮겨도 더 좋아지지 않는다", () => {
  const st = demo();
  const ctx = E.ctxOf(st, TODAY, AI);
  const o = E.optimize(ctx);
  const n = 5;
  const J = (alloc) => o.P.subs.reduce((a, x) => a + x.a * E.lossOf(x.s, (x.done + (alloc[x.id] || 0)) / 60, n, "avg"), 0) / o.P.A;
  const base = J(o.alloc);
  for (const i of o.P.subs) for (const j of o.P.subs) {
    if (i === j) continue;
    for (const m of [30, 60]) {
      if (o.alloc[i.id] - m < o.minB[i.id] * 30) continue;
      const alt = Object.assign({}, o.alloc);
      alt[i.id] -= m; alt[j.id] += m;
      if (!E.checkFeasible(ctx, alt).ok) continue;
      assert.ok(J(alt) >= base - 1e-7, `${i.s.name}→${j.s.name} ${m}분이 더 좋음`);
    }
  }
});

test("최적 배분은 똑같이 나누기보다 평균등급이 낮다", () => {
  const st = demo();
  const ctx = E.ctxOf(st, TODAY, AI);
  const o = E.optimize(ctx);
  const total = Object.values(o.alloc).reduce((a, b) => a + b, 0);
  const even = {};
  const k = o.P.subs.length;
  for (const x of o.P.subs) even[x.id] = Math.floor(total / k / 30) * 30;
  const done = ctx.doneMin;
  const add = (m) => { const r = {}; for (const x of o.P.subs) r[x.id] = (done[x.id] || 0) + (m[x.id] || 0); return r; };
  const gOpt = E.averageGrade(ctx.subjects, add(o.alloc), 5);
  const gEven = E.averageGrade(ctx.subjects, add(even), 5);
  assert.ok(gOpt < gEven, `${gOpt} < ${gEven}`);
});

test("계획표: 과목별 합 = 배분, 시험 당일·이후엔 그 과목 없음, 하루 시간 안 넘음", () => {
  const st = demo();
  const ctx = E.ctxOf(st, TODAY, AI);
  const o = E.optimize(ctx);
  const items = E.schedule(o.P, o.alloc);
  const tot = {}, day = {};
  for (const it of items) {
    tot[it.sid] = (tot[it.sid] || 0) + it.min;
    day[it.date] = (day[it.date] || 0) + it.min;
    const s = ctx.subjects.find((x) => x.id === it.sid);
    assert.ok(it.date < E.nextExam(s).date, `${s.name} ${it.date}`);
    assert.ok(it.date >= TODAY);
  }
  for (const id of Object.keys(o.alloc)) assert.equal(tot[id] || 0, o.alloc[id]);
  for (const d of Object.keys(day)) {
    let cap = E.capacityOf(d, st.availability, st.calendar);
    if (d === TODAY) cap -= E.usedOn(st, TODAY);
    assert.ok(day[d] <= cap, `${d} ${day[d]} > ${cap}`);
  }
});

test("계획표: 시험이 몰려 빠듯해도(EDF 조건) 모두 시험 전에 끝난다", () => {
  const st = demo();
  st.availability = { weekday: 60, weekend: 60, overrides: {} };
  const ctx = E.ctxOf(st, "2026-11-25", AI);
  const o = E.optimize(ctx);
  const items = E.schedule(o.P, o.alloc);
  const tot = {};
  for (const it of items) tot[it.sid] = (tot[it.sid] || 0) + it.min;
  for (const id of Object.keys(o.alloc)) assert.equal(tot[id] || 0, o.alloc[id]);
  assert.ok(E.checkFeasible(ctx, o.alloc).ok);
});

test("할 일 이름: 단원 개념 → 문제 풀이 → 총정리 순서", () => {
  const st = demo();
  const plan = E.buildPlan(st, TODAY, AI);
  const s = E.activeSubjects(st)[0];
  const mine = plan.items.filter((i) => i.sid === s.id && i.date >= TODAY);
  assert.ok(mine.length > 3);
  const order = { concept: 0, practice: 1, final: 2 };
  for (let i = 1; i < mine.length; i++) assert.ok(order[mine[i].kind] >= order[mine[i - 1].kind]);
  assert.equal(mine[mine.length - 1].kind, "final");
  assert.ok(mine[0].task.includes("개념"));
});

test("밀린 계획 → 자동 재조정: 지난 기록은 두고, 오늘부터 다시 짜서 모두 시험 전에 들어간다", () => {
  const st = demo();
  const m = E.missed(st, TODAY);
  assert.ok(m.min > 0);
  assert.ok(E.needsReplan(st, TODAY));
  const oldPlan = st.plan;
  const plan = E.buildPlan(st, TODAY, AI, "replan");
  st.plan = plan;
  assert.ok(!E.needsReplan(st, TODAY));
  // 지난 날짜 항목은 그대로
  const pastOld = oldPlan.items.filter((i) => i.date < TODAY).map((i) => i.id).sort();
  const pastNew = plan.items.filter((i) => i.date < TODAY).map((i) => i.id).sort();
  assert.deepEqual(pastNew, pastOld);
  const diff = E.planDiff(oldPlan, plan, E.activeSubjects(st), TODAY);
  assert.ok(Array.isArray(diff));
});

test("재조정: 오늘 이미 한 시간은 오늘 쓸 수 있는 시간에서 빠진다", () => {
  const st = demo();
  const s = E.activeSubjects(st)[0];
  st.log.push({ id: "x", date: TODAY, sid: s.id, min: 120 });
  const plan = E.buildPlan(st, TODAY, AI, "replan");
  const todayMin = plan.items.filter((i) => i.date === TODAY).reduce((a, i) => a + i.min, 0);
  assert.ok(todayMin <= E.capacityOf(TODAY, st.availability, st.calendar) - 120);
});

test("공부한 기록은 그 과목 다음 시험 준비 시간으로 쌓여 예상 등급을 바꾼다", () => {
  const st = demo();
  const s = E.activeSubjects(st)[0];
  const before = E.doneBySubject(st)[s.id] || 0;
  st.log.push({ id: "y", date: TODAY, sid: s.id, min: 90 });
  assert.equal(E.doneBySubject(st)[s.id], before + 90);
  // 중간고사 전 기록은 기말 준비로 안 센다
  st.log.push({ id: "z", date: "2026-09-20", sid: s.id, min: 500 });
  assert.equal(E.doneBySubject(st)[s.id], before + 90);
});

test("근거: 과목마다 문장, 우선순위, 1시간 가치", () => {
  const st = demo();
  st.plan = E.buildPlan(st, TODAY, AI);
  const ex = E.explain(st, TODAY, AI);
  assert.equal(ex.rows.length, 6);
  ex.rows.forEach((r, i) => {
    assert.equal(r.priority, i + 1);
    assert.ok(r.text.includes(r.name));
    assert.ok(r.fin.expGrade <= r.now.expGrade + 1e-9);
  });
  for (let i = 1; i < ex.rows.length; i++) assert.ok(ex.rows[i - 1].contrib >= ex.rows[i].contrib);
});

test("시나리오: 1순위 과목 시간을 다른 과목으로 옮기면 평균등급이 나빠지거나 같다", () => {
  const st = demo();
  st.plan = E.buildPlan(st, TODAY, AI);
  st.profile.careerWeight = false; // 진짜 평균등급 기준으로만 비교
  st.plan = E.buildPlan(st, TODAY, null);
  const ex = E.explain(st, TODAY, null);
  const top = ex.rows[0], other = ex.rows[ex.rows.length - 1];
  const r = E.swapEffect(st, TODAY, null, top.sid, other.sid, 120);
  assert.equal(r.minutes, 120);
  assert.ok(r.delta >= -0.005, String(r.delta));
});

test("목표 달성 모드: 목표를 이미 넘긴 과목엔 시간을 덜 준다", () => {
  const st = demo();
  const ctxA = E.ctxOf(st, TODAY, AI);
  const a = E.optimize(ctxA);
  st.profile.objective = "target";
  const b = E.optimize(E.ctxOf(st, TODAY, AI));
  const eng = E.activeSubjects(st).find((s) => s.name === "영어Ⅱ"); // 목표 2등급, 이미 거의 안정권
  assert.ok(b.alloc[eng.id] <= a.alloc[eng.id]);
});

test("효율 보정: 예상보다 잘 보면 효율 좋아짐(eff<1), 못 보면 eff>1", () => {
  const s = subj();
  const pred = E.examPct(s, 20);
  const good = E.calibrate(s, 20, pred + 8);
  const bad = E.calibrate(s, 20, pred - 8);
  assert.ok(good.eff < 1, JSON.stringify(good));
  assert.ok(bad.eff > 1, JSON.stringify(bad));
  const same = E.calibrate(s, 20, pred);
  near(same.eff, 1, 0.02);
});

// ───── 선택과목 조합 ─────
function inputFor(major, extra) {
  const st = demo();
  const taken = st.taken.concat(E.activeSubjects(st).map((s) => ({ name: s.name, area: s.area, credits: s.credits })));
  return Object.assign({
    catalog: D.CATALOG, major, taken, requirements: D.REQUIREMENTS, reqMap: D.REQ_MAP,
    prefs: { alpha: 0.7 }, strength: { 수학: 0.12, 과학: 0.3, 국어: 0.3, 영어: 0.15, 사회: 0.4, 정보: 0.3 }, gradeSystem: 5, topK: 5,
  }, extra || {});
}

test("조합 탐색: 결과마다 묶음당 하나, 중복 없음, 선수 과목·졸업 요건 만족", () => {
  for (const m of D.MAJORS) {
    const inp = inputFor(m);
    const r = E.searchCourses(inp);
    assert.ok(r.results.length >= 1, m.name);
    const takenNames = new Set(inp.taken.map((t) => t.name));
    for (const res of r.results) {
      assert.equal(res.courses.length, r.groups.length);
      const names = res.courses.map((c) => c.name);
      assert.equal(new Set(names).size, names.length);
      for (const c of res.courses) {
        assert.ok(!takenNames.has(c.name));
        for (const p of c.prereq || []) assert.ok(takenNames.has(p) || res.courses.some((q) => q.name === p && q.sem < c.sem));
      }
      for (const q of res.reqCheck) assert.ok(q.ok, `${m.name} ${q.area} ${q.have}/${q.need}`);
    }
    for (let i = 1; i < r.results.length; i++) assert.ok(r.results[i - 1].score >= r.results[i].score);
    assert.ok(r.stats.visited < r.stats.total / 1000, "가지치기로 아주 조금만 살펴봐야 한다");
  }
});

test("조합 탐색: 가지치기한 결과가 전부 살펴본 결과(완전 탐색)와 같다", () => {
  // 작은 편성표로 완전 탐색과 비교
  const C = (name, area, credits, students, prereq, evalType) => ({ name, area, credits, students, prereq: prereq || [], evalType: evalType || "rank" });
  const catalog = {
    semesters: [
      { id: "a", name: "1학기", fixed: [], groups: [
        { id: "g1", name: "1", options: [C("미적분Ⅱ", "수학", 4, 80, ["미적분Ⅰ"]), C("기하", "수학", 4, 30), C("경제 수학", "수학", 4, 50)] },
        { id: "g2", name: "2", options: [C("정치", "사회", 4, 50), C("역학과 에너지", "과학", 4, 20, ["물리학"]), C("인공지능 기초", "정보", 4, 10)] },
      ] },
      { id: "b", name: "2학기", fixed: [], groups: [
        { id: "g3", name: "3", options: [C("기하", "수학", 4, 30), C("인공지능 수학", "수학", 4, 25), C("실용 통계", "수학", 4, 20, [], "achv")] },
        { id: "g4", name: "4", options: [C("전자기와 양자", "과학", 4, 8, ["역학과 에너지"]), C("법과 사회", "사회", 4, 40), C("데이터 과학", "정보", 4, 22)] },
      ] },
    ],
  };
  const taken = [{ name: "미적분Ⅰ", area: "수학", credits: 4 }];
  const req = { 사회: 4 };
  const strength = { 수학: 0.2, 과학: 0.3, 사회: 0.5, 정보: 0.25 };
  for (const alpha of [0, 0.5, 1]) {
    const r = E.searchCourses({ catalog, major: AI, taken, requirements: req, prefs: { alpha }, strength, gradeSystem: 5, topK: 3 });
    // 완전 탐색
    const all = [];
    const gs = catalog.semesters.flatMap((s, si) => s.groups.map((g) => g.options.map((o) => Object.assign({ sem: si }, o))));
    const rec = (i, pick) => {
      if (i === gs.length) {
        const names = pick.map((c) => c.name);
        if (new Set(names).size !== names.length) return;
        for (const c of pick) for (const p of c.prereq) if (!(p === "미적분Ⅰ" || pick.some((q) => q.name === p && q.sem < c.sem))) return;
        if (pick.filter((c) => c.area === "사회").reduce((a, c) => a + c.credits, 0) < 4) return;
        const sc = pick.reduce((a, c) => a + c.credits * (alpha * E.courseFit(c, AI) + (1 - alpha) * (1 - (E.expectedCourseGrade(c, strength, 5) - 1) / 4) * (c.evalType === "achv" ? 0 : 1) + (c.evalType === "achv" ? (1 - alpha) * 0.85 : 0)), 0);
        all.push(sc);
        return;
      }
      for (const o of gs[i]) rec(i + 1, pick.concat([o]));
    };
    rec(0, []);
    all.sort((a, b) => b - a);
    assert.equal(r.results.length, Math.min(3, all.length));
    r.results.forEach((x, i) => near(x.score, all[i], 1e-9));
  }
});

test("조합 탐색: 꼭 들을 과목·빼고 싶은 과목", () => {
  const r = E.searchCourses(inputFor(AI, { prefs: { alpha: 0.7, must: ["경제 수학"], ban: ["전자기와 양자"] } }));
  for (const res of r.results) {
    assert.ok(res.courses.some((c) => c.name === "경제 수학"));
    assert.ok(!res.courses.some((c) => c.name === "전자기와 양자"));
  }
});

test("조합 탐색: 진로가 바뀌면 추천도 바뀐다 (AI → 미적분Ⅱ·인공지능 수학, 법 → 정치·법과 사회)", () => {
  const ai = E.searchCourses(inputFor(AI)).results[0].courses.map((c) => c.name);
  assert.ok(ai.includes("미적분Ⅱ") && ai.includes("인공지능 수학"));
  const law = E.searchCourses(inputFor(D.MAJORS.find((m) => m.id === "law"))).results[0].courses.map((c) => c.name);
  assert.ok(law.includes("정치") && law.includes("법과 사회"));
});

test("체험 데이터는 날짜가 멀어도 시험이 앞에 오도록 옮겨진다", () => {
  const st = D.demoState("2027-05-01");
  const s = E.activeSubjects(st)[0];
  assert.ok(E.nextExam(s).date > "2027-05-01");
  assert.ok(st.plan.items.length > 0);
});
