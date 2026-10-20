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
    return [[{"t": c[0], "s": c[1]} if c else None for c in row] for row in e.empty_board(puzzle)]


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
    assert ok["wallet"]["coins"] == 50 + 40 + 20     # 시작 50 + 스테이지 40 + 첫 업적 20
    assert [a["id"] for a in ok["achievements"]] == ["first"]
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


def test_practice_mode(client):
    assert client.post("/api/play/practice", json={"level": 3}).status_code == 401
    signup(client, "prac1")
    assert client.post("/api/play/practice", json={"level": 0}).status_code == 400
    assert client.post("/api/play/practice", json={"level": 99}).status_code == 400
    r = client.post("/api/play/practice", json={"level": 12}).get_json()
    tok, pz = r["token"], r["puzzle"]
    assert len(pz["rows"]) == 4
    r = client.post(f"/api/play/{tok}/submit", json={"board": solution_board(pz)}).get_json()
    assert r["win"] and r["solved"] == 1 and r["level"] == 12 and r["puzzle"] != pz
    assert "practice12" in [a["id"] for a in r["achievements"]]
    nxt = r["puzzle"]
    r = client.post(f"/api/play/{tok}/skip").get_json()
    assert r["puzzle"] != nxt and r["solved"] == 1
    a = client.get("/api/achievements").get_json()
    assert a["stats"]["practice"] == 1 and a["stats"]["practice_best"] == 12


def test_achievements_list_and_rewards(client):
    signup(client, "ach1")
    a = client.get("/api/achievements").get_json()
    assert len(a["items"]) == len(server.ACHIEVEMENTS) and not any(i["done"] for i in a["items"])
    for no in range(1, 5):
        tok = client.post("/api/play/stage", json={"no": no}).get_json()["token"]
        r = client.post(f"/api/play/{tok}/submit", json={"board": solution_board(e.STAGE_BY_NO[no])}).get_json()
    assert "ch1" in [x["id"] for x in r["achievements"]]
    a = client.get("/api/achievements").get_json()
    done = {i["id"] for i in a["items"] if i["done"]}
    assert {"first", "ch1"} <= done
    stars = [i for i in a["items"] if i["id"] == "stars50"][0]
    assert stars["cur"] == 12 and stars["goal"] == 50
    # 같은 업적은 두 번 안 준다
    coins = client.get("/me").get_json()["wallet"]["coins"]
    tok = client.post("/api/play/stage", json={"no": 1}).get_json()["token"]
    r = client.post(f"/api/play/{tok}/submit", json={"board": solution_board(e.STAGE_BY_NO[1])}).get_json()
    assert r["achievements"] == [] and r["wallet"]["coins"] == coins


def test_skins(client):
    signup(client, "skin1")
    me = client.get("/me").get_json()
    assert me["skin"] == "basic" and me["skins"] == ["basic"]
    assert client.post("/api/skin", json={"skin": "neon", "action": "use"}).status_code == 400   # 안 샀음
    r = client.post("/api/skin", json={"skin": "neon", "action": "buy"})
    assert r.status_code == 400 and "모자라요" in r.get_json()["error"]
    import sqlite3
    db = sqlite3.connect(os.environ["VC_DB"])
    db.execute("UPDATE vc_wallet SET coins = 500 WHERE user_id = (SELECT id FROM user WHERE username='skin1')")
    db.commit()
    r = client.post("/api/skin", json={"skin": "neon", "action": "buy"}).get_json()
    assert r["skin"] == "neon" and "neon" in r["skins"] and r["wallet"]["coins"] == 380
    assert client.post("/api/skin", json={"skin": "neon", "action": "buy"}).status_code == 400   # 두 번 못 삼
    assert client.post("/api/skin", json={"skin": "basic", "action": "use"}).get_json()["skin"] == "basic"
    assert client.post("/api/skin", json={"skin": "gold", "action": "buy"}).status_code == 400
    assert client.get("/me").get_json()["skin"] == "basic"


def test_fixed_battery_cannot_be_removed_by_client(client):
    """화면에서 고정 건전지를 지워서 보내도 서버는 고정 건전지를 그대로 계산한다."""
    signup(client, "fixed1")
    import sqlite3
    db = sqlite3.connect(os.environ["VC_DB"])
    uid = db.execute("SELECT id FROM user WHERE username='fixed1'").fetchone()[0]
    db.executemany("INSERT INTO vc_progress (user_id, stage, stars, best) VALUES (?, ?, 3, 1)",
                   [(uid, n) for n in range(1, 25)])
    db.commit()
    tok = client.post("/api/play/stage", json={"no": 25}).get_json()["token"]
    # 9V를 빼고 AA 두 개만 보내면 3V가 아니라 (고정 9V 포함) 6V로 계산 → 성공
    r = client.post(f"/api/play/{tok}/submit", json={"board": [[None, {"t": "a", "s": -1}, {"t": "a", "s": -1}]]}).get_json()
    assert r["win"] and r["used"] == 2


def test_checkin_streak(client, monkeypatch):
    signup(client, "check1")
    import datetime as dt
    day = [dt.date(2026, 10, 1)]
    monkeypatch.setattr(server, "kst_today", lambda: day[0])
    h = client.get("/api/home").get_json()
    assert h["checkin"] == {"done": False, "streak": 0, "day": 1, "rewards": server.CHECKIN_REWARDS}
    r = client.post("/api/checkin").get_json()
    assert r["streak"] == 1 and r["reward"] == {"coins": 20} and r["wallet"]["coins"] == 70 and r["xp"]["gained"] == 20
    assert client.post("/api/checkin").status_code == 400            # 하루 한 번
    day[0] = dt.date(2026, 10, 2)
    assert client.post("/api/checkin").get_json()["streak"] == 2
    day[0] = dt.date(2026, 10, 5)                                    # 이틀 빠짐 → 1일부터
    assert client.get("/api/home").get_json()["checkin"]["streak"] == 0
    assert client.post("/api/checkin").get_json()["streak"] == 1


def test_missions_flow(client, monkeypatch):
    signup(client, "miss1")
    monkeypatch.setattr(server, "todays_missions", lambda day: ["win_stage", "item_use", "rush_play"])
    m = client.get("/api/home").get_json()["missions"]
    assert [i["id"] for i in m["items"]] == ["win_stage", "item_use", "rush_play"] and not m["bonus_ready"]
    assert client.post("/api/missions/claim", json={"id": "win_stage"}).status_code == 400   # 아직
    for _ in range(2):
        tok = client.post("/api/play/stage", json={"no": 1}).get_json()["token"]
        win = client.post(f"/api/play/{tok}/submit", json={"board": solution_board(e.STAGE_BY_NO[1])}).get_json()
    assert win["xp"]["gained"] == 25                                   # 10 + 별3×5
    tok = client.post("/api/play/stage", json={"no": 1}).get_json()["token"]
    for _ in range(2):
        client.post(f"/api/play/{tok}/item", json={"item": "meter", "board": empty_board(e.STAGE_BY_NO[1])})
    s = client.post("/api/rush/start").get_json()
    client.post(f"/api/play/{s['token']}/finish")
    m = client.get("/api/home").get_json()["missions"]
    assert all(i["cur"] >= i["goal"] for i in m["items"])
    coins = client.get("/me").get_json()["wallet"]["coins"]
    for mid in ("win_stage", "item_use", "rush_play"):
        r = client.post("/api/missions/claim", json={"id": mid}).get_json()
    assert r["wallet"]["coins"] == coins + 90 and r["missions"]["bonus_ready"]
    assert client.post("/api/missions/claim", json={"id": "rush_play"}).status_code == 400   # 두 번 못 받음
    r = client.post("/api/missions/claim", json={"id": "all"}).get_json()
    assert r["wallet"]["coins"] == coins + 150 and r["missions"]["bonus_claimed"]
    assert client.post("/api/missions/claim", json={"id": "all"}).status_code == 400
    assert client.post("/api/missions/claim", json={"id": "daily_win"}).status_code == 400  # 오늘 미션 아님


def test_todays_missions_always_has_other_mode():
    for d in range(1, 200):
        ms = server.todays_missions(f"2026-{1 + d % 12:02d}-{1 + d % 28:02d}")
        assert len(set(ms)) == 3 and ms[0] in ("rush_play", "rush_score", "daily_win")


def test_level_math():
    assert server.level_of(0)[0] == 1 and server.level_of(100)[0] == 2 and server.level_of(299)[0] == 2
    assert server.level_of(4500)[0] == 10
    assert server.title_of(1) == "견습 전기공" and server.title_of(16) == "볼트 마스터"


SPEC = {"rows": [3, 3], "need": 2, "target": 9, "tray": {"a": 4, "c": 2}, "cells": [[1, 2, "minus"]]}


def test_workshop_create_play_like(client):
    signup(client, "maker1")
    assert client.post("/api/workshop/check", json=SPEC).get_json() == {"ok": True, "min": 4}
    bad = client.post("/api/workshop/check", json=dict(SPEC, target=60)).get_json()
    assert not bad["ok"] and "풀 수 없어요" in bad["error"]
    easy = client.post("/api/workshop/check", json={"rows": [3], "need": 1, "target": 6, "tray": {"c": 1}, "cells": []}).get_json()
    assert "너무 쉬워요" in easy["error"]
    for spec in (dict(SPEC, rows=[9]), dict(SPEC, tray={"x": 1}), dict(SPEC, cells=[[0, 0, "blocked"], [0, 1, "blocked"], [0, 2, "blocked"]]),
                 dict(SPEC, cells=[[5, 0, "plus"]]), dict(SPEC, need=3)):
        assert not client.post("/api/workshop/check", json=spec).get_json()["ok"]
    assert client.post("/api/workshop", json=dict(SPEC, title="")).status_code == 400
    r = client.post("/api/workshop", json=dict(SPEC, title="<b>두 줄 9V</b>"))
    assert r.status_code == 201
    cid = r.get_json()["id"]
    assert "maker1" in [a["id"] for a in r.get_json()["achievements"]]
    mine = client.get("/api/workshop?sort=mine").get_json()["items"]
    assert mine[0]["title"] == "<b>두 줄 9V</b>" and mine[0]["mine"] and mine[0]["min"] == 4
    assert client.post(f"/api/workshop/{cid}/like").status_code == 400       # 내 퍼즐
    client.post("/logout")
    signup(client, "player1")
    lst = client.get("/api/workshop?sort=new").get_json()["items"]
    assert lst[0]["id"] == cid and lst[0]["author"] == "시험" and not lst[0]["cleared"]
    p = client.post("/api/play/custom", json={"id": cid}).get_json()
    assert p["puzzle"]["diode"] == [[1, 2, -1]]
    r = client.post(f"/api/play/{p['token']}/submit", json={"board": solution_board(p["puzzle"])}).get_json()
    assert r["win"] and r["first"] and r["stars"] == 3
    p2 = client.post("/api/play/custom", json={"id": cid}).get_json()
    r = client.post(f"/api/play/{p2['token']}/submit", json={"board": solution_board(p2["puzzle"])}).get_json()
    assert not r["first"]
    assert client.post(f"/api/workshop/{cid}/like").get_json() == {"liked": True, "likes": 1}
    it = client.get("/api/workshop?sort=popular").get_json()["items"][0]
    assert it["plays"] == 2 and it["clears"] == 1 and it["likes"] == 1 and it["liked"] and it["cleared"]
    assert client.post(f"/api/workshop/{cid}/like").get_json()["liked"] is False
    # 남의 퍼즐은 못 지움
    client.delete(f"/api/workshop/{cid}")
    assert client.get("/api/workshop").get_json()["items"]


def test_workshop_report_hides(client):
    signup(client, "maker2")
    cid = client.post("/api/workshop", json=dict(SPEC, title="신고 시험")).get_json()["id"]
    for i in range(3):
        client.post("/logout")
        signup(client, f"reporter{i}")
        client.post(f"/api/workshop/{cid}/report")
        client.post(f"/api/workshop/{cid}/report")      # 같은 사람 두 번은 한 번
    assert cid not in [x["id"] for x in client.get("/api/workshop").get_json()["items"]]
    assert client.post("/api/play/custom", json={"id": cid}).status_code == 404


def test_level_ranking(client):
    signup(client, "lvrank")
    client.post("/api/checkin")
    items = client.get("/api/ranking?kind=level").get_json()["items"]
    assert any(i["me"] and i["value"] == 1 for i in items)
