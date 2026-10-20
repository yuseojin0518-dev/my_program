"""공부 타이머 (열품타처럼): 과목별로 공부 시간을 재고, 오늘·이번 주 반 순위와 '지금 공부 중'을 보여 준다.

- 시간은 서버가 잰다 (시작 시각을 저장). 화면을 새로 고쳐도 이어진다
- 켜 둔 채 잊는 것을 막으려고 화면이 1분마다 '아직 공부 중'을 알린다. 15분 동안 소식이 없으면 마지막 알림 때 멈춘 것으로 친다
- 한 번에 최대 12시간
app.py 가 맨 끝에서 import 한다.
"""
import time
from datetime import datetime, timedelta

from flask import request

import app as A
from app import KST, ApiError, app, body, brief, bump, clean, db, need_me, need_scope, scope_of

SCHEMA = """
CREATE TABLE IF NOT EXISTS es_study (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, scope TEXT NOT NULL, subject TEXT NOT NULL,
  day TEXT NOT NULL, start REAL NOT NULL, last_ping REAL NOT NULL, seconds INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS es_study_scope_day ON es_study(scope, day);
CREATE INDEX IF NOT EXISTS es_study_user ON es_study(user_id, day);
"""
GRACE = 15 * 60
MAX_SESSION = 12 * 3600


def init():
    c = A.connect()
    c.executescript(SCHEMA)
    c.commit()
    c.close()


init()


def day_of(ts):
    return datetime.fromtimestamp(ts, KST).date().isoformat()


def close_stale(c):
    """15분 넘게 소식이 없는 타이머는 마지막 알림 때 멈춘 것으로 한다."""
    now = time.time()
    for r in c.execute("SELECT id, start, last_ping FROM es_study WHERE seconds IS NULL AND (last_ping < ? OR start < ?)", (now - GRACE, now - MAX_SESSION)).fetchall():
        end = min(r["last_ping"] + 60, r["start"] + MAX_SESSION, now)
        c.execute("UPDATE es_study SET seconds = ? WHERE id = ?", (max(0, int(end - r["start"])), r["id"]))
    c.commit()


def running_of(c, uid):
    return c.execute("SELECT * FROM es_study WHERE user_id = ? AND seconds IS NULL ORDER BY id DESC LIMIT 1", (uid,)).fetchone()


def stop(c, r):
    now = time.time()
    sec = max(0, int(min(now, r["start"] + MAX_SESSION) - r["start"]))
    c.execute("UPDATE es_study SET seconds = ? WHERE id = ?", (sec, r["id"]))
    return sec


@app.get("/api/study")
def api_study():
    scope = request.args.get("scope", "")
    u = need_scope(scope)
    c = db()
    if scope == A.DEMO_SCOPE:
        seed_demo_study(c)
    close_stale(c)
    now = time.time()
    today = datetime.now(KST).date()
    week0 = (today - timedelta(days=today.weekday())).isoformat()
    d7 = (today - timedelta(days=6)).isoformat()
    t = today.isoformat()

    # 나
    mine = {"running": None, "today": 0, "bySubject": {}, "days": {}}
    run = running_of(c, u["id"])
    if run:
        mine["running"] = {"subject": run["subject"], "start": run["start"], "elapsed": int(now - run["start"])}
    for r in c.execute("SELECT subject, day, start, seconds FROM es_study WHERE user_id = ? AND day >= ?", (u["id"], d7)):
        sec = r["seconds"] if r["seconds"] is not None else int(now - r["start"])
        mine["days"][r["day"]] = mine["days"].get(r["day"], 0) + sec
        if r["day"] == t:
            mine["today"] += sec
            mine["bySubject"][r["subject"]] = mine["bySubject"].get(r["subject"], 0) + sec
    streak, d = 0, today
    while True:
        if not c.execute("SELECT 1 FROM es_study WHERE user_id = ? AND day = ? AND (seconds IS NULL OR seconds >= 60) LIMIT 1", (u["id"], d.isoformat())).fetchone():
            if d == today:
                d -= timedelta(days=1)
                continue
            break
        streak += 1
        d -= timedelta(days=1)
    mine["streak"] = streak

    # 반 순위 (오늘·이번 주)
    users = {}
    for r in c.execute("SELECT user_id, subject, day, start, seconds FROM es_study WHERE scope = ? AND day >= ?", (scope, min(week0, t))):
        x = users.setdefault(r["user_id"], {"today": 0, "week": 0, "running": None})
        sec = r["seconds"] if r["seconds"] is not None else int(now - r["start"])
        if r["day"] >= week0:
            x["week"] += sec
        if r["day"] == t:
            x["today"] += sec
        if r["seconds"] is None:
            x["running"] = {"subject": r["subject"], "start": r["start"]}
    rank = [dict(v, user=brief(uid)) for uid, v in users.items()]
    rank.sort(key=lambda x: (-x["today"], -x["week"]))
    return {"me": mine, "ranking": rank, "now": now, "mine": scope_of(u) == scope, "studying": sum(1 for x in rank if x["running"])}


@app.post("/api/study/start")
@A.limiter.limit("120 per hour")
def study_start():
    u = need_me()
    subject = clean(body().get("subject") or "자습", 20, True, "과목")
    c = db()
    run = running_of(c, u["id"])
    if run:
        stop(c, run)
    now = time.time()
    c.execute("INSERT INTO es_study (user_id, scope, subject, day, start, last_ping, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
              (u["id"], scope_of(u), subject, day_of(now), now, now, A.now_iso()))
    c.commit()
    bump(scope_of(u), "study", u["id"])
    return {"ok": True, "start": now}


@app.post("/api/study/stop")
def study_stop():
    u = need_me()
    c = db()
    run = running_of(c, u["id"])
    if not run:
        raise ApiError("재고 있는 타이머가 없어요.")
    sec = stop(c, run)
    c.commit()
    bump(scope_of(u), "study", u["id"])
    return {"ok": True, "seconds": sec, "subject": run["subject"]}


@app.post("/api/study/ping")
def study_ping():
    u = need_me()
    c = db()
    run = running_of(c, u["id"])
    if not run:
        return {"running": False}
    c.execute("UPDATE es_study SET last_ping = ? WHERE id = ?", (time.time(), run["id"]))
    c.commit()
    return {"running": True}


def seed_demo_study(c):
    """체험 반 친구들의 공부 기록 (날마다 그날 것이 생기게)."""
    t = datetime.now(KST).date()
    key = "demo_study_" + t.isoformat()
    if c.execute("SELECT 1 FROM es_meta WHERE key = ?", (key,)).fetchone():
        return
    import random

    names = ["민준", "서연", "지호", "하은", "예준"]
    subs = ["수학", "영어", "국어", "통합과학", "한국사", "정보"]
    m = A.SCOPE_RE.match(A.DEMO_SCOPE)
    for i, n in enumerate(names):
        r = c.execute("SELECT id FROM es_users WHERE name = ? AND school_code = ? AND grade = ? AND class_num = ? AND demo = 0", (n, m.group(2), int(m.group(3)), int(m.group(4)))).fetchone()
        if not r:
            continue
        for back in range(0, 7):
            d = t - timedelta(days=back)
            if c.execute("SELECT 1 FROM es_study WHERE user_id = ? AND day = ?", (r["id"], d.isoformat())).fetchone():
                continue
            rnd = random.Random(f"{n}{d}")
            for k in range(rnd.randint(1, 3)):
                hour = 16 + k * 2 + rnd.random()
                start = datetime(d.year, d.month, d.day, int(hour), int(hour % 1 * 60), tzinfo=KST).timestamp()
                if start > time.time() - 600:
                    start = time.time() - rnd.randint(3600, 3 * 3600) * (k + 1) / 3
                sec = rnd.randint(20, 110) * 60 * (1.3 if i in (1, 3) else 1)
                c.execute("INSERT INTO es_study (user_id, scope, subject, day, start, last_ping, seconds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                          (r["id"], A.DEMO_SCOPE, rnd.choice(subs), day_of(start), start, start + sec, int(sec), A.now_iso()))
    c.execute("INSERT OR REPLACE INTO es_meta (key, value) VALUES (?, ?)", (key, A.now_iso()))
    c.commit()
