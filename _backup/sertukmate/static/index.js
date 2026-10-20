// ===== 상태 =====
let me = { id: null, nickname: null, ai_mode: "practice" };
let meta = { tracks: [], subjects: [] };
let state = {
  step: 1,
  track: "",
  trackName: "",
  major: "",
  job: "",
  subjects: [],
  keywords: [],
  style: "academic",
  result: null,
};
let mindmapNodes = []; // {id, text, x, y, kind, color, parent}
let mmView = { scale: 1, tx: 0, ty: 0, W: 800, H: 500 }; // 마인드맵 줌/팬 상태

const $ = (id) => document.getElementById(id);
const canEdit = () => me.id !== null;

// ===== 초기 로드 =====
async function init() {
  await loadMe();
  await loadMeta();
  renderTrackCards();
  renderSubjectChips();
  bindEvents();
}

async function loadMe() {
  const res = await fetch("/me");
  me = Object.assign({ id: null, ai_mode: "practice" }, await res.json());
  updateAuthUI();
}

async function loadMeta() {
  const res = await fetch("/meta");
  meta = await res.json();
}

function updateAuthUI() {
  const badge = $("mode-badge");
  badge.textContent = me.ai_mode === "practice" ? "AI 연습모드" : "AI " + me.ai_mode;
  badge.classList.toggle("practice", me.ai_mode === "practice");
  if (me.id !== null) {
    $("user-box").classList.remove("hidden");
    $("nickname").textContent = me.nickname;
    $("logout-btn").classList.remove("hidden");
    $("saved-btn").classList.remove("hidden");
    $("login-btn").classList.add("hidden");
  } else {
    $("user-box").classList.add("hidden");
    $("logout-btn").classList.add("hidden");
    $("saved-btn").classList.add("hidden");
    $("login-btn").classList.remove("hidden");
  }
}

// ===== Step 1: 계열 카드 / 교과목 칩 =====
function renderTrackCards() {
  const box = $("track-cards");
  box.innerHTML = "";
  meta.tracks.forEach((t) => {
    const c = document.createElement("div");
    c.className = "track-card" + (state.track === t.id ? " active" : "");
    c.innerHTML = `<div class="emoji">${t.emoji}</div><div>${t.name}</div>`;
    c.addEventListener("click", () => {
      state.track = t.id;
      state.trackName = t.name;
      renderTrackCards();
    });
    box.appendChild(c);
  });
}

function renderSubjectChips() {
  const box = $("subject-chips");
  box.innerHTML = "";
  meta.subjects.forEach((s) => {
    const chip = document.createElement("button");
    chip.className = "chip" + (state.subjects.includes(s) ? " active" : "");
    chip.textContent = s;
    chip.addEventListener("click", () => {
      if (state.subjects.includes(s)) {
        state.subjects = state.subjects.filter((x) => x !== s);
      } else {
        state.subjects.push(s);
      }
      renderSubjectChips();
    });
    box.appendChild(chip);
  });
}

// ===== Step 2: 키워드 =====
async function loadKeywordSuggestions() {
  const res = await fetch("/keywords", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subjects: state.subjects }),
  });
  const data = await res.json();
  renderKeywordChips(data.keywords);
}

function renderKeywordChips(suggested) {
  const box = $("keyword-chips");
  box.innerHTML = "";
  if (!suggested.length) {
    box.innerHTML = '<p class="hint">교과목을 고르면 추천 키워드가 나와요. 아래에서 직접 추가해도 돼요.</p>';
  }
  suggested.forEach((k) => {
    const chip = document.createElement("button");
    chip.className = "chip" + (state.keywords.includes(k) ? " active" : "");
    chip.textContent = k;
    chip.addEventListener("click", () => toggleKeyword(k));
    box.appendChild(chip);
  });
  renderSelectedKeywords();
}

function toggleKeyword(k) {
  if (state.keywords.includes(k)) state.keywords = state.keywords.filter((x) => x !== k);
  else state.keywords.push(k);
  // 추천칩 active 갱신
  document.querySelectorAll("#keyword-chips .chip").forEach((c) => {
    c.classList.toggle("active", state.keywords.includes(c.textContent));
  });
  renderSelectedKeywords();
}

function renderSelectedKeywords() {
  const box = $("selected-keywords");
  box.innerHTML = "";
  if (!state.keywords.length) {
    box.innerHTML = '<p class="hint">고른 키워드가 여기에 모여요.</p>';
    return;
  }
  state.keywords.forEach((k) => {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = k;
    const x = document.createElement("button");
    x.textContent = "✕";
    x.addEventListener("click", () => {
      state.keywords = state.keywords.filter((v) => v !== k);
      renderSelectedKeywords();
      document.querySelectorAll("#keyword-chips .chip").forEach((c) => {
        c.classList.toggle("active", state.keywords.includes(c.textContent));
      });
    });
    tag.appendChild(x);
    box.appendChild(tag);
  });
}

// ===== 단계 이동 =====
function goStep(n) {
  state.step = n;
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $("screen-" + n).classList.add("active");
  document.querySelectorAll(".step").forEach((s) => {
    const sn = Number(s.dataset.step);
    s.classList.toggle("active", sn === n);
    s.classList.toggle("done", sn < n);
  });
  window.scrollTo(0, 0);
}

// ===== Step 3: AI 생성 =====
async function generate() {
  $("loading").classList.remove("hidden");
  $("result-cards").innerHTML = "";
  try {
    const res = await fetch("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        track: state.trackName,
        major: state.major,
        job: state.job,
        subjects: state.subjects,
        keywords: state.keywords,
        style: state.style,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      $("result-cards").innerHTML = `<p class="hint">${data.error || "생성에 실패했어요."}</p>`;
      return;
    }
    state.result = data;
    renderResult(data);
  } catch (e) {
    $("result-cards").innerHTML = '<p class="hint">연결에 문제가 있어요. 다시 시도해주세요.</p>';
  } finally {
    $("loading").classList.add("hidden");
  }
}

function renderResult(d) {
  const box = $("result-cards");
  box.innerHTML = "";

  if (d._practice_note) {
    const note = document.createElement("div");
    note.className = "practice-note";
    note.textContent = d._practice_note;
    box.appendChild(note);
  }

  box.appendChild(card("탐구 주제", `<p class="topic">${esc(d.topic)}</p>`));
  if (d.appeal) box.appendChild(card("교과 역량 어필 포인트", `<p>${esc(d.appeal)}</p>`));

  if (d.outline && d.outline.length) {
    const ol = d.outline.map((s) => `<li>${esc(s)}</li>`).join("");
    box.appendChild(card("보고서 목차", `<ol class="outline">${ol}</ol>`));
  }
  if (d.concepts && d.concepts.length) {
    const tags = d.concepts.map((c) => `<span class="tag static">${esc(c)}</span>`).join("");
    box.appendChild(card("핵심 교과 개념", `<div class="chips">${tags}</div>`));
  }
  // 진로 맞춤 추천 도서 (왜 맞는지 + 세특 활용법)
  if (d.books && d.books.length) {
    const items = d.books.map((b) => {
      if (typeof b === "string") return `<li>${esc(b)}</li>`;
      let h = `<li class="book-item"><div class="book-title">${esc(b.title)}</div>`;
      if (b.why) h += `<div class="book-why"><b>진로 적합성</b> ${esc(b.why)}</div>`;
      if (b.use) h += `<div class="book-use"><b>세특 활용</b> ${esc(b.use)}</div>`;
      return h + `</li>`;
    }).join("");
    box.appendChild(card("진로 맞춤 추천 도서", `<ul class="book-list">${items}</ul>`));
  }
  // 추천 실험·활동
  if (d.experiments && d.experiments.length) {
    const li = d.experiments.map((e) => `<li>${esc(e)}</li>`).join("");
    box.appendChild(card("추천 실험·활동", `<ul class="exp-list">${li}</ul>`));
  }
  // 세특에 그대로 쓸 수 있는 문장
  if (d.sertuk_examples && d.sertuk_examples.length) {
    const li = d.sertuk_examples.map((e) => `<li>“${esc(e)}”</li>`).join("");
    box.appendChild(card("세특 문장 예시", `<ul class="sertuk-list">${li}</ul>`));
  }
  if (d.papers && d.papers.length) {
    const li = d.papers.map((b) => `<li>${esc(b)}</li>`).join("");
    box.appendChild(card("논문·자료 팁", `<ul>${li}</ul>`));
  }
}

function card(title, innerHtml) {
  const el = document.createElement("div");
  el.className = "rcard";
  el.innerHTML = `<h4>${title}</h4>${innerHtml}`;
  return el;
}
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ===== Step 4: 마인드맵 (SVG) =====
const SVG_NS = "http://www.w3.org/2000/svg";

function buildMindmap() {
  const d = state.result;
  if (!d) return;
  const wrap = $("mindmap-wrap");
  const W = wrap.clientWidth || 800;
  const H = 500;
  const cx = W / 2;
  const cy = H / 2;

  mindmapNodes = [];
  // 중앙 노드 (원문 full 저장)
  mindmapNodes.push({ id: "root", text: shorten(d.topic, 26), full: d.topic, x: cx, y: cy, kind: "root", color: "#1f3a34" });

  // 가지별 아이템: 원문을 그대로 담아 두고, 그릴 때 줄임 (차분한 색 팔레트)
  const bookTitles = (d.books || []).map((b) => (typeof b === "string" ? b : b.title));
  const branches = [
    { label: "교과 개념", items: (d.concepts || []).slice(0, 4), kind: "concept", color: "#4f6d5e" },
    { label: "탐구 내용", items: (d.outline || []).slice(0, 4), kind: "outline", color: "#3f5a74" },
    { label: "연계 도서", items: bookTitles.slice(0, 3), kind: "book", color: "#b4552d" },
    { label: "진로 연계", items: [state.major || state.trackName, state.job].filter(Boolean), kind: "career", color: "#8a6d3b" },
  ];

  const R = Math.min(W, H) * 0.3 + 70;
  const n = branches.length;
  branches.forEach((br, i) => {
    const ang = (Math.PI * 2 * i) / n - Math.PI / 2;
    const bx = cx + Math.cos(ang) * R;
    const by = cy + Math.sin(ang) * R;
    const bid = "b" + i;
    mindmapNodes.push({ id: bid, text: br.label, full: br.label, x: bx, y: by, kind: br.kind, parent: "root", color: br.color });
    // 하위 아이템
    br.items.forEach((it, j) => {
      const full = String(it);
      const spread = (j - (br.items.length - 1) / 2) * 0.55;
      const a2 = ang + spread;
      const lx = bx + Math.cos(ang) * 120 + Math.cos(a2) * 60;
      const ly = by + Math.sin(ang) * 70 + Math.sin(a2) * 50;
      mindmapNodes.push({
        id: bid + "_" + j,
        text: shorten(full, 15),
        full: full,
        x: Math.max(80, Math.min(W - 80, lx)),
        y: Math.max(44, Math.min(H - 44, ly)),
        kind: br.kind + "-leaf",
        parent: bid,
        color: br.color,
      });
    });
  });

  // 줌/팬 상태 초기화
  mmView = { scale: 1, tx: 0, ty: 0, W, H };
  drawMindmap();
}

function shorten(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function drawMindmap() {
  const svg = $("mindmap");
  const W = mmView.W, H = mmView.H;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = "";

  // defs: 그림자 필터 + 배경 격자
  const defs = document.createElementNS(SVG_NS, "defs");
  defs.innerHTML = `
    <filter id="mm-shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.14"/>
    </filter>
    <pattern id="mm-grid" width="26" height="26" patternUnits="userSpaceOnUse">
      <circle cx="1.3" cy="1.3" r="1.3" fill="#e7e8f2"/>
    </pattern>`;
  svg.appendChild(defs);

  // 배경 (점 격자)
  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("x", -2000); bg.setAttribute("y", -2000);
  bg.setAttribute("width", 4000 + W); bg.setAttribute("height", 4000 + H);
  bg.setAttribute("fill", "url(#mm-grid)");
  svg.appendChild(bg);

  // 줌/팬 변환 그룹
  const view = document.createElementNS(SVG_NS, "g");
  view.setAttribute("id", "mm-view");
  view.setAttribute("transform", `translate(${mmView.tx},${mmView.ty}) scale(${mmView.scale})`);
  svg.appendChild(view);

  // 곡선 연결선 먼저
  mindmapNodes.forEach((node) => {
    if (!node.parent) return;
    const p = mindmapNodes.find((x) => x.id === node.parent);
    if (!p) return;
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", curvePath(p, node));
    path.setAttribute("class", "mm-line");
    path.setAttribute("stroke", node.color || "#cfd0e0");
    path.dataset.from = p.id;
    path.dataset.to = node.id;
    view.appendChild(path);
  });

  // 노드
  mindmapNodes.forEach((node) => {
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("class", "mm-node mm-" + node.kind);
    g.setAttribute("transform", `translate(${node.x},${node.y})`);
    g.dataset.id = node.id;

    const isRoot = node.kind === "root";
    const isLeaf = node.kind.endsWith("-leaf");
    const w = Math.max(isRoot ? 150 : 70, node.text.length * (isRoot ? 11 : 9) + 28);
    const h = isRoot ? 46 : 36;

    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", -w / 2);
    rect.setAttribute("y", -h / 2);
    rect.setAttribute("width", w);
    rect.setAttribute("height", h);
    rect.setAttribute("rx", h / 2);
    rect.setAttribute("filter", "url(#mm-shadow)");
    // 색: root/가지는 채움, 잎은 흰 배경에 색 테두리
    if (isLeaf) {
      rect.setAttribute("fill", "#ffffff");
      rect.setAttribute("stroke", node.color);
      rect.setAttribute("stroke-width", "2");
    } else {
      rect.setAttribute("fill", node.color);
      rect.setAttribute("stroke", "none");
    }
    g.appendChild(rect);

    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dy", "0.35em");
    text.setAttribute("fill", isLeaf ? "#333" : "#fff");
    if (isRoot) text.setAttribute("font-weight", "700");
    text.textContent = node.text;
    g.appendChild(text);

    // 마우스를 올리면 전체 내용이 보이는 네이티브 툴팁
    if (node.full && node.full !== node.text) {
      const titleEl = document.createElementNS(SVG_NS, "title");
      titleEl.textContent = node.full;
      g.appendChild(titleEl);
      // 내용이 잘렸다는 작은 표시 점
      g.classList.add("mm-truncated");
    }

    // 잎이 아닌 가지에는 "+" 추가 버튼
    if (!isLeaf && !isRoot) {
      const plus = makeNodeButton(w / 2 - 2, -h / 2 - 2, "+", node.color);
      plus.addEventListener("click", (e) => { e.stopPropagation(); addChildNode(node); });
      plus.addEventListener("mousedown", (e) => e.stopPropagation());
      g.appendChild(plus);
    }
    // 잎에는 삭제 "×" 버튼
    if (isLeaf) {
      const del = makeNodeButton(w / 2 - 2, -h / 2 - 2, "×", "#e74c3c");
      del.addEventListener("click", (e) => { e.stopPropagation(); removeNode(node); });
      del.addEventListener("mousedown", (e) => e.stopPropagation());
      g.appendChild(del);
    }

    enableDrag(g, node, svg);
    // 단일 클릭: 잘린 내용이면 전체 보기 팝업
    let clickTimer = null;
    g.addEventListener("click", (e) => {
      e.stopPropagation();
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        if (node.full && node.full !== node.text) showNodePopup(node);
      }, 220); // 더블클릭이면 아래에서 취소됨
    });
    // 더블클릭: 전체 내용을 기준으로 수정
    g.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      clearTimeout(clickTimer);
      const nv = prompt("내용을 고쳐보세요", node.full || node.text);
      if (nv !== null && nv.trim()) {
        node.full = nv.trim();
        node.text = shorten(nv.trim(), node.kind === "root" ? 26 : 15);
        drawMindmap();
      }
    });

    view.appendChild(g);
  });

  enablePanZoom(svg);
}

// 노드 전체 내용 팝업
function showNodePopup(node) {
  let pop = $("mm-popup");
  if (!pop) {
    pop = document.createElement("div");
    pop.id = "mm-popup";
    pop.innerHTML = '<div class="mm-popup-card"><button class="mm-popup-close">✕</button><div class="mm-popup-text"></div></div>';
    document.body.appendChild(pop);
    pop.addEventListener("click", (e) => { if (e.target === pop) pop.classList.add("hidden"); });
    pop.querySelector(".mm-popup-close").addEventListener("click", () => pop.classList.add("hidden"));
  }
  pop.querySelector(".mm-popup-text").textContent = node.full;
  pop.classList.remove("hidden");
}

// 부드러운 곡선 경로 (부모 → 자식)
function curvePath(p, c) {
  const mx = (p.x + c.x) / 2;
  return `M ${p.x} ${p.y} C ${mx} ${p.y}, ${mx} ${c.y}, ${c.x} ${c.y}`;
}

// 노드 위 작은 원형 버튼
function makeNodeButton(x, y, label, color) {
  const btn = document.createElementNS(SVG_NS, "g");
  btn.setAttribute("class", "mm-nodebtn");
  btn.setAttribute("transform", `translate(${x},${y})`);
  const c = document.createElementNS(SVG_NS, "circle");
  c.setAttribute("r", 9);
  c.setAttribute("fill", "#fff");
  c.setAttribute("stroke", color);
  c.setAttribute("stroke-width", "1.5");
  btn.appendChild(c);
  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("text-anchor", "middle");
  t.setAttribute("dy", "0.35em");
  t.setAttribute("fill", color);
  t.setAttribute("font-size", "13");
  t.textContent = label;
  btn.appendChild(t);
  return btn;
}

// 가지에 자식 노드 추가
function addChildNode(parent) {
  const txt = prompt("새 가지에 넣을 내용을 적어주세요", "");
  if (txt === null || !txt.trim()) return;
  const siblings = mindmapNodes.filter((n) => n.parent === parent.id);
  const idx = siblings.length;
  mindmapNodes.push({
    id: parent.id + "_add" + Date.now(),
    text: shorten(txt.trim(), 15),
    x: parent.x + 90,
    y: parent.y + (idx - 1) * 46,
    kind: parent.kind + "-leaf",
    parent: parent.id,
    color: parent.color,
  });
  drawMindmap();
}

// 노드 삭제
function removeNode(node) {
  mindmapNodes = mindmapNodes.filter((n) => n.id !== node.id && n.parent !== node.id);
  drawMindmap();
}

function enableDrag(g, node, svg) {
  let dragging = false;
  const start = (e) => {
    dragging = true;
    g.classList.add("dragging");
    e.stopPropagation();
    e.preventDefault();
  };
  const move = (e) => {
    if (!dragging) return;
    const pt = svgPoint(svg, e);
    // 줌/팬 보정: 화면 좌표 → 뷰 내부 좌표
    node.x = (pt.x - mmView.tx) / mmView.scale;
    node.y = (pt.y - mmView.ty) / mmView.scale;
    g.setAttribute("transform", `translate(${node.x},${node.y})`);
    // 곡선 연결선 갱신
    svg.querySelectorAll("path.mm-line").forEach((ln) => {
      const from = mindmapNodes.find((x) => x.id === ln.dataset.from);
      const to = mindmapNodes.find((x) => x.id === ln.dataset.to);
      if (from && to && (ln.dataset.from === node.id || ln.dataset.to === node.id)) {
        ln.setAttribute("d", curvePath(from, to));
      }
    });
  };
  const end = () => {
    dragging = false;
    g.classList.remove("dragging");
  };
  g.addEventListener("mousedown", start);
  g.addEventListener("touchstart", start, { passive: false });
  svg.addEventListener("mousemove", move);
  svg.addEventListener("touchmove", (e) => { if (dragging) { move(e); e.preventDefault(); } }, { passive: false });
  window.addEventListener("mouseup", end);
  window.addEventListener("touchend", end);
}

// ===== 줌 / 팬 =====
let mmPanBound = false;
function enablePanZoom(svg) {
  const apply = () => {
    const v = svg.querySelector("#mm-view");
    if (v) v.setAttribute("transform", `translate(${mmView.tx},${mmView.ty}) scale(${mmView.scale})`);
  };

  if (mmPanBound) return; // 이벤트는 한 번만 바인딩
  mmPanBound = true;

  let panning = false, sx = 0, sy = 0, stx = 0, sty = 0;

  svg.addEventListener("mousedown", (e) => {
    // 노드가 아닌 빈 공간에서만 팬
    if (e.target.closest(".mm-node")) return;
    panning = true;
    sx = e.clientX; sy = e.clientY; stx = mmView.tx; sty = mmView.ty;
    svg.classList.add("panning");
  });
  window.addEventListener("mousemove", (e) => {
    if (!panning) return;
    mmView.tx = stx + (e.clientX - sx);
    mmView.ty = sty + (e.clientY - sy);
    apply();
  });
  window.addEventListener("mouseup", () => { panning = false; svg.classList.remove("panning"); });

  // 휠 줌 (마우스 위치 기준)
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const mx = ((e.clientX - rect.left) / rect.width) * vb.width;
    const my = ((e.clientY - rect.top) / rect.height) * vb.height;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const ns = Math.max(0.4, Math.min(2.5, mmView.scale * factor));
    // 마우스 지점을 기준으로 확대
    mmView.tx = mx - (mx - mmView.tx) * (ns / mmView.scale);
    mmView.ty = my - (my - mmView.ty) * (ns / mmView.scale);
    mmView.scale = ns;
    apply();
  }, { passive: false });
}

// 줌 버튼용
function mmZoom(factor) {
  const svg = $("mindmap");
  const vb = svg.viewBox.baseVal;
  const mx = vb.width / 2, my = vb.height / 2;
  const ns = Math.max(0.4, Math.min(2.5, mmView.scale * factor));
  mmView.tx = mx - (mx - mmView.tx) * (ns / mmView.scale);
  mmView.ty = my - (my - mmView.ty) * (ns / mmView.scale);
  mmView.scale = ns;
  const v = svg.querySelector("#mm-view");
  if (v) v.setAttribute("transform", `translate(${mmView.tx},${mmView.ty}) scale(${mmView.scale})`);
}
function mmReset() {
  mmView.tx = 0; mmView.ty = 0; mmView.scale = 1;
  const v = $("mindmap").querySelector("#mm-view");
  if (v) v.setAttribute("transform", `translate(0,0) scale(1)`);
}

function svgPoint(svg, e) {
  const rect = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  let cx, cy;
  if (e.touches && e.touches.length) {
    cx = e.touches[0].clientX;
    cy = e.touches[0].clientY;
  } else {
    cx = e.clientX;
    cy = e.clientY;
  }
  return {
    x: ((cx - rect.left) / rect.width) * vb.width,
    y: ((cy - rect.top) / rect.height) * vb.height,
  };
}

// ===== 내보내기 =====
function buildPlainText() {
  const d = state.result;
  if (!d) return "";
  let t = `[세특 탐구 설계]\n\n`;
  t += `■ 탐구 주제\n${d.topic}\n\n`;
  if (d.appeal) t += `■ 교과 역량 어필 포인트\n${d.appeal}\n\n`;
  if (d.outline && d.outline.length) t += `■ 보고서 목차\n` + d.outline.map((o) => "- " + o).join("\n") + "\n\n";
  if (d.concepts && d.concepts.length) t += `■ 핵심 교과 개념\n${d.concepts.join(", ")}\n\n`;
  if (d.books && d.books.length) {
    t += `■ 진로 맞춤 추천 도서\n`;
    d.books.forEach((b) => {
      if (typeof b === "string") { t += "- " + b + "\n"; return; }
      t += `- ${b.title}\n`;
      if (b.why) t += `   · 왜 내 진로에 맞나: ${b.why}\n`;
      if (b.use) t += `   · 세특 활용법: ${b.use}\n`;
    });
    t += "\n";
  }
  if (d.experiments && d.experiments.length) t += `■ 추천 실험·활동\n` + d.experiments.map((e) => "- " + e).join("\n") + "\n\n";
  if (d.sertuk_examples && d.sertuk_examples.length) t += `■ 세특 문장 예시\n` + d.sertuk_examples.map((e) => "“" + e + "”").join("\n") + "\n\n";
  if (d.papers && d.papers.length) t += `■ 논문·자료 팁\n` + d.papers.map((p) => "- " + p).join("\n") + "\n";
  return t;
}

function exportPdf() {
  const d = state.result;
  if (!d) return;
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
  <title>${esc(d.topic)}</title>
  <style>
    body{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;padding:40px;line-height:1.7;color:#222}
    h1{font-size:22px;border-bottom:2px solid #1f3a34;padding-bottom:8px}
    h2{font-size:16px;color:#1f3a34;margin-top:24px}
    li{margin:4px 0}
    .tag{display:inline-block;background:#eee;border-radius:12px;padding:2px 10px;margin:2px;font-size:13px}
  </style></head><body>
  <h1>${esc(d.topic)}</h1>
  ${d.appeal ? `<h2>교과 역량 어필 포인트</h2><p>${esc(d.appeal)}</p>` : ""}
  ${d.outline && d.outline.length ? `<h2>보고서 목차</h2><ol>${d.outline.map((o) => `<li>${esc(o)}</li>`).join("")}</ol>` : ""}
  ${d.concepts && d.concepts.length ? `<h2>핵심 교과 개념</h2><p>${d.concepts.map((c) => `<span class="tag">${esc(c)}</span>`).join("")}</p>` : ""}
  ${d.books && d.books.length ? `<h2>진로 맞춤 추천 도서</h2><ul>${d.books.map((b) => {
    if (typeof b === "string") return `<li>${esc(b)}</li>`;
    let h = `<li><b>${esc(b.title)}</b>`;
    if (b.why) h += `<br><span style="color:#555">왜 맞나: ${esc(b.why)}</span>`;
    if (b.use) h += `<br><span style="color:#555">세특 활용: ${esc(b.use)}</span>`;
    return h + `</li>`;
  }).join("")}</ul>` : ""}
  ${d.experiments && d.experiments.length ? `<h2>추천 실험·활동</h2><ul>${d.experiments.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
  ${d.sertuk_examples && d.sertuk_examples.length ? `<h2>세특 문장 예시</h2><ul>${d.sertuk_examples.map((e) => `<li>“${esc(e)}”</li>`).join("")}</ul>` : ""}
  ${d.papers && d.papers.length ? `<h2>논문·자료 팁</h2><ul>${d.papers.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
  <script>window.onload=()=>{window.print()}<\/script>
  </body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert("팝업이 막혀 있어요. 팝업을 허용해주세요."); return; }
  w.document.write(html);
  w.document.close();
}

// ===== 저장함 =====
async function saveResult() {
  if (!canEdit()) return openModal("login");
  if (!state.result) return;
  const res = await fetch("/results", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: state.result.topic, payload: state.result }),
  });
  if (res.ok) toast("저장함에 보관했어요 ✅");
  else toast("저장에 실패했어요");
}

async function openSaved() {
  $("saved-list").innerHTML = "<p class='hint'>불러오는 중…</p>";
  $("saved-modal").classList.remove("hidden");
  const res = await fetch("/results");
  const rows = await res.json();
  const box = $("saved-list");
  if (!rows.length) {
    box.innerHTML = "<p class='hint'>아직 저장한 탐구가 없어요.</p>";
    return;
  }
  box.innerHTML = "";
  rows.forEach((r) => {
    const item = document.createElement("div");
    item.className = "saved-item";
    const t = document.createElement("div");
    t.className = "saved-title";
    t.textContent = r.title;
    t.addEventListener("click", () => loadSaved(r.id));
    const del = document.createElement("button");
    del.textContent = "🗑️";
    del.title = "삭제";
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("삭제할까요?")) return;
      await fetch("/results/" + r.id, { method: "DELETE" });
      openSaved();
    });
    item.appendChild(t);
    item.appendChild(del);
    box.appendChild(item);
  });
}

async function loadSaved(id) {
  const res = await fetch("/results/" + id);
  const data = await res.json();
  state.result = data.payload;
  $("saved-modal").classList.add("hidden");
  renderResult(state.result);
  goStep(3);
}

// ===== 토스트 =====
let toastTimer = null;
function toast(msg) {
  let el = $("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2000);
}

// ===== 모달 =====
function openModal(which) {
  $("modal").classList.remove("hidden");
  $("login-err").textContent = "";
  $("signup-err").textContent = "";
  if (which === "signup") {
    $("login-form").classList.add("hidden");
    $("signup-form").classList.remove("hidden");
  } else {
    $("signup-form").classList.add("hidden");
    $("login-form").classList.remove("hidden");
  }
}
function closeModal() { $("modal").classList.add("hidden"); }

// ===== 이벤트 연결 =====
function bindEvents() {
  $("major").addEventListener("input", (e) => (state.major = e.target.value.trim()));
  $("job").addEventListener("input", (e) => (state.job = e.target.value.trim()));

  $("to-step2").addEventListener("click", () => {
    if (!state.major && !state.subjects.length) {
      toast("학과나 교과목을 하나 이상 골라주세요");
      return;
    }
    goStep(2);
    loadKeywordSuggestions();
  });
  $("back-step1").addEventListener("click", () => goStep(1));

  $("add-keyword").addEventListener("click", addCustomKeyword);
  $("custom-keyword").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addCustomKeyword(); }
  });

  document.querySelectorAll(".style-card").forEach((c) => {
    c.addEventListener("click", () => {
      state.style = c.dataset.style;
      document.querySelectorAll(".style-card").forEach((x) => x.classList.remove("active"));
      c.classList.add("active");
    });
  });

  $("to-step3").addEventListener("click", () => { goStep(3); generate(); });
  $("back-step2").addEventListener("click", () => goStep(2));
  $("regenerate").addEventListener("click", generate);
  $("to-step4").addEventListener("click", () => {
    if (!state.result) { toast("먼저 AI 생성을 완료해주세요"); return; }
    goStep(4);
    buildMindmap();
  });
  $("back-step3").addEventListener("click", () => goStep(3));
  $("restart").addEventListener("click", () => {
    if (!confirm("처음부터 다시 시작할까요? 입력한 내용이 지워져요.")) return;
    state = { step: 1, track: "", trackName: "", major: "", job: "", subjects: [], keywords: [], style: "academic", result: null };
    $("major").value = ""; $("job").value = ""; $("custom-keyword").value = "";
    renderTrackCards(); renderSubjectChips();
    document.querySelectorAll(".style-card").forEach((x, i) => x.classList.toggle("active", i === 0));
    goStep(1);
  });

  $("mm-zoom-in").addEventListener("click", () => mmZoom(1.2));
  $("mm-zoom-out").addEventListener("click", () => mmZoom(1 / 1.2));
  $("mm-reset").addEventListener("click", mmReset);

  $("copy-btn").addEventListener("click", () => {
    navigator.clipboard.writeText(buildPlainText()).then(() => toast("복사했어요 📋")).catch(() => toast("복사 실패"));
  });
  $("pdf-btn").addEventListener("click", exportPdf);
  $("save-btn2").addEventListener("click", saveResult);

  // 상단바
  $("login-btn").addEventListener("click", () => openModal("login"));
  $("logout-btn").addEventListener("click", async () => { await fetch("/logout", { method: "POST" }); location.reload(); });
  $("saved-btn").addEventListener("click", openSaved);
  $("saved-close").addEventListener("click", () => $("saved-modal").classList.add("hidden"));
  $("saved-modal").addEventListener("click", (e) => { if (e.target === $("saved-modal")) $("saved-modal").classList.add("hidden"); });

  // 모달
  $("modal-close").addEventListener("click", closeModal);
  $("modal").addEventListener("click", (e) => { if (e.target === $("modal")) closeModal(); });
  $("to-signup").addEventListener("click", (e) => { e.preventDefault(); openModal("signup"); });
  $("to-login").addEventListener("click", (e) => { e.preventDefault(); openModal("login"); });

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const res = await fetch("/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: f.username.value, password: f.password.value }) });
    const data = await res.json();
    if (res.ok) location.reload();
    else $("login-err").textContent = data.error || "로그인 실패";
  });
  $("signup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const res = await fetch("/signup", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: f.username.value, password: f.password.value, nickname: f.nickname.value }) });
    const data = await res.json();
    if (res.ok) location.reload();
    else $("signup-err").textContent = data.error || "회원가입 실패";
  });
}

function addCustomKeyword() {
  const inp = $("custom-keyword");
  const v = inp.value.trim();
  if (!v) return;
  if (!state.keywords.includes(v)) state.keywords.push(v);
  inp.value = "";
  renderSelectedKeywords();
}

init();
