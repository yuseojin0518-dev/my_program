"""볼트 커넥션 규칙 시험.  실행: cd ~/app && python -m pytest -q tests"""
import random

import pytest

import volt_engine as e


def cell(t, s=1):
    return {"t": t, "s": s}


def board_of(stage, rows):
    """[[('a',1),...], ...] → 화면에서 보내는 모양의 판"""
    out = []
    usable = e._usable(stage)
    for r, cap in enumerate(stage["rows"]):
        cells = [None] * cap
        for (t, s), slot in zip(rows[r] if r < len(rows) else [], usable[r]):
            cells[slot] = cell(t, s)
        out.append(cells)
    return out


def test_units():
    assert e.UNIT == {"a": 3, "c": 6, "l": 12, "n": 18}
    assert e.to_volt(9) == 4.5 and e.to_volt(6) == 3


def test_series_and_reverse():
    st = e.STAGE_BY_NO[5]  # 4.5V, 랜턴 1 + AA 2
    b = e.parse_board(st, board_of(st, [[("l", 1), ("a", -1)]]))
    r = e.evaluate(st, b)
    assert r["output"] == 9 and r["status"] == "win"
    b = e.parse_board(st, board_of(st, [[("l", 1)]]))
    assert e.evaluate(st, b)["status"] == "over"
    b = e.parse_board(st, board_of(st, [[("a", 1)]]))
    assert e.evaluate(st, b)["status"] == "under"
    b = e.parse_board(st, board_of(st, [[("a", -1)]]))
    assert e.evaluate(st, b)["status"] == "reverse"


def test_parallel_rules():
    st = e.STAGE_BY_NO[9]  # 3V 두 줄 필요
    one = e.parse_board(st, board_of(st, [[("a", 1), ("a", 1)], []]))
    assert e.evaluate(st, one)["status"] == "need"
    mism = e.parse_board(st, board_of(st, [[("a", 1), ("a", 1)], [("a", 1)]]))
    assert e.evaluate(st, mism)["status"] == "mismatch"
    win = e.parse_board(st, board_of(st, [[("a", 1), ("a", 1)], [("a", 1), ("a", 1)]]))
    assert e.evaluate(st, win)["status"] == "win"


def test_parse_rejects_cheating():
    st = e.STAGE_BY_NO[13]  # (0,1),(0,2) 누전
    with pytest.raises(e.BoardError):
        e.parse_board(st, [[None, cell("l"), None, None]])          # 누전 칸
    ok = e.parse_board(st, [[None, cell("l"), None, None]], unblocked=[[0, 1]])
    assert ok[0][1] == ("l", 1)                                     # 차단기로 고친 칸은 OK
    with pytest.raises(e.BoardError):
        e.parse_board(st, [[cell("n"), None, None, None]])          # 없는 건전지
    with pytest.raises(e.BoardError):
        e.parse_board(st, [[cell("l"), None, None, cell("l")]])     # 가진 것보다 많이
    with pytest.raises(e.BoardError):
        e.parse_board(st, [[cell("x"), None, None, None]])          # 이상한 종류
    with pytest.raises(e.BoardError):
        e.parse_board(st, [[cell("a", 2), None, None, None]])       # 이상한 극
    with pytest.raises(e.BoardError):
        e.parse_board(st, [[None, None, None]])                     # 칸 수
    with pytest.raises(e.BoardError):
        e.parse_board(st, [])                                       # 줄 수


@pytest.mark.parametrize("st", e.STAGES, ids=lambda s: f"stage{s['no']}")
def test_every_stage_solvable_and_min_is_real(st):
    sol = e.solve(st)
    assert sol, "풀 수 없는 스테이지"
    assert st["min"] == sol[0]
    # 풀이를 실제 판에 놓으면 정말로 이긴다
    full = e.layout(st, sol[1])
    b = e.parse_board(st, [[cell(*c) if c else None for c in row] for row in full])
    res = e.evaluate(st, b)
    assert res["status"] == "win" and res["used"] == st["min"]
    assert e.stars_for(st, res["used"]) == 3


def brute_min(st):
    """작은 판에서 모든 경우를 다 해 보는 느린 풀이 (solve가 맞는지 비교용)"""
    usable = e._usable(st)
    slots = [(r, s) for r in range(len(st["rows"])) for s in usable[r]]
    choices = [None] + [(t, sg) for t in e.ORDER if st["tray"].get(t) for sg in (1, -1)]
    best = None
    import itertools
    for combo in itertools.product(choices, repeat=len(slots)):
        board = [[None] * cap for cap in st["rows"]]
        for (r, s), c in zip(slots, combo):
            board[r][s] = c
        cnt = {}
        for c in combo:
            if c:
                cnt[c[0]] = cnt.get(c[0], 0) + 1
        if any(cnt[t] > st["tray"][t] for t in cnt):
            continue
        res = e.evaluate(st, board)
        if res["status"] == "win" and (best is None or res["used"] < best):
            best = res["used"]
    return best


@pytest.mark.parametrize("no", [1, 2, 5, 7, 8, 13])
def test_solver_matches_brute_force(no):
    st = e.STAGE_BY_NO[no]
    assert brute_min(st) == st["min"]


def test_stars():
    st = e.STAGE_BY_NO[9]  # min 4
    assert [e.stars_for(st, n) for n in (4, 5, 6, 7)] == [3, 2, 2, 1]


def test_hint_place_flip_remove():
    st = e.STAGE_BY_NO[5]  # 4.5V: 랜턴 + AA 뒤집기
    empty = e.parse_board(st, board_of(st, []))
    h = e.hint(st, empty)
    assert h["action"] == "place"
    # 랜턴만 놓은 상태 → AA를 뒤집어 놓으라고
    b = e.parse_board(st, board_of(st, [[("l", 1)]]))
    h = e.hint(st, b)
    assert h == {"action": "place", "row": 0, "slot": 1, "t": "a", "s": -1}
    # 랜턴을 뒤집어 놓았으면 → 뒤집기
    b = e.parse_board(st, board_of(st, [[("l", -1)]]))
    assert e.hint(st, b) == {"action": "flip", "row": 0, "slot": 0}
    # 쓸모없는 걸 꽉 채웠으면 → 빼기
    st3 = e.STAGE_BY_NO[3]  # 7.5V, 칸 4개
    b = e.parse_board(st3, board_of(st3, [[("c", 1), ("c", 1), ("a", 1), ("a", 1)]]))
    assert e.hint(st3, b)["action"] in ("remove", "flip")
    win = e.parse_board(st, board_of(st, [[("l", 1), ("a", -1)]]))
    assert e.hint(st, win) == {"action": "done"}


def test_hint_leads_to_win():
    """힌트만 계속 따라 해도 끝까지 풀린다."""
    for st in e.STAGES:
        board = [[None] * cap for cap in st["rows"]]
        for _ in range(30):
            h = e.hint(st, board)
            if h["action"] == "done":
                break
            if h["action"] == "place":
                board[h["row"]][h["slot"]] = (h["t"], h["s"])
            elif h["action"] == "flip":
                t, s = board[h["row"]][h["slot"]]
                board[h["row"]][h["slot"]] = (t, -s)
            elif h["action"] == "remove":
                board[h["row"]][h["slot"]] = None
            else:
                pytest.fail(f"stage {st['no']}: 힌트가 막혔어요 {h}")
        assert e.evaluate(st, board)["status"] == "win", st["no"]


def test_generator_deterministic_and_solvable():
    rng = random.Random(1)
    for level in range(1, e.MAX_LEVEL + 1):
        for _ in range(20):
            seed = rng.randrange(10**9)
            a, b = e.generate(seed, level), e.generate(seed, level)
            assert a == b
            sol = e.solve(a)
            assert sol and sol[0] == a["min"]
            assert all(v <= 9 for v in a["tray"].values())
            assert 3 <= a["target"] <= 36


def test_public_has_no_solution():
    p = e.public(e.STAGE_BY_NO[24])
    assert set(p) == {"no", "chapter", "title", "target", "rows", "need", "blocked", "tray", "tip", "min"}


def test_generator_difficulty_rises():
    """레벨이 높을수록 줄·건전지가 많고, 2레벨부터는 뒤집기를 꼭 써야 풀린다."""
    def avg(level, key):
        ps = [e.generate(level * 1000 + i, level) for i in range(30)]
        return sum(key(p) for p in ps) / len(ps), ps
    low, _ = avg(2, lambda p: p["min"])
    mid, _ = avg(6, lambda p: p["min"])
    high, hp = avg(12, lambda p: p["min"])
    assert low < mid < high
    assert all(len(p["rows"]) == 4 and p["need"] == 4 for p in hp)
    for lv in (2, 4, 8, 12):
        for i in range(10):
            p = e.generate(lv * 31 + i, lv)
            assert e.solve(dict(p, _pos_only=True)) is None, "뒤집기 없이 풀리면 안 됨"
