/*
 * Pathway 계산 엔진
 * 화면(브라우저)과 시험(node) 양쪽에서 똑같이 쓰는 순수 계산 함수 모음.
 *  1. 등급 환산 (5등급제·9등급제, 성취도)
 *  2. 과목 점수 합치기와 목표 역산 (기말 몇 점이 필요한지)
 *  3. 공부 효과 모델 (공부 시간 → 예상 점수 → 예상 등급)
 *  4. 최적 시간 배분 (평균등급을 가장 많이 내리는 과목에 30분씩)
 *  5. 일별 계획표 만들기와 자동 재조정
 *  6. 근거 문장 만들기 ("왜 이 과목에 이만큼?")
 *  7. 시험 결과로 공부 효율 보정
 *  8. 선택과목 조합 탐색 (가지치기)
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PE = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ───────────────────────── 0. 기본 도구 ─────────────────────────
  const BLOCK = 30; // 계획의 가장 작은 단위(분)

  const MODEL = {
    passGain: 0.4,    // 범위를 한 번 더 제대로 공부하면 모자란 점수의 40%를 채운다
    floorRatio: 0.5,  // 거의 안 해도 지난 점수의 절반은 나온다고 본다
    sigmaExam: 0.08,  // 아직 안 본 시험의 운(그 시험 반영 비율의 8%)
    sigmaBase: 2,     // 시험 난이도·평균이 바뀌는 불확실성(점)
    achvWeight: 0.5,  // 성취도만 나오는 과목의 중요도
    eps: 0.0012,      // 30분이 이만큼도 못 내리면 더 배정하지 않는다(등급)
  };

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function round(x, d) { const m = Math.pow(10, d || 0); return Math.round(x * m) / m; }

  // 표준정규분포 누적확률 Φ(z)
  function normCdf(z) {
    if (z === Infinity) return 1;
    if (z === -Infinity) return 0;
    // Abramowitz-Stegun 7.1.26 (오차 1.5e-7)
    const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2);
    return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
  }

  // Φ의 역함수 (Acklam)
  function normInv(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const pl = 0.02425;
    let q, r;
    if (p < pl) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 1 - pl) {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  // 날짜는 'YYYY-MM-DD' 글자로 다룬다 (시간대 문제 없음)
  function parseYmd(s) { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); }
  function fmtYmd(t) { return new Date(t).toISOString().slice(0, 10); }
  function addDays(s, n) { return fmtYmd(parseYmd(s) + n * 86400000); }
  function daysBetween(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / 86400000); }
  function dow(s) { return new Date(parseYmd(s)).getUTCDay(); } // 0=일
  function isValidYmd(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && fmtYmd(parseYmd(s)) === s; }

  // ───────────────────────── 1. 등급 환산 ─────────────────────────
  const SYSTEMS = {
    5: { name: "5등급제", cum: [0.10, 0.34, 0.66, 0.90, 1.0], note: "2025년 이후 입학 (고교학점제)" },
    9: { name: "9등급제", cum: [0.04, 0.11, 0.23, 0.40, 0.60, 0.77, 0.89, 0.96, 1.0], note: "2024년 이전 입학" },
  };
  const ACHV = [{ l: "A", min: 90 }, { l: "B", min: 80 }, { l: "C", min: 70 }, { l: "D", min: 60 }, { l: "E", min: 0 }];
  const ACHV_CUTS = [90, 80, 70, 60];

  function sysOf(n) { return SYSTEMS[n] || SYSTEMS[5]; }
  function gradeCount(n) { return sysOf(n).cum.length; }

  // 위에서부터 몇 %(0~1)이면 몇 등급인지
  function gradeFromPercentile(pTop, n) {
    const cum = sysOf(n).cum;
    for (let g = 0; g < cum.length; g++) if (pTop <= cum[g] + 1e-12) return g + 1;
    return cum.length;
  }

  // 석차로 등급 정하기: 등급별 누적 인원 = 반올림(수강자 × 누적 비율)
  function gradeFromRank(rank, students, n) {
    const cum = sysOf(n).cum;
    for (let g = 0; g < cum.length; g++) {
      const k = g === cum.length - 1 ? students : Math.round(students * cum[g] + 1e-9);
      if (rank <= k) return g + 1;
    }
    return cum.length;
  }

  function achvOf(raw) { for (const a of ACHV) if (raw >= a.min - 1e-9) return a.l; return "E"; }

  // 각 등급이 되기 위한 원점수 경계: cuts[g-1] 이상이면 g등급 이내 (길이 = 등급 수 - 1)
  function rawCuts(mean, sd, n) {
    const cum = sysOf(n).cum;
    const out = [];
    for (let g = 0; g < cum.length - 1; g++) out.push(mean + sd * normInv(1 - cum[g]));
    return out;
  }

  // 원점수가 위에서 몇 %인지 (정규분포 가정)
  function percentileOf(raw, mean, sd) { return 1 - normCdf((raw - mean) / Math.max(sd, 0.1)); }

  // ─────────────────── 2. 과목 점수 합치기와 목표 역산 ───────────────────
  // 과목: { id, name, credits, evalType:'rank'|'achv'|'pass', mean, sd, students, target,
  //         components:[{id,name,kind:'exam'|'perf',weight,max,score|null,expected|null,date}],
  //         lastScore, lastHours, passHours, eff }

  function compsOf(s) { return (s.components || []).filter((c) => c && c.weight > 0); }
  function weightSum(s) { return compsOf(s).reduce((a, c) => a + Number(c.weight || 0), 0); }

  function isDone(c) { return c.score !== null && c.score !== undefined && c.score !== ""; }

  // 공부 계획이 겨냥하는 다음 지필 시험
  function nextExam(s) {
    const pend = compsOf(s).filter((c) => c.kind === "exam" && !isDone(c) && isValidYmd(c.date));
    pend.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return pend[0] || null;
  }

  function lastPct(s) {
    const v = Number(s.lastScore);
    return Number.isFinite(v) ? clamp(v, 0, 100) : 70;
  }

  // 범위를 한 번 제대로 공부하는 데 걸리는 시간(시간). 시험 결과로 보정한 효율(eff)을 곱한다
  function passHoursOf(s) {
    const base = Number(s.passHours) > 0 ? Number(s.passHours) : Math.max(4, (Number(s.credits) || 3) * 2.5);
    const eff = Number(s.eff) > 0 ? Number(s.eff) : 1;
    return base * eff;
  }

  // 공부 효과 모델: 이번 시험에 H시간 쓰면 몇 %(만점 대비)가 나올까
  // 지난번만큼 공부하면 지난번 점수, 범위를 한 번(T시간) 더 공부할 때마다 모자란 점수의 40%를 채운다
  function examPct(s, hours) {
    const L = lastPct(s);
    const hL = Math.max(0, Number(s.lastHours) || 0);
    const T = passHoursOf(s);
    const k = -Math.log2(1 - MODEL.passGain); // passGain 0.5 → 1
    const v = 100 - (100 - L) * Math.pow(2, -k * (hours - hL) / T);
    return clamp(v, L * MODEL.floorRatio, 100);
  }

  // 목표 %를 받으려면 이번 시험에 몇 시간이 필요한지 (examPct의 역함수)
  function hoursForPct(s, pct) {
    const L = lastPct(s);
    const hL = Math.max(0, Number(s.lastHours) || 0);
    const T = passHoursOf(s);
    if (pct >= 100) return Infinity;
    if (pct <= L * MODEL.floorRatio) return 0;
    if (L >= 100) return 0;
    const k = -Math.log2(1 - MODEL.passGain);
    const h = hL + (T / k) * Math.log2((100 - L) / (100 - pct));
    return Math.max(0, h);
  }

  // 점수 조각: 이미 본 것, 다음 시험, 그 밖에 아직 안 본 것(예상 점수)
  function parts(s) {
    const nx = nextExam(s);
    let done = 0, other = 0, nextW = 0;
    const pendW = [];
    for (const c of compsOf(s)) {
      const w = Number(c.weight), mx = Number(c.max) > 0 ? Number(c.max) : 100;
      if (isDone(c)) { done += w * clamp(Number(c.score), 0, mx) / mx; continue; }
      pendW.push(w);
      if (nx && c.id === nx.id) { nextW = w; continue; }
      const e = c.expected !== null && c.expected !== undefined && c.expected !== "" ? clamp(Number(c.expected), 0, mx) / mx * 100 : lastPct(s);
      other += w * e / 100;
    }
    const sigma = pendW.length ? Math.sqrt(pendW.reduce((a, w) => a + Math.pow(MODEL.sigmaExam * w, 2), 0) + MODEL.sigmaBase * MODEL.sigmaBase) : 0;
    return { done, other, nextW, sigma, next: nx, total: weightSum(s) };
  }

  // H시간(다음 시험용) 공부했을 때 원점수 예측. nextPct를 주면 그 점수로 계산(슬라이더용)
  function predictRaw(s, hours, nextPct) {
    const p = parts(s);
    const pct = nextPct !== undefined && nextPct !== null ? clamp(nextPct, 0, 100) : (p.nextW ? examPct(s, hours) : 0);
    const scale = p.total > 0 ? 100 / p.total : 1; // 반영 비율 합이 100이 아니어도 100점으로 맞춘다
    return { mu: (p.done + p.other + p.nextW * pct / 100) * scale, sigma: p.sigma * scale, pct, parts: p };
  }

  function cutsFor(s, n) {
    if (s.evalType === "achv") return ACHV_CUTS.slice();
    const mean = Number.isFinite(Number(s.mean)) && s.mean !== "" ? Number(s.mean) : 65;
    const sd = Number(s.sd) > 0 ? Number(s.sd) : 15;
    return rawCuts(mean, sd, n);
  }

  // 등급 분포: 점수가 정규분포(mu, sigma)일 때 각 등급이 나올 확률
  function gradeDist(mu, sigma, cuts) {
    const G = cuts.length + 1;
    const below = cuts.map((c) => (sigma > 0 ? normCdf((c - mu) / sigma) : (mu < c - 1e-9 ? 1 : 0)));
    const dist = [];
    // g등급 = (g-1등급 경계 아래) 이면서 (g등급 경계 이상)
    for (let g = 1; g <= G; g++) {
      const belowUpper = g === 1 ? 1 : below[g - 2];
      const belowOwn = g === G ? 0 : below[g - 1];
      dist.push(Math.max(0, belowUpper - belowOwn));
    }
    return dist;
  }

  function expectedFromDist(dist) { return dist.reduce((a, p, i) => a + p * (i + 1), 0); }

  // 과목 하나의 전망
  function outlook(s, hours, n, nextPct) {
    const r = predictRaw(s, hours, nextPct);
    const cuts = cutsFor(s, n);
    const dist = gradeDist(r.mu, r.sigma, cuts);
    const target = clamp(Number(s.target) || 1, 1, cuts.length + 1);
    const pTarget = dist.slice(0, target).reduce((a, b) => a + b, 0);
    const mean = Number(s.mean) || 65, sd = Number(s.sd) > 0 ? Number(s.sd) : 15;
    const pTop = percentileOf(r.mu, mean, sd);
    return {
      mu: r.mu, sigma: r.sigma, pct: r.pct, dist, cuts,
      grade: s.evalType === "achv" ? null : gradeFromPercentile(pTop, n),
      expGrade: expectedFromDist(dist),
      pTarget, target,
      achv: achvOf(r.mu),
      pTop,
      rank: s.students > 0 ? Math.max(1, Math.ceil(pTop * s.students)) : null,
      lowRisk: r.mu < 40, // 학업성취율 40% 미만이면 미이수 위험
    };
  }

  // 목표 역산: 목표 등급(또는 성취도)을 받으려면 다음 시험에서 몇 점이 필요한가
  function required(s, n, target) {
    const p = parts(s);
    const cuts = cutsFor(s, n);
    const t = clamp(Number(target || s.target) || 1, 1, cuts.length + 1);
    const scale = p.total > 0 ? 100 / p.total : 1;
    const needRaw = t > cuts.length ? 0 : cuts[t - 1];
    const res = { target: t, needRaw: round(needRaw, 1), next: p.next };
    if (!p.next) {
      const now = (p.done + p.other) * scale;
      res.status = now >= needRaw ? "secured" : "closed";
      res.now = round(now, 1);
      return res;
    }
    const mx = Number(p.next.max) > 0 ? Number(p.next.max) : 100;
    const needPct = ((needRaw / scale) - p.done - p.other) / p.nextW * 100;
    res.needPct = needPct;
    res.needScore = Math.ceil(needPct / 100 * mx * 10 - 1e-9) / 10;
    res.max = mx;
    if (needPct <= 0) res.status = "secured";
    else if (needPct > 100) { res.status = "impossible"; res.shortRaw = round((needPct - 100) / 100 * p.nextW * scale, 1); }
    else res.status = "possible";
    res.hours = res.status === "possible" ? hoursForPct(s, needPct) : res.status === "secured" ? 0 : Infinity;
    return res;
  }

  // ─────────────────── 3. 과목 중요도 (목표 진로와 연결) ───────────────────
  function plannable(s) { return s.evalType !== "pass" && !!nextExam(s); }

  // 목적 함수에서 과목의 무게 = 학점 × (진로 과목 가중) × (성취도만이면 0.5)
  function weightOf(s, profile, major) {
    if (s.evalType === "pass") return 0;
    let w = Number(s.credits) || 1;
    if (profile && profile.careerWeight !== false && major && major.areaWeights) w *= major.areaWeights[s.area] || 1;
    if (s.evalType === "achv") w *= MODEL.achvWeight;
    return w;
  }

  // 줄이고 싶은 값: 'avg' = 예상 등급, 'target' = 목표를 놓칠 확률(×등급 수로 크기 맞춤)
  function lossOf(s, hours, n, mode) {
    const o = outlook(s, hours, n);
    if (mode === "target") return (1 - o.pTarget) * (o.cuts.length + 1) * 0.5;
    return o.expGrade;
  }

  // 평균등급 (석차등급이 나오는 과목만, 학점 가중). hours: {sid: 분}
  function averageGrade(subjects, hoursMap, n) {
    let num = 0, den = 0;
    for (const s of subjects) {
      if (s.evalType !== "rank") continue;
      const c = Number(s.credits) || 0;
      if (!c) continue;
      num += c * outlook(s, (hoursMap[s.id] || 0) / 60, n).expGrade;
      den += c;
    }
    return den ? num / den : null;
  }

  // ─────────────────── 4. 공부할 수 있는 시간 ───────────────────
  // availability: { weekday: 분, weekend: 분, overrides: {날짜: 분} }
  // calendar: { events:[{date,name,type:'exam'|'holiday'|'mock'|'event'}] }
  function dayKind(date, calendar) {
    const ev = ((calendar && calendar.events) || []).filter((e) => e.date === date);
    if (ev.some((e) => e.type === "holiday")) return "holiday";
    const w = dow(date);
    if (w === 0 || w === 6) return "weekend";
    return "weekday";
  }

  function capacityOf(date, availability, calendar) {
    const a = availability || {};
    const ov = a.overrides && a.overrides[date];
    if (ov !== undefined && ov !== null && ov !== "") return clamp(Number(ov) || 0, 0, 16 * 60);
    const k = dayKind(date, calendar);
    const v = k === "weekday" ? a.weekday : a.weekend;
    return clamp(Number(v === undefined ? (k === "weekday" ? 180 : 300) : v) || 0, 0, 16 * 60);
  }

  // ─────────────────── 5. 최적 시간 배분 ───────────────────
  /*
   * ctx = { subjects, profile, major, from(오늘), usedToday(분), doneMin:{sid:분}, availability, calendar }
   * 결과: { alloc:{sid:분(앞으로)}, days:[{date, cap(블록)}], ... }
   * 방법: (1) 과목마다 최소 시간(학점×30분) → (2) 30분 덩어리마다 '평균등급을 가장 많이 내리는 과목'에 배정
   *      → (3) 어느 과목에서 어느 과목으로 시간을 옮겨도 더 나아지지 않을 때까지 바꿔 보기
   * 시험 날짜 제약: 시험이 빠른 과목들이 쓰는 시간 합 ≤ 그 시험 전날까지 공부할 수 있는 시간
   */
  function prepare(ctx) {
    const n = (ctx.profile && ctx.profile.gradeSystem) || 5;
    const mode = (ctx.profile && ctx.profile.objective) || "avg";
    const subs = [];
    for (const s of ctx.subjects || []) {
      if (!plannable(s)) continue;
      const ex = nextExam(s);
      if (ex.date <= ctx.from) continue; // 오늘 보는 시험은 더 공부할 날이 없다
      subs.push({ s, id: s.id, exam: ex.date, a: weightOf(s, ctx.profile, ctx.major), done: (ctx.doneMin && ctx.doneMin[s.id]) || 0 });
    }
    const last = subs.reduce((m, x) => (x.exam > m ? x.exam : m), ctx.from);
    const days = [];
    for (let d = ctx.from; d < last; d = addDays(d, 1)) {
      let cap = capacityOf(d, ctx.availability, ctx.calendar);
      if (d === ctx.from) cap = Math.max(0, cap - (ctx.usedToday || 0));
      days.push({ date: d, cap: Math.floor(cap / BLOCK) });
    }
    // 시험 날짜별 '그 전날까지 쓸 수 있는 블록'
    const examDates = Array.from(new Set(subs.map((x) => x.exam))).sort();
    const capBefore = {};
    for (const e of examDates) capBefore[e] = days.filter((d) => d.date < e).reduce((a, d) => a + d.cap, 0);
    const A = subs.reduce((a, x) => a + x.a, 0) || 1;
    return { n, mode, subs, days, examDates, capBefore, A };
  }

  function optimize(ctx, opts) {
    opts = opts || {};
    const P = prepare(ctx);
    const { subs, examDates, capBefore, A, n, mode } = P;
    const blocks = {};
    for (const x of subs) blocks[x.id] = 0;
    const load = {};
    for (const e of examDates) load[e] = 0;

    const cache = {};
    function val(x, b) {
      const key = x.id + ":" + b;
      if (cache[key] === undefined) cache[key] = x.a * lossOf(x.s, (x.done + b * BLOCK) / 60, n, mode) / A;
      return cache[key];
    }
    function slack(exam) { // exam 이후 시험들까지 고려한 남은 블록
      let m = Infinity;
      for (const e of examDates) if (e >= exam) m = Math.min(m, capBefore[e] - load[e]);
      return m;
    }
    function add(x, k) { blocks[x.id] += k; for (const e of examDates) if (e >= x.exam) load[e] += k; }

    // (1) 최소 시간: 시험이 빠른 과목부터 학점×30분 (등급 없는 과목도 감은 유지)
    const minB = {};
    const byExam = subs.slice().sort((p, q) => (p.exam < q.exam ? -1 : p.exam > q.exam ? 1 : q.a - p.a));
    for (const x of byExam) {
      const want = opts.noMin ? 0 : clamp(Math.round(Number(x.s.credits) || 2), 1, 4);
      const k = Math.max(0, Math.min(want, slack(x.exam)));
      minB[x.id] = k;
      if (k) add(x, k);
    }
    // (2) 욕심쟁이 배정 (덩어리 크기를 여러 개 시험해 등급 경계 너머의 이득도 본다)
    const CHUNKS = [1, 2, 4, 8, 16, 32];
    let steps = 0;
    for (;;) {
      let best = null;
      for (const x of subs) {
        const sl = slack(x.exam);
        if (sl <= 0) continue;
        const b = blocks[x.id];
        for (const k of CHUNKS) {
          if (k > sl) break;
          const rate = (val(x, b) - val(x, b + k)) / k;
          if (!best || rate > best.rate + 1e-12) best = { x, k, rate };
        }
      }
      if (!best || best.rate < MODEL.eps) break;
      add(best.x, best.k);
      if (++steps > 5000) break;
    }
    // (3) 옮겨 보기: i → j 로 k블록 옮겨서 좋아지면 옮긴다
    let moves = 0;
    for (let it = 0; it < 300; it++) {
      let best = null;
      for (const i of subs) for (const j of subs) {
        if (i === j) continue;
        for (const k of [1, 2, 4, 8]) {
          if (blocks[i.id] - k < minB[i.id]) break;
          // i에서 빼면 i 시험 이후 제약에 여유가 생긴다
          add(i, -k);
          const ok = slack(j.exam) >= k;
          add(i, k);
          if (!ok) continue;
          const gain = (val(i, blocks[i.id]) + val(j, blocks[j.id])) - (val(i, blocks[i.id] - k) + val(j, blocks[j.id] + k));
          if (gain > 1e-7 && (!best || gain > best.gain)) best = { i, j, k, gain };
        }
      }
      if (!best) break;
      add(best.i, -best.k); add(best.j, best.k); moves++;
    }
    const alloc = {};
    for (const x of subs) alloc[x.id] = blocks[x.id] * BLOCK;
    const totalCap = P.days.reduce((a, d) => a + d.cap, 0) * BLOCK;
    const used = Object.values(alloc).reduce((a, b) => a + b, 0);
    return { alloc, P, minB, moves, totalCap, free: totalCap - used, val };
  }

  // 마음대로 정한 시간(분)이 날짜 제약을 지키는지
  function checkFeasible(ctx, allocMin) {
    const P = prepare(ctx);
    for (const e of P.examDates) {
      const need = P.subs.filter((x) => x.exam <= e).reduce((a, x) => a + Math.ceil((allocMin[x.id] || 0) / BLOCK), 0);
      if (need > P.capBefore[e]) return { ok: false, exam: e, over: (need - P.capBefore[e]) * BLOCK };
    }
    return { ok: true };
  }

  // ─────────────────── 6. 일별 계획표 ───────────────────
  // 날마다: (1) 시험 날짜를 지키려면 오늘 꼭 해야 하는 양을 먼저 넣고
  //        (2) 남은 칸은 '남은 양 ÷ 남은 시간'이 큰(급한) 과목부터 고르게 나눈다
  function schedule(P, alloc) {
    const rem = {};
    for (const x of P.subs) rem[x.id] = Math.round((alloc[x.id] || 0) / BLOCK);
    const out = [];
    const days = P.days;
    for (let di = 0; di < days.length; di++) {
      const day = days[di];
      const today = {};
      for (const x of P.subs) today[x.id] = 0;
      let left = day.cap;
      const live = P.subs.filter((x) => x.exam > day.date);
      const perDay = Math.max(2, Math.ceil(day.cap / 2)); // 하루 한 과목은 하루의 절반까지 (여러 과목을 섞어서)
      const capLeftOf = {};
      for (const x of live) {
        let c = 0;
        for (let j = di; j < days.length && days[j].date < x.exam; j++) c += days[j].cap;
        capLeftOf[x.id] = c;
      }
      // 급한 정도 = 남은 양 ÷ 남은 시간. 오늘 이미 많이 넣은 과목은 뒤로
      // 30분씩 잘게 쪼개지지 않게: 오늘 시작한 과목은 1시간까지 이어서, 하루에 과목 수는 몇 개로
      const maxSubj = Math.max(2, Math.ceil(day.cap / 3));
      const tomorrow = addDays(day.date, 1);
      const urgency = (x) => (rem[x.id] - today[x.id]) / Math.max(1, capLeftOf[x.id])
        - (today[x.id] >= perDay ? 10 : 0)
        + (today[x.id] === 1 ? 0.5 : 0)
        + (x.exam === tomorrow ? 1 : 0);
      const give = (cands, strict) => {
        let best = null;
        const started = live.filter((x) => today[x.id] > 0).length;
        for (const x of cands) {
          if (rem[x.id] - today[x.id] <= 0) continue;
          if (strict && !today[x.id] && started >= maxSubj) continue;
          const u = urgency(x);
          if (!best || u > best.u) best = { x, u };
        }
        if (!best) return false;
        today[best.x.id] += 1; left -= 1;
        return true;
      };
      // (1) 꼭 해야 하는 양: 시험 날짜마다 '그 날까지 남은 양 - 내일부터 쓸 수 있는 시간'
      for (const e of P.examDates) {
        if (e <= day.date) continue;
        let future = 0;
        for (let j = di + 1; j < days.length && days[j].date < e; j++) future += days[j].cap;
        const group = live.filter((x) => x.exam <= e);
        let need = group.reduce((a, x) => a + rem[x.id] - today[x.id], 0) - future;
        while (need > 0 && left > 0 && give(group)) need--;
      }
      // (2) 남은 칸은 고르게: 여유 시간이 있으면 날마다 같은 비율만 채운다 (여유가 끝에 몰리지 않게)
      //     남는 시간(여유)은 시험에서 먼 날에 준다: 3주 안쪽은 1/4만, 마지막 1주는 여유 없이
      const firstExam = P.examDates.find((e) => e > day.date) || day.date;
      const vOf = (d) => { const k = daysBetween(d, firstExam); return k > 21 ? 1 : k > 7 ? 0.25 : 0; };
      let capAll = 0, capW = 0;
      for (let j = di; j < days.length; j++) { capAll += days[j].cap; capW += days[j].cap * vOf(days[j].date); }
      const remAll = live.reduce((a, x) => a + rem[x.id], 0);
      const freeRem = Math.max(0, capAll - remAll);
      const quota = Math.max(0, day.cap - Math.floor(freeRem * day.cap * vOf(day.date) / Math.max(1e-9, capW) + 1e-9));
      while (left > 0 && day.cap - left < quota) {
        const cands = live.filter((x) => today[x.id] < perDay);
        if (!give(cands, true) && !give(cands, false)) break;
      }
      for (const x of P.subs) {
        if (!today[x.id]) continue;
        rem[x.id] -= today[x.id];
        out.push({ date: day.date, sid: x.id, min: today[x.id] * BLOCK });
      }
    }
    return out;
  }

  // 할 일 이름 붙이기: 과목마다 전체 시간의 60%는 단원별 개념, 30% 문제풀이, 마지막 10%는 총정리
  function labelTasks(items, subjects, doneMin) {
    const byS = {};
    for (const it of items) (byS[it.sid] = byS[it.sid] || []).push(it);
    for (const sid of Object.keys(byS)) {
      const s = subjects.find((x) => x.id === sid);
      const list = byS[sid].sort((a, b) => (a.date < b.date ? -1 : 1));
      const done = (doneMin && doneMin[sid]) || 0;
      const total = done + list.reduce((a, it) => a + it.min, 0);
      const units = ((s && s.units) || []).filter((u) => u && u.name);
      const sizeSum = units.reduce((a, u) => a + (Number(u.size) || 1), 0);
      let pos = done;
      list.forEach((it, idx) => {
        const mid = (pos + it.min / 2) / Math.max(1, total);
        let task, kind;
        if (idx === list.length - 1 && list.length > 1) { task = "총정리 · 틀린 문제 다시 보기"; kind = "final"; }
        else if (mid < 0.6) {
          kind = "concept";
          if (units.length) {
            const a = (pos / Math.max(1, total)) / 0.6 * sizeSum, b = ((pos + it.min) / Math.max(1, total)) / 0.6 * sizeSum;
            const names = []; let acc = 0;
            for (const u of units) { const lo = acc; acc += Number(u.size) || 1; if (acc > a + 1e-9 && lo < b - 1e-9) names.push(u.name); }
            task = names.length ? (names.length > 2 ? names[0] + " ~ " + names[names.length - 1] : names.join(", ")) + " 개념" : "범위 개념 공부";
          } else task = "범위 개념 공부";
        } else if (mid < 0.9) { kind = "practice"; task = "문제 풀이 · 기출"; }
        else { kind = "final"; task = "총정리 · 틀린 문제 다시 보기"; }
        it.task = task; it.kind = kind;
        pos += it.min;
      });
    }
    return items;
  }

  // ─────────────────── 7. 계획 만들기·재조정 ───────────────────
  // 기록(log): [{id, date, sid, min, itemId?}]
  function doneBySubject(state, beforeDate) {
    const out = {};
    const subs = activeSubjects(state);
    for (const l of state.log || []) {
      const s = subs.find((x) => x.id === l.sid);
      if (!s) continue;
      const ex = nextExam(s);
      // 다음 시험 전에 한 공부만 그 시험 준비로 센다 (지난 시험 전 기록은 빼기)
      if (ex && l.date >= (s.prepFrom || "0000-00-00") && l.date < ex.date && (!beforeDate || l.date <= beforeDate)) out[l.sid] = (out[l.sid] || 0) + (Number(l.min) || 0);
    }
    return out;
  }

  function activeTerm(state) {
    const ts = state.terms || [];
    return ts.find((t) => t.id === state.activeTermId) || ts[0] || { subjects: [] };
  }
  function activeSubjects(state) { return activeTerm(state).subjects || []; }

  function usedOn(state, date) { return (state.log || []).filter((l) => l.date === date).reduce((a, l) => a + (Number(l.min) || 0), 0); }

  function itemDone(state, itemId) { return (state.log || []).filter((l) => l.itemId === itemId).reduce((a, l) => a + (Number(l.min) || 0), 0); }

  function ctxOf(state, today, major) {
    return {
      subjects: activeSubjects(state),
      profile: state.profile || {},
      major,
      from: today,
      usedToday: usedOn(state, today),
      doneMin: doneBySubject(state),
      availability: state.availability,
      calendar: state.calendar,
    };
  }

  let idSeq = 0;
  function newId(prefix) { idSeq = (idSeq + 1) % 1e6; return (prefix || "i") + Date.now().toString(36) + idSeq.toString(36) + Math.random().toString(36).slice(2, 6); }

  // 새 계획 (지난 날의 계획·오늘 한 것은 그대로 두고 오늘 남은 시간부터 다시 짠다)
  function buildPlan(state, today, major, reason) {
    const ctx = ctxOf(state, today, major);
    const opt = optimize(ctx);
    const items = labelTasks(schedule(opt.P, opt.alloc), ctx.subjects, ctx.doneMin);
    const old = state.plan;
    const keep = [];
    if (old && old.items) {
      for (const it of old.items) {
        if (it.date < today) keep.push(it);
        else if (it.date === today) {
          const d = itemDone(state, it.id);
          if (d > 0) keep.push(Object.assign({}, it, { min: d }));
        }
      }
    }
    const fresh = items.map((it) => Object.assign({ id: newId("p") }, it));
    const plan = {
      id: newId("plan"),
      createdAt: today,
      from: today,
      reason: reason || "new",
      items: keep.concat(fresh).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
      alloc: opt.alloc,
      doneAtBuild: ctx.doneMin,
      free: opt.free,
      totalCap: opt.totalCap,
    };
    return plan;
  }

  // 밀린 계획: 오늘 전 날짜 계획 중 못 한 분
  function missed(state, today) {
    const plan = state.plan;
    if (!plan) return { min: 0, items: [] };
    const out = [];
    let min = 0;
    for (const it of plan.items || []) {
      if (it.date >= today) continue;
      const left = it.min - itemDone(state, it.id);
      if (left > 0) { out.push({ it, left }); min += left; }
    }
    return { min, items: out };
  }

  // 다시 짜야 하나? 지난 날짜에 못 한 계획이 있고, 그 뒤로 아직 다시 안 짰으면
  function needsReplan(state, today) {
    const p = state.plan;
    if (!p) return false;
    if (p.from >= today) return false;
    return missed(state, today).min > 0;
  }

  // 새 계획과 옛 계획 비교 (재조정 결과 설명용)
  function planDiff(oldPlan, newPlan, subjects, today) {
    const sum = (plan) => {
      const o = {};
      for (const it of (plan && plan.items) || []) if (it.date >= today) o[it.sid] = (o[it.sid] || 0) + it.min;
      return o;
    };
    const a = sum(oldPlan), b = sum(newPlan);
    const ids = Array.from(new Set(Object.keys(a).concat(Object.keys(b))));
    return ids.map((id) => {
      const s = subjects.find((x) => x.id === id);
      return { sid: id, name: s ? s.name : id, before: a[id] || 0, after: b[id] || 0, delta: (b[id] || 0) - (a[id] || 0) };
    }).filter((d) => d.delta !== 0).sort((p, q) => Math.abs(q.delta) - Math.abs(p.delta));
  }

  // ─────────────────── 8. 근거 ("왜?") ───────────────────
  function fmtH(min) {
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    if (!h) return m + "분";
    return m ? h + "시간 " + m + "분" : h + "시간";
  }

  // 과목마다: 배정 시간, 지금 멈추면/계획대로 하면 예상 등급, 1시간 가치, 근거 문장
  function explain(state, today, major, plan) {
    plan = plan || state.plan;
    const ctx = ctxOf(state, today, major);
    const n = ctx.profile.gradeSystem || 5;
    const mode = ctx.profile.objective || "avg";
    const P = prepare(ctx);
    const future = {};
    for (const it of (plan && plan.items) || []) if (it.date >= today) future[it.sid] = (future[it.sid] || 0) + it.min - (it.date === today ? itemDone(state, it.id) : 0);
    const rows = [];
    for (const x of P.subs) {
      const s = x.s;
      const done = x.done, fut = Math.max(0, future[s.id] || 0);
      const now = outlook(s, done / 60, n);
      const fin = outlook(s, (done + fut) / 60, n);
      const same = outlook(s, Math.max(done / 60, Number(s.lastHours) || 0), n);
      const h1 = outlook(s, (done + fut + 60) / 60, n);
      const lossNow = lossOf(s, (done + fut) / 60, n, mode), lossMore = lossOf(s, (done + fut + 60) / 60, n, mode);
      const req = required(s, n);
      const days = daysBetween(today, x.exam);
      rows.push({
        sid: s.id, name: s.name, area: s.area, credits: s.credits, exam: x.exam, days,
        weight: x.a, share: x.a / P.A, done, future: fut, total: done + fut,
        now, fin, same, req,
        gain: (now.expGrade - fin.expGrade),          // 계획으로 내려가는 등급
        contrib: x.a / P.A * (lossOf(s, done / 60, n, mode) - lossNow), // 목적 함수에 이바지한 정도
        marginal: x.a / P.A * (lossNow - lossMore),   // 1시간 더 하면 줄어드는 값
        marginalGrade: fin.expGrade - h1.expGrade,
        careerW: major && major.areaWeights ? (major.areaWeights[s.area] || 1) : 1,
      });
    }
    rows.sort((p, q) => q.contrib - p.contrib);
    rows.forEach((r, i) => { r.priority = i + 1; r.text = reasonText(r, n, ctx.profile); });
    return { rows, n, mode, A: P.A };
  }

  function gradeLabel(g, s) { return s && s.evalType === "achv" ? g : g + "등급"; }

  function reasonText(r, n, profile) {
    const bits = [];
    bits.push(r.credits + "학점");
    if (r.careerW > 1 && profile.careerWeight !== false) bits.push("진로 과목 ×" + r.careerW);
    if (r.req.status === "impossible") bits.push("목표 " + r.req.target + "등급은 어려움 → 한 등급 아래를 지키는 데 집중");
    else if (r.req.status === "secured") bits.push("목표 " + r.req.target + "등급 이미 안정권");
    else bits.push("목표 " + r.req.target + "등급까지 다음 시험 " + Math.max(0, Math.round(r.req.needPct)) + "% 필요");
    bits.push("시험까지 " + r.days + "일");
    const head = r.name + "에 " + fmtH(r.future) + " 배정";
    const tail = "예상 " + r.now.expGrade.toFixed(2) + " → " + r.fin.expGrade.toFixed(2) + "등급";
    return head + ": " + bits.join(", ") + ". " + tail;
  }

  // 시나리오: 과목 A에서 과목 B로 m분 옮기면 평균등급이 어떻게 바뀌나
  function swapEffect(state, today, major, fromSid, toSid, minutes) {
    const subs = activeSubjects(state);
    const n = (state.profile && state.profile.gradeSystem) || 5;
    const done = doneBySubject(state);
    const plan = state.plan;
    const fut = {};
    for (const it of (plan && plan.items) || []) if (it.date >= today) fut[it.sid] = (fut[it.sid] || 0) + it.min;
    const base = {}, moved = {};
    for (const s of subs) { base[s.id] = (done[s.id] || 0) + (fut[s.id] || 0); moved[s.id] = base[s.id]; }
    const m = Math.min(minutes, fut[fromSid] || 0);
    moved[fromSid] -= m; moved[toSid] = (moved[toSid] || 0) + m;
    const g0 = averageGrade(subs, base, n), g1 = averageGrade(subs, moved, n);
    return { minutes: m, before: g0, after: g1, delta: g1 !== null && g0 !== null ? g1 - g0 : 0 };
  }

  // ─────────────────── 9. 시험 결과로 효율 보정 ───────────────────
  // 예측 모델이 실제 점수에 맞도록 '범위 한 번 공부 시간' 배율(eff)을 고친다
  function calibrate(s, hours, actualPct) {
    const L = lastPct(s);
    const hL = Math.max(0, Number(s.lastHours) || 0);
    const T = passHoursOf(s);
    const k = -Math.log2(1 - MODEL.passGain);
    const predicted = examPct(s, hours);
    const S = clamp(actualPct, 0, 99.5);
    let ratio = 1;
    const dh = hours - hL;
    if (Math.abs(dh) >= 1 && Math.abs(S - L) >= 0.5 && L < 100) {
      const x = Math.log2((100 - L) / (100 - S)); // 실제로 '몇 번 공부한 효과'였나
      if (x > 0 && dh > 0) ratio = (dh * k / x) / T;           // 더 하고 더 올랐다
      else if (x <= 0 && dh > 0) ratio = 2;                    // 더 했는데 그대로이거나 떨어짐
      else if (x < 0 && dh < 0) ratio = (dh * k / x) / T;      // 덜 하고 떨어졌다
      else ratio = 0.5;                                        // 덜 했는데 올랐다
    } else if (Math.abs(S - predicted) >= 3) {
      ratio = S > predicted ? 0.85 : 1.15;
    }
    ratio = clamp(ratio, 0.5, 2);
    const old = Number(s.eff) > 0 ? Number(s.eff) : 1;
    const eff = clamp(Math.sqrt(old * old * ratio), 0.4, 2.5); // 한 번에 확 바꾸지 않고 반쯤만
    return { predicted: round(predicted, 1), actual: round(S, 1), ratio: round(ratio, 2), eff: round(eff, 2), oldEff: old };
  }

  // ─────────────────── 10. 선택과목 조합 탐색 ───────────────────
  /*
   * catalog = { semesters:[{id,name, fixed:[course], groups:[{id,name, options:[course]}]}] }
   * course = { name, area, credits, evalType, students, prereq:[이름] }
   * input = { catalog, major, taken:[{name, area, credits}], requirements:{area: 학점, total}, prefs:{alpha, must:[], ban:[]},
   *           strength:{area: 위에서부터 비율(0~1)}, gradeSystem, topK }
   * 점수 = 과목마다 학점 × (α·진로 적합 + (1-α)·내신 유리) — 더하기로 이루어져서 '남은 묶음 최대 점수'로 가지치기가 된다
   */
  function courseFit(c, major) {
    if (!major) return 0.3;
    if ((major.core || []).includes(c.name)) return 1;
    if ((major.recommended || []).includes(c.name)) return 0.65;
    const aw = (major.areaWeights || {})[c.area] || 1;
    return clamp(0.15 + (aw - 1) * 0.8, 0, 0.45);
  }

  function expectedCourseGrade(c, strength, n) {
    const p = clamp((strength && strength[c.area]) !== undefined ? strength[c.area] : 0.35, 0.001, 1);
    const N = Math.max(1, Number(c.students) || 30);
    const rank = Math.max(1, Math.ceil(p * N - 1e-9));
    return gradeFromRank(rank, N, n);
  }

  function courseGradeScore(c, strength, n) {
    if (c.evalType === "pass") return 0.6;
    if (c.evalType === "achv") return 0.85; // 석차등급이 없어 내신 부담이 적다
    const g = expectedCourseGrade(c, strength, n);
    const G = gradeCount(n);
    return 1 - (g - 1) / (G - 1);
  }

  function searchCourses(input) {
    const n = input.gradeSystem || 5;
    const alpha = clamp(input.prefs && input.prefs.alpha !== undefined ? Number(input.prefs.alpha) : 0.7, 0, 1);
    const must = new Set((input.prefs && input.prefs.must) || []);
    const ban = new Set((input.prefs && input.prefs.ban) || []);
    const takenNames = new Set((input.taken || []).map((t) => t.name));
    const req = input.requirements || {};
    const topK = input.topK || 5;
    const major = input.major;
    const ra = (c) => (input.reqMap && input.reqMap[c.area]) || c.area; // 졸업 요건에서 묶이는 교과군

    // 지정 과목(모두 듣는 것)과 고를 묶음을 학기 순서대로 펼친다
    const fixed = [];
    const groups = [];
    (input.catalog.semesters || []).forEach((sem, si) => {
      for (const f of sem.fixed || []) fixed.push(Object.assign({ sem: si, semName: sem.name }, f));
      for (const g of sem.groups || []) {
        groups.push({ id: g.id, name: g.name, sem: si, semName: sem.name, options: g.options.map((o) => Object.assign({ sem: si, semName: sem.name, group: g.id }, o)) });
      }
    });
    const score = (c) => (Number(c.credits) || 0) * (alpha * courseFit(c, major) + (1 - alpha) * courseGradeScore(c, input.strength, n));
    // 점수 높은 과목부터 살펴보면 좋은 답을 일찍 찾아서 가지치기가 훨씬 많이 된다
    for (const g of groups) g.sorted = g.options.slice().sort((a, b) => score(b) - score(a));

    // 이미 들은 과목 + 지정 과목으로 시작한 학점
    const areaBase = {};
    let totalBase = 0;
    for (const t of (input.taken || []).concat(fixed)) { areaBase[ra(t)] = (areaBase[ra(t)] || 0) + (Number(t.credits) || 0); totalBase += Number(t.credits) || 0; }
    const reqAreas = Object.keys(req).filter((k) => k !== "total");

    // 뒤에서부터: 남은 묶음에서 얻을 수 있는 최대 점수 / 영역별 최대 학점 / 남은 묶음에 나오는 과목 이름
    const G = groups.length;
    const blocked = (o) => ban.has(o.name) || takenNames.has(o.name) || fixed.some((f) => f.name === o.name);
    // 점수 상한(가지치기용): 여러 묶음에 나오는 과목은 한 번만 들을 수 있다는 것까지 넣어 DP로 정확히 계산
    //   ub[i][mask] = i번째 묶음부터 끝까지 고를 때 얻을 수 있는 최대 점수 (mask = 이미 고른 '겹치는 과목')
    const nameCount = {};
    for (const g of groups) for (const o of g.options) if (!blocked(o)) nameCount[o.name] = (nameCount[o.name] || 0) + 1;
    const dupNames = Object.keys(nameCount).filter((k) => nameCount[k] > 1);
    const dupBit = {};
    dupNames.forEach((k, i) => (dupBit[k] = 1 << i));
    const M = 1 << dupNames.length;
    const ub = Array.from({ length: G + 1 }, () => new Float64Array(M));
    for (let i = G - 1; i >= 0; i--) {
      const opts = groups[i].options.filter((o) => !blocked(o)).map((o) => ({ sc: score(o), bit: dupBit[o.name] || 0 }));
      for (let mask = 0; mask < M; mask++) {
        let best = -Infinity;
        for (const o of opts) {
          if (o.bit & mask) continue;
          const v = o.sc + ub[i + 1][mask | o.bit];
          if (v > best) best = v;
        }
        ub[i][mask] = best;
      }
    }
    let curMask = 0;
    const sufScore = new Array(G + 1).fill(0);
    const sufArea = Array.from({ length: G + 1 }, () => ({}));
    const sufTotal = new Array(G + 1).fill(0);
    const sufNames = Array.from({ length: G + 1 }, () => new Set());
    for (let i = G - 1; i >= 0; i--) {
      const opts = groups[i].options.filter((o) => !ban.has(o.name));
      sufScore[i] = sufScore[i + 1] + (opts.length ? Math.max(...opts.map(score)) : 0);
      sufTotal[i] = sufTotal[i + 1] + (opts.length ? Math.max(...opts.map((o) => Number(o.credits) || 0)) : 0);
      const a = Object.assign({}, sufArea[i + 1]);
      for (const ar of reqAreas) a[ar] = (a[ar] || 0) + (opts.length ? Math.max(0, ...opts.filter((o) => ra(o) === ar).map((o) => Number(o.credits) || 0)) : 0);
      sufArea[i] = a;
      sufNames[i] = new Set(sufNames[i + 1]);
      for (const o of opts) sufNames[i].add(o.name);
    }

    const stats = { total: groups.reduce((a, g) => a * Math.max(1, g.options.length), 1), visited: 0, leaves: 0, pruned: { duplicate: 0, prereq: 0, banned: 0, requirement: 0, must: 0, bound: 0 } };
    const best = []; // 점수 높은 순 topK
    const pick = [];
    const area = Object.assign({}, areaBase);
    let total = totalBase;
    const chosen = new Set();

    function kth() { return best.length < topK ? -Infinity : best[best.length - 1].score; }

    function prereqOk(c) {
      for (const p of c.prereq || []) {
        if (takenNames.has(p)) continue;
        // 같은 조합에서 앞 학기에 듣는 것도 된다
        if (pick.some((q) => q.name === p && q.sem < c.sem)) continue;
        if (fixed.some((q) => q.name === p && q.sem < c.sem)) continue;
        return false;
      }
      return true;
    }

    function dfs(i, sc) {
      stats.visited++;
      // 졸업 요건: 남은 묶음을 다 써도 못 채우면 그만
      for (const ar of reqAreas) if ((area[ar] || 0) + (sufArea[i][ar] || 0) < req[ar]) { stats.pruned.requirement++; return; }
      if (req.total && total + sufTotal[i] < req.total) { stats.pruned.requirement++; return; }
      for (const m of must) if (!chosen.has(m) && !takenNames.has(m) && !sufNames[i].has(m) && !fixed.some((f) => f.name === m)) { stats.pruned.must++; return; }
      // 점수 상한: 남은 묶음에서 다 최고를 골라도 지금 5등 안에 못 들면 그만
      if (sc + ub[i][curMask] <= kth() + 1e-9) { stats.pruned.bound++; return; }
      if (i === G) {
        stats.leaves++;
        // 등급이 안 나오는 과목(예술·교양)만 다른 조합은 하나로 묶는다 (대안으로 보여 줌)
        const key = pick.filter((c) => c.evalType !== "pass").map((c) => c.name).sort().join("|");
        const same = best.find((b) => b.key === key);
        const alt = pick.filter((c) => c.evalType === "pass").map((c) => c.name).join("·");
        if (same) {
          if (sc > same.score) { same.alts.push(same.altName); same.score = sc; same.courses = pick.slice(); same.altName = alt; }
          else same.alts.push(alt);
        } else {
          best.push({ key, score: sc, courses: pick.slice(), alts: [], altName: alt });
        }
        best.sort((a, b) => b.score - a.score);
        if (best.length > topK) best.pop();
        return;
      }
      for (const o of groups[i].sorted) {
        if (ban.has(o.name)) { stats.pruned.banned++; continue; }
        if (chosen.has(o.name) || takenNames.has(o.name) || fixed.some((f) => f.name === o.name)) { stats.pruned.duplicate++; continue; }
        if (!prereqOk(o)) { stats.pruned.prereq++; continue; }
        const bit = dupBit[o.name] || 0;
        pick.push(o); chosen.add(o.name); curMask |= bit;
        area[ra(o)] = (area[ra(o)] || 0) + (Number(o.credits) || 0); total += Number(o.credits) || 0;
        dfs(i + 1, sc + score(o));
        area[ra(o)] -= Number(o.credits) || 0; total -= Number(o.credits) || 0;
        pick.pop(); chosen.delete(o.name); curMask &= ~bit;
      }
    }
    dfs(0, 0);

    const maxScore = ub[0][0] > 0 ? ub[0][0] : sufScore[0] || 1;
    const results = best.map((b, idx) => describeCombo(b, idx, { fixed, input, major, n, req, areaBase, totalBase, maxScore, alpha, takenNames, ra }));
    return { results, stats, groups, fixed };
  }

  function describeCombo(b, idx, o) {
    const { fixed, input, major, n, req, areaBase, totalBase, takenNames, ra } = o;
    const all = b.courses;
    const area = Object.assign({}, areaBase);
    let total = totalBase;
    for (const c of all) { area[ra(c)] = (area[ra(c)] || 0) + (Number(c.credits) || 0); total += Number(c.credits) || 0; }
    const core = (major && major.core) || [];
    const recd = (major && major.recommended) || [];
    const coreHave = core.filter((x) => takenNames.has(x) || all.some((c) => c.name === x) || fixed.some((f) => f.name === x));
    const coreNew = core.filter((x) => all.some((c) => c.name === x));
    const coreMiss = core.filter((x) => !coreHave.includes(x));
    const recNew = recd.filter((x) => all.some((c) => c.name === x));
    let gNum = 0, gDen = 0;
    const small = [];
    for (const c of all) {
      if (c.evalType !== "rank") continue;
      const g = expectedCourseGrade(c, input.strength, n);
      gNum += g * c.credits; gDen += c.credits;
      if ((Number(c.students) || 30) < 13) small.push(c.name + "(" + c.students + "명)");
    }
    const reqCheck = Object.keys(req).filter((k) => k !== "total").map((ar) => ({ area: ar, need: req[ar], have: area[ar] || 0, ok: (area[ar] || 0) >= req[ar], before: areaBase[ar] || 0 }));
    if (req.total) reqCheck.push({ area: "전체 교과", need: req.total, have: total, ok: total >= req.total, before: totalBase });
    const reasons = [];
    if (core.length) reasons.push("핵심 권장 과목 " + core.length + "개 중 " + coreHave.length + "개 이수" + (coreNew.length ? " (이번 조합: " + coreNew.join("·") + ")" : ""));
    if (recNew.length) reasons.push("권장 과목 " + recNew.length + "개 (" + recNew.slice(0, 4).join("·") + (recNew.length > 4 ? " 외" : "") + ")");
    if (gDen) reasons.push("이 과목들의 예상 내신 평균 " + (gNum / gDen).toFixed(2) + "등급");
    if (small.length) reasons.push("수강자가 적은 과목 주의: " + small.join(", ") + " — 1등급 인원이 매우 적어요");
    const tight = reqCheck.filter((r) => r.ok && r.before < r.need);
    if (tight.length) reasons.push("졸업 요건 채움: " + tight.map((r) => r.area + " " + r.before + "→" + r.have + "/" + r.need).join(", "));
    const alts = Array.from(new Set(b.alts || [])).filter((a) => a && a !== b.altName);
    return {
      rank: idx + 1, score: b.score, alts, scorePct: Math.round(b.score / o.maxScore * 100),
      courses: all, coreHave, coreMiss, coreNew, recNew,
      expGrade: gDen ? gNum / gDen : null, small, reqCheck, reasons, total,
    };
  }

  return {
    BLOCK, MODEL, SYSTEMS, ACHV,
    clamp, round, normCdf, normInv,
    parseYmd, fmtYmd, addDays, daysBetween, dow, isValidYmd,
    gradeFromPercentile, gradeFromRank, achvOf, rawCuts, percentileOf, gradeCount,
    weightSum, nextExam, examPct, hoursForPct, parts, predictRaw, cutsFor, gradeDist, outlook, required,
    plannable, weightOf, lossOf, averageGrade,
    dayKind, capacityOf,
    prepare, optimize, checkFeasible, schedule, labelTasks,
    activeTerm, activeSubjects, doneBySubject, usedOn, itemDone, ctxOf, newId,
    buildPlan, missed, needsReplan, planDiff,
    explain, swapEffect, fmtH,
    calibrate,
    courseFit, expectedCourseGrade, searchCourses,
  };
});
