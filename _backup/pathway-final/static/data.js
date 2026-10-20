/*
 * Pathway 기본 데이터
 *  - 희망 학과(진로)별 권장 과목과 교과 비중
 *  - 2022 개정 교육과정 과목 목록 (과목 고르기용)
 *  - 졸업 요건 (고교학점제)
 *  - 예시 학교 3학년 선택과목 편성표 (선택과목 설계 시연용)
 *  - 체험용 학생 (춘천고 2학년, AI공학과 목표)
 * 권장 과목은 여러 대학이 발표한 '전공 연계 권장 과목' 자료를 참고해 만든 예시예요.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./engine.js"));
  else root.PD = factory(root.PE);
})(typeof self !== "undefined" ? self : this, function (PE) {
  "use strict";

  const AREAS = ["국어", "수학", "영어", "사회", "과학", "정보", "제2외국어", "체육", "예술", "교양"];

  // ───── 진로(희망 학과) ─────
  const MAJORS = [
    {
      id: "ai", name: "AI·컴퓨터공학", field: "공학", emoji: "🤖",
      desc: "수학(미적분·확률)과 정보 과목이 가장 중요하고, 물리로 공학 기초를 다져요.",
      areaWeights: { 수학: 1.4, 정보: 1.4, 과학: 1.15, 영어: 1.05 },
      core: ["미적분Ⅱ", "기하", "확률과 통계", "인공지능 수학"],
      recommended: ["인공지능 기초", "데이터 과학", "정보", "물리학", "역학과 에너지", "전자기와 양자", "소프트웨어와 생활", "실용 통계", "미적분Ⅰ", "심화 영어"],
    },
    {
      id: "ee", name: "전자·전기공학", field: "공학", emoji: "⚡",
      desc: "물리(전자기)와 미적분이 핵심이에요.",
      areaWeights: { 수학: 1.35, 과학: 1.35, 정보: 1.15 },
      core: ["미적분Ⅱ", "기하", "물리학", "전자기와 양자"],
      recommended: ["역학과 에너지", "확률과 통계", "인공지능 수학", "인공지능 기초", "정보", "미적분Ⅰ"],
    },
    {
      id: "me", name: "기계·항공공학", field: "공학", emoji: "⚙️",
      desc: "역학 중심의 물리와 미적분·기하가 중요해요.",
      areaWeights: { 수학: 1.35, 과학: 1.35, 정보: 1.05 },
      core: ["미적분Ⅱ", "기하", "물리학", "역학과 에너지"],
      recommended: ["전자기와 양자", "확률과 통계", "화학", "물질과 에너지", "미적분Ⅰ"],
    },
    {
      id: "chem", name: "화학·신소재공학", field: "공학", emoji: "🧪",
      desc: "화학과 물리, 미적분을 함께 봐요.",
      areaWeights: { 수학: 1.25, 과학: 1.4 },
      core: ["미적분Ⅱ", "화학", "물질과 에너지", "화학 반응의 세계"],
      recommended: ["물리학", "역학과 에너지", "전자기와 양자", "기하", "확률과 통계"],
    },
    {
      id: "med", name: "의예·약학", field: "의약", emoji: "🩺",
      desc: "생명과학·화학이 핵심이고, 모든 과목 내신이 고르게 중요해요.",
      areaWeights: { 과학: 1.4, 수학: 1.25, 영어: 1.1, 국어: 1.05 },
      core: ["생명과학", "화학", "세포와 물질대사", "생물의 유전", "미적분Ⅱ"],
      recommended: ["물질과 에너지", "화학 반응의 세계", "확률과 통계", "기하", "윤리와 사상", "심화 영어"],
    },
    {
      id: "bio", name: "생명과학·바이오", field: "자연", emoji: "🧬",
      desc: "생명과학 계열과 화학, 통계가 중요해요.",
      areaWeights: { 과학: 1.4, 수학: 1.2, 정보: 1.1 },
      core: ["생명과학", "세포와 물질대사", "생물의 유전", "화학"],
      recommended: ["확률과 통계", "미적분Ⅱ", "데이터 과학", "물질과 에너지", "기후변화와 환경생태"],
    },
    {
      id: "nurse", name: "간호·보건", field: "의약", emoji: "💉",
      desc: "생명과학과 확률과 통계, 윤리 과목을 봐요.",
      areaWeights: { 과학: 1.3, 수학: 1.1, 사회: 1.05 },
      core: ["생명과학", "세포와 물질대사", "확률과 통계"],
      recommended: ["화학", "생물의 유전", "윤리와 사상", "사회와 문화", "보건"],
    },
    {
      id: "biz", name: "경영·경제", field: "인문사회", emoji: "📈",
      desc: "수학(확률과 통계·미적분)과 경제 관련 과목이 중요해요.",
      areaWeights: { 수학: 1.3, 사회: 1.3, 영어: 1.1 },
      core: ["확률과 통계", "경제", "경제 수학", "미적분Ⅰ"],
      recommended: ["미적분Ⅱ", "금융과 경제생활", "사회와 문화", "정치", "데이터 과학", "실용 통계", "심화 영어"],
    },
    {
      id: "kor", name: "국어국문·미디어", field: "인문사회", emoji: "📚",
      desc: "국어 과목 전반과 사회·문화 과목을 봐요.",
      areaWeights: { 국어: 1.45, 사회: 1.2, 영어: 1.1 },
      core: ["문학", "독서와 작문", "주제 탐구 독서", "문학과 영상"],
      recommended: ["화법과 언어", "독서 토론과 글쓰기", "매체 의사소통", "사회와 문화", "세계사", "영미 문학 읽기"],
    },
    {
      id: "law", name: "법·정치외교", field: "인문사회", emoji: "⚖️",
      desc: "사회(정치·법)와 국어, 영어가 중요해요.",
      areaWeights: { 사회: 1.4, 국어: 1.2, 영어: 1.2 },
      core: ["정치", "법과 사회", "국제 관계의 이해"],
      recommended: ["윤리와 사상", "세계사", "사회와 문화", "주제 탐구 독서", "심화 영어", "사회문제 탐구", "인문학과 윤리"],
    },
    {
      id: "edu_math", name: "수학교육", field: "교육", emoji: "📐",
      desc: "수학 과목 전부가 중요하고, 교육·윤리 과목도 도움이 돼요.",
      areaWeights: { 수학: 1.5, 국어: 1.05, 사회: 1.05 },
      core: ["미적분Ⅱ", "기하", "확률과 통계", "수학과제 탐구"],
      recommended: ["인공지능 수학", "경제 수학", "수학과 문화", "실용 통계", "교육의 이해"],
    },
    {
      id: "arch", name: "건축·도시공학", field: "공학", emoji: "🏙️",
      desc: "기하와 물리, 도시·지리 과목을 함께 봐요.",
      areaWeights: { 수학: 1.3, 과학: 1.2, 사회: 1.1, 예술: 1.1 },
      core: ["기하", "미적분Ⅱ", "물리학"],
      recommended: ["역학과 에너지", "도시의 미래 탐구", "한국지리 탐구", "미술 창작", "확률과 통계"],
    },
  ];

  // ───── 과목 목록 (2022 개정 교육과정, 과목 고르기용) ─────
  // evalType: rank = 석차등급(5등급)+성취도, achv = 성취도만(사회·과학 융합선택), pass = 등급 없음(체육·예술·교양)
  const S = (name, area, credits, evalType) => ({ name, area, credits, evalType: evalType || "rank" });
  const SUBJECTS = [
    S("공통국어1", "국어", 4), S("공통국어2", "국어", 4), S("화법과 언어", "국어", 4), S("독서와 작문", "국어", 4), S("문학", "국어", 4),
    S("주제 탐구 독서", "국어", 4), S("문학과 영상", "국어", 4), S("직무 의사소통", "국어", 4), S("독서 토론과 글쓰기", "국어", 4), S("매체 의사소통", "국어", 4),
    S("공통수학1", "수학", 4), S("공통수학2", "수학", 4), S("대수", "수학", 4), S("미적분Ⅰ", "수학", 4), S("확률과 통계", "수학", 4),
    S("미적분Ⅱ", "수학", 4), S("기하", "수학", 4), S("경제 수학", "수학", 4), S("인공지능 수학", "수학", 4), S("직무 수학", "수학", 4),
    S("수학과 문화", "수학", 4), S("실용 통계", "수학", 4), S("수학과제 탐구", "수학", 4),
    S("공통영어1", "영어", 4), S("공통영어2", "영어", 4), S("영어Ⅰ", "영어", 4), S("영어Ⅱ", "영어", 4), S("영어 독해와 작문", "영어", 4),
    S("심화 영어", "영어", 4), S("영미 문학 읽기", "영어", 4), S("영어 발표와 토론", "영어", 4), S("심화 영어 독해와 작문", "영어", 4), S("직무 영어", "영어", 4),
    S("한국사1", "사회", 3), S("한국사2", "사회", 3), S("통합사회1", "사회", 4), S("통합사회2", "사회", 4),
    S("세계시민과 지리", "사회", 4), S("세계사", "사회", 4), S("사회와 문화", "사회", 4), S("현대사회와 윤리", "사회", 4),
    S("한국지리 탐구", "사회", 4), S("도시의 미래 탐구", "사회", 4), S("동아시아 역사 기행", "사회", 4), S("정치", "사회", 4), S("법과 사회", "사회", 4),
    S("경제", "사회", 4), S("윤리와 사상", "사회", 4), S("인문학과 윤리", "사회", 4), S("국제 관계의 이해", "사회", 4),
    S("여행지리", "사회", 4, "achv"), S("역사로 탐구하는 현대 세계", "사회", 4, "achv"), S("사회문제 탐구", "사회", 4, "achv"),
    S("금융과 경제생활", "사회", 4, "achv"), S("윤리문제 탐구", "사회", 4, "achv"), S("기후변화와 지속가능한 세계", "사회", 4, "achv"),
    S("통합과학1", "과학", 4), S("통합과학2", "과학", 4), S("물리학", "과학", 4), S("화학", "과학", 4), S("생명과학", "과학", 4), S("지구과학", "과학", 4),
    S("역학과 에너지", "과학", 4), S("전자기와 양자", "과학", 4), S("물질과 에너지", "과학", 4), S("화학 반응의 세계", "과학", 4),
    S("세포와 물질대사", "과학", 4), S("생물의 유전", "과학", 4), S("지구시스템과학", "과학", 4), S("행성우주과학", "과학", 4),
    S("과학의 역사와 문화", "과학", 4, "achv"), S("기후변화와 환경생태", "과학", 4, "achv"), S("융합과학 탐구", "과학", 4, "achv"),
    S("정보", "정보", 4), S("인공지능 기초", "정보", 4), S("데이터 과학", "정보", 4), S("소프트웨어와 생활", "정보", 4),
    S("일본어", "제2외국어", 3), S("일본어 회화", "제2외국어", 3), S("중국어", "제2외국어", 3), S("중국 문화", "제2외국어", 3),
    S("체육1", "체육", 2, "pass"), S("체육2", "체육", 2, "pass"), S("운동과 건강", "체육", 2, "pass"), S("스포츠 생활1", "체육", 2, "pass"), S("스포츠 생활2", "체육", 2, "pass"),
    S("음악", "예술", 3, "pass"), S("미술", "예술", 3, "pass"), S("음악 감상과 비평", "예술", 4, "pass"), S("미술 창작", "예술", 4, "pass"),
    S("진로와 직업", "교양", 2, "pass"), S("논리와 사고", "교양", 4, "pass"), S("보건", "교양", 4, "pass"), S("교육의 이해", "교양", 4, "pass"),
  ];
  function subjectInfo(name) { return SUBJECTS.find((s) => s.name === name) || null; }

  // ───── 졸업 요건 (2022 개정: 교과 174학점 + 창체 18학점 = 192, 필수 이수 학점) ─────
  const REQ_MAP = { 정보: "생활·교양", 제2외국어: "생활·교양", 교양: "생활·교양", 기술가정: "생활·교양", 한문: "생활·교양" };
  const REQUIREMENTS = { 국어: 8, 수학: 8, 영어: 8, 사회: 16, 과학: 10, 체육: 10, 예술: 10, "생활·교양": 16, total: 174 };

  // ───── 예시 학교 3학년 편성표 ─────
  // 묶음(군)마다 하나씩 골라요. 같은 묶음 과목은 같은 시간이라 둘을 같이 들을 수 없어요.
  const C = (name, students, prereq) => Object.assign({}, subjectInfo(name) || { name, area: "교양", credits: 3, evalType: "pass" }, { students, prereq: prereq || [] });
  const CATALOG = {
    id: "sample-3", name: "예시 학교 3학년 편성표",
    note: "실제 학교 편성표가 아니라 시연용 예시예요. 과목 이름은 2022 개정 교육과정을 따랐어요.",
    semesters: [
      {
        id: "3-1", name: "3학년 1학기",
        fixed: [C("운동과 건강", 240)],
        groups: [
          { id: "A1", name: "A군 (국어)", options: [C("주제 탐구 독서", 90), C("문학과 영상", 70), C("독서와 작문", 60), C("직무 의사소통", 20)] },
          { id: "B1", name: "B군 (수학)", options: [C("미적분Ⅱ", 85, ["미적분Ⅰ"]), C("기하", 45), C("경제 수학", 60), C("수학과제 탐구", 16)] },
          { id: "C1", name: "C군 (영어)", options: [C("심화 영어", 80), C("영미 문학 읽기", 50), C("영어 발표와 토론", 45), C("직무 영어", 30)] },
          { id: "D1", name: "D군 (탐구①)", options: [C("역학과 에너지", 26, ["물리학"]), C("물질과 에너지", 32, ["화학"]), C("세포와 물질대사", 48, ["생명과학"]), C("지구시스템과학", 30, ["지구과학"]), C("정치", 52), C("경제", 36), C("윤리와 사상", 70)] },
          { id: "E1", name: "E군 (탐구②)", options: [C("화학 반응의 세계", 28, ["화학"]), C("생물의 유전", 40, ["생명과학"]), C("한국지리 탐구", 40), C("사회문제 탐구", 44), C("기후변화와 환경생태", 35)] },
          { id: "G1", name: "G군 (정보·융합)", options: [C("인공지능 기초", 36), C("데이터 과학", 22), C("금융과 경제생활", 60), C("실용 통계", 25)] },
          { id: "F1", name: "F군 (예술·교양)", options: [C("음악 감상과 비평", 80), C("미술 창작", 70), C("논리와 사고", 50), C("보건", 40)] },
        ],
      },
      {
        id: "3-2", name: "3학년 2학기",
        fixed: [C("진로와 직업", 240)],
        groups: [
          { id: "A2", name: "A군 (국어)", options: [C("독서 토론과 글쓰기", 60), C("매체 의사소통", 70), C("문학과 영상", 40), C("직무 의사소통", 25)] },
          { id: "B2", name: "B군 (수학)", options: [C("인공지능 수학", 32), C("기하", 40), C("직무 수학", 30), C("수학과 문화", 40)] },
          { id: "C2", name: "C군 (영어)", options: [C("심화 영어 독해와 작문", 70), C("영어 발표와 토론", 40), C("직무 영어", 50)] },
          { id: "D2", name: "D군 (탐구①)", options: [C("전자기와 양자", 12, ["물리학"]), C("화학 반응의 세계", 24, ["화학"]), C("생물의 유전", 44, ["생명과학"]), C("행성우주과학", 20, ["지구과학"]), C("법과 사회", 45), C("국제 관계의 이해", 30)] },
          { id: "E2", name: "E군 (탐구②)", options: [C("인문학과 윤리", 50), C("도시의 미래 탐구", 35), C("융합과학 탐구", 30), C("과학의 역사와 문화", 40), C("윤리문제 탐구", 40)] },
          { id: "G2", name: "G군 (정보·융합)", options: [C("데이터 과학", 24), C("소프트웨어와 생활", 30), C("인공지능 기초", 20), C("기후변화와 지속가능한 세계", 45)] },
          { id: "F2", name: "F군 (예술·교양)", options: [C("미술 창작", 60), C("음악 감상과 비평", 50), C("교육의 이해", 40), C("보건", 40)] },
        ],
      },
    ],
  };

  // ───── 체험용 학생 ─────
  // 1~2학년에 들은 과목 (2학년 2학기는 지금 듣는 중)
  const T = (name, sem) => Object.assign({}, subjectInfo(name), { sem });
  const DEMO_TAKEN = [
    ...["공통국어1", "공통수학1", "공통영어1", "한국사1", "통합사회1", "통합과학1", "체육1", "음악"].map((n) => T(n, "1-1")),
    ...["공통국어2", "공통수학2", "공통영어2", "한국사2", "통합사회2", "통합과학2", "체육2", "미술"].map((n) => T(n, "1-2")),
    { name: "과학탐구실험1", area: "과학", credits: 1, evalType: "pass", sem: "1-1" },
    { name: "과학탐구실험2", area: "과학", credits: 1, evalType: "pass", sem: "1-2" },
    { name: "기술·가정", area: "기술가정", credits: 2, evalType: "rank", sem: "1-2" },
    ...["문학", "대수", "영어Ⅰ", "물리학", "화학", "정보", "운동과 건강", "일본어"].map((n) => T(n, "2-1")),
  ];
  // 운동과 건강은 3학년 지정 과목과 이름이 같으니 2학년엔 '스포츠 생활1'로 둔다
  DEMO_TAKEN.forEach((t, i) => { if (t.name === "운동과 건강" && t.sem === "2-1") DEMO_TAKEN[i] = T("스포츠 생활1", "2-1"); });

  const REAL_TODAY = "2026-10-14"; // 이 체험 데이터를 만든 날 (나이스 실제 학사일정 기준)
  const DEMO_CAL = [
    ["2026-09-29", "2학기 1회 고사(중간고사)", "exam"], ["2026-09-30", "2학기 1회 고사(중간고사)", "exam"], ["2026-10-01", "2학기 1회 고사(중간고사)", "exam"], ["2026-10-02", "2학기 1회 고사(중간고사)", "exam"],
    ["2026-10-03", "개천절", "holiday"], ["2026-10-05", "대체공휴일", "holiday"], ["2026-10-09", "한글날", "holiday"],
    ["2026-10-20", "전국연합학력평가(전학년)", "mock"],
    ["2026-11-19", "대학수학능력시험(1,2학년휴업일)", "holiday"],
    ["2026-12-07", "2학기 2회고사(1,2학년)", "exam"], ["2026-12-08", "2학기 2회고사(1,2학년)", "exam"],
    ["2026-12-09", "2학기 2회고사(1,2학년)", "exam"], ["2026-12-10", "2학기 2회고사(1,2학년)", "exam"],
    ["2026-12-11", "2학기 2회고사(1,2학년)", "exam"], ["2026-12-25", "성탄절", "holiday"], ["2026-12-30", "겨울방학", "holiday"],
  ];

  // 과목 만들기 도우미
  let seq = 0;
  function sid() { seq += 1; return "s" + Date.now().toString(36) + seq; }
  function cid() { seq += 1; return "c" + Date.now().toString(36) + seq; }

  function makeSubject(o) {
    const info = subjectInfo(o.name) || {};
    return {
      id: o.id || sid(),
      name: o.name,
      area: o.area || info.area || "기타",
      credits: o.credits || info.credits || 4,
      evalType: o.evalType || info.evalType || "rank",
      students: o.students || 120,
      mean: o.mean !== undefined ? o.mean : 65,
      sd: o.sd !== undefined ? o.sd : 16,
      target: o.target || 2,
      lastScore: o.lastScore !== undefined ? o.lastScore : 70,
      lastHours: o.lastHours !== undefined ? o.lastHours : 8,
      passHours: o.passHours || null,
      difficulty: o.difficulty || 3,
      eff: 1,
      prepFrom: o.prepFrom || null,
      units: (o.units || []).map((u) => (typeof u === "string" ? { name: u, size: 1 } : u)),
      components: (o.components || []).map((c) => Object.assign({ id: cid(), kind: "exam", max: 100, score: null, expected: null, date: null }, c)),
    };
  }

  // 체험 학생 데이터: 오늘 날짜에 맞춰 만든다 (오늘이 너무 멀면 날짜를 통째로 옮긴다)
  function demoState(today) {
    let shift = PE.daysBetween(REAL_TODAY, today);
    if (shift >= -10 && shift <= 40) shift = 0; // 실제 학사일정 그대로 쓸 수 있는 기간
    const D = (s) => (s ? PE.addDays(s, shift) : s);
    const prep = D("2026-10-03");
    const subjects = [
      makeSubject({
        name: "미적분Ⅰ", students: 128, mean: 58, sd: 19, target: 1, lastScore: 74, lastHours: 16, prepFrom: prep, difficulty: 4, passHours: 12,
        units: [{ name: "함수의 극한", size: 1 }, { name: "함수의 연속", size: 1 }, { name: "미분계수와 도함수", size: 2 }, { name: "도함수의 활용", size: 2 }],
        components: [
          { name: "중간고사", weight: 35, score: 74, date: D("2026-09-30") },
          { name: "기말고사", weight: 35, date: D("2026-12-08") },
          { name: "수행: 탐구 보고서", kind: "perf", weight: 15, score: 13, max: 15 },
          { name: "수행: 서술형 평가", kind: "perf", weight: 15, expected: 12, max: 15 },
        ],
      }),
      makeSubject({
        name: "확률과 통계", students: 128, mean: 63, sd: 17, target: 1, lastScore: 86, lastHours: 12, prepFrom: prep, difficulty: 3, passHours: 9,
        units: ["순열과 조합", "이항정리", "확률의 뜻과 활용", "조건부확률"],
        components: [
          { name: "중간고사", weight: 35, score: 86, date: D("2026-10-01") },
          { name: "기말고사", weight: 35, date: D("2026-12-07") },
          { name: "수행: 통계 프로젝트", kind: "perf", weight: 30, expected: 26, max: 30 },
        ],
      }),
      makeSubject({
        name: "화법과 언어", students: 128, mean: 66, sd: 15, target: 2, lastScore: 72, lastHours: 8, prepFrom: prep, difficulty: 3, passHours: 9,
        units: ["음운의 변동", "문법 요소", "담화와 화법", "토론과 협상"],
        components: [
          { name: "중간고사", weight: 30, score: 72, date: D("2026-10-01") },
          { name: "기말고사", weight: 40, date: D("2026-12-07") },
          { name: "수행: 발표", kind: "perf", weight: 30, score: 26, max: 30 },
        ],
      }),
      makeSubject({
        name: "영어Ⅱ", students: 128, mean: 64, sd: 18, target: 2, lastScore: 88, lastHours: 10, prepFrom: prep, difficulty: 2, passHours: 8,
        units: ["Lesson 5", "Lesson 6", "Lesson 7", "외부 지문"],
        components: [
          { name: "중간고사", weight: 30, score: 88, date: D("2026-10-02") },
          { name: "기말고사", weight: 40, date: D("2026-12-09") },
          { name: "수행: 영어 에세이", kind: "perf", weight: 30, expected: 27, max: 30 },
        ],
      }),
      makeSubject({
        name: "생명과학", students: 96, mean: 61, sd: 16, target: 2, lastScore: 68, lastHours: 9, prepFrom: prep, difficulty: 4, passHours: 11,
        units: ["항상성과 몸의 기능", "방어 작용", "유전", "생태계"],
        components: [
          { name: "중간고사", weight: 30, score: 68, date: D("2026-09-29") },
          { name: "기말고사", weight: 40, date: D("2026-12-10") },
          { name: "수행: 실험 보고서", kind: "perf", weight: 30, expected: 24, max: 30 },
        ],
      }),
      makeSubject({
        name: "일본어 회화", students: 64, mean: 70, sd: 14, target: 2, lastScore: 78, lastHours: 4, prepFrom: prep, difficulty: 2, passHours: 5,
        units: ["6과", "7과", "8과"],
        components: [
          { name: "기말고사", weight: 60, date: D("2026-12-08") },
          { name: "수행: 말하기", kind: "perf", weight: 40, score: 34, max: 40 },
        ],
      }),
      makeSubject({ name: "스포츠 생활2", evalType: "pass", components: [{ name: "실기", kind: "perf", weight: 100, expected: 90 }] }),
    ];
    subjects.forEach((s) => (s.area = s.area || "기타"));
    const termId = "t-demo";
    const st = {
      v: 1,
      demo: true,
      profile: {
        name: "체험 학생", school: { office: "K10", code: "7801185", name: "춘천고등학교" }, grade: 2, classNo: 1,
        gradeSystem: 5, majorId: "ai", careerWeight: true, objective: "avg", autoReplan: true,
      },
      terms: [{ id: termId, name: "2학년 2학기", subjects }],
      activeTermId: termId,
      availability: { weekday: 180, weekend: 300, overrides: {} },
      calendar: { source: "sample", events: DEMO_CAL.map(([d, n, t]) => ({ date: D(d), name: n, type: t })) },
      taken: DEMO_TAKEN.map((t) => Object.assign({}, t)),
      courses: { alpha: 0.7, must: [], ban: [], picked: null },
      log: [],
      results: [],
      planHistory: [],
      createdAt: today,
    };
    // 사흘 전에 짠 계획을 이틀은 잘 지키고 어제는 못 한 상황 → 들어오면 '자동 재조정'을 볼 수 있다
    const d3 = PE.addDays(today, -3), d2 = PE.addDays(today, -2), d1 = PE.addDays(today, -1);
    // 중간고사 준비 (시험 3주 전부터, 시험이 가까울수록 많이) — 다음 시험 준비 시간에는 안 들어간다
    const midStart = D("2026-09-07"), midEnd = D("2026-09-28");
    let q = 0;
    for (let d = midStart; d <= midEnd; d = PE.addDays(d, 1), q++) {
      const near = PE.daysBetween(d, midEnd);
      const base = near < 7 ? 3 : near < 14 ? 2 : 1;
      if (q % 6 === 5 && near >= 7) continue; // 쉬는 날
      for (let j = 0; j < base + (PE.dow(d) % 6 === 0 ? 1 : 0); j++) st.log.push({ id: "lm" + q + "_" + j, date: d, sid: subjects[(q + j * 2) % 6].id, min: 30 + ((q * 7 + j * 3) % 4) * 30, note: "중간고사 준비" });
    }
    // 계획 전(중간고사 뒤 ~ 사흘 전)에 한 공부: 날마다 조금씩, 들쭉날쭉하게 (같은 날짜면 늘 같은 값)
    const pattern = [[0, 60], [4, 30], [2, 30], [0, 30, 5, 30], [1, 60], [], [0, 90, 4, 60], [3, 60], [0, 30, 2, 30], [4, 60], [], [0, 60, 3, 30], [5, 30, 1, 30], [0, 60, 4, 30]];
    let k = 0;
    for (let d = PE.addDays(prep, 1); d < d3; d = PE.addDays(d, 1), k++) {
      const pr = pattern[k % pattern.length];
      for (let j = 0; j < pr.length; j += 2) st.log.push({ id: "lp" + k + "_" + j, date: d, sid: subjects[pr[j]].id, min: pr[j + 1], note: "계획 전 공부" });
    }
    const major = MAJORS.find((m) => m.id === "ai");
    st.plan = PE.buildPlan(st, d3, major, "new");
    // 사흘 전: 다 함 / 그저께: 거의 다 / 어제: 하나만 하고 나머지는 못 함 → 들어오면 자동 재조정
    const d1Items = st.plan.items.filter((it) => it.date === d1);
    for (const it of st.plan.items) {
      if (it.date === d3) st.log.push({ id: "l" + it.id, date: d3, sid: it.sid, min: it.min, itemId: it.id });
      if (it.date === d2) st.log.push({ id: "l" + it.id, date: d2, sid: it.sid, min: Math.max(30, it.min - 30), itemId: it.id });
      if (it.date === d1 && it === d1Items[0]) st.log.push({ id: "l" + it.id, date: d1, sid: it.sid, min: Math.min(it.min, 60), itemId: it.id });
    }
    // 중간고사 결과 기록 (예측과 실제 비교 → 효율 보정)
    const res = [[0, "중간고사", 16, 71.2, 74, 1, 0.94], [1, "중간고사", 12, 83.5, 86, 1, 0.92], [2, "중간고사", 8, 74.8, 72, 1, 1.07], [3, "중간고사", 10, 85.1, 88, 1, 0.93], [4, "중간고사", 9, 71.9, 68, 1, 1.12]];
    for (const [i, ex, h, pr, ac, e0, e1] of res) {
      st.results.push({ id: "r" + i, sid: subjects[i].id, name: subjects[i].name, exam: ex, date: D("2026-10-01"), hours: h, predicted: pr, actual: ac, effBefore: e0, effAfter: e1 });
      subjects[i].eff = e1;
    }
    // 오답 노트 (오늘 다시 볼 것 3개, 며칠 뒤 볼 것 2개, 익힌 것 1개)
    const N = (i, text, unit, stage, next, done) => ({ id: "n" + i, sid: subjects[[0, 0, 4, 1, 2, 3][i]].id, text, unit, created: PE.addDays(today, -12 + i), stage, next: PE.addDays(today, next), done: !!done, history: [] });
    st.notes = [
      N(0, "합성함수 미분할 때 속미분 빠뜨림", "미분계수와 도함수", 1, 0),
      N(1, "연속 조건에서 좌극한·우극한 따로 안 구함", "함수의 연속", 0, 0),
      N(2, "항상성: 인슐린·글루카곤 분비 기관 헷갈림", "항상성과 몸의 기능", 2, 0),
      N(3, "중복조합 H 공식에서 n, r 자리 바꿈", "순열과 조합", 2, 3),
      N(4, "비음화와 유음화 조건 구분", "음운의 변동", 1, 2),
      N(5, "관계대명사 what과 that 구분", "Lesson 5", 5, 0, true),
    ];
    st.planHistory.push({ at: d3, reason: "new", note: "처음 계획" });
    return st;
  }

  // 빈 상태 (처음 시작)
  function emptyState(today) {
    const termId = "t" + Date.now().toString(36);
    return {
      v: 1,
      profile: { name: "", school: null, grade: 2, classNo: 1, gradeSystem: 5, majorId: null, careerWeight: true, objective: "avg", autoReplan: true },
      terms: [{ id: termId, name: "이번 학기", subjects: [] }],
      activeTermId: termId,
      availability: { weekday: 180, weekend: 300, overrides: {} },
      calendar: { source: "none", events: [] },
      taken: [],
      courses: { alpha: 0.7, must: [], ban: [], picked: null },
      log: [], notes: [], results: [], planHistory: [], plan: null,
      createdAt: today,
    };
  }

  return { AREAS, MAJORS, SUBJECTS, subjectInfo, REQ_MAP, REQUIREMENTS, CATALOG, DEMO_TAKEN, DEMO_CAL, REAL_TODAY, makeSubject, demoState, emptyState };
});
