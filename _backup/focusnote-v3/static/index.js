// ===== 기본 값 =====
const $ = (id) => document.getElementById(id);
const BREAK_MIN = { short: 5, long: 15 };
const MODE_LABEL = { focus: "집중", short: "짧은 휴식", long: "긴 휴식" };
const SUBJECT_COLORS = [
  "#1f3a34", "#3f5a74", "#b4552d", "#8a6d3b",
  "#4f6d5e", "#7a4a6b", "#5b6b2f", "#2f5f6b",
];
const RING_LEN = 2 * Math.PI * 96; // 원 둘레
const STORE_KEY = "focusnote.timer.v1";
const SUBJECT_KEY = "focusnote.subject";
const AUTO_KEY = "focusnote.autonext";

let me = { id: null };
let subjects = [];
let selectedSubject = Number(localStorage.getItem(SUBJECT_KEY)) || null; // 타이머용 과목
let manualSubject = null;   // 직접 기록 창에서 고른 과목
let pickedColor = SUBJECT_COLORS[0];
let currentTab = "timer";

// 플래너: 타이머에 연결된 할 일 {id, title} (새로고침해도 기억)
const PLAN_KEY = "focusnote.linkedplan";
let linkedPlan = (() => {
  try { return JSON.parse(localStorage.getItem(PLAN_KEY)); } catch (e) { return null; }
})();
let planDay = null;      // 플래너에서 보고 있는 날짜 (YYYY-MM-DD)
let planToday = null;    // 서버 기준 오늘 (한국 날짜)
let planSubject = null;  // 새 할 일에 붙일 과목

// ===== 타이머 상태 (새로고침해도 이어지도록 localStorage에 저장) =====
let timer = loadTimer();

function defaultTimer() {
  return {
    mode: "focus",
    focusLen: 25,       // 집중 길이(분)
    total: 25 * 60,     // 이번 회차 전체 초
    remaining: 25 * 60, // 남은 초 (멈춰 있을 때 기준)
    endAt: null,        // 돌아가는 중이면 끝나는 시각(ms)
    focusCount: 0,      // 끝낸 집중 횟수 (4번째마다 긴 휴식)
  };
}
function loadTimer() {
  try {
    const t = JSON.parse(localStorage.getItem(STORE_KEY));
    if (t && typeof t.total === "number") return Object.assign(defaultTimer(), t);
  } catch (e) { /* 저장값이 깨졌으면 새로 시작 */ }
  return defaultTimer();
}
function saveTimer() {
  localStorage.setItem(STORE_KEY, JSON.stringify(timer));
}
const isRunning = () => timer.endAt !== null;

function remainingSec() {
  if (!isRunning()) return timer.remaining;
  return Math.max(0, Math.round((timer.endAt - Date.now()) / 1000));
}
const elapsedSec = () => timer.total - remainingSec();
const isPaused = () => !isRunning() && remainingSec() < timer.total;

function setMode(mode) {
  timer.mode = mode;
  const min = mode === "focus" ? timer.focusLen : BREAK_MIN[mode];
  timer.total = min * 60;
  timer.remaining = timer.total;
  timer.endAt = null;
  saveTimer();
  render();
}

function start() {
  if (isRunning()) return;
  timer.endAt = Date.now() + timer.remaining * 1000;
  saveTimer();
  askNotifyPermission();
  render();
}
function pause() {
  if (!isRunning()) return;
  timer.remaining = remainingSec();
  timer.endAt = null;
  saveTimer();
  render();
}
function toggle() {
  isRunning() ? pause() : start();
}

// 시간이 다 됐을 때
async function complete() {
  const finished = timer.mode;
  timer.endAt = null;
  timer.remaining = 0;
  saveTimer();
  ding();

  let next;
  if (finished === "focus") {
    timer.focusCount += 1;
    next = timer.focusCount % 4 === 0 ? "long" : "short";
    const saved = await saveSession(timer.focusLen, "focus", undefined, undefined, true);
    let head = saved ? `${timer.focusLen}분 기록했어요.` : "수고했어요.";
    if (saved && linkedPlan) head += await planProgressText(linkedPlan.id);
    notify("집중 끝!", `${head} 이제 ${MODE_LABEL[next]} 차례예요.`);
  } else {
    next = "focus";
    notify("휴식 끝!", "다시 집중해 볼까요?");
  }
  setMode(next);
  if ($("auto-next").checked) start();
}

// 집중 도중 "여기까지 저장"
async function saveNow() {
  const minutes = Math.floor(elapsedSec() / 60);
  if (timer.mode !== "focus" || minutes < 1) return;
  pause();
  const saved = await saveSession(minutes, "focus");
  if (saved) setMode("focus");
}

// ===== 화면 그리기 =====
function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}
function minText(m) {
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}시간 ${r}분` : `${h}시간`;
}

function render() {
  const rem = remainingSec();
  const running = isRunning();
  const paused = isPaused();
  const focus = timer.mode === "focus";
  const loggedIn = me.id !== null;

  $("time").textContent = fmt(rem);
  $("ring-label").textContent = running
    ? (focus ? "집중하는 중" : "쉬는 중")
    : paused ? "일시정지" : `${MODE_LABEL[timer.mode]} ${Math.round(timer.total / 60)}분`;

  // 링: 남은 시간만큼 채워짐
  const fg = $("ring-fg");
  fg.style.strokeDasharray = RING_LEN;
  fg.style.strokeDashoffset = RING_LEN * (1 - (timer.total ? rem / timer.total : 0));

  // 링 안에 지금 과목 이름
  const subj = subjects.find((s) => s.id === selectedSubject);
  $("ring-subject").textContent = focus && subj ? subj.name : "";
  $("ring-subject").style.color = subj ? subj.color : "";
  // 할 일과 연결돼 있으면 링 안과 공부 칸 위에 보여 준다
  const lp = focus && loggedIn ? linkedPlan : null;
  $("ring-plan").textContent = lp ? lp.title : "";
  $("ring-plan").classList.toggle("hidden", !lp);
  $("linked-plan").classList.toggle("hidden", !lp);
  $("linked-plan-title").textContent = lp ? lp.title : "";

  document.body.dataset.mode = timer.mode;
  document.body.classList.toggle("running", running);

  // 돌아가는 동안은 모드·시간을 못 바꾸게 (실수 방지)
  document.querySelectorAll(".mode").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === timer.mode);
    b.disabled = running;
  });
  document.querySelectorAll(".len").forEach((b) => {
    b.classList.toggle("active", Number(b.dataset.min) === timer.focusLen);
    b.disabled = running;
  });
  $("focus-lengths").classList.toggle("hidden", !focus);

  // 상황에 맞는 버튼만 보이기
  $("start-btn").textContent = running ? "일시정지" : paused ? "계속하기" : focus ? "집중 시작" : `${MODE_LABEL[timer.mode]} 시작`;
  $("reset-btn").classList.toggle("hidden", !paused);
  $("save-now-btn").classList.toggle("hidden", !(focus && loggedIn && elapsedSec() >= 60));
  $("skip-btn").classList.toggle("hidden", focus);

  // 안내 문구
  let note = "";
  if (!focus) note = running ? "잠깐 일어나서 스트레칭 해볼까요?" : "쉬는 시간이에요. 건너뛰고 바로 집중해도 돼요.";
  else if (running) note = loggedIn ? "끝까지 하면 자동으로 기록돼요." : "";
  else if (paused) note = "멈춘 동안은 시간이 흐르지 않아요.";
  else if (loggedIn && !subj) note = "아래에서 과목을 고르면 그 과목으로 기록돼요.";
  $("timer-note").textContent = note;

  $("guest-banner").classList.toggle("hidden", loggedIn);
  $("today-strip").classList.toggle("hidden", !loggedIn);

  document.title = running ? `${fmt(rem)} · ${MODE_LABEL[timer.mode]} — 집중노트` : "집중노트";
  renderFocusView();
  syncSoundWithTimer();
}

function tick() {
  if (isRunning() && remainingSec() <= 0) {
    complete();
    return;
  }
  if (isRunning()) render();
}

// ===== 소리 / 알림 =====
function ding() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35, 0.7].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.32);
    });
  } catch (e) { /* 소리를 못 내는 환경이면 넘어감 */ }
}
function askNotifyPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}
function notify(title, body) {
  toast(`${title} ${body}`);
  if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
    try { new Notification(title, { body }); } catch (e) { /* 무시 */ }
  }
}

// ===== 서버 통신 =====
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let data = null;
  if (res.status !== 204) {
    try { data = await res.json(); } catch (e) { data = null; }
  }
  return { ok: res.ok, status: res.status, data };
}

// quiet=true면 알림을 띄우지 않는다 (타이머 완료 알림과 겹치지 않게)
async function saveSession(minutes, mode, subjectId, memo, quiet) {
  if (me.id === null) {
    if (!quiet) toast("로그인하면 공부 기록이 저장돼요");
    return false;
  }
  const sid = subjectId !== undefined ? subjectId : selectedSubject;
  const m = memo !== undefined ? memo : $("memo").value.trim();
  // 타이머 집중이면 연결된 할 일에 시간을 쌓는다 (직접 기록은 연결 안 함)
  const planId = mode === "focus" && linkedPlan ? linkedPlan.id : null;
  const r = await api("/sessions", {
    method: "POST",
    body: JSON.stringify({ minutes, mode, subject_id: sid, memo: m, plan_id: planId }),
  });
  if (!r.ok) {
    toast((r.data && r.data.error) || "저장하지 못했어요");
    return false;
  }
  if (!quiet) toast(`${minText(minutes)} 기록했어요`);
  if (mode === "focus") $("memo").value = "";
  refreshToday();
  if (currentTab === "stats") loadStats();
  if (currentTab === "planner") loadPlanner(planDay);
  return true;
}

async function loadMe() {
  const r = await api("/me");
  me = r.data || { id: null };
  const loggedIn = me.id !== null;
  $("user-box").classList.toggle("hidden", !loggedIn);
  $("nickname").textContent = loggedIn ? me.nickname : "";
  $("login-btn").classList.toggle("hidden", loggedIn);
  $("logout-btn").classList.toggle("hidden", !loggedIn);
  if (loggedIn) {
    await loadSubjects();
    refreshToday();
    loadDdays();
  } else {
    subjects = [];
    ddays = [];
    renderMainChips();
    renderDdays();
  }
  render();
}

// ===== 오늘 공부량 (타이머 화면 위) =====
function applyToday(s) {
  $("today-min").textContent = minText(s.today);
  $("today-goal").textContent = minText(s.goal);
  $("today-fill").style.width = Math.min(100, (s.today / s.goal) * 100) + "%";
  $("today-strip").classList.toggle("done", s.today >= s.goal);
}
async function refreshToday() {
  if (me.id === null) return;
  const [st, pl] = await Promise.all([api("/stats"), api("/plans")]);
  if (st.ok) applyToday(st.data);
  if (pl.ok) {
    planToday = pl.data.today;
    const list = pl.data.plans;
    const done = list.filter((p) => p.done).length;
    $("today-plans").textContent = list.length ? ` · 할 일 ${done}/${list.length}` : "";
    // 연결된 할 일이 지워졌거나 끝났으면 연결을 푼다 (오늘 것만 확인)
    if (linkedPlan && linkedPlan.day === pl.data.day) {
      const p = list.find((x) => x.id === linkedPlan.id);
      if (!p || p.done) setLinkedPlan(null);
    }
  }
}

// ===== 과목 =====
async function loadSubjects() {
  const r = await api("/subjects");
  subjects = r.ok ? r.data : [];
  // 고른 과목이 없거나 지워졌으면 첫 과목으로
  if (!subjects.some((s) => s.id === selectedSubject)) {
    pickSubject(subjects.length ? subjects[0].id : null, true);
  }
  renderMainChips();
  renderSubjectList();
}

function pickSubject(id, silent) {
  selectedSubject = id;
  if (id) localStorage.setItem(SUBJECT_KEY, String(id));
  else localStorage.removeItem(SUBJECT_KEY);
  if (!silent) {
    renderMainChips();
    render();
  }
}

function nextColor() {
  const used = new Set(subjects.map((s) => s.color));
  return SUBJECT_COLORS.find((c) => !used.has(c)) || SUBJECT_COLORS[subjects.length % SUBJECT_COLORS.length];
}

async function addSubject(name, color) {
  const r = await api("/subjects", { method: "POST", body: JSON.stringify({ name, color }) });
  if (!r.ok) {
    toast((r.data && r.data.error) || "과목을 추가하지 못했어요");
    return null;
  }
  await loadSubjects();
  return r.data;
}

// 과목 버튼 묶음 그리기 (타이머 화면, 직접 기록 창에서 같이 씀)
function renderChips(box, selectedId, onPick, withAdd) {
  box.innerHTML = "";
  if (me.id === null) {
    const p = document.createElement("span");
    p.className = "muted";
    p.textContent = "로그인하면 과목을 고를 수 있어요";
    box.appendChild(p);
    return;
  }
  subjects.forEach((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "schip" + (s.id === selectedId ? " active" : "");
    b.style.setProperty("--c", s.color);
    b.setAttribute("aria-pressed", s.id === selectedId ? "true" : "false");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = s.color;
    b.append(dot, document.createTextNode(s.name));
    b.addEventListener("click", () => onPick(s.id));
    box.appendChild(b);
  });
  if (withAdd) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "schip add";
    add.textContent = "+ 과목 추가";
    add.addEventListener("click", () => showInlineAdd(box, add));
    box.appendChild(add);
  }
}

function renderMainChips() {
  renderChips($("subject-chips"), selectedSubject, (id) => pickSubject(id), true);
}

// "+ 과목 추가"를 누르면 그 자리에서 바로 이름 입력
function showInlineAdd(box, addBtn) {
  const input = document.createElement("input");
  input.className = "chip-input";
  input.maxLength = 20;
  input.placeholder = "과목 이름 입력 후 Enter";
  input.setAttribute("aria-label", "새 과목 이름");
  addBtn.replaceWith(input);
  input.focus();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (save && name) {
      const s = await addSubject(name, nextColor());
      if (s) pickSubject(s.id);
      else renderMainChips();
    } else {
      renderMainChips();
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    if (e.key === "Escape") { e.stopPropagation(); finish(false); }
  });
  input.addEventListener("blur", () => finish(true));
}

function renderSubjectList() {
  const ul = $("subject-list");
  ul.innerHTML = "";
  subjects.forEach((s) => {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = s.color;
    const name = document.createElement("span");
    name.className = "grow";
    name.textContent = s.name;
    const del = document.createElement("button");
    del.className = "ghost small";
    del.textContent = "삭제";
    del.addEventListener("click", async () => {
      if (!confirm(`'${s.name}' 과목을 지울까요? 기록은 '과목 없음'으로 남아요.`)) return;
      await api("/subjects/" + s.id, { method: "DELETE" });
      await loadSubjects();
      render();
    });
    li.append(dot, name, del);
    ul.appendChild(li);
  });
  if (!subjects.length) ul.innerHTML = '<li class="muted">과목이 없어요. 아래에서 추가해 보세요.</li>';
}

function renderSwatches() {
  const box = $("swatches");
  box.innerHTML = "";
  SUBJECT_COLORS.forEach((c) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch" + (c === pickedColor ? " active" : "");
    b.style.background = c;
    b.setAttribute("aria-label", "색 " + c);
    b.addEventListener("click", () => { pickedColor = c; renderSwatches(); });
    box.appendChild(b);
  });
}

// ===== 기록 탭 =====
async function loadStats() {
  const guest = me.id === null;
  $("stats-guest").classList.toggle("hidden", !guest);
  $("stats-body").classList.toggle("hidden", guest);
  if (guest) return;

  const [st, ss] = await Promise.all([api("/stats"), api("/sessions")]);
  if (!st.ok) return;
  const s = st.data;
  applyToday(s);
  loadHeatmap();

  $("stat-today").textContent = minText(s.today);
  $("goal-text").textContent = `목표 ${minText(s.goal)} · ${Math.min(100, Math.round((s.today / s.goal) * 100))}%`;
  $("goal-fill").style.width = Math.min(100, (s.today / s.goal) * 100) + "%";
  $("stat-streak").textContent = `${s.streak}일`;
  $("stat-week").textContent = minText(s.week_total);
  $("stat-total").textContent = minText(s.total);

  // 주간 막대그래프
  const chart = $("week-chart");
  chart.innerHTML = "";
  const maxMin = Math.max(s.goal, ...s.week.map((d) => d.minutes), 1);
  s.week.forEach((d) => {
    const col = document.createElement("div");
    col.className = "wcol" + (d.label === "오늘" ? " today" : "");
    const val = document.createElement("div");
    val.className = "wval";
    val.textContent = d.minutes ? minText(d.minutes) : "";
    const track = document.createElement("div");
    track.className = "wtrack";
    const bar = document.createElement("div");
    bar.className = "wbar";
    bar.style.height = (d.minutes / maxMin) * 100 + "%";
    bar.title = `${d.date} · ${minText(d.minutes)}`;
    track.appendChild(bar);
    const lab = document.createElement("div");
    lab.className = "wlabel";
    lab.textContent = d.label;
    col.append(val, track, lab);
    chart.appendChild(col);
  });
  const goalLine = document.createElement("div");
  goalLine.className = "goal-line";
  goalLine.style.bottom = `calc(28px + (100% - 56px) * ${s.goal / maxMin})`;
  goalLine.dataset.label = "목표";
  chart.appendChild(goalLine);

  // 과목별
  const sb = $("subject-bars");
  sb.innerHTML = "";
  if (!s.by_subject.length) {
    sb.innerHTML = '<p class="muted">최근 7일 기록이 아직 없어요.</p>';
  } else {
    const top = s.by_subject[0].minutes || 1;
    s.by_subject.forEach((x) => {
      const row = document.createElement("div");
      row.className = "srow";
      const name = document.createElement("span");
      name.className = "sname";
      name.textContent = x.name;
      const track = document.createElement("div");
      track.className = "strack";
      const fill = document.createElement("div");
      fill.className = "sfill";
      fill.style.width = (x.minutes / top) * 100 + "%";
      fill.style.background = x.color;
      track.appendChild(fill);
      const val = document.createElement("span");
      val.className = "sval";
      val.textContent = minText(x.minutes);
      row.append(name, track, val);
      sb.appendChild(row);
    });
  }

  // 최근 기록
  const ul = $("session-list");
  ul.innerHTML = "";
  const rows = ss.ok ? ss.data : [];
  if (!rows.length) {
    ul.innerHTML = '<li class="muted">아직 기록이 없어요. 타이머로 첫 집중을 시작해 보세요.</li>';
  }
  rows.forEach((r) => {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = r.color;
    const main = document.createElement("div");
    main.className = "grow";
    const t = document.createElement("div");
    t.className = "s-title";
    t.textContent = `${r.subject} · ${minText(r.minutes)}${r.mode === "free" ? " (직접 입력)" : ""}`;
    const sub = document.createElement("div");
    sub.className = "s-sub";
    sub.textContent = r.memo ? `${r.when} · ${r.memo}` : r.when;
    main.append(t, sub);
    const del = document.createElement("button");
    del.className = "ghost small";
    del.textContent = "삭제";
    del.setAttribute("aria-label", "기록 삭제");
    del.addEventListener("click", async () => {
      if (!confirm("이 기록을 지울까요?")) return;
      await api("/sessions/" + r.id, { method: "DELETE" });
      loadStats();
    });
    li.append(dot, main, del);
    ul.appendChild(li);
  });
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".tab").forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  $("panel-timer").classList.toggle("active", tab === "timer");
  $("panel-planner").classList.toggle("active", tab === "planner");
  $("panel-stats").classList.toggle("active", tab === "stats");
  if (tab === "stats") loadStats();
  if (tab === "planner") loadPlanner(planDay);
}

// ===== 스터디 플래너 =====
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// 날짜는 'YYYY-MM-DD' 글자로 다룬다 (시간대 문제를 피하려고 UTC로 계산)
function addDays(day, n) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dayParts(day) {
  const d = new Date(day + "T00:00:00Z");
  return { m: d.getUTCMonth() + 1, d: d.getUTCDate(), w: WEEKDAYS[d.getUTCDay()] };
}
function dayTitle(day) {
  const p = dayParts(day);
  const base = `${p.m}월 ${p.d}일 (${p.w})`;
  if (day === planToday) return `오늘 · ${base}`;
  if (day === addDays(planToday, -1)) return `어제 · ${base}`;
  if (day === addDays(planToday, 1)) return `내일 · ${base}`;
  return base;
}

function setLinkedPlan(p) {
  linkedPlan = p ? { id: p.id, title: p.title, day: p.day } : null;
  if (linkedPlan) localStorage.setItem(PLAN_KEY, JSON.stringify(linkedPlan));
  else localStorage.removeItem(PLAN_KEY);
  render();
}

// 집중이 끝났을 때 "할 일 목표까지 얼마나" 문구
async function planProgressText(id) {
  const day = linkedPlan && linkedPlan.day;
  const r = await api("/plans" + (day ? "?day=" + day : ""));
  const p = r.ok && r.data.plans.find((x) => x.id === id);
  if (!p || !p.target_min) return "";
  return p.studied >= p.target_min
    ? ` '${p.title}' 목표 시간을 채웠어요! 플래너에서 완료를 눌러 주세요.`
    : ` '${p.title}' ${minText(p.studied)} / ${minText(p.target_min)}.`;
}

async function loadPlanner(day) {
  const guest = me.id === null;
  $("planner-guest").classList.toggle("hidden", !guest);
  $("planner-body").classList.toggle("hidden", guest);
  if (guest) return;

  const r = await api("/plans" + (day ? "?day=" + day : ""));
  if (!r.ok) return;
  const data = r.data;
  planDay = data.day;
  planToday = data.today;
  renderDayStrip(data.counts);
  renderPlans(data);
}

function renderDayStrip(counts) {
  const box = $("day-strip");
  box.innerHTML = "";
  for (let i = -3; i <= 3; i++) {
    const day = addDays(planDay, i);
    const p = dayParts(day);
    const c = counts[day];
    const b = document.createElement("button");
    b.type = "button";
    b.className = "dchip" + (day === planDay ? " active" : "") + (day === planToday ? " today" : "");
    b.setAttribute("aria-label", dayTitle(day) + (c ? ` 할 일 ${c.total}개` : ""));
    const w = document.createElement("span");
    w.className = "dw";
    w.textContent = day === planToday ? "오늘" : p.w;
    const n = document.createElement("span");
    n.className = "dn";
    n.textContent = p.d;
    const dot = document.createElement("span");
    dot.className = "dd" + (c ? (c.done >= c.total ? " all" : " some") : "");
    b.append(w, n, dot);
    b.addEventListener("click", () => loadPlanner(day));
    box.appendChild(b);
  }
}

function renderPlanChips() {
  renderChips($("plan-chips"), planSubject, (id) => {
    planSubject = planSubject === id ? null : id; // 한 번 더 누르면 해제
    renderPlanChips();
  }, false);
}

function renderPlans(data) {
  const list = data.plans;
  const done = list.filter((p) => p.done).length;
  const studied = list.reduce((a, p) => a + p.studied, 0);

  $("plan-date").textContent = dayTitle(planDay);
  $("plan-summary").textContent = list.length
    ? `할 일 ${list.length}개 중 ${done}개 완료${studied ? ` · 할 일로 공부 ${minText(studied)}` : ""}`
    : "아직 할 일이 없어요. 오늘 할 공부를 적어 보세요.";
  $("plan-fill").style.width = list.length ? (done / list.length) * 100 + "%" : "0%";
  $("day-today").classList.toggle("hidden", planDay === planToday);

  $("carry-box").classList.toggle("hidden", !data.carry);
  $("carry-text").textContent = `지난 7일 동안 못 끝낸 할 일이 ${data.carry}개 있어요.`;

  renderPlanChips();

  const ul = $("plan-list");
  ul.innerHTML = "";
  list.forEach((p) => ul.appendChild(planItem(p)));
}

function planItem(p) {
  const li = document.createElement("li");
  li.className = "plan-item" + (p.done ? " done" : "") + (linkedPlan && linkedPlan.id === p.id ? " linked" : "");

  // 완료 체크
  const chk = document.createElement("input");
  chk.type = "checkbox";
  chk.className = "plan-check";
  chk.checked = p.done;
  chk.setAttribute("aria-label", `'${p.title}' 완료`);
  chk.addEventListener("change", async () => {
    await api("/plans/" + p.id, { method: "PATCH", body: JSON.stringify({ done: chk.checked }) });
    if (chk.checked && linkedPlan && linkedPlan.id === p.id) setLinkedPlan(null);
    if (chk.checked) toast(`'${p.title}' 완료!`);
    loadPlanner(planDay);
    refreshToday();
  });

  const main = document.createElement("div");
  main.className = "grow";

  // 제목 (누르면 그 자리에서 고치기)
  const title = document.createElement("button");
  title.type = "button";
  title.className = "plan-title";
  title.textContent = p.title;
  title.title = "눌러서 고치기";
  title.addEventListener("click", () => editPlanTitle(p, title));

  // 과목 · 시간 진행
  const meta = document.createElement("div");
  meta.className = "plan-meta";
  if (p.subject) {
    const s = document.createElement("span");
    s.className = "pm-subject";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = p.color;
    s.append(dot, document.createTextNode(p.subject));
    meta.appendChild(s);
  }
  if (p.target_min || p.studied) {
    const t = document.createElement("span");
    t.className = "pm-time";
    t.textContent = p.target_min ? `${minText(p.studied)} / ${minText(p.target_min)}` : `공부 ${minText(p.studied)}`;
    meta.appendChild(t);
  }
  if (linkedPlan && linkedPlan.id === p.id) {
    const l = document.createElement("span");
    l.className = "pm-linked";
    l.textContent = "타이머 연결됨";
    meta.appendChild(l);
  }
  main.append(title, meta);
  if (p.target_min) {
    const bar = document.createElement("div");
    bar.className = "bar plan-bar";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = Math.min(100, (p.studied / p.target_min) * 100) + "%";
    bar.appendChild(fill);
    main.appendChild(bar);
  }

  // 버튼들
  const actions = document.createElement("div");
  actions.className = "plan-actions";
  if (!p.done) {
    const go = document.createElement("button");
    go.className = "primary small";
    go.textContent = "집중";
    go.title = "이 할 일로 타이머 시작";
    go.addEventListener("click", () => startPlan(p));
    actions.appendChild(go);
    if (planDay <= planToday) {
      const later = document.createElement("button");
      later.className = "ghost small";
      later.textContent = "내일로";
      later.addEventListener("click", async () => {
        await api("/plans/" + p.id, { method: "PATCH", body: JSON.stringify({ day: addDays(planToday, 1) }) });
        toast(`'${p.title}'을(를) 내일로 옮겼어요`);
        loadPlanner(planDay);
        refreshToday();
      });
      actions.appendChild(later);
    }
  }
  const del = document.createElement("button");
  del.className = "ghost small";
  del.textContent = "삭제";
  del.setAttribute("aria-label", `'${p.title}' 삭제`);
  del.addEventListener("click", async () => {
    if (!confirm(`'${p.title}'을(를) 지울까요? 공부 기록은 남아요.`)) return;
    await api("/plans/" + p.id, { method: "DELETE" });
    if (linkedPlan && linkedPlan.id === p.id) setLinkedPlan(null);
    loadPlanner(planDay);
    refreshToday();
  });
  actions.appendChild(del);

  li.append(chk, main, actions);
  return li;
}

function editPlanTitle(p, el) {
  const input = document.createElement("input");
  input.className = "plan-edit";
  input.maxLength = 60;
  input.value = p.title;
  input.setAttribute("aria-label", "할 일 고치기");
  el.replaceWith(input);
  input.focus();
  input.select();
  let finished = false;
  const finish = async (save) => {
    if (finished) return;
    finished = true;
    const v = input.value.trim();
    if (save && v && v !== p.title) {
      const r = await api("/plans/" + p.id, { method: "PATCH", body: JSON.stringify({ title: v }) });
      if (!r.ok) toast((r.data && r.data.error) || "고치지 못했어요");
      else if (linkedPlan && linkedPlan.id === p.id) setLinkedPlan({ ...p, title: v, day: planDay });
    }
    loadPlanner(planDay);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

// 할 일의 [집중] → 과목을 맞추고 타이머 탭으로 가서 바로 시작
function startPlan(p) {
  const plan = { ...p, day: planDay };
  if (isRunning()) {
    if (timer.mode === "focus") {
      if (!confirm(`지금 돌고 있는 집중 시간을 '${p.title}'(으)로 이어서 기록할까요?`)) return;
      setLinkedPlan(plan);
      if (p.subject_id) pickSubject(p.subject_id);
      switchTab("timer");
      return;
    }
    pause(); // 쉬는 중이면 휴식을 멈추고 집중으로
  }
  if (isPaused() && timer.mode === "focus" && elapsedSec() >= 60 &&
      !confirm("멈춰 둔 집중 시간이 있어요. 그 시간도 이 할 일로 이어서 할까요?\n(취소하면 새로 시작해요)")) {
    setMode("focus");
  } else if (timer.mode !== "focus") {
    setMode("focus");
  }
  setLinkedPlan(plan);
  if (p.subject_id) pickSubject(p.subject_id);
  switchTab("timer");
  start();
  toast(`'${p.title}' 집중 시작!`);
}

// ===== D-day =====
let ddays = [];

function ddayText(left) {
  if (left === 0) return "D-DAY";
  return left > 0 ? `D-${left}` : `D+${-left}`;
}

async function loadDdays() {
  if (me.id === null) return;
  const r = await api("/ddays");
  ddays = r.ok ? r.data : [];
  renderDdays();
}

function renderDdays() {
  const loggedIn = me.id !== null;
  $("dday-row").classList.toggle("hidden", !loggedIn);
  const box = $("dday-list");
  box.innerHTML = "";
  // 위 줄에는 아직 안 지난 것 3개까지만
  ddays.filter((d) => d.left >= 0).slice(0, 3).forEach((d) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "dday-chip" + (d.left === 0 ? " today" : d.left <= 7 ? " soon" : "");
    const n = document.createElement("b");
    n.textContent = ddayText(d.left);
    const t = document.createElement("span");
    t.textContent = d.title;
    b.append(n, t);
    b.title = `${d.title} · ${d.day}`;
    b.addEventListener("click", openDdayModal);
    box.appendChild(b);
  });
  $("dday-edit").textContent = ddays.some((d) => d.left >= 0) ? "+" : "+ D-day 추가";
  $("dday-edit").setAttribute("aria-label", "D-day 관리");

  // 관리 창 목록
  const ul = $("dday-manage");
  ul.innerHTML = "";
  if (!ddays.length) ul.innerHTML = '<li class="muted">시험이나 수행평가 날짜를 넣어 보세요.</li>';
  ddays.forEach((d) => {
    const li = document.createElement("li");
    const badge = document.createElement("span");
    badge.className = "dday-badge" + (d.left < 0 ? " past" : "");
    badge.textContent = ddayText(d.left);
    const name = document.createElement("span");
    name.className = "grow";
    name.textContent = `${d.title}`;
    const day = document.createElement("span");
    day.className = "muted";
    day.textContent = d.day.slice(5).replace("-", "/");
    const del = document.createElement("button");
    del.className = "ghost small";
    del.textContent = "삭제";
    del.setAttribute("aria-label", `'${d.title}' 삭제`);
    del.addEventListener("click", async () => {
      await api("/ddays/" + d.id, { method: "DELETE" });
      loadDdays();
    });
    li.append(badge, name, day, del);
    ul.appendChild(li);
  });
}

function openDdayModal() {
  $("dday-err").textContent = "";
  if (!$("dday-date").value && planToday) $("dday-date").value = addDays(planToday, 7);
  renderDdays();
  openModal("dday-modal");
  setTimeout(() => $("dday-title").focus(), 50);
}

// ===== 집중 화면 (시계만 크게) =====
const focusViewOpen = () => !$("focus-view").classList.contains("hidden");

function openFocusView() {
  $("focus-view").classList.remove("hidden");
  document.body.classList.add("fv-open");
  renderFocusView();
  // 가능하면 전체 화면으로 (안 되면 그냥 크게 보기만)
  const el = document.documentElement;
  if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => {});
}
function closeFocusView() {
  $("focus-view").classList.add("hidden");
  document.body.classList.remove("fv-open");
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
}

function renderFocusView() {
  if (!focusViewOpen()) return;
  const rem = remainingSec();
  const focus = timer.mode === "focus";
  const subj = subjects.find((s) => s.id === selectedSubject);
  let what = MODE_LABEL[timer.mode];
  if (focus && linkedPlan && me.id !== null) what = linkedPlan.title;
  else if (focus && subj) what = subj.name;
  $("fv-what").textContent = what;
  $("fv-time").textContent = fmt(rem);
  $("fv-label").textContent = isRunning() ? (focus ? "집중하는 중" : "쉬는 중") : isPaused() ? "일시정지" : "준비";
  $("fv-fill").style.width = (timer.total ? (1 - rem / timer.total) * 100 : 0) + "%";
  $("fv-toggle").textContent = isRunning() ? "일시정지" : isPaused() ? "계속하기" : "시작";
}

// ===== 배경 소리 (앱이 직접 만드는 소리라 파일·저작권이 필요 없음) =====
const SOUND_KEY = "focusnote.sound";
let sound = { kind: localStorage.getItem(SOUND_KEY) || "off", ctx: null, nodes: [], gain: null };

function makeNoise(ctx, type) {
  // 2초짜리 잡음을 만들어 반복 재생한다
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    if (type === "brown") {
      last = (last + 0.02 * white) / 1.02;   // 낮고 부드러운 소리
      data[i] = last * 3.5;
    } else {
      data[i] = white;
    }
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  return src;
}

function stopSound() {
  sound.nodes.forEach((n) => { try { n.stop ? n.stop() : n.disconnect(); } catch (e) { /* 이미 멈춤 */ } });
  sound.nodes = [];
}

function playSound(kind) {
  stopSound();
  if (kind === "off") return;
  try {
    if (!sound.ctx) {
      sound.ctx = new (window.AudioContext || window.webkitAudioContext)();
      sound.gain = sound.ctx.createGain();
      sound.gain.connect(sound.ctx.destination);
    }
    const ctx = sound.ctx;
    if (ctx.state === "suspended") ctx.resume();
    sound.gain.gain.value = Number($("sound-vol").value) / 100 * 0.5;

    if (kind === "white") {
      const src = makeNoise(ctx, "white");
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 6000;
      const g = ctx.createGain(); g.gain.value = 0.35;
      src.connect(lp).connect(g).connect(sound.gain);
      src.start();
      sound.nodes.push(src, lp, g);
    } else if (kind === "rain") {
      // 낮은 잡음 + 높은 잡음을 섞어 빗소리처럼
      const low = makeNoise(ctx, "brown");
      const hi = makeNoise(ctx, "white");
      const bp = ctx.createBiquadFilter();
      bp.type = "highpass"; bp.frequency.value = 2500;
      const gl = ctx.createGain(); gl.gain.value = 0.9;
      const gh = ctx.createGain(); gh.gain.value = 0.08;
      low.connect(gl).connect(sound.gain);
      hi.connect(bp).connect(gh).connect(sound.gain);
      low.start(); hi.start();
      sound.nodes.push(low, hi, bp, gl, gh);
    } else if (kind === "cafe") {
      // 사람 목소리 높이 쪽 잡음이 천천히 커졌다 작아졌다 (웅성웅성)
      const src = makeNoise(ctx, "brown");
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = 500; bp.Q.value = 0.8;
      const g = ctx.createGain(); g.gain.value = 1.2;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.15;
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.4;
      lfo.connect(lfoGain).connect(g.gain);
      src.connect(bp).connect(g).connect(sound.gain);
      src.start(); lfo.start();
      sound.nodes.push(src, bp, g, lfo, lfoGain);
    }
  } catch (e) {
    toast("이 브라우저에서는 배경 소리를 낼 수 없어요");
  }
}

function setSound(kind) {
  sound.kind = kind;
  localStorage.setItem(SOUND_KEY, kind);
  document.querySelectorAll("#sound-seg button").forEach((b) => {
    const on = b.dataset.sound === kind;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  $("sound-vol").classList.toggle("hidden", kind === "off");
  syncSoundWithTimer(true);
}

// 집중 타이머가 돌 때만 소리가 나고, 멈추거나 쉬면 꺼진다
let soundPlaying = null;
function syncSoundWithTimer(force) {
  const want = isRunning() && timer.mode === "focus" ? sound.kind : "off";
  if (!force && want === soundPlaying) return;
  soundPlaying = want;
  playSound(want);
}

// ===== 공부 잔디 =====
function heatLevel(min) {
  if (min <= 0) return 0;
  if (min < 30) return 1;
  if (min < 90) return 2;
  if (min < 180) return 3;
  return 4;
}

async function loadHeatmap() {
  const r = await api("/heatmap");
  if (!r.ok) return;
  const h = r.data;
  $("heat-summary").textContent = `· 최근 12주 중 ${h.study_days}일 공부${h.best ? ` · 하루 최고 ${minText(h.best)}` : ""}`;
  const box = $("heat");
  box.innerHTML = "";
  h.days.forEach((d) => {
    const c = document.createElement("span");
    c.className = "hc l" + heatLevel(d.minutes) + (d.future ? " future" : "") + (d.date === planToday ? " today" : "");
    const p = dayParts(d.date);
    c.title = d.future ? "" : `${p.m}월 ${p.d}일 (${p.w}) · ${d.minutes ? minText(d.minutes) : "공부 안 함"}`;
    box.appendChild(c);
  });
}

// ===== 새 기능 이벤트 =====
function bindExtras() {
  // D-day
  $("dday-edit").addEventListener("click", openDdayModal);
  $("dday-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("dday-title").value.trim();
    const day = $("dday-date").value;
    if (!title) { $("dday-err").textContent = "이름을 적어주세요."; return $("dday-title").focus(); }
    if (!day) { $("dday-err").textContent = "날짜를 골라주세요."; return; }
    const r = await api("/ddays", { method: "POST", body: JSON.stringify({ title, day }) });
    if (!r.ok) { $("dday-err").textContent = (r.data && r.data.error) || "추가하지 못했어요"; return; }
    $("dday-err").textContent = "";
    $("dday-title").value = "";
    await loadDdays();
    toast(`'${title}' D-day를 추가했어요`);
  });

  // 집중 화면
  $("focus-view-btn").addEventListener("click", openFocusView);
  $("fv-close").addEventListener("click", closeFocusView);
  $("fv-toggle").addEventListener("click", toggle);
  document.addEventListener("fullscreenchange", () => {
    // 브라우저 전체 화면을 Esc로 빠져나오면 집중 화면도 닫는다
    if (!document.fullscreenElement && focusViewOpen()) closeFocusView();
  });

  // 배경 소리
  document.querySelectorAll("#sound-seg button").forEach((b) =>
    b.addEventListener("click", () => {
      setSound(b.dataset.sound);
      if (b.dataset.sound !== "off" && !(isRunning() && timer.mode === "focus")) {
        toast("집중 타이머가 돌 때 소리가 나요");
      }
    })
  );
  $("sound-vol").addEventListener("input", () => {
    if (sound.gain) sound.gain.gain.value = Number($("sound-vol").value) / 100 * 0.5;
    localStorage.setItem(SOUND_KEY + ".vol", $("sound-vol").value);
  });
  const vol = localStorage.getItem(SOUND_KEY + ".vol");
  if (vol !== null) $("sound-vol").value = vol;
  setSound(sound.kind);
}

// ===== 모달 / 토스트 =====
function openModal(id) { $(id).classList.remove("hidden"); }
function closeModal(id) { $(id).classList.add("hidden"); }
const anyModalOpen = () => !!document.querySelector(".modal:not(.hidden)");

function openAuth(which) {
  openModal("auth-modal");
  $("login-err").textContent = "";
  $("signup-err").textContent = "";
  $("login-form").classList.toggle("hidden", which === "signup");
  $("signup-form").classList.toggle("hidden", which !== "signup");
  const form = which === "signup" ? $("signup-form") : $("login-form");
  setTimeout(() => form.elements.username.focus(), 50);
}

let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

// 빠른 선택 버튼 (직접 기록·목표 창)
function bindQuick(boxId, inputId) {
  const box = $(boxId);
  const input = $(inputId);
  const sync = () => box.querySelectorAll("button").forEach((b) =>
    b.classList.toggle("active", b.dataset.min === String(input.value)));
  box.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => { input.value = b.dataset.min; sync(); }));
  input.addEventListener("input", sync);
  return sync;
}

function openManual() {
  if (me.id === null) return openAuth("login");
  manualSubject = selectedSubject;
  const draw = () => renderChips($("manual-chips"), manualSubject, (id) => { manualSubject = id; draw(); }, false);
  draw();
  $("manual-err").textContent = "";
  syncManualQuick();
  openModal("manual-modal");
}

function openGoal() {
  $("goal-minutes").value = me.daily_goal || 120;
  $("goal-err").textContent = "";
  syncGoalQuick();
  openModal("goal-modal");
}

let syncManualQuick = () => {};
let syncGoalQuick = () => {};

// ===== 이벤트 연결 =====
function bind() {
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  $("today-strip").addEventListener("click", () => switchTab("stats"));

  // 플래너
  $("planner-login").addEventListener("click", () => openAuth("login"));
  $("day-prev").addEventListener("click", () => loadPlanner(addDays(planDay, -7)));
  $("day-next").addEventListener("click", () => loadPlanner(addDays(planDay, 7)));
  $("day-today").addEventListener("click", () => loadPlanner(planToday));
  $("carry-btn").addEventListener("click", async () => {
    const r = await api("/plans/carry", { method: "POST", body: "{}" });
    if (r.ok) toast(`할 일 ${r.data.moved}개를 오늘로 가져왔어요`);
    loadPlanner(planToday);
    refreshToday();
  });
  $("plan-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("plan-title").value.trim();
    if (!title) return $("plan-title").focus();
    const r = await api("/plans", {
      method: "POST",
      body: JSON.stringify({
        title,
        day: planDay,
        subject_id: planSubject,
        target_min: Number($("plan-target").value),
      }),
    });
    if (!r.ok) {
      $("plan-err").textContent = (r.data && r.data.error) || "추가하지 못했어요";
      return;
    }
    $("plan-err").textContent = "";
    $("plan-title").value = "";
    $("plan-title").focus(); // 바로 다음 할 일을 이어서 적을 수 있게
    await loadPlanner(planDay);
    refreshToday();
  });
  $("unlink-plan").addEventListener("click", () => setLinkedPlan(null));

  document.querySelectorAll(".mode").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.mode === timer.mode && !isPaused()) return;
      if (isPaused() && timer.mode === "focus" && elapsedSec() >= 60 &&
          !confirm("멈춰 둔 집중 시간이 사라져요. 바꿀까요? (먼저 '여기까지 저장'을 누르면 남길 수 있어요)")) return;
      setMode(b.dataset.mode);
    })
  );
  document.querySelectorAll(".len").forEach((b) =>
    b.addEventListener("click", () => {
      if (isPaused() && elapsedSec() >= 60 && !confirm("멈춰 둔 시간이 사라져요. 시간을 바꿀까요?")) return;
      timer.focusLen = Number(b.dataset.min);
      setMode("focus");
    })
  );

  $("start-btn").addEventListener("click", toggle);
  $("reset-btn").addEventListener("click", () => {
    if (timer.mode === "focus" && elapsedSec() >= 60 &&
        !confirm("지금까지 한 시간이 사라져요. 처음으로 돌릴까요?")) return;
    setMode(timer.mode);
  });
  $("save-now-btn").addEventListener("click", saveNow);
  $("skip-btn").addEventListener("click", () => setMode("focus"));

  const auto = $("auto-next");
  auto.checked = localStorage.getItem(AUTO_KEY) === "1";
  auto.addEventListener("change", () => localStorage.setItem(AUTO_KEY, auto.checked ? "1" : "0"));

  // 키보드: 스페이스바 시작/일시정지, F 크게 보기, Esc 닫기 (글 쓰는 중이거나 창이 열려 있으면 무시)
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (focusViewOpen()) return closeFocusView();
      document.querySelectorAll(".modal").forEach((m) => closeModal(m.id));
      return;
    }
    if (anyModalOpen() || e.target.closest("input, textarea, select")) return;
    if (!focusViewOpen() && currentTab !== "timer") return;
    if (e.code === "KeyF" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      focusViewOpen() ? closeFocusView() : openFocusView();
      return;
    }
    if (e.code !== "Space" || e.target.closest("button, a")) return;
    e.preventDefault();
    toggle();
  });

  // 과목 편집 창
  $("manage-subjects").addEventListener("click", () => {
    if (me.id === null) return openAuth("login");
    $("subject-err").textContent = "";
    pickedColor = nextColor();
    renderSwatches();
    renderSubjectList();
    openModal("subject-modal");
  });
  $("subject-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("new-subject").value.trim();
    if (!name) return;
    const s = await addSubject(name, pickedColor);
    if (!s) return;
    $("new-subject").value = "";
    pickedColor = nextColor();
    renderSwatches();
    render();
  });

  // 직접 기록
  syncManualQuick = bindQuick("manual-quick", "manual-minutes");
  $("manual-btn").addEventListener("click", openManual);
  $("manual-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const minutes = parseInt($("manual-minutes").value, 10);
    if (!(minutes >= 1 && minutes <= 300)) {
      $("manual-err").textContent = "1~300분 사이로 적어주세요.";
      return;
    }
    const ok = await saveSession(minutes, "free", manualSubject, $("manual-memo").value.trim());
    if (ok) {
      $("manual-memo").value = "";
      closeModal("manual-modal");
    }
  });

  // 하루 목표
  syncGoalQuick = bindQuick("goal-quick", "goal-minutes");
  $("goal-edit").addEventListener("click", openGoal);
  $("goal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const minutes = parseInt($("goal-minutes").value, 10);
    const r = await api("/goal", { method: "PUT", body: JSON.stringify({ minutes }) });
    if (!r.ok) {
      $("goal-err").textContent = (r.data && r.data.error) || "바꾸지 못했어요";
      return;
    }
    me.daily_goal = r.data.daily_goal;
    closeModal("goal-modal");
    toast(`하루 목표를 ${minText(me.daily_goal)}으로 정했어요`);
    refreshToday();
    if (currentTab === "stats") loadStats();
  });

  // 모달 닫기: ✕ 버튼, 바깥 클릭
  document.querySelectorAll(".modal").forEach((m) => {
    m.addEventListener("click", (e) => { if (e.target === m) closeModal(m.id); });
    m.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => closeModal(m.id)));
  });

  // 로그인 / 회원가입
  $("login-btn").addEventListener("click", () => openAuth("login"));
  $("banner-login").addEventListener("click", () => openAuth("login"));
  $("stats-login").addEventListener("click", () => openAuth("login"));
  $("to-signup").addEventListener("click", (e) => { e.preventDefault(); openAuth("signup"); });
  $("to-login").addEventListener("click", (e) => { e.preventDefault(); openAuth("login"); });
  $("logout-btn").addEventListener("click", async () => {
    await api("/logout", { method: "POST" });
    setLinkedPlan(null);
    await loadMe();
    if (currentTab === "stats") loadStats();
    if (currentTab === "planner") loadPlanner(null);
  });

  const afterAuth = async () => {
    closeModal("auth-modal");
    await loadMe();
    toast(`${me.nickname}님, 반가워요`);
    if (currentTab === "stats") loadStats();
    if (currentTab === "planner") loadPlanner(null);
  };
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const r = await api("/login", {
      method: "POST",
      body: JSON.stringify({ username: f.elements.username.value, password: f.elements.password.value }),
    });
    if (!r.ok) return ($("login-err").textContent = (r.data && r.data.error) || "로그인하지 못했어요");
    afterAuth();
  });
  $("signup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const r = await api("/signup", {
      method: "POST",
      body: JSON.stringify({
        username: f.elements.username.value,
        password: f.elements.password.value,
        nickname: f.elements.nickname.value,
      }),
    });
    if (!r.ok) return ($("signup-err").textContent = (r.data && r.data.error) || "가입하지 못했어요");
    afterAuth();
  });
}

// ===== 시작 =====
async function init() {
  bind();
  bindExtras();
  render();
  await loadMe();
  // 다른 탭에 있는 동안 시간이 끝났으면 바로 처리
  tick();
  setInterval(tick, 250);
}
init();
