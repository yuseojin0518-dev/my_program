"""볼트 커넥션 게임 규칙.

화면(JS)도 같은 규칙으로 전압을 미리 보여 주지만, 정답인지 아닌지는
항상 이 파일(서버)이 다시 계산해서 정한다. (점수 조작 막기)

전압은 0.5V를 1로 세는 정수(unit)로 다룬다. 1.5V = 3, 9V = 18.
이렇게 하면 0.1+0.2 같은 소수 오차가 생기지 않는다.
"""
import itertools
import random

# ----- 건전지 종류 -----
BATTERIES = {
    "a": {"name": "AA", "volt": 1.5},
    "c": {"name": "코인", "volt": 3},
    "l": {"name": "랜턴", "volt": 6},
    "n": {"name": "9V", "volt": 9},
}
UNIT = {k: int(round(v["volt"] * 2)) for k, v in BATTERIES.items()}  # a=3, c=6, l=12, n=18
ORDER = ["a", "c", "l", "n"]


def to_unit(volt):
    return int(round(volt * 2))


def to_volt(unit):
    v = unit / 2
    return int(v) if v == int(v) else v


# ----- 판 확인 -----
class BoardError(ValueError):
    """규칙에 맞지 않게 놓인 판 (예: 없는 건전지, 막힌 칸)."""


def _usable(stage, unblocked=()):
    """줄마다 쓸 수 있는 칸 번호 목록."""
    blocked = {tuple(x) for x in stage.get("blocked", [])} - {tuple(x) for x in unblocked}
    return [[s for s in range(cap) if (r, s) not in blocked] for r, cap in enumerate(stage["rows"])]


def parse_board(stage, board, unblocked=()):
    """화면에서 보낸 판을 검사하고 [[(종류, 극), ...] 칸 순서대로 None 포함] 으로 바꾼다."""
    if not isinstance(board, list) or len(board) != len(stage["rows"]):
        raise BoardError("줄 수가 맞지 않아요.")
    usable = _usable(stage, unblocked)
    used = {}
    out = []
    for r, (row, cap) in enumerate(zip(board, stage["rows"])):
        if not isinstance(row, list) or len(row) != cap:
            raise BoardError("칸 수가 맞지 않아요.")
        cells = []
        for s, cell in enumerate(row):
            if cell is None:
                cells.append(None)
                continue
            if not isinstance(cell, dict):
                raise BoardError("칸 값이 이상해요.")
            t, sign = cell.get("t"), cell.get("s")
            if t not in UNIT or sign not in (1, -1):
                raise BoardError("없는 건전지예요.")
            if s not in usable[r]:
                raise BoardError("누전된 칸에는 놓을 수 없어요.")
            used[t] = used.get(t, 0) + 1
            if used[t] > stage["tray"].get(t, 0):
                raise BoardError("가진 것보다 많이 놓았어요.")
            cells.append((t, sign))
        out.append(cells)
    return out


def evaluate(stage, board, unblocked=()):
    """판의 상태를 계산한다. board는 parse_board 결과."""
    rows = []
    for cells in board:
        items = [c for c in cells if c]
        rows.append({"v": sum(UNIT[t] * s for t, s in items), "n": len(items)})
    filled = [r for r in rows if r["n"]]
    used = sum(r["n"] for r in rows)
    target, need = stage["target"], stage.get("need", 1)
    res = {"rows": rows, "used": used, "branches": len(filled), "output": None}
    if not filled:
        res["status"] = "empty"
    elif len({r["v"] for r in filled}) > 1:
        res["status"] = "mismatch"      # 병렬 줄끼리 전압이 다름 → 역류
    else:
        out = filled[0]["v"]
        res["output"] = out
        if out <= 0:
            res["status"] = "reverse"   # 전류가 거꾸로
        elif out > target:
            res["status"] = "over"
        elif out < target:
            res["status"] = "under"
        elif len(filled) < need:
            res["status"] = "need"      # 전압은 맞는데 줄이 모자람
        else:
            res["status"] = "win"
    return res


def stars_for(stage, used):
    best = stage["min"]
    if used <= best:
        return 3
    if used <= best + 2:
        return 2
    return 1


# ----- 풀이 (가장 적은 건전지) -----
def _kinds(stage):
    signs = (1,) if stage.get("_pos_only") else (1, -1)
    return [(t, s) for t in ORDER if stage["tray"].get(t, 0) > 0 for s in signs]


def _row_options(stage, cap, locked, target):
    """한 줄에 놓을 수 있는 묶음들 (locked를 꼭 포함). 합이 target인 것만."""
    kinds = _kinds(stage)
    base = sum(UNIT[t] * s for t, s in locked)
    opts = []
    for k in range(0, cap - len(locked) + 1):
        for extra in itertools.combinations_with_replacement(kinds, k):
            if base + sum(UNIT[t] * s for t, s in extra) == target:
                opts.append(tuple(locked) + extra)
    return opts


def solve(stage, locked=None, unblocked=()):
    """가장 적은 건전지로 푸는 방법. locked: 이미 놓인 판(parse_board 결과)을 그대로 두고 푼다.

    돌려주는 값: (건전지 수, 줄마다 [(종류, 극), ...]) 또는 None
    """
    usable = _usable(stage, unblocked)
    n_rows = len(stage["rows"])
    locked_rows = [[c for c in (locked[r] if locked else []) if c] for r in range(n_rows)]
    target, need, tray = stage["target"], stage.get("need", 1), stage["tray"]

    options = []
    for r in range(n_rows):
        opts = _row_options(stage, len(usable[r]), locked_rows[r], target)
        if locked_rows[r]:
            opts = [o for o in opts if o]       # 놓인 게 있는 줄은 비울 수 없다
        else:
            opts = [()] + [o for o in opts if o]
        opts.sort(key=len)
        options.append(opts)

    best = [None, None]

    def dfs(r, left, chosen, count, filled):
        if best[0] is not None and count >= best[0]:
            return
        if r == n_rows:
            if filled >= need:
                best[0], best[1] = count, list(chosen)
            return
        if filled + (n_rows - r) < need:
            return
        for opt in options[r]:
            use = {}
            for t, _ in opt:
                use[t] = use.get(t, 0) + 1
            if any(use[t] > left[t] for t in use):
                continue
            for t in use:
                left[t] -= use[t]
            chosen.append(opt)
            dfs(r + 1, left, chosen, count + len(opt), filled + (1 if opt else 0))
            chosen.pop()
            for t in use:
                left[t] += use[t]

    dfs(0, {t: tray.get(t, 0) for t in UNIT}, [], 0, 0)
    if best[0] is None:
        return None
    return best[0], [list(o) for o in best[1]]


def layout(stage, rows, locked=None, unblocked=()):
    """풀이 묶음을 실제 칸에 배치한다. 이미 놓인 건 그 자리에 두고, 나머지는 빈 칸에 차례로."""
    usable = _usable(stage, unblocked)
    out = []
    for r, items in enumerate(rows):
        cells = list(locked[r]) if locked else [None] * stage["rows"][r]
        rest = list(items)
        for c in cells:
            if c and c in rest:
                rest.remove(c)
        for s in usable[r]:
            if cells[s] is None and rest:
                cells[s] = rest.pop(0)
        out.append(cells)
    return out


def hint(stage, board, unblocked=()):
    """다음에 할 일 하나를 알려 준다.

    1) 지금 놓인 것을 그대로 두고 풀 수 있으면 → 놓을 칸 하나 (place)
    2) 극만 바꾸면 풀 수 있으면 → 뒤집을 건전지 하나 (flip)
    3) 아니면 → 빼야 할 건전지 하나 (remove)
    """
    if evaluate(stage, board)["status"] == "win":
        return {"action": "done"}
    sol = solve(stage, locked=board, unblocked=unblocked)
    if sol:
        full = layout(stage, sol[1], locked=board, unblocked=unblocked)
        for r, cells in enumerate(full):
            for s, c in enumerate(cells):
                if c and board[r][s] is None:
                    return {"action": "place", "row": r, "slot": s, "t": c[0], "s": c[1]}
    # 극만 바꿔 보기
    for r, cells in enumerate(board):
        for s, c in enumerate(cells):
            if c:
                trial = [list(x) for x in board]
                trial[r][s] = (c[0], -c[1])
                if solve(stage, locked=trial, unblocked=unblocked):
                    return {"action": "flip", "row": r, "slot": s}
    # 처음부터 푼 답과 다른 건전지 빼기
    fresh = solve(stage, unblocked=unblocked)
    if fresh:
        for r, cells in enumerate(board):
            want = list(fresh[1][r])
            for s, c in enumerate(cells):
                if c:
                    if c in want:
                        want.remove(c)
                    else:
                        return {"action": "remove", "row": r, "slot": s}
    return {"action": "none"}


# ----- 스테이지 -----
def _stage(no, chapter, title, target_v, rows, tray, need=1, blocked=(), tip=""):
    return {
        "no": no, "chapter": chapter, "title": title,
        "target": to_unit(target_v), "rows": list(rows), "need": need,
        "blocked": [list(b) for b in blocked], "tray": dict(tray), "tip": tip,
    }


CHAPTERS = [
    {"no": 1, "name": "직렬 연결", "desc": "건전지를 한 줄로 이으면 전압이 더해져요."},
    {"no": 2, "name": "극 뒤집기", "desc": "건전지를 뒤집으면(−) 그만큼 전압이 빠져요."},
    {"no": 3, "name": "병렬 연결", "desc": "큰 전구는 여러 줄이 필요해요. 줄마다 전압이 같아야 해요."},
    {"no": 4, "name": "누전 칸", "desc": "번개 표시 칸은 망가져서 쓸 수 없어요."},
    {"no": 5, "name": "세 갈래", "desc": "세 줄을 모두 같은 전압으로 맞춰요."},
    {"no": 6, "name": "마스터", "desc": "지금까지 배운 걸 모두 써야 해요."},
]

STAGES = [
    # 1장 직렬
    _stage(1, 1, "첫 불빛", 3, [3], {"a": 3}, tip="아래 건전지를 누르고, 빈 칸을 눌러 놓아요. 3V를 만들면 전구가 켜져요."),
    _stage(2, 1, "섞어 쓰기", 4.5, [3], {"a": 3, "c": 1}, tip="종류가 다른 건전지도 한 줄에 이으면 더해져요. 적게 쓸수록 별이 많아요."),
    _stage(3, 1, "큰 건전지", 7.5, [4], {"a": 3, "c": 2, "l": 1}),
    _stage(4, 1, "12볼트", 12, [4], {"c": 3, "l": 1, "n": 1}),
    # 2장 극 뒤집기
    _stage(5, 2, "뒤집어 빼기", 4.5, [3], {"l": 1, "a": 2}, tip="놓은 건전지를 누르면 뒤집혀요(−). 뒤집힌 건전지는 전압을 빼요."),
    _stage(6, 2, "9V 다루기", 7.5, [3], {"n": 1, "c": 1, "a": 1}),
    _stage(7, 2, "차이 만들기", 3, [3], {"n": 1, "l": 1, "a": 1}),
    _stage(8, 2, "두 번 뒤집기", 6, [3], {"n": 1, "a": 2}),
    # 3장 병렬
    _stage(9, 3, "두 갈래", 3, [3, 3], {"a": 4}, need=2, tip="이 전구는 줄 2개가 필요해요. 두 줄 모두 3V로 맞춰요."),
    _stage(10, 3, "같은 전압", 4.5, [3, 3], {"a": 3, "c": 2}, need=2),
    _stage(11, 3, "모양은 달라도", 6, [3, 3], {"l": 1, "c": 2, "a": 2}, need=2,
           tip="줄마다 건전지 모양은 달라도 전압만 같으면 돼요."),
    _stage(12, 3, "세 줄 중 둘", 9, [3, 3, 3], {"n": 1, "l": 1, "c": 2, "a": 2}, need=2),
    # 4장 누전 칸
    _stage(13, 4, "좁은 길", 7.5, [4], {"l": 1, "a": 3, "c": 1}, blocked=[(0, 1), (0, 2)],
           tip="번개 칸은 누전돼서 못 써요. 누전 차단기 아이템으로 고칠 수도 있어요."),
    _stage(14, 4, "두 줄 다 좁게", 9, [3, 3], {"n": 1, "l": 1, "c": 2, "a": 3}, need=2, blocked=[(0, 1), (1, 0)]),
    _stage(15, 4, "한 칸짜리 줄", 3, [3, 3], {"c": 1, "a": 3, "l": 1}, need=2, blocked=[(0, 0), (0, 2)]),
    _stage(16, 4, "10.5볼트", 10.5, [4, 4], {"n": 2, "l": 1, "c": 2, "a": 3}, need=2, blocked=[(0, 0), (1, 3)]),
    # 5장 세 갈래
    _stage(17, 5, "세 갈래 길", 6, [3, 3, 3], {"l": 2, "c": 2, "n": 1, "a": 2}, need=3,
           tip="이번 전구는 줄 3개가 필요해요."),
    _stage(18, 5, "모자란 AA", 4.5, [3, 3, 3], {"l": 2, "c": 2, "a": 3}, need=3),
    _stage(19, 5, "누전된 세 갈래", 7.5, [3, 3, 3], {"n": 2, "l": 1, "c": 1, "a": 4}, need=3, blocked=[(2, 0)]),
    _stage(20, 5, "13.5볼트", 13.5, [4, 4], {"n": 2, "l": 2, "c": 2, "a": 2}, need=2),
    # 6장 마스터
    _stage(21, 6, "작은 수 맞추기", 3, [3, 3, 3], {"a": 2, "c": 1, "l": 2, "n": 1}, need=3),
    _stage(22, 6, "꽉 막힌 회로", 4.5, [3, 3, 3], {"n": 2, "l": 2, "c": 1, "a": 3}, need=3, blocked=[(0, 2), (1, 2), (2, 2)]),
    _stage(23, 6, "높은 전압", 15, [4, 4, 4], {"n": 3, "l": 2, "c": 3, "a": 2}, need=3, blocked=[(1, 0)]),
    _stage(24, 6, "마지막 전구", 3, [3, 3, 3], {"n": 2, "l": 3, "c": 1, "a": 1}, need=3, blocked=[(0, 0), (2, 2)],
           tip="3V 코인 건전지는 하나뿐이에요. 나머지 줄은 큰 건전지끼리의 차이로 3V를 만들어 봐요."),
]
for _s in STAGES:
    _sol = solve(_s)
    _s["min"] = _sol[0] if _sol else None
STAGE_BY_NO = {s["no"]: s for s in STAGES}


# ----- 문제 자동 생성 (타임어택·오늘의 퍼즐) -----
MAX_LEVEL = 12

# 레벨별 규칙: 줄 수, 필요한 줄, 칸 수, 누전 칸 수, 헷갈리게 할 여분, 뒤집기 꼭 필요한지, 최소 건전지
LEVELS = {
    1:  dict(rows=1, need=1, caps=[3, 4], blocked=0, decoy=(2, 3), flip=False, min_used=2),
    2:  dict(rows=1, need=1, caps=[4],    blocked=0, decoy=(2, 3), flip=True,  min_used=2),
    3:  dict(rows=2, need=2, caps=[3, 4], blocked=0, decoy=(2, 3), flip=False, min_used=4),
    4:  dict(rows=2, need=2, caps=[3, 4], blocked=1, decoy=(2, 4), flip=True,  min_used=4),
    5:  dict(rows=3, need=2, caps=[3, 4], blocked=1, decoy=(3, 4), flip=True,  min_used=4),
    6:  dict(rows=3, need=3, caps=[3, 4], blocked=1, decoy=(3, 4), flip=True,  min_used=5),
    7:  dict(rows=3, need=3, caps=[3, 4], blocked=2, decoy=(3, 5), flip=True,  min_used=6),
    8:  dict(rows=3, need=3, caps=[4],    blocked=2, decoy=(4, 5), flip=True,  min_used=6),
    9:  dict(rows=3, need=3, caps=[4],    blocked=2, decoy=(4, 6), flip=True,  min_used=6),
    10: dict(rows=4, need=3, caps=[4],    blocked=2, decoy=(4, 6), flip=True,  min_used=6),
    11: dict(rows=4, need=4, caps=[3, 4], blocked=2, decoy=(4, 6), flip=True,  min_used=8),
    12: dict(rows=4, need=4, caps=[4],    blocked=3, decoy=(5, 7), flip=True,  min_used=8),
}


def generate(seed, level):
    """seed가 같으면 언제나 같은 문제가 나온다. 레벨이 높을수록 어렵다.

    어려워지는 점: 줄이 많아지고, 누전 칸·헷갈리는 여분 건전지가 늘고,
    뒤집기(−)를 꼭 써야 풀리고, 건전지 하나로 끝나는 줄은 안 나온다.
    """
    rng = random.Random(seed)
    level = max(1, min(MAX_LEVEL, level))
    P = LEVELS[level]
    types = ["a", "c", "l"] if level == 1 else ORDER[:]
    for _ in range(400):
        n_rows, need = P["rows"], P["need"]
        caps = [rng.choice(P["caps"]) for _ in range(n_rows)]
        blocked = []
        for _ in range(P["blocked"]):
            r = rng.randrange(n_rows)
            s = rng.randrange(caps[r])
            if [r, s] not in blocked and caps[r] - sum(1 for b in blocked if b[0] == r) > 2:
                blocked.append([r, s])
        usable = [caps[r] - sum(1 for b in blocked if b[0] == r) for r in range(n_rows)]

        # 첫 줄을 아무렇게나 만들고 그 합을 목표로 삼는다
        k = rng.randint(2, min(3, usable[0]))
        first = [(rng.choice(types), 1) for _ in range(k)]
        if P["flip"] and rng.random() < 0.8:
            i = rng.randrange(k)
            first[i] = (first[i][0], -1)
        target = sum(UNIT[t] * s for t, s in first)
        if not (3 <= target <= 36):
            continue
        # 건전지 하나와 똑같은 전압이면 너무 쉬우니 (낮은 레벨 빼고) 다시
        if level >= 2 and target in UNIT.values():
            continue

        # 나머지 꼭 필요한 줄도 같은 전압으로 (줄마다 다른 방법이 나오게)
        sol_rows = [first]
        kinds = [(t, s) for t in types for s in ((1, -1) if P["flip"] else (1,))]
        ok = True
        for r in range(1, need):
            combos = [c for n in range(2, usable[r] + 1)
                      for c in itertools.combinations_with_replacement(kinds, n)
                      if sum(UNIT[t] * s for t, s in c) == target]
            if not combos:
                ok = False
                break
            sol_rows.append(list(rng.choice(combos)))
        if not ok:
            continue

        tray = {}
        for row in sol_rows:
            for t, _ in row:
                tray[t] = tray.get(t, 0) + 1
        for _ in range(rng.randint(*P["decoy"])):   # 헷갈리게 할 여분
            t = rng.choice(types)
            tray[t] = tray.get(t, 0) + 1
        if any(v > 9 for v in tray.values()):
            continue
        stage = {"no": 0, "chapter": 0, "title": "", "target": target, "rows": caps, "need": need,
                 "blocked": blocked, "tray": tray, "tip": ""}
        sol = solve(stage)
        if not sol or sol[0] < P["min_used"]:
            continue
        if P["flip"]:
            # 뒤집기 없이도 풀리면 다시 만든다
            if solve(dict(stage, _pos_only=True)):
                continue
        stage["min"] = sol[0]
        return stage
    # 이 레벨 조건으로 못 만들었으면 한 단계 아래 문제를 낸다
    if level > 1:
        return generate(seed + 1, level - 1)
    stage = _stage(0, 0, "", 3, [3], {"a": 3})
    stage["min"] = 2
    return stage


def public(stage):
    """화면에 보내도 되는 정보 (정답은 빼고 보낸다)."""
    return {
        "no": stage["no"], "chapter": stage["chapter"], "title": stage["title"],
        "target": stage["target"], "rows": stage["rows"], "need": stage["need"],
        "blocked": stage["blocked"], "tray": stage["tray"], "tip": stage["tip"],
        "min": stage["min"],
    }
