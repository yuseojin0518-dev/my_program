"""서버 API 시험: python -m pytest -q tests  (나이스는 바깥 요청 없이 시험)"""
import os
import tempfile

os.environ["PW_DB"] = os.path.join(tempfile.mkdtemp(), "t.db")
os.environ["PW_TESTING"] = "1"
os.environ["PW_NEIS_OFFLINE"] = "1"

import pytest  # noqa: E402

import app as appmod  # noqa: E402

STATE = {"v": 1, "profile": {}, "terms": [], "log": []}


@pytest.fixture()
def c():
    appmod.app.config["TESTING"] = True
    with appmod.app.test_client() as cl:
        yield cl


def signup(c, u="student1"):
    return c.post("/signup", json={"username": u, "password": "secret12", "nickname": "학생", "state": STATE})


def test_index_and_sw(c):
    assert c.get("/").status_code == 200
    r = c.get("/sw.js")
    assert r.status_code == 200 and r.headers["Service-Worker-Allowed"] == "/"


def test_signup_login_state(c):
    assert signup(c, "alice").status_code == 200
    r = c.get("/api/state").get_json()
    assert r["state"]["v"] == 1 and r["version"] == 1  # 손님 데이터가 옮겨짐
    r = c.put("/api/state", json={"state": STATE, "version": 1})
    assert r.get_json()["version"] == 2
    # 옛 버전으로 저장하면 충돌
    r = c.put("/api/state", json={"state": STATE, "version": 1})
    assert r.status_code == 409
    c.post("/logout", json={})
    assert c.get("/api/state").status_code == 401
    assert c.post("/login", json={"username": "alice", "password": "wrong!!"}).status_code == 401
    assert c.post("/login", json={"username": "alice", "password": "secret12"}).status_code == 200


def test_signup_validation(c):
    assert c.post("/signup", json={"username": "A!", "password": "secret12"}).status_code == 400
    assert c.post("/signup", json={"username": "bobby", "password": "123"}).status_code == 400
    assert signup(c, "bobby").status_code == 200
    assert signup(c, "bobby").status_code == 409
    # JSON이 아니면 받지 않는다
    assert c.post("/signup", data={"username": "x"}).status_code == 415


def test_bad_state_rejected(c):
    signup(c, "carol")
    assert c.put("/api/state", json={"state": {"v": 2}, "version": 1}).status_code == 400
    assert c.put("/api/state", json={"state": "x", "version": 1}).status_code == 400


def test_neis_offline_and_bad_codes(c):
    assert c.get("/api/neis/schedule?office=K10&school=7801185").status_code == 502
    assert c.get("/api/neis/schedule?office=../&school=1").status_code == 400
    assert c.get("/api/neis/schools?q=a").get_json()["schools"] == []


def test_classify_events():
    rows = [
        {"AA_YMD": "20261207", "EVENT_NM": "2학기 2회고사(1,2학년)", "TW_GRADE_EVENT_YN": "Y"},
        {"AA_YMD": "20261208", "EVENT_NM": "2학기 2회고사(1,2학년)", "TW_GRADE_EVENT_YN": "Y"},
        {"AA_YMD": "20261123", "EVENT_NM": "2학기 2회고사(3학년)", "TW_GRADE_EVENT_YN": "N"},
        {"AA_YMD": "20261009", "EVENT_NM": "한글날", "SBTR_DD_SC_NM": "공휴일", "TW_GRADE_EVENT_YN": "Y"},
        {"AA_YMD": "20261010", "EVENT_NM": "토요휴업일", "TW_GRADE_EVENT_YN": "Y"},
        {"AA_YMD": "20261020", "EVENT_NM": "전국연합학력평가(전학년)", "TW_GRADE_EVENT_YN": "Y"},
    ]
    ev = appmod.build_events(rows, 2)
    types = {e["date"]: e["type"] for e in ev}
    assert types == {"2026-12-07": "exam", "2026-12-08": "exam", "2026-10-09": "holiday", "2026-10-20": "mock"}
    p = appmod.exam_periods(ev)
    assert len(p) == 1 and p[0]["days"] == ["2026-12-07", "2026-12-08"]


def test_metrics_feedback_summary(c):
    cid = "client_abc123"
    assert c.post("/api/metrics", json={"kind": "onboard_ms", "value": 25000, "clientId": cid}).status_code == 200
    assert c.post("/api/metrics", json={"kind": "hack", "clientId": cid}).status_code == 400
    assert c.post("/api/feedback", json={"clientId": cid, "rating": 9}).status_code == 400
    assert c.post("/api/feedback", json={"clientId": cid, "rating": 5, "beforeMin": 20, "helpful": ["역산", "<script>"], "comment": "좋아요"}).status_code == 200
    s = c.get("/api/feedback/summary").get_json()
    assert s["onboardMedianSec"] == 25.0 and s["ratingAvg"] == 5 and "comments" not in s
    assert ("역산", 1) in [tuple(x) for x in s["helpful"]]
