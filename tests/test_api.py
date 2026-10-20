"""서버 시험: python -m pytest -q tests   (나이스는 바깥에 연결하지 않고 예시 데이터로)"""
import io
import os
import random
import tempfile

d = tempfile.mkdtemp()
os.environ.update(ES_DB=os.path.join(d, "t.db"), ES_UPLOADS=os.path.join(d, "up"), ES_TESTING="1", ES_NEIS_OFFLINE="1", TEACHER_CODE="t-code")

import pytest  # noqa: E402

import app as A  # noqa: E402
import ot  # noqa: E402

H = {"X-ES": "1"}
SCHOOL = {"office": "K10", "code": "7801185", "name": "춘천고등학교"}


def client():
    A.app.config["TESTING"] = True
    return A.app.test_client()


def quick(c, name="학생", grade=2, cls=3, role="student", code=""):
    r = c.post("/api/login/quick", json={"name": name, "school": SCHOOL, "grade": grade, "classNum": cls, "role": role, "teacherCode": code}, headers=H)
    assert r.status_code == 200, r.json
    return r.json["user"]


def test_ot_python_converges():
    rnd = random.Random(3)
    alpha = ["a", "가", "😀", "\n", " "]

    def edit(t):
        n = ot.u16len(t)
        ops = []
        if n and rnd.random() < .5:
            p = rnd.randrange(n)
            ops.append(ot.dele(p, rnd.randint(1, min(4, n - p))))
        t2 = ot.apply_text(t, ops)
        ops.append(ot.ins(rnd.randint(0, ot.u16len(t2)), "".join(rnd.choice(alpha) for _ in range(rnd.randint(1, 3)))))
        return ops

    for _ in range(2000):
        base = "".join(rnd.choice(alpha) for _ in range(rnd.randint(0, 12)))
        a, b = edit(base), edit(base)
        a2, b2 = ot.xform(a, b, True)
        assert ot.apply_text(ot.apply_text(base, b), a2) == ot.apply_text(ot.apply_text(base, a), b2)


def test_guard_and_login():
    c = client()
    assert c.post("/api/login/quick", json={}).status_code == 403  # 머리글 없으면 거절
    assert c.get("/api/subjects?scope=K10-7801185-2-3").status_code == 401
    u = quick(c)
    assert u["scope"] == "K10-7801185-2-3"
    assert c.post("/api/login/quick", json={"name": "선생", "school": SCHOOL, "grade": 2, "classNum": 1, "role": "teacher", "teacherCode": "x"}, headers=H).status_code == 403


def test_demo_seed_and_neis_fallback():
    c = client()
    r = c.post("/api/login/demo", headers=H).json
    sc = r["user"]["scope"]
    subs = c.get("/api/subjects?scope=" + sc).json["subjects"]
    assert len(subs) == 8 and sum(s["counts"]["work"] for s in subs) >= 8
    ev = c.get("/api/events?scope=" + sc).json["events"]
    assert any(e["attachments"] for e in ev) and any(e["images"] for e in ev)
    f = next(e for e in ev if e["attachments"])["attachments"][0]
    resp = c.get(f["url"])
    assert resp.status_code == 200 and resp.headers["X-Content-Type-Options"] == "nosniff"
    s = c.get("/api/neis/schedule?office=K10&school=7801185&grade=2&from=2026-12-01&to=2026-12-31").json
    assert s["source"] == "sample" and any(e["type"] == "exam" for e in s["events"])
    m = c.get("/api/neis/meal?office=K10&school=7801185&from=2026-10-19&days=5").json
    assert {x["kind"] for x in m["meals"]} == {"중식", "석식"} and m["allergy"]["1"] == "난류"
    assert c.get("/api/neis/schools?q=춘천고").json["source"] == "sample"


def test_other_class_is_read_only_and_other_school_hidden():
    a, b = client(), client()
    ua = quick(a, "가", 2, 4)
    quick(b, "나", 2, 5)
    r = a.post("/api/events", json={"scope": ua["scope"], "title": "수행평가", "date": "2026-11-02", "category": "performance"}, headers=H)
    assert r.status_code == 200
    # 5반 학생은 4반을 볼 수 있지만 쓸 수 없다
    assert any(e["title"] == "수행평가" for e in b.get("/api/events?scope=" + ua["scope"]).json["events"])
    assert b.post("/api/events", json={"scope": ua["scope"], "title": "x", "date": "2026-11-02"}, headers=H).status_code == 403
    assert b.patch(f"/api/events/{r.json['id']}", json={"title": "y", "date": "2026-11-02"}, headers=H).status_code == 403
    # 다른 학교는 볼 수 없다
    assert a.get("/api/events?scope=B10-7010057-2-4").status_code == 403
    # 선생님은 다른 반에도 쓸 수 있다
    t = client()
    quick(t, "선생님", 2, 1, "teacher", "t-code")
    assert t.post("/api/events", json={"scope": ua["scope"], "title": "공지", "date": "2026-11-03"}, headers=H).status_code == 200


def test_event_validation_and_comments():
    c = client()
    u = quick(c, "다", 1, 1)
    sc = u["scope"]
    assert c.post("/api/events", json={"scope": sc, "title": "", "date": "2026-11-02"}, headers=H).status_code == 400
    assert c.post("/api/events", json={"scope": sc, "title": "a", "date": "2026-11-05", "endDate": "2026-11-01"}, headers=H).status_code == 400
    e = c.post("/api/events", json={"scope": sc, "title": "모둠 발표", "date": "2026-11-05", "description": "<script>x</script>"}, headers=H).json
    assert e["description"] == "<script>x</script>"  # 그대로 저장하고 화면은 글자로만 보여 준다
    cm = c.post("/api/comments", json={"target": f"event:{e['id']}", "text": "좋아요"}, headers=H)
    assert cm.status_code == 200
    assert len(c.get(f"/api/comments?target=event:{e['id']}").json["comments"]) == 1
    assert c.post("/api/comments", json={"target": "event:99999", "text": "x"}, headers=H).status_code == 404


def test_upload_rules_and_docs_versions():
    c = client()
    u = quick(c, "라", 3, 2)
    sc = u["scope"]
    bad = c.post("/api/upload", data={"scope": sc, "file": (io.BytesIO(b"<html>"), "x.html")}, headers=H, content_type="multipart/form-data")
    assert bad.status_code == 400
    sid = c.get("/api/subjects?scope=" + sc).json["subjects"][1]["id"]
    d1 = c.post("/api/docs", data={"subject": sid, "tag": "수행평가", "file": (io.BytesIO(b"hello"), "안내.txt")}, headers=H, content_type="multipart/form-data").json
    assert d1["version"] == 1 and d1["tag"] == "수행평가"
    d2 = c.post(f"/api/docs/{d1['id']}/versions", data={"memo": "고침", "file": (io.BytesIO(b"hello v2"), "안내.txt")}, headers=H, content_type="multipart/form-data").json
    assert d2["version"] == 2 and len(d2["versions"]) == 2
    assert c.get(d2["file"]["url"]).data == b"hello v2"
    # 다른 학교 사람은 파일을 못 받는다
    o = client()
    o.post("/api/login/quick", json={"name": "남", "school": {"office": "B10", "code": "7010057", "name": "경복고등학교"}, "grade": 1, "classNum": 1}, headers=H)
    assert o.get(d2["file"]["url"]).status_code == 404


def test_classroom_assign_submit_grade_return():
    t, a, b, o = client(), client(), client(), client()
    quick(t, "담임", 3, 9, "teacher", "t-code")
    ua = quick(a, "학생A", 3, 9)
    quick(b, "학생B", 3, 9)
    quick(o, "옆반", 3, 8)
    sc = ua["scope"]
    sid = a.get("/api/subjects?scope=" + sc).json["subjects"][1]["id"]
    # 학생은 과제를 못 낸다, 선생님은 낸다
    assert a.post("/api/class/work", json={"subject": sid, "kind": "assignment", "title": "x"}, headers=H).status_code == 403
    w = t.post("/api/class/work", json={"subject": sid, "kind": "assignment", "title": "보고서", "points": 10, "due": "2000-01-01T23:59", "topic": "수행"}, headers=H).json
    q = t.post("/api/class/work", json={"subject": sid, "kind": "question", "title": "골라요", "question": {"type": "choice", "options": ["가", "나"], "showAnswers": True}}, headers=H).json
    assert t.post("/api/class/work", json={"subject": sid, "kind": "question", "title": "x", "question": {"type": "choice", "options": ["하나"]}}, headers=H).status_code == 400
    # 공지는 학생도
    assert a.post("/api/class/posts", json={"subject": sid, "text": "안녕"}, headers=H).status_code == 200
    # 학생: 할 일 → 마감 지남(missing)
    assert a.get(f"/api/class/work/{w['id']}").json["mine"]["status"] == "missing"
    # 빈 제출은 안 된다, 완료로 표시는 된다 → 늦게 제출
    assert a.post(f"/api/class/work/{w['id']}/submit", json={}, headers=H).status_code == 400
    r = a.post(f"/api/class/work/{w['id']}/submit", json={"text": "다 했어요"}, headers=H).json
    assert r["mine"]["status"] == "late"
    assert o.post(f"/api/class/work/{w['id']}/submit", json={"text": "x"}, headers=H).status_code == 403  # 다른 반
    assert a.post(f"/api/class/work/{q['id']}/submit", json={"answer": 5}, headers=H).status_code == 400
    a.post(f"/api/class/work/{q['id']}/submit", json={"answer": 1}, headers=H)
    assert a.get(f"/api/class/work/{q['id']}").json["tally"] == [0, 1]
    assert "tally" not in b.get(f"/api/class/work/{q['id']}").json  # 아직 안 낸 친구는 남의 답을 못 본다
    # 선생님: 제출물 목록, 점수, 반환
    d = t.get(f"/api/class/work/{w['id']}").json
    subs = {x["student"]["name"]: x for x in d["submissions"]}
    assert subs["학생A"]["status"] == "late" and subs["학생B"]["status"] == "missing" and d["counts"]["turnedIn"] == 1
    sa = subs["학생A"]["id"]
    assert t.patch(f"/api/class/subs/{sa}", json={"grade": 11}, headers=H).status_code == 400
    assert t.patch(f"/api/class/subs/{sa}", json={"grade": 9}, headers=H).json["grade"] == 9
    assert a.patch(f"/api/class/subs/{sa}", json={"grade": 10}, headers=H).status_code == 403
    t.post(f"/api/class/work/{w['id']}/return", json={"ids": [sa]}, headers=H)
    m = a.get(f"/api/class/work/{w['id']}").json["mine"]
    assert m["status"] == "returned" and m["grade"] == 9
    # 비공개 댓글: 그 학생과 선생님만
    assert a.post("/api/comments", json={"target": f"sub:{sa}", "text": "감사합니다"}, headers=H).status_code == 200
    assert len(t.get(f"/api/comments?target=sub:{sa}").json["comments"]) == 1
    assert b.get(f"/api/comments?target=sub:{sa}").status_code == 403
    # 성적표, 달력 마감
    g = t.get(f"/api/class/grades?subject={sid}").json
    assert [r["student"]["name"] for r in g["rows"]] == ["학생A", "학생B"] and g["rows"][0]["avg"] == 90.0
    assert len(a.get(f"/api/class/grades?subject={sid}").json["rows"]) == 1  # 학생은 내 것만
    assert any(x["id"] == w["id"] for x in a.get(f"/api/class/due?scope={sc}&from=1999-12-01&to=2000-01-31").json["due"])
    ov = a.get("/api/class/overview?scope=" + sc).json
    assert ov["student"] and any(x["status"] == "returned" for x in ov["todo"])
    assert t.delete(f"/api/class/work/{w['id']}", headers=H).status_code == 200


def test_note_ot_over_http_two_writers():
    a, b = client(), client()
    u = quick(a, "사", 3, 3)
    quick(b, "아", 3, 3)
    sid = a.get("/api/subjects?scope=" + u["scope"]).json["subjects"][0]["id"]
    n = a.post("/api/notes", json={"subject": sid, "title": "회의록", "content": "hello"}, headers=H).json
    nid, v = n["id"], n["v"]
    # 둘 다 버전 v 에서 동시에 고친다
    r1 = a.post(f"/api/notes/{nid}/ops", json={"v": v, "ops": [{"t": "i", "p": 0, "s": "A:"}], "clientId": "ca", "seq": 1}, headers=H).json
    r2 = b.post(f"/api/notes/{nid}/ops", json={"v": v, "ops": [{"t": "i", "p": 5, "s": "!"}], "clientId": "cb", "seq": 1}, headers=H).json
    assert r2["ops"] == [{"t": "i", "p": 7, "s": "!"}]  # 앞에 A: 가 들어간 만큼 옮겨졌다
    assert a.get(f"/api/notes/{nid}").json["content"] == "A:hello!"
    # 같은 연산을 다시 보내도 두 번 들어가지 않는다
    again = a.post(f"/api/notes/{nid}/ops", json={"v": v, "ops": [{"t": "i", "p": 0, "s": "A:"}], "clientId": "ca", "seq": 1}, headers=H).json
    assert again["v"] == r1["v"] and a.get(f"/api/notes/{nid}").json["content"] == "A:hello!"
    poll = b.get(f"/api/notes/{nid}/ops?since={v}&clientId=cb").json
    assert [m["v"] for m in poll["ops"]] == [v + 1, v + 2] and any(p["clientId"] == "cb" for p in poll["presence"])
    assert a.post(f"/api/notes/{nid}/ops", json={"v": 0, "ops": [{"t": "x"}], "clientId": "ca", "seq": 2}, headers=H).status_code == 400


def test_ink_strokes_pages_and_permissions():
    a, b, o = client(), client(), client()
    u = quick(a, "펜", 2, 7)
    quick(b, "친구", 2, 7)
    quick(o, "옆반", 2, 8)
    sid = a.get("/api/subjects?scope=" + u["scope"]).json["subjects"][0]["id"]
    nid = a.post("/api/notes", json={"subject": sid, "title": "필기"}, headers=H).json["id"]
    st = {"tool": "fountain", "color": "#3182f6", "width": 3, "pts": [[10, 10, .5], [20, 25, .8], [5000, -3, 2]]}
    r = a.post(f"/api/notes/{nid}/ink", json={"page": 0, "tmp": "t1", "stroke": st}, headers=H)
    assert r.status_code == 200 and r.json["tmp"] == "t1" and r.json["pts"][2] == [1000, 0, 1.0]
    assert a.post(f"/api/notes/{nid}/ink", json={"page": 0, "stroke": dict(st, tool="spray")}, headers=H).status_code == 400
    assert a.post(f"/api/notes/{nid}/ink", json={"page": 1, "stroke": st}, headers=H).status_code == 400  # 아직 1쪽뿐
    assert o.post(f"/api/notes/{nid}/ink", json={"page": 0, "stroke": st}, headers=H).status_code == 403  # 다른 반은 보기만
    # 여러 개 한꺼번에 (도형·글상자)
    many = a.post(f"/api/notes/{nid}/ink", json={"items": [
        {"page": 0, "tmp": "a", "stroke": {"tool": "ball", "color": "#191f28", "width": 3, "shape": True, "pts": [[0, 0, .6], [100, 100, .6]]}},
        {"page": 0, "tmp": "b", "stroke": {"tool": "text", "color": "#191f28", "text": "근의 공식", "x": 50, "y": 60, "size": 30}}]}, headers=H).json
    assert [x["tool"] for x in many["strokes"]] == ["ball", "text"] and many["strokes"][0]["shape"] is True
    # 쪽: 수학 노트를 앞에 넣으면 필기가 뒤로 밀린다
    assert a.post(f"/api/notes/{nid}/pages", json={"action": "insert", "at": 0, "bg": "math"}, headers=H).json["layout"][0]["bg"] == "math"
    ink = o.get(f"/api/notes/{nid}/ink").json
    assert ink["pages"] == 2 and {x["page"] for x in ink["strokes"]} == {1}
    assert a.post(f"/api/notes/{nid}/pages", json={"action": "set", "at": 1, "bg": "cornell"}, headers=H).json["layout"][1]["bg"] == "cornell"
    assert a.post(f"/api/notes/{nid}/pages", json={"action": "set", "at": 1, "bg": "zebra"}, headers=H).status_code == 400
    # 사진 넣기 (사진 파일만)
    png = io.BytesIO()
    from PIL import Image
    Image.new("RGB", (40, 30), "red").save(png, "PNG")
    up = a.post("/api/upload", data={"scope": u["scope"], "file": (io.BytesIO(png.getvalue()), "a.png")}, headers=H, content_type="multipart/form-data").json
    im = a.post(f"/api/notes/{nid}/ink", json={"page": 1, "stroke": {"tool": "image", "file": up["id"], "x": 10, "y": 10, "w": 400, "h": 300}}, headers=H).json
    assert im["url"].startswith("/files/")
    # PDF 가져오기 → 쪽마다 그림 배경
    import fitz
    pdf = fitz.open()
    for i in range(3):
        pdf.new_page().insert_text((72, 72), f"page {i}")
    r = a.post(f"/api/notes/{nid}/import", data={"file": (io.BytesIO(pdf.tobytes()), "학습지.pdf"), "at": "2"}, headers=H, content_type="multipart/form-data").json
    assert r["added"] == 3 and [p["bg"] for p in r["layout"]] == ["math", "cornell", "image", "image", "image"]
    # 쪽 지우기 → 뒤쪽 필기가 앞으로
    assert b.post(f"/api/notes/{nid}/pages", json={"action": "remove", "at": 0}, headers=H).status_code == 200
    assert {x["page"] for x in a.get(f"/api/notes/{nid}/ink").json["strokes"]} == {0}
    # PDF 내보내기
    jpg = io.BytesIO()
    Image.new("RGB", (100, 141), "white").save(jpg, "JPEG")
    import base64
    ex = a.post(f"/api/notes/{nid}/export", json={"pages": ["data:image/jpeg;base64," + base64.b64encode(jpg.getvalue()).decode()] * 2}, headers=H)
    assert ex.status_code == 200 and ex.data[:4] == b"%PDF" and fitz.open(stream=ex.data, filetype="pdf").page_count == 2
    # 같은 반 친구는 지울 수 있다 (함께 쓰는 노트), 쪽 통째로 지우기도
    assert b.post(f"/api/notes/{nid}/ink/delete", json={"page": 0}, headers=H).status_code == 200
    assert a.get(f"/api/notes/{nid}/ink").json["strokes"] == []


def test_same_info_is_one_account_and_demo_shared():
    a, b = client(), client()
    u1 = quick(a, "같은이름", 1, 5)
    u2 = quick(b, "같은이름", 1, 5)
    assert u1["id"] == u2["id"]  # 같은 학교·학년·반·역할·이름이면 한 명
    assert quick(client(), "같은이름", 1, 6)["id"] != u1["id"]  # 반이 다르면 다른 사람
    d1 = client().post("/api/login/demo", headers=H).json["user"]
    d2 = client().post("/api/login/demo", headers=H).json["user"]
    assert d1["id"] == d2["id"] and d1["name"] == "체험 학생"
    # 이미 여러 개 만들어진 계정은 하나로 합친다 (글도 함께 옮긴다)
    c = A.connect()
    dup = c.execute("INSERT INTO es_users (name, role, office, school_code, school_name, grade, class_num, color, created_at) VALUES ('같은이름', 'student', 'K10', '7801185', '춘천고등학교', 1, 5, '#000000', 'x')").lastrowid
    c.execute("INSERT INTO es_events (scope, title, date, category, created_by, updated_by, created_at, updated_at) VALUES ('K10-7801185-1-5', '합치기', '2026-11-01', 'event', ?, ?, 'x', 'x')", (dup, dup))
    c.commit()
    assert A.dedupe_users(c) >= 1
    assert c.execute("SELECT created_by FROM es_events WHERE title = '합치기'").fetchone()[0] == u1["id"]
    assert not c.execute("SELECT 1 FROM es_users WHERE id = ?", (dup,)).fetchone()
    c.close()


def test_study_timer_and_ranking():
    a, b = client(), client()
    u = quick(a, "공부왕", 1, 9)
    quick(b, "친구", 1, 9)
    sc = u["scope"]
    assert a.post("/api/study/stop", json={}, headers=H).status_code == 400
    a.post("/api/study/start", json={"subject": "수학"}, headers=H)
    r = b.get("/api/study?scope=" + sc).json
    assert r["studying"] == 1 and r["ranking"][0]["running"]["subject"] == "수학"
    # 1시간 전에 시작한 것처럼 바꾸고 멈추면 1시간이 쌓인다
    c = A.connect()
    c.execute("UPDATE es_study SET start = start - 3600, last_ping = ? WHERE user_id = ? AND seconds IS NULL", (__import__("time").time(), u["id"]))
    c.commit()
    s = a.post("/api/study/stop", json={}, headers=H).json
    assert 3590 <= s["seconds"] <= 3700
    me = a.get("/api/study?scope=" + sc).json["me"]
    assert me["running"] is None and me["today"] >= 3590 and me["bySubject"]["수학"] >= 3590 and me["streak"] == 1
    # 켜 두고 잊은 타이머(15분 넘게 소식 없음)는 마지막 알림 때 멈춘다
    a.post("/api/study/start", json={"subject": "영어"}, headers=H)
    c.execute("UPDATE es_study SET start = start - 7200, last_ping = last_ping - 3600 WHERE user_id = ? AND seconds IS NULL", (u["id"],))
    c.commit()
    me = a.get("/api/study?scope=" + sc).json["me"]
    assert me["running"] is None and 3600 <= me["bySubject"]["영어"] <= 3700
    c.close()


def test_delete_note_and_doc_only_owner_or_teacher():
    a, b, t = client(), client(), client()
    u = quick(a, "주인", 2, 9)
    quick(b, "남", 2, 9)
    quick(t, "선생", 2, 1, "teacher", "t-code")
    sid = a.get("/api/subjects?scope=" + u["scope"]).json["subjects"][0]["id"]
    n1 = a.post("/api/notes", json={"subject": sid, "title": "내 노트"}, headers=H).json["id"]
    n2 = a.post("/api/notes", json={"subject": sid, "title": "또"}, headers=H).json["id"]
    d1 = a.post("/api/docs", data={"subject": sid, "file": (io.BytesIO(b"x"), "a.txt")}, headers=H, content_type="multipart/form-data").json["id"]
    assert b.delete(f"/api/notes/{n1}", headers=H).status_code == 403
    assert b.delete(f"/api/docs/{d1}", headers=H).status_code == 403
    assert a.delete(f"/api/notes/{n1}", headers=H).status_code == 200
    assert t.delete(f"/api/notes/{n2}", headers=H).status_code == 200  # 선생님은 지울 수 있다
    assert t.delete(f"/api/docs/{d1}", headers=H).status_code == 200
    # 글상자는 줄바꿈 너비를 함께 저장한다
    n3 = a.post("/api/notes", json={"subject": sid, "title": "글"}, headers=H).json["id"]
    x = a.post(f"/api/notes/{n3}/ink", json={"page": 0, "stroke": {"tool": "text", "text": "가" * 3000, "color": "#191f28", "x": 100, "y": 100, "size": 24, "w": 700}}, headers=H).json
    assert x["w"] == 700 and len(x["text"]) == 3000
    assert a.post(f"/api/notes/{n3}/ink", json={"page": 0, "stroke": {"tool": "neon", "color": "#3182f6", "width": 4, "pts": [[1, 1, .5]]}}, headers=H).status_code == 200
