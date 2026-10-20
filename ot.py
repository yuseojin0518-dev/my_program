"""공유 노트 동시 편집 엔진 (OT: Operational Transformation) — static/ot.js 와 똑같이 동작한다.

편집 = 기본 연산 목록. {"t": "i", "p": 위치, "s": 글자} (끼워 넣기) / {"t": "d", "p": 위치, "n": 개수} (지우기)
위치·개수는 자바스크립트 문자열과 같은 UTF-16 단위다 (이모지는 2칸).
두 사람이 같은 버전에서 동시에 고치면 xform 으로 서로의 연산을 고쳐서, 어느 순서로 적용해도 같은 글이 되게 한다.
"""


def u16len(s):
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


def ins(p, s):
    return {"t": "i", "p": p, "s": s}


def dele(p, n):
    return {"t": "d", "p": p, "n": n}


def T(a, b, a_wins):
    """이미 적용된 b 를 고려해 a 를 고친다 (결과는 연산 목록)."""
    if b["t"] == "i":
        bp, bl = b["p"], u16len(b["s"])
        if a["t"] == "i":
            if a["p"] < bp or (a["p"] == bp and a_wins):
                return [a]
            return [ins(a["p"] + bl, a["s"])]
        ap, an = a["p"], a["n"]
        if ap >= bp:
            return [dele(ap + bl, an)]
        if ap + an <= bp:
            return [a]
        # 지우는 범위 한가운데에 b 가 끼워 넣었으면, b 의 글자는 남기고 양쪽만 지운다
        return [dele(ap, bp - ap), dele(ap + bl, an - (bp - ap))]
    bp, bn = b["p"], b["n"]
    be = bp + bn
    if a["t"] == "i":
        ap = a["p"]
        if ap <= bp:
            return [a]
        if ap >= be:
            return [ins(ap - bn, a["s"])]
        return [ins(bp, a["s"])]
    ap, an = a["p"], a["n"]
    ae = ap + an
    if ae <= bp:
        return [a]
    if ap >= be:
        return [dele(ap - bn, an)]
    rem = an - (min(ae, be) - max(ap, bp))
    return [dele(min(ap, bp), rem)] if rem > 0 else []


def xform(A, B, a_wins):
    """(A', B') : B 위에 A' 를 적용한 결과 == A 위에 B' 를 적용한 결과."""
    if not A or not B:
        return A, B
    if len(A) > 1:
        a1, b1 = xform([A[0]], B, a_wins)
        a2, b2 = xform(A[1:], b1, a_wins)
        return a1 + a2, b2
    if len(B) > 1:
        a1, b1 = xform(A, [B[0]], a_wins)
        a2, b2 = xform(a1, B[1:], a_wins)
        return a2, b1 + b2
    return T(A[0], B[0], a_wins), T(B[0], A[0], not a_wins)


def apply(buf, ops):
    """buf: UTF-16LE 바이트. 범위를 벗어나면 끝에 맞춘다."""
    for o in ops:
        n = len(buf) // 2
        p = max(0, min(int(o["p"]), n))
        if o["t"] == "i":
            buf = buf[: 2 * p] + o["s"].encode("utf-16-le", "surrogatepass") + buf[2 * p:]
        else:
            k = max(0, min(int(o["n"]), n - p))
            buf = buf[: 2 * p] + buf[2 * (p + k):]
    return buf


def apply_text(text, ops):
    return decode(apply(encode(text), ops))


def encode(text):
    return (text or "").encode("utf-16-le", "surrogatepass")


def decode(buf):
    return buf.decode("utf-16-le", "replace")


def clean(ops, max_len=20000):
    """화면에서 온 연산 검사. 이상하면 None."""
    if not isinstance(ops, list) or not ops or len(ops) > 50:
        return None
    out = []
    for o in ops:
        if not isinstance(o, dict):
            return None
        p = o.get("p")
        if not isinstance(p, int) or isinstance(p, bool) or p < 0:
            return None
        if o.get("t") == "i":
            s = o.get("s")
            if not isinstance(s, str) or not s or u16len(s) > max_len:
                return None
            out.append(ins(p, s))
        elif o.get("t") == "d":
            n = o.get("n")
            if not isinstance(n, int) or isinstance(n, bool) or n <= 0:
                return None
            out.append(dele(p, n))
        else:
            return None
    return out
