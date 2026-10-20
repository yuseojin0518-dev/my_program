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
    """줄마다 쓸 수 있는 칸 번호 목록 (누전 칸 빼고, 고정 칸 포함)."""
    blocked = {tuple(x) for x in stage.get("blocked", [])} - {tuple(x) for x in unblocked}
    return [[s for s in range(cap) if (r, s) not in blocked] for r, cap in enumerate(stage["rows"])]


def fixed_map(stage):
    """고정 건전지: {(줄, 칸): (종류, 극)}. 처음부터 놓여 있고 빼거나 뒤집을 수 없다."""
    return {(f[0], f[1]): (f[2], f[3]) for f in stage.get("fixed", [])}


def diode_map(stage):
    """한쪽 방향 칸: {(줄, 칸): 극}. 그 방향으로만 놓을 수 있다."""
    return {(d[0], d[1]): d[2] for d in stage.get("diode", [])}


def empty_board(stage):
    """고정 건전지만 놓인 빈 판."""
    fx = fixed_map(stage)
    return [[fx.get((r, s)) for s in range(cap)] for r, cap in enumerate(stage["rows"])]


def parse_board(stage, board, unblocked=()):
    """화면에서 보낸 판을 검사하고 [[(종류, 극) 또는 None, ...], ...] 으로 바꾼다."""
    if not isinstance(board, list) or len(board) != len(stage["rows"]):
        raise BoardError("줄 수가 맞지 않아요.")
    usable = _usable(stage, unblocked)
    fx, dio = fixed_map(stage), diode_map(stage)
    used = {}
    out = []
    for r, (row, cap) in enumerate(zip(board, stage["rows"])):
        if not isinstance(row, list) or len(row) != cap:
            raise BoardError("칸 수가 맞지 않아요.")
        cells = []
        for s, cell in enumerate(row):
            if (r, s) in fx:
                cells.append(fx[(r, s)])     # 고정 건전지는 화면이 뭘 보내든 원래대로
                continue
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
            if (r, s) in dio and dio[(r, s)] != sign:
                raise BoardError("방향이 정해진 칸이에요.")
            used[t] = used.get(t, 0) + 1
            if used[t] > stage["tray"].get(t, 0):
                raise BoardError("가진 것보다 많이 놓았어요.")
            cells.append((t, sign))
        out.append(cells)
    return out


def evaluate(stage, board, unblocked=()):
    """판의 상태를 계산한다. board는 parse_board 결과. used는 내가 놓은 건전지 수(고정 빼고)."""
    fx = fixed_map(stage)
    rows = []
    for cells in board:
        items = [c for c in cells if c]
        rows.append({"v": sum(UNIT[t] * s for t, s in items), "n": len(items)})
    filled = [r for r in rows if r["n"]]
    used = sum(1 for r, cells in enumerate(board) for s, c in enumerate(cells) if c and (r, s) not in fx)
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


def _fits(extra, plus_only, minus_only, free):
    """방향 칸에 맞게 놓을 수 있는지: +는 '+칸·자유칸', −는 '−칸·자유칸'에만."""
    p = sum(1 for _, s in extra if s > 0)
    n = len(extra) - p
    return max(0, p - plus_only) + max(0, n - minus_only) <= free


def _row_slots(stage, r, usable_r, occupied):
    """이 줄의 빈 칸을 (+전용, −전용, 자유) 수로 센다."""
    dio = diode_map(stage)
    po = mo = fr = 0
    for s in usable_r:
        if s in occupied:
            continue
        d = dio.get((r, s))
        if d == 1:
            po += 1
        elif d == -1:
            mo += 1
        else:
            fr += 1
    return po, mo, fr


def solve(stage, locked=None, unblocked=()):
    """가장 적은 건전지로 푸는 방법. locked: 이미 놓인 판(parse_board 결과)을 그대로 두고 푼다.

    돌려주는 값: (내가 놓는 건전지 수, 줄마다 내가 놓을 [(종류, 극), ...]) 또는 None
    고정 건전지는 개수에도, 돌려주는 목록에도 넣지 않는다.
    """
    usable = _usable(stage, unblocked)
    n_rows = len(stage["rows"])
    fx = fixed_map(stage)
    board = locked if locked else empty_board(stage)
    target, need, tray = stage["target"], stage.get("need", 1), stage["tray"]
    kinds = _kinds(stage)

    options = []
    for r in range(n_rows):
        occupied = {s for s, c in enumerate(board[r]) if c}
        base = [c for c in board[r] if c]                                   # 이미 놓인 것 (고정 포함)
        mine = [c for s, c in enumerate(board[r]) if c and (r, s) not in fx]  # 그중 내가 놓은 것
        po, mo, fr = _row_slots(stage, r, usable[r], occupied)
        base_sum = sum(UNIT[t] * s for t, s in base)
        opts = []
        for k in range(0, po + mo + fr + 1):
            for extra in itertools.combinations_with_replacement(kinds, k):
                if base_sum + sum(UNIT[t] * s for t, s in extra) == target and _fits(extra, po, mo, fr):
                    opts.append((tuple(mine) + extra, bool(base or extra)))
        if not base:
            opts = [((), False)] + [o for o in opts if o[1]]
        opts.sort(key=lambda o: len(o[0]))
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
        for items, on in options[r]:
            use = {}
            for t, _ in items:
                use[t] = use.get(t, 0) + 1
            if any(use[t] > left[t] for t in use):
                continue
            for t in use:
                left[t] -= use[t]
            chosen.append(items)
            dfs(r + 1, left, chosen, count + len(items), filled + (1 if on else 0))
            chosen.pop()
            for t in use:
                left[t] += use[t]

    dfs(0, {t: tray.get(t, 0) for t in UNIT}, [], 0, 0)
    if best[0] is None:
        return None
    return best[0], [list(o) for o in best[1]]


def layout(stage, rows, locked=None, unblocked=()):
    """풀이를 실제 칸에 배치한다. 놓인 건 그 자리에, 나머지는 방향 칸에 맞춰 빈 칸에."""
    usable = _usable(stage, unblocked)
    fx, dio = fixed_map(stage), diode_map(stage)
    base = locked if locked else empty_board(stage)
    out = []
    for r, items in enumerate(rows):
        cells = list(base[r])
        rest = list(items)
        for s, c in enumerate(cells):
            if c and (r, s) not in fx and c in rest:
                rest.remove(c)
        free = [s for s in usable[r] if cells[s] is None]
        # 방향이 정해진 칸부터 그 방향 건전지로 채운다
        for s in free:
            want = dio.get((r, s))
            if want is None:
                continue
            for i, c in enumerate(rest):
                if c[1] == want:
                    cells[s] = rest.pop(i)
                    break
        for s in free:
            if cells[s] is None and dio.get((r, s)) is None and rest:
                cells[s] = rest.pop(0)
        out.append(cells)
    return out


def hint(stage, board, unblocked=()):
    """다음에 할 일 하나를 알려 준다.

    1) 지금 놓인 것을 그대로 두고 풀 수 있으면 → 놓을 칸 하나 (place)
    2) 극만 바꾸면 풀 수 있으면 → 뒤집을 건전지 하나 (flip)
    3) 아니면 → 빼야 할 건전지 하나 (remove)
    고정 건전지와 방향 칸의 건전지는 뒤집으라고 하지 않는다.
    """
    if evaluate(stage, board)["status"] == "win":
        return {"action": "done"}
    fx, dio = fixed_map(stage), diode_map(stage)
    sol = solve(stage, locked=board, unblocked=unblocked)
    if sol:
        full = layout(stage, sol[1], locked=board, unblocked=unblocked)
        for r, cells in enumerate(full):
            for s, c in enumerate(cells):
                if c and board[r][s] is None:
                    return {"action": "place", "row": r, "slot": s, "t": c[0], "s": c[1]}
    for r, cells in enumerate(board):
        for s, c in enumerate(cells):
            if c and (r, s) not in fx and (r, s) not in dio:
                trial = [list(x) for x in board]
                trial[r][s] = (c[0], -c[1])
                if solve(stage, locked=trial, unblocked=unblocked):
                    return {"action": "flip", "row": r, "slot": s}
    fresh = solve(stage, unblocked=unblocked)
    if fresh:
        for r, cells in enumerate(board):
            want = list(fresh[1][r])
            for s, c in enumerate(cells):
                if c and (r, s) not in fx:
                    if c in want:
                        want.remove(c)
                    else:
                        return {"action": "remove", "row": r, "slot": s}
    return {"action": "none"}


# ----- 스테이지 -----
def _stage(no, chapter, title, target_v, rows, tray, need=1, blocked=(), tip="", fixed=(), diode=()):
    """fixed: [(줄, 칸, 종류, 극)] 고정 건전지 / diode: [(줄, 칸, 극)] 한쪽 방향 칸"""
    return {
        "no": no, "chapter": chapter, "title": title,
        "target": to_unit(target_v), "rows": list(rows), "need": need,
        "blocked": [list(b) for b in blocked], "tray": dict(tray), "tip": tip,
        "fixed": [list(f) for f in fixed], "diode": [list(d) for d in diode],
    }


CHAPTERS = [
    {"no": 1, "name": "직렬 연결", "desc": "건전지를 한 줄로 이으면 전압이 더해져요."},
    {"no": 2, "name": "극 뒤집기", "desc": "건전지를 뒤집으면(−) 그만큼 전압이 빠져요."},
    {"no": 3, "name": "병렬 연결", "desc": "큰 전구는 여러 줄이 필요해요. 줄마다 전압이 같아야 해요."},
    {"no": 4, "name": "누전 칸", "desc": "번개 표시 칸은 망가져서 쓸 수 없어요."},
    {"no": 5, "name": "세 갈래", "desc": "세 줄을 모두 같은 전압으로 맞춰요."},
    {"no": 6, "name": "마스터", "desc": "지금까지 배운 걸 모두 써야 해요."},
    {"no": 7, "name": "고정 건전지", "desc": "자물쇠가 달린 건전지는 처음부터 박혀 있어서 빼거나 뒤집을 수 없어요."},
    {"no": 8, "name": "한쪽 방향 칸", "desc": "＋칸에는 바로, −칸에는 뒤집어서만 놓을 수 있어요."},
    {"no": 9, "name": "그랜드 마스터", "desc": "누전·고정·방향 칸이 한꺼번에 나와요."},
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
    # 7장 고정 건전지
    _stage(25, 7, "박혀 있는 9V", 6, [3], {"a": 3}, fixed=[(0, 0, "n", 1)],
           tip="자물쇠 건전지는 빼거나 뒤집을 수 없어요. 9V에서 3V를 빼려면?"),
    _stage(26, 7, "거꾸로 박힘", 4.5, [3], {"l": 1, "a": 2, "c": 1}, fixed=[(0, 0, "c", -1)]),
    _stage(27, 7, "고정된 줄", 3, [3, 3], {"c": 1, "a": 4}, need=2, fixed=[(0, 1, "l", 1)],
           tip="고정 건전지가 있는 줄은 꼭 써야 해요. 그 줄도 목표 전압에 맞춰요."),
    _stage(28, 7, "두 개의 자물쇠", 7.5, [3, 3, 3], {"a": 4, "l": 1}, need=3, fixed=[(0, 0, "n", 1), (1, 0, "l", 1)]),
    # 8장 한쪽 방향 칸
    _stage(29, 8, "한쪽 길", 4.5, [3], {"l": 1, "a": 2, "c": 1}, diode=[(0, 0, 1), (0, 1, -1), (0, 2, -1)],
           tip="＋칸에는 바로, −칸에는 뒤집혀서 놓여요. 칸 방향을 보고 골라요."),
    _stage(30, 8, "빼기 전용 칸", 6, [3], {"n": 1, "a": 4}, diode=[(0, 1, -1), (0, 2, -1)]),
    _stage(31, 8, "더하기 줄, 빼기 줄", 4.5, [3, 3], {"a": 3, "c": 1, "l": 1, "n": 1}, need=2,
           diode=[(0, 0, 1), (0, 1, 1), (0, 2, 1), (1, 0, 1), (1, 1, -1), (1, 2, -1)]),
    _stage(32, 8, "방향 맞추기", 7.5, [3, 3, 3], {"n": 2, "l": 2, "c": 2, "a": 3}, need=3,
           diode=[(0, 0, -1), (0, 1, -1), (1, 0, 1), (1, 1, 1), (1, 2, 1), (2, 2, -1)]),
    # 9장 그랜드 마스터
    _stage(33, 9, "자물쇠와 번개", 6, [4, 4], {"c": 2, "a": 3}, need=2, fixed=[(0, 0, "n", 1)], blocked=[(1, 0), (1, 1)]),
    _stage(34, 9, "모든 장치", 4.5, [3, 3, 3], {"a": 3, "c": 1, "l": 1}, need=3,
           fixed=[(0, 0, "l", 1)], diode=[(1, 0, -1), (1, 1, 1)], blocked=[(2, 1)]),
    _stage(35, 9, "이미 완성된 줄", 3, [3, 3, 3], {"l": 2, "a": 2}, need=3,
           fixed=[(0, 1, "n", -1), (2, 0, "c", 1)], diode=[(1, 2, -1)],
           tip="이미 목표 전압이 된 줄도 있어요. 그 줄은 그대로 두면 돼요."),
    _stage(36, 9, "최종 회로", 10.5, [4, 4, 4], {"n": 2, "l": 2, "c": 2, "a": 3}, need=3,
           fixed=[(0, 0, "n", 1), (1, 3, "a", -1)], blocked=[(2, 0)], diode=[(2, 3, -1), (1, 0, 1)]),
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
    5:  dict(rows=3, need=2, caps=[3, 4], blocked=1, decoy=(3, 4), flip=True,  min_used=4, fx=0, dio=1),
    6:  dict(rows=3, need=3, caps=[3, 4], blocked=1, decoy=(3, 4), flip=True,  min_used=5, fx=1, dio=1),
    7:  dict(rows=3, need=3, caps=[3, 4], blocked=2, decoy=(3, 5), flip=True,  min_used=6, fx=0, dio=2),
    8:  dict(rows=3, need=3, caps=[4],    blocked=2, decoy=(4, 5), flip=True,  min_used=6, fx=1, dio=2),
    9:  dict(rows=3, need=3, caps=[4],    blocked=2, decoy=(4, 6), flip=True,  min_used=6, fx=1, dio=2),
    10: dict(rows=4, need=3, caps=[4],    blocked=2, decoy=(4, 6), flip=True,  min_used=6, fx=1, dio=3),
    11: dict(rows=4, need=4, caps=[3, 4], blocked=2, decoy=(4, 6), flip=True,  min_used=8, fx=2, dio=3),
    12: dict(rows=4, need=4, caps=[4],    blocked=3, decoy=(5, 7), flip=True,  min_used=8, fx=2, dio=4),
}


def _add_gadgets(rng, stage, sol, n_fixed, n_diode):
    """풀이 하나를 그대로 살려 두고 고정 건전지·방향 칸을 넣는다 (그래서 여전히 풀린다)."""
    if not (n_fixed or n_diode):
        return
    full = layout(stage, sol[1])
    placed = [(r, s, c) for r, row in enumerate(full) for s, c in enumerate(row) if c]
    rng.shuffle(placed)
    # 고정: 풀이에 쓰인 건전지 하나를 그 자리에 박아 두고, 쓸 수 있는 건전지에서 뺀다
    for r, s, (t, sg) in placed[:n_fixed]:
        stage["fixed"].append([r, s, t, sg])
        stage["tray"][t] -= 1
        if stage["tray"][t] <= 0:
            del stage["tray"][t]
    fixed_cells = {(f[0], f[1]) for f in stage["fixed"]}
    # 방향 칸: 풀이 칸이면 그 건전지 방향으로, 빈 칸이면 아무 방향으로
    usable = _usable(stage)
    cands = [(r, s) for r in range(len(stage["rows"])) for s in usable[r] if (r, s) not in fixed_cells]
    rng.shuffle(cands)
    for r, s in cands[:n_diode]:
        c = full[r][s]
        stage["diode"].append([r, s, c[1] if c else rng.choice([1, -1])])


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
                 "blocked": blocked, "tray": tray, "tip": "", "fixed": [], "diode": []}
        sol = solve(stage)
        if not sol:
            continue
        _add_gadgets(rng, stage, sol, P.get("fx", 0), P.get("dio", 0))
        sol = solve(stage)
        if not sol or sol[0] + len(stage["fixed"]) < P["min_used"]:
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
        "fixed": stage.get("fixed", []), "diode": stage.get("diode", []),
        "min": stage["min"],
    }
