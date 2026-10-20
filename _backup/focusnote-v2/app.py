import os
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from flask import Flask, g, jsonify, render_template, request
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
SUBJECT_COLORS = [
    "#1f3a34", "#3f5a74", "#b4552d", "#8a6d3b",
    "#4f6d5e", "#7a4a6b", "#5b6b2f", "#2f5f6b",
]
DEFAULT_SUBJECTS = [("국어", "#b4552d"), ("수학", "#3f5a74"), ("영어", "#4f6d5e")]
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
        # 공부 기록이 어떤 할 일에서 나왔는지 (기존 기록은 비어 있음)
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
                "color": r["color"] or "#8a8780",
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
            item = by_subject.setdefault(name, {"name": name, "color": r["color"] or "#8a8780", "minutes": 0})
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
