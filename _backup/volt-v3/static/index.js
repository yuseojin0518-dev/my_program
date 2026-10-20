"use strict";
// =========================================================
//  볼트 커넥션 — 화면 동작
//  전압 미리보기는 화면에서 하지만, 정답·별·코인·시간은 서버가 다시 확인한다.
// =========================================================
const $ = (id) => document.getElementById(id);
const ORDER = ["a", "c", "l", "n"];
let U = { a: 3, c: 6, l: 12, n: 18 };        // 0.5V 단위 (서버에서 다시 받음)
let BAT = {};
let META = null;                             // /api/stages
let ME = { id: null };
let G = null;                                // 지금 하는 판
let lastStagesView = null;

// ----- 설정 · 손님 기록 (브라우저에 저장) -----
const SET_KEY = "vc.settings";
const GUEST_KEY = "vc.guest";
const settings = Object.assign({ sound: true, vibrate: true, theme: "dark", calm: false },
  JSON.parse(localStorage.getItem(SET_KEY) || "{}"));
const saveSettings = () => localStorage.setItem(SET_KEY, JSON.stringify(settings));
let guest = JSON.parse(localStorage.getItem(GUEST_KEY) || '{"stars":{},"tokens":{}}');
const saveGuest = () => localStorage.setItem(GUEST_KEY, JSON.stringify(guest));

// ----- 도우미 -----
const volt = (u) => { const v = u / 2; return (Number.isInteger(v) ? v : v.toFixed(1)) + "V"; };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const icon = (name, cls) => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  if (cls) s.setAttribute("class", cls);
  s.setAttribute("aria-hidden", "true");
  const u = document.createElementNS("http://www.w3.org/2000/svg", "use");
  u.setAttribute("href", "#" + name);
  s.appendChild(u);
  return s;
};

async function api(path, body, method) {
  try {
    const res = await fetch(path, {
      method: method || (body !== undefined ? "POST" : "GET"),
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    return { ok: res.ok, status: res.status, data: data || {} };
  } catch (e) {
    return { ok: false, status: 0, data: { error: "인터넷 연결을 확인해 주세요." } };
  }
}

let toastTimer = null;
function toast(msg, ms) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms || 2600);
}
function floatText(text, x, y, cls) {
  const f = el("div", "float-txt " + (cls || ""), text);
  f.style.left = x + "px";
  f.style.top = y + "px";
  $("fx").appendChild(f);
  setTimeout(() => f.remove(), 1200);
}
function floatAt(node, text, cls) {
  const r = node.getBoundingClientRect();
  floatText(text, r.left + r.width / 2, r.top, cls);
}
function confetti() {
  if (settings.calm) return;
  const colors = ["var(--volt)", "var(--ok)", "var(--info)", "var(--n)", "var(--l)"];
  for (let i = 0; i < 36; i++) {
    const c = el("div", "confetti");
    c.style.left = 50 + (Math.random() - 0.5) * 40 + "vw";
    c.style.top = "20vh";
    c.style.background = colors[i % colors.length];
    c.style.setProperty("--dx", (Math.random() - 0.5) * 60 + "vw");
    c.style.setProperty("--rot", Math.random() * 720 + "deg");
    c.style.animationDelay = Math.random() * 0.2 + "s";
    $("fx").appendChild(c);
    setTimeout(() => c.remove(), 1800);
  }
}

// ----- 소리 · 진동 (앱이 직접 만드는 소리) -----
let actx = null;
function beep(freq, dur, type, vol, delay) {
  if (!settings.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    const t = actx.currentTime + (delay || 0);
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  } catch (e) { /* 소리를 못 내면 넘어감 */ }
}
const sfx = {
  pick: () => beep(660, 0.05, "triangle", 0.08),
  place: () => { beep(420, 0.05, "triangle", 0.12); beep(640, 0.06, "triangle", 0.08, 0.04); },
  flip: () => beep(330, 0.08, "square", 0.05),
  remove: () => beep(240, 0.07, "triangle", 0.1),
  bad: () => beep(150, 0.18, "sawtooth", 0.06),
  win: () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.22, "sine", 0.14, i * 0.09)),
  coin: () => { beep(988, 0.06, "square", 0.05); beep(1319, 0.12, "square", 0.05, 0.06); },
  tick: () => beep(880, 0.03, "square", 0.035),
  item: () => [440, 554, 659].forEach((f, i) => beep(f, 0.1, "triangle", 0.09, i * 0.05)),
  over: () => [392, 330, 262, 196].forEach((f, i) => beep(f, 0.22, "triangle", 0.1, i * 0.12)),
};
const vibe = (p) => { if (settings.vibrate && navigator.vibrate) navigator.vibrate(p); };

// ===== 화면 이동 =====
let currentView = "home";
function show(view) {
  currentView = view;
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));
  $("nav-back").classList.toggle("hidden", view === "home");
  window.scrollTo(0, 0);
  if (view !== "game") stopRushClock();
}
function goBack() {
  if (currentView === "game") return leaveGame();
  if (currentView === "home") return;
  goHome();
}
async function goHome() {
  G = null;
  show("home");
  renderHome();        // 가진 정보로 먼저 그리고
  await loadMeta();    // 서버의 최신 기록으로 다시 그린다
  if (currentView === "home") renderHome();
}

// 스테이지를 깬 순간 화면 목록에도 바로 반영 (서버 기록과 같게)
function markCleared(no, stars) {
  if (!META) return;
  const s = META.stages.find((x) => x.no === no);
  if (s) s.stars = Math.max(s.stars || 0, stars);
  const nx = META.stages.find((x) => x.no === no + 1);
  if (nx && ME.id) nx.unlocked = true;
}

// ===== 로그인 상태 =====
async function loadMe() {
  const r = await api("/me");
  ME = r.data && r.data.id ? r.data : { id: null };
  applySkin(ME.skin || "basic");
  const logged = !!ME.id;
  $("btn-login").classList.toggle("hidden", logged);
  $("btn-user").classList.toggle("hidden", !logged);
  $("btn-user").textContent = logged ? ME.nickname : "";
  $("btn-logout").classList.toggle("hidden", !logged);
  renderWallet();
}
function renderWallet(w) {
  if (w) ME.wallet = w;
  const logged = !!ME.id && ME.wallet;
  $("wallet").classList.toggle("hidden", !logged);
  if (!logged) return;
  for (const k of ["coins", "meter", "breaker", "charger"]) {
    const b = $("w-" + k);
    if (b.textContent !== String(ME.wallet[k])) {
      b.textContent = ME.wallet[k];
      b.parentElement.classList.remove("bump");
      void b.parentElement.offsetWidth;
      b.parentElement.classList.add("bump");
    }
  }
  if (G) renderTools();
}

async function loadMeta() {
  const r = await api("/api/stages");
  if (!r.ok) return;
  META = r.data;
  U = META.units;
  BAT = META.batteries;
}

// 손님이면 브라우저에 저장한 별을 합쳐서 본다
function stageInfo() {
  return META.stages.map((s) => {
    if (ME.id) return s;
    const stars = guest.stars[s.no] || 0;
    const unlocked = s.no <= META.guest_max && (s.no === 1 || !!guest.stars[s.no - 1]);
    return Object.assign({}, s, { stars, unlocked, guestLocked: s.no > META.guest_max });
  });
}

// ===== 처음 화면 =====
async function renderHome() {
  if (!META) return;
  const list = stageInfo();
  const stars = list.reduce((a, s) => a + s.stars, 0);
  const cleared = list.filter((s) => s.stars).length;
  const next = list.find((s) => s.unlocked && !s.stars) || null;
  $("mc-stages").innerHTML = "";
  $("mc-stages").append("별 ", el("b", null, `${stars}/${list.length * 3}`), ` · ${cleared}단계 깸`);

  const cont = $("btn-continue");
  if (next) {
    $("cont-kicker").textContent = cleared ? "이어서 하기" : "처음 시작하기";
    $("cont-title").textContent = `스테이지 ${next.no} · ${next.title}`;
    cont.onclick = () => startStage(next.no);
  } else if (!ME.id && cleared >= META.guest_max) {
    $("cont-kicker").textContent = `${META.guest_max}단계를 다 깼어요!`;
    $("cont-title").textContent = "로그인하고 이어서 하기";
    cont.onclick = () => openAuth("signup", "가입하면 지금까지 깬 기록을 그대로 옮겨 드려요.");
  } else {
    $("cont-kicker").textContent = "모든 스테이지를 깼어요";
    $("cont-title").textContent = "타임어택에 도전!";
    cont.onclick = startRush;
  }

  $("guest-strip").classList.toggle("hidden", !!ME.id);
  $("profile").classList.toggle("hidden", !ME.id);
  $("missions").classList.toggle("hidden", !ME.id);
  if (ME.id) {
    const r = await api("/api/home");
    if (r.ok) {
      HOME = r.data;
      renderProfile(r.data.profile);
      renderCheckin(r.data.checkin);
      renderMissions(r.data.missions);
      $("mc-workshop").textContent = r.data.workshop_count ? `퍼즐 ${r.data.workshop_count}개 올라와 있어요` : "첫 퍼즐을 만들어 봐요";
      $("mc-rush").innerHTML = "";
      $("mc-rush").append("내 최고 ", el("b", null, r.data.rush_best + "점"));
      $("mc-daily").textContent = r.data.daily ? `오늘 완료 · 건전지 ${r.data.daily.used}개` : "오늘 아직 안 풀었어요";
      $("mc-practice").textContent = `레벨 1~${META.max_level} 무한 풀기`;
      api("/api/achievements").then((a) => {
        if (!a.ok) return;
        const done = a.data.items.filter((x) => x.done).length;
        $("mc-ach").innerHTML = "";
        $("mc-ach").append(el("b", null, `${done}/${a.data.items.length}`), " 달성");
      });
      renderWallet(r.data.wallet);
    }
  } else {
    $("mc-rush").textContent = "로그인하면 할 수 있어요";
    $("mc-practice").textContent = "로그인하면 할 수 있어요";
    $("mc-ach").textContent = "로그인하면 할 수 있어요";
    $("mc-daily").textContent = "로그인하면 할 수 있어요";
    $("mc-workshop").textContent = "로그인하면 할 수 있어요";
    document.querySelectorAll(".tile-badge").forEach((b) => b.classList.add("hidden"));
  }
}

// ===== 레벨 · 출석 · 오늘의 미션 =====
let HOME = null;
function renderProfile(pf) {
  if (!pf) return;
  $("pf-level").textContent = pf.level;
  $("pf-title").textContent = pf.title;
  $("pf-xp").textContent = `레벨 ${pf.level} · 다음 레벨까지 ${pf.next - pf.xp} XP`;
  $("pf-fill").style.width = ((pf.xp - pf.base) / (pf.next - pf.base)) * 100 + "%";
}
function rewardText(r) {
  const names = { coins: "코인", meter: "전압계", breaker: "차단기", charger: "충전기" };
  return Object.entries(r).map(([k, v]) => `${names[k]} ${v}${k === "coins" ? "" : "개"}`).join(" + ");
}
function renderCheckin(ck) {
  const b = $("btn-checkin");
  b.classList.toggle("done", ck.done);
  $("ck-day").textContent = ck.done ? `${ck.streak}일 연속` : `${ck.day}일째`;
  $("ck-text").textContent = ck.done ? "내일 또 와요" : rewardText(ck.rewards[ck.day - 1]);
  b.disabled = ck.done;
  b.setAttribute("aria-label", ck.done ? `출석 완료, ${ck.streak}일 연속` : `출석 보상 받기: ${rewardText(ck.rewards[ck.day - 1])}`);
}
function renderMissions(m) {
  const done = m.items.filter((i) => i.claimed).length;
  $("ms-sub").textContent = `${done}/3 · 하나에 코인 ${m.reward.coins} + ${m.reward.xp} XP`;
  const ul = $("ms-list");
  ul.innerHTML = "";
  m.items.forEach((it) => {
    const li = el("li", "ms-item" + (it.claimed ? " claimed" : it.cur >= it.goal ? " ready" : ""));
    const tx = el("div", "grow");
    tx.append(el("span", "ms-name", it.name));
    const bar = el("div", "ms-bar");
    const fill = el("div", "ms-fill");
    fill.style.width = (it.cur / it.goal) * 100 + "%";
    bar.append(fill);
    tx.append(bar);
    let btn;
    if (it.claimed) btn = el("span", "ms-done", "완료 ✓");
    else if (it.cur >= it.goal) {
      btn = el("button", "ms-claim", "받기");
      btn.onclick = () => claimMission(it.id);
    } else {
      btn = el("button", "ms-go", `${it.cur}/${it.goal} 하러 가기`);
      btn.onclick = () => goMode(it.go);
    }
    li.append(tx, btn);
    ul.append(li);
  });
  const bonus = $("ms-bonus");
  bonus.classList.toggle("hidden", !m.bonus_ready && !m.bonus_claimed);
  bonus.disabled = !m.bonus_ready;
  bonus.textContent = m.bonus_claimed ? "오늘 미션을 모두 끝냈어요! 내일 또 만나요" : `🎁 3개 다 끝냄! 보너스 받기 (${rewardText({ coins: m.bonus.coins, meter: m.bonus.meter })})`;
  // 아직 안 끝낸 미션이 있는 놀이 카드에 '미션' 표시 → 다른 놀이도 해 보게
  const want = new Set(m.items.filter((i) => !i.claimed && i.cur < i.goal).map((i) => i.go));
  document.querySelectorAll(".tile-badge").forEach((b) => b.classList.toggle("hidden", !want.has(b.dataset.go)));
}
function goMode(go) {
  ({ stages: openStages, rush: startRush, daily: startDaily, practice: openPractice, workshop: openWorkshop }[go] || goHome)();
}
async function claimMission(id) {
  const r = await api("/api/missions/claim", { id });
  if (!r.ok) return toast(r.data.error || "받지 못했어요");
  sfx.coin();
  renderWallet(r.data.wallet);
  renderMissions(r.data.missions);
  if (HOME) HOME.missions = r.data.missions;
  toast(id === "all" ? "보너스를 받았어요! 🎁" : "미션 보상을 받았어요!");
  showXp(r.data.xp);
  announceAchievements(r.data.achievements);
}
async function doCheckin() {
  const r = await api("/api/checkin", {});
  if (!r.ok) return toast(r.data.error || "받지 못했어요");
  sfx.coin();
  confetti();
  renderWallet(r.data.wallet);
  renderCheckin(r.data.checkin);
  toast(`${r.data.streak}일째 출석! ${rewardText(r.data.reward)}`, 3000);
  showXp(r.data.xp);
  announceAchievements(r.data.achievements);
}
// 경험치 받으면 떠오르는 글자, 레벨이 오르면 축하 창
function showXp(xp) {
  if (!xp) return;
  renderProfile(xp);
  floatText(`+${xp.gained} XP`, window.innerWidth / 2, 120, "good");
  if (xp.level_up) {
    setTimeout(() => {
      const box = el("div", "ach-pop lvup");
      box.append(el("span", "lv-big", xp.level));
      const t = el("div");
      t.append(el("small", null, "레벨 업!"), el("b", null, xp.title), el("span", null, `레벨 ${xp.level}이 되었어요`));
      box.append(t);
      document.body.append(box);
      sfx.win();
      confetti();
      setTimeout(() => box.classList.add("out"), 3000);
      setTimeout(() => box.remove(), 3500);
    }, 700);
  }
}

// 결과 창 아래: 다른 놀이 추천 (안 끝낸 미션 먼저)
const MODE_INFO = {
  rush: ["⚡ 타임어택", () => startRush()], daily: ["📅 오늘의 퍼즐", () => startDaily()],
  workshop: ["🔧 퍼즐 공방", () => openWorkshop()], practice: ["🎯 연습", () => openPractice()],
};
function suggest(boxId, current) {
  const box = $(boxId);
  box.innerHTML = "";
  if (!ME.id) return box.classList.add("hidden");
  const want = HOME && HOME.missions ? HOME.missions.items.filter((i) => !i.claimed && i.cur < i.goal).map((i) => i.go) : [];
  const order = [...new Set([...want, "rush", "workshop", "daily", "practice"])].filter((k) => MODE_INFO[k] && k !== current).slice(0, 2);
  box.append(el("span", "rs-label", "이것도 해 볼래요?"));
  order.forEach((k) => {
    const b = el("button", "rs-btn", MODE_INFO[k][0] + (want.includes(k) ? " · 미션" : ""));
    b.onclick = () => { closeModal("result-modal"); closeModal("over-modal"); G = null; MODE_INFO[k][1](); };
    box.append(b);
  });
  box.classList.toggle("hidden", !order.length);
  api("/api/home").then((r) => { if (r.ok) HOME = r.data; });
}

// ===== 퍼즐 공방 =====
let wsSort = "new";
async function openWorkshop() {
  if (needLogin("퍼즐 공방은 로그인하면 쓸 수 있어요.")) return;
  show("workshop");
  document.querySelectorAll("#ws-seg button").forEach((b) => b.classList.toggle("active", b.dataset.sort === wsSort));
  const ul = $("ws-list");
  ul.innerHTML = "";
  const r = await api("/api/workshop?sort=" + wsSort);
  if (!r.ok) return;
  if (!r.data.items.length) {
    ul.append(el("li", "ws-empty", wsSort === "mine" ? "아직 만든 퍼즐이 없어요. [+ 퍼즐 만들기]를 눌러 봐요!" : "아직 올라온 퍼즐이 없어요. 첫 번째로 만들어 봐요!"));
    return;
  }
  r.data.items.forEach((it) => {
    const li = el("li", "ws-item" + (it.cleared ? " cleared" : ""));
    const main = el("button", "ws-main");
    const top = el("div", "ws-top");
    top.append(el("b", null, it.title));
    if (it.cleared) top.append(el("span", "ws-tag ok", "풀었음"));
    if (it.hidden) top.append(el("span", "ws-tag bad", "숨겨짐"));
    const sub = el("div", "ws-sub", `${it.author} · 목표 ${volt(it.target)} · ${it.rows}줄${it.need > 1 ? `(${it.need}줄 필요)` : ""}${it.gadgets ? " · 장치 " + it.gadgets : ""} · 최소 ${it.min}개`);
    const rate = it.plays ? Math.round((it.clears / it.plays) * 100) : 0;
    const meta = el("div", "ws-meta", `도전 ${it.plays} · 성공 ${it.clears}${it.plays ? ` (${rate}%)` : ""}`);
    main.append(top, sub, meta);
    main.onclick = () => startCustom(it.id);
    const side = el("div", "ws-side");
    const like = el("button", "ws-like" + (it.liked ? " on" : ""));
    like.append(icon("i-heart"), el("span", null, String(it.likes)));
    like.disabled = it.mine;
    like.setAttribute("aria-label", `좋아요 ${it.likes}개${it.liked ? ", 눌렀음" : ""}`);
    like.onclick = async () => {
      const x = await api(`/api/workshop/${it.id}/like`, {});
      if (!x.ok) return toast(x.data.error || "누르지 못했어요");
      it.liked = x.data.liked; it.likes = x.data.likes;
      like.classList.toggle("on", it.liked);
      like.lastChild.textContent = String(it.likes);
      if (it.liked) sfx.pick();
    };
    side.append(like);
    const more = el("button", "ws-more", it.mine ? "삭제" : "신고");
    more.onclick = async () => {
      if (it.mine) {
        if (!confirm(`'${it.title}' 퍼즐을 지울까요?`)) return;
        await api(`/api/workshop/${it.id}`, undefined, "DELETE");
        toast("지웠어요");
      } else {
        if (!confirm("이상한 퍼즐인가요? 여러 명이 신고하면 숨겨져요.")) return;
        await api(`/api/workshop/${it.id}/report`, {});
        toast("신고했어요. 고마워요");
      }
      openWorkshop();
    };
    side.append(more);
    li.append(main, side);
    ul.append(li);
  });
}
async function startCustom(id) {
  const r = await api("/api/play/custom", { id });
  if (!r.ok) return toast(r.data.error || "시작하지 못했어요");
  setupGame("custom", r.data);
  G.author = r.data.author;
  G.customId = id;
  renderGame();
  if (r.data.mine) toast("내가 만든 퍼즐이에요. 풀어도 기록에는 안 남아요");
}

// ----- 퍼즐 만들기 -----
let MK = null;
function newMaker() {
  MK = { rows: [3, 3], need: 2, target: 9, tray: { a: 4, c: 2, l: 0, n: 0 }, cells: {} };
}
function openMaker() {
  if (needLogin("퍼즐 만들기는 로그인하면 할 수 있어요.")) return;
  newMaker();
  $("mk-title").value = "";
  show("maker");
  renderMaker();
}
function mkSpec() {
  const cells = Object.entries(MK.cells).filter(([, v]) => v !== "normal").map(([k, v]) => {
    const [r, s] = k.split("-").map(Number);
    return [r, s, v];
  }).filter(([r, s]) => r < MK.rows.length && s < MK.rows[r]);
  return { rows: MK.rows, need: MK.need, target: MK.target, tray: MK.tray, cells };
}
let mkTimer = null;
function renderMaker() {
  document.querySelectorAll("#mk-rows button").forEach((b) => b.classList.toggle("active", Number(b.dataset.n) === MK.rows.length));
  const need = $("mk-need");
  need.innerHTML = "";
  for (let n = 1; n <= MK.rows.length; n++) {
    const b = el("button", n === MK.need ? "active" : "", String(n));
    b.onclick = () => { MK.need = n; renderMaker(); };
    need.append(b);
  }
  $("mk-target").textContent = volt(MK.target);
  const tray = $("mk-tray");
  tray.innerHTML = "";
  ORDER.forEach((t) => {
    const box = el("div", "mk-bat");
    box.append(battEl(t, 1));
    const ctl = el("div", "mk-cnt");
    const minus = el("button", null, "−");
    const plus = el("button", null, "+");
    minus.setAttribute("aria-label", `${BAT[t].name} 줄이기`);
    plus.setAttribute("aria-label", `${BAT[t].name} 늘리기`);
    minus.onclick = () => { MK.tray[t] = Math.max(0, MK.tray[t] - 1); renderMaker(); };
    plus.onclick = () => { MK.tray[t] = Math.min(9, MK.tray[t] + 1); renderMaker(); };
    ctl.append(minus, el("b", null, MK.tray[t]), plus);
    box.append(ctl);
    tray.append(box);
  });
  const c = $("mk-circuit");
  c.innerHTML = "";
  MK.rows.forEach((cap, r) => {
    const row = el("div", "crow");
    row.append(el("span", "crow-label", `${r + 1}줄`));
    const slots = el("div", "slots");
    for (let s = 0; s < cap; s++) {
      const kind = MK.cells[`${r}-${s}`] || "normal";
      const b = el("button", "slot empty mk-slot k-" + kind);
      b.type = "button";
      b.dataset.r = r;
      b.dataset.s = s;
      b.textContent = { normal: "", blocked: "⚡", plus: "＋", minus: "−" }[kind];
      b.setAttribute("aria-label", `${r + 1}줄 ${s + 1}번 칸: ${{ normal: "보통", blocked: "누전", plus: "＋칸", minus: "−칸" }[kind]}`);
      b.onclick = () => {
        const order = ["normal", "blocked", "plus", "minus"];
        MK.cells[`${r}-${s}`] = order[(order.indexOf(kind) + 1) % 4];
        sfx.pick();
        renderMaker();
      };
      slots.append(b);
    }
    const ctl = el("div", "mk-cap");
    const m = el("button", null, "−");
    const pl = el("button", null, "+");
    m.setAttribute("aria-label", `${r + 1}줄 칸 줄이기`);
    pl.setAttribute("aria-label", `${r + 1}줄 칸 늘리기`);
    m.onclick = () => { MK.rows[r] = Math.max(2, cap - 1); renderMaker(); };
    pl.onclick = () => { MK.rows[r] = Math.min(4, cap + 1); renderMaker(); };
    ctl.append(m, pl);
    row.append(slots, ctl);
    c.append(row);
  });
  // 서버에 풀 수 있는지 물어본다 (조금 기다렸다가)
  $("mk-publish").disabled = true;
  $("mk-status").className = "mk-status";
  $("mk-status").textContent = "검사하는 중…";
  clearTimeout(mkTimer);
  mkTimer = setTimeout(async () => {
    const r = await api("/api/workshop/check", mkSpec());
    if (!MK) return;
    $("mk-status").className = "mk-status " + (r.data.ok ? "ok" : "bad");
    $("mk-status").textContent = r.data.ok
      ? `✓ 풀 수 있어요! 가장 적게 쓰면 건전지 ${r.data.min}개예요.`
      : "✗ " + (r.data.error || "검사하지 못했어요");
    $("mk-publish").disabled = !r.data.ok;
  }, 250);
}
async function publishMaker() {
  const title = $("mk-title").value.trim();
  if (!title) { toast("퍼즐 이름을 적어 주세요"); return $("mk-title").focus(); }
  const r = await api("/api/workshop", Object.assign(mkSpec(), { title }));
  if (!r.ok) return toast(r.data.error || "올리지 못했어요");
  sfx.win();
  confetti();
  toast("공방에 올렸어요! 다른 사람들이 풀 수 있어요");
  showXp(r.data.xp);
  announceAchievements(r.data.achievements);
  MK = null;
  wsSort = "mine";
  openWorkshop();
}


// ===== 스테이지 목록 =====
function renderStages() {
  const list = stageInfo();
  const stars = list.reduce((a, s) => a + s.stars, 0);
  $("stage-summary").textContent = ME.id
    ? `별 ${stars} / ${list.length * 3}개 모았어요.`
    : `로그인 안 해도 ${META.guest_max}단계까지 할 수 있어요. 별 ${stars}개`;
  const box = $("chapter-list");
  box.innerHTML = "";
  const next = list.find((s) => s.unlocked && !s.stars);
  META.chapters.forEach((ch) => {
    const stages = list.filter((s) => s.chapter === ch.no);
    const got = stages.reduce((a, s) => a + s.stars, 0);
    const sec = el("div", "chapter");
    const head = el("div", "chapter-head");
    head.append(el("h3", null, `${ch.no}장 · ${ch.name}`), el("span", null, `★ ${got}/${stages.length * 3}`));
    sec.append(head, el("p", "chapter-desc", ch.desc));
    const grid = el("div", "stage-grid");
    stages.forEach((s) => {
      const b = el("button", "stage-btn");
      const locked = !s.unlocked;
      if (locked) b.classList.add("locked");
      if (next && s.no === next.no) b.classList.add("next");
      b.append(el("span", "sb-no", s.no));
      if (locked) b.append(icon("i-lock", "sb-lock"));
      b.append(el("span", "sb-v", `${volt(s.target)}${s.need > 1 ? ` ×${s.need}줄` : ""}`));
      const st = el("span", "sb-stars");
      for (let i = 1; i <= 3; i++) st.append(icon("i-star", i <= s.stars ? "on" : ""));
      b.append(st);
      b.setAttribute("aria-label", `스테이지 ${s.no} ${s.title}, 목표 ${volt(s.target)}, 별 ${s.stars}개${locked ? ", 잠김" : ""}`);
      b.onclick = () => {
        if (s.guestLocked) return openAuth("signup", `${META.guest_max + 1}단계부터는 로그인해야 해요. 가입하면 지금까지 기록을 옮겨 드려요.`);
        if (locked) { toast("앞 스테이지를 먼저 깨 주세요"); sfx.bad(); return; }
        startStage(s.no);
      };
      grid.append(b);
    });
    sec.append(grid);
    box.append(sec);
  });
}

// ===== 판 시작 =====
async function startStage(no) {
  const r = await api("/api/play/stage", { no });
  if (!r.ok) {
    if (r.data.login) return openAuth("signup", r.data.error);
    return toast(r.data.error || "시작하지 못했어요");
  }
  setupGame("stage", r.data);
}
async function startDaily() {
  if (!ME.id) return openAuth("login", "오늘의 퍼즐은 모두가 같은 문제를 풀고 순위를 겨뤄요. 로그인해 주세요.");
  const r = await api("/api/play/daily", {});
  if (!r.ok) return toast(r.data.error || "시작하지 못했어요");
  setupGame("daily", r.data);
  if (r.data.best) toast(`오늘 이미 풀었어요 (건전지 ${r.data.best.used}개 · ${r.data.best.secs}초). 기록을 줄여 볼까요?`, 3500);
}
async function startRush() {
  if (!ME.id) return openAuth("login", "타임어택 점수는 랭킹에 올라가요. 로그인해 주세요.");
  const r = await api("/api/rush/start", {});
  if (!r.ok) return toast(r.data.error || "시작하지 못했어요");
  closeModal("over-modal");
  setupGame("rush", r.data);
  toast("전력이 닳기 전에 회로를 완성해요!", 2000);
}

function setupGame(kind, data) {
  G = {
    kind, token: data.token, pz: data.puzzle, board: null, unblocked: [], sel: null,
    breaker: false, hint: null, busy: false, done: false, t0: Date.now(), ending: false,
  };
  resetBoard();
  if (kind === "rush") syncRush(data);
  show("game");
  renderGame();
  if (kind === "rush") startRushClock();
  else startClock();
}

// 고정 건전지·방향 칸 찾기
const fixedAt = (r, s) => (G.pz.fixed || []).find((f) => f[0] === r && f[1] === s);
const diodeAt = (r, s) => { const d = (G.pz.diode || []).find((x) => x[0] === r && x[1] === s); return d ? d[2] : 0; };
function emptyBoard() {
  return G.pz.rows.map((cap, r) => Array.from({ length: cap }, (_, s) => {
    const f = fixedAt(r, s);
    return f ? { t: f[2], s: f[3], fixed: true } : null;
  }));
}
function resetBoard() {
  G.board = emptyBoard();
  G.unblocked = [];
  G.sel = null;
  G.hint = null;
  G.breaker = false;
}

// ===== 규칙 (화면 미리보기용, 서버와 같은 계산) =====
function isBlocked(r, s) {
  return G.pz.blocked.some((b) => b[0] === r && b[1] === s) && !G.unblocked.some((b) => b[0] === r && b[1] === s);
}
function usedCount(t) {
  let n = 0;
  G.board.forEach((row) => row.forEach((c) => { if (c && !c.fixed && c.t === t) n++; }));
  return n;
}
const left = (t) => (G.pz.tray[t] || 0) - usedCount(t);

function evaluate() {
  const pz = G.pz;
  const rows = G.board.map((cells) => {
    const items = cells.filter(Boolean);
    return { v: items.reduce((a, c) => a + U[c.t] * c.s, 0), n: items.length };
  });
  const filled = rows.filter((r) => r.n);
  const used = G.board.reduce((a, row) => a + row.filter((c) => c && !c.fixed).length, 0);
  let status, out = null;
  if (!filled.length) status = "empty";
  else if (new Set(filled.map((r) => r.v)).size > 1) status = "mismatch";
  else {
    out = filled[0].v;
    if (out <= 0) status = "reverse";
    else if (out > pz.target) status = "over";
    else if (out < pz.target) status = "under";
    else if (filled.length < pz.need) status = "need";
    else status = "win";
  }
  return { rows, filled: filled.length, used, out, status };
}

// ===== 게임판 그리기 =====
function renderGame() {
  const pz = G.pz;
  const kicker = { stage: `${pz.chapter}장 · 스테이지 ${pz.no}`, daily: "오늘의 퍼즐", rush: "타임어택",
    practice: `연습 · 레벨 ${G.level || ""} · 푼 문제 ${G.solved || 0}`,
    custom: `퍼즐 공방 · 만든 사람 ${G.author || ""}` }[G.kind];
  $("g-kicker").textContent = kicker;
  $("g-title").textContent = pz.title;
  $("g-target").textContent = volt(pz.target);
  $("rush-hud").classList.toggle("hidden", G.kind !== "rush");
  $("g-clock").classList.toggle("hidden", G.kind === "rush");
  $("g-tip").classList.toggle("hidden", !pz.tip);
  $("g-tip").textContent = pz.tip || "";
  $("g-goal").innerHTML = "";
  $("g-goal").append(icon("i-star"), icon("i-star"), icon("i-star"),
    ` 건전지 ${pz.min}개로 풀면 별 3개 · ${pz.min + 2}개까지 별 2개`);
  renderCircuit();
  renderTray();
  renderTools();
  renderStatus();
}

function renderCircuit() {
  const box = $("circuit");
  box.innerHTML = "";
  const many = G.pz.rows.length > 1;
  G.pz.rows.forEach((cap, r) => {
    const row = el("div", "crow");
    row.dataset.r = r;
    row.append(el("span", "crow-label", many ? `${r + 1}줄` : "직렬"));
    const slots = el("div", "slots");
    for (let s = 0; s < cap; s++) slots.append(slotEl(r, s));
    row.append(slots, el("span", "crow-v", "—"));
    box.append(row);
  });
  $("board").classList.toggle("picking", !!G.sel);
  $("board").classList.toggle("breaking", G.breaker);
}

function battEl(t, s) {
  const b = el("span", `batt t-${t}${s < 0 ? " neg" : ""}`);
  const body = el("span", "b-body");
  body.append(el("b", null, (s < 0 ? "−" : "") + volt(U[t])), el("small", null, BAT[t] ? BAT[t].name : t));
  b.append(body, el("span", "b-cap"), el("span", "b-sign", s < 0 ? "−" : "+"));
  return b;
}

function slotEl(r, s) {
  const b = el("button", "slot");
  b.type = "button";
  b.dataset.r = r;
  b.dataset.s = s;
  const c = G.board[r][s];
  const hinted = G.hint && G.hint.row === r && G.hint.slot === s;
  if (hinted) b.classList.add("hint");
  if (isBlocked(r, s)) {
    b.classList.add("blocked");
    b.append(icon("i-bolt"));
    b.setAttribute("aria-label", `${r + 1}줄 ${s + 1}번 칸, 누전됨`);
  } else if (c && c.fixed) {
    b.classList.add("filled", "locked-batt");
    b.append(battEl(c.t, c.s));
    const lk = el("span", "lock-tag");
    lk.append(icon("i-padlock"));
    b.append(lk);
    b.setAttribute("aria-label", `${r + 1}줄 ${s + 1}번 칸, 고정 건전지 ${BAT[c.t].name} ${volt(U[c.t] * c.s)}. 뺄 수 없음`);
  } else if (c) {
    b.classList.add("filled");
    if (G.flipped === `${r}-${s}`) b.classList.add("flipped");
    b.append(battEl(c.t, c.s));
    const x = el("span", "x");
    x.append(icon("i-x"));
    x.setAttribute("role", "button");
    x.setAttribute("aria-label", "빼기");
    x.onclick = (e) => { e.stopPropagation(); removeAt(r, s); };
    b.append(x);
    const d = diodeAt(r, s);
    b.setAttribute("aria-label", `${r + 1}줄 ${s + 1}번 칸, ${BAT[c.t].name} ${c.s < 0 ? "뒤집힘" : ""} ${volt(U[c.t] * c.s)}. ${d ? "방향 고정 칸" : "누르면 뒤집기"}`);
  } else {
    b.classList.add("empty");
    if (G.pz.blocked.some((x) => x[0] === r && x[1] === s)) b.classList.add("fixed");
    b.setAttribute("aria-label", `${r + 1}줄 ${s + 1}번 빈 칸`);
  }
  const d = diodeAt(r, s);
  if (d && !isBlocked(r, s)) {
    b.classList.add(d > 0 ? "dio-plus" : "dio-minus");
    b.append(el("span", "dio-tag", d > 0 ? "＋" : "−"));
    if (!c) b.setAttribute("aria-label", `${r + 1}줄 ${s + 1}번 빈 칸, ${d > 0 ? "바로" : "뒤집혀서"}만 놓이는 칸`);
  }
  b.onclick = () => onSlot(r, s);
  return b;
}

function renderTray() {
  const box = $("tray");
  box.innerHTML = "";
  let key = 0;
  ORDER.forEach((t) => {
    const total = G.pz.tray[t] || 0;
    if (!total) return;
    key++;
    const n = left(t);
    const b = el("button", "tray-item" + (G.sel === t ? " sel" : "") + (n <= 0 ? " empty" : ""));
    b.type = "button";
    b.dataset.t = t;
    b.append(battEl(t, 1), el("span", "cnt", n), el("span", "key", `${key}번 키`));
    b.setAttribute("aria-pressed", G.sel === t ? "true" : "false");
    b.setAttribute("aria-label", `${BAT[t].name} ${volt(U[t])}, ${n}개 남음`);
    b.onclick = () => { if (dragJustEnded) return; selectType(t); };
    bindDrag(b, t);
    box.append(b);
  });
  setCharge();
}

function renderTools() {
  if (!G) return;
  const w = ME.wallet || {};
  const logged = !!ME.id;
  $("b-meter").textContent = logged ? w.meter : "";
  $("b-breaker").textContent = logged ? w.breaker : "";
  $("b-charger").textContent = logged ? w.charger : "";
  const hasBlocked = G.pz.blocked.some((b) => isBlocked(b[0], b[1]));
  $("t-breaker").classList.toggle("hidden", !hasBlocked && !G.breaker);
  $("t-breaker").classList.toggle("on", G.breaker);
  $("t-charger").classList.toggle("hidden", G.kind !== "rush");
  $("t-skip").classList.toggle("hidden", G.kind !== "rush" && G.kind !== "practice");
  $("t-skip").querySelector("span").textContent = G.kind === "practice" ? "다른 문제" : "건너뛰기 −12초";
}

const MSG = {
  empty: () => "건전지를 골라 빈 칸에 놓아 보세요",
  under: (e) => `${volt(G.pz.target - e.out)} 모자라요`,
  over: (e) => `${volt(e.out - G.pz.target)} 넘쳐요! 전구가 견디지 못해요`,
  reverse: () => "전류가 거꾸로 흘러요. 건전지 방향을 바꿔 봐요",
  mismatch: () => "줄마다 전압이 달라요! 병렬은 전압이 같아야 해요",
  need: (e) => `전압은 맞아요! ${volt(G.pz.target)}짜리 줄이 ${G.pz.need - e.filled}개 더 필요해요`,
  win: () => "불이 켜졌어요!",
};

function renderStatus() {
  const e = evaluate();
  const pz = G.pz;
  // 줄마다 전압
  document.querySelectorAll("#circuit .crow").forEach((row, r) => {
    const info = e.rows[r];
    const v = row.querySelector(".crow-v");
    v.textContent = info.n ? volt(info.v) : "—";
    row.classList.toggle("hit", info.n > 0 && info.v === pz.target);
    row.classList.toggle("bad", info.n > 0 && (e.status === "mismatch" || info.v > pz.target || info.v <= 0));
    row.classList.toggle("live", e.status === "win" && info.n > 0);
    row.classList.toggle("off-row", !info.n);
  });
  $("circuit").classList.toggle("live", e.status === "win");
  // 필요한 줄 표시
  const need = $("g-need");
  need.innerHTML = "";
  if (pz.need > 1 || pz.rows.length > 1) {
    const hits = e.rows.filter((r) => r.n && r.v === pz.target).length;
    need.append(document.createTextNode(`필요한 줄 ${pz.need}개 `));
    for (let i = 0; i < pz.need; i++) {
      const dot = el("i");
      if (i < Math.min(hits, pz.need) && e.status !== "mismatch") dot.classList.add("on");
      need.append(dot);
    }
  } else {
    need.textContent = "건전지를 한 줄로 이어요";
  }
  // 전구 밝기
  const bulb = $("bulb");
  let lit = 0;
  if (e.status === "win") lit = 1;
  else if (e.status === "need") lit = 0.45 + 0.4 * (e.filled / pz.need);
  else if (e.status === "under") lit = Math.max(0.08, (e.out / pz.target) * 0.55);
  else if (e.status === "over") lit = 0.9;
  bulb.style.setProperty("--lit", lit.toFixed(2));
  bulb.classList.toggle("win", e.status === "win");
  bulb.classList.toggle("over", e.status === "over");
  bulb.classList.toggle("spark", e.status === "mismatch" || e.status === "reverse");
  // 계기판
  const m = $("meter");
  $("meter-out").textContent = e.out == null ? (e.status === "mismatch" ? "⚠" : "0V") : volt(e.out);
  $("meter-msg").textContent = MSG[e.status](e);
  m.classList.toggle("win", e.status === "win");
  m.classList.toggle("bad", ["over", "reverse", "mismatch"].includes(e.status));
  return e;
}

// ===== 놓기 · 뒤집기 · 빼기 =====
function selectType(t) {
  if (!G || G.done || G.busy) return;
  if (left(t) <= 0) { toast(`${BAT[t].name} 건전지를 다 썼어요`); sfx.bad(); return; }
  G.breaker = false;
  G.sel = G.sel === t ? null : t;
  sfx.pick();
  renderTray();
  renderTools();
  $("board").classList.toggle("picking", !!G.sel);
  $("board").classList.remove("breaking");
}

function shakeSlot(r, s) {
  const b = document.querySelector(`.slot[data-r="${r}"][data-s="${s}"]`);
  if (!b) return;
  b.classList.remove("shake");
  void b.offsetWidth;
  b.classList.add("shake");
}

function onSlot(r, s) {
  if (!G || G.done || G.busy) return;
  if (G.breaker) {
    if (isBlocked(r, s)) return useBreaker(r, s);
    toast("번개 표시가 있는 칸을 눌러 주세요");
    return;
  }
  if (isBlocked(r, s)) {
    shakeSlot(r, s);
    sfx.bad();
    toast(ME.id && ME.wallet && ME.wallet.breaker ? "누전된 칸이에요. 차단기로 고칠 수 있어요" : "누전된 칸이라 쓸 수 없어요");
    return;
  }
  const c = G.board[r][s];
  if (c && c.fixed) {
    shakeSlot(r, s);
    sfx.bad();
    toast("자물쇠 건전지는 빼거나 뒤집을 수 없어요");
    return;
  }
  if (!c) {
    if (!G.sel) {
      const avail = ORDER.filter((t) => left(t) > 0);
      if (avail.length === 1) G.sel = avail[0];      // 한 종류뿐이면 알아서 고른다
      else { toast("아래에서 건전지를 먼저 골라요"); pulseTray(); return; }
    }
    return placeAt(r, s, G.sel);
  }
  if (G.sel && G.sel !== c.t && left(G.sel) > 0) return placeAt(r, s, G.sel); // 다른 걸로 바꾸기
  if (diodeAt(r, s)) {
    shakeSlot(r, s);
    toast(diodeAt(r, s) > 0 ? "＋칸은 바로만 놓여요 (뒤집을 수 없어요)" : "−칸은 뒤집힌 채로만 놓여요");
    return;
  }
  // 뒤집기
  c.s = -c.s;
  G.flipped = `${r}-${s}`;
  sfx.flip();
  afterChange();
}

function placeAt(r, s, t) {
  if (left(t) <= 0) return;
  // 전압계가 알려 준 칸이면 알려 준 방향으로 놓는다
  let sign = 1;
  if (G.hint && G.hint.action === "place" && G.hint.row === r && G.hint.slot === s && G.hint.t === t) sign = G.hint.s;
  if (diodeAt(r, s)) sign = diodeAt(r, s);    // 방향 칸은 정해진 방향으로
  G.board[r][s] = { t, s: sign };
  G.flipped = null;
  if (left(t) <= 0) G.sel = null;
  sfx.place();
  vibe(8);
  afterChange();
}
function removeAt(r, s) {
  if (!G || G.done || G.busy || !G.board[r][s] || G.board[r][s].fixed) return;
  G.board[r][s] = null;
  sfx.remove();
  afterChange();
}
function pulseTray() {
  const t = $("tray");
  t.classList.remove("shake");
  void t.offsetWidth;
  t.querySelectorAll(".tray-item:not(.empty)").forEach((x) => x.animate && x.animate(
    [{ transform: "translateY(0)" }, { transform: "translateY(-6px)" }, { transform: "translateY(0)" }],
    { duration: 300 }));
}

function afterChange() {
  // 전압계 힌트가 해결됐으면 지운다
  if (G.hint) {
    const h = G.hint;
    const c = G.board[h.row] && G.board[h.row][h.slot];
    if ((h.action === "place" && c) || (h.action === "remove" && !c) || h.action === "flip") G.hint = null;
  }
  renderCircuit();
  renderTray();
  renderTools();
  const e = renderStatus();
  if (e.status === "win") submit();
  else if (e.status === "over" || e.status === "mismatch") vibe([20, 40, 20]);
}

// ----- 끌어다 놓기 -----
let dragJustEnded = false;
function bindDrag(node, t) {
  node.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !G || G.done || G.busy || left(t) <= 0) return;
    const sx = e.clientX, sy = e.clientY;
    let ghost = null, over = null;
    const move = (ev) => {
      if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) {
        ghost = el("div", "ghost-batt");
        ghost.append(battEl(t, 1));
        document.body.append(ghost);
        G.sel = t;
        renderTray();
      }
      if (!ghost) return;
      ghost.style.transform = `translate(${ev.clientX - 33}px, ${ev.clientY - 26}px)`;
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      const slot = hit && hit.closest(".slot");
      if (over && over !== slot) over.classList.remove("drop");
      over = slot;
      if (slot) slot.classList.add("drop");
    };
    const up = (ev) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!ghost) return;
      ghost.remove();
      if (over) over.classList.remove("drop");
      dragJustEnded = true;
      setTimeout(() => { dragJustEnded = false; }, 50);
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      const slot = hit && hit.closest(".slot");
      if (slot) {
        const r = +slot.dataset.r, s = +slot.dataset.s;
        if (isBlocked(r, s) || (G.board[r][s] && G.board[r][s].fixed)) { shakeSlot(r, s); sfx.bad(); return; }
        placeAt(r, s, t);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  });
}

// ===== 정답 내기 =====
const boardData = () => G.board.map((row) => row.map((c) => (c ? { t: c.t, s: c.s } : null)));

async function submit() {
  if (G.busy || G.done) return;
  G.busy = true;
  const token = G.token;
  const r = await api(`/api/play/${token}/submit`, { board: boardData() });
  if (!G || G.token !== token) return;
  if (r.data.over) return rushOver(r.data.result);
  if (!r.ok) {
    G.busy = false;
    toast(r.data.error || "확인하지 못했어요");
    if (r.status === 404 || r.status === 409) goHome();
    return;
  }
  if (!r.data.win) { G.busy = false; toast(MSG[r.data.status] ? "아직 아니에요" : "다시 확인해 봐요"); return; }

  sfx.win();
  vibe([30, 60, 30]);
  $("board").classList.remove("won");
  void $("board").offsetWidth;
  $("board").classList.add("won");
  announceAchievements(r.data.achievements);
  showXp(r.data.xp);

  if (G.kind === "practice") {
    const d = r.data;
    const stars = "★".repeat(d.stars) + "☆".repeat(3 - d.stars);
    floatAt($("bulb"), stars, "");
    toast(`${stars}  건전지 ${d.used}개 (가장 적게 ${d.min}개) · ${d.secs}초`, 1800);
    if (d.wallet) renderWallet(d.wallet);
    setTimeout(() => {
      if (!G || G.token !== token) return;
      G.pz = d.puzzle;
      G.solved = d.solved;
      G.t0 = Date.now();
      resetBoard();
      G.busy = false;
      renderGame();
    }, 900);
    return;
  }

  if (G.kind === "rush") {
    const d = r.data;
    floatAt($("energy"), `+${d.gain}점`, "");
    setTimeout(() => floatAt($("energy"), `+${d.refill}초`, "good"), 250);
    if (d.level_up) setTimeout(() => floatAt($("rush-level"), `레벨 ${d.level}!`, ""), 500);
    const parts = [`기본 ${d.parts.base}`];
    if (d.parts.efficiency) parts.push(`알뜰 +${d.parts.efficiency}`);
    if (d.parts.speed) parts.push(`빠름 +${d.parts.speed}`);
    toast(parts.join(" · "), 1600);
    setTimeout(() => {
      if (!G || G.token !== token) return;
      G.pz = d.puzzle;
      resetBoard();
      syncRush(d);
      G.busy = false;
      renderGame();
    }, 650);
    return;
  }
  G.done = true;
  stopClock();
  if (G.kind === "stage") markCleared(G.pz.no, r.data.stars);
  if (G.kind === "stage" && r.data.guest_proof) {
    const no = G.pz.no;
    guest.stars[no] = Math.max(guest.stars[no] || 0, r.data.stars);
    guest.tokens[no] = r.data.guest_proof;
    saveGuest();
  }
  if (r.data.wallet) renderWallet(r.data.wallet);
  setTimeout(() => showResult(r.data), 750);
}

function line(label, value, cls) {
  const d = el("div");
  const b = el("b", cls, value);
  d.append(el("span", null, label), b);
  return d;
}

function showResult(d) {
  const lines = $("r-lines");
  lines.innerHTML = "";
  const stars = $("r-stars");
  stars.innerHTML = "";
  for (let i = 1; i <= 3; i++) stars.append(icon("i-star", i <= d.stars ? "on" : ""));
  stars.setAttribute("aria-label", `별 ${d.stars}개`);
  $("r-title").textContent = d.stars === 3 ? "완벽해요!" : "불이 켜졌어요!";
  lines.append(line("쓴 건전지", `${d.used}개 (가장 적게: ${d.min}개)`));
  lines.append(line("걸린 시간", `${d.secs}초`));
  if (d.coins) lines.append(line("받은 코인", `+${d.coins}`, "coin"));
  const extra = $("r-extra");
  extra.textContent = "";
  if (d.stars < 3) extra.textContent = `건전지 ${d.min}개로도 풀 수 있어요. 다시 해 볼까요?`;

  const next = $("r-next");
  suggest("r-suggest", G.kind === "custom" ? "workshop" : G.kind);
  if (G.kind === "custom") {
    const cid = G.customId;
    $("r-title").textContent = d.first ? "공방 퍼즐 클리어!" : "또 풀었어요!";
    if (d.first) lines.append(line("처음 풀었어요", "좋아요로 응원해 줘요"));
    next.textContent = "다른 공방 퍼즐";
    next.onclick = () => { closeModal("result-modal"); openWorkshop(); };
    $("r-list").textContent = "처음으로";
    $("r-list").onclick = () => { closeModal("result-modal"); goHome(); };
    $("r-retry").onclick = () => { closeModal("result-modal"); startCustom(cid); };
  } else if (G.kind === "daily") {
    if (d.rank) lines.append(line("오늘 순위", `${d.rank.total}명 중 ${d.rank.rank}등`));
    $("r-title").textContent = "오늘의 퍼즐 완료!";
    next.textContent = "오늘 순위 보기";
    next.onclick = () => { closeModal("result-modal"); openRank("daily"); };
    $("r-list").textContent = "처음으로";
    $("r-list").onclick = () => { closeModal("result-modal"); goHome(); };
    $("r-retry").onclick = () => { closeModal("result-modal"); startDaily(); };
  } else {
    const no = G.pz.no;
    $("r-list").textContent = "목록";
    $("r-list").onclick = () => { closeModal("result-modal"); openStages(); };
    $("r-retry").onclick = () => { closeModal("result-modal"); startStage(no); };
    if (!d.next) {
      next.textContent = "타임어택 도전";
      next.onclick = () => { closeModal("result-modal"); startRush(); };
      extra.textContent = "모든 스테이지를 깼어요! 🎉";
      confetti();
    } else if (!ME.id && d.next > META.guest_max) {
      next.textContent = "가입하고 계속하기";
      next.onclick = () => { closeModal("result-modal"); openAuth("signup", "가입하면 지금까지 깬 기록을 그대로 옮겨 드려요."); };
    } else {
      next.textContent = `다음 스테이지 ${d.next}`;
      next.onclick = () => { closeModal("result-modal"); startStage(d.next); };
    }
    if (d.first && d.stars === 3) confetti();
  }
  if (d.coins) setTimeout(sfx.coin, 500);
  openModal("result-modal");
  setTimeout(() => next.focus(), 50);
}

// ===== 걸린 시간 (스테이지·오늘의 퍼즐) =====
let clockTimer = null;
function startClock() {
  stopClock();
  const tick = () => {
    if (!G) return;
    const s = Math.floor((Date.now() - G.t0) / 1000);
    $("g-clock").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  tick();
  clockTimer = setInterval(tick, 500);
}
function stopClock() { clearInterval(clockTimer); clockTimer = null; }

// ===== 타임어택: 전력이 닳는다 =====
let rushTimer = null;
let lastTickSec = null;
function syncRush(d) {
  G.rush = { deadline: performance.now() / 1000 + d.left, max: d.max, score: d.score, solved: d.solved, level: d.level };
  $("rush-score").textContent = d.score;
  $("rush-solved").textContent = d.solved;
  $("rush-level").textContent = d.level;
  $("energy").setAttribute("aria-valuemax", d.max);
}
const rushLeft = () => (G && G.rush ? Math.max(0, G.rush.deadline - performance.now() / 1000) : 0);
function setCharge() {
  // 타임어택에서는 건전지 그림도 남은 전력만큼만 채워져 보인다
  const c = G && G.kind === "rush" && G.rush ? Math.max(0.05, rushLeft() / 60) : 1;
  document.querySelectorAll("#view-game .batt").forEach((b) => b.style.setProperty("--charge", Math.min(1, c).toFixed(3)));
}
function startRushClock() {
  stopRushClock();
  lastTickSec = null;
  rushTimer = setInterval(() => {
    if (!G || G.kind !== "rush" || G.ending) return;
    const l = rushLeft();
    const pct = Math.min(100, (l / G.rush.max) * 100);
    $("energy-fill").style.width = `calc(${pct}% - 4px)`;
    $("energy-text").textContent = `${l.toFixed(1)}초`;
    $("energy").setAttribute("aria-valuenow", Math.round(l));
    $("energy").classList.toggle("mid", l <= 25 && l > 10);
    $("energy").classList.toggle("low", l <= 10);
    const sec = Math.ceil(l);
    if (l <= 10 && sec !== lastTickSec && sec > 0) { sfx.tick(); lastTickSec = sec; }
    setCharge();
    if (l <= 0) endRush();
  }, 100);
}
function stopRushClock() { clearInterval(rushTimer); rushTimer = null; }

async function endRush() {
  if (!G || G.ending) return;
  G.ending = true;
  stopRushClock();
  const r = await api(`/api/play/${G.token}/finish`, {});
  if (r.data.result) rushOver(r.data.result);
  else if (r.status === 409) goHome();
}

function rushOver(res) {
  announceAchievements(res.achievements);
  showXp(res.xp);
  setTimeout(() => suggest("o-suggest", "rush"), 50);
  stopRushClock();
  if (G) { G.done = true; G.ending = true; }
  sfx.over();
  vibe([60, 40, 60]);
  $("o-score").textContent = res.score;
  const lines = $("o-lines");
  lines.innerHTML = "";
  lines.append(line("푼 회로", `${res.solved}개`));
  lines.append(line("내 최고 점수", `${res.best}점`));
  if (res.coins) lines.append(line("받은 코인", `+${res.coins}`, "coin"));
  $("o-title").textContent = res.new_best ? "새 최고 기록!" : "전력이 다 닳았어요";
  if (res.new_best) confetti();
  api("/me").then((r) => { if (r.data.wallet) renderWallet(r.data.wallet); });
  openModal("over-modal");
  setTimeout(() => $("o-again").focus(), 50);
}

// ===== 아이템 =====
function needLogin(why) {
  if (ME.id) return false;
  openAuth("login", why);
  return true;
}
function noItem(r) {
  toast(r.data.error || "쓸 수 없어요");
  if (r.data.shop) setTimeout(() => openShop(), 600);
}

async function useMeter() {
  if (!G || G.done || G.busy) return;
  if (needLogin("아이템은 로그인하면 쓸 수 있어요. 처음에 몇 개 드려요!")) return;
  const r = await api(`/api/play/${G.token}/item`, { item: "meter", board: boardData() });
  if (r.data.over) return rushOver(r.data.result);
  if (!r.ok) return noItem(r);
  sfx.item();
  renderWallet(r.data.wallet);
  if (r.data.left != null) syncRush(r.data);
  const h = r.data.hint;
  G.hint = h;
  if (h.action === "place") {
    G.sel = h.t;
    toast(`반짝이는 칸에 ${BAT[h.t].name} ${volt(U[h.t])}${h.s < 0 ? "를 뒤집어서(−)" : "를"} 놓아요`, 3200);
  } else if (h.action === "flip") toast("반짝이는 건전지를 눌러서 뒤집어요", 3000);
  else if (h.action === "remove") toast("반짝이는 건전지는 빼야 해요 (× 누르기)", 3000);
  renderCircuit();
  renderTray();
  renderStatus();
}

function toggleBreaker() {
  if (!G || G.done || G.busy) return;
  if (needLogin("아이템은 로그인하면 쓸 수 있어요. 처음에 몇 개 드려요!")) return;
  if (!ME.wallet.breaker) { toast("누전 차단기가 없어요"); setTimeout(openShop, 600); return; }
  G.breaker = !G.breaker;
  G.sel = null;
  if (G.breaker) toast("고칠 번개 칸을 눌러요");
  renderCircuit();
  renderTray();
  renderTools();
  renderStatus();
}
async function useBreaker(r, s) {
  const res = await api(`/api/play/${G.token}/item`, { item: "breaker", row: r, slot: s });
  if (res.data.over) return rushOver(res.data.result);
  G.breaker = false;
  if (!res.ok) { noItem(res); renderCircuit(); return; }
  sfx.item();
  G.unblocked = res.data.unblocked;
  renderWallet(res.data.wallet);
  if (res.data.left != null) syncRush(res.data);
  toast("칸을 고쳤어요! 이제 놓을 수 있어요");
  renderCircuit();
  renderTools();
  renderStatus();
}
async function useCharger() {
  if (!G || G.kind !== "rush" || G.done) return;
  const r = await api(`/api/play/${G.token}/item`, { item: "charger" });
  if (r.data.over) return rushOver(r.data.result);
  if (!r.ok) return noItem(r);
  sfx.item();
  renderWallet(r.data.wallet);
  syncRush(r.data);
  floatAt($("energy"), "+15초", "good");
}
async function skipPuzzle() {
  if (!G || (G.kind !== "rush" && G.kind !== "practice") || G.done || G.busy) return;
  G.busy = true;
  const r = await api(`/api/play/${G.token}/skip`, {});
  if (r.data.over) return rushOver(r.data.result);
  G.busy = false;
  if (!r.ok) return toast(r.data.error || "건너뛰지 못했어요");
  if (G.kind === "practice") {
    G.pz = r.data.puzzle;
    resetBoard();
    G.t0 = Date.now();
    renderGame();
    return;
  }
  floatAt($("energy"), "−12초", "bad");
  G.pz = r.data.puzzle;
  resetBoard();
  syncRush(r.data);
  renderGame();
}

function clearBoard() {
  if (!G || G.done || G.busy) return;
  if (!G.board.some((row) => row.some((c) => c && !c.fixed))) return;
  G.board = emptyBoard();
  G.hint = null;
  sfx.remove();
  afterChange();
}

function leaveGame() {
  if (G && G.kind === "rush" && !G.done) {
    if (!confirm("그만두면 지금 점수로 끝나요. 그만둘까요?")) return;
    return endRush();
  }
  const from = G && G.kind;
  G = null;
  stopClock();
  if (from === "stage") openStages();
  else if (from === "practice") openPractice();
  else if (from === "custom") openWorkshop();
  else goHome();
}

// ===== 랭킹 =====
const RANK_DESC = {
  rush: "타임어택 최고 점수 (전체 기간)",
  week: "최근 7일 동안의 타임어택 최고 점수",
  daily: "오늘의 퍼즐: 건전지를 적게, 빨리 쓴 순서",
  stars: "스테이지에서 모은 별",
  level: "모든 놀이에서 모은 경험치(XP)로 정한 레벨",
};
let rankKind = "rush";
async function openRank(kind) {
  rankKind = kind || rankKind;
  show("rank");
  document.querySelectorAll("#rank-seg button").forEach((b) => {
    b.classList.toggle("active", b.dataset.kind === rankKind);
    b.setAttribute("aria-selected", b.dataset.kind === rankKind ? "true" : "false");
  });
  $("rank-desc").textContent = RANK_DESC[rankKind];
  const list = $("rank-list");
  list.innerHTML = "";
  const r = await api("/api/ranking?kind=" + rankKind);
  if (!r.ok) return;
  if (!r.data.items.length) {
    list.append(el("li", "empty", "아직 기록이 없어요. 첫 번째가 되어 보세요!"));
    return;
  }
  const unit = { rush: "점", week: "점", daily: "개", stars: "★", level: "" }[rankKind];
  r.data.items.forEach((it) => {
    const li = el("li", it.me ? "me" : "");
    li.append(el("span", "rk-no" + (it.rank <= 3 ? " m" + it.rank : ""), it.rank <= 3 ? ["🥇", "🥈", "🥉"][it.rank - 1] : it.rank));
    const name = el("div", "rk-name");
    name.append(document.createTextNode(it.name));
    if (it.me) name.append(el("small", null, "나"));
    name.append(el("div", "rk-sub", it.sub));
    li.append(name, el("span", "rk-val", `${it.value}${unit}`));
    list.append(li);
  });
}

// ===== 상점 =====
const ITEM_ICON = { meter: "i-meter", breaker: "i-breaker", charger: "i-charger" };
function openShop() {
  if (needLogin("상점은 로그인하면 쓸 수 있어요.")) return;
  renderShop();
  openModal("shop-modal");
}
let shopTab = "items";
function renderShop() {
  $("shop-coins").textContent = ME.wallet.coins;
  document.querySelectorAll("#shop-seg button").forEach((b) => b.classList.toggle("active", b.dataset.tab === shopTab));
  $("shop-list").classList.toggle("hidden", shopTab !== "items");
  $("skin-list").classList.toggle("hidden", shopTab !== "skins");
  if (shopTab === "skins") renderSkins();
  const box = $("shop-list");
  box.innerHTML = "";
  Object.entries(META.items).forEach(([k, it]) => {
    const p = META.prices[k];
    const row = el("div", "shop-item");
    const ic = el("span", "si-icon");
    ic.append(icon(ITEM_ICON[k]));
    const tx = el("div", "si-text grow");
    tx.append(el("b", null, it.name), el("small", null, it.desc), el("div", "si-have", `가진 것 ${ME.wallet[k]}개`));
    const buy = el("div", "si-buy");
    [[1, p], [3, p * 3 - Math.floor(p / 2)]].forEach(([q, price]) => {
      const b = el("button", q === 3 ? "deal" : "");
      b.append(`${q}개 `, icon("i-coin"), String(price));
      b.disabled = ME.wallet.coins < price;
      b.onclick = async () => {
        const r = await api("/api/shop/buy", { item: k, qty: q });
        if (!r.ok) return toast(r.data.error || "사지 못했어요");
        sfx.coin();
        renderWallet(r.data.wallet);
        renderShop();
        toast(`${it.name} ${q}개를 샀어요`);
      };
      buy.append(b);
    });
    row.append(ic, tx, buy);
    box.append(row);
  });
}

// ===== 하는 방법 그림 =====
function helpArt() {
  const mini = (items, label) => {
    const r = el("div", "mini-row");
    items.forEach(([t, s]) => r.append(battEl(t, s)));
    const box = el("div");
    box.append(r);
    if (label) box.append(el("div", "mini-row", label));
    return box;
  };
  const h1 = $("hs-1"), h2 = $("hs-2"), h3 = $("hs-3");
  h1.innerHTML = h2.innerHTML = h3.innerHTML = "";
  h1.append(mini([["a", 1], ["c", 1]], "1.5 + 3 = 4.5V"));
  h2.append(mini([["n", 1], ["a", -1]], "9 − 1.5 = 7.5V"));
  h3.append(mini([["l", 1]]), mini([["c", 1], ["c", 1]], "두 줄 다 6V"));
  const h5 = $("hs-5");
  h5.innerHTML = "";
  const lockRow = el("div", "mini-row");
  const lb = battEl("n", 1);
  lb.classList.add("mini-lock");
  lockRow.append(lb, el("span", "mini-lockic", "🔒"));
  const dioRow = el("div", "mini-row");
  dioRow.append(el("span", "mini-dio plus", "＋"), el("span", "mini-dio minus", "−"));
  h5.append(lockRow, dioRow);
}

// ===== 연습 모드 =====
const LEVEL_DESC = {
  1: "한 줄 · 더하기만", 2: "한 줄 · 뒤집기", 3: "두 줄", 4: "두 줄 · 누전", 5: "세 줄 · 방향 칸",
  6: "세 줄 · 고정 건전지", 7: "세 줄 · 누전 둘", 8: "세 줄 · 모든 장치", 9: "세 줄 · 여분 많음",
  10: "네 줄", 11: "네 줄 모두", 12: "최고 난이도",
};
async function openPractice() {
  if (needLogin("연습 모드는 로그인하면 할 수 있어요.")) return;
  show("practice");
  const a = await api("/api/achievements");
  const best = a.ok ? a.data.stats.practice_best : 0;
  const grid = $("level-grid");
  grid.innerHTML = "";
  for (let lv = 1; lv <= META.max_level; lv++) {
    const b = el("button", "level-btn" + (lv <= best ? " cleared" : ""));
    b.style.setProperty("--heat", (lv - 1) / (META.max_level - 1));
    b.append(el("span", "lv-no", lv), el("span", "lv-desc", LEVEL_DESC[lv] || ""));
    if (lv <= best) b.append(icon("i-star", "lv-star"));
    b.setAttribute("aria-label", `레벨 ${lv}, ${LEVEL_DESC[lv]}${lv <= best ? ", 푼 적 있음" : ""}`);
    b.onclick = () => startPractice(lv);
    grid.append(b);
  }
  $("level-legend").textContent = a.ok ? `연습에서 푼 문제 ${a.data.stats.practice}개 · 가장 높은 레벨 ${best || "-"}` : "";
}
async function startPractice(level) {
  const r = await api("/api/play/practice", { level });
  if (!r.ok) return toast(r.data.error || "시작하지 못했어요");
  setupGame("practice", r.data);
  G.level = r.data.level;
  G.solved = 0;
  renderGame();
}

// ===== 업적 =====
async function openAch() {
  if (needLogin("업적은 로그인하면 볼 수 있어요.")) return;
  show("ach");
  const r = await api("/api/achievements");
  if (!r.ok) return;
  const { items, stats } = r.data;
  const done = items.filter((x) => x.done).length;
  $("ach-summary").textContent = `${items.length}개 중 ${done}개 달성했어요.`;
  const sg = $("stat-grid");
  sg.innerHTML = "";
  [["푼 퍼즐", stats.solved], ["모은 별", stats.stars], ["깬 스테이지", `${stats.cleared}/${META.stages.length}`],
   ["타임어택 최고", stats.rush_best], ["연습 최고 레벨", stats.practice_best || "-"], ["오늘의 퍼즐", `${stats.daily_days}일`]]
    .forEach(([k, v]) => {
      const c = el("div", "stat");
      c.append(el("b", null, v), el("span", null, k));
      sg.append(c);
    });
  const ul = $("ach-list");
  ul.innerHTML = "";
  items.sort((a, b) => (a.done === b.done ? b.cur / b.goal - a.cur / a.goal : a.done ? 1 : -1));
  items.forEach((it) => {
    const li = el("li", "ach" + (it.done ? " done" : ""));
    const ic = el("span", "ach-ic");
    ic.append(icon(it.done ? "i-medal" : "i-lock"));
    const tx = el("div", "grow");
    tx.append(el("b", null, it.name), el("small", null, it.desc));
    const bar = el("div", "ach-bar");
    const fill = el("div", "ach-fill");
    fill.style.width = (it.cur / it.goal) * 100 + "%";
    bar.append(fill);
    tx.append(bar);
    const rw = el("span", "ach-reward");
    rw.append(icon("i-coin"), String(it.reward));
    const prog = el("span", "ach-prog", it.done ? "완료" : `${it.cur}/${it.goal}`);
    const right = el("div", "ach-right");
    right.append(rw, prog);
    li.append(ic, tx, right);
    ul.append(li);
  });
}

// 새로 얻은 업적 알림 (여러 개면 차례로)
function announceAchievements(list) {
  if (!list || !list.length) return;
  list.forEach((a, i) => setTimeout(() => {
    const box = el("div", "ach-pop");
    box.append(icon("i-medal"));
    const t = el("div");
    t.append(el("small", null, "업적 달성!"), el("b", null, a.name), el("span", null, `+${a.reward} 코인`));
    box.append(t);
    document.body.append(box);
    sfx.coin();
    setTimeout(() => box.classList.add("out"), 2600);
    setTimeout(() => box.remove(), 3100);
  }, 900 + i * 1200));
}

// ===== 꾸미기 =====
function applySkin(sk) {
  document.documentElement.dataset.skin = sk || "basic";
}
function renderSkins() {
  const box = $("skin-list");
  box.innerHTML = "";
  Object.entries(META.skins).forEach(([k, sk]) => {
    const owned = (ME.skins || ["basic"]).includes(k);
    const using = (ME.skin || "basic") === k;
    const card = el("div", "skin-card" + (using ? " using" : ""));
    const prev = el("div", "skin-prev");
    prev.dataset.skin = k;
    ["a", "c", "l", "n"].forEach((t) => prev.append(battEl(t, 1)));
    const tx = el("div", "si-text");
    tx.append(el("b", null, sk.name), el("small", null, sk.desc));
    const b = el("button", using ? "secondary" : owned ? "secondary" : "primary");
    if (using) { b.textContent = "쓰는 중"; b.disabled = true; }
    else if (owned) b.textContent = "쓰기";
    else { b.append(icon("i-coin"), ` ${sk.price}`); b.disabled = ME.wallet.coins < sk.price; }
    b.onclick = async () => {
      const r = await api("/api/skin", { skin: k, action: owned ? "use" : "buy" });
      if (!r.ok) return toast(r.data.error || "바꾸지 못했어요");
      ME.skin = r.data.skin;
      ME.skins = r.data.skins;
      applySkin(ME.skin);
      renderWallet(r.data.wallet);
      $("shop-coins").textContent = ME.wallet.coins;
      if (!owned) { sfx.coin(); toast(`'${sk.name}' 꾸미기를 샀어요!`); }
      renderSkins();
    };
    card.append(prev, tx, b);
    box.append(card);
  });
}

// ===== 창 열고 닫기 =====
function openModal(id) {
  $(id).classList.remove("hidden");
  const f = $(id).querySelector("input, button.primary, [data-close]");
  if (f) setTimeout(() => f.focus(), 30);
}
function closeModal(id) { $(id).classList.add("hidden"); }
const openModalEl = () => document.querySelector(".modal:not(.hidden)");

function openAuth(which, why) {
  $("auth-why").textContent = why || "";
  $("login-err").textContent = "";
  $("signup-err").textContent = "";
  $("login-form").classList.toggle("hidden", which === "signup");
  $("signup-form").classList.toggle("hidden", which !== "signup");
  openModal("auth-modal");
}
async function afterAuth() {
  closeModal("auth-modal");
  guest = { stars: {}, tokens: {} };
  saveGuest();
  await loadMe();
  await loadMeta();
  toast(`${ME.nickname}님, 반가워요!`);
  if (currentView === "stages") renderStages();
  else if (currentView === "game" && G && G.done) goHome();
  else if (currentView !== "game") goHome();
}

async function openStages() {
  show("stages");
  renderStages();
  await loadMeta();
  if (currentView === "stages") renderStages();
}

// ===== 설정 =====
function applySettings() {
  $("set-sound").checked = settings.sound;
  $("set-vibrate").checked = settings.vibrate;
  $("set-calm").checked = settings.calm;
  document.documentElement.dataset.theme = settings.theme;
  if (settings.calm) document.documentElement.dataset.calm = "1";
  else delete document.documentElement.dataset.calm;
  $("theme-color").setAttribute("content", settings.theme === "light" ? "#ecebe5" : "#1e2433");
  document.querySelectorAll("#set-theme button").forEach((b) => b.classList.toggle("active", b.dataset.theme === settings.theme));
}

// ===== 이벤트 연결 =====
function bind() {
  $("brand").onclick = () => { if (currentView === "game") return leaveGame(); goHome(); };
  $("nav-back").onclick = goBack;
  $("btn-stage-list").onclick = openStages;
  $("card-workshop").onclick = openWorkshop;
  $("card-shop").onclick = openShop;
  $("guest-login").onclick = () => openAuth("signup", "가입하면 코인 50개와 아이템을 드려요!");
  $("btn-checkin").onclick = doCheckin;
  $("ms-bonus").onclick = () => claimMission("all");
  document.querySelectorAll("#ws-seg button").forEach((b) => (b.onclick = () => { wsSort = b.dataset.sort; openWorkshop(); }));
  $("ws-new").onclick = openMaker;
  $("mk-cancel").onclick = () => { MK = null; openWorkshop(); };
  $("mk-publish").onclick = publishMaker;
  document.querySelectorAll("#mk-rows button").forEach((b) => (b.onclick = () => {
    const n = Number(b.dataset.n);
    while (MK.rows.length < n) MK.rows.push(3);
    MK.rows.length = n;
    MK.need = Math.min(MK.need, n);
    renderMaker();
  }));
  document.querySelectorAll("#view-maker .stepper button").forEach((b) => (b.onclick = () => {
    MK.target = Math.max(1, Math.min(72, MK.target + Number(b.dataset.d)));
    renderMaker();
  }));
  $("card-rush").onclick = startRush;
  $("card-daily").onclick = startDaily;
  $("card-rank").onclick = () => openRank("rush");
  $("card-practice").onclick = openPractice;
  $("card-ach").onclick = openAch;
  document.querySelectorAll("#shop-seg button").forEach((b) => (b.onclick = () => { shopTab = b.dataset.tab; renderShop(); }));
  $("btn-help").onclick = () => openModal("help-modal");
  $("btn-shop").onclick = openShop;
  $("btn-settings").onclick = () => { applySettings(); openModal("settings-modal"); };
  $("btn-login").onclick = () => openAuth("login");
  $("btn-user").onclick = () => { applySettings(); openModal("settings-modal"); };

  $("t-clear").onclick = clearBoard;
  $("t-meter").onclick = useMeter;
  $("t-breaker").onclick = toggleBreaker;
  $("t-charger").onclick = useCharger;
  $("t-skip").onclick = skipPuzzle;

  $("o-again").onclick = startRush;
  $("o-home").onclick = () => { closeModal("over-modal"); goHome(); };
  $("o-rank").onclick = () => { closeModal("over-modal"); G = null; openRank("rush"); };

  document.querySelectorAll("#rank-seg button").forEach((b) => (b.onclick = () => openRank(b.dataset.kind)));

  // 창 닫기
  document.querySelectorAll(".modal").forEach((m) => {
    m.addEventListener("click", (e) => {
      if (e.target !== m) return;
      if (m.id === "over-modal" || m.id === "result-modal") return; // 결과 창은 버튼으로만
      closeModal(m.id);
    });
    m.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => closeModal(m.id)));
  });

  // 설정
  $("set-sound").onchange = (e) => { settings.sound = e.target.checked; saveSettings(); if (settings.sound) sfx.pick(); };
  $("set-vibrate").onchange = (e) => { settings.vibrate = e.target.checked; saveSettings(); vibe(20); };
  $("set-calm").onchange = (e) => { settings.calm = e.target.checked; saveSettings(); applySettings(); };
  document.querySelectorAll("#set-theme button").forEach((b) =>
    (b.onclick = () => { settings.theme = b.dataset.theme; saveSettings(); applySettings(); }));
  $("btn-logout").onclick = async () => {
    await api("/logout", {});
    closeModal("settings-modal");
    ME = { id: null };
    await loadMe();
    await loadMeta();
    goHome();
    toast("로그아웃했어요");
  };

  // 로그인 / 가입
  $("to-signup").onclick = (e) => { e.preventDefault(); openAuth("signup", $("auth-why").textContent); };
  $("to-login").onclick = (e) => { e.preventDefault(); openAuth("login", $("auth-why").textContent); };
  $("login-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const r = await api("/login", { username: f.username.value, password: f.password.value });
    if (!r.ok) { $("login-err").textContent = r.data.error || "로그인하지 못했어요"; return; }
    afterAuth();
  };
  $("signup-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const r = await api("/signup", {
      username: f.username.value, password: f.password.value, nickname: f.nickname.value,
      guest: Object.values(guest.tokens),
    });
    if (!r.ok) { $("signup-err").textContent = r.data.error || "가입하지 못했어요"; return; }
    afterAuth();
  };

  // 키보드
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea")) return;
    const m = openModalEl();
    if (e.key === "Escape") {
      if (m && m.id !== "over-modal" && m.id !== "result-modal") return closeModal(m.id);
      if (G && (G.sel || G.breaker || G.hint)) { G.sel = null; G.breaker = false; G.hint = null; renderCircuit(); renderTray(); renderTools(); renderStatus(); }
      return;
    }
    if (m || currentView !== "game" || !G) return;
    if (/^[1-4]$/.test(e.key)) {
      const kinds = ORDER.filter((t) => G.pz.tray[t]);
      const t = kinds[Number(e.key) - 1];
      if (t) selectType(t);
    }
  });
}

// ===== 시작 =====
async function init() {
  applySettings();
  bind();
  await Promise.all([loadMe(), loadMeta()]);
  helpArt();
  renderHome();
  if (!localStorage.getItem("vc.seenHelp")) {
    localStorage.setItem("vc.seenHelp", "1");
    setTimeout(() => openModal("help-modal"), 400);
  }
}
init();
