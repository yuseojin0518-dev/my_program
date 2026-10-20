import csv
import io
import os
import random
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from flask import Flask, Response, g, jsonify, render_template, request
from flask_bcrypt import Bcrypt
from flask_login import (
    LoginManager,
    UserMixin,
    current_user,
    login_required,
    login_user,
    logout_user,
)

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:
    pass

# ----- 기본 설정 -----
app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-change-me")

bcrypt = Bcrypt(app)
login_manager = LoginManager(app)


@login_manager.unauthorized_handler
def unauthorized():
    # 로그인 안 했을 때 HTML 대신 JSON으로 알려준다
    return {"error": "로그인이 필요해요."}, 401


DB_PATH = "app.db"
KST = ZoneInfo("Asia/Seoul")

# 과목 색 (고를 수 있는 색만 허용)
# 과목 색: 시스템 색 계열 (파랑·초록·주황·보라·분홍·청록·남색·빨강)
SUBJECT_COLORS = [
    "#007AFF", "#34C759", "#FF9500", "#AF52DE",
    "#FF2D55", "#30B0C7", "#5856D6", "#FF3B30",
]
# 예전 색으로 만든 과목도 그대로 쓸 수 있게 허용
OLD_SUBJECT_COLORS = [
    "#1f3a34", "#3f5a74", "#b4552d", "#8a6d3b",
    "#4f6d5e", "#7a4a6b", "#5b6b2f", "#2f5f6b",
]
DEFAULT_SUBJECTS = [("국어", "#FF9500"), ("수학", "#007AFF"), ("영어", "#34C759")]
MODES = {"focus", "free"}  # focus: 뽀모도로, free: 직접 입력


# ----- DB -----
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    with sqlite3.connect(DB_PATH) as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS user (
                id         INTEGER PRIMARY KEY,
                username   TEXT UNIQUE NOT NULL,
                pw_hash    TEXT NOT NULL,
                nickname   TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )
        # 하루 목표(분) 칸이 없으면 추가 (기존 회원 데이터는 그대로)
        cols = [r[1] for r in db.execute("PRAGMA table_info(user)")]
        if "daily_goal" not in cols:
            db.execute("ALTER TABLE user ADD COLUMN daily_goal INTEGER NOT NULL DEFAULT 120")
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS subject (
                id         INTEGER PRIMARY KEY,
                user_id    INTEGER NOT NULL,
                name       TEXT NOT NULL,
                color      TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES user(id)
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS study (
                id         INTEGER PRIMARY KEY,
                user_id    INTEGER NOT NULL,
                subject_id INTEGER,
                minutes    INTEGER NOT NULL,
                mode       TEXT NOT NULL DEFAULT 'focus',
                memo       TEXT NOT NULL DEFAULT '',
                ended_at   TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES user(id)
            )
            """
        )
        db.execute("CREATE INDEX IF NOT EXISTS idx_study_user ON study(user_id, ended_at)")
        # 예전 어두운 색으로 만든 과목은 같은 순서의 새 시스템 색으로 바꾼다 (이름·기록은 그대로)
        for old, new in zip(OLD_SUBJECT_COLORS, SUBJECT_COLORS):
            db.execute("UPDATE subject SET color = ? WHERE color = ?", (new, old))
        # 스터디 플래너: 날짜별 할 일
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS plan (
                id         INTEGER PRIMARY KEY,
                user_id    INTEGER NOT NULL,
                day        TEXT NOT NULL,              -- 한국 날짜 YYYY-MM-DD
                title      TEXT NOT NULL,
                subject_id INTEGER,
                target_min INTEGER NOT NULL DEFAULT 0, -- 목표 공부 시간(분), 0이면 없음
                done       INTEGER NOT NULL DEFAULT 0,
                position   INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES user(id)
            )
            """
        )
        db.execute("CREATE INDEX IF NOT EXISTS idx_plan_user_day ON plan(user_id, day)")
        # D-day (시험·행사 날짜)
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS dday (
                id         INTEGER PRIMARY KEY,
                user_id    INTEGER NOT NULL,
                title      TEXT NOT NULL,
                day        TEXT NOT NULL,   -- 한국 날짜 YYYY-MM-DD
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES user(id)
            )
            """
        )
        # 공부 기록이 어떤 할 일에서 나왔는지 (기존 기록은 비어 있음)
        # 시간표: 요일(0=월~4=금) × 교시(1~10) 칸마다 과목 이름
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS timetable (
                user_id INTEGER NOT NULL,
                weekday INTEGER NOT NULL,
                period  INTEGER NOT NULL,
                name    TEXT NOT NULL,
                PRIMARY KEY (user_id, weekday, period)
            )
            """
        )
        # 단어장 묶음과 카드 (복습 상자: box 1~5, 상자가 높을수록 늦게 다시 나온다)
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS deck (
                id         INTEGER PRIMARY KEY,
                user_id    INTEGER NOT NULL,
                name       TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS card (
                id         INTEGER PRIMARY KEY,
                deck_id    INTEGER NOT NULL,
                user_id    INTEGER NOT NULL,
                front      TEXT NOT NULL,
                back       TEXT NOT NULL,
                box        INTEGER NOT NULL DEFAULT 1,
                due        TEXT NOT NULL,          -- 다음 복습 날짜 (한국 날짜)
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )
        db.execute("CREATE INDEX IF NOT EXISTS idx_card_deck ON card(deck_id)")
        # 오답노트
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS wrong (
                id         INTEGER PRIMARY KEY,
                user_id    INTEGER NOT NULL,
                subject_id INTEGER,
                source     TEXT NOT NULL DEFAULT '',  -- 출처 (예: 수학 익힘책 p.32)
                question   TEXT NOT NULL,
                answer     TEXT NOT NULL DEFAULT '',
                reason     TEXT NOT NULL DEFAULT '',  -- 왜 틀렸는지
                review_on  TEXT NOT NULL,             -- 다시 볼 날짜 (한국 날짜)
                reviews    INTEGER NOT NULL DEFAULT 0,
                solved     INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )
        study_cols = [r[1] for r in db.execute("PRAGMA table_info(study)")]
        if "plan_id" not in study_cols:
            db.execute("ALTER TABLE study ADD COLUMN plan_id INTEGER")


init_db()


# ----- 시간 도우미 (서버는 UTC로 저장, 통계는 한국 날짜 기준) -----
def utc_now():
    return datetime.now(timezone.utc)


def to_kst_date(utc_text):
    """'YYYY-MM-DD HH:MM:SS'(UTC) -> 한국 날짜"""
    dt = datetime.strptime(utc_text, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    return dt.astimezone(KST).date()


# ----- 로그인 -----
class User(UserMixin):
    def __init__(self, row):
        self.id = row["id"]
        self.username = row["username"]
        self.nickname = row["nickname"]
        self.daily_goal = row["daily_goal"]


@login_manager.user_loader
def load_user(user_id):
    row = get_db().execute("SELECT * FROM user WHERE id = ?", (user_id,)).fetchone()
    return User(row) if row else None


# ----- 화면 -----
@app.get("/")
def index():
    return render_template("index.html")


# ----- 회원 API -----
@app.get("/me")
def me():
    if current_user.is_authenticated:
        return {
            "id": current_user.id,
            "nickname": current_user.nickname,
            "daily_goal": current_user.daily_goal,
        }
    return {"id": None}


@app.post("/signup")
def signup():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    nickname = (data.get("nickname") or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9]{4,20}", username):
        return {"error": "아이디는 영문·숫자 4~20자여야 해요."}, 400
    if not (8 <= len(password) <= 64):
        return {"error": "비밀번호는 8~64자여야 해요."}, 400
    if not (1 <= len(nickname) <= 12):
        return {"error": "닉네임은 1~12자여야 해요."}, 400
    db = get_db()
    if db.execute("SELECT 1 FROM user WHERE username = ?", (username,)).fetchone():
        return {"error": "이미 있는 아이디예요."}, 400
    pw_hash = bcrypt.generate_password_hash(password).decode("utf-8")
    cur = db.execute(
        "INSERT INTO user (username, pw_hash, nickname) VALUES (?, ?, ?)",
        (username, pw_hash, nickname),
    )
    db.commit()
    row = db.execute("SELECT * FROM user WHERE id = ?", (cur.lastrowid,)).fetchone()
    login_user(User(row), remember=True)
    return {"nickname": nickname}, 201


@app.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    row = get_db().execute("SELECT * FROM user WHERE username = ?", (username,)).fetchone()
    if row and bcrypt.check_password_hash(row["pw_hash"], password):
        login_user(User(row), remember=True)
        return {"nickname": row["nickname"]}
    return {"error": "아이디나 비밀번호가 맞지 않아요."}, 401


@app.post("/logout")
@login_required
def logout():
    logout_user()
    return {"ok": True}


@app.put("/goal")
@login_required
def set_goal():
    minutes = (request.get_json(silent=True) or {}).get("minutes")
    if not isinstance(minutes, int) or not (10 <= minutes <= 720):
        return {"error": "목표는 10~720분 사이로 정해주세요."}, 400
    db = get_db()
    db.execute("UPDATE user SET daily_goal = ? WHERE id = ?", (minutes, current_user.id))
    db.commit()
    return {"daily_goal": minutes}


# ----- 과목 API -----
def _subject_rows(uid):
    return get_db().execute(
        "SELECT id, name, color FROM subject WHERE user_id = ? ORDER BY id", (uid,)
    ).fetchall()


@app.get("/subjects")
@login_required
def list_subjects():
    db = get_db()
    rows = _subject_rows(current_user.id)
    if not rows:
        # 처음이면 기본 과목 3개를 만들어 준다
        for name, color in DEFAULT_SUBJECTS:
            db.execute(
                "INSERT INTO subject (user_id, name, color) VALUES (?, ?, ?)",
                (current_user.id, name, color),
            )
        db.commit()
        rows = _subject_rows(current_user.id)
    return jsonify([dict(r) for r in rows])


@app.post("/subjects")
@login_required
def add_subject():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    color = data.get("color")
    if not (1 <= len(name) <= 20):
        return {"error": "과목 이름은 1~20자여야 해요."}, 400
    if color not in SUBJECT_COLORS:
        color = SUBJECT_COLORS[0]
    db = get_db()
    count = db.execute(
        "SELECT COUNT(*) FROM subject WHERE user_id = ?", (current_user.id,)
    ).fetchone()[0]
    if count >= 20:
        return {"error": "과목은 20개까지 만들 수 있어요."}, 400
    if db.execute(
        "SELECT 1 FROM subject WHERE user_id = ? AND name = ?", (current_user.id, name)
    ).fetchone():
        return {"error": "같은 이름의 과목이 이미 있어요."}, 400
    cur = db.execute(
        "INSERT INTO subject (user_id, name, color) VALUES (?, ?, ?)",
        (current_user.id, name, color),
    )
    db.commit()
    return {"id": cur.lastrowid, "name": name, "color": color}, 201


@app.delete("/subjects/<int:sid>")
@login_required
def delete_subject(sid):
    db = get_db()
    # 과목을 지워도 공부 기록은 남긴다 ('과목 없음'으로)
    db.execute(
        "UPDATE study SET subject_id = NULL WHERE subject_id = ? AND user_id = ?",
        (sid, current_user.id),
    )
    db.execute(
        "UPDATE plan SET subject_id = NULL WHERE subject_id = ? AND user_id = ?",
        (sid, current_user.id),
    )
    db.execute(
        "UPDATE wrong SET subject_id = NULL WHERE subject_id = ? AND user_id = ?",
        (sid, current_user.id),
    )
    db.execute("DELETE FROM subject WHERE id = ? AND user_id = ?", (sid, current_user.id))
    db.commit()
    return "", 204


# ----- 공부 기록 API -----
@app.post("/sessions")
@login_required
def add_session():
    data = request.get_json(silent=True) or {}
    minutes = data.get("minutes")
    subject_id = data.get("subject_id")
    memo = (data.get("memo") or "").strip()[:100]
    mode = data.get("mode") if data.get("mode") in MODES else "focus"

    if not isinstance(minutes, int) or not (1 <= minutes <= 300):
        return {"error": "공부 시간은 1~300분이어야 해요."}, 400
    db = get_db()
    if subject_id is not None:
        ok = db.execute(
            "SELECT 1 FROM subject WHERE id = ? AND user_id = ?",
            (subject_id, current_user.id),
        ).fetchone()
        if not ok:
            subject_id = None
    # 할 일에서 시작한 집중이면 그 할 일에 시간을 쌓는다 (내 할 일만)
    plan_id = data.get("plan_id")
    if plan_id is not None:
        ok = db.execute(
            "SELECT 1 FROM plan WHERE id = ? AND user_id = ?", (plan_id, current_user.id)
        ).fetchone() if isinstance(plan_id, int) else None
        if not ok:
            plan_id = None

    ended = utc_now().strftime("%Y-%m-%d %H:%M:%S")
    cur = db.execute(
        "INSERT INTO study (user_id, subject_id, minutes, mode, memo, ended_at, plan_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (current_user.id, subject_id, minutes, mode, memo, ended, plan_id),
    )
    db.commit()
    return {"id": cur.lastrowid}, 201


@app.get("/sessions")
@login_required
def list_sessions():
    rows = get_db().execute(
        "SELECT s.id, s.minutes, s.mode, s.memo, s.ended_at, "
        "       sub.name AS subject, sub.color AS color "
        "FROM study s LEFT JOIN subject sub ON sub.id = s.subject_id "
        "WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 30",
        (current_user.id,),
    ).fetchall()
    out = []
    for r in rows:
        ended = datetime.strptime(r["ended_at"], "%Y-%m-%d %H:%M:%S").replace(
            tzinfo=timezone.utc
        ).astimezone(KST)
        out.append(
            {
                "id": r["id"],
                "minutes": r["minutes"],
                "mode": r["mode"],
                "memo": r["memo"],
                "subject": r["subject"] or "과목 없음",
                "color": r["color"] or "#8E8E93",
                "when": ended.strftime("%m월 %d일 %H:%M"),
            }
        )
    return jsonify(out)


@app.delete("/sessions/<int:sid>")
@login_required
def delete_session(sid):
    db = get_db()
    db.execute("DELETE FROM study WHERE id = ? AND user_id = ?", (sid, current_user.id))
    db.commit()
    return "", 204


# ----- 통계 API (한국 날짜 기준) -----
@app.get("/stats")
@login_required
def stats():
    db = get_db()
    rows = db.execute(
        "SELECT s.minutes, s.ended_at, sub.name AS subject, sub.color AS color "
        "FROM study s LEFT JOIN subject sub ON sub.id = s.subject_id "
        "WHERE s.user_id = ?",
        (current_user.id,),
    ).fetchall()

    today = utc_now().astimezone(KST).date()
    week_days = [today - timedelta(days=i) for i in range(6, -1, -1)]  # 6일 전 ~ 오늘
    week_start = week_days[0]

    per_day = {}
    by_subject = {}
    total = 0
    for r in rows:
        d = to_kst_date(r["ended_at"])
        per_day[d] = per_day.get(d, 0) + r["minutes"]
        total += r["minutes"]
        if d >= week_start:
            name = r["subject"] or "과목 없음"
            item = by_subject.setdefault(name, {"name": name, "color": r["color"] or "#8E8E93", "minutes": 0})
            item["minutes"] += r["minutes"]

    # 연속 공부일: 오늘 공부했으면 오늘부터, 아직이면 어제부터 거꾸로 센다
    streak = 0
    day = today if per_day.get(today) else today - timedelta(days=1)
    while per_day.get(day):
        streak += 1
        day -= timedelta(days=1)

    weekday_names = ["월", "화", "수", "목", "금", "토", "일"]
    week = [
        {
            "date": d.isoformat(),
            "label": "오늘" if d == today else weekday_names[d.weekday()],
            "minutes": per_day.get(d, 0),
        }
        for d in week_days
    ]

    return jsonify(
        {
            "today": per_day.get(today, 0),
            "goal": current_user.daily_goal,
            "streak": streak,
            "week": week,
            "week_total": sum(x["minutes"] for x in week),
            "by_subject": sorted(by_subject.values(), key=lambda x: -x["minutes"]),
            "total": total,
        }
    )


# ----- 스터디 플래너 API (날짜는 한국 날짜 YYYY-MM-DD) -----
MAX_PLANS_PER_DAY = 30


def kst_today():
    return utc_now().astimezone(KST).date()


def _parse_day(text):
    """'YYYY-MM-DD' -> date. 이상한 값이면 None."""
    try:
        return datetime.strptime(text or "", "%Y-%m-%d").date()
    except ValueError:
        return None


def _check_subject(db, subject_id):
    """내 과목이면 그대로, 아니면 None."""
    if not isinstance(subject_id, int):
        return None
    ok = db.execute(
        "SELECT 1 FROM subject WHERE id = ? AND user_id = ?", (subject_id, current_user.id)
    ).fetchone()
    return subject_id if ok else None


def _plans_for(db, day_text):
    rows = db.execute(
        "SELECT p.id, p.title, p.subject_id, p.target_min, p.done, "
        "       sub.name AS subject, sub.color AS color, "
        "       COALESCE((SELECT SUM(minutes) FROM study s WHERE s.plan_id = p.id), 0) AS studied "
        "FROM plan p LEFT JOIN subject sub ON sub.id = p.subject_id "
        "WHERE p.user_id = ? AND p.day = ? ORDER BY p.done, p.position, p.id",
        (current_user.id, day_text),
    ).fetchall()
    return [
        {
            "id": r["id"],
            "title": r["title"],
            "subject_id": r["subject_id"],
            "subject": r["subject"],
            "color": r["color"],
            "target_min": r["target_min"],
            "studied": r["studied"],
            "done": bool(r["done"]),
        }
        for r in rows
    ]


@app.get("/plans")
@login_required
def list_plans():
    day = _parse_day(request.args.get("day")) or kst_today()
    db = get_db()
    plans = _plans_for(db, day.isoformat())
    # 전날까지 못 끝낸 할 일 수 (오늘을 볼 때 '가져오기' 안내용)
    carry = 0
    if day == kst_today():
        carry = db.execute(
            "SELECT COUNT(*) FROM plan WHERE user_id = ? AND day < ? AND done = 0 AND day >= ?",
            (current_user.id, day.isoformat(), (day - timedelta(days=7)).isoformat()),
        ).fetchone()[0]
    # 날짜 이동 줄에 표시할 앞뒤 7일의 할 일 수
    start, end = day - timedelta(days=3), day + timedelta(days=3)
    counts = {
        r["day"]: {"total": r["total"], "done": r["done"]}
        for r in db.execute(
            "SELECT day, COUNT(*) AS total, SUM(done) AS done FROM plan "
            "WHERE user_id = ? AND day BETWEEN ? AND ? GROUP BY day",
            (current_user.id, start.isoformat(), end.isoformat()),
        )
    }
    return jsonify(
        {
            "day": day.isoformat(),
            "today": kst_today().isoformat(),
            "plans": plans,
            "carry": carry,
            "counts": counts,
        }
    )


@app.post("/plans")
@login_required
def add_plan():
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    day = _parse_day(data.get("day")) or kst_today()
    target = data.get("target_min") or 0
    if not (1 <= len(title) <= 60):
        return {"error": "할 일은 1~60자로 적어주세요."}, 400
    if not isinstance(target, int) or not (0 <= target <= 600):
        return {"error": "목표 시간은 0~600분이어야 해요."}, 400
    db = get_db()
    count = db.execute(
        "SELECT COUNT(*) FROM plan WHERE user_id = ? AND day = ?",
        (current_user.id, day.isoformat()),
    ).fetchone()[0]
    if count >= MAX_PLANS_PER_DAY:
        return {"error": f"하루에 할 일은 {MAX_PLANS_PER_DAY}개까지예요."}, 400
    cur = db.execute(
        "INSERT INTO plan (user_id, day, title, subject_id, target_min, position) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (current_user.id, day.isoformat(), title, _check_subject(db, data.get("subject_id")), target, count),
    )
    db.commit()
    return {"id": cur.lastrowid}, 201


@app.patch("/plans/<int:pid>")
@login_required
def update_plan(pid):
    data = request.get_json(silent=True) or {}
    db = get_db()
    if not db.execute(
        "SELECT 1 FROM plan WHERE id = ? AND user_id = ?", (pid, current_user.id)
    ).fetchone():
        return {"error": "할 일을 찾을 수 없어요."}, 404

    sets, args = [], []
    if "title" in data:
        title = (data.get("title") or "").strip()
        if not (1 <= len(title) <= 60):
            return {"error": "할 일은 1~60자로 적어주세요."}, 400
        sets.append("title = ?")
        args.append(title)
    if "done" in data:
        sets.append("done = ?")
        args.append(1 if data.get("done") else 0)
    if "target_min" in data:
        target = data.get("target_min") or 0
        if not isinstance(target, int) or not (0 <= target <= 600):
            return {"error": "목표 시간은 0~600분이어야 해요."}, 400
        sets.append("target_min = ?")
        args.append(target)
    if "subject_id" in data:
        sets.append("subject_id = ?")
        args.append(_check_subject(db, data.get("subject_id")))
    if "day" in data:
        day = _parse_day(data.get("day"))
        if not day:
            return {"error": "날짜가 올바르지 않아요."}, 400
        sets.append("day = ?")
        args.append(day.isoformat())
    if sets:
        # 고정된 칸 이름만 이어 붙이고, 값은 모두 ? 로 넘긴다
        db.execute(
            f"UPDATE plan SET {', '.join(sets)} WHERE id = ? AND user_id = ?",
            (*args, pid, current_user.id),
        )
        db.commit()
    return {"ok": True}


@app.delete("/plans/<int:pid>")
@login_required
def delete_plan(pid):
    db = get_db()
    # 할 일을 지워도 공부 기록은 남는다
    db.execute(
        "UPDATE study SET plan_id = NULL WHERE plan_id = ? AND user_id = ?", (pid, current_user.id)
    )
    db.execute("DELETE FROM plan WHERE id = ? AND user_id = ?", (pid, current_user.id))
    db.commit()
    return "", 204


@app.post("/plans/carry")
@login_required
def carry_plans():
    """최근 7일 동안 못 끝낸 할 일을 오늘로 옮긴다."""
    today = kst_today()
    db = get_db()
    cur = db.execute(
        "UPDATE plan SET day = ? WHERE user_id = ? AND day < ? AND day >= ? AND done = 0",
        (today.isoformat(), current_user.id, today.isoformat(), (today - timedelta(days=7)).isoformat()),
    )
    db.commit()
    return {"moved": cur.rowcount}


# ----- D-day API -----
MAX_DDAYS = 10


@app.get("/ddays")
@login_required
def list_ddays():
    today = kst_today()
    rows = get_db().execute(
        "SELECT id, title, day FROM dday WHERE user_id = ? ORDER BY day, id",
        (current_user.id,),
    ).fetchall()
    out = []
    for r in rows:
        d = _parse_day(r["day"])
        if not d:
            continue
        out.append({"id": r["id"], "title": r["title"], "day": r["day"], "left": (d - today).days})
    # 아직 안 지난 것 먼저(가까운 순), 지난 것은 뒤로
    out.sort(key=lambda x: (x["left"] < 0, abs(x["left"])))
    return jsonify(out)


@app.post("/ddays")
@login_required
def add_dday():
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    day = _parse_day(data.get("day"))
    if not (1 <= len(title) <= 20):
        return {"error": "이름은 1~20자로 적어주세요."}, 400
    if not day:
        return {"error": "날짜를 골라주세요."}, 400
    db = get_db()
    count = db.execute("SELECT COUNT(*) FROM dday WHERE user_id = ?", (current_user.id,)).fetchone()[0]
    if count >= MAX_DDAYS:
        return {"error": f"D-day는 {MAX_DDAYS}개까지 만들 수 있어요."}, 400
    cur = db.execute(
        "INSERT INTO dday (user_id, title, day) VALUES (?, ?, ?)",
        (current_user.id, title, day.isoformat()),
    )
    db.commit()
    return {"id": cur.lastrowid}, 201


@app.delete("/ddays/<int:did>")
@login_required
def delete_dday(did):
    db = get_db()
    db.execute("DELETE FROM dday WHERE id = ? AND user_id = ?", (did, current_user.id))
    db.commit()
    return "", 204


# ----- 공부 잔디 (최근 12주, 한국 날짜) -----
@app.get("/heatmap")
@login_required
def heatmap():
    today = kst_today()
    # 이번 주 일요일까지 채우고, 12주 전 월요일부터 시작
    end = today + timedelta(days=6 - today.weekday())
    start = end - timedelta(days=12 * 7 - 1)
    per_day = {}
    rows = get_db().execute(
        "SELECT minutes, ended_at FROM study WHERE user_id = ? AND ended_at >= ?",
        (current_user.id, (start - timedelta(days=1)).isoformat()),
    ).fetchall()
    for r in rows:
        d = to_kst_date(r["ended_at"])
        if start <= d <= end:
            per_day[d] = per_day.get(d, 0) + r["minutes"]
    days = []
    d = start
    while d <= end:
        days.append({"date": d.isoformat(), "minutes": per_day.get(d, 0), "future": d > today})
        d += timedelta(days=1)
    studied = [x for x in days if x["minutes"] > 0]
    return jsonify(
        {
            "days": days,
            "study_days": len(studied),
            "best": max((x["minutes"] for x in days), default=0),
        }
    )


# ----- 공부 기록 내보내기 (엑셀에서 열리는 CSV) -----
@app.get("/export.csv")
@login_required
def export_csv():
    rows = get_db().execute(
        "SELECT s.ended_at, s.minutes, s.mode, s.memo, sub.name AS subject, p.title AS plan "
        "FROM study s LEFT JOIN subject sub ON sub.id = s.subject_id "
        "LEFT JOIN plan p ON p.id = s.plan_id "
        "WHERE s.user_id = ? ORDER BY s.ended_at",
        (current_user.id,),
    ).fetchall()

    def safe(text):
        # 엑셀이 '=' 등으로 시작하는 글을 수식으로 실행하지 않게 막는다
        text = text or ""
        return "'" + text if text[:1] in ("=", "+", "-", "@") else text

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["날짜", "끝난 시각", "과목", "공부 시간(분)", "방식", "할 일", "메모"])
    for r in rows:
        ended = datetime.strptime(r["ended_at"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).astimezone(KST)
        w.writerow([
            ended.strftime("%Y-%m-%d"),
            ended.strftime("%H:%M"),
            safe(r["subject"] or "과목 없음"),
            r["minutes"],
            "직접 입력" if r["mode"] == "free" else "타이머",
            safe(r["plan"]),
            safe(r["memo"]),
        ])
    # BOM을 붙여야 엑셀에서 한글이 안 깨진다
    data = "\ufeff" + buf.getvalue()
    name = f"focusnote-{kst_today().isoformat()}.csv"
    return Response(
        data,
        mimetype="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


# ----- 플래너 월 달력 -----
@app.get("/plans/month")
@login_required
def plans_month():
    """한 달 동안 날짜별 할 일 수·완료 수·공부 시간, 그 달의 D-day."""
    today = kst_today()
    text = request.args.get("month") or today.strftime("%Y-%m")
    try:
        first = datetime.strptime(text, "%Y-%m").date()
    except ValueError:
        first = today.replace(day=1)
    nxt = (first.replace(day=28) + timedelta(days=4)).replace(day=1)  # 다음 달 1일
    last = nxt - timedelta(days=1)
    db = get_db()

    days = {}
    for r in db.execute(
        "SELECT day, COUNT(*) AS total, SUM(done) AS done FROM plan "
        "WHERE user_id = ? AND day BETWEEN ? AND ? GROUP BY day",
        (current_user.id, first.isoformat(), last.isoformat()),
    ):
        days[r["day"]] = {"total": r["total"], "done": r["done"] or 0, "studied": 0}

    # 공부 기록은 UTC로 저장돼 있어 한국 날짜로 바꿔서 센다 (앞뒤 하루 여유)
    for r in db.execute(
        "SELECT minutes, ended_at FROM study WHERE user_id = ? AND ended_at BETWEEN ? AND ?",
        (current_user.id, (first - timedelta(days=1)).isoformat(), (nxt + timedelta(days=1)).isoformat()),
    ):
        d = to_kst_date(r["ended_at"])
        if first <= d <= last:
            item = days.setdefault(d.isoformat(), {"total": 0, "done": 0, "studied": 0})
            item["studied"] += r["minutes"]

    ddays = [
        {"day": r["day"], "title": r["title"]}
        for r in db.execute(
            "SELECT day, title FROM dday WHERE user_id = ? AND day BETWEEN ? AND ? ORDER BY day",
            (current_user.id, first.isoformat(), last.isoformat()),
        )
    ]
    return jsonify(
        {
            "month": first.strftime("%Y-%m"),
            "today": today.isoformat(),
            "days": days,
            "ddays": ddays,
        }
    )


# ----- 시간표 -----
MAX_PERIODS = 10


@app.get("/timetable")
@login_required
def get_timetable():
    rows = get_db().execute(
        "SELECT weekday, period, name FROM timetable WHERE user_id = ?", (current_user.id,)
    ).fetchall()
    cells = {f"{r['weekday']}-{r['period']}": r["name"] for r in rows}
    periods = max([r["period"] for r in rows] + [7])
    return jsonify({"cells": cells, "periods": min(periods, MAX_PERIODS)})


@app.put("/timetable")
@login_required
def set_timetable_cell():
    """칸 하나 바꾸기. 이름이 비면 지운다."""
    data = request.get_json(silent=True) or {}
    wd, pd = data.get("weekday"), data.get("period")
    name = (data.get("name") or "").strip()
    if not (isinstance(wd, int) and 0 <= wd <= 4 and isinstance(pd, int) and 1 <= pd <= MAX_PERIODS):
        return {"error": "칸 위치가 올바르지 않아요."}, 400
    if len(name) > 12:
        return {"error": "과목 이름은 12자까지예요."}, 400
    db = get_db()
    if name:
        db.execute(
            "INSERT INTO timetable (user_id, weekday, period, name) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(user_id, weekday, period) DO UPDATE SET name = excluded.name",
            (current_user.id, wd, pd, name),
        )
    else:
        db.execute(
            "DELETE FROM timetable WHERE user_id = ? AND weekday = ? AND period = ?",
            (current_user.id, wd, pd),
        )
    db.commit()
    return {"ok": True}


# ----- 단어장 (복습 상자 방식) -----
# 맞히면 상자가 한 칸 올라가고, 상자마다 다음 복습까지 기다리는 날 수
BOX_DAYS = {1: 1, 2: 2, 3: 4, 4: 7, 5: 14}
MAX_DECKS = 30
MAX_CARDS_PER_DECK = 500


def _my_deck(db, did):
    return db.execute("SELECT id, name FROM deck WHERE id = ? AND user_id = ?", (did, current_user.id)).fetchone()


@app.get("/decks")
@login_required
def list_decks():
    today = kst_today().isoformat()
    rows = get_db().execute(
        "SELECT d.id, d.name, COUNT(c.id) AS total, "
        "       SUM(CASE WHEN c.due <= ? THEN 1 ELSE 0 END) AS due, "
        "       SUM(CASE WHEN c.box >= 5 THEN 1 ELSE 0 END) AS mastered "
        "FROM deck d LEFT JOIN card c ON c.deck_id = d.id "
        "WHERE d.user_id = ? GROUP BY d.id ORDER BY d.id",
        (today, current_user.id),
    ).fetchall()
    return jsonify([
        {"id": r["id"], "name": r["name"], "total": r["total"], "due": r["due"] or 0, "mastered": r["mastered"] or 0}
        for r in rows
    ])


@app.post("/decks")
@login_required
def add_deck():
    name = ((request.get_json(silent=True) or {}).get("name") or "").strip()
    if not (1 <= len(name) <= 20):
        return {"error": "단어장 이름은 1~20자로 적어주세요."}, 400
    db = get_db()
    if db.execute("SELECT COUNT(*) FROM deck WHERE user_id = ?", (current_user.id,)).fetchone()[0] >= MAX_DECKS:
        return {"error": f"단어장은 {MAX_DECKS}개까지 만들 수 있어요."}, 400
    cur = db.execute("INSERT INTO deck (user_id, name) VALUES (?, ?)", (current_user.id, name))
    db.commit()
    return {"id": cur.lastrowid, "name": name}, 201


@app.delete("/decks/<int:did>")
@login_required
def delete_deck(did):
    db = get_db()
    if not _my_deck(db, did):
        return "", 204
    db.execute("DELETE FROM card WHERE deck_id = ? AND user_id = ?", (did, current_user.id))
    db.execute("DELETE FROM deck WHERE id = ? AND user_id = ?", (did, current_user.id))
    db.commit()
    return "", 204


@app.get("/decks/<int:did>/cards")
@login_required
def list_cards(did):
    db = get_db()
    deck = _my_deck(db, did)
    if not deck:
        return {"error": "단어장을 찾을 수 없어요."}, 404
    rows = db.execute(
        "SELECT id, front, back, box, due FROM card WHERE deck_id = ? AND user_id = ? ORDER BY id",
        (did, current_user.id),
    ).fetchall()
    return jsonify({"deck": {"id": deck["id"], "name": deck["name"]}, "cards": [dict(r) for r in rows]})


@app.post("/decks/<int:did>/cards")
@login_required
def add_cards(did):
    """카드 여러 장 한꺼번에 추가. lines: ["앞 - 뒤", ...] 또는 front/back 하나."""
    data = request.get_json(silent=True) or {}
    db = get_db()
    if not _my_deck(db, did):
        return {"error": "단어장을 찾을 수 없어요."}, 404
    pairs = []
    if data.get("front") is not None:
        pairs.append(((data.get("front") or "").strip(), (data.get("back") or "").strip()))
    for line in (data.get("lines") or [])[:MAX_CARDS_PER_DECK]:
        line = str(line).strip()
        if not line:
            continue
        # 탭, " - ", ":" , "=" 중 처음 나오는 것으로 앞/뒤를 나눈다
        for sep in ("\t", " - ", " : ", ":", "="):
            if sep in line:
                f, b = line.split(sep, 1)
                pairs.append((f.strip(), b.strip()))
                break
        else:
            pairs.append((line, ""))
    pairs = [(f, b) for f, b in pairs if f and b]
    if not pairs:
        return {"error": "앞면과 뒷면을 모두 적어주세요. (예: apple - 사과)"}, 400
    if any(len(f) > 100 or len(b) > 200 for f, b in pairs):
        return {"error": "앞면은 100자, 뒷면은 200자까지예요."}, 400
    count = db.execute("SELECT COUNT(*) FROM card WHERE deck_id = ?", (did,)).fetchone()[0]
    if count + len(pairs) > MAX_CARDS_PER_DECK:
        return {"error": f"단어장 하나에 카드는 {MAX_CARDS_PER_DECK}장까지예요."}, 400
    today = kst_today().isoformat()
    db.executemany(
        "INSERT INTO card (deck_id, user_id, front, back, box, due) VALUES (?, ?, ?, ?, 1, ?)",
        [(did, current_user.id, f, b, today) for f, b in pairs],
    )
    db.commit()
    return {"added": len(pairs)}, 201


@app.delete("/cards/<int:cid>")
@login_required
def delete_card(cid):
    db = get_db()
    db.execute("DELETE FROM card WHERE id = ? AND user_id = ?", (cid, current_user.id))
    db.commit()
    return "", 204


@app.get("/decks/<int:did>/study")
@login_required
def study_cards(did):
    """오늘 복습할 카드 (all=1이면 전부)."""
    db = get_db()
    deck = _my_deck(db, did)
    if not deck:
        return {"error": "단어장을 찾을 수 없어요."}, 404
    if request.args.get("all") == "1":
        rows = db.execute("SELECT id, front, back, box FROM card WHERE deck_id = ? AND user_id = ?",
                          (did, current_user.id)).fetchall()
    else:
        rows = db.execute("SELECT id, front, back, box FROM card WHERE deck_id = ? AND user_id = ? AND due <= ?",
                          (did, current_user.id, kst_today().isoformat())).fetchall()
    cards = [dict(r) for r in rows]
    random.shuffle(cards)
    return jsonify({"deck": {"id": deck["id"], "name": deck["name"]}, "cards": cards})


@app.post("/cards/<int:cid>/grade")
@login_required
def grade_card(cid):
    """외웠어요(known=true) → 상자 +1, 몰라요 → 상자 1로, 내일 다시."""
    known = bool((request.get_json(silent=True) or {}).get("known"))
    db = get_db()
    row = db.execute("SELECT box FROM card WHERE id = ? AND user_id = ?", (cid, current_user.id)).fetchone()
    if not row:
        return {"error": "카드를 찾을 수 없어요."}, 404
    box = min(5, row["box"] + 1) if known else 1
    due = kst_today() + timedelta(days=BOX_DAYS[box] if known else 1)
    db.execute("UPDATE card SET box = ?, due = ? WHERE id = ? AND user_id = ?",
               (box, due.isoformat(), cid, current_user.id))
    db.commit()
    return {"box": box, "due": due.isoformat()}


# ----- 오답노트 -----
# 다시 볼 간격: 처음 1일 뒤 → 3일 → 7일 → 그 뒤로는 14일
WRONG_STEPS = [1, 3, 7, 14]


def _wrong_rows(db, where, args):
    rows = db.execute(
        "SELECT w.id, w.subject_id, w.source, w.question, w.answer, w.reason, w.review_on, "
        "       w.reviews, w.solved, w.created_at, sub.name AS subject, sub.color AS color "
        "FROM wrong w LEFT JOIN subject sub ON sub.id = w.subject_id "
        f"WHERE w.user_id = ? {where} ORDER BY w.solved, w.review_on, w.id DESC",
        (current_user.id, *args),
    ).fetchall()
    return [dict(r, solved=bool(r["solved"])) for r in rows]


@app.get("/wrongs")
@login_required
def list_wrongs():
    db = get_db()
    today = kst_today().isoformat()
    show = request.args.get("show", "open")  # open / due / solved / all
    where, args = "", []
    if show == "open":
        where = "AND w.solved = 0"
    elif show == "due":
        where, args = "AND w.solved = 0 AND w.review_on <= ?", [today]
    elif show == "solved":
        where = "AND w.solved = 1"
    sid = request.args.get("subject_id", type=int)
    if sid:
        where += " AND w.subject_id = ?"
        args.append(sid)
    return jsonify({"today": today, "items": _wrong_rows(db, where, args)})


@app.post("/wrongs")
@login_required
def add_wrong():
    data = request.get_json(silent=True) or {}
    question = (data.get("question") or "").strip()
    if not (1 <= len(question) <= 500):
        return {"error": "문제는 1~500자로 적어주세요."}, 400
    source = (data.get("source") or "").strip()[:60]
    answer = (data.get("answer") or "").strip()[:500]
    reason = (data.get("reason") or "").strip()[:300]
    db = get_db()
    if db.execute("SELECT COUNT(*) FROM wrong WHERE user_id = ?", (current_user.id,)).fetchone()[0] >= 1000:
        return {"error": "오답은 1000개까지 저장할 수 있어요."}, 400
    review_on = (kst_today() + timedelta(days=WRONG_STEPS[0])).isoformat()
    cur = db.execute(
        "INSERT INTO wrong (user_id, subject_id, source, question, answer, reason, review_on) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (current_user.id, _check_subject(db, data.get("subject_id")), source, question, answer, reason, review_on),
    )
    db.commit()
    return {"id": cur.lastrowid, "review_on": review_on}, 201


@app.post("/wrongs/<int:wid>/review")
@login_required
def review_wrong(wid):
    """다시 풀어 봤을 때: 맞혔으면 간격을 늘리고 3번째에 '해결', 또 틀렸으면 내일 다시."""
    correct = bool((request.get_json(silent=True) or {}).get("correct"))
    db = get_db()
    row = db.execute("SELECT reviews FROM wrong WHERE id = ? AND user_id = ?", (wid, current_user.id)).fetchone()
    if not row:
        return {"error": "오답을 찾을 수 없어요."}, 404
    if correct:
        reviews = row["reviews"] + 1
        solved = 1 if reviews >= 3 else 0
        step = WRONG_STEPS[min(reviews, len(WRONG_STEPS) - 1)]
    else:
        reviews, solved, step = 0, 0, 1
    review_on = (kst_today() + timedelta(days=step)).isoformat()
    db.execute("UPDATE wrong SET reviews = ?, solved = ?, review_on = ? WHERE id = ? AND user_id = ?",
               (reviews, solved, review_on, wid, current_user.id))
    db.commit()
    return {"reviews": reviews, "solved": bool(solved), "review_on": review_on}


@app.patch("/wrongs/<int:wid>")
@login_required
def update_wrong(wid):
    data = request.get_json(silent=True) or {}
    db = get_db()
    if not db.execute("SELECT 1 FROM wrong WHERE id = ? AND user_id = ?", (wid, current_user.id)).fetchone():
        return {"error": "오답을 찾을 수 없어요."}, 404
    sets, args = [], []
    for key, limit in (("source", 60), ("answer", 500), ("reason", 300)):
        if key in data:
            sets.append(f"{key} = ?")
            args.append((data.get(key) or "").strip()[:limit])
    if "question" in data:
        q = (data.get("question") or "").strip()
        if not (1 <= len(q) <= 500):
            return {"error": "문제는 1~500자로 적어주세요."}, 400
        sets.append("question = ?")
        args.append(q)
    if "subject_id" in data:
        sets.append("subject_id = ?")
        args.append(_check_subject(db, data.get("subject_id")))
    if "solved" in data:
        sets.append("solved = ?")
        args.append(1 if data.get("solved") else 0)
    if sets:
        db.execute(f"UPDATE wrong SET {', '.join(sets)} WHERE id = ? AND user_id = ?", (*args, wid, current_user.id))
        db.commit()
    return {"ok": True}


@app.delete("/wrongs/<int:wid>")
@login_required
def delete_wrong(wid):
    db = get_db()
    db.execute("DELETE FROM wrong WHERE id = ? AND user_id = ?", (wid, current_user.id))
    db.commit()
    return "", 204


# ----- 오늘 복습할 것 요약 (타이머 화면 알림용) -----
@app.get("/review-summary")
@login_required
def review_summary():
    db = get_db()
    today = kst_today()
    cards = db.execute("SELECT COUNT(*) FROM card WHERE user_id = ? AND due <= ?",
                       (current_user.id, today.isoformat())).fetchone()[0]
    wrongs = db.execute("SELECT COUNT(*) FROM wrong WHERE user_id = ? AND solved = 0 AND review_on <= ?",
                        (current_user.id, today.isoformat())).fetchone()[0]
    # 오늘 시간표 (월~금만)
    classes = []
    if today.weekday() <= 4:
        classes = [
            {"period": r["period"], "name": r["name"]}
            for r in db.execute("SELECT period, name FROM timetable WHERE user_id = ? AND weekday = ? ORDER BY period",
                                (current_user.id, today.weekday()))
        ]
    return jsonify({"cards": cards, "wrongs": wrongs, "classes": classes, "weekday": today.weekday()})
