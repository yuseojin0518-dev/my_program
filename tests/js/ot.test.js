// 동시 편집 엔진 시험: node --test tests/js
const test = require("node:test");
const assert = require("node:assert/strict");
const OT = require("../../static/ot.js");

function rnd(seed) { let s = seed; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; }
const ALPHA = ["a", "b", "가", "나", " ", "\n", "😀", "✓"];
function randomEdit(text, r) {
  const ops = [];
  if (text.length && r() < 0.5) { const p = Math.floor(r() * text.length); ops.push(OT.del(p, 1 + Math.floor(r() * Math.min(5, text.length - p)))); }
  const t2 = OT.apply(text, ops);
  if (r() < 0.8 || !ops.length) { let s = ""; for (let i = 0, n = 1 + Math.floor(r() * 4); i < n; i++) s += ALPHA[Math.floor(r() * ALPHA.length)]; ops.push(OT.ins(Math.floor(r() * (t2.length + 1)), s)); }
  return ops;
}

test("diff → apply 하면 새 글이 된다 (이모지를 반으로 자르지 않는다)", () => {
  const cases = [["", "abc"], ["abc", ""], ["hello world", "hello brave world"], ["가나다라", "가다라"], ["a😀b", "a😁b"], ["😀😀", "😀"], ["x", "x"]];
  for (const [a, b] of cases) {
    const ops = OT.diff(a, b);
    assert.equal(OT.apply(a, ops), b);
    for (const o of ops) if (o.t === "i") assert.ok(!/^[\udc00-\udfff]|[\ud800-\udbff]$/.test(o.s), JSON.stringify(o));
  }
});

test("두 사람이 동시에 고쳐도 어느 순서로 적용하든 같은 글이 된다 (무작위 3000번)", () => {
  const r = rnd(7);
  for (let k = 0; k < 3000; k++) {
    let base = "";
    for (let i = 0; i < Math.floor(r() * 20); i++) base += ALPHA[Math.floor(r() * ALPHA.length)];
    const a = randomEdit(base, r), b = randomEdit(base, r);
    const [a2, b2] = OT.xform(a, b, true);
    assert.equal(OT.apply(OT.apply(base, b), a2), OT.apply(OT.apply(base, a), b2), JSON.stringify({ base, a, b }));
  }
});

test("서버 + 클라이언트 3명이 마구 동시에 고쳐도 모두 같은 글로 끝난다", () => {
  const r = rnd(42);
  for (let round = 0; round < 60; round++) {
    // 서버: 연산을 받은 순서대로 고쳐서 적용하고 모두에게 보낸다 (app.py 의 note_apply 와 같은 방식)
    const server = { text: "공유 노트", v: 0, hist: [] };
    const inbox = []; // 서버로 가는 메시지
    const clients = [0, 1, 2].map((id) => ({ id, text: server.text, v: 0, pending: null, buffer: [], seq: 0, outbox: [], q: [] }));
    const send = (c) => { if (c.pending || !c.buffer.length) return; c.pending = c.buffer; c.buffer = []; c.seq++; inbox.push({ from: c.id, v: c.v, ops: c.pending, seq: c.seq }); };
    const serverStep = () => {
      const m = inbox.splice(Math.floor(r() * Math.min(inbox.length, 1)), 1)[0]; // 보낸 사람마다 순서는 지킨다
      let ops = m.ops;
      for (const h of server.hist.slice(m.v)) ops = OT.xform(ops, h.ops, false)[0];
      server.text = OT.apply(server.text, ops); server.v++;
      const out = { v: server.v, ops, from: m.from, seq: m.seq };
      server.hist.push(out);
      for (const c of clients) c.q.push(out);
    };
    const clientStep = (c) => {
      const m = c.q.shift();
      if (m.from === c.id && c.pending && m.seq === c.seq) { c.v = m.v; c.pending = null; send(c); return; }
      let ops = m.ops;
      if (c.pending) [ops, c.pending] = OT.xform(ops, c.pending, true);
      if (c.buffer.length) [ops, c.buffer] = OT.xform(ops, c.buffer, true);
      c.v = m.v; c.text = OT.apply(c.text, ops);
    };
    for (let step = 0; step < 300; step++) {
      const x = r();
      if (x < 0.4) { const c = clients[Math.floor(r() * 3)]; const ops = randomEdit(c.text, r); c.text = OT.apply(c.text, ops); c.buffer = c.buffer.concat(ops); send(c); }
      else if (x < 0.7 && inbox.length) serverStep();
      else { const c = clients[Math.floor(r() * 3)]; if (c.q.length) clientStep(c); }
    }
    // 남은 것을 모두 처리
    for (let guard = 0; guard < 10000 && (inbox.length || clients.some((c) => c.q.length || c.pending || c.buffer.length)); guard++) {
      if (inbox.length) serverStep();
      for (const c of clients) while (c.q.length) clientStep(c);
      for (const c of clients) send(c);
    }
    for (const c of clients) assert.equal(c.text, server.text, `round ${round} client ${c.id}`);
  }
});

test("커서 위치는 앞에서 끼워 넣거나 지우면 함께 움직인다", () => {
  assert.equal(OT.xpos(5, [OT.ins(2, "abc")]), 8);
  assert.equal(OT.xpos(5, [OT.ins(7, "abc")]), 5);
  assert.equal(OT.xpos(5, [OT.del(1, 2)]), 3);
  assert.equal(OT.xpos(5, [OT.del(3, 10)]), 3);
});
