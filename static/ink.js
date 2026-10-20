/* 공유 노트 손필기 — 유료 필기 앱처럼
   펜: 볼펜·만년필(펜촉 각도)·붓펜(필압·끝이 가늘게)·연필(종이 결)·마커, 형광펜, 레이저 포인터(잠깐 보였다 사라짐)
   도구: 지우개(크기 3), 올가미(골라서 옮기기·크기 바꾸기·복제·색 바꾸기·지우기), 도형(직선·화살표·네모·동그라미·세모), 글상자, 사진 넣기
   그리고 멈추기: 펜으로 그린 뒤 0.6초 멈추면 반듯한 직선·동그라미·네모로 바꿔 줌
   쪽: 무지·줄·좁은 줄·모눈·수학(5mm)·점·코넬·오선지·원고지, PDF·사진을 쪽으로 가져와 그 위에 필기, 쪽 넣기·지우기·모양 바꾸기, 쪽 목록
   내보내기: 쪽을 그림(PNG)으로, 노트 전체를 PDF로
   함께 쓰기: 친구가 그리는 획이 그리는 중에도 이름표와 함께 보이고, 저장되면 모두에게 반영 (웹소켓, 안 되면 2초마다)
   쪽 좌표는 늘 가로 1000 × 세로 1414 (A4) */
(function () {
  "use strict";
  const A = window.App, esc = A.esc;
  const W = 1000, H = 1414;
  // 펜 종류 (열 가지). 모양이 다 다르게 그려진다
  const PENS = { ball: ["볼펜", "🖊️", "고른 굵기"], gel: ["젤펜", "🖋️", "진하고 매끈"], fountain: ["만년필", "✒️", "방향 따라 굵기"], calli: ["캘리그라피", "🪶", "넓적한 펜촉"],
    brush: ["붓펜", "🖌️", "꾹 누르면 굵게"], pencil: ["연필", "✏️", "종이 결"], crayon: ["크레파스", "🖍️", "거친 질감"], marker: ["마커", "🟦", "굵고 납작"],
    neon: ["네온펜", "💡", "빛나는 선"], dash: ["점선펜", "┅", "점선"] };
  const TOOLS = [["pen", "🖊️", "펜"], ["hl", "🟨", "형광펜"], ["eraser", "🧽", "지우개"], ["lasso", "➰", "올가미"], ["shape", "🔷", "도형"], ["text", "🔤", "글상자"], ["laser", "🔴", "레이저"]];
  const PALETTE = ["#191f28", "#4e5968", "#3182f6", "#1b3f8f", "#f04452", "#15c47e", "#fe9800", "#8b5cf6", "#ec4899", "#a16207"];
  const HLP = ["#ffe066", "#9ae6b4", "#90cdf4", "#fbb6ce", "#fdba74", "#c4b5fd"];
  const SHAPES = [["line", "╱", "직선"], ["arrow", "↗", "화살표"], ["rect", "▭", "네모"], ["ellipse", "◯", "동그라미"], ["tri", "△", "세모"]];
  const TEMPLATES = [["blank", "무지"], ["lined", "줄 노트"], ["narrow", "좁은 줄"], ["grid", "모눈"], ["math", "수학 (5mm 모눈)"], ["dots", "점 노트"], ["cornell", "코넬 노트"], ["music", "오선지"], ["manuscript", "원고지"]];
  const RANGE = { ball: [1, 8], gel: [1, 8], fountain: [1.5, 10], calli: [3, 18], brush: [2, 16], pencil: [1, 8], crayon: [3, 18], marker: [3, 20], neon: [2, 10], dash: [1, 8], hl: [10, 50], shape: [1, 12], text: [12, 72] };
  const ERASERS = [10, 22, 44];
  const DEF = { tool: "pen", pen: "ball", shape: "rect", color: { pen: "#191f28", hl: "#ffe066", shape: "#3182f6", text: "#191f28" },
    width: { ball: 2.6, gel: 3, fountain: 3.4, calli: 8, brush: 6, pencil: 2.4, crayon: 8, marker: 7, neon: 4, dash: 3, hl: 24, shape: 3, text: 26 }, eraser: 1, zoom: 1, penOnly: false, snap: true };
  const saved = JSON.parse(localStorage.getItem("es.ink2") || "{}");
  const P = Object.assign({}, DEF, saved, { color: Object.assign({}, DEF.color, saved.color), width: Object.assign({}, DEF.width, saved.width) });
  const save = () => localStorage.setItem("es.ink2", JSON.stringify(P));
  const I = (window.Ink = { st: null });
  const colorKey = () => (P.tool === "pen" ? "pen" : P.tool);
  const widthKey = () => (P.tool === "pen" ? P.pen : P.tool);

  // ═════════ 시작·끝 ═════════
  I.mount = async (box, note) => {
    I.unmount();
    const s = (I.st = { id: note.id, box, canWrite: A.canWrite(), layout: [{ bg: "lined" }], strokes: new Map(), hidden: new Set(), live: new Map(),
      undo: [], redo: [], rev: 0, cur: null, erase: null, lasso: null, sel: null, pan: null, laser: null, touches: new Map(), pinch: null, els: [], visible: new Set(), raf: 0, pollT: 0, dead: false });
    box.innerHTML = `<div class="ink-tb" id="ink-tb"></div><div class="ink-wrap"><aside class="ink-side" id="ink-side" hidden></aside><div class="ink-scroll" id="ink-scroll"><div class="ink-pages" id="ink-pages"><p class="muted center">필기를 불러오는 중…</p></div></div></div>
      <input type="file" id="ink-img" accept="image/*" hidden data-ch="inkImg"><input type="file" id="ink-imp" accept=".pdf,image/*" hidden data-ch="inkImport">`;
    paintTb();
    try { applyData(await A.api(`/api/notes/${s.id}/ink`)); } catch (e) { A.toast(e.message, "err"); return; }
    if (I.st !== s) return;
    paintTb();
    buildPages();
    bind();
    poll();
  };
  I.unmount = () => {
    const s = I.st; if (!s) return;
    s.dead = true; clearTimeout(s.pollT); cancelAnimationFrame(s.raf);
    if (s.io) s.io.disconnect();
    window.removeEventListener("resize", s.onResize);
    document.removeEventListener("keydown", s.onKey);
    document.body.classList.remove("ink-full");
    I.st = null;
  };
  function applyData(r) {
    const s = I.st;
    s.layout = r.layout; s.rev = r.rev;
    const keep = Array.from(s.strokes.values()).filter((x) => x.tmp && !x.id);
    s.strokes = new Map();
    for (const x of r.strokes) s.strokes.set(x.id, prep(x));
    for (const x of keep) s.strokes.set(x.tmp, x);
  }
  const keyOf = (x) => x.id || x.tmp;

  // 겹침·고르기를 빨리 하려고 테두리 상자를 계산해 둔다
  const mctx = document.createElement("canvas").getContext("2d");
  const LH = 1.4;
  // 글상자 줄바꿈: 너비 w 를 넘으면 띄어쓰기에서 (없으면 글자 사이에서) 다음 줄로
  function wrapText(text, size, w) {
    mctx.font = `${size}px Pretendard, sans-serif`;
    const out = [];
    for (const para of String(text).split("\n")) {
      let line = "";
      for (const ch of Array.from(para)) {
        if (mctx.measureText(line + ch).width <= w || !line) { line += ch; continue; }
        const sp = line.lastIndexOf(" ");
        if (ch !== " " && sp > 0 && sp > line.length - 14) { out.push(line.slice(0, sp)); line = line.slice(sp + 1) + ch; }
        else { out.push(line); line = ch === " " ? "" : ch; }
      }
      out.push(line);
    }
    return out;
  }
  function prep(x) {
    if (x.tool === "image") x.box = [x.x, x.y, x.x + x.w, x.y + x.h];
    else if (x.tool === "text") {
      const lines = wrapText(x.text, x.size, x.w || 600);
      x.box = [x.x, x.y, x.x + (x.w || 600), x.y + Math.max(1, lines.length) * x.size * LH];
    } else {
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for (const p of x.pts) { if (p[0] < a) a = p[0]; if (p[1] < b) b = p[1]; if (p[0] > c) c = p[0]; if (p[1] > d) d = p[1]; }
      x.box = [a, b, c, d];
    }
    return x;
  }

  // ═════════ 도구 막대 ═════════
  function toolbar() {
    const s = I.st;
    const right = `<span class="sp-f"></span>
      ${s.canWrite ? `<button class="icon-btn sm" data-act="inkUndo" title="실행 취소 (Ctrl+Z)" aria-label="실행 취소" ${s.undo.length ? "" : "disabled"}>↶</button><button class="icon-btn sm" data-act="inkRedo" title="다시 실행" aria-label="다시 실행" ${s.redo.length ? "" : "disabled"}>↷</button><span class="ink-sep"></span>` : ""}
      <button class="tbx ${A.$("#ink-side") && !A.$("#ink-side").hidden ? "on" : ""}" data-act="inkSide" title="쪽 목록">📑 <b>${s.layout.length}쪽</b></button>
      <span class="ink-zoom"><button class="icon-btn sm" data-act="inkZoom" data-v="-1" aria-label="작게">−</button><button class="zl" data-act="inkZoom" data-v="0" title="화면에 맞추기">${Math.round(P.zoom * 100)}%</button><button class="icon-btn sm" data-act="inkZoom" data-v="1" aria-label="크게">＋</button></span>
      <div class="ink-more"><button class="icon-btn sm" data-act="inkMore" aria-label="더 보기" aria-haspopup="true">⋯</button><div class="ink-pop" id="ink-pop" hidden>
        ${s.canWrite ? `<label class="pop-i"><input type="checkbox" data-ch="inkPenOnly" ${P.penOnly ? "checked" : ""}> ✋ 펜으로만 쓰기 <small>손바닥은 화면 넘기기만</small></label>
        <label class="pop-i"><input type="checkbox" data-ch="inkSnap" ${P.snap ? "checked" : ""}> 📐 그리고 멈추면 도형으로</label>
        <button class="pop-i" data-act="inkTplAll">🗒 모든 쪽 모양 바꾸기</button>` : ""}
        <button class="pop-i" data-act="inkSavePng">🖼 이 쪽을 그림으로 저장</button>
        <button class="pop-i" data-act="inkExportPdf">📕 노트 전체를 PDF로 내보내기</button>
        ${s.canWrite ? `<button class="pop-i danger" data-act="inkClearPage">🗑 이 쪽 모두 지우기</button>` : ""}</div></div>
      <button class="icon-btn sm" data-act="inkFull" title="전체 화면" aria-label="전체 화면">${document.body.classList.contains("ink-full") ? "↙" : "⛶"}</button>`;
    if (!s.canWrite) return `<div class="tb-row"><span class="muted small">다른 반 노트는 보기만 할 수 있어요.</span>${right}</div>`;
    const tools = `<div class="ink-tools" role="radiogroup" aria-label="도구">${TOOLS.map(([k, i, l]) => `<button class="it ${P.tool === k ? "on" : ""}" role="radio" aria-checked="${P.tool === k}" data-act="inkTool" data-v="${k}" title="${l}"><span aria-hidden="true">${k === "pen" ? PENS[P.pen][1] : i}</span><b>${k === "pen" ? PENS[P.pen][0] : l}</b></button>`).join("")}</div>
      <span class="ink-sep"></span><button class="tbx big" data-act="inkAddText" title="쪽 가운데에 글상자 넣기">🔤 <b>글 넣기</b></button><button class="tbx big" data-act="inkPickImg" title="사진 넣기">🖼 <b>사진 넣기</b></button><button class="tbx big" data-act="inkPickImport" title="PDF·사진을 쪽으로 가져오기">📄 <b>PDF 가져오기</b></button>`;
    return `<div class="tb-row">${tools}${right}</div><div class="tb-row opts">${options()}</div>`;
  }
  function colorsHtml(list) {
    const cur = P.color[colorKey()];
    return `<div class="ink-colors" role="radiogroup" aria-label="색">${list.map((c) => `<button class="ic ${c === cur ? "on" : ""}" style="--c:${c}" role="radio" aria-checked="${c === cur}" data-act="inkColor" data-v="${c}" aria-label="색 ${c}"></button>`).join("")}
      <label class="ic custom ${list.includes(cur) ? "" : "on"}" style="--c:${cur}" title="다른 색"><input type="color" value="${cur}" data-ch="inkCustom" aria-label="다른 색 고르기"></label></div>`;
  }
  function sizeHtml() {
    const k = widthKey(), [lo, hi] = RANGE[k], v = P.width[k], col = P.color[colorKey()];
    const dot = Math.min(30, Math.max(3, k === "text" ? v / 2.5 : v * (k === "hl" ? 0.6 : 1.6)));
    return `<label class="ink-size" title="굵기"><span class="sz-dot" style="width:${dot}px;height:${dot}px;background:${col};${k === "hl" ? "opacity:.5;border-radius:3px" : ""}"></span>
      <input type="range" min="${lo}" max="${hi}" step="0.5" value="${v}" data-in="inkWidth" aria-label="${k === "text" ? "글자 크기" : "굵기"}"><output id="ink-w">${k === "text" ? Math.round(v) + "pt" : v.toFixed(1)}</output></label>`;
  }
  function options() {
    switch (P.tool) {
      case "pen": return `<div class="pen-tray" role="radiogroup" aria-label="펜 종류">${Object.entries(PENS).map(([k, [n, , d]]) => `<button class="pen-k ${P.pen === k ? "on" : ""}" role="radio" aria-checked="${P.pen === k}" data-act="inkPen" data-v="${k}" title="${n} · ${d}"><canvas data-pen="${k}" width="120" height="40" aria-hidden="true"></canvas><b>${n}</b></button>`).join("")}</div><span class="ink-sep"></span>${colorsHtml(PALETTE)}${sizeHtml()}`;
      case "hl": return `${colorsHtml(HLP)}${sizeHtml()}<span class="muted small">글씨 밑에 깔려요</span>`;
      case "eraser": return `<div class="chipset">${["작게", "보통", "크게"].map((n, i) => `<button class="pchip ${P.eraser === i ? "on" : ""}" data-act="inkEraser" data-v="${i}"><i class="er-dot" style="width:${6 + i * 6}px;height:${6 + i * 6}px"></i>${n}</button>`).join("")}</div><span class="muted small">닿은 획을 통째로 지워요 · 사진·글상자는 올가미로 지워요</span>`;
      case "lasso": return `<span class="muted small">➰ 지울 것·옮길 것을 동그랗게 감싸세요 → 끌어서 옮기기, 오른쪽 아래 ◢ 를 끌어 크기 바꾸기</span>`;
      case "shape": return `<div class="chipset">${SHAPES.map(([k, i, n]) => `<button class="pchip ${P.shape === k ? "on" : ""}" data-act="inkShape" data-v="${k}"><b class="sh-i">${i}</b>${n}</button>`).join("")}</div><span class="ink-sep"></span>${colorsHtml(PALETTE)}${sizeHtml()}`;
      case "text": return `${colorsHtml(PALETTE)}${sizeHtml()}<button class="pchip" data-act="inkAddText">＋ 가운데에 글상자</button><span class="muted small">쪽을 누른 자리에 글상자가 생겨요 · 있는 글상자를 누르면 고쳐요 · 옮기기·크기는 올가미로</span>`;
      case "laser": return `<span class="muted small">🔴 발표·설명할 때 써요. 친구들 화면에 잠깐 보였다 사라지고 저장되지 않아요.</span>`;
      default: return "";
    }
  }
  function paintTb() {
    const tb = A.$("#ink-tb"); if (!tb || !I.st) return;
    tb.innerHTML = toolbar();
    // 펜 종류마다 진짜 그 펜으로 그린 미리보기
    A.$$("canvas[data-pen]", tb).forEach((c) => {
      const k = c.dataset.pen, ctx = c.getContext("2d"), sc = c.width / 120;
      const pts = Array.from({ length: 26 }, (_, i) => [8 + i * 4.1, 20 + Math.sin(i / 25 * Math.PI * 2) * 10, 0.25 + 0.75 * Math.sin(i / 25 * Math.PI)]);
      drawStroke(ctx, { tool: k, color: P.color.pen, width: Math.min(P.width[k], k === "calli" || k === "crayon" || k === "marker" ? 7 : 4), pts }, sc);
    });
  }

  A.acts.inkTool = (el) => { commitText(); clearSel(); P.tool = el.dataset.v; save(); paintTb(); };
  A.acts.inkPen = (el) => { P.pen = el.dataset.v; save(); paintTb(); };
  A.acts.inkShape = (el) => { P.shape = el.dataset.v; save(); paintTb(); };
  A.acts.inkEraser = (el) => { P.eraser = Number(el.dataset.v); save(); paintTb(); };
  A.acts.inkColor = (el) => setColor(el.dataset.v);
  A.changes.inkCustom = (el) => setColor(el.value);
  function setColor(c) {
    P.color[colorKey()] = c; save();
    const s = I.st;
    if (s && s.sel && P.tool === "lasso") recolorSel(c);
    paintTb();
  }
  A.inputs.inkWidth = (el) => {
    const k = widthKey(); P.width[k] = Number(el.value); save();
    const o = A.$("#ink-w"); if (o) o.textContent = k === "text" ? Math.round(P.width[k]) + "pt" : P.width[k].toFixed(1);
    const d = A.$(".sz-dot"); if (d) { const v = P.width[k], z = Math.min(30, Math.max(3, k === "text" ? v / 2.5 : v * (k === "hl" ? 0.6 : 1.6))); d.style.width = d.style.height = z + "px"; }
  };
  A.changes.inkPenOnly = (el) => { P.penOnly = el.checked; save(); A.toast(P.penOnly ? "펜으로만 써요. 손가락은 화면을 넘겨요." : "손가락으로도 쓸 수 있어요."); };
  A.changes.inkSnap = (el) => { P.snap = el.checked; save(); };
  A.acts.inkMore = () => { const p = A.$("#ink-pop"); if (p) p.hidden = !p.hidden; };
  document.addEventListener("click", (ev) => { const p = A.$("#ink-pop"); if (p && !p.hidden && !ev.target.closest(".ink-more")) p.hidden = true; });
  A.acts.inkFull = () => { document.body.classList.toggle("ink-full"); paintTb(); setTimeout(layout, 60); };
  A.acts.inkZoom = (el) => { const v = Number(el.dataset.v); setZoom(v === 0 ? 1 : Math.round(Math.min(3, Math.max(0.5, P.zoom + v * 0.25)) * 100) / 100); };
  function setZoom(z, cx, cy) {
    const sc = A.$("#ink-scroll"); if (!sc) return;
    const r = sc.getBoundingClientRect();
    cx = cx === undefined ? r.width / 2 : cx - r.left; cy = cy === undefined ? r.height / 2 : cy - r.top;
    const fx = (sc.scrollLeft + cx) / Math.max(1, sc.scrollWidth), fy = (sc.scrollTop + cy) / Math.max(1, sc.scrollHeight);
    P.zoom = z; save();
    layout();
    sc.scrollLeft = fx * sc.scrollWidth - cx; sc.scrollTop = fy * sc.scrollHeight - cy;
    const zl = A.$(".ink-zoom .zl"); if (zl) zl.textContent = Math.round(P.zoom * 100) + "%";
  }

  // ═════════ 쪽 (보이는 쪽에만 캔버스를 붙여 메모리를 아낀다) ═════════
  function buildPages() {
    const s = I.st, box = A.$("#ink-pages");
    if (s.io) s.io.disconnect();
    box.innerHTML = s.layout.map((pg, i) => `<div class="ink-page" data-p="${i}"><span class="pg-n">${i + 1} / ${s.layout.length}${pg.bg === "image" ? (pg.src === "pdf" ? " · PDF" : " · 사진") : ""}</span></div>`).join("") +
      (s.canWrite ? `<div class="ink-add-row"><button class="ink-add" data-act="inkAddPage">＋ 새 페이지</button><button class="ink-add ghost" data-act="inkPickImport">📄 PDF·사진 가져오기</button></div>` : "");
    s.els = A.$$(".ink-page", box);
    s.visible = new Set();
    s.io = new IntersectionObserver((ents) => {
      for (const e of ents) { const i = Number(e.target.dataset.p); if (e.isIntersecting) { s.visible.add(i); attach(i); } else { s.visible.delete(i); detach(i); } }
    }, { root: A.$("#ink-scroll"), rootMargin: "600px 0px" });
    layout();
    s.els.forEach((el) => s.io.observe(el));
    paintSide();
  }
  function pageCssW() { const sc = A.$("#ink-scroll"); return Math.round(Math.min((sc ? sc.clientWidth : 800) - 32, 900) * P.zoom); }
  function layout() {
    const s = I.st; if (!s) return;
    const w = pageCssW(), h = Math.round(w * H / W);
    for (const el of s.els) { el.style.width = w + "px"; el.style.height = h + "px"; }
    for (const i of s.visible) { detach(i); attach(i); }
  }
  function attach(i) {
    const s = I.st, el = s.els[i]; if (!el || el.querySelector("canvas")) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), w = el.clientWidth, h = el.clientHeight;
    for (const cls of ["base", "top"]) { const c = document.createElement("canvas"); c.className = cls; c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); el.appendChild(c); }
    drawBase(i); drawTop(i);
  }
  function detach(i) { const el = I.st.els[i]; if (el) el.querySelectorAll("canvas").forEach((c) => { c.width = 0; c.remove(); }); }
  const scaleOf = (cv) => cv.width / W;

  // ═════════ 그림 불러오기 (사진·PDF 쪽) ═════════
  const IMG = new Map();
  function img(url, onload) {
    if (!url) return null;
    let e = IMG.get(url);
    if (!e) {
      e = { el: new Image(), ok: false, wait: [] };
      e.el.onload = () => { e.ok = true; e.wait.splice(0).forEach((f) => f()); };
      e.el.src = url; IMG.set(url, e);
    }
    if (e.ok) return e.el;
    if (onload && !e.wait.includes(onload)) e.wait.push(onload);
    return null;
  }

  // ═════════ 쪽 배경 ═════════
  function line(ctx, x0, y0, x1, y1) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
  function drawBg(ctx, k, spec, redraw) {
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W * k, H * k);
    const bg = (spec && spec.bg) || "lined";
    ctx.save();
    const lw = (v) => Math.max(0.6, v * k);
    if (bg === "image") {
      const im = img(spec.url, redraw);
      if (im) {
        const r = Math.min(W / im.naturalWidth, H / im.naturalHeight), w = im.naturalWidth * r, h = im.naturalHeight * r;
        ctx.drawImage(im, (W - w) / 2 * k, (H - h) / 2 * k, w * k, h * k);
      } else { ctx.fillStyle = "#f2f4f6"; ctx.fillRect(0, 0, W * k, H * k); ctx.fillStyle = "#8b95a1"; ctx.font = `${24 * k}px sans-serif`; ctx.fillText("불러오는 중…", 40 * k, 60 * k); }
    } else if (bg === "lined" || bg === "narrow") {
      const gap = bg === "lined" ? 46 : 32;
      ctx.strokeStyle = "#d6e2f0"; ctx.lineWidth = lw(1.2);
      for (let y = 130; y < H - 40; y += gap) line(ctx, 0, y * k, W * k, y * k);
      ctx.strokeStyle = "#f4bcc2"; line(ctx, 90 * k, 0, 90 * k, H * k);
    } else if (bg === "grid") {
      ctx.strokeStyle = "#e1e8f0"; ctx.lineWidth = lw(1);
      for (let x = 40; x < W; x += 40) line(ctx, x * k, 0, x * k, H * k);
      for (let y = 40; y < H; y += 40) line(ctx, 0, y * k, W * k, y * k);
    } else if (bg === "math") {
      const g = 1000 / 210 * 5; // A4 의 5mm
      for (let i = 0, x = 0; x < W; i++, x += g) { ctx.strokeStyle = i % 5 ? "#e6eef7" : "#bcd0e8"; ctx.lineWidth = lw(i % 5 ? 0.8 : 1.3); line(ctx, x * k, 0, x * k, H * k); }
      for (let i = 0, y = 0; y < H; i++, y += g) { ctx.strokeStyle = i % 5 ? "#e6eef7" : "#bcd0e8"; ctx.lineWidth = lw(i % 5 ? 0.8 : 1.3); line(ctx, 0, y * k, W * k, y * k); }
    } else if (bg === "dots") {
      ctx.fillStyle = "#c3cedb";
      for (let x = 40; x < W; x += 40) for (let y = 40; y < H; y += 40) { ctx.beginPath(); ctx.arc(x * k, y * k, Math.max(0.8, 1.7 * k), 0, 7); ctx.fill(); }
    } else if (bg === "cornell") {
      ctx.strokeStyle = "#d6e2f0"; ctx.lineWidth = lw(1.1);
      for (let y = 190; y < 1150; y += 40) line(ctx, 290 * k, y * k, W * k, y * k);
      ctx.strokeStyle = "#9db6d6"; ctx.lineWidth = lw(2);
      line(ctx, 0, 150 * k, W * k, 150 * k); line(ctx, 280 * k, 150 * k, 280 * k, 1160 * k); line(ctx, 0, 1160 * k, W * k, 1160 * k);
      ctx.fillStyle = "#9db6d6"; ctx.font = `600 ${20 * k}px Pretendard, sans-serif`;
      ctx.fillText("제목 · 날짜", 30 * k, 60 * k); ctx.fillText("핵심어 · 질문", 24 * k, 190 * k); ctx.fillText("필기", 310 * k, 180 * k); ctx.fillText("요약", 30 * k, 1200 * k);
    } else if (bg === "music") {
      ctx.strokeStyle = "#b9c4d0"; ctx.lineWidth = lw(1.1);
      for (let y0 = 110; y0 + 48 < H - 40; y0 += 112) for (let j = 0; j < 5; j++) line(ctx, 60 * k, (y0 + j * 12) * k, (W - 60) * k, (y0 + j * 12) * k);
    } else if (bg === "manuscript") {
      const cell = 44, gx = (W - 20 * cell) / 2;
      ctx.strokeStyle = "#9fd4b2"; ctx.lineWidth = lw(1.2);
      for (let r = 0, y = 90; r < 22; r++, y += cell + 12) { for (let c = 0; c < 20; c++) ctx.strokeRect((gx + c * cell) * k, y * k, cell * k, cell * k); }
      ctx.lineWidth = lw(2); ctx.strokeRect((gx - 8) * k, 80 * k, (20 * cell + 16) * k, (22 * (cell + 12) + 2) * k);
    }
    ctx.restore();
  }

  // ═════════ 펜 그리기 ═════════
  const grains = {};
  function grainPattern(ctx, rough) {
    const key = rough ? "c" : "p";
    if (!grains[key]) {
      const gc = document.createElement("canvas"); gc.width = gc.height = 96;
      const g = gc.getContext("2d"), d = g.createImageData(96, 96);
      let seed = rough ? 11 : 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
        const i = (y * 96 + x) * 4;
        // 크레파스: 가로 결이 굵게 빠진다
        const hole = rough ? (rnd() < 0.3 || (y % 5 === 0 && rnd() < 0.7)) : rnd() < 0.42;
        d.data[i + 3] = hole ? 140 + rnd() * 115 : 0;
      }
      g.putImageData(d, 0, 0);
      grains[key] = gc;
    }
    return ctx.createPattern(grains[key], "repeat");
  }
  function smooth(ctx, p, k) {
    ctx.beginPath(); ctx.moveTo(p[0][0] * k, p[0][1] * k);
    if (p.length === 1) ctx.lineTo(p[0][0] * k + 0.1, p[0][1] * k);
    for (let i = 1; i < p.length - 1; i++) ctx.quadraticCurveTo(p[i][0] * k, p[i][1] * k, (p[i][0] + p[i + 1][0]) / 2 * k, (p[i][1] + p[i + 1][1]) / 2 * k);
    if (p.length > 1) ctx.lineTo(p[p.length - 1][0] * k, p[p.length - 1][1] * k);
  }
  const scratch = document.createElement("canvas");
  function path(ctx, p, k, widthAt) {
    // 점 사이 가운데를 이어 부드럽게, 마디마다 굵기를 바꾼다
    if (p.length === 1) { ctx.beginPath(); ctx.arc(p[0][0] * k, p[0][1] * k, widthAt(0) / 2, 0, 7); ctx.fill(); return; }
    if (p.length === 2) { ctx.lineWidth = widthAt(1); line(ctx, p[0][0] * k, p[0][1] * k, p[1][0] * k, p[1][1] * k); return; }
    let px = p[0][0] * k, py = p[0][1] * k;
    for (let i = 1; i < p.length - 1; i++) {
      const b = p[i], c = p[i + 1], mx = (b[0] + c[0]) / 2 * k, my = (b[1] + c[1]) / 2 * k;
      ctx.lineWidth = widthAt(i);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(b[0] * k, b[1] * k, mx, my); ctx.stroke();
      px = mx; py = my;
    }
    const z = p[p.length - 1];
    ctx.lineWidth = widthAt(p.length - 1); line(ctx, px, py, z[0] * k, z[1] * k);
  }
  function drawStroke(ctx, st, k, alpha) {
    if (st.tool === "image") return drawImageObj(ctx, st, k);
    if (st.tool === "text") return drawText(ctx, st, k);
    const p = st.pts; if (!p || !p.length) return;
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = ctx.fillStyle = st.color;
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    const w = st.width * k, n = p.length;
    if (st.shape) {
      ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(p[0][0] * k, p[0][1] * k);
      for (let i = 1; i < n; i++) ctx.lineTo(p[i][0] * k, p[i][1] * k);
      ctx.stroke();
    } else if (st.tool === "hl") {
      ctx.globalAlpha = (alpha === undefined ? 1 : alpha) * 0.42; ctx.globalCompositeOperation = "multiply"; ctx.lineWidth = w; ctx.lineCap = "butt";
      ctx.beginPath(); ctx.moveTo(p[0][0] * k, p[0][1] * k);
      if (n === 1) ctx.lineTo(p[0][0] * k + 0.1, p[0][1] * k);
      for (let i = 1; i < n - 1; i++) ctx.quadraticCurveTo(p[i][0] * k, p[i][1] * k, (p[i][0] + p[i + 1][0]) / 2 * k, (p[i][1] + p[i + 1][1]) / 2 * k);
      if (n > 1) ctx.lineTo(p[n - 1][0] * k, p[n - 1][1] * k);
      ctx.stroke();
    } else if (st.tool === "laser") {
      ctx.shadowColor = "#ff2d2d"; ctx.shadowBlur = 14 * k; ctx.strokeStyle = ctx.fillStyle = "#ff3b3b";
      path(ctx, p, k, () => 5 * k);
      ctx.shadowBlur = 0; ctx.strokeStyle = ctx.fillStyle = "#ffd9d9"; path(ctx, p, k, () => 1.8 * k);
    } else if (st.tool === "neon") {
      ctx.shadowColor = st.color; ctx.shadowBlur = 14 * k;
      path(ctx, p, k, () => w * 1.6);
      ctx.shadowBlur = 0; ctx.globalAlpha = (alpha === undefined ? 1 : alpha) * 0.9; ctx.strokeStyle = ctx.fillStyle = "#fff";
      path(ctx, p, k, () => w * 0.5);
    } else if (st.tool === "dash") {
      ctx.lineWidth = w; ctx.setLineDash([w * 2.6, w * 2.2]); smooth(ctx, p, k); ctx.stroke();
    } else if (st.tool === "gel") {
      ctx.globalAlpha = (alpha === undefined ? 1 : alpha) * 0.97;
      path(ctx, p, k, (i) => w * (0.95 + 0.25 * p[i][2]));
      ctx.globalAlpha = 0.25; ctx.strokeStyle = "#fff"; path(ctx, p, k, () => Math.max(0.6, w * 0.18)); // 젤 잉크의 반짝임
    } else if (st.tool === "calli") {
      // 넓적한 펜촉(30도): 가로는 가늘고 세로는 굵다
      path(ctx, p, k, (i) => {
        const a = p[Math.max(0, i - 1)], b = p[Math.min(n - 1, i + 1)], ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        return w * (0.12 + 0.95 * Math.abs(Math.sin(ang - Math.PI / 6))) * (0.7 + 0.5 * p[i][2]);
      });
    } else if (st.tool === "marker") {
      ctx.globalAlpha = (alpha === undefined ? 1 : alpha) * 0.92;
      path(ctx, p, k, () => w);
    } else if (st.tool === "fountain") {
      // 펜촉이 45도로 기울어진 만년필: 방향에 따라 굵기가 바뀐다
      path(ctx, p, k, (i) => {
        const a = p[Math.max(0, i - 1)], b = p[Math.min(n - 1, i + 1)], ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        return w * (0.3 + 1.1 * p[i][2]) * (0.38 + 0.62 * Math.abs(Math.sin(ang - Math.PI / 4)));
      });
    } else if (st.tool === "brush") {
      path(ctx, p, k, (i) => { const t = Math.min(i, n - 1 - i) / Math.max(1, Math.min(10, n / 4)); return w * (0.12 + 1.75 * Math.pow(p[i][2], 1.2)) * Math.min(1, 0.25 + t); });
    } else if (st.tool === "pencil" || st.tool === "crayon") {
      // 연필: 따로 그린 뒤 종이 결을 깎아 내고 붙인다
      const bx = (st.id && st.box) || prep(st).box, pad = w * 2 + 4;
      const x0 = Math.floor(bx[0] * k - pad), y0 = Math.floor(bx[1] * k - pad), cw = Math.ceil((bx[2] - bx[0]) * k + pad * 2), ch = Math.ceil((bx[3] - bx[1]) * k + pad * 2);
      if (cw > 0 && ch > 0 && cw * ch < 16e6) {
        scratch.width = cw; scratch.height = ch;
        const g = scratch.getContext("2d");
        g.translate(-x0, -y0); g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = g.fillStyle = st.color;
        const cr = st.tool === "crayon";
        path(g, p, k, (i) => w * (cr ? 0.9 + 0.3 * p[i][2] : 0.55 + 0.6 * p[i][2]));
        g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "destination-out"; g.fillStyle = grainPattern(g, cr); g.fillRect(0, 0, cw, ch);
        ctx.globalAlpha = (alpha === undefined ? 1 : alpha) * 0.88; ctx.drawImage(scratch, x0, y0);
      }
    } else if (st.tool === "ball") {
      path(ctx, p, k, (i) => w * (0.82 + 0.36 * p[i][2]));
    } else {
      path(ctx, p, k, (i) => w * (0.35 + 1.1 * p[i][2])); // 예전 '펜'
    }
    ctx.restore();
  }
  function drawImageObj(ctx, st, k) {
    const im = img(st.url, () => { const s = I.st; if (s && s.visible.has(st.page)) drawBase(st.page); });
    if (im) ctx.drawImage(im, st.x * k, st.y * k, st.w * k, st.h * k);
    else { ctx.fillStyle = "#eef1f5"; ctx.fillRect(st.x * k, st.y * k, st.w * k, st.h * k); }
  }
  function drawText(ctx, st, k) {
    if (st.editing) return;
    ctx.save(); ctx.fillStyle = st.color; ctx.font = `${st.size * k}px Pretendard, sans-serif`; ctx.textBaseline = "top";
    wrapText(st.text, st.size, st.w || 600).forEach((l, i) => ctx.fillText(l, st.x * k, (st.y + i * st.size * LH + st.size * 0.1) * k));
    ctx.restore();
  }
  function pageItems(i) { const s = I.st; return Array.from(s.strokes.values()).filter((x) => x.page === i && !s.hidden.has(keyOf(x))); }
  function drawItems(ctx, list, k) {
    for (const x of list) if (x.tool === "image") drawStroke(ctx, x, k);   // 사진 → 형광펜 → 글씨 순서
    for (const x of list) if (x.tool === "hl") drawStroke(ctx, x, k);
    for (const x of list) if (x.tool !== "hl" && x.tool !== "image") drawStroke(ctx, x, k);
  }
  function drawBase(i) {
    const s = I.st, el = s.els[i], cv = el && el.querySelector("canvas.base"); if (!cv) return;
    const ctx = cv.getContext("2d"), k = scaleOf(cv);
    drawBg(ctx, k, s.layout[i], () => { if (I.st === s && s.visible.has(i)) drawBase(i); });
    drawItems(ctx, pageItems(i), k);
  }
  function drawTop(i) {
    const s = I.st, el = s.els[i], cv = el && el.querySelector("canvas.top"); if (!cv) return;
    const ctx = cv.getContext("2d"), k = scaleOf(cv), now = Date.now();
    ctx.clearRect(0, 0, cv.width, cv.height);
    let fading = false;
    for (const lv of s.live.values()) {
      if (lv.page !== i || !lv.pts.length) continue;
      let a;
      if (lv.tool === "laser") { a = 1 - Math.max(0, now - lv.t - 400) / 900; if (a <= 0) continue; fading = true; }
      drawStroke(ctx, lv, k, a);
      const last = lv.pts[lv.pts.length - 1];
      ctx.save(); ctx.font = `700 ${Math.round(15 * k * 1.1)}px Pretendard, sans-serif`;
      const tw = ctx.measureText(lv.by.name).width, x = last[0] * k + 12 * k, y = last[1] * k - 14 * k;
      ctx.globalAlpha = a === undefined ? 1 : a;
      ctx.fillStyle = lv.by.color; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x - 6 * k, y - 17 * k, tw + 12 * k, 23 * k, 7 * k); else ctx.rect(x - 6 * k, y - 17 * k, tw + 12 * k, 23 * k); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.fillText(lv.by.name, x, y); ctx.restore();
    }
    if (s.laser && s.laser.page === i) { const a = 1 - Math.max(0, now - s.laser.t - 400) / 900; if (a > 0) { drawStroke(ctx, s.laser, k, a); fading = true; } }
    if (s.cur && s.cur.page === i) drawStroke(ctx, s.cur, k);
    if (s.erase && s.erase.page === i && s.erase.at) {
      ctx.save(); ctx.strokeStyle = "rgba(25,31,40,.55)"; ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(s.erase.at[0] * k, s.erase.at[1] * k, eraserR() * k, 0, 7); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    if (s.lasso && s.lasso.page === i) {
      ctx.save(); ctx.setLineDash([6, 5]); ctx.strokeStyle = "#3182f6"; ctx.lineWidth = 1.6; ctx.fillStyle = "rgba(49,130,246,.07)";
      ctx.beginPath(); s.lasso.pts.forEach((q, j) => (j ? ctx.lineTo(q[0] * k, q[1] * k) : ctx.moveTo(q[0] * k, q[1] * k))); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    if (s.sel && s.sel.page === i) {
      const t = s.sel.t, items = s.sel.items.map((x) => transform(x, t));
      drawItems(ctx, items, k);
      const b = tbox(s.sel.box, t);
      ctx.save(); ctx.setLineDash([6, 4]); ctx.strokeStyle = "#3182f6"; ctx.lineWidth = 1.5;
      ctx.strokeRect((b[0] - 8) * k, (b[1] - 8) * k, (b[2] - b[0] + 16) * k, (b[3] - b[1] + 16) * k);
      ctx.setLineDash([]); ctx.fillStyle = "#3182f6";
      ctx.beginPath(); ctx.moveTo((b[2] + 8) * k, (b[3] + 8) * k); ctx.lineTo((b[2] + 8) * k, (b[3] - 22) * k); ctx.lineTo((b[2] - 22) * k, (b[3] + 8) * k); ctx.fill();
      ctx.restore();
    }
    if (fading) scheduleTop(i, true);
  }
  function redrawAll() { const s = I.st; if (!s) return; for (const i of s.visible) { drawBase(i); drawTop(i); } }
  function redrawPages(pages) { const s = I.st; for (const i of pages) if (s.visible.has(i)) drawBase(i); }
  function scheduleTop(i) {
    const s = I.st; if (!s) return; s.dirtyTop = s.dirtyTop || new Set(); s.dirtyTop.add(i);
    if (s.raf) return;
    s.raf = requestAnimationFrame(() => { s.raf = 0; const d = Array.from(s.dirtyTop); s.dirtyTop.clear(); for (const p of d) drawTop(p); });
  }
  const eraserR = () => ERASERS[P.eraser] / Math.min(P.zoom, 1.5);

  // ═════════ 옮기기·크기 바꾸기 ═════════
  function transform(x, t) {
    if (!t || (t.dx === 0 && t.dy === 0 && t.s === 1)) return x;
    const f = (px, py) => [t.ox + (px - t.ox) * t.s + t.dx, t.oy + (py - t.oy) * t.s + t.dy];
    const y = Object.assign({}, x);
    if (x.tool === "image") { const [a, b] = f(x.x, x.y); Object.assign(y, { x: a, y: b, w: x.w * t.s, h: x.h * t.s }); }
    else if (x.tool === "text") { const [a, b] = f(x.x, x.y); Object.assign(y, { x: a, y: b, size: x.size * t.s, w: (x.w || 600) * t.s }); }
    else { y.pts = x.pts.map((p) => { const [a, b] = f(p[0], p[1]); return [a, b, p[2]]; }); y.width = Math.max(0.5, x.width * (0.5 + 0.5 * t.s)); }
    return prep(y);
  }
  function tbox(b, t) { if (!t) return b; const f = (px, py) => [t.ox + (px - t.ox) * t.s + t.dx, t.oy + (py - t.oy) * t.s + t.dy]; const [a, c] = f(b[0], b[1]), [d, e] = f(b[2], b[3]); return [a, c, d, e]; }

  // ═════════ 펜·손가락 입력 ═════════
  function toPage(el, e) {
    const r = el.getBoundingClientRect();
    const pr = e.pointerType === "pen" ? (e.pressure || 0.5) : e.pointerType === "touch" && e.pressure > 0 && e.pressure !== 0.5 ? e.pressure : 0.5;
    return [Math.round((e.clientX - r.left) / r.width * W * 10) / 10, Math.round((e.clientY - r.top) / r.height * H * 10) / 10, Math.round(Math.pow(pr, 0.8) * 100) / 100];
  }
  function bind() {
    const s = I.st, box = A.$("#ink-pages"), sc = A.$("#ink-scroll");
    s.onResize = () => { clearTimeout(s.rT); s.rT = setTimeout(layout, 150); };
    window.addEventListener("resize", s.onResize);
    box.addEventListener("pointerdown", down);
    box.addEventListener("pointermove", move);
    box.addEventListener("pointerup", up);
    box.addEventListener("pointercancel", up);
    box.addEventListener("contextmenu", (e) => { if (e.target.closest(".ink-page")) e.preventDefault(); });
    sc.addEventListener("wheel", (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(Math.min(3, Math.max(0.5, P.zoom * (e.deltaY < 0 ? 1.1 : 0.9))), e.clientX, e.clientY); } }, { passive: false });
    document.addEventListener("keydown", (s.onKey = (e) => {
      if (I.st !== s || e.target.matches("input,textarea,select")) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); A.acts.inkUndo(); }
      if ((e.ctrlKey || e.metaKey) && ((e.key === "z" && e.shiftKey) || e.key === "y")) { e.preventDefault(); A.acts.inkRedo(); }
      if ((e.key === "Delete" || e.key === "Backspace") && s.sel) { e.preventDefault(); A.acts.inkSelDel(); }
      if (e.key === "Escape" && s.sel) clearSel();
    }));
  }
  function down(e) {
    const s = I.st, pg = e.target.closest(".ink-page");
    if (!pg || e.target.closest(".sel-bar, .ink-text")) return;
    e.preventDefault();
    if (e.pointerType === "pen" && !P.penOnly && s.canWrite) { P.penOnly = true; save(); A.toast("펜을 찾았어요 ✏️ 이제 손가락은 화면을 넘기는 데만 써요. (⋯ 에서 끌 수 있어요)"); }
    if (e.pointerType === "touch") {
      s.touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (s.touches.size === 2) {
        if (s.cur && s.cur.touch) { s.cur = null; scheduleTop(Number(pg.dataset.p)); }
        const [a, b] = Array.from(s.touches.values());
        s.pinch = { d0: Math.hypot(a[0] - b[0], a[1] - b[1]), z0: P.zoom }; s.pan = null; return;
      }
      if (P.penOnly || !s.canWrite) { s.pan = { id: e.pointerId, x: e.clientX, y: e.clientY }; return; }
    }
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!s.canWrite) { s.pan = { id: e.pointerId, x: e.clientX, y: e.clientY }; return; }
    if (s.cur || s.erase || s.lasso || (s.sel && s.sel.drag)) return;
    try { pg.setPointerCapture(e.pointerId); } catch (x) { /* 무시 */ }
    const page = Number(pg.dataset.p), pt = toPage(pg, e), tool = P.tool;
    if (tool !== "text") commitText();
    if (tool === "lasso") {
      if (s.sel && s.sel.page === page) {
        const b = tbox(s.sel.box, s.sel.t), hs = 34 / Math.min(P.zoom, 1.5);
        if (Math.abs(pt[0] - (b[2] + 8)) < hs && Math.abs(pt[1] - (b[3] + 8)) < hs) { s.sel.drag = { pid: e.pointerId, mode: "scale", el: pg, start: pt, t0: Object.assign({}, s.sel.t) }; return; }
        if (pt[0] > b[0] - 10 && pt[0] < b[2] + 10 && pt[1] > b[1] - 10 && pt[1] < b[3] + 10) { s.sel.drag = { pid: e.pointerId, mode: "move", el: pg, start: pt, t0: Object.assign({}, s.sel.t) }; hideSelBar(); return; }
      }
      clearSel();
      s.lasso = { pid: e.pointerId, page, el: pg, pts: [pt] }; scheduleTop(page); return;
    }
    if (tool === "eraser") { s.erase = { pid: e.pointerId, page, el: pg, ids: [], at: pt }; eraseAt(pt); scheduleTop(page); return; }
    if (tool === "text") { textAt(page, pg, pt); return; }
    if (tool === "laser") { s.laser = { pid: e.pointerId, el: pg, tmp: "L" + Date.now().toString(36), page, tool: "laser", color: "#ff3b3b", width: 5, pts: [pt], sent: 0, lastSend: 0, t: Date.now() }; scheduleTop(page); return; }
    clearSel();
    const pen = tool === "pen" ? P.pen : tool === "shape" ? "ball" : "hl";
    s.cur = { pid: e.pointerId, touch: e.pointerType === "touch", el: pg, tmp: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), page, tool: pen,
      color: P.color[colorKey()], width: P.width[widthKey()], pts: [pt], sent: 0, lastSend: 0, shapeTool: tool === "shape", start: pt, lastMove: Date.now() };
    scheduleTop(page);
  }
  function move(e) {
    const s = I.st; if (!s) return;
    if (e.pointerType === "touch" && s.touches.has(e.pointerId)) {
      s.touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (s.pinch && s.touches.size === 2) {
        const [a, b] = Array.from(s.touches.values()), d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const z = Math.round(Math.min(3, Math.max(0.5, s.pinch.z0 * d / s.pinch.d0)) * 100) / 100;
        if (Math.abs(z - P.zoom) >= 0.04) setZoom(z, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        return;
      }
    }
    if (s.pan && s.pan.id === e.pointerId) { const sc = A.$("#ink-scroll"); sc.scrollTop -= e.clientY - s.pan.y; sc.scrollLeft -= e.clientX - s.pan.x; s.pan.x = e.clientX; s.pan.y = e.clientY; return; }
    const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
    const list = evs.length ? evs : [e];
    if (s.cur && s.cur.pid === e.pointerId) {
      const c = s.cur;
      if (c.snapped) return;
      if (c.shapeTool) { c.pts = shapePts(P.shape, c.start, toPage(c.el, e)); c.shape = true; scheduleTop(c.page); return; }
      for (const ev of list) {
        const pt = toPage(c.el, ev), last = c.pts[c.pts.length - 1];
        if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) < 0.8) continue;
        c.pts.push(pt);
        if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) > 2) c.lastMove = Date.now();
      }
      if (c.pts.length > 3900) return up(e);
      scheduleTop(c.page);
      if (Date.now() - c.lastSend > 40) sendLive(false, c);
      if (P.snap && c.tool !== "hl") { clearTimeout(s.holdT); s.holdT = setTimeout(() => holdCheck(c), 650); }
    } else if (s.laser && s.laser.pid === e.pointerId) {
      for (const ev of list) s.laser.pts.push(toPage(s.laser.el, ev));
      if (s.laser.pts.length > 300) s.laser.pts = s.laser.pts.slice(-300);
      s.laser.t = Date.now();
      scheduleTop(s.laser.page);
      if (Date.now() - s.laser.lastSend > 40) sendLive(false, s.laser);
    } else if (s.erase && s.erase.pid === e.pointerId) {
      for (const ev of list) { const pt = toPage(s.erase.el, ev); s.erase.at = pt; eraseAt(pt); }
      scheduleTop(s.erase.page);
    } else if (s.lasso && s.lasso.pid === e.pointerId) {
      for (const ev of list) s.lasso.pts.push(toPage(s.lasso.el, ev));
      scheduleTop(s.lasso.page);
    } else if (s.sel && s.sel.drag && s.sel.drag.pid === e.pointerId) {
      const dr = s.sel.drag, pt = toPage(dr.el, e);
      if (dr.mode === "move") s.sel.t = Object.assign({}, dr.t0, { dx: dr.t0.dx + pt[0] - dr.start[0], dy: dr.t0.dy + pt[1] - dr.start[1] });
      else {
        const b = s.sel.box, w0 = b[2] - b[0] || 1, h0 = b[3] - b[1] || 1;
        const sx = (pt[0] - dr.t0.ox - dr.t0.dx) / (b[2] - dr.t0.ox || 1), sy = (pt[1] - dr.t0.oy - dr.t0.dy) / (b[3] - dr.t0.oy || 1);
        s.sel.t = Object.assign({}, dr.t0, { s: Math.max(0.15, Math.min(6, Math.max(sx, sy))) });
        void w0; void h0;
      }
      dr.moved = true;
      scheduleTop(s.sel.page);
    }
  }
  function up(e) {
    const s = I.st; if (!s) return;
    if (e.pointerType === "touch") { s.touches.delete(e.pointerId); if (s.touches.size < 2) s.pinch = null; }
    if (s.pan && s.pan.id === e.pointerId) { s.pan = null; return; }
    if (s.cur && s.cur.pid === e.pointerId) {
      clearTimeout(s.holdT);
      const st = s.cur; s.cur = null;
      if (st.shapeTool && st.pts.length < 2) { scheduleTop(st.page); return; }
      sendLive(true, st);
      const stroke = { page: st.page, tool: st.tool, color: st.color, width: st.width, pts: st.pts, shape: !!st.shape };
      scheduleTop(st.page);
      saveMany([stroke]).then((saved) => { if (saved.length) record({ removed: [], added: saved }); });
    } else if (s.laser && s.laser.pid === e.pointerId) {
      sendLive(true, s.laser); s.laser.pid = null; s.laser.t = Date.now(); scheduleTop(s.laser.page);
    } else if (s.erase && s.erase.pid === e.pointerId) {
      const er = s.erase; s.erase = null; scheduleTop(er.page);
      if (er.ids.length) { const gone = er.ids.map((id) => s.strokes.get(id)).filter(Boolean); delStrokes(er.ids).then((ok) => { if (ok) record({ removed: gone, added: [] }); }); }
    } else if (s.lasso && s.lasso.pid === e.pointerId) {
      const ls = s.lasso; s.lasso = null; finishLasso(ls); scheduleTop(ls.page);
    } else if (s.sel && s.sel.drag && s.sel.drag.pid === e.pointerId) {
      const dr = s.sel.drag; s.sel.drag = null;
      if (dr.moved) commitSel(); else showSelBar();
    }
  }

  // 그리고 멈추기 → 반듯한 도형
  function holdCheck(c) {
    const s = I.st;
    if (!s || s.cur !== c || c.snapped || Date.now() - c.lastMove < 600) return;
    const r = recognize(c.pts);
    if (!r) return;
    c.pts = r; c.shape = true; c.snapped = true;
    if (navigator.vibrate) navigator.vibrate(12);
    scheduleTop(c.page);
    sendLive(false, Object.assign({}, c, { sent: 0, reset: true }));
  }
  function recognize(p) {
    if (p.length < 6) return null;
    const a = p[0], b = p[p.length - 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let len = 0; for (let i = 1; i < p.length; i++) len += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    if (L > 40 && len < L * 1.2) {
      let dmax = 0; for (const q of p) dmax = Math.max(dmax, Math.abs((b[1] - a[1]) * q[0] - (b[0] - a[0]) * q[1] + b[0] * a[1] - b[1] * a[0]) / L);
      if (dmax < Math.max(8, L * 0.06)) return [[a[0], a[1], 0.6], [b[0], b[1], 0.6]];
    }
    if (L < len * 0.22 && len > 120) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const q of p) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2 || 1, ry = (y1 - y0) / 2 || 1;
      let eErr = 0, rErr = 0;
      for (const q of p) {
        eErr += Math.abs(Math.hypot((q[0] - cx) / rx, (q[1] - cy) / ry) - 1);
        rErr += Math.min(Math.abs(q[0] - x0), Math.abs(q[0] - x1), Math.abs(q[1] - y0), Math.abs(q[1] - y1)) / Math.min(rx, ry);
      }
      return shapePts(eErr <= rErr ? "ellipse" : "rect", [x0, y0], [x1, y1]);
    }
    return null;
  }
  function shapePts(kind, a, b) {
    const P6 = (x, y) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10, 0.6];
    const [x0, y0] = a, [x1, y1] = b;
    if (kind === "line") return [P6(x0, y0), P6(x1, y1)];
    if (kind === "arrow") {
      const ang = Math.atan2(y1 - y0, x1 - x0), L = Math.hypot(x1 - x0, y1 - y0), hl = Math.min(36, Math.max(12, L * 0.28)), sp = 0.5;
      return [P6(x0, y0), P6(x1, y1), P6(x1 - hl * Math.cos(ang - sp), y1 - hl * Math.sin(ang - sp)), P6(x1, y1), P6(x1 - hl * Math.cos(ang + sp), y1 - hl * Math.sin(ang + sp))];
    }
    if (kind === "rect") return [P6(x0, y0), P6(x1, y0), P6(x1, y1), P6(x0, y1), P6(x0, y0)];
    if (kind === "tri") return [P6((x0 + x1) / 2, y0), P6(x1, y1), P6(x0, y1), P6((x0 + x1) / 2, y0)];
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
    return Array.from({ length: 61 }, (_, i) => P6(cx + rx * Math.cos(i / 60 * 2 * Math.PI), cy + ry * Math.sin(i / 60 * 2 * Math.PI)));
  }

  // 그리는 중인 획을 친구들에게 (새로 생긴 점만)
  function sendLive(end, st) {
    const s = I.st; if (!st) return;
    if (st.shape && !st.reset) { A.rt.send({ type: "ink_live", noteId: s.id, tmp: st.tmp, page: st.page, tool: st.tool, color: st.color, width: st.width, pts: st.pts.slice(0, 300), shape: true, reset: true, end }); st.lastSend = Date.now(); return; }
    const from = st.reset ? 0 : st.sent, pts = st.pts.slice(from);
    if (!pts.length && !end) return;
    for (let i = 0; i < Math.max(1, pts.length); i += 300) {
      A.rt.send({ type: "ink_live", noteId: s.id, tmp: st.tmp, page: st.page, tool: st.tool, color: st.color, width: st.width, pts: pts.slice(i, i + 300), shape: !!st.shape, reset: !!st.reset && i === 0, end: end && i + 300 >= pts.length });
    }
    st.sent = st.pts.length; st.lastSend = Date.now();
  }

  // ═════════ 지우개 ═════════
  function eraseAt(pt) {
    const s = I.st, r = eraserR(), er = s.erase;
    let hit = false;
    for (const x of s.strokes.values()) {
      if (!x.id || x.page !== er.page || s.hidden.has(x.id) || x.tool === "image" || x.tool === "text") continue;
      const pad = r + x.width / 2;
      if (pt[0] < x.box[0] - pad || pt[0] > x.box[2] + pad || pt[1] < x.box[1] - pad || pt[1] > x.box[3] + pad) continue;
      if (near(x.pts, pt, pad, x.shape)) { s.hidden.add(x.id); er.ids.push(x.id); hit = true; }
    }
    if (hit) drawBase(er.page);
  }
  function near(pts, q, d) {
    if (pts.length === 1) return Math.hypot(pts[0][0] - q[0], pts[0][1] - q[1]) <= d;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L)) : 0;
      if (Math.hypot(a[0] + t * dx - q[0], a[1] + t * dy - q[1]) <= d) return true;
    }
    return false;
  }

  // ═════════ 올가미 ═════════
  function inPoly(x, y, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1] || 1e-9) + a[0]) c = !c;
    }
    return c;
  }
  function finishLasso(ls) {
    const s = I.st;
    if (ls.pts.length < 4) return;
    const picked = [];
    for (const x of s.strokes.values()) {
      if (!x.id || x.page !== ls.page) continue;
      if (x.tool === "image" || x.tool === "text") { if (inPoly((x.box[0] + x.box[2]) / 2, (x.box[1] + x.box[3]) / 2, ls.pts)) picked.push(x); continue; }
      let n = 0; const step = Math.max(1, Math.floor(x.pts.length / 40)), tot = Math.ceil(x.pts.length / step);
      for (let i = 0; i < x.pts.length; i += step) if (inPoly(x.pts[i][0], x.pts[i][1], ls.pts)) n++;
      if (n / tot >= 0.6) picked.push(x);
    }
    if (picked.length) setSel(ls.page, picked); else A.toast("감싼 곳에 필기가 없어요.");
  }
  function setSel(page, items) {
    const s = I.st;
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const x of items) b = [Math.min(b[0], x.box[0]), Math.min(b[1], x.box[1]), Math.max(b[2], x.box[2]), Math.max(b[3], x.box[3])];
    s.sel = { page, items, box: b, t: { dx: 0, dy: 0, s: 1, ox: b[0], oy: b[1] } };
    for (const x of items) s.hidden.add(x.id);
    drawBase(page); scheduleTop(page); showSelBar();
  }
  function clearSel() {
    const s = I.st; if (!s || !s.sel) return;
    for (const x of s.sel.items) s.hidden.delete(x.id);
    const p = s.sel.page; s.sel = null; hideSelBar(); drawBase(p); scheduleTop(p);
  }
  function hideSelBar() { const b = A.$(".sel-bar"); if (b) b.remove(); }
  function showSelBar() {
    const s = I.st; hideSelBar(); if (!s.sel) return;
    const el = s.els[s.sel.page], b = tbox(s.sel.box, s.sel.t), k = el.clientWidth / W;
    const bar = document.createElement("div");
    bar.className = "sel-bar";
    bar.innerHTML = `<span>${s.sel.items.length}개</span><button data-act="inkSelDup">복제</button><button data-act="inkSelColor" title="지금 고른 색으로">색 바꾸기</button><button data-act="inkSelDel" class="danger">지우기</button><button data-act="inkSelDone" aria-label="고르기 끝">✕</button>`;
    el.appendChild(bar);
    bar.style.left = Math.max(4, Math.min(el.clientWidth - bar.offsetWidth - 4, (b[0] - 8) * k)) + "px";
    bar.style.top = Math.max(4, (b[1] - 8) * k - bar.offsetHeight - 8) + "px";
  }
  A.acts.inkSelDone = () => clearSel();
  async function commitSel() {
    const s = I.st, sel = s.sel; if (!sel) return;
    const moved = sel.items.map((x) => transform(x, sel.t));
    s.sel = null; hideSelBar();
    const r = await perform(sel.items, moved);
    record(r);
    if (r.added.length) setSel(sel.page, r.added);
  }
  A.acts.inkSelDel = async () => {
    const s = I.st, sel = s.sel; if (!sel) return;
    s.sel = null; hideSelBar();
    record(await perform(sel.items, []));
    redrawPages([sel.page]); scheduleTop(sel.page);
  };
  A.acts.inkSelDup = async () => {
    const s = I.st, sel = s.sel; if (!sel) return;
    const copies = sel.items.map((x) => transform(x, { dx: 24, dy: 24, s: 1, ox: 0, oy: 0 }));
    clearSel();
    const saved = await saveMany(copies);
    record({ removed: [], added: saved });
    if (saved.length) setSel(sel.page, saved);
  };
  A.acts.inkSelColor = () => recolorSel(P.color.pen);
  async function recolorSel(c) {
    const s = I.st, sel = s.sel; if (!sel) return;
    const items = sel.items.filter((x) => x.tool !== "image");
    if (!items.length) return;
    const changed = items.map((x) => Object.assign({}, x, { color: c }));
    const keep = sel.items.filter((x) => x.tool === "image");
    s.sel = null; hideSelBar();
    const r = await perform(items, changed);
    record(r);
    setSel(sel.page, keep.concat(r.added));
  }

  // ═════════ 글상자 ═════════
  let textEd = null;
  function textAt(page, pg, pt, center) {
    commitText();
    const s = I.st;
    const hit = !center && Array.from(s.strokes.values()).reverse().find((x) => x.id && x.page === page && x.tool === "text" && pt[0] >= x.box[0] - 6 && pt[0] <= x.box[2] + 6 && pt[1] >= x.box[1] - 6 && pt[1] <= x.box[3] + 6);
    const k = pg.clientWidth / W, size = P.width.text;
    const w0 = center ? 700 : Math.max(200, Math.min(640, W - pt[0] - 40));
    const st = hit || { page, tool: "text", text: "", color: P.color.text, size, w: w0, x: center ? (W - w0) / 2 : pt[0], y: center ? pt[1] : Math.max(0, pt[1] - size * 0.6) };
    const ta = document.createElement("textarea");
    ta.className = "ink-text";
    ta.value = st.text;
    ta.placeholder = "여기에 글을 쓰세요";
    Object.assign(ta.style, { left: st.x * k + "px", top: st.y * k + "px", width: (st.w || 600) * k + "px", fontSize: st.size * k + "px", lineHeight: LH, color: st.color });
    pg.appendChild(ta);
    if (hit) { hit.editing = true; drawBase(page); }
    textEd = { ta, st, hit, page };
    const grow = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + 4 + "px"; };
    ta.addEventListener("input", grow);
    ta.addEventListener("pointerdown", (e) => e.stopPropagation());
    ta.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); ta.value = st.text; commitText(); } if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitText(); } e.stopPropagation(); });
    ta.addEventListener("blur", () => setTimeout(commitText, 0));
    setTimeout(() => { ta.focus(); grow(); }, 0);
  }
  // 지금 보고 있는 쪽 가운데에 글상자
  A.acts.inkAddText = () => {
    const s = I.st; if (!s || !s.canWrite) return;
    P.tool = "text"; save(); paintTb();
    const p = currentPage(), pg = s.els[p], sc = A.$("#ink-scroll");
    const r = pg.getBoundingClientRect(), sr = sc.getBoundingClientRect();
    const midY = ((Math.max(r.top, sr.top) + Math.min(r.bottom, sr.bottom)) / 2 - r.top) / r.height * H;
    textAt(p, pg, [W / 2, Math.max(60, Math.min(H - 200, midY - 40)), 0.5], true);
  };
  async function commitText() {
    const t = textEd; if (!t) return;
    textEd = null;
    const text = t.ta.value.replace(/\s+$/, "");
    t.ta.remove();
    if (t.hit) t.hit.editing = false;
    if (t.hit && text === t.hit.text) { drawBase(t.page); return; }
    if (t.hit) record(await perform([t.hit], text ? [Object.assign({}, t.hit, { text, editing: false })] : []));
    else if (text) { const saved = await saveMany([Object.assign({}, t.st, { text })]); record({ removed: [], added: saved }); }
    drawBase(t.page);
  }

  // ═════════ 사진 넣기·PDF 가져오기 ═════════
  A.acts.inkPickImg = () => A.$("#ink-img").click();
  A.acts.inkPickImport = () => A.$("#ink-imp").click();
  A.changes.inkImg = async (el) => {
    const f = el.files && el.files[0]; el.value = "";
    if (!f) return;
    const s = I.st, page = currentPage();
    A.toast("사진을 올리는 중…");
    try {
      const m = await A.upload(f);
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = m.url; });
      const w = Math.min(560, W - 80), h = w * im.naturalHeight / im.naturalWidth;
      const sc = Math.min(1, (H - 80) / h);
      const st = { page, tool: "image", file: m.id, url: m.url, x: (W - w * sc) / 2, y: Math.max(40, (H - h * sc) / 3), w: w * sc, h: h * sc };
      const saved = await saveMany([st]);
      record({ removed: [], added: saved });
      if (saved.length) { P.tool = "lasso"; save(); paintTb(); setSel(page, saved); A.toast("사진을 넣었어요. 끌어서 옮기고 모서리 ◢ 로 크기를 바꿔요."); }
      void s;
    } catch (e) { A.toast(e.message || "사진을 넣지 못했어요.", "err"); }
  };
  A.changes.inkImport = async (el) => {
    const f = el.files && el.files[0]; el.value = "";
    if (!f) return;
    const s = I.st;
    if (f.size > 10 * 1024 * 1024) { A.toast("10MB까지 가져올 수 있어요.", "err"); return; }
    const at = Math.min(s.layout.length, currentPage() + 1);
    const fd = new FormData(); fd.append("file", f); fd.append("at", String(at));
    A.toast(/\.pdf$/i.test(f.name) ? "PDF 쪽을 그림으로 바꾸는 중… 잠깐만요" : "사진을 쪽으로 넣는 중…");
    try {
      const r = await A.api(`/api/notes/${s.id}/import`, { method: "POST", form: fd });
      await reload();
      A.toast(`${r.added}쪽을 넣었어요. 그 위에 바로 필기할 수 있어요.${r.skipped ? ` (30쪽까지만 · ${r.skipped}쪽 빠짐)` : ""}`);
      setTimeout(() => { const e2 = I.st && I.st.els[r.at]; if (e2) e2.scrollIntoView({ behavior: "smooth", block: "start" }); }, 80);
    } catch (e) { A.toast(e.message, "err"); }
  };

  // ═════════ 서버와 주고받기 ═════════
  function strip(x) {
    const o = { tool: x.tool };
    if (x.tool === "image") Object.assign(o, { file: x.file, x: x.x, y: x.y, w: x.w, h: x.h });
    else if (x.tool === "text") Object.assign(o, { text: x.text, color: x.color, x: x.x, y: x.y, size: Math.max(10, Math.min(120, x.size)), w: Math.max(40, Math.min(W, x.w || 600)) });
    else Object.assign(o, { color: x.color, width: x.width, pts: x.pts }, x.shape ? { shape: true } : {});
    return o;
  }
  async function saveMany(list) {
    const s = I.st; if (!list.length) return [];
    const items = list.map((x) => { const tmp = "t" + Math.random().toString(36).slice(2, 10); const local = prep(Object.assign({}, x, { id: undefined, tmp, author: { id: A.me.id, name: A.me.name, color: A.me.color } })); s.strokes.set(tmp, local); return { local, body: { page: x.page, tmp, stroke: strip(x) } }; });
    redrawPages(new Set(list.map((x) => x.page)));
    const out = [];
    for (let i = 0; i < items.length; i += 300) {
      const part = items.slice(i, i + 300);
      let ok = false;
      for (let tries = 0; tries < 3 && !ok; tries++) {
        try {
          const r = await A.api(`/api/notes/${s.id}/ink`, { method: "POST", body: { items: part.map((x) => x.body) } });
          if (I.st !== s) return out;
          for (const x of r.strokes) out.push(settle(x));
          ok = true;
        } catch (e) {
          if (e.status && e.status < 500) { A.toast(e.message, "err"); break; }
          await new Promise((res) => setTimeout(res, 800 * (tries + 1)));
        }
      }
      if (!ok) { for (const x of part) s.strokes.delete(x.local.tmp); redrawAll(); A.toast("필기를 저장하지 못했어요. 인터넷을 확인해 주세요.", "err"); }
    }
    return out;
  }
  function settle(r) {
    const s = I.st;
    if (r.tmp && s.strokes.has(r.tmp)) s.strokes.delete(r.tmp);
    if (r.tmp) s.live.delete(r.tmp);
    let x = s.strokes.get(r.id);
    if (!x) { x = prep(r); s.strokes.set(r.id, x); }
    if (s.visible.has(r.page)) { drawBase(r.page); scheduleTop(r.page); }
    return x;
  }
  async function delStrokes(ids) {
    const s = I.st;
    try {
      for (let i = 0; i < ids.length; i += 2000) await A.api(`/api/notes/${s.id}/ink/delete`, { method: "POST", body: { ids: ids.slice(i, i + 2000) } });
      const pages = new Set();
      for (const id of ids) { const x = s.strokes.get(id); if (x) pages.add(x.page); s.strokes.delete(id); s.hidden.delete(id); }
      redrawPages(pages);
      return true;
    } catch (e) { for (const id of ids) s.hidden.delete(id); redrawAll(); A.toast(e.message, "err"); return false; }
  }
  // 지우고(remove) 넣기(add) → 거꾸로 하는 방법을 돌려준다
  async function perform(remove, add) {
    const s = I.st;
    const ids = remove.map((x) => x.id).filter((id) => id && s.strokes.has(id));
    if (ids.length && !(await delStrokes(ids))) return { removed: [], added: [] };
    const added = add.length ? await saveMany(add) : [];
    return { removed: remove, added };
  }
  function record(op) { const s = I.st; if (!s || (!op.removed.length && !op.added.length)) return; s.undo.push(op); if (s.undo.length > 100) s.undo.shift(); s.redo = []; paintTb(); }
  let busy = false;
  A.acts.inkUndo = async () => { const s = I.st; if (!s || busy || !s.undo.length) return; commitText(); clearSel(); busy = true; const op = s.undo.pop(); s.redo.push(await perform(op.added, op.removed)); busy = false; paintTb(); };
  A.acts.inkRedo = async () => { const s = I.st; if (!s || busy || !s.redo.length) return; busy = true; const op = s.redo.pop(); s.undo.push(await perform(op.added, op.removed)); busy = false; paintTb(); };

  // ═════════ 쪽 관리 ═════════
  function currentPage() {
    const s = I.st, sc = A.$("#ink-scroll"); if (!sc || !s.els.length) return 0;
    const mid = sc.getBoundingClientRect().top + sc.clientHeight / 2;
    let best = 0, bd = Infinity;
    s.els.forEach((el, i) => { const r = el.getBoundingClientRect(), d = Math.abs((r.top + r.bottom) / 2 - mid); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  async function reload() {
    const s = I.st;
    const r = await A.api(`/api/notes/${s.id}/ink`);
    if (I.st !== s) return;
    clearSel(); s.undo = []; s.redo = [];
    applyData(r); paintTb(); buildPages();
  }
  async function pageOp(body) {
    const s = I.st;
    try { await A.api(`/api/notes/${s.id}/pages`, { method: "POST", body }); await reload(); return true; } catch (e) { A.toast(e.message, "err"); return false; }
  }
  function tplPreview(bg) { const c = document.createElement("canvas"); c.width = 120; c.height = Math.round(120 * H / W); drawBg(c.getContext("2d"), 120 / W, { bg }); return c.toDataURL(); }
  function tplPicker(title, cb) {
    A.modal(`<h2>${esc(title)}</h2><div class="tpl-grid">${TEMPLATES.map(([k, n]) => `<button class="tpl" data-act="tplPick" data-v="${k}"><img src="${tplPreview(k)}" alt=""><b>${n}</b></button>`).join("")}</div>
      <div class="dlg-btns"><button class="btn" data-act="closeModal">취소</button>${I.st ? `<button class="btn tinted" data-act="tplImport">📄 PDF·사진으로</button>` : ""}</div>`, "wide");
    A.tplCb = cb;
  }
  I.pickTemplate = (title, cb) => tplPicker(title, cb);
  A.acts.tplPick = (el) => { A.closeModal(); if (A.tplCb) A.tplCb(el.dataset.v); };
  A.acts.tplImport = () => { A.closeModal(); A.acts.inkPickImport(); };
  A.acts.inkAddPage = () => {
    const s = I.st, at = Math.min(s.layout.length, currentPage() + 1), last = s.layout[currentPage()] || { bg: "lined" };
    tplPicker(`${at + 1}쪽에 새 페이지`, async (bg) => { if (await pageOp({ action: "insert", at, bg })) setTimeout(() => { const e = I.st && I.st.els[at]; if (e) e.scrollIntoView({ behavior: "smooth", block: "start" }); }, 80); });
    void last;
  };
  A.acts.inkTplAll = () => tplPicker("모든 쪽 모양 바꾸기 (PDF·사진 쪽은 그대로)", (bg) => pageOp({ action: "setAll", bg }));
  A.acts.inkClearPage = async () => {
    const s = I.st, p = currentPage();
    const gone = Array.from(s.strokes.values()).filter((x) => x.page === p && x.id);
    if (!gone.length) { A.toast("이 쪽은 이미 비어 있어요."); return; }
    if (!(await A.confirm(`${p + 1}쪽 필기를 모두 지울까요?`, "반 친구가 쓴 필기도 지워져요. 실행 취소(↶)로 되돌릴 수 있어요."))) return;
    clearSel(); record(await perform(gone, []));
  };

  // 쪽 목록 (왼쪽)
  A.acts.inkSide = () => { const el = A.$("#ink-side"); el.hidden = !el.hidden; paintSide(); paintTb(); setTimeout(layout, 30); };
  function paintSide() {
    const s = I.st, el = A.$("#ink-side"); if (!el || el.hidden) return;
    const cur = currentPage();
    el.innerHTML = `<div class="side-h"><b>쪽 ${s.layout.length}</b>${s.canWrite ? `<button class="link small" data-act="inkAddPage">＋ 추가</button>` : ""}</div>
      <ol class="thumbs">${s.layout.map((pg, i) => `<li class="${i === cur ? "on" : ""}"><button class="th" data-act="inkGoPage" data-p="${i}"><canvas data-thumb="${i}" width="132" height="${Math.round(132 * H / W)}"></canvas></button>
        <div class="th-f"><span>${i + 1} · ${esc(pg.bg === "image" ? (pg.src === "pdf" ? "PDF" : "사진") : (TEMPLATES.find((t) => t[0] === pg.bg) || ["", ""])[1])}</span>
        ${s.canWrite ? `<span class="th-act"><button class="icon-btn sm" data-act="inkPageTpl" data-p="${i}" title="모양 바꾸기" aria-label="${i + 1}쪽 모양 바꾸기">🗒</button><button class="icon-btn sm" data-act="inkPageDel" data-p="${i}" title="쪽 지우기" aria-label="${i + 1}쪽 지우기">🗑</button></span>` : ""}</div></li>`).join("")}</ol>`;
    A.$$("canvas[data-thumb]", el).forEach((c) => {
      const i = Number(c.dataset.thumb), k = c.width / W, ctx = c.getContext("2d");
      drawBg(ctx, k, s.layout[i], () => paintSide());
      drawItems(ctx, pageItems(i).filter((x) => x.tool !== "pencil").concat(pageItems(i).filter((x) => x.tool === "pencil").map((x) => Object.assign({}, x, { tool: "ball" }))), k);
    });
  }
  A.acts.inkGoPage = (el) => { const s = I.st, e = s.els[Number(el.dataset.p)]; if (e) e.scrollIntoView({ behavior: "smooth", block: "start" }); setTimeout(paintSide, 400); };
  A.acts.inkPageTpl = (el) => { const at = Number(el.dataset.p); tplPicker(`${at + 1}쪽 모양 바꾸기`, (bg) => pageOp({ action: "set", at, bg })); };
  A.acts.inkPageDel = async (el) => {
    const at = Number(el.dataset.p);
    if (!(await A.confirm(`${at + 1}쪽을 지울까요?`, "이 쪽의 필기도 모두 사라지고, 되돌릴 수 없어요."))) return;
    pageOp({ action: "remove", at });
  };

  // ═════════ 내보내기 ═════════
  function renderPage(i, width) {
    const s = I.st, cv = document.createElement("canvas");
    cv.width = width; cv.height = Math.round(width * H / W);
    const ctx = cv.getContext("2d"), k = width / W;
    drawBg(ctx, k, s.layout[i]);
    drawItems(ctx, pageItems(i), k);
    return cv;
  }
  async function waitImages() {
    const s = I.st, urls = new Set();
    s.layout.forEach((pg) => pg.url && urls.add(pg.url));
    for (const x of s.strokes.values()) if (x.tool === "image" && x.url) urls.add(x.url);
    await Promise.all(Array.from(urls).map((u) => new Promise((res) => { if (img(u, res)) res(); setTimeout(res, 5000); })));
  }
  A.acts.inkSavePng = async () => {
    const p = currentPage(); await waitImages();
    const a = document.createElement("a"); a.href = renderPage(p, 1600).toDataURL("image/png"); a.download = `필기-${p + 1}쪽.png`; a.click();
  };
  A.acts.inkExportPdf = async () => {
    const s = I.st;
    A.toast("PDF를 만드는 중…");
    await waitImages();
    const pages = s.layout.map((_, i) => renderPage(i, 1100).toDataURL("image/jpeg", 0.82));
    try {
      const r = await fetch(`/api/notes/${s.id}/export`, { method: "POST", headers: { "Content-Type": "application/json", "X-ES": "1" }, credentials: "same-origin", body: JSON.stringify({ pages }) });
      if (!r.ok) { let m = "PDF를 만들지 못했어요."; try { m = (await r.json()).error || m; } catch (e) { /* 무시 */ } throw new Error(m); }
      const blob = await r.blob(), a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = ((A.$("#nt-title") && A.$("#nt-title").value) || "필기") + ".pdf"; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      A.toast(`${pages.length}쪽 PDF를 내려받았어요.`);
    } catch (e) { A.toast(e.message, "err"); }
  };

  // ═════════ 다른 사람이 바꾼 것 ═════════
  I.onMsg = (m) => {
    const s = I.st; if (!s || m.noteId !== s.id) return;
    if (m.rev) s.rev = Math.max(s.rev, m.rev);
    if (m.type === "ink_live") {
      let lv = s.live.get(m.tmp);
      if (!lv || m.reset) { lv = { page: m.page, tool: m.tool, color: m.color, width: m.width, pts: [], by: m.by, shape: m.shape }; s.live.set(m.tmp, lv); }
      lv.pts.push(...m.pts); lv.t = Date.now(); lv.shape = m.shape;
      if (m.end && m.tool === "laser") lv.t = Date.now();
      scheduleTop(m.page);
    } else if (m.type === "ink_add") {
      for (const x of m.strokes || [m.stroke]) settle(x);
      paintSide();
    } else if (m.type === "ink_del") {
      const pages = new Set();
      for (const id of m.ids) { const x = s.strokes.get(id); if (x) { pages.add(x.page); s.strokes.delete(id); } s.hidden.delete(id); }
      if (s.sel && s.sel.items.some((x) => m.ids.includes(x.id))) clearSel();
      redrawPages(pages); paintSide();
    } else if (m.type === "ink_meta") {
      if (m.reload) { reload(); return; }
      s.layout = m.layout; paintTb(); redrawAll(); paintSide();
    }
  };
  async function poll() {
    const s = I.st; if (!s || s.dead) return;
    for (const [k, lv] of s.live) if (Date.now() - lv.t > (lv.tool === "laser" ? 2000 : 6000)) { s.live.delete(k); scheduleTop(lv.page); }
    if (!A.rt.ok && !s.cur && !s.erase && !s.sel && !textEd && !document.hidden) {
      try {
        const r = await A.api(`/api/notes/${s.id}/ink`);
        if (I.st === s && r.rev !== s.rev && !s.cur) { const op = s.layout.length; applyData(r); if (op !== s.layout.length) buildPages(); else redrawAll(); paintTb(); }
      } catch (e) { /* 다음에 */ }
    }
    s.pollT = setTimeout(poll, A.rt.ok ? 3000 : 2000);
  }
})();
