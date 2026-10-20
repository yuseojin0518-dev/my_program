/* Pathway 화면 도구: 글자 다듬기, 숫자 모양, 직접 그리는 SVG 그래프 */
(function (root) {
  "use strict";
  const PE = root.PE;

  const esc = (s) => String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // 과목 색 (색만으로 구분하지 않도록 이름도 늘 같이 쓴다)
  // Apple 시스템 색 (파랑·주황·초록·보라·분홍·청록·남색·노랑·갈색·민트)
  // 눈이 편한 중간 채도 색 (파랑·주황·초록·보라·분홍·청록·남색·노랑·갈색·민트)
  const COLORS = ["#5a9cf8", "#f4a259", "#4cbf8c", "#9b84ec", "#ef8aa0", "#4fb5cc", "#7d88e6", "#e2b84a", "#b39478", "#4cc1b4"];
  function colorOf(state, sid) {
    const subs = PE.activeSubjects(state);
    const i = subs.findIndex((s) => s.id === sid);
    return COLORS[(i < 0 ? 0 : i) % COLORS.length];
  }

  const fmtH = PE.fmtH;
  function fmtHShort(min) {
    if (min < 60) return Math.round(min) + "분";
    const h = min / 60;
    return (Math.round(h * 10) / 10).toString().replace(/\.0$/, "") + "시간";
  }
  function fmtDate(s, withDow) {
    if (!s) return "";
    const [, m, d] = s.split("-").map(Number);
    const w = "일월화수목금토"[PE.dow(s)];
    return m + "/" + d + (withDow === false ? "" : "(" + w + ")");
  }
  function fmtNum(n) { return Number(n).toLocaleString("ko-KR"); }
  function fmtG(g) { return g === null || g === undefined || !isFinite(g) ? "–" : g.toFixed(2); }
  function pct(p) { return Math.round(p * 100) + "%"; }
  function dday(today, d) {
    const k = PE.daysBetween(today, d);
    return k === 0 ? "D-day" : k > 0 ? "D-" + k : "D+" + -k;
  }

  // 등급 배지 색
  function gradeTone(g, G) {
    const r = (g - 1) / Math.max(1, (G || 5) - 1);
    if (r <= 0.15) return "g1";
    if (r <= 0.4) return "g2";
    if (r <= 0.65) return "g3";
    return "g4";
  }

  // ───── 그래프 ─────
  // 종 모양 분포: 반 친구들 점수 분포 + 등급 구간 + 내 예상 점수
  function bell(o) {
    const W = 320, H = 120, padB = 22, top = 8;
    const mean = o.mean, sd = Math.max(o.sd, 1);
    const x = (v) => (v / 100) * W;
    const pdf = (v) => Math.exp(-0.5 * Math.pow((v - mean) / sd, 2));
    const pts = [];
    for (let v = 0; v <= 100; v += 1) pts.push([x(v), top + (H - padB - top) * (1 - pdf(v))]);
    const cuts = o.cuts.slice();
    const bands = [];
    const edges = [100].concat(cuts.map((c) => PE.clamp(c, 0, 100))).concat([0]);
    const tones = ["#007aff", "#4da2ff", "#8cc3ff", "#bcdcff", "#dcecff", "#e8f2ff", "#eef5ff", "#f2f7ff", "#f5f9ff"];
    for (let i = 0; i < edges.length - 1; i++) {
      const hi = edges[i], lo = edges[i + 1];
      if (hi <= lo) continue;
      const seg = pts.filter(([px]) => px >= x(lo) - 0.01 && px <= x(hi) + 0.01);
      if (seg.length < 2) continue;
      const d = "M" + x(lo) + "," + (H - padB) + " L" + seg.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" L") + " L" + x(hi) + "," + (H - padB) + "Z";
      bands.push(`<path d="${d}" fill="${tones[Math.min(i, tones.length - 1)]}" opacity="0.95"/>`);
      const mid = (hi + lo) / 2;
      if (hi - lo > 6) bands.push(`<text x="${x(mid)}" y="${H - padB - 4}" class="bell-lab" text-anchor="middle">${o.labels ? o.labels[i] : i + 1}</text>`);
    }
    const line = "M" + pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" L");
    const me = PE.clamp(o.me, 0, 100);
    const sig = o.sigma || 0;
    const band = sig > 0 ? `<rect x="${x(PE.clamp(me - sig, 0, 100))}" y="${top}" width="${x(PE.clamp(me + sig, 0, 100)) - x(PE.clamp(me - sig, 0, 100))}" height="${H - padB - top}" fill="#ff3b30" opacity="0.10"/>` : "";
    const ticks = [0, 20, 40, 60, 80, 100].map((v) => `<text x="${x(v)}" y="${H - 6}" class="bell-tick" text-anchor="${v === 0 ? "start" : v === 100 ? "end" : "middle"}">${v}</text>`).join("");
    return `<svg class="bell" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || "점수 분포")}">
      ${bands.join("")}
      <path d="${line}" fill="none" stroke="#007aff" stroke-width="1.5"/>
      <line x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}" stroke="currentColor" opacity=".25"/>
      ${band}
      <line x1="${x(me)}" x2="${x(me)}" y1="${top - 2}" y2="${H - padB}" stroke="#ff3b30" stroke-width="2.5"/>
      <circle cx="${x(me)}" cy="${top}" r="4" fill="#ff3b30"/>
      ${ticks}
    </svg>`;
  }

  // 가로 막대 (값 0~1)
  function bar(v, color, label) {
    return `<span class="bar" role="img" aria-label="${esc(label || pct(v))}"><span style="width:${(PE.clamp(v, 0, 1) * 100).toFixed(1)}%;background:${color || "var(--accent)"}"></span></span>`;
  }

  // 동그라미 진행률
  function ring(v, size, label, sub) {
    size = size || 84;
    const r = size / 2 - 7, c = 2 * Math.PI * r;
    const p = PE.clamp(v, 0, 1);
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label || pct(p))}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="8"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--accent)" stroke-width="8" stroke-linecap="round"
        stroke-dasharray="${(c * p).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
      <text x="50%" y="${sub ? "47%" : "53%"}" text-anchor="middle" dominant-baseline="middle" class="ring-val">${esc(label || pct(p))}</text>
      ${sub ? `<text x="50%" y="66%" text-anchor="middle" class="ring-sub">${esc(sub)}</text>` : ""}
    </svg>`;
  }

  // 꺾은선 (여러 줄): series=[{name,color,points:[[x,y]...], dash}]
  function lineChart(o) {
    const W = o.w || 340, H = o.h || 160, L = 40, R = 8, T = 10, B = 22;
    const xs = o.series.flatMap((s) => s.points.map((p) => p[0]));
    const ys = o.series.flatMap((s) => s.points.map((p) => p[1]));
    const x0 = Math.min(...xs, 0), x1 = Math.max(...xs, 1);
    const y0 = o.yMin !== undefined ? o.yMin : 0, y1 = Math.max(o.yMax || 0, ...ys, 1);
    const X = (v) => L + (v - x0) / Math.max(1e-9, x1 - x0) * (W - L - R);
    const Y = (v) => T + (1 - (v - y0) / Math.max(1e-9, y1 - y0)) * (H - T - B);
    const grid = [0, 0.5, 1].map((f) => {
      const v = y0 + (y1 - y0) * f;
      return `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="currentColor" opacity=".12"/><text x="${L - 4}" y="${Y(v) + 3}" text-anchor="end" class="ax">${esc(o.fmtY ? o.fmtY(v) : Math.round(v))}</text>`;
    }).join("");
    const lines = o.series.map((s) => {
      if (!s.points.length) return "";
      const d = "M" + s.points.map((p) => X(p[0]).toFixed(1) + "," + Y(p[1]).toFixed(1)).join(" L");
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2.2}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""} stroke-linejoin="round"/>`;
    }).join("");
    const marks = (o.marks || []).map((m) => `<line x1="${X(m.x)}" x2="${X(m.x)}" y1="${T}" y2="${H - B}" stroke="${m.color || "#ff3b30"}" stroke-dasharray="3 3"/><text x="${X(m.x)}" y="${H - 8}" text-anchor="middle" class="ax">${esc(m.label)}</text>`).join("");
    const xl = (o.xLabels || []).map((m) => `<text x="${X(m.x)}" y="${H - 8}" text-anchor="middle" class="ax">${esc(m.label)}</text>`).join("");
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || "그래프")}">${grid}${marks}${xl}${lines}</svg>`;
  }

  // 날짜별 묶음 막대: days=[{label, parts:[{v,color}], cap, mark}]
  function stackChart(o) {
    const W = o.w || 340, H = o.h || 150, L = 42, R = 6, T = 8, B = 22;
    const n = o.days.length || 1;
    const max = Math.max(1, ...o.days.map((d) => Math.max(d.cap || 0, d.parts.reduce((a, p) => a + p.v, 0), d.done || 0)));
    const bw = (W - L - R) / n;
    const Y = (v) => T + (1 - v / max) * (H - T - B);
    let out = "";
    [0, 0.5, 1].forEach((f) => {
      const v = max * f;
      out += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="currentColor" opacity=".1"/><text x="${L - 4}" y="${Y(v) + 3}" text-anchor="end" class="ax">${esc(o.fmtY ? o.fmtY(v) : Math.round(v))}</text>`;
    });
    o.days.forEach((d, i) => {
      const x = L + i * bw + bw * 0.18, w = bw * 0.64;
      let acc = 0;
      if (d.cap) out += `<rect x="${x}" y="${Y(d.cap)}" width="${w}" height="${Y(0) - Y(d.cap)}" fill="none" stroke="currentColor" opacity=".25" stroke-dasharray="2 2" rx="2"/>`;
      for (const p of d.parts) {
        if (p.v <= 0) continue;
        out += `<rect x="${x}" y="${Y(acc + p.v)}" width="${w}" height="${Y(acc) - Y(acc + p.v)}" fill="${p.color}" opacity="${p.opacity || 1}"/>`;
        acc += p.v;
      }
      if (d.done !== undefined) out += `<line x1="${x - 2}" x2="${x + w + 2}" y1="${Y(d.done)}" y2="${Y(d.done)}" stroke="#1c1c1e" stroke-width="2.5" class="done-line"/>`;
      if (d.label && (n <= 14 || i % Math.ceil(n / 10) === 0)) out += `<text x="${x + w / 2}" y="${H - 8}" text-anchor="middle" class="ax ${d.mark ? "ax-mark" : ""}">${esc(d.label)}</text>`;
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || "막대 그래프")}">${out}</svg>`;
  }

  // 가로 막대 여러 개 비교: rows=[{label, values:[{v,color,text}]}]
  function hbars(rows, max) {
    max = max || Math.max(1e-9, ...rows.flatMap((r) => r.values.map((v) => v.v)));
    return `<div class="hbars">${rows.map((r) => `<div class="hb-row"><div class="hb-lab">${esc(r.label)}</div><div class="hb-vals">${r.values.map((v) => `<div class="hb-line"><span class="hb-fill" style="width:${(PE.clamp(v.v / max, 0, 1) * 100).toFixed(1)}%;background:${v.color}"></span><span class="hb-txt">${esc(v.text)}</span></div>`).join("")}</div></div>`).join("")}</div>`;
  }

  // 공부 잔디 (주 단위 열): byDate={날짜:분}, end=오늘, weeks=열 수
  function heatmap(byDate, end, weeks, opt) {
    opt = opt || {};
    const cell = opt.cell || 15, gap = 3, L = 18, T = 14;
    const lastMon = PE.addDays(end, -((PE.dow(end) + 6) % 7));
    const first = PE.addDays(lastMon, -7 * (weeks - 1));
    const max = Math.max(60, ...Object.values(byDate));
    let out = "";
    let prevM = null;
    for (let w = 0; w < weeks; w++) {
      const wk = PE.addDays(first, w * 7);
      const m = Number(wk.slice(5, 7));
      if (m !== prevM) { out += `<text x="${L + w * (cell + gap)}" y="10" class="ax">${m}월</text>`; prevM = m; }
      for (let d = 0; d < 7; d++) {
        const day = PE.addDays(wk, d);
        if (day > end) continue;
        const v = byDate[day] || 0;
        const lv = v <= 0 ? 0 : v < max * 0.25 ? 1 : v < max * 0.5 ? 2 : v < max * 0.8 ? 3 : 4;
        out += `<rect x="${L + w * (cell + gap)}" y="${T + d * (cell + gap)}" width="${cell}" height="${cell}" rx="4" class="hm hm${lv}${day === end ? " hm-today" : ""}"><title>${fmtDate(day)} ${v ? fmtH(v) : "공부 없음"}</title></rect>`;
      }
    }
    ["월", "", "수", "", "금", "", "일"].forEach((t, d) => { if (t) out += `<text x="0" y="${T + d * (cell + gap) + cell - 3}" class="ax">${t}</text>`; });
    const W = L + weeks * (cell + gap), H = T + 7 * (cell + gap);
    return `<svg class="heat" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.aria || "날짜별 공부 시간")}">${out}</svg>`;
  }

  // 도넛: parts=[{v,color,label}]
  function donut(parts, size, center, sub) {
    size = size || 150;
    const r = size / 2 - 14, c = 2 * Math.PI * r, tot = parts.reduce((a, p) => a + p.v, 0) || 1;
    let acc = 0, segs = "";
    for (const p of parts) {
      const len = c * p.v / tot;
      segs += `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${p.color}" stroke-width="22" stroke-dasharray="${Math.max(0, len - 2).toFixed(2)} ${c.toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"><title>${esc(p.label)}</title></circle>`;
      acc += len;
    }
    return `<svg class="donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(parts.map((p) => p.label).join(", "))}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--fill)" stroke-width="22"/>${segs}
      <text x="50%" y="${sub ? "46%" : "52%"}" text-anchor="middle" dominant-baseline="middle" class="ring-val" style="font-size:20px">${esc(center || "")}</text>
      ${sub ? `<text x="50%" y="62%" text-anchor="middle" class="ring-sub" style="font-size:11px">${esc(sub)}</text>` : ""}</svg>`;
  }

  // 주간 막대 (토스 스타일): 회색 통 = 계획, 파란 막대 = 실제. 오늘만 진한 파랑
  // cols=[{label, sub, plan, done, today, future, hl}]
  function weekBars(cols, opt) {
    opt = opt || {};
    const max = Math.max(60, ...cols.map((c) => Math.max(c.plan || 0, c.done || 0)));
    return `<div class="wbars ${opt.compact ? "compact" : ""}" role="img" aria-label="${esc(opt.aria || cols.map((c) => c.label + " " + fmtH(c.done || 0)).join(", "))}">${cols.map((c, i) => {
      const ph = (c.plan || 0) / max * 100, dh = (c.done || 0) / max * 100;
      const val = c.future ? (c.plan ? fmtHShort(c.plan) : "") : (c.done ? fmtHShort(c.done) : c.plan ? "0" : "");
      return `<div class="wb ${c.today ? "today" : ""} ${c.future ? "future" : ""} ${c.hl ? "hl" : ""}" style="--i:${i}">
        <span class="wb-val">${val}</span>
        <div class="wb-track">${c.plan ? `<span class="wb-plan" style="height:${ph.toFixed(1)}%"></span>` : ""}${c.done ? `<span class="wb-done" style="height:${Math.max(3, dh).toFixed(1)}%"></span>` : ""}</div>
        <span class="wb-lab">${esc(c.label)}</span>${c.sub ? `<span class="wb-sub">${esc(c.sub)}</span>` : ""}</div>`;
    }).join("")}</div>`;
  }

  root.UI = { weekBars, heatmap, donut, esc, COLORS, colorOf, fmtH, fmtHShort, fmtDate, fmtNum, fmtG, pct, dday, gradeTone, bell, bar, ring, lineChart, stackChart, hbars };
})(typeof self !== "undefined" ? self : this);
