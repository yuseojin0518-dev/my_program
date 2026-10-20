/* 공유 노트 동시 편집 엔진 (OT) — ot.py 와 똑같이 동작한다. 화면(브라우저)과 시험(node) 양쪽에서 쓴다. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OT = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const ins = (p, s) => ({ t: "i", p, s });
  const del = (p, n) => ({ t: "d", p, n });

  // 이미 적용된 b 를 고려해 a 를 고친다
  function T(a, b, aWins) {
    if (b.t === "i") {
      const bp = b.p, bl = b.s.length;
      if (a.t === "i") return a.p < bp || (a.p === bp && aWins) ? [a] : [ins(a.p + bl, a.s)];
      const ap = a.p, an = a.n;
      if (ap >= bp) return [del(ap + bl, an)];
      if (ap + an <= bp) return [a];
      return [del(ap, bp - ap), del(ap + bl, an - (bp - ap))];
    }
    const bp = b.p, bn = b.n, be = bp + bn;
    if (a.t === "i") {
      if (a.p <= bp) return [a];
      if (a.p >= be) return [ins(a.p - bn, a.s)];
      return [ins(bp, a.s)];
    }
    const ap = a.p, an = a.n, ae = ap + an;
    if (ae <= bp) return [a];
    if (ap >= be) return [del(ap - bn, an)];
    const rem = an - (Math.min(ae, be) - Math.max(ap, bp));
    return rem > 0 ? [del(Math.min(ap, bp), rem)] : [];
  }

  // [A', B'] : B 위에 A' == A 위에 B'
  function xform(A, B, aWins) {
    if (!A.length || !B.length) return [A, B];
    if (A.length > 1) {
      const [a1, b1] = xform([A[0]], B, aWins);
      const [a2, b2] = xform(A.slice(1), b1, aWins);
      return [a1.concat(a2), b2];
    }
    if (B.length > 1) {
      const [a1, b1] = xform(A, [B[0]], aWins);
      const [a2, b2] = xform(a1, B.slice(1), aWins);
      return [a2, b1.concat(b2)];
    }
    return [T(A[0], B[0], aWins), T(B[0], A[0], !aWins)];
  }

  function apply(text, ops) {
    for (const o of ops) {
      const p = Math.max(0, Math.min(o.p, text.length));
      if (o.t === "i") text = text.slice(0, p) + o.s + text.slice(p);
      else text = text.slice(0, p) + text.slice(p + Math.max(0, Math.min(o.n, text.length - p)));
    }
    return text;
  }

  const hi = (c) => c >= 0xd800 && c <= 0xdbff;
  const lo = (c) => c >= 0xdc00 && c <= 0xdfff;
  // 고치기 전 글과 고친 뒤 글의 차이 → 연산 (지우기 다음 끼워 넣기). 이모지(두 칸 글자)를 반으로 자르지 않는다
  function diff(a, b) {
    if (a === b) return [];
    const max = Math.min(a.length, b.length);
    let s = 0;
    while (s < max && a.charCodeAt(s) === b.charCodeAt(s)) s++;
    if (s > 0 && hi(a.charCodeAt(s - 1))) s--;
    let e = 0;
    while (e < max - s && a.charCodeAt(a.length - 1 - e) === b.charCodeAt(b.length - 1 - e)) e++;
    if (e > 0 && lo(a.charCodeAt(a.length - e))) e--;
    const ops = [];
    if (a.length - s - e > 0) ops.push(del(s, a.length - s - e));
    if (b.length - s - e > 0) ops.push(ins(s, b.slice(s, b.length - e)));
    return ops;
  }

  // 커서 위치를 연산에 맞춰 옮긴다
  function xpos(pos, ops) {
    for (const o of ops) {
      if (o.t === "i") { if (o.p < pos) pos += o.s.length; }
      else if (o.p < pos) pos -= Math.min(o.n, pos - o.p);
    }
    return pos;
  }

  return { T, xform, apply, diff, xpos, ins, del };
});
