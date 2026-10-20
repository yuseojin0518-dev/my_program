"""서버 API 시험. 진짜 app.db는 건드리지 않는다."""
import os
import tempfile

import pytest

_tmp = tempfile.mkdtemp()
os.environ["VC_DB"] = os.path.join(_tmp, "test.db")

import app as server  # noqa: E402
import volt_engine as e  # noqa: E402


@pytest.fixture
def client():
    server.app.config["TESTING"] = True
    with server.app.test_client() as c:
        yield c


def signup(c, name="tester1"):
    r = c.post("/signup", json={"username": name, "password": "password123", "nickname": "시험"})
    assert r.status_code == 201, r.get_json()


def solution_board(puzzle, unblocked=()):
    sol = e.solve(puzzle, unblocked=unblocked)
    full = e.layout(puzzle, sol[1], unblocked=unblocked)
    return [[{"t": c[0], "s": c[1]} if c else None for c in row] for row in full]


def empty_board(puzzle):
    return [[None] * cap for cap in puzzle["rows"]]


def test_guest_can_play_first_stages_only(client):
    r = client.post("/api/play/stage", json={"no": 1})
    assert r.status_code == 200
    pz = r.get_json()["puzzle"]
    assert pz["target"] == 6 and "solution" not in pz
    assert client.post("/api/play/stage", json={"no": 7}).status_code == 401
    assert client.post("/api/rush/start").status_code == 401
    assert client.post("/api/play/daily").status_code == 401


def test_stage_clear_unlock_and_coins(client):
    signup(client, "stage1")
    assert client.post("/api/play/stage", json={"no": 2}).status_code == 403   # 아직 잠김
    r = client.post("/api/play/stage", json={"no": 1}).get_json()
    tok = r["token"]
    # 틀린 판
    bad = client.post(f"/api/play/{tok}/submit", json={"board": [[{"t": "a", "s": 1}, None, None]]}).get_json()
    assert bad["win"] is False and bad["status"] == "under"
    # 맞는 판 (최소 2개 → 별 3개)
    ok = client.post(f"/api/play/{tok}/submit", json={"board": solution_board(e.STAGE_BY_NO[1])}).get_json()
    assert ok["win"] and ok["stars"] == 3 and ok["coins"] == 40 and ok["next"] == 2
    assert ok["wallet"]["coins"] == 90
    # 같은 판 두 번 내기 막기
    assert client.post(f"/api/play/{tok}/submit", json={"board": solution_board(e.STAGE_BY_NO[1])}).status_code == 409
    # 2 열림
    assert client.post("/api/play/stage", json={"no": 2}).status_code == 200
    # 다시 깨도 별이 늘지 않으면 코인 없음
    tok2 = client.post("/api/play/stage", json={"no": 1}).get_json()["token"]
    again = client.post(f"/api/play/{tok2}/submit", json={"board": solution_board(e.STAGE_BY_NO[1])}).get_json()
    assert again["coins"] == 0
    st = client.get("/api/stages").get_json()["stages"]
    assert st[0]["stars"] == 3 and st[1]["unlocked"] and not st[2]["unlocked"]


def test_cheating_boards_rejected(client):
    signup(client, "cheat1")
    tok = client.post("/api/play/stage", json={"no": 1}).get_json()["token"]
    # AA 3개뿐인데 9V를 놓음
    r = client.post(f"/api/play/{tok}/submit", json={"board": [[{"t": "n", "s": 1}, None, None]]})
    assert r.status_code == 400
    r = client.post(f"/api/play/{tok}/submit", json={"board": "win"})
    assert r.status_code == 400
    # 남의 판
    client.post("/logout")
    signup(client, "cheat2")
    r = client.post(f"/api/play/{tok}/submit", json={"board": solution_board(e.STAGE_BY_NO[1])})
    assert r.status_code == 404


def test_items_meter_breaker(client):
    signup(client, "items1")
    # 13번까지 바로 열 수 없으니, 1~12 깨기
    for no in range(1, 13):
        tok = client.post("/api/play/stage", json={"no": no}).get_json()["token"]
        assert client.post(f"/api/play/{tok}/submit", json={"board": solution_board(e.STAGE_BY_NO[no])}).get_json()["win"]
    st = e.STAGE_BY_NO[13]
    tok = client.post("/api/play/stage", json={"no": 13}).get_json()["token"]
    h = client.post(f"/api/play/{tok}/item", json={"item": "meter", "board": empty_board(st)}).get_json()
    assert h["hint"]["action"] == "place" and h["wallet"]["meter"] == 2
    # 막힌 칸이 아닌 곳에 차단기 → 거절, 아이템 안 줄어듦
    r = client.post(f"/api/play/{tok}/item", json={"item": "breaker", "row": 0, "slot": 0})
    assert r.status_code == 400
    r = client.post(f"/api/play/{tok}/item", json={"item": "breaker", "row": 0, "slot": 1}).get_json()
    assert r["unblocked"] == [[0, 1]] and r["wallet"]["breaker"] == 1
    # 고친 칸에 놓아도 통과
    board = [[{"t": "l", "s": 1}, {"t": "a", "s": 1}, None, None]]
    assert client.post(f"/api/play/{tok}/submit", json={"board": board}).get_json()["win"]
    # 충전기는 스테이지에서 못 씀
    tok = client.post("/api/play/stage", json={"no": 1}).get_json()["token"]
    assert client.post(f"/api/play/{tok}/item", json={"item": "charger"}).status_code == 400


def test_shop(client):
    signup(client, "shop1")
    w = client.get("/me").get_json()["wallet"]
    assert w == {"coins": 50, "charger": 2, "breaker": 2, "meter": 3}
    r = client.post("/api/shop/buy", json={"item": "meter", "qty": 1}).get_json()
    assert r["wallet"]["coins"] == 25 and r["wallet"]["meter"] == 4
    r = client.post("/api/shop/buy", json={"item": "breaker", "qty": 1})
    assert r.status_code == 400 and "모자라요" in r.get_json()["error"]
    assert client.post("/api/shop/buy", json={"item": "coins", "qty": 1}).status_code == 400
    assert client.post("/api/shop/buy", json={"item": "meter", "qty": 100}).status_code == 400


def test_rush_flow(client, monkeypatch):
    signup(client, "rush1")
    clock = [1_000_000.0]
    monkeypatch.setattr(server.time, "time", lambda: clock[0])
    s = client.post("/api/rush/start").get_json()
    tok, pz = s["token"], s["puzzle"]
    lv0 = server.RUSH_START_LEVEL
    assert s["left"] == server.RUSH_START and s["score"] == 0 and s["level"] == lv0
    clock[0] += 5
    r = client.post(f"/api/play/{tok}/submit", json={"board": solution_board(pz)}).get_json()
    gain1 = 100 + lv0 * 20 + 60 + 30
    refill = server.rush_refill(lv0)
    assert r["win"] and r["gain"] == gain1 and r["solved"] == 1
    assert r["level"] == lv0 + 1 and r["level_up"] and r["refill"] == refill
    left = server.RUSH_START - 5 + refill
    assert r["left"] == pytest.approx(left)
    # 충전기
    r = client.post(f"/api/play/{tok}/item", json={"item": "charger"}).get_json()
    left += 15
    assert r["left"] == pytest.approx(left) and r["wallet"]["charger"] == 1
    # 건너뛰기
    r = client.post(f"/api/play/{tok}/skip").get_json()
    left -= server.RUSH_SKIP_COST
    assert r["left"] == pytest.approx(left)
    # 시간이 다 지난 뒤에 낸 답은 안 받는다
    clock[0] += 500
    r = client.post(f"/api/play/{tok}/submit", json={"board": solution_board(r["puzzle"])}).get_json()
    assert r["over"] and r["result"]["score"] == gain1 and r["result"]["coins"] == gain1 // 20
    assert client.post(f"/api/play/{tok}/finish").status_code == 409   # 두 번 끝내기 막기
    rk = client.get("/api/ranking?kind=rush").get_json()["items"]
    assert rk[0]["value"] == gain1 and rk[0]["me"]


def test_rush_gets_harder():
    """한 문제마다 레벨이 오르고, 채워지는 전력은 줄어든다."""
    levels = [server.rush_next_level(n) for n in range(12)]
    assert levels[0] == server.RUSH_START_LEVEL and levels == sorted(levels) and levels[-1] == 12
    refills = [server.rush_refill(lv) for lv in range(2, 13)]
    assert refills == sorted(refills, reverse=True) and refills[0] > refills[-1] >= 4


def test_stage_list_shows_clear_right_away(client):
    """깬 뒤 목록을 다시 받으면 바로 별과 다음 잠금 해제가 보인다 (저장 버그 확인)."""
    signup(client, "listfresh")
    for no in (1, 2):
        tok = client.post("/api/play/stage", json={"no": no}).get_json()["token"]
        assert client.post(f"/api/play/{tok}/submit", json={"board": solution_board(e.STAGE_BY_NO[no])}).get_json()["win"]
        st = client.get("/api/stages").get_json()["stages"]
        assert st[no - 1]["stars"] == 3 and st[no]["unlocked"]
    assert client.get("/api/home").get_json()["next_stage"] == 3


def test_daily_and_ranking(client):
    signup(client, "daily1")
    a = client.post("/api/play/daily").get_json()
    client.post("/logout")
    signup(client, "daily2")
    b = client.post("/api/play/daily").get_json()
    assert a["puzzle"] == b["puzzle"]      # 모두에게 같은 문제
    r = client.post(f"/api/play/{b['token']}/submit", json={"board": solution_board(b["puzzle"])}).get_json()
    assert r["win"] and r["stars"] == 3 and r["coins"] == 60 and r["rank"] == {"rank": 1, "total": 1}
    # 두 번째로 깨면 코인은 안 줌
    c2 = client.post("/api/play/daily").get_json()
    assert c2["best"]["stars"] == 3
    r = client.post(f"/api/play/{c2['token']}/submit", json={"board": solution_board(c2["puzzle"])}).get_json()
    assert r["coins"] == 0
    items = client.get("/api/ranking?kind=daily").get_json()["items"]
    assert items[0]["name"] == "시험" and items[0]["value"] == r["used"]
    assert client.get("/api/ranking?kind=x").status_code == 400


def test_guest_progress_moves_on_signup(client):
    tok = client.post("/api/play/stage", json={"no": 1}).get_json()["token"]
    r = client.post(f"/api/play/{tok}/submit", json={"board": solution_board(e.STAGE_BY_NO[1])}).get_json()
    assert r["guest_proof"] == tok
    client.post("/signup", json={"username": "guest1", "password": "password123", "nickname": "손님",
                                 "guest": [tok, "가짜토큰"]})
    st = client.get("/api/stages").get_json()["stages"]
    assert st[0]["stars"] == 3 and st[1]["unlocked"]
