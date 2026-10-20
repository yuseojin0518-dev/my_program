/* 처음 화면, 30초 시작 마법사, 대시보드(홈) */
(function () {
  "use strict";
  const A = window.App, PE = window.PE, PD = window.PD, UI = window.UI;
  const esc = UI.esc;

  // ───────── 과목 이름으로 교과 짐작 (목록에 없는 과목용) ─────────
  function guessArea(name) {
    const rules = [[/국어|문학|독서|화법|언어|작문|매체/, "국어"], [/수학|미적분|확률|기하|대수|통계/, "수학"], [/영어|English/i, "영어"],
      [/물리|화학|생명|지구|과학|역학|전자기|물질|세포|유전|행성/, "과학"], [/정보|인공지능|데이터|소프트웨어|프로그래밍/, "정보"],
      [/일본어|중국어|독일어|프랑스어|스페인어|러시아어|아랍어|베트남어|한문/, "제2외국어"], [/체육|운동|스포츠/, "체육"], [/음악|미술|연극|예술|감상/, "예술"],
      [/사회|역사|한국사|세계사|지리|윤리|정치|법|경제|사상/, "사회"]];
    for (const [re, a] of rules) if (re.test(name)) return a;
    return "교양";
  }
  function infoFor(name) {
    const i = PD.subjectInfo(name);
    if (i) return i;
    const area = guessArea(name);
    const evalType = area === "체육" || area === "예술" || area === "교양" ? "pass" : "rank";
    return { name, area, credits: evalType === "pass" ? 2 : 4, evalType };
  }
  A.infoFor = infoFor;

  // 학기에 따라 고르기 쉬운 과목 묶음
  function presets(grade) {
    const sem2 = new Date().getMonth() >= 7 || new Date().getMonth() <= 1;
    if (grade === 1) return sem2 ? ["공통국어2", "공통수학2", "공통영어2", "한국사2", "통합사회2", "통합과학2", "정보", "체육2"] : ["공통국어1", "공통수학1", "공통영어1", "한국사1", "통합사회1", "통합과학1", "정보", "체육1"];
    if (grade === 3) return ["언어와 매체", "화법과 작문", "미적분", "기하", "확률과 통계", "영어 독해와 작문", "물리학Ⅱ", "화학Ⅱ", "생명과학Ⅱ", "지구과학Ⅱ", "사회·문화", "생활과 윤리", "윤리와 사상", "경제", "정보"];
    return ["화법과 언어", "독서와 작문", "문학", "대수", "미적분Ⅰ", "확률과 통계", "영어Ⅰ", "영어Ⅱ", "물리학", "화학", "생명과학", "지구과학", "세계사", "사회와 문화", "윤리와 사상", "정치", "일본어 회화", "중국 문화", "정보"];
  }

  // ───────── 처음 화면 ─────────
  A.views.start = {
    render() {
      const pv = previewData();
      return `<section class="start">
        <div class="start-hero">
          <div class="start-copy">
            <div class="logo-big" aria-hidden="true">${logoSvg(64)}</div>
            <p class="eyebrow">고등학생 학업 내비게이션</p>
            <h1>진로 목표에서<br><span class="grad">오늘 할 공부</span>까지.</h1>
            <p class="lead">희망 학과를 정하면 선택과목을 고르고, 기말에서 몇 점이 필요한지 거꾸로 계산해서, 왜 이 과목에 이만큼인지 숫자로 설명하는 계획을 만들어요. 밀려도 남은 기간에 맞춰 다시 짜요.</p>
            <div class="start-cta">
              <button class="btn primary big" data-act="wizStart">30초 만에 내 계획 만들기</button>
              <button class="btn big tinted" data-act="startDemo">체험 학생으로 둘러보기</button>
            </div>
            ${A.user ? "" : `<button class="link" data-act="account">이미 계정이 있어요 · 로그인</button>`}
          </div>
          ${pv ? `<div class="start-preview" aria-label="체험 학생 미리보기">
            <div class="pv-bar"><span></span><span></span><span></span><b>춘천고 2학년 · AI·컴퓨터공학 목표</b></div>
            <div class="pv-kpis">
              <div class="pv-k blue"><small>기말고사</small><b>${pv.dday}</b></div>
              <div class="pv-k"><small>계획대로 하면</small><b>${pv.avg}<i>등급</i></b></div>
              <div class="pv-k"><small>지난번처럼 하면</small><b>${pv.same}<i>등급</i></b></div>
            </div>
            <p class="pv-h">오늘 할 일</p>
            <ul class="pv-list">${pv.items.map((x) => `<li><span class="pv-dot" style="background:${x.color}"></span><b>${esc(x.name)}</b><span>${esc(x.task)}</span><em>${x.min}</em></li>`).join("")}</ul>
            <p class="pv-h">왜 이렇게?</p>
            <ul class="pv-why">${pv.why.map((x) => `<li><span class="pv-rank" style="background:${x.color}">${x.rank}</span>${esc(x.text)}</li>`).join("")}</ul>
          </div>` : ""}
        </div>
        <ol class="flow-steps" aria-label="Pathway가 하는 일">
          <li><span class="fs-ico" style="--c:#ff9500">🎯</span><b>진로 목표</b><small>희망 학과가 모든 계산의 기준이 돼요. AI공학이면 수학·정보 ×1.4</small></li>
          <li><span class="fs-ico" style="--c:#af52de">🧩</span><b>선택과목 설계</b><small>8억 가지 조합을 가지치기로 0.1초 만에 TOP 5</small></li>
          <li><span class="fs-ico" style="--c:#007aff">📊</span><b>내신 역산</b><small>성적표의 평균·표준편차로 "기말 몇 점"을 계산</small></li>
          <li><span class="fs-ico" style="--c:#34c759">🗓️</span><b>근거 있는 계획</b><small>평균등급을 가장 많이 내리는 과목에 30분씩</small></li>
          <li><span class="fs-ico" style="--c:#ff2d55">🔁</span><b>자동 재조정</b><small>못 한 공부는 남은 날에 다시. 시험 결과로 효율도 보정</small></li>
          <li><span class="fs-ico" style="--c:#30b0c7">🏫</span><b>나이스 연동</b><small>우리 학교 실제 시험 날짜와 우리 반 시간표 과목</small></li>
        </ol>
        <div class="stat-strip" aria-label="숫자로 보는 Pathway">
          <div><b>825,753,600</b><small>3학년 선택과목 조합 수</small></div>
          <div><b>0.1초</b><small>가지치기로 TOP 5 찾는 시간</small></div>
          <div><b>12개</b><small>진로별 권장 과목·교과 비중</small></div>
          <div><b>30분 단위</b><small>평균등급을 가장 많이 내리는 곳에 배정</small></div>
        </div>
        <h2 class="start-h2">이렇게 계산해요</h2>
        <div class="how-grid">
          <article class="how-card"><span class="how-n">1</span><h3>목표를 거꾸로 계산</h3><p>성적표의 <b>과목평균·표준편차</b>로 반 점수 분포를 추정해서 등급 경계 점수를 구하고, 이미 본 시험·수행평가를 빼면 <b>"기말에서 몇 점"</b>이 나와요.</p><code>필요 점수 = (경계 점수 − 받은 점수 합) ÷ 기말 반영 비율</code></article>
          <article class="how-card"><span class="how-n">2</span><h3>공부 시간 → 예상 점수</h3><p>지난 시험 점수와 그때 공부한 시간이 출발점이에요. 범위를 한 번 더 공부할 때마다 <b>모자란 점수의 40%</b>를 채운다고 봐요. 시험 결과가 나오면 과목마다 효율을 고쳐요.</p><code>점수(H) = 100 − (100 − 지난 점수) × 0.6^(추가 시간 ÷ 한 번 공부 시간)</code></article>
          <article class="how-card"><span class="how-n">3</span><h3>가장 효과 큰 곳에 30분씩</h3><p>학점 × 진로 비중으로 무게를 매기고, 30분마다 <b>평균등급을 가장 많이 내리는 과목</b>에 줘요. 시험 날짜 제약을 지키면서 더 바꿀 게 없을 때까지 옮겨 봐요.</p><code>1시간 가치 = 무게 × (지금 예상 등급 − 1시간 뒤 예상 등급)</code></article>
        </div>
        <div class="start-2col">
          <section class="card"><h2>2분 시연 순서</h2><ol class="demo-steps">
            <li><b>체험 학생으로 둘러보기</b><span>어제 계획을 못 지킨 상황 → 들어오자마자 자동 재조정 알림</span></li>
            <li><b>대시보드 "왜 이렇게 나눴나요?"</b><span>과목마다 학점·진로 비중·필요 점수·남은 날짜로 설명</span></li>
            <li><b>성적 → 슬라이더</b><span>기말 점수를 움직이면 종 모양 분포와 등급이 바로 바뀜</span></li>
            <li><b>시나리오 비교</b><span>"국어 1시간을 수학으로 옮기면?" 평균등급 변화를 숫자로</span></li>
            <li><b>진로·과목 → 조합 찾기</b><span>8억 가지 중 가지치기로 TOP 5와 졸업 요건 확인</span></li>
            <li><b>하루 넘기기</b><span>안 하고 하루가 지나면 남은 기간에 다시 나눔</span></li>
          </ol></section>
          <section class="card"><h2>자주 묻는 질문</h2>
            <details class="faq"><summary>등급 예측은 얼마나 정확한가요?</summary><p>반 점수가 정규분포라고 가정한 추정이에요. 실제 등급은 석차로 정해져서 동점자·분포 모양에 따라 달라질 수 있어요. 대신 시험 운(±σ)까지 넣어 <b>확률</b>로 보여 줘요.</p></details>
            <details class="faq"><summary>5등급제와 9등급제 모두 되나요?</summary><p>네. 2025년 이후 입학(고교학점제)은 5등급제, 그 전은 9등급제로 계산해요. 설정에서 바꿀 수 있어요. 성취도만 나오는 과목(융합선택)도 따로 다뤄요.</p></details>
            <details class="faq"><summary>계획을 못 지키면 어떻게 되나요?</summary><p>다음에 들어올 때 못 한 시간을 남은 날에 다시 나눠요. 시간이 모자라면 '1시간 가치'가 낮은 과목부터 줄이고, 무엇이 바뀌었는지 보여 줘요. 마음에 안 들면 되돌릴 수 있어요.</p></details>
            <details class="faq"><summary>우리 학교도 되나요?</summary><p>학사일정과 시간표는 전국 어느 고등학교든 나이스에서 불러와요. 3학년 선택과목 편성표는 지금은 예시 학교 데이터예요.</p></details>
            <details class="faq"><summary>내 성적이 다른 사람에게 보이나요?</summary><p>로그인하지 않으면 이 기기에만 저장돼요. 로그인하면 내 계정에만 저장되고, 비밀번호는 해시로 저장해요. 설문·사용 기록은 익명이에요.</p></details>
          </section>
        </div>
        <p class="muted small center">학사일정·시간표는 나이스 교육정보 개방 포털의 공개 자료를 써요. 로그인하지 않으면 데이터는 이 기기에만 저장돼요.</p>
      </section>`;
    },
    after() {},
  };

  // 처음 화면 오른쪽 미리보기: 체험 학생을 실제로 계산한 숫자
  let pvCache = null;
  function previewData() {
    if (pvCache) return pvCache;
    try {
      const today = A.realToday();
      const st = PD.demoState(today);
      const major = PD.MAJORS.find((m) => m.id === "ai");
      st.plan = PE.buildPlan(st, today, major, "replan");
      const subs = PE.activeSubjects(st);
      const done = PE.doneBySubject(st);
      const planH = {}, sameH = {};
      for (const s of subs) {
        planH[s.id] = (done[s.id] || 0) + st.plan.items.filter((i) => i.sid === s.id && i.date >= today).reduce((a, i) => a + i.min, 0);
        sameH[s.id] = Math.max(done[s.id] || 0, (s.lastHours || 0) * 60);
      }
      const color = (sid) => UI.COLORS[subs.findIndex((s) => s.id === sid) % UI.COLORS.length];
      const ex = PE.explain(st, today, major);
      const next = subs.map((s) => PE.nextExam(s)).filter(Boolean).map((e) => e.date).sort()[0];
      pvCache = {
        dday: next ? UI.dday(today, next) : "–",
        avg: UI.fmtG(PE.averageGrade(subs, planH, 5)),
        same: UI.fmtG(PE.averageGrade(subs, sameH, 5)),
        items: st.plan.items.filter((i) => i.date === today).slice(0, 4).map((i) => ({ name: subs.find((s) => s.id === i.sid).name, task: i.task, min: UI.fmtH(i.min), color: color(i.sid) })),
        why: ex.rows.slice(0, 3).map((r) => ({ rank: r.priority, color: color(r.sid), text: `${r.name} ${UI.fmtHShort(r.future)} — ${r.credits}학점${r.careerW > 1 ? ", 진로 ×" + r.careerW : ""}, 예상 ${r.now.expGrade.toFixed(1)}→${r.fin.expGrade.toFixed(1)}등급` })),
      };
    } catch (e) { pvCache = null; }
    return pvCache;
  }

  function logoSvg(s) {
    return `<svg width="${s}" height="${s}" viewBox="0 0 48 48"><rect width="48" height="48" rx="13" fill="var(--accent)"/><path d="M12 34c6-1 8-6 12-12s7-9 12-10" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="12" cy="34" r="4" fill="#fff"/><path d="M33 9l5 3-4 4" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  A.logoSvg = logoSvg;

  A.acts.startDemo = () => A.startDemo();

  // ───────── 30초 시작: 한 화면에 질문 하나 ─────────
  A.acts.wizStart = () => {
    const today = A.realToday();
    const w = { startedAt: Date.now(), school: null, grade: 2, classNo: "", subjects: [], timetable: null, exams: null, events: null, examDate: "" };
    A.flow({
      ctx: w,
      steps: [
        { q: "어떤 진로를<br>꿈꾸나요?", sub: "고른 진로에 중요한 과목에 공부 시간을 더 줘요.", key: "majorId",
          options: PD.MAJORS.map((m) => ({ v: m.id, label: m.name, sub: m.desc, emoji: m.emoji })).concat([{ v: "none", label: "아직 모르겠어요", sub: "나중에 정해도 돼요", emoji: "🤔" }]) },
        { q: "어느 학교에<br>다니나요?", sub: "나이스에서 <b>진짜 시험 날짜</b>와 <b>우리 반 과목</b>을 불러올게요.", skip: "학교 없이 할게요",
          html: (c) => `<input id="wiz-school" class="big-text" data-in="wizSchoolQ" placeholder="학교 이름 (예: 춘천고)" autocomplete="off" value="${esc(c.q || "")}"><div id="wiz-school-res" aria-live="polite">${schoolList(c)}</div>`,
          read: (r, c) => (c.school ? null : "학교를 골라 주세요."), cta: "다음" },
        { q: "몇 학년이에요?", sub: (c) => (c.school ? esc(c.school.name) : ""), key: "grade",
          options: [{ v: 1, label: "1학년", sub: "5등급제 (고교학점제)", emoji: "🌱" }, { v: 2, label: "2학년", sub: "5등급제 (고교학점제)", emoji: "🌿" }, { v: 3, label: "3학년", sub: "9등급제", emoji: "🌳" }] },
        { q: "몇 반이에요?", sub: "우리 반 시간표에서 이번 학기 과목을 찾아 드려요.", skip: "건너뛰기",
          html: (c) => A.bigInput("wiz-class", c.classNo, "반", 'min="1" max="30" inputmode="numeric" placeholder="4"'),
          read: (r, c) => { const v = A.$("#wiz-class").value; if (!/^\d{1,2}$/.test(v)) return "반 번호를 넣어 주세요."; c.classNo = v; loadTimetable(c); return null; },
          onSkip: (c) => { c.classNo = ""; } },
        { q: "이번 학기에 시험 보는<br>과목을 골라 주세요", sub: (c) => (c.timetable && c.timetable.length ? "🏫 우리 반 시간표에서 찾은 과목을 미리 골라 뒀어요." : c.loadingTT ? "우리 반 시간표를 불러오는 중이에요…" : "누르면 골라져요."),
          html: (c) => subjectPicker(c), read: (r, c) => (c.subjects.length ? null : "과목을 하나 이상 골라 주세요."), cta: (c) => (c.subjects.length ? `${c.subjects.length}과목으로 할게요` : "과목을 골라 주세요") },
        { q: "다음 시험은<br>언제 시작해요?", sub: (c) => ((c.exams || []).some((e) => e.end >= today) ? "나이스 학사일정에서 찾았어요." : "시험 첫날을 골라 주세요. 과목별 날짜는 나중에 바꿀 수 있어요."),
          html: (c) => {
            const ex = (c.exams || []).filter((e) => e.start > today);
            return `${ex.length ? `<ul class="fl-opts">${ex.map((e) => `<li><button class="fl-opt ${c.examDate === e.start ? "on" : ""}" data-act="wizExam" data-v="${e.start}"><span class="fl-emoji">✏️</span><span class="fl-txt"><b>${esc(e.name)}</b><small>${UI.fmtDate(e.start)} ~ ${UI.fmtDate(e.end)} · ${UI.dday(today, e.start)}</small></span></button></li>`).join("")}</ul><p class="fl-or">또는 직접 고르기</p>` : ""}
              <input type="date" id="wiz-date" class="big-text" value="${esc(c.examDate)}" min="${PE.addDays(today, 1)}">`;
          },
          read: (r, c) => { c.examDate = A.$("#wiz-date").value; return PE.isValidYmd(c.examDate) && c.examDate > today ? null : "오늘 다음 날짜를 골라 주세요."; } },
        { q: "평일에는 하루<br>몇 시간 공부할 수 있나요?", sub: "학원·숙제 시간을 빼고 생각해 주세요.", key: "weekday",
          options: [60, 90, 120, 180, 240].map((v) => ({ v, label: UI.fmtH(v) })) },
        { q: "주말에는<br>몇 시간 할 수 있나요?", sub: "공휴일·휴업일도 이 시간으로 계산해요.", key: "weekend",
          options: [120, 180, 240, 300, 360, 480].map((v) => ({ v, label: UI.fmtH(v) })) },
      ],
      finish: (c) => finishWizard(c),
      afterDone: () => A.go("home"),
    });
  };

  function schoolList(w) {
    if (w.searching) return `<p class="fl-sub">찾는 중…</p>`;
    if (w.schoolErr) return `<p class="warn">${esc(w.schoolErr)}</p>`;
    if (!w.schools || !w.schools.length) return w.q && w.q.length >= 2 ? `<p class="fl-sub">찾은 학교가 없어요.</p>` : "";
    return `<ul class="fl-opts">${w.schools.map((s, i) => `<li><button class="fl-opt ${w.school && w.school.code === s.code ? "on" : ""}" data-act="wizPickSchool" data-i="${i}"><span class="fl-emoji">🏫</span><span class="fl-txt"><b>${esc(s.name)}</b><small>${esc(s.region)} · ${esc(s.address)}</small></span><span class="fl-chev">›</span></button></li>`).join("")}</ul>`;
  }
  let schoolTimer = null;
  A.inputs.wizSchoolQ = (el) => {
    const w = A.flowCtx();
    w.q = el.value.trim();
    clearTimeout(schoolTimer);
    const box = () => A.$("#wiz-school-res");
    if (w.q.length < 2) { w.schools = []; if (box()) box().innerHTML = ""; return; }
    schoolTimer = setTimeout(async () => {
      w.searching = true; w.schoolErr = ""; if (box()) box().innerHTML = schoolList(w);
      try { const r = await A.api("/api/neis/schools?q=" + encodeURIComponent(w.q)); w.schools = r.schools; }
      catch (e) { w.schoolErr = e.message; w.schools = []; }
      w.searching = false;
      if (box()) box().innerHTML = schoolList(w);
    }, 300);
  };
  A.acts.wizPickSchool = (el) => {
    const w = A.flowCtx();
    w.school = w.schools[Number(el.dataset.i)];
    el.classList.add("on");
    setTimeout(() => A.acts.flowNext(), 140);
  };
  // 학교·학년이 정해지면 학사일정을 미리 불러 둔다
  function loadSchedule(w) {
    if (!w.school) return;
    const sc = w.school;
    A.api(`/api/neis/schedule?office=${sc.office}&school=${sc.code}&grade=${w.grade}`).then((r) => {
      w.events = r.events; w.exams = r.exams;
      const next = (r.exams || []).find((e) => e.start > A.realToday());
      if (next && !w.examDate) w.examDate = next.start;
    }).catch(() => { w.events = null; w.exams = null; });
  }
  async function loadTimetable(w) {
    if (!w.school || !w.classNo) return;
    const sc = w.school;
    w.loadingTT = true;
    try {
      const r = await A.api(`/api/neis/subjects?office=${sc.office}&school=${sc.code}&grade=${w.grade}&class=${w.classNo}`);
      w.timetable = r.subjects || [];
      if (!w.subjects.length) w.subjects = w.timetable.map((x) => x.name).slice(0, 12);
    } catch (e) { w.timetable = []; }
    w.loadingTT = false;
    if (A.flowStep() === 4 && A.flowCtx() === w) A.flowRepaint();
  }
  // 학년을 고르면 바로 일정 불러오기 (flowPick 다음에 실행)
  const basePick = A.acts.flowPick;
  A.acts.flowPick = (el) => { basePick(el); const w = A.flowCtx(); if (w && w.startedAt && A.flowStep() === 2) setTimeout(() => loadSchedule(w), 0); };

  function subjectPicker(w) {
    const tt = (w.timetable || []).map((x) => x.name);
    const list = Array.from(new Set(tt.concat(presets(w.grade)).concat(w.extra || [])));
    return `<div class="chips big">${list.map((n) => `<button class="chip-btn ${w.subjects.includes(n) ? "on" : ""}" data-act="wizSub" data-name="${esc(n)}" aria-pressed="${w.subjects.includes(n)}">${tt.includes(n) ? "🏫 " : ""}${esc(n)}</button>`).join("")}</div>
      <div class="add-row"><input id="wiz-add-name" maxlength="20" placeholder="목록에 없으면 직접 쓰기" aria-label="과목 직접 추가"><button class="btn small" data-act="wizAddSub">추가</button></div>`;
  }
  A.acts.wizSub = (el) => {
    const w = A.flowCtx(), n = el.dataset.name;
    w.subjects = w.subjects.includes(n) ? w.subjects.filter((x) => x !== n) : w.subjects.concat([n]);
    el.classList.toggle("on"); el.setAttribute("aria-pressed", w.subjects.includes(n));
    const b = A.$("[data-act=flowNext]");
    if (b) b.textContent = w.subjects.length ? `${w.subjects.length}과목으로 할게요` : "과목을 골라 주세요";
  };
  A.acts.wizAddSub = () => {
    const w = A.flowCtx(), inp = A.$("#wiz-add-name"), n = inp.value.trim().slice(0, 20);
    if (!n) return;
    if (!w.subjects.includes(n)) { w.subjects.push(n); (w.extra = w.extra || []).push(n); }
    A.flowRepaint();
  };
  A.acts.wizExam = (el) => {
    A.$("#wiz-date").value = el.dataset.v;
    document.querySelectorAll("[data-act=wizExam]").forEach((b) => b.classList.toggle("on", b === el));
    setTimeout(() => A.acts.flowNext(), 140);
  };

  function finishWizard(w) {
    const today = A.realToday();
    const st = PD.emptyState(today);
    const n = w.grade === 3 ? 9 : 5;
    st.profile = Object.assign(st.profile, { majorId: w.majorId === "none" ? null : w.majorId, school: w.school, grade: w.grade, classNo: Number(w.classNo) || null, gradeSystem: n });
    st.availability = { weekday: w.weekday, weekend: w.weekend, overrides: {} };
    if (w.events) st.calendar = { source: "neis", events: w.events, exams: w.exams, fetchedAt: today };
    const sem = new Date().getMonth() >= 7 || new Date().getMonth() <= 1 ? "2학기" : "1학기";
    st.terms[0].name = w.grade + "학년 " + sem;
    st.terms[0].subjects = w.subjects.map((name) => {
      const info = infoFor(name);
      const pass = info.evalType === "pass";
      return PD.makeSubject({
        name, area: info.area, credits: info.credits, evalType: info.evalType, target: n === 9 ? 3 : 2, prepFrom: today,
        lastScore: 70, lastHours: 8, students: 120, mean: 65, sd: 16,
        components: pass ? [{ name: "수행평가", kind: "perf", weight: 100, expected: 85 }]
          : [{ name: "기말고사", kind: "exam", weight: 60, date: w.examDate }, { name: "수행평가", kind: "perf", weight: 40, expected: 32, max: 40 }],
      });
    });
    A.state = A.migrate(st);
    A.ui.welcome = true;
    A.rebuild("new", { quiet: true });
    const ms = Date.now() - w.startedAt;
    A.metric("onboard_ms", ms);
    A.ui.onboardSec = Math.round(ms / 1000);
    const c = A.calc();
    const total = Object.values(st.plan ? st.plan.alloc : {}).reduce((a, b) => a + b, 0);
    const top = c.ex.rows[0];
    return {
      emoji: "🎉", title: "첫 계획이<br>나왔어요", cta: "계획 보러 가기",
      sub: `${A.ui.onboardSec}초 걸렸어요. 시험까지 ${UI.fmtHShort(total)}을 ${w.subjects.length}과목에 나눴어요.`,
      html: top ? `<div class="cmp-big"><div><small>오늘 할 공부</small><b>${UI.fmtH(c.todayItems.reduce((a, it) => a + it.min, 0))}</b></div><div><small>가장 먼저 챙길 과목</small><b>${esc(top.name)}</b></div></div>` : "",
    };
  }

  // ───────── 대시보드 ─────────
  A.views.home = {
    after() { loadSchoolToday(); },
    render() {
      const st = A.state, today = A.today(), c = A.calc(), m = A.major(), n = A.n();
      const subs = A.subjects();
      const next = c.upcoming[0];
      const items = c.todayItems;
      const plannedToday = items.reduce((a, it) => a + it.min, 0);
      const doneToday = items.reduce((a, it) => a + Math.min(it.min, PE.itemDone(st, it.id)), 0);
      const avail = PE.capacityOf(today, st.availability, st.calendar);
      const wk = weekRate();
      let html = heroHead(c, items, plannedToday, doneToday, next);
      html += `<div class="vg">`;
      if (st.demo) html += demoBar();
      if (A.ui.welcome) html += welcomeCard();
      html += replanBanner();
      html += awaitingCard(c);
      if (!subs.length) {
        html += `<div class="card empty c-12"><h2>과목이 없어요</h2><p>성적 탭에서 과목을 넣으면 계획이 만들어져요.</p><button class="btn primary" data-act="go" data-tab="grades">과목 넣기</button></div></div>`;
        return html;
      }
      // 핵심 숫자 4칸
      html += `<section class="kpis c-12" aria-label="핵심 숫자">
        <div class="kpi kpi-dday">${next ? `<span class="kpi-lab">${esc(examTitle(next))}</span><b class="kpi-big">${UI.dday(today, next.ex.date)}</b><span class="kpi-sub">${UI.fmtDate(next.ex.date)} ${esc(next.s.name)}부터</span>` : `<span class="kpi-lab">다음 시험</span><b class="kpi-big">–</b><span class="kpi-sub">시험 날짜를 넣어 주세요</span>`}</div>
        <div class="kpi"><span class="kpi-lab">계획대로 하면 예상 평균</span><b class="kpi-big">${UI.fmtG(c.avgPlan)}<small>등급</small></b>
          <span class="kpi-sub">오늘 멈추면 ${UI.fmtG(c.avgNow)} · 지난번처럼 ${UI.fmtG(c.avgSame)}</span></div>
        <div class="kpi kpi-ring">${UI.ring(plannedToday ? doneToday / plannedToday : 0, 72, plannedToday ? UI.pct(doneToday / plannedToday) : "쉼", "오늘")}<div><span class="kpi-lab">오늘 공부</span><b class="kpi-mid">${UI.fmtH(doneToday)}</b><span class="kpi-sub">${plannedToday ? "계획 " + UI.fmtH(plannedToday) : "오늘 계획 없음"}</span></div></div>
        <div class="kpi kpi-ring">${UI.ring(wk.rate, 72, UI.pct(wk.rate), "이번 주")}<div><span class="kpi-lab">이번 주 달성</span><b class="kpi-mid">${UI.fmtH(wk.done)}</b><span class="kpi-sub">연속 ${wk.streak}일 공부 🔥</span></div></div>
      </section>`;
      // 오늘 할 일 + 왜?
      html += `<section class="card c-7" id="today-card"><div class="card-h"><h2>오늘 할 공부</h2>
        <button class="btn small" data-act="extraLog">+ 기록하기</button></div>
        <p class="card-sub">${items.length}개 · 오늘 공부할 수 있는 시간 ${UI.fmtH(avail)}</p>
        ${items.length ? `<ul class="todo">${items.map((it) => todoItem(it)).join("")}</ul>` : `<div class="empty-mini"><span aria-hidden="true">☕️</span><p>${st.plan ? "오늘은 계획이 없어요. 쉬거나 밀린 과목을 해도 좋아요." : "아직 계획이 없어요."}</p></div>`}
        ${st.plan ? "" : `<button class="btn primary" data-act="replanNow">계획 만들기</button>`}
        ${timerBox(items)}
        ${tomorrowBox()}
      </section>`;
      if (c.ex.rows.length) {
        html += `<section class="card why c-5"><div class="card-h"><h2>왜 이렇게 나눴을까요?</h2><button class="link" data-act="go" data-tab="plan">전체 보기 ›</button></div>
          <ol class="why-list">${c.ex.rows.slice(0, 3).map((r) => `<li><span class="why-rank" style="--sc:${UI.colorOf(st, r.sid)}">${r.priority}</span><div><b>${esc(r.name)} · ${UI.fmtHShort(r.future)}</b><p>${esc(whyLine(r, n))}</p></div></li>`).join("")}</ol>
        </section>`;
      } else html += `<section class="card c-5"><h2>왜 이렇게 나눴나요?</h2><p class="muted">계획이 생기면 과목마다 근거가 여기에 나와요.</p></section>`;
      // 오늘의 코치 (규칙으로 만든 조언)
      html += coachCard(c);
      // 연결 흐름
      html += flowCard(c, m);
      // 이번 주 + 목표까지 남은 점수
      html += weekMini(c);
      html += targetsCard(c);
      // 학생에게 필요한 것: 오답 복습, 오늘 학교(시간표·급식)
      html += notesCard();
      html += schoolCard();
      // 과목별 진행, 공부 잔디, 다가오는 일정
      html += subjectProgress(c);
      html += heatCard();
      html += upcomingCard();
      html += `</div>`;
      return html;
    },
  };

  // ───── 집중 타이머: 할 일을 고르고 시작 → 멈추면 그만큼 기록 ─────
  const LS_TIMER = "pw.timer";
  function timerState() { try { return JSON.parse(localStorage.getItem(LS_TIMER) || "null"); } catch (e) { return null; } }
  function timerElapsed(t) { return t ? t.acc + (t.running ? (Date.now() - t.start) / 1000 : 0) : 0; }
  function fmtClock(sec) { sec = Math.floor(sec); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); }
  function timerBox(items) {
    if (!items.length) return "";
    const t = timerState();
    const cur = t && items.find((it) => it.id === t.itemId);
    const sel = cur || items.find((it) => PE.itemDone(A.state, it.id) < it.min) || items[0];
    const s = A.subject(sel.sid);
    const goal = sel.min * 60;
    const el = cur ? timerElapsed(t) : 0;
    return `<div class="timer" style="--sc:${UI.colorOf(A.state, sel.sid)}">
      <div class="timer-l"><span class="kpi-lab">⏱ 집중 타이머</span>
        <label class="sr-only" for="tm-sel">할 일</label>
        <select id="tm-sel" data-ch="tmSel" ${cur && t.running ? "disabled" : ""}>${items.map((it) => `<option value="${it.id}" ${it.id === sel.id ? "selected" : ""}>${esc(A.subject(it.sid).name)} · ${esc(it.task)}</option>`).join("")}</select></div>
      <div class="timer-c"><b id="tm-clock">${fmtClock(el)}</b><small class="muted">목표 ${UI.fmtH(sel.min)}</small>
        <span class="bar wide"><span id="tm-bar" style="width:${Math.min(100, el / goal * 100).toFixed(1)}%;background:var(--sc)"></span></span></div>
      <div class="timer-r">${cur && t.running ? `<button class="btn small" data-act="tmPause">일시정지</button>` : `<button class="btn small primary" data-act="tmStart" data-id="${sel.id}">${cur && el > 0 ? "이어서" : "시작"}</button>`}
        ${cur && el >= 60 ? `<button class="btn small tinted" data-act="tmStop">끝내고 기록</button>` : ""}</div>
      <p class="muted small timer-tip">${esc(s.name)}: ${esc(sel.task)} — 25분 집중 + 5분 쉬기를 추천해요</p></div>`;
  }
  A.changes.tmSel = () => A.rerender();
  A.acts.tmStart = (el) => {
    const id = A.$("#tm-sel") ? A.$("#tm-sel").value : el.dataset.id;
    let t = timerState();
    if (!t || t.itemId !== id) t = { itemId: id, acc: 0 };
    t.running = true; t.start = Date.now();
    localStorage.setItem(LS_TIMER, JSON.stringify(t)); A.rerender();
  };
  A.acts.tmPause = () => { const t = timerState(); if (!t) return; t.acc = timerElapsed(t); t.running = false; localStorage.setItem(LS_TIMER, JSON.stringify(t)); A.rerender(); };
  A.acts.tmStop = () => {
    const t = timerState(); if (!t) return;
    const min = Math.round(timerElapsed(t) / 60);
    localStorage.removeItem(LS_TIMER);
    const it = (A.state.plan.items || []).find((x) => x.id === t.itemId);
    if (it && min > 0) { A.logItem(it.id, PE.itemDone(A.state, it.id) + min); A.toast("⏱ " + A.subject(it.sid).name + " " + UI.fmtH(min) + " 기록했어요."); }
    A.rerender();
  };
  setInterval(() => {
    const t = timerState(), c = document.getElementById("tm-clock");
    if (!t || !t.running || !c) return;
    const e = timerElapsed(t);
    c.textContent = fmtClock(e);
    const it = A.state && A.state.plan && A.state.plan.items.find((x) => x.id === t.itemId);
    const b = document.getElementById("tm-bar");
    if (b && it) b.style.width = Math.min(100, e / (it.min * 60) * 100).toFixed(1) + "%";
  }, 1000);

  function tomorrowBox() {
    const st = A.state, d = PE.addDays(A.today(), 1);
    const its = ((st.plan && st.plan.items) || []).filter((it) => it.date === d && A.subject(it.sid));
    if (!its.length) return "";
    return `<div class="tmr"><span class="kpi-lab">내일 ${UI.fmtDate(d)} 미리보기 · ${UI.fmtH(its.reduce((a, it) => a + it.min, 0))}</span>
      <div class="tmr-chips">${its.map((it) => `<span class="tmr-c" style="--sc:${UI.colorOf(st, it.sid)}"><b>${esc(A.subject(it.sid).name)}</b> ${UI.fmtH(it.min)}</span>`).join("")}</div></div>`;
  }

  // ───── 오늘의 코치: 숫자를 보고 할 말 3가지 ─────
  function coachCard(c) {
    const st = A.state, n = A.n(), today = A.today();
    const tips = [];
    const rows = c.ex.rows;
    if (rows.length) {
      const best = rows.slice().sort((a, b) => b.marginal - a.marginal)[0];
      tips.push({ ico: "⚡️", t: `지금 1시간의 가치가 가장 큰 과목은 <b>${esc(best.name)}</b>이에요`, s: `1시간 더 하면 이 과목 예상 등급이 ${best.marginalGrade.toFixed(3)} 내려가요` });
      const near = rows.filter((r) => r.req.status === "possible").map((r) => ({ r, gap: r.fin.pTarget })).filter((x) => x.gap > 0.35 && x.gap < 0.75).sort((a, b) => a.gap - b.gap)[0];
      if (near) tips.push({ ico: "🎯", t: `<b>${esc(near.r.name)}</b> 목표 ${near.r.req.target}등급이 아슬아슬해요 (${UI.pct(near.gap)})`, s: `${near.r.req.next ? esc(near.r.req.next.name) : "다음 시험"}에서 ${Math.ceil(near.r.req.needScore)}점 이상이 필요해요` });
      const imp = rows.find((r) => r.req.status === "impossible");
      if (imp) tips.push({ ico: "🧭", t: `<b>${esc(imp.name)}</b> 목표는 한 등급 낮춰 잡는 게 현실적이에요`, s: "만점이어도 모자라요. 성적 탭에서 목표를 바꾸면 시간이 다른 과목으로 가요" });
      const safe = rows.filter((r) => r.fin.pTarget > 0.97);
      if (safe.length) tips.push({ ico: "✅", t: `${safe.slice(0, 2).map((r) => "<b>" + esc(r.name) + "</b>").join(", ")}${safe.length > 2 ? " 외" : ""}은 목표 안정권`, s: "시간을 덜 주고, 대신 경계에 걸린 과목에 몰아줬어요" });
    }
    if (c.missed.min > 0) tips.push({ ico: "🔁", t: `밀린 공부 ${UI.fmtH(c.missed.min)}는 걱정 마세요`, s: "남은 날에 이미 다시 나눴어요. 오늘 계획만 지키면 돼요" });
    const sameGap = c.avgSame !== null && c.avgPlan !== null ? c.avgSame - c.avgPlan : 0;
    if (sameGap > 0.05) tips.push({ ico: "📈", t: `계획대로 하면 지난번보다 평균 <b>${sameGap.toFixed(2)}등급</b> 좋아져요`, s: `지난번처럼 하면 ${UI.fmtG(c.avgSame)}, 계획대로 하면 ${UI.fmtG(c.avgPlan)}` });
    if (!tips.length) return "";
    void st; void n; void today;
    return `<section class="card coach c-12"><div class="card-h"><h2>오늘 알아 두면 좋은 것</h2></div>
      <div class="coach-grid">${tips.slice(0, 4).map((x) => `<div class="coach-it"><span class="coach-ico" aria-hidden="true">${x.ico}</span><div><p>${x.t}</p><small>${x.s}</small></div></div>`).join("")}</div></section>`;
  }

  // 과목별: 시험까지 계획 대비 얼마나 했나
  function subjectProgress(c) {
    const st = A.state;
    const rows = c.ex.rows.slice().sort((a, b) => b.total - a.total);
    if (!rows.length) return "";
    return `<section class="card c-12"><div class="card-h"><h2>과목별 진행</h2><span class="muted small">이번 시험 준비 · 한 시간 / 계획 전체</span></div>
      <div class="sp-grid">${rows.map((r) => {
        const p = r.total ? r.done / r.total : 0;
        return `<div class="sp" style="--sc:${UI.colorOf(st, r.sid)}"><div class="sp-h"><b>${esc(r.name)}</b><span class="gbadge ${UI.gradeTone(r.fin.expGrade, r.fin.cuts.length + 1)}">${r.fin.expGrade.toFixed(2)}</span></div>
          <div class="sp-bar"><span style="width:${(p * 100).toFixed(1)}%"></span></div>
          <div class="sp-f"><span>${UI.fmtHShort(r.done)} / ${UI.fmtHShort(r.total)}</span><span>${UI.pct(p)} · ${UI.dday(A.today(), r.exam)}</span></div></div>`;
      }).join("")}</div></section>`;
  }

  function byDateMinutes() {
    const o = {};
    for (const l of A.state.log) o[l.date] = (o[l.date] || 0) + (Number(l.min) || 0);
    return o;
  }
  A.byDateMinutes = byDateMinutes;
  function heatCard() {
    const by = byDateMinutes(), today = A.today();
    const days = Object.keys(by).filter((d) => d <= today && by[d] > 0);
    const total = days.reduce((a, d) => a + by[d], 0);
    const best = days.sort((a, b) => by[b] - by[a])[0];
    return `<section class="card c-7"><div class="card-h"><h2>공부 잔디</h2><button class="link" data-act="go" data-tab="report">리포트 ›</button></div>
      <div class="heat-wrap">${UI.heatmap(by, today, 12, { aria: "최근 12주 날짜별 공부 시간" })}</div>
      <div class="mini-stats"><div><small>공부한 날</small><b>${days.length}일</b></div><div><small>총 공부</small><b>${UI.fmtHShort(total)}</b></div><div><small>하루 최고</small><b>${best ? UI.fmtHShort(by[best]) : "–"}</b></div><div><small>연속</small><b>${weekRate().streak}일</b></div></div>
      <p class="legend muted small">적음 <span class="hm-l hm1"></span><span class="hm-l hm2"></span><span class="hm-l hm3"></span><span class="hm-l hm4"></span> 많음</p></section>`;
  }

  function upcomingCard() {
    const st = A.state, today = A.today();
    const ev = [];
    for (const e of st.calendar.events || []) if (e.date >= today) ev.push(e);
    const seen = new Set(), list = [];
    for (const e of ev.sort((a, b) => (a.date < b.date ? -1 : 1))) {
      if (seen.has(e.name)) continue;
      seen.add(e.name); list.push(e);
      if (list.length >= 6) break;
    }
    const ico = { exam: "✏️", holiday: "🏖", mock: "📝", event: "📌" };
    return `<section class="card c-5"><div class="card-h"><h2>다가오는 일정</h2><span class="muted small">${st.calendar.source === "neis" ? "나이스 학사일정" : st.calendar.source === "sample" ? "학사일정 (체험)" : "직접 넣은 일정"}</span></div>
      ${list.length ? `<ul class="glist">${list.map((e) => `<li><span class="ev-ico" aria-hidden="true">${ico[e.type] || "📌"}</span><div class="gl-main"><b>${esc(e.name)}</b><small>${UI.fmtDate(e.date)}</small></div><div class="gl-side"><b>${UI.dday(today, e.date)}</b></div></li>`).join("")}</ul>`
        : `<div class="empty-mini"><span aria-hidden="true">📅</span><p>다가오는 일정이 없어요. 계획 탭에서 학교를 정하면 나이스에서 불러와요.</p></div>`}</section>`;
  }

  // 맨 위: 오늘 할 일을 한 문장으로 + 버튼 하나
  function heroHead(c, items, planned, done, next) {
    const today = A.today();
    const left = Math.max(0, planned - done);
    const todo = items.filter((it) => PE.itemDone(A.state, it.id) < it.min);
    let title, sub;
    if (!items.length) { title = A.state.plan ? "오늘은 쉬어도 돼요" : "계획을 먼저 만들어요"; sub = A.state.plan ? "내일 계획은 아래에서 미리 볼 수 있어요." : ""; }
    else if (!left) { title = "오늘 공부를<br>다 했어요 🎉"; sub = `${UI.fmtH(done)} 공부했어요. 이대로면 예상 평균 ${UI.fmtG(c.avgPlan)}등급이에요.`; }
    else {
      title = done ? `${UI.fmtH(left)}만<br>더 하면 돼요` : `오늘은 ${UI.fmtH(left)}<br>공부하면 돼요`;
      sub = todo.map((it) => `${esc(A.subject(it.sid).name)} ${UI.fmtH(it.min - PE.itemDone(A.state, it.id))}`).join(" · ");
    }
    const first = todo[0];
    return `<header class="hero-head">
      <p class="eyebrow">${UI.fmtDate(today)}${next ? ` · ${esc(examTitle(next))} <b class="blue">${UI.dday(today, next.ex.date)}</b>` : ""}</p>
      <h1>${title}</h1>${sub ? `<p class="hero-sub">${sub}</p>` : ""}
      ${first ? `<div class="hero-cta"><button class="btn primary cta" data-act="startFirst" data-id="${first.id}">${esc(A.subject(first.sid).name)}부터 시작하기</button></div>` : ""}
    </header>`;
  }
  A.acts.startFirst = (el) => {
    localStorage.setItem("pw.timer", JSON.stringify({ itemId: el.dataset.id, acc: 0, running: true, start: Date.now() }));
    A.rerender();
    const t = A.$(".timer");
    if (t) { t.scrollIntoView({ behavior: "smooth", block: "center" }); t.classList.add("pulse"); }
    A.toast("⏱ 타이머를 켰어요. 끝나면 '끝내고 기록'을 눌러 주세요.");
  };

  function greeting() {
    const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", hour: "numeric", hour12: false }).format(new Date())) % 24;
    const nm = A.state.profile.name || (A.user && A.user.nickname) || "";
    const hi = h < 6 ? "늦은 밤이에요" : h < 12 ? "좋은 아침이에요" : h < 18 ? "오늘도 한 걸음" : "오늘 하루 마무리";
    return esc(nm ? nm + "님, " + hi : hi);
  }

  function weekRate() {
    const st = A.state, today = A.today();
    const start = PE.addDays(today, -((PE.dow(today) + 6) % 7));
    let planned = 0, done = 0, all = 0;
    for (const it of (st.plan && st.plan.items) || []) {
      if (it.date < start || it.date > today || !A.subject(it.sid)) continue;
      planned += it.min; done += Math.min(it.min, PE.itemDone(st, it.id));
    }
    for (const l of st.log) if (l.date >= start && l.date <= today) all += l.min;
    const days = new Set(st.log.filter((l) => l.min > 0).map((l) => l.date));
    let d = today, k = 0;
    if (!days.has(d)) d = PE.addDays(d, -1);
    while (days.has(d)) { k++; d = PE.addDays(d, -1); }
    return { rate: planned ? done / planned : 0, done: all, streak: k };
  }

  function targetsCard(c) {
    const st = A.state, n = A.n();
    const rows = c.ex.rows.slice().sort((a, b) => (a.exam < b.exam ? -1 : 1));
    if (!rows.length) return "";
    return `<section class="card c-5"><div class="card-h"><h2>목표 등급까지 필요한 점수</h2><button class="link" data-act="go" data-tab="grades">성적 ›</button></div>
      <ul class="glist">${rows.map((r) => {
        const need = r.req.status === "possible" ? `${Math.ceil(r.req.needScore)}점 필요` : r.req.status === "secured" ? "안정권" : r.req.status === "impossible" ? "만점도 부족" : "";
        return `<li><span class="dot" style="background:${UI.colorOf(st, r.sid)}"></span><div class="gl-main"><b>${esc(r.name)}</b><small>${UI.fmtDate(r.exam)} · ${UI.dday(A.today(), r.exam)} · 목표 ${A.subject(r.sid).evalType === "achv" ? "ABCDE"[r.req.target - 1] : r.req.target + "등급"}</small></div>
          <div class="gl-side"><b>${need}</b><small>${UI.pct(r.fin.pTarget)} 확률</small></div></li>`;
      }).join("")}</ul></section>`;
  }

  function examTitle(x) { return (x.ex.name || "시험").replace(/\(.*\)/, ""); }

  function whyLine(r, n) {
    const bits = [];
    bits.push(r.credits + "학점");
    if (r.careerW > 1 && A.state.profile.careerWeight !== false) bits.push("진로 과목 ×" + r.careerW);
    if (r.req.status === "possible") bits.push(`목표 ${r.req.target}등급엔 ${r.req.next ? r.req.next.name : "다음 시험"} ${Math.ceil(r.req.needScore)}점 필요`);
    else if (r.req.status === "secured") bits.push(`목표 ${r.req.target}등급 이미 안정권`);
    else if (r.req.status === "impossible") bits.push(`목표 ${r.req.target}등급은 만점이어도 어려움`);
    bits.push("시험까지 " + r.days + "일");
    return bits.join(" · ") + ` → 예상 ${r.now.expGrade.toFixed(2)}에서 ${r.fin.expGrade.toFixed(2)}등급으로`;
  }
  A.whyLine = whyLine;

  function todoItem(it) {
    const st = A.state, s = A.subject(it.sid);
    const d = PE.itemDone(st, it.id);
    const full = d >= it.min, part = d > 0 && !full;
    return `<li class="todo-it ${full ? "done" : ""}">
      <button class="todo-check" data-act="toggleItem" data-id="${it.id}" aria-pressed="${full}" aria-label="${esc(s.name)} ${UI.fmtH(it.min)} ${full ? "완료 취소" : "완료"}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <span class="todo-bar" style="background:${UI.colorOf(st, it.sid)}"></span>
      <div class="todo-main"><b>${esc(s.name)}</b><span>${esc(it.task || "")}</span></div>
      <button class="todo-min" data-act="partialItem" data-id="${it.id}" aria-label="한 시간 조절">${part ? UI.fmtH(d) + " / " : ""}${UI.fmtH(it.min)}</button>
    </li>`;
  }
  A.todoItem = todoItem;

  A.acts.toggleItem = (el) => { A.toggleItem(el.dataset.id); A.rerender(); };
  // 할 일 시간 고치기: "미적분Ⅰ 얼마나 했나요?"
  A.acts.partialItem = (el) => {
    const st = A.state, it = st.plan.items.find((x) => x.id === el.dataset.id);
    if (!it) return;
    const s = A.subject(it.sid), d = PE.itemDone(st, it.id);
    const list = Array.from(new Set([0, 30, 60, 90, it.min, it.min + 30, 120, 180].filter((v) => v <= Math.max(240, it.min * 2)))).sort((a, b) => a - b);
    A.flow({
      steps: [{
        q: `${esc(s.name)},<br>얼마나 했나요?`, sub: `${esc(it.task)} · 계획 ${UI.fmtH(it.min)}`,
        html: () => `<p class="big-show" id="pm-show">${UI.fmtH(d)}</p>${A.timeChips("pm", d, list)}`,
        read: (r, ctx) => { ctx.min = Number(A.$("#pm").value); return null; }, cta: "기록하기",
      }],
      finish: (ctx) => {
        A.logItem(it.id, ctx.min);
        const full = ctx.min >= it.min;
        return { emoji: full ? "🎉" : "👍", title: full ? `${esc(s.name)} 끝!` : `${UI.fmtH(ctx.min)} 기록했어요`, sub: full ? "오늘 계획 하나를 해냈어요." : `남은 ${UI.fmtH(Math.max(0, it.min - ctx.min))}은 못 하면 다음 날로 다시 나눠 드려요.` };
      },
    });
  };

  // 계획 밖 공부: 과목 → 시간 (두 화면)
  A.acts.extraLog = () => {
    const subs = A.subjects().filter((s) => s.evalType !== "pass");
    A.flow({
      steps: [
        { q: "어떤 과목을<br>공부했나요?", sub: "계획에 없던 공부도 기록하면 예상 점수와 다음 계획에 들어가요.", key: "sid",
          options: subs.map((s) => ({ v: s.id, label: s.name, sub: s.area + " · " + s.credits + "학점", emoji: `<span class="opt-dot" style="background:${UI.colorOf(A.state, s.id)}"></span>` })) },
        { q: (c) => `${esc(A.subject(c.sid).name)},<br>얼마나 했나요?`, sub: "오늘 한 공부로 기록돼요.",
          html: () => `<p class="big-show" id="xl-show">1시간</p>${A.timeChips("xl", 60, [30, 60, 90, 120, 150, 180, 240])}`,
          read: (r, c) => { c.min = Number(A.$("#xl").value); return c.min > 0 ? null : "시간을 골라 주세요."; }, cta: "기록하기" },
      ],
      finish: (c) => {
        A.state.log.push({ id: PE.newId("l"), date: A.today(), sid: c.sid, min: c.min, note: "계획 밖" });
        A.rebuild("edit", { quiet: true });
        return { emoji: "📚", title: `${esc(A.subject(c.sid).name)} ${UI.fmtH(c.min)}<br>기록했어요`, sub: "계획을 다시 맞췄어요. 이 과목에 남은 시간이 그만큼 줄었어요." };
      },
    });
  };

  function demoBar() {
    return `<div class="demo-bar c-12" role="region" aria-label="체험 모드">
      <span>🧪 <b>체험 모드</b> · 춘천고 2학년 · AI공학 목표 · 오늘 ${UI.fmtDate(A.today())}</span>
      <span class="row gap wrap"><button class="btn small" data-act="demoNextDay" title="오늘 계획을 안 하고 하루가 지나가면?">⏩ 하루 넘기기</button>
      <button class="btn small" data-act="demoReset">처음 상태로</button>
      <button class="btn small primary" data-act="demoLeave">내 데이터로 시작</button></span></div>`;
  }
  A.acts.demoLeave = () => { A.state = null; A.ui = { whatIf: {}, open: {}, weekOffset: 0 }; A.render(); A.acts.wizStart(); };

  function welcomeCard() {
    const sec = A.ui.onboardSec;
    return `<section class="card welcome c-12"><button class="icon-btn card-x" data-act="hideWelcome" aria-label="닫기">✕</button>
      <h2>🎉 첫 계획 완성${sec ? ` <small class="muted">(${sec}초)</small>` : ""}</h2>
      <p>지금은 모든 과목을 '지난 시험 70점'으로 가정했어요. <b>중간고사 점수·반 평균</b>을 넣으면 등급 예측과 시간 배분이 훨씬 정확해져요.</p>
      <div class="row gap wrap"><button class="btn primary" data-act="quickScores">중간고사 점수 넣기 (1분)</button><button class="btn" data-act="go" data-tab="plan">계획 먼저 보기</button></div></section>`;
  }
  A.acts.hideWelcome = () => { A.ui.welcome = false; A.rerender(); };

  function replanBanner() {
    const r = A.ui.replanInfo;
    if (!r) return "";
    if (r.pending) return `<section class="banner warn c-12" role="status"><div><b>밀린 공부 ${UI.fmtH(r.missed)}</b><p>남은 기간에 맞춰 다시 짤까요?</p></div><button class="btn primary" data-act="replanNow">다시 짜기</button></section>`;
    const top = (r.diff || []).filter((d) => d.delta > 0).slice(0, 2).map((d) => `${esc(d.name)} +${UI.fmtHShort(d.delta)}`).join(", ");
    return `<section class="banner c-12" role="status"><div><b>🔁 자동 재조정</b><p>못 한 공부 <b>${UI.fmtH(r.missed)}</b>를 남은 기간에 다시 나눴어요${top ? ` (${top})` : ""}. 예상 평균 ${UI.fmtG(r.before)} → ${UI.fmtG(r.after)}등급</p></div>
      <div class="row gap"><button class="btn small" data-act="showDiff">무엇이 바뀌었나</button>${A.ui.undoPlan ? `<button class="btn small" data-act="undoPlan">되돌리기</button>` : ""}<button class="icon-btn" data-act="hideBanner" aria-label="알림 닫기">✕</button></div></section>`;
  }
  A.acts.hideBanner = () => { A.ui.replanInfo = null; A.rerender(); };
  A.acts.replanNow = () => {
    const r = A.rebuild(A.state.plan ? "replan" : "new");
    if (!r) { A.toast("시험 날짜가 있는 과목이 없어요."); return; }
    A.ui.replanInfo = { missed: r.missed, diff: r.diff, before: r.before, after: r.after };
    A.toast("계획을 다시 짰어요.");
    A.rerender();
  };
  A.acts.undoPlan = () => {
    if (!A.ui.undoPlan) return;
    A.state.plan = A.ui.undoPlan; A.ui.undoPlan = null; A.ui.replanInfo = null;
    A.save(); A.toast("이전 계획으로 되돌렸어요."); A.rerender();
  };
  A.acts.showDiff = () => {
    const r = A.ui.replanInfo;
    const rows = (r && r.diff) || [];
    A.modal(`<h2>재조정으로 바뀐 것</h2>
      <p class="muted">오늘부터 시험까지 과목별 남은 계획 시간이에요. 못 한 만큼을 남은 날에 다시 나누고, 시간이 모자라면 '1시간 가치'가 낮은 과목부터 줄였어요.</p>
      ${rows.length ? `<table class="tbl"><thead><tr><th>과목</th><th>전</th><th>후</th><th>차이</th></tr></thead><tbody>${rows.map((d) => `<tr><td>${esc(d.name)}</td><td>${UI.fmtH(d.before)}</td><td>${UI.fmtH(d.after)}</td><td class="${d.delta > 0 ? "up" : "down"}">${d.delta > 0 ? "+" : "−"}${UI.fmtH(Math.abs(d.delta))}</td></tr>`).join("")}</tbody></table>` : `<p>과목별 합은 그대로고 날짜만 옮겼어요.</p>`}
      <p>예상 평균등급: <b>${UI.fmtG(r && r.before)}</b> → <b>${UI.fmtG(r && r.after)}</b></p>`);
  };

  function awaitingCard(c) {
    if (!c.awaiting.length) return "";
    const x = c.awaiting[0];
    const past = x.ex.date < A.today();
    return `<section class="banner info c-12" role="status"><div><b>📝 ${esc(x.s.name)} ${esc(x.ex.name)} ${past ? "봤나요?" : "오늘이에요. 화이팅!"}</b>
      <p>${past ? "점수를 넣으면 예측과 실제를 비교해서 이 과목의 공부 효율을 보정해요." : "시험이 끝나면 점수를 넣어 주세요."}${c.awaiting.length > 1 ? ` (외 ${c.awaiting.length - 1}과목)` : ""}</p></div>
      ${past ? `<button class="btn primary small" data-act="resultInput" data-sid="${x.s.id}">점수 넣기</button>` : ""}</section>`;
  }

  function flowCard(c, m) {
    const st = A.state;
    const picked = st.courses && st.courses.picked;
    const top = c.ex.rows[0];
    return `<section class="card flow c-12" aria-label="데이터 흐름">
      <h2>진로부터 오늘 공부까지<br class="m-br"> 하나로 이어져요</h2>
      <div class="flow-row">
        <button class="flow-node" data-act="go" data-tab="path"><span>🎯 진로</span><b>${m ? esc(m.name) : "정하기"}</b><small>${m ? Object.entries(m.areaWeights).filter(([, v]) => v > 1.1).map(([k, v]) => k + "×" + v).join(" ") : "교과 비중의 기준"}</small></button>
        <span class="flow-arrow" aria-hidden="true">→</span>
        <button class="flow-node" data-act="go" data-tab="path"><span>🧩 선택과목</span><b>${picked ? "추천 " + picked.rank + "위 조합" : "조합 찾기"}</b><small>${picked ? "핵심 과목 " + picked.coreHave + "개 이수" : "3학년 과목 TOP 5"}</small></button>
        <span class="flow-arrow" aria-hidden="true">→</span>
        <button class="flow-node" data-act="go" data-tab="grades"><span>📊 내신</span><b>예상 ${UI.fmtG(c.avgPlan)}등급</b><small>${top ? "1순위 " + esc(top.name) : "과목별 목표 역산"}</small></button>
        <span class="flow-arrow" aria-hidden="true">→</span>
        <button class="flow-node" data-act="go" data-tab="plan"><span>🗓️ 계획</span><b>${st.plan ? UI.fmtHShort(Object.values(st.plan.alloc || {}).reduce((a, b) => a + b, 0)) : "–"}</b><small>시험까지 배분</small></button>
      </div>
      <p class="flow-loop">↺ 공부 기록·시험 결과가 다시 예측과 계획을 고쳐요 (피드백 루프)</p>
    </section>`;
  }

  // ───────── 오답 노트: 1·3·7·14·30일 뒤에 다시 보여 주는 간격 복습 ─────────
  const GAPS = [1, 3, 7, 14, 30];
  function dueNotes() { const t = A.today(); return (A.state.notes || []).filter((x) => !x.done && x.next <= t).sort((a, b) => (a.next < b.next ? -1 : 1)); }
  A.dueNotes = dueNotes;
  function notesCard() {
    const st = A.state, notes = st.notes || [];
    const due = dueNotes();
    const active = notes.filter((x) => !x.done);
    const mastered = notes.filter((x) => x.done).length;
    const nextUp = active.filter((x) => x.next > A.today()).sort((a, b) => (a.next < b.next ? -1 : 1))[0];
    return `<section class="card c-7"><div class="card-h"><h2>오늘 다시 볼 오답</h2><button class="btn small" data-act="noteAdd">+ 오답 추가</button></div>
      <p class="card-sub">${notes.length ? `복습 중 ${active.length}개 · 완전히 익힌 것 ${mastered}개` : "틀린 문제를 적어 두면 1일·3일·7일·14일 뒤에 다시 보여 드려요."}</p>
      ${due.length ? `<ul class="note-list">${due.slice(0, 4).map((x) => {
        const sb = A.subject(x.sid);
        return `<li><span class="dot" style="background:${sb ? UI.colorOf(st, x.sid) : "#c5ccd4"}"></span><div class="nl-main"><b>${esc(x.text)}</b><small>${esc(sb ? sb.name : "과목")}${x.unit ? " · " + esc(x.unit) : ""} · ${x.stage + 1}번째 복습</small></div>
          <div class="nl-act"><button class="btn small tinted" data-act="noteOk" data-id="${x.id}">기억나요</button><button class="btn small" data-act="noteAgain" data-id="${x.id}">또 틀렸어요</button></div></li>`;
      }).join("")}</ul>${due.length > 4 ? `<p class="muted small">외 ${due.length - 4}개</p>` : ""}`
        : `<div class="empty-mini"><span aria-hidden="true">📝</span><p>${notes.length ? `오늘 볼 오답은 없어요.${nextUp ? ` 다음 복습은 ${UI.fmtDate(nextUp.next)}이에요.` : ""}` : "아직 적어 둔 오답이 없어요."}</p></div>`}
      <div class="gap-line" aria-hidden="true">${GAPS.map((g, i) => `<span><i>${i + 1}</i>${g}일 뒤</span>`).join("")}</div>
    </section>`;
  }
  A.acts.noteAdd = () => {
    const subs = A.subjects().filter((s) => s.evalType !== "pass");
    A.flow({
      steps: [
        { q: "어떤 과목에서<br>틀렸나요?", key: "sid", options: subs.map((s) => ({ v: s.id, label: s.name, sub: s.area, emoji: `<span class="opt-dot" style="background:${UI.colorOf(A.state, s.id)}"></span>` })) },
        { q: "무엇을 틀렸나요?", sub: "나중에 봐도 알 수 있게 짧게 적어 주세요.",
          html: (c) => {
            const units = ((A.subject(c.sid) || {}).units || []).map((u) => u.name);
            return `<textarea id="nt-text" class="big-area" maxlength="80" rows="3" placeholder="예: 합성함수 미분에서 속미분 빠뜨림"></textarea>
              ${units.length ? `<p class="fl-or">어느 단원인가요? (골라도 되고 안 골라도 돼요)</p><div class="chips big">${units.map((u) => `<button type="button" class="chip-btn" data-act="ntUnit" data-u="${esc(u)}">${esc(u)}</button>`).join("")}</div>` : ""}`;
          },
          read: (r, c) => { c.text = A.$("#nt-text").value.trim().slice(0, 80); return c.text ? null : "틀린 내용을 적어 주세요."; }, cta: "저장하기" },
      ],
      finish: (c) => {
        const t = A.today();
        A.state.notes.push({ id: PE.newId("n"), sid: c.sid, text: c.text, unit: c.unit || "", created: t, stage: 0, next: PE.addDays(t, 1), done: false, history: [] });
        A.save();
        return { emoji: "📝", title: "내일 다시<br>보여 드릴게요", sub: "기억나면 3일 뒤, 7일 뒤… 점점 간격을 늘려요. 또 틀리면 처음부터 다시요.",
          html: `<div class="cmp-big">${GAPS.map((g) => `<div><small>${UI.fmtDate(PE.addDays(t, g), false)}</small><b>${g}일</b></div>`).join("")}</div>` };
      },
    });
  };
  A.acts.ntUnit = (el) => {
    const c = A.flowCtx();
    c.unit = c.unit === el.dataset.u ? "" : el.dataset.u;
    document.querySelectorAll("[data-act=ntUnit]").forEach((b) => b.classList.toggle("on", b.dataset.u === c.unit));
  };
  function reviewNote(id, ok) {
    const x = (A.state.notes || []).find((n) => n.id === id);
    if (!x) return;
    const t = A.today();
    x.history = (x.history || []).concat([{ at: t, ok }]);
    if (ok) {
      x.stage += 1;
      if (x.stage >= GAPS.length) { x.done = true; A.toast("🏆 완전히 익혔어요! 오답 노트에서 졸업했어요."); }
      else { x.next = PE.addDays(t, GAPS[x.stage]); A.toast(`👍 ${GAPS[x.stage]}일 뒤(${UI.fmtDate(x.next)})에 다시 볼게요.`); }
    } else { x.stage = 0; x.next = PE.addDays(t, 1); A.toast("괜찮아요. 내일 다시 보여 드릴게요."); }
    A.save(); A.rerender();
  }
  A.acts.noteOk = (el) => reviewNote(el.dataset.id, true);
  A.acts.noteAgain = (el) => reviewNote(el.dataset.id, false);

  // ───────── 오늘 학교: 우리 반 시간표 + 급식 (나이스) ─────────
  function schoolCard() {
    const sc = A.state.profile.school;
    return `<section class="card c-5" id="school-card"><div class="card-h"><h2>오늘 학교</h2><span class="muted small">${sc ? esc(sc.name) : ""}</span></div>
      <div id="school-body">${sc ? schoolBody() : `<div class="empty-mini"><span aria-hidden="true">🏫</span><p>학교를 정하면 오늘 시간표와 급식을 보여 드려요.</p><button class="btn small tinted" data-act="neisReload">학교 정하기</button></div>`}</div></section>`;
  }
  function schoolBody() {
    const d = A.ui.school, today = A.today(), st = A.state;
    if (!d || d.date !== today) return `<p class="muted">나이스에서 불러오는 중…</p>`;
    const mine = new Map(A.subjects().map((s) => [s.name, s]));
    const isOff = PE.dayKind(today, st.calendar) !== "weekday";
    let tt;
    if (d.ttErr) tt = `<p class="muted small">${esc(d.ttErr)}</p>`;
    else if (!st.profile.classNo) tt = `<p class="muted small">반을 정하면 시간표가 나와요.</p>`;
    else if (!d.periods || !d.periods.length) tt = `<p class="muted small">${isOff ? "오늘은 수업이 없는 날이에요." : "오늘 시간표가 아직 없어요."}</p>`;
    else tt = `<ol class="tt-list">${d.periods.map((p) => { const s = mine.get(p.name); return `<li class="${s ? "mine" : ""}"><span class="tt-n">${p.period}</span><span class="tt-name">${esc(p.name)}</span>${s ? `<span class="dot" style="background:${UI.colorOf(st, s.id)}"></span>` : ""}</li>`; }).join("")}</ol>
      ${d.partial ? `<p class="muted small">나이스 인증키가 없어서 5교시까지만 보여요.</p>` : ""}
      ${d.periods.some((p) => mine.has(p.name)) ? `<p class="tip">💡 오늘 배운 과목은 저녁에 10분만 다시 보면 오래 기억나요.</p>` : ""}`;
    const meal = (d.meals || []).find((m) => m.date >= today && /중식/.test(m.kind)) || (d.meals || [])[0];
    let ml;
    if (d.mealErr) ml = `<p class="muted small">${esc(d.mealErr)}</p>`;
    else if (!meal) ml = `<p class="muted small">이번 주 급식 정보가 없어요.</p>`;
    else ml = `<p class="meal-h">${meal.date === today ? "오늘 점심" : UI.fmtDate(meal.date) + " 점심"}${meal.cal ? ` <small class="muted">${esc(meal.cal)}</small>` : ""}</p><div class="meal">${meal.dishes.map((x) => `<span>${esc(x)}</span>`).join("")}</div>`;
    return `<h3 class="mini-h">${st.profile.grade}학년 ${st.profile.classNo || "?"}반 시간표</h3>${tt}<h3 class="mini-h">급식</h3>${ml}`;
  }
  async function loadSchoolToday() {
    const st = A.state, sc = st && st.profile.school, today = A.today();
    if (!sc || !A.$("#school-body")) return;
    if (A.ui.school && A.ui.school.date === today) return;
    const d = { date: today };
    const q = `office=${encodeURIComponent(sc.office)}&school=${encodeURIComponent(sc.code)}&date=${today}`;
    const tasks = [A.api(`/api/neis/meal?${q}`).then((r) => (d.meals = r.meals)).catch((e) => (d.mealErr = e.message))];
    if (st.profile.classNo) tasks.push(A.api(`/api/neis/timetable?${q}&grade=${st.profile.grade}&class=${st.profile.classNo}`).then((r) => { d.periods = r.periods; d.partial = r.partial; }).catch((e) => (d.ttErr = e.message)));
    await Promise.all(tasks);
    A.ui.school = d;
    const box = A.$("#school-body");
    if (box) box.innerHTML = schoolBody();
  }

  // 이번 주 공부: 한 문장 요약 + 부드러운 막대
  function weekData(offset) {
    const st = A.state, today = A.today();
    const start = PE.addDays(today, -((PE.dow(today) + 6) % 7) + offset * 7);
    const cols = [];
    let done = 0, plan = 0, planPast = 0;
    for (let i = 0; i < 7; i++) {
      const d = PE.addDays(start, i);
      const p = ((st.plan && st.plan.items) || []).filter((it) => it.date === d && A.subject(it.sid)).reduce((a, it) => a + it.min, 0);
      const dn = st.log.filter((l) => l.date === d).reduce((a, l) => a + l.min, 0);
      cols.push({ label: "월화수목금토일"[i], sub: String(Number(d.slice(8))), plan: p, done: d <= today ? dn : 0, today: d === today, future: d > today });
      if (d <= today) { done += dn; planPast += p; }
      plan += p;
    }
    return { cols, done, plan, planPast, start };
  }
  A.weekData = weekData;
  function weekMini() {
    if (!A.state.plan) return "";
    const w = weekData(0), last = weekData(-1);
    const diff = w.done - last.done;
    const rate = w.planPast ? Math.min(1, w.done / w.planPast) : 0;
    return `<section class="card c-7 week-card"><div class="card-h"><h2>이번 주 공부</h2><button class="link" data-act="go" data-tab="report">리포트 ›</button></div>
      <p class="wk-big">${w.done ? `<b>${UI.fmtH(w.done)}</b> 공부했어요` : "아직 이번 주 기록이 없어요"}</p>
      <p class="wk-small">${last.done ? (diff >= 0 ? `지난주보다 <b class="blue">${UI.fmtH(diff)} 더</b>` : `지난주보다 ${UI.fmtH(-diff)} 덜`) + " · " : ""}오늘까지 계획의 ${UI.pct(rate)} · 남은 계획 ${UI.fmtH(Math.max(0, w.plan - w.planPast))}</p>
      ${UI.weekBars(w.cols, { aria: "이번 주 요일별 공부 시간" })}
      <p class="wb-legend"><span><i class="lg-plan"></i>계획</span><span><i class="lg-done"></i>실제로 한 시간</span></p>
      <div class="mini-stats"><div><small>하루 평균</small><b>${UI.fmtHShort(w.done / Math.max(1, w.cols.filter((c) => !c.future).length))}</b></div>
        <div><small>가장 많이 한 날</small><b>${(() => { const b = w.cols.filter((c) => !c.future).sort((a, b) => b.done - a.done)[0]; return b && b.done ? b.label + "요일" : "–"; })()}</b></div>
        <div><small>공부한 날</small><b>${w.cols.filter((c) => c.done > 0).length}일</b></div>
        <div><small>남은 계획</small><b>${UI.fmtHShort(Math.max(0, w.plan - w.planPast))}</b></div></div></section>`;
  }

  // ───────── 중간고사 점수: 과목마다 한 화면 ─────────
  A.acts.quickScores = () => {
    const subs = A.subjects().filter((s) => s.evalType !== "pass");
    const midDate = ((A.state.calendar.exams || []).filter((e) => e.end < A.today()).slice(-1)[0] || {}).end || "";
    const steps = subs.map((s) => ({
      q: `${esc(s.name)}<br>중간고사 몇 점이었나요?`,
      sub: "성적표의 원점수예요. 반 평균·표준편차도 알면 등급이 더 정확해져요.",
      skip: "모르겠어요",
      html: () => `${A.bigInput("qs-score", s.lastScore !== 70 ? s.lastScore : "", "점", 'min="0" max="100" step="0.1" placeholder="0"')}
        <div class="sub-ins"><label>반 평균<input id="qs-mean" type="number" inputmode="decimal" min="0" max="100" step="0.1" placeholder="${s.mean}"></label>
        <label>표준편차<input id="qs-sd" type="number" inputmode="decimal" min="1" max="40" step="0.1" placeholder="${s.sd}"></label>
        <label>공부한 시간<input id="qs-h" type="number" inputmode="decimal" min="0" max="200" placeholder="${s.lastHours}"></label></div>`,
      read: (r, c) => {
        const v = (id) => { const x = A.$(id).value; return x === "" ? null : Number(x); };
        const sc = v("#qs-score");
        if (sc === null) return "점수를 넣거나 '모르겠어요'를 눌러 주세요.";
        if (!(sc >= 0 && sc <= 100)) return "0~100 사이로 넣어 주세요.";
        c[s.id] = { sc, mean: v("#qs-mean"), sd: v("#qs-sd"), h: v("#qs-h") };
        return null;
      },
    }));
    A.flow({
      steps,
      finish: (c) => {
        let k = 0;
        for (const s of subs) {
          const x = c[s.id];
          if (!x) continue;
          k++;
          if (x.mean !== null) s.mean = PE.clamp(x.mean, 0, 100);
          if (x.sd !== null) s.sd = PE.clamp(x.sd, 1, 40);
          if (x.h !== null) s.lastHours = PE.clamp(x.h, 0, 200);
          s.lastScore = PE.clamp(x.sc, 0, 100);
          let mid = s.components.find((cc) => cc.kind === "exam" && /중간/.test(cc.name));
          if (!mid) { mid = { id: PE.newId("c"), name: "중간고사", kind: "exam", weight: 30, max: 100, score: null, expected: null, date: midDate || PE.addDays(A.today(), -14) }; s.components.unshift(mid); }
          mid.score = s.lastScore;
          const fin = s.components.find((cc) => cc.kind === "exam" && cc !== mid && PE.isValidYmd(cc.date) && cc.score === null);
          if (fin && fin.weight > 40) fin.weight = 40;
          const perf = s.components.find((cc) => cc.kind === "perf");
          if (perf && PE.weightSum(s) !== 100) perf.weight = Math.max(0, perf.weight + 100 - PE.weightSum(s));
        }
        A.ui.welcome = false;
        const before = A.calc().avgPlan;
        A.rebuild("edit", { quiet: true });
        const after = A.calc().avgPlan;
        return { emoji: "📊", title: k ? `${k}과목 점수로<br>계획을 다시 짰어요` : "저장했어요", sub: k ? `예상 평균등급 ${UI.fmtG(before)} → ${UI.fmtG(after)}. 이제 '기말에서 몇 점'이 진짜 내 점수 기준이에요.` : "" };
      },
    });
  };
})();
