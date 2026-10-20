"""볼트 커넥션 — 서버.

정답 확인·별·코인·타임어택 남은 시간·점수는 모두 여기서 계산한다.
화면은 보여 주기만 하고, 결과는 서버가 다시 확인한 것만 저장한다.
"""
import json
import os
import re
import secrets
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from flask import Flask, g, jsonify, render_template, request
from flask_bcrypt import Bcrypt
from flask_login import LoginManager, UserMixin, current_user, login_required, login_user, logout_user

import volt_engine as eng

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:
    pass

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-change-me")
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
bcrypt = Bcrypt(app)
login_manager = LoginManager(app)

DB_PATH = os.environ.get("VC_DB", "app.db")   # 시험할 때만 다른 파일을 쓴다
KST = ZoneInfo("Asia/Seoul")

GUEST_MAX_STAGE = 6          # 로그인 안 해도 할 수 있는 스테이지
START_WALLET = {"coins": 50, "charger": 2, "breaker": 2, "meter": 3}
PRICES = {"charger": 30, "breaker": 40, "meter": 25}
ITEMS = {
    "meter": {"name": "전압계", "desc": "다음에 놓을 건전지를 하나 알려 줘요."},
    "breaker": {"name": "누전 차단기", "desc": "누전된 칸 하나를 고쳐서 쓸 수 있게 해요."},
    "charger": {"name": "충전기", "desc": "타임어택에서 전력을 15초 채워요."},
}
RUSH_START = 60        # 타임어택 처음 전력(초)
RUSH_MAX = 80          # 전력은 이 이상 안 차요
RUSH_START_LEVEL = 2   # 처음 레벨 (1단계는 너무 쉬워서 2부터)
RUSH_SKIP_COST = 12    # 건너뛰면 줄어드는 전력


def rush_refill(level):
    """한 문제 풀면 채워지는 전력. 레벨이 오를수록 적게 채워진다 (2레벨 8초 → 10레벨부터 4초)."""
    return max(4, 9 - level // 2)


def rush_next_level(solved):
    """한 문제 풀 때마다 레벨이 1씩 오른다 (최대 12)."""
    return min(eng.MAX_LEVEL, RUSH_START_LEVEL + solved)
CHARGER_SEC = 15
GRACE = 1.5            # 화면과 서버 시간 차이를 봐주는 여유(초)


@login_manager.unauthorized_handler
def unauthorized():
    return {"error": "로그인이 필요해요."}, 401


# ----- DB -----
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH, timeout=10)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    with sqlite3.connect(DB_PATH) as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS user (
                id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, pw_hash TEXT NOT NULL,
                nickname TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS vc_wallet (
                user_id INTEGER PRIMARY KEY, coins INTEGER NOT NULL, charger INTEGER NOT NULL,
                breaker INTEGER NOT NULL, meter INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS vc_progress (
                user_id INTEGER NOT NULL, stage INTEGER NOT NULL, stars INTEGER NOT NULL,
                best INTEGER NOT NULL, cleared_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (user_id, stage)
            );
            CREATE TABLE IF NOT EXISTS vc_play (
                id INTEGER PRIMARY KEY, token TEXT UNIQUE NOT NULL, user_id INTEGER,
                kind TEXT NOT NULL, stage_no INTEGER, day TEXT, puzzle TEXT NOT NULL,
                unblocked TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'open',
                started REAL NOT NULL, puzzle_started REAL NOT NULL,
                deadline REAL, score INTEGER NOT NULL DEFAULT 0, solved INTEGER NOT NULL DEFAULT 0,
                level INTEGER NOT NULL DEFAULT 1, seed INTEGER NOT NULL DEFAULT 0, idx INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_vc_play_started ON vc_play(started);
            CREATE TABLE IF NOT EXISTS vc_rush (
                id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, score INTEGER NOT NULL,
                solved INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_vc_rush_user ON vc_rush(user_id);
            CREATE TABLE IF NOT EXISTS vc_stats (
                user_id INTEGER PRIMARY KEY,
                solved INTEGER NOT NULL DEFAULT 0,      -- 모든 모드에서 푼 퍼즐 수
                practice INTEGER NOT NULL DEFAULT 0,    -- 연습에서 푼 수
                practice_best INTEGER NOT NULL DEFAULT 0, -- 연습에서 푼 가장 높은 레벨
                items INTEGER NOT NULL DEFAULT 0,       -- 쓴 아이템 수
                fast INTEGER NOT NULL DEFAULT 0,        -- 10초 안에 푼 수
                daily_days INTEGER NOT NULL DEFAULT 0,
                skin TEXT NOT NULL DEFAULT 'basic'
            );
            CREATE TABLE IF NOT EXISTS vc_ach (
                user_id INTEGER NOT NULL, ach TEXT NOT NULL,
                got_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (user_id, ach)
            );
            CREATE TABLE IF NOT EXISTS vc_skin (
                user_id INTEGER NOT NULL, skin TEXT NOT NULL, PRIMARY KEY (user_id, skin)
            );
            CREATE TABLE IF NOT EXISTS vc_counter (           -- 하루 단위 미션 진행
                user_id INTEGER NOT NULL, day TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, day, key)
            );
            CREATE TABLE IF NOT EXISTS vc_claim (             -- 받은 미션 보상
                user_id INTEGER NOT NULL, day TEXT NOT NULL, mid TEXT NOT NULL, PRIMARY KEY (user_id, day, mid)
            );
            CREATE TABLE IF NOT EXISTS vc_custom (            -- 퍼즐 공방: 사람들이 만든 퍼즐
                id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT NOT NULL, puzzle TEXT NOT NULL,
                min INTEGER NOT NULL, plays INTEGER NOT NULL DEFAULT 0, clears INTEGER NOT NULL DEFAULT 0,
                likes INTEGER NOT NULL DEFAULT 0, reports INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS vc_custom_like (user_id INTEGER NOT NULL, custom_id INTEGER NOT NULL, PRIMARY KEY (user_id, custom_id));
            CREATE TABLE IF NOT EXISTS vc_custom_clear (user_id INTEGER NOT NULL, custom_id INTEGER NOT NULL, used INTEGER NOT NULL, PRIMARY KEY (user_id, custom_id));
            CREATE TABLE IF NOT EXISTS vc_custom_report (user_id INTEGER NOT NULL, custom_id INTEGER NOT NULL, PRIMARY KEY (user_id, custom_id));
            CREATE TABLE IF NOT EXISTS vc_daily (
                user_id INTEGER NOT NULL, day TEXT NOT NULL, used INTEGER NOT NULL,
                secs INTEGER NOT NULL, stars INTEGER NOT NULL,
                PRIMARY KEY (user_id, day)
            );
            """
        )


init_db()


def _migrate():
    """예전에 만든 표에 새 칸 넣기 (기록은 그대로)."""
    with sqlite3.connect(DB_PATH) as db:
        cols = {r[1] for r in db.execute("PRAGMA table_info(vc_stats)")}
        for col, ddl in [("xp", "INTEGER NOT NULL DEFAULT 0"), ("streak", "INTEGER NOT NULL DEFAULT 0"),
                         ("best_streak", "INTEGER NOT NULL DEFAULT 0"), ("last_checkin", "TEXT NOT NULL DEFAULT ''"),
                         ("missions_done", "INTEGER NOT NULL DEFAULT 0"), ("published", "INTEGER NOT NULL DEFAULT 0"),
                         ("custom_wins", "INTEGER NOT NULL DEFAULT 0")]:
            if col not in cols:
                db.execute(f"ALTER TABLE vc_stats ADD COLUMN {col} {ddl}")   # 이름은 위에 정해 둔 것만


_migrate()


# ----- 로그인 -----
class User(UserMixin):
    def __init__(self, row):
        self.id = row["id"]
        self.username = row["username"]
        self.nickname = row["nickname"]


@login_manager.user_loader
def load_user(user_id):
    row = get_db().execute("SELECT id, username, nickname FROM user WHERE id = ?", (user_id,)).fetchone()
    return User(row) if row else None


def uid():
    return current_user.id if current_user.is_authenticated else None


def wallet(db, user_id):
    row = db.execute("SELECT coins, charger, breaker, meter FROM vc_wallet WHERE user_id = ?", (user_id,)).fetchone()
    if not row:
        db.execute(
            "INSERT INTO vc_wallet (user_id, coins, charger, breaker, meter) VALUES (?, ?, ?, ?, ?)",
            (user_id, *START_WALLET.values()),
        )
        db.commit()
        return dict(START_WALLET)
    return dict(row)


def kst_today():
    return datetime.now(timezone.utc).astimezone(KST).date()


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/me")
def me():
    if not current_user.is_authenticated:
        return {"id": None}
    db = get_db()
    total = db.execute("SELECT COALESCE(SUM(stars), 0) FROM vc_progress WHERE user_id = ?", (uid(),)).fetchone()[0]
    st = stats(db, uid())
    owned = ["basic"] + [r["skin"] for r in db.execute("SELECT skin FROM vc_skin WHERE user_id = ?", (uid(),))]
    return {"id": uid(), "nickname": current_user.nickname, "wallet": wallet(db, uid()), "stars": total,
            "skin": st["skin"], "skins": owned}


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
    pw = bcrypt.generate_password_hash(password).decode()
    cur = db.execute("INSERT INTO user (username, pw_hash, nickname) VALUES (?, ?, ?)", (username, pw, nickname))
    db.commit()
    row = db.execute("SELECT id, username, nickname FROM user WHERE id = ?", (cur.lastrowid,)).fetchone()
    login_user(User(row), remember=True)
    # 로그인 전에 깬 스테이지(1~6)를 옮겨 준다
    _import_guest(db, cur.lastrowid, data.get("guest"))
    return {"nickname": nickname}, 201


@app.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    row = get_db().execute(
        "SELECT id, username, nickname, pw_hash FROM user WHERE username = ?", ((data.get("username") or "").strip(),)
    ).fetchone()
    if row and bcrypt.check_password_hash(row["pw_hash"], data.get("password") or ""):
        login_user(User(row), remember=True)
        return {"nickname": row["nickname"]}
    return {"error": "아이디나 비밀번호가 맞지 않아요."}, 401


@app.post("/logout")
@login_required
def logout():
    logout_user()
    return {"ok": True}


def _import_guest(db, user_id, guest):
    """손님일 때 깬 기록. 서버가 확인한 증표(token)가 있는 것만 받는다."""
    if not isinstance(guest, list):
        return
    for token in guest[:GUEST_MAX_STAGE]:
        if not isinstance(token, str):
            continue
        p = db.execute(
            "SELECT stage_no, score FROM vc_play WHERE token = ? AND user_id IS NULL AND kind = 'stage' AND status = 'done'",
            (token,),
        ).fetchone()
        if p:
            _save_stage(db, user_id, p["stage_no"], p["score"])
            db.execute("UPDATE vc_play SET user_id = ? WHERE token = ?", (user_id, token))
    db.commit()


# ----- 스테이지 목록 -----
@app.get("/api/stages")
def stages():
    prog = {}
    if uid():
        for r in get_db().execute("SELECT stage, stars, best FROM vc_progress WHERE user_id = ?", (uid(),)):
            prog[r["stage"]] = {"stars": r["stars"], "best": r["best"]}
    out = []
    for s in eng.STAGES:
        p = prog.get(s["no"])
        out.append({
            "no": s["no"], "chapter": s["chapter"], "title": s["title"],
            "target": s["target"], "need": s["need"], "min": s["min"],
            "stars": p["stars"] if p else 0, "best": p["best"] if p else None,
            "unlocked": _unlocked(prog, s["no"]) if uid() else None,
        })
    return jsonify({"chapters": eng.CHAPTERS, "stages": out, "guest_max": GUEST_MAX_STAGE,
                    "skins": SKINS, "max_level": eng.MAX_LEVEL,
                    "batteries": eng.BATTERIES, "units": eng.UNIT, "items": ITEMS, "prices": PRICES})


def _unlocked(prog, no):
    return no == 1 or (no - 1) in prog


# ----- 놀이(한 판) 만들기 -----
def _new_play(db, kind, puzzle, **kw):
    # 오래된 판은 지운다 (이틀 지난 것)
    db.execute("DELETE FROM vc_play WHERE started < ? AND status != 'done'", (time.time() - 2 * 86400,))
    token = secrets.token_urlsafe(18)
    now = time.time()
    db.execute(
        "INSERT INTO vc_play (token, user_id, kind, stage_no, day, puzzle, started, puzzle_started, deadline, level, seed, idx) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (token, uid(), kind, kw.get("stage_no"), kw.get("day"), json.dumps(puzzle), now, now,
         kw.get("deadline"), kw.get("level", 1), kw.get("seed", 0), kw.get("idx", 0)),
    )
    db.commit()
    return token


def _get_play(db, token):
    p = db.execute("SELECT * FROM vc_play WHERE token = ?", (token or "",)).fetchone()
    if not p or p["user_id"] != uid():
        return None
    return p


@app.post("/api/play/stage")
def play_stage():
    no = (request.get_json(silent=True) or {}).get("no")
    st = eng.STAGE_BY_NO.get(no) if isinstance(no, int) else None
    if not st:
        return {"error": "없는 스테이지예요."}, 404
    db = get_db()
    if uid():
        prog = {r["stage"]: 1 for r in db.execute("SELECT stage FROM vc_progress WHERE user_id = ?", (uid(),))}
        if not _unlocked(prog, no):
            return {"error": "앞 스테이지를 먼저 깨 주세요."}, 403
    elif no > GUEST_MAX_STAGE:
        return {"error": f"{GUEST_MAX_STAGE}스테이지부터는 로그인해야 해요.", "login": True}, 401
    token = _new_play(db, "stage", st, stage_no=no)
    return {"token": token, "puzzle": eng.public(st)}


def _daily_seed(day):
    return int(day.strftime("%Y%m%d")) * 7919


@app.post("/api/play/daily")
@login_required
def play_daily():
    day = kst_today()
    puzzle = eng.generate(_daily_seed(day), 8)
    puzzle["title"] = f"{day.month}월 {day.day}일의 퍼즐"
    db = get_db()
    token = _new_play(db, "daily", puzzle, day=day.isoformat())
    best = db.execute("SELECT used, secs, stars FROM vc_daily WHERE user_id = ? AND day = ?", (uid(), day.isoformat())).fetchone()
    return {"token": token, "puzzle": eng.public(puzzle), "best": dict(best) if best else None}


# ----- 타임어택 -----
def _rush_puzzle(seed, idx, level):
    p = eng.generate(seed * 1000 + idx, level)
    p["title"] = f"{idx + 1}번째 회로"
    return p


@app.post("/api/rush/start")
@login_required
def rush_start():
    db = get_db()
    seed = secrets.randbelow(10**9)
    puzzle = _rush_puzzle(seed, 0, RUSH_START_LEVEL)
    token = _new_play(db, "rush", puzzle, deadline=time.time() + RUSH_START, level=RUSH_START_LEVEL, seed=seed, idx=0)
    return {"token": token, "puzzle": eng.public(puzzle), **_rush_state(_get_play(db, token))}


def _rush_state(p):
    return {"left": round(max(0.0, p["deadline"] - time.time()), 2), "max": RUSH_MAX,
            "score": p["score"], "solved": p["solved"], "level": p["level"]}


def _rush_finish(db, p):
    """시간이 다 되면 기록을 남기고 코인을 준다 (한 번만)."""
    cur = db.execute("UPDATE vc_play SET status = 'over' WHERE id = ? AND status = 'open'", (p["id"],))
    if cur.rowcount == 0:
        db.commit()
        return None
    coins = p["score"] // 20
    db.execute("INSERT INTO vc_rush (user_id, score, solved) VALUES (?, ?, ?)", (p["user_id"], p["score"], p["solved"]))
    wallet(db, p["user_id"])
    db.execute("UPDATE vc_wallet SET coins = coins + ? WHERE user_id = ?", (coins, p["user_id"]))
    db.commit()
    best = db.execute("SELECT MAX(score) FROM vc_rush WHERE user_id = ?", (p["user_id"],)).fetchone()[0]
    day_add(db, p["user_id"], "rush_play", 1)
    day_max(db, p["user_id"], "rush_score", p["score"])
    xp = add_xp(db, p["user_id"], p["score"] // 40)
    new = check_achievements(db, p["user_id"])
    return {"score": p["score"], "solved": p["solved"], "coins": coins, "best": best,
            "new_best": best == p["score"] and p["score"] > 0, "achievements": new, "xp": xp}


@app.post("/api/play/<token>/finish")
@login_required
def rush_end(token):
    db = get_db()
    p = _get_play(db, token)
    if not p or p["kind"] != "rush":
        return {"error": "판을 찾을 수 없어요."}, 404
    if p["status"] == "open" and time.time() < p["deadline"] - GRACE:
        # 아직 시간이 남았는데 그만두기를 누른 경우: 남은 시간 없이 끝낸다
        db.execute("UPDATE vc_play SET deadline = ? WHERE id = ?", (time.time(), p["id"]))
    res = _rush_finish(db, _get_play(db, token))
    if res is None:
        return {"error": "이미 끝난 판이에요."}, 409
    return {"over": True, "result": res}


@app.post("/api/play/<token>/skip")
@login_required
def rush_skip(token):
    db = get_db()
    p = _get_play(db, token)
    if p and p["kind"] == "practice" and p["status"] == "open":
        idx = p["idx"] + 1
        puzzle = _practice_puzzle(p["seed"], idx, p["level"])
        db.execute("UPDATE vc_play SET idx = ?, puzzle = ?, unblocked = '[]', puzzle_started = ? WHERE id = ?",
                   (idx, json.dumps(puzzle), time.time(), p["id"]))
        db.commit()
        return {"puzzle": eng.public(puzzle), "solved": p["solved"], "level": p["level"]}
    if not p or p["kind"] != "rush" or p["status"] != "open":
        return {"error": "판을 찾을 수 없어요."}, 404
    if time.time() > p["deadline"] + GRACE:
        return {"over": True, "result": _rush_finish(db, p)}
    idx = p["idx"] + 1
    puzzle = _rush_puzzle(p["seed"], idx, p["level"])
    db.execute(
        "UPDATE vc_play SET idx = ?, puzzle = ?, unblocked = '[]', puzzle_started = ?, deadline = deadline - ? WHERE id = ?",
        (idx, json.dumps(puzzle), time.time(), RUSH_SKIP_COST, p["id"]),
    )
    db.commit()
    p = _get_play(db, token)
    if time.time() > p["deadline"]:
        return {"over": True, "result": _rush_finish(db, p)}
    return {"puzzle": eng.public(puzzle), **_rush_state(p)}


# ----- 정답 내기 -----
def _save_stage(db, user_id, no, used):
    """스테이지 기록 저장. 새로 얻은 별만큼 코인을 준다."""
    st = eng.STAGE_BY_NO[no]
    stars = eng.stars_for(st, used)
    old = db.execute("SELECT stars, best FROM vc_progress WHERE user_id = ? AND stage = ?", (user_id, no)).fetchone()
    gained = stars - (old["stars"] if old else 0)
    coins = max(0, gained) * 10 + (10 if not old else 0)
    if old:
        db.execute("UPDATE vc_progress SET stars = MAX(stars, ?), best = MIN(best, ?) WHERE user_id = ? AND stage = ?",
                   (stars, used, user_id, no))
    else:
        db.execute("INSERT INTO vc_progress (user_id, stage, stars, best) VALUES (?, ?, ?, ?)", (user_id, no, stars, used))
    wallet(db, user_id)
    if coins:
        db.execute("UPDATE vc_wallet SET coins = coins + ? WHERE user_id = ?", (coins, user_id))
    return {"stars": stars, "coins": coins, "first": not old, "best": min(used, old["best"]) if old else used}


@app.post("/api/play/<token>/submit")
def submit(token):
    db = get_db()
    p = _get_play(db, token)
    if not p:
        return {"error": "판을 찾을 수 없어요. 다시 시작해 주세요."}, 404
    if p["status"] != "open":
        return {"error": "이미 끝난 판이에요."}, 409
    puzzle = json.loads(p["puzzle"])
    unblocked = json.loads(p["unblocked"])
    now = time.time()
    if p["kind"] == "rush" and now > p["deadline"] + GRACE:
        return {"over": True, "result": _rush_finish(db, p)}
    try:
        board = eng.parse_board(puzzle, (request.get_json(silent=True) or {}).get("board"), unblocked)
    except eng.BoardError as ex:
        return {"error": str(ex)}, 400
    res = eng.evaluate(puzzle, board)
    if res["status"] != "win":
        return {"win": False, "status": res["status"], "rows": res["rows"]}
    used = res["used"]
    stars = eng.stars_for(puzzle, used)
    secs = int(now - p["puzzle_started"])
    xp = None
    if p["user_id"]:
        bump(db, p["user_id"], solved=1, fast=1 if secs <= 10 else 0)
        xp = on_win(db, p["user_id"], p["kind"], stars, secs)

    if p["kind"] == "stage":
        db.execute("UPDATE vc_play SET status = 'done', score = ? WHERE id = ?", (used, p["id"]))
        out = {"win": True, "used": used, "min": puzzle["min"], "stars": stars, "secs": secs}
        if p["user_id"]:
            out.update(_save_stage(db, p["user_id"], p["stage_no"], used))
            out["achievements"] = check_achievements(db, p["user_id"])
            out["wallet"] = wallet(db, p["user_id"])
            out["xp"] = xp
        else:
            out["guest_proof"] = token   # 가입하면 이 기록을 옮겨 준다
        out["next"] = p["stage_no"] + 1 if p["stage_no"] + 1 in eng.STAGE_BY_NO else None
        db.commit()
        return out

    if p["kind"] == "daily":
        db.execute("UPDATE vc_play SET status = 'done', score = ? WHERE id = ?", (used, p["id"]))
        old = db.execute("SELECT used, secs FROM vc_daily WHERE user_id = ? AND day = ?", (p["user_id"], p["day"])).fetchone()
        coins = 0
        if not old:
            coins = 30 + stars * 10
            db.execute("INSERT INTO vc_daily (user_id, day, used, secs, stars) VALUES (?, ?, ?, ?, ?)",
                       (p["user_id"], p["day"], used, secs, stars))
            db.execute("UPDATE vc_wallet SET coins = coins + ? WHERE user_id = ?", (coins, p["user_id"]))
            bump(db, p["user_id"], daily_days=1)
        elif (used, secs) < (old["used"], old["secs"]):
            db.execute("UPDATE vc_daily SET used = ?, secs = ?, stars = MAX(stars, ?) WHERE user_id = ? AND day = ?",
                       (used, secs, stars, p["user_id"], p["day"]))
        db.commit()
        rank = _daily_rank(db, p["day"], p["user_id"])
        new = check_achievements(db, p["user_id"])
        return {"win": True, "used": used, "min": puzzle["min"], "stars": stars, "secs": secs,
                "coins": coins, "rank": rank, "wallet": wallet(db, p["user_id"]), "achievements": new, "xp": xp}

    if p["kind"] == "practice":
        # 연습: 기록은 통계만, 같은 레벨 다음 문제를 바로 낸다
        level = p["level"]
        db.execute("UPDATE vc_stats SET practice = practice + 1, practice_best = MAX(practice_best, ?) WHERE user_id = ?",
                   (level, p["user_id"]))
        idx = p["idx"] + 1
        nxt = _practice_puzzle(p["seed"], idx, level)
        db.execute("UPDATE vc_play SET solved = solved + 1, idx = ?, puzzle = ?, unblocked = '[]', puzzle_started = ? "
                   "WHERE id = ?", (idx, json.dumps(nxt), now, p["id"]))
        db.commit()
        new = check_achievements(db, p["user_id"])
        return {"win": True, "used": used, "min": puzzle["min"], "stars": stars, "secs": secs,
                "solved": p["solved"] + 1, "level": level, "puzzle": eng.public(nxt),
                "achievements": new, "wallet": wallet(db, p["user_id"]), "xp": xp}

    if p["kind"] == "custom":
        db.execute("UPDATE vc_play SET status = 'done', score = ? WHERE id = ?", (used, p["id"]))
        c = db.execute("SELECT id, user_id, title FROM vc_custom WHERE id = ?", (p["stage_no"],)).fetchone()
        first = False
        if c and c["user_id"] != p["user_id"]:
            old = db.execute("SELECT used FROM vc_custom_clear WHERE user_id = ? AND custom_id = ?", (p["user_id"], c["id"])).fetchone()
            if not old:
                first = True
                db.execute("INSERT INTO vc_custom_clear (user_id, custom_id, used) VALUES (?, ?, ?)", (p["user_id"], c["id"], used))
                db.execute("UPDATE vc_custom SET clears = clears + 1 WHERE id = ?", (c["id"],))
                bump(db, p["user_id"], custom_wins=1)
            elif used < old["used"]:
                db.execute("UPDATE vc_custom_clear SET used = ? WHERE user_id = ? AND custom_id = ?", (used, p["user_id"], c["id"]))
        db.commit()
        new = check_achievements(db, p["user_id"])
        return {"win": True, "used": used, "min": puzzle["min"], "stars": stars, "secs": secs, "first": first,
                "achievements": new, "wallet": wallet(db, p["user_id"]), "xp": xp, "custom_id": p["stage_no"]}

    # 타임어택: 점수 더하고 전력 채우고 다음 문제
    level = p["level"]
    points = 100 + level * 20
    bonus = 60 if used <= puzzle["min"] else (25 if used <= puzzle["min"] + 2 else 0)
    speed = max(0, 40 - secs * 2)
    gain = points + bonus + speed
    solved = p["solved"] + 1
    new_level = rush_next_level(solved)
    refill = rush_refill(level)
    idx = p["idx"] + 1
    nxt = _rush_puzzle(p["seed"], idx, new_level)
    deadline = min(now + RUSH_MAX, p["deadline"] + refill)
    db.execute(
        "UPDATE vc_play SET score = score + ?, solved = ?, level = ?, idx = ?, puzzle = ?, unblocked = '[]', "
        "puzzle_started = ?, deadline = ? WHERE id = ? AND status = 'open'",
        (gain, solved, new_level, idx, json.dumps(nxt), now, deadline, p["id"]),
    )
    db.commit()
    p = _get_play(db, token)
    return {"win": True, "used": used, "min": puzzle["min"], "stars": stars,
            "gain": gain, "parts": {"base": points, "efficiency": bonus, "speed": speed},
            "refill": refill, "level_up": new_level > level,
            "puzzle": eng.public(nxt), **_rush_state(p)}


# ----- 아이템 -----
@app.post("/api/play/<token>/item")
@login_required
def use_item(token):
    data = request.get_json(silent=True) or {}
    item = data.get("item")
    if item not in ITEMS:
        return {"error": "없는 아이템이에요."}, 400
    db = get_db()
    p = _get_play(db, token)
    if not p or p["status"] != "open":
        return {"error": "판을 찾을 수 없어요."}, 404
    if p["kind"] == "rush" and time.time() > p["deadline"] + GRACE:
        return {"over": True, "result": _rush_finish(db, p)}
    if wallet(db, uid())[item] <= 0:
        return {"error": f"{ITEMS[item]['name']}이(가) 없어요. 상점에서 살 수 있어요.", "shop": True}, 400
    puzzle = json.loads(p["puzzle"])
    unblocked = json.loads(p["unblocked"])
    out = {}

    if item == "meter":
        try:
            board = eng.parse_board(puzzle, data.get("board"), unblocked)
        except eng.BoardError as ex:
            return {"error": str(ex)}, 400
        h = eng.hint(puzzle, board, unblocked)
        if h["action"] in ("done", "none"):
            return {"error": "지금은 알려 줄 게 없어요."}, 400
        out["hint"] = h
    elif item == "breaker":
        r, s = data.get("row"), data.get("slot")
        if [r, s] not in puzzle["blocked"] or [r, s] in unblocked:
            return {"error": "누전된 칸을 골라 주세요."}, 400
        unblocked.append([r, s])
        db.execute("UPDATE vc_play SET unblocked = ? WHERE id = ?", (json.dumps(unblocked), p["id"]))
        out["unblocked"] = unblocked
    elif item == "charger":
        if p["kind"] != "rush":
            return {"error": "충전기는 타임어택에서만 써요."}, 400
        deadline = min(time.time() + RUSH_MAX, p["deadline"] + CHARGER_SEC)
        db.execute("UPDATE vc_play SET deadline = ? WHERE id = ?", (deadline, p["id"]))

    db.execute(f"UPDATE vc_wallet SET {item} = {item} - 1 WHERE user_id = ?", (uid(),))  # item은 위에서 정해진 이름만
    bump(db, uid(), items=1)
    day_add(db, uid(), "item_use", 1)
    db.commit()
    out["wallet"] = wallet(db, uid())
    if p["kind"] == "rush":
        out.update(_rush_state(_get_play(db, token)))
    return out



# ----- 연습 모드 (시간 제한 없이 레벨을 골라 계속 풀기) -----
def _practice_puzzle(seed, idx, level):
    p = eng.generate(seed * 1000 + idx + 7, level)
    p["title"] = f"연습 레벨 {level} · {idx + 1}번째"
    return p


@app.post("/api/play/practice")
@login_required
def play_practice():
    level = (request.get_json(silent=True) or {}).get("level")
    if not isinstance(level, int) or not (1 <= level <= eng.MAX_LEVEL):
        return {"error": f"레벨은 1~{eng.MAX_LEVEL} 중에서 골라 주세요."}, 400
    db = get_db()
    seed = secrets.randbelow(10**9)
    puzzle = _practice_puzzle(seed, 0, level)
    token = _new_play(db, "practice", puzzle, level=level, seed=seed, idx=0)
    return {"token": token, "puzzle": eng.public(puzzle), "level": level, "solved": 0}


# ----- 통계 · 업적 -----
def stats(db, user_id):
    row = db.execute("SELECT * FROM vc_stats WHERE user_id = ?", (user_id,)).fetchone()
    if not row:
        db.execute("INSERT INTO vc_stats (user_id) VALUES (?)", (user_id,))
        db.commit()
        row = db.execute("SELECT * FROM vc_stats WHERE user_id = ?", (user_id,)).fetchone()
    return dict(row)


STAT_COLS = {"solved", "practice", "items", "fast", "daily_days", "published", "custom_wins"}


def bump(db, user_id, **kw):
    stats(db, user_id)
    for k, v in kw.items():
        if k in STAT_COLS and v:
            db.execute(f"UPDATE vc_stats SET {k} = {k} + ? WHERE user_id = ?", (v, user_id))  # k는 정해진 이름만


# (아이디, 이름, 설명, 보상 코인, 진행 계산 함수 → (지금, 목표))
def _progress(db, user_id):
    st = stats(db, user_id)
    prog = {r["stage"]: r for r in db.execute("SELECT stage, stars FROM vc_progress WHERE user_id = ?", (user_id,))}
    stars = sum(r["stars"] for r in prog.values())
    rush = db.execute("SELECT COALESCE(MAX(score), 0), COALESCE(MAX(solved), 0), COUNT(*) FROM vc_rush WHERE user_id = ?",
                      (user_id,)).fetchone()
    perfect = sum(1 for r in prog.values() if r["stars"] == 3)
    chap_done = lambda ch: all(s["no"] in prog for s in eng.STAGES if s["chapter"] == ch)
    return {"st": st, "prog": prog, "stars": stars, "rush_best": rush[0], "rush_solved": rush[1],
            "rush_plays": rush[2], "perfect": perfect, "chap": chap_done, "level": level_of(st["xp"])[0]}


ACHIEVEMENTS = [
    ("first", "첫 불빛", "스테이지를 처음 깨요", 20, lambda d: (min(1, len(d["prog"])), 1)),
    ("ch1", "직렬 박사", "1장을 모두 깨요", 30, lambda d: (int(d["chap"](1)), 1)),
    ("ch3", "병렬 박사", "3장을 모두 깨요", 40, lambda d: (int(d["chap"](3)), 1)),
    ("ch6", "회로 마스터", "6장까지 모두 깨요", 80, lambda d: (sum(int(d["chap"](c)) for c in range(1, 7)), 6)),
    ("ch9", "그랜드 마스터", "36단계를 모두 깨요", 200, lambda d: (len(d["prog"]), len(eng.STAGES))),
    ("perfect10", "알뜰한 기술자", "별 3개로 10단계 깨기", 50, lambda d: (min(10, d["perfect"]), 10)),
    ("stars50", "별 수집가", "별 50개 모으기", 60, lambda d: (min(50, d["stars"]), 50)),
    ("stars108", "별을 다 모았어", "별 108개 모두 모으기", 300, lambda d: (d["stars"], len(eng.STAGES) * 3)),
    ("rush1000", "번개 손", "타임어택 1,000점", 40, lambda d: (min(1000, d["rush_best"]), 1000)),
    ("rush3000", "전기 폭풍", "타임어택 3,000점", 100, lambda d: (min(3000, d["rush_best"]), 3000)),
    ("rush10", "끝없는 전류", "타임어택 한 판에 10문제", 80, lambda d: (min(10, d["rush_solved"]), 10)),
    ("rush5plays", "다시 한 번!", "타임어택 5번 하기", 30, lambda d: (min(5, d["rush_plays"]), 5)),
    ("daily1", "오늘도 출석", "오늘의 퍼즐 처음 풀기", 20, lambda d: (min(1, d["st"]["daily_days"]), 1)),
    ("daily7", "꾸준한 전기공", "오늘의 퍼즐 7일 풀기", 100, lambda d: (min(7, d["st"]["daily_days"]), 7)),
    ("practice20", "연습 벌레", "연습에서 20문제 풀기", 40, lambda d: (min(20, d["st"]["practice"]), 20)),
    ("practice12", "최고 레벨 도전", "연습 레벨 12 문제 풀기", 80, lambda d: (int(d["st"]["practice_best"] >= 12), 1)),
    ("fast10", "눈 깜짝할 새", "10초 안에 10문제 풀기", 50, lambda d: (min(10, d["st"]["fast"]), 10)),
    ("items10", "도구 달인", "아이템 10번 쓰기", 30, lambda d: (min(10, d["st"]["items"]), 10)),
    ("solved100", "백 개의 회로", "어느 모드든 100문제 풀기", 120, lambda d: (min(100, d["st"]["solved"]), 100)),
    ("maker1", "퍼즐 제작자", "퍼즐 공방에 퍼즐 올리기", 40, lambda d: (min(1, d["st"]["published"]), 1)),
    ("custom10", "공방 탐험가", "남이 만든 퍼즐 10개 풀기", 60, lambda d: (min(10, d["st"]["custom_wins"]), 10)),
    ("streak7", "개근상", "7일 연속 출석", 100, lambda d: (min(7, d["st"]["best_streak"]), 7)),
    ("mission10", "미션 해결사", "오늘의 미션 10개 끝내기", 80, lambda d: (min(10, d["st"]["missions_done"]), 10)),
    ("level10", "번개 박사", "레벨 10 되기", 150, lambda d: (min(10, d["level"]), 10)),
]


def check_achievements(db, user_id):
    """새로 달성한 업적을 저장하고 보상을 준다. 새로 얻은 것 목록을 돌려준다."""
    d = _progress(db, user_id)
    have = {r["ach"] for r in db.execute("SELECT ach FROM vc_ach WHERE user_id = ?", (user_id,))}
    new = []
    for aid, name, desc, reward, fn in ACHIEVEMENTS:
        cur, goal = fn(d)
        if aid not in have and cur >= goal:
            db.execute("INSERT OR IGNORE INTO vc_ach (user_id, ach) VALUES (?, ?)", (user_id, aid))
            wallet(db, user_id)
            db.execute("UPDATE vc_wallet SET coins = coins + ? WHERE user_id = ?", (reward, user_id))
            new.append({"id": aid, "name": name, "reward": reward})
    db.commit()
    return new


@app.get("/api/achievements")
@login_required
def achievements():
    db = get_db()
    check_achievements(db, uid())
    d = _progress(db, uid())
    got = {r["ach"]: r["got_at"] for r in db.execute("SELECT ach, got_at FROM vc_ach WHERE user_id = ?", (uid(),))}
    items = []
    for aid, name, desc, reward, fn in ACHIEVEMENTS:
        cur, goal = fn(d)
        items.append({"id": aid, "name": name, "desc": desc, "reward": reward,
                      "cur": min(cur, goal), "goal": goal, "done": aid in got})
    st = d["st"]
    return jsonify({"items": items, "stats": {
        "solved": st["solved"], "practice": st["practice"], "practice_best": st["practice_best"],
        "items": st["items"], "fast": st["fast"], "daily_days": st["daily_days"],
        "stars": d["stars"], "cleared": len(d["prog"]), "rush_best": d["rush_best"], "rush_plays": d["rush_plays"],
    }})


# ----- 꾸미기 (건전지 모양) -----
SKINS = {
    "basic": {"name": "기본", "price": 0, "desc": "깔끔한 기본 건전지"},
    "neon": {"name": "네온", "price": 120, "desc": "어둠 속에서 빛나는 테두리"},
    "candy": {"name": "사탕", "price": 150, "desc": "줄무늬 사탕 색"},
    "metal": {"name": "메탈", "price": 180, "desc": "반짝이는 금속"},
    "retro": {"name": "레트로", "price": 220, "desc": "옛날 게임기 같은 네모 픽셀"},
}


@app.post("/api/skin")
@login_required
def skin():
    data = request.get_json(silent=True) or {}
    sk, action = data.get("skin"), data.get("action")
    if sk not in SKINS or action not in ("buy", "use"):
        return {"error": "없는 꾸미기예요."}, 400
    db = get_db()
    owned = sk == "basic" or db.execute("SELECT 1 FROM vc_skin WHERE user_id = ? AND skin = ?", (uid(), sk)).fetchone()
    if action == "buy":
        if owned:
            return {"error": "이미 가지고 있어요."}, 400
        price = SKINS[sk]["price"]
        w = wallet(db, uid())
        if w["coins"] < price:
            return {"error": f"코인이 {price - w['coins']}개 모자라요."}, 400
        db.execute("UPDATE vc_wallet SET coins = coins - ? WHERE user_id = ?", (price, uid()))
        db.execute("INSERT INTO vc_skin (user_id, skin) VALUES (?, ?)", (uid(), sk))
    elif not owned:
        return {"error": "먼저 사야 해요."}, 400
    stats(db, uid())
    db.execute("UPDATE vc_stats SET skin = ? WHERE user_id = ?", (sk, uid()))
    db.commit()
    skins = ["basic"] + [r["skin"] for r in db.execute("SELECT skin FROM vc_skin WHERE user_id = ?", (uid(),))]
    return {"skin": sk, "skins": skins, "wallet": wallet(db, uid())}


# ===== 레벨 · 경험치 =====
TITLES = [(1, "견습 전기공"), (3, "전기공"), (5, "회로 기술자"), (8, "전력 엔지니어"), (12, "번개 박사"), (16, "볼트 마스터")]


def level_of(xp):
    """레벨 L이 되려면 경험치 50×L×(L−1). 돌려주는 값: (레벨, 이번 레벨 시작 xp, 다음 레벨 xp)"""
    lv = 1
    while 50 * (lv + 1) * lv <= xp:
        lv += 1
    return lv, 50 * lv * (lv - 1), 50 * (lv + 1) * lv


def title_of(lv):
    t = TITLES[0][1]
    for need, name in TITLES:
        if lv >= need:
            t = name
    return t


def profile(db, user_id):
    xp = stats(db, user_id)["xp"]
    lv, base, nxt = level_of(xp)
    return {"xp": xp, "level": lv, "title": title_of(lv), "base": base, "next": nxt}


def add_xp(db, user_id, n):
    if n <= 0:
        return None
    before = level_of(stats(db, user_id)["xp"])[0]
    db.execute("UPDATE vc_stats SET xp = xp + ? WHERE user_id = ?", (n, user_id))
    db.commit()
    pr = profile(db, user_id)
    pr.update(gained=n, level_up=pr["level"] > before)
    return pr


# ===== 하루 단위 진행 (미션용) =====
def _today():
    return kst_today().isoformat()


def day_add(db, user_id, key, n):
    db.execute("INSERT INTO vc_counter (user_id, day, key, n) VALUES (?, ?, ?, ?) "
               "ON CONFLICT(user_id, day, key) DO UPDATE SET n = n + excluded.n", (user_id, _today(), key, n))


def day_max(db, user_id, key, n):
    db.execute("INSERT INTO vc_counter (user_id, day, key, n) VALUES (?, ?, ?, ?) "
               "ON CONFLICT(user_id, day, key) DO UPDATE SET n = MAX(n, excluded.n)", (user_id, _today(), key, n))


def on_win(db, user_id, kind, stars, secs):
    """퍼즐을 하나 풀 때마다: 미션 진행 + 경험치 (타임어택 경험치는 끝날 때 한꺼번에)."""
    keys = {"stage": "win_stage", "daily": "daily_win", "practice": "practice_win", "custom": "custom_win"}
    if kind in keys:
        day_add(db, user_id, keys[kind], 1)
    if stars == 3:
        day_add(db, user_id, "three_star", 1)
    if secs <= 15:
        day_add(db, user_id, "fast_win", 1)
    db.commit()
    if kind == "rush":
        return None
    return add_xp(db, user_id, 10 + stars * 5)


# ===== 오늘의 미션 (날마다 3개, 모두에게 같음) =====
MISSION_POOL = {
    "win_stage": ("스테이지 2번 깨기 (다시 깨도 돼요)", 2, "stages"),
    "rush_play": ("타임어택 1판 하기", 1, "rush"),
    "rush_score": ("타임어택 한 판에 800점", 800, "rush"),
    "daily_win": ("오늘의 퍼즐 풀기", 1, "daily"),
    "practice_win": ("연습 문제 5개 풀기", 5, "practice"),
    "custom_win": ("퍼즐 공방 퍼즐 2개 풀기", 2, "workshop"),
    "item_use": ("아이템 2번 쓰기", 2, "stages"),
    "three_star": ("별 3개로 3번 풀기", 3, "practice"),
    "fast_win": ("15초 안에 2번 풀기", 2, "practice"),
}
MISSION_REWARD = {"coins": 30, "xp": 40}
ALL_BONUS = {"coins": 60, "meter": 1, "xp": 50}


def todays_missions(day):
    """그날의 미션 3개: 타임어택·오늘의 퍼즐 중 하나는 꼭 들어간다 (스테이지만 하지 않게)."""
    import random as _r
    rng = _r.Random(int(day.replace("-", "")) * 31)
    first = rng.choice(["rush_play", "rush_score", "daily_win"])
    rest = rng.sample([k for k in MISSION_POOL if k not in ("rush_play", "rush_score", "daily_win")], 2)
    return [first] + rest


def missions_state(db, user_id):
    day = _today()
    cnt = {r["key"]: r["n"] for r in db.execute("SELECT key, n FROM vc_counter WHERE user_id = ? AND day = ?", (user_id, day))}
    got = {r["mid"] for r in db.execute("SELECT mid FROM vc_claim WHERE user_id = ? AND day = ?", (user_id, day))}
    items = []
    for mid in todays_missions(day):
        name, goal, go = MISSION_POOL[mid]
        items.append({"id": mid, "name": name, "goal": goal, "cur": min(goal, cnt.get(mid, 0)),
                      "claimed": mid in got, "go": go})
    return {"day": day, "items": items, "reward": MISSION_REWARD, "bonus": ALL_BONUS,
            "bonus_ready": all(i["claimed"] for i in items) and "all" not in got, "bonus_claimed": "all" in got}


@app.post("/api/missions/claim")
@login_required
def claim_mission():
    mid = (request.get_json(silent=True) or {}).get("id")
    db = get_db()
    state = missions_state(db, uid())
    day = state["day"]
    if mid == "all":
        if not state["bonus_ready"]:
            return {"error": "미션 3개를 모두 끝내고 받아요."}, 400
        db.execute("INSERT INTO vc_claim (user_id, day, mid) VALUES (?, ?, 'all')", (uid(), day))
        wallet(db, uid())
        db.execute("UPDATE vc_wallet SET coins = coins + ?, meter = meter + ? WHERE user_id = ?",
                   (ALL_BONUS["coins"], ALL_BONUS["meter"], uid()))
        db.commit()
        xp = add_xp(db, uid(), ALL_BONUS["xp"])
    else:
        it = next((i for i in state["items"] if i["id"] == mid), None)
        if not it:
            return {"error": "오늘의 미션이 아니에요."}, 400
        if it["claimed"]:
            return {"error": "이미 받았어요."}, 400
        if it["cur"] < it["goal"]:
            return {"error": "아직 다 못 했어요."}, 400
        db.execute("INSERT INTO vc_claim (user_id, day, mid) VALUES (?, ?, ?)", (uid(), day, mid))
        wallet(db, uid())
        db.execute("UPDATE vc_wallet SET coins = coins + ? WHERE user_id = ?", (MISSION_REWARD["coins"], uid()))
        stats(db, uid())
        db.execute("UPDATE vc_stats SET missions_done = missions_done + 1 WHERE user_id = ?", (uid(),))
        db.commit()
        xp = add_xp(db, uid(), MISSION_REWARD["xp"])
    return {"missions": missions_state(db, uid()), "wallet": wallet(db, uid()), "xp": xp,
            "achievements": check_achievements(db, uid())}


# ===== 출석 보상 (7일 주기, 하루라도 빠지면 1일부터) =====
CHECKIN_REWARDS = [{"coins": 20}, {"coins": 30}, {"meter": 1}, {"coins": 40},
                   {"breaker": 1}, {"coins": 50}, {"coins": 100, "charger": 2}]


def checkin_state(db, user_id):
    st = stats(db, user_id)
    today = kst_today()
    done = st["last_checkin"] == today.isoformat()
    alive = st["last_checkin"] in (today.isoformat(), (today - timedelta(days=1)).isoformat())
    streak = st["streak"] if alive else 0
    nxt = streak if done else streak + 1      # 오늘 받으면 몇 일째인지
    return {"done": done, "streak": streak, "day": ((nxt - 1) % 7) + 1, "rewards": CHECKIN_REWARDS}


@app.post("/api/checkin")
@login_required
def checkin():
    db = get_db()
    state = checkin_state(db, uid())
    if state["done"]:
        return {"error": "오늘은 이미 받았어요. 내일 또 와요!"}, 400
    streak = state["streak"] + 1
    reward = CHECKIN_REWARDS[(streak - 1) % 7]
    wallet(db, uid())
    for k, v in reward.items():   # k는 정해 둔 이름(coins/meter/breaker/charger)만
        db.execute(f"UPDATE vc_wallet SET {k} = {k} + ? WHERE user_id = ?", (v, uid()))
    db.execute("UPDATE vc_stats SET streak = ?, best_streak = MAX(best_streak, ?), last_checkin = ? WHERE user_id = ?",
               (streak, streak, kst_today().isoformat(), uid()))
    db.commit()
    xp = add_xp(db, uid(), 20)
    return {"reward": reward, "streak": streak, "checkin": checkin_state(db, uid()), "wallet": wallet(db, uid()),
            "xp": xp, "achievements": check_achievements(db, uid())}


# ===== 퍼즐 공방: 직접 만들고 남의 퍼즐 풀기 =====
CUSTOM_PER_DAY = 10
CUSTOM_PER_USER = 50


def build_custom(data):
    """화면에서 보낸 설계도를 검사해서 퍼즐로 만든다. 문제가 있으면 BoardError."""
    rows = data.get("rows")
    if not isinstance(rows, list) or not (1 <= len(rows) <= 4) or not all(isinstance(c, int) and 2 <= c <= 4 for c in rows):
        raise eng.BoardError("줄은 1~4개, 줄마다 칸은 2~4개예요.")
    target = data.get("target")
    if not isinstance(target, int) or not (1 <= target <= 72):
        raise eng.BoardError("목표 전압은 0.5V~36V예요.")
    need = data.get("need", 1)
    if not isinstance(need, int) or not (1 <= need <= len(rows)):
        raise eng.BoardError("필요한 줄 수가 이상해요.")
    tray_in = data.get("tray") or {}
    if not isinstance(tray_in, dict):
        raise eng.BoardError("건전지 정보가 이상해요.")
    tray = {}
    for t, n in tray_in.items():
        if t not in eng.UNIT or not isinstance(n, int) or not (0 <= n <= 9):
            raise eng.BoardError("건전지는 종류마다 0~9개예요.")
        if n:
            tray[t] = n
    if not (1 <= sum(tray.values()) <= 20):
        raise eng.BoardError("건전지는 모두 합쳐 1~20개예요.")
    blocked, diode, seen = [], [], set()
    for c in data.get("cells") or []:
        if not (isinstance(c, list) and len(c) == 3):
            raise eng.BoardError("칸 정보가 이상해요.")
        r, s, kind = c
        if not (isinstance(r, int) and isinstance(s, int) and 0 <= r < len(rows) and 0 <= s < rows[r]) or (r, s) in seen:
            raise eng.BoardError("칸 위치가 이상해요.")
        seen.add((r, s))
        if kind == "blocked":
            blocked.append([r, s])
        elif kind in ("plus", "minus"):
            diode.append([r, s, 1 if kind == "plus" else -1])
        else:
            raise eng.BoardError("칸 종류가 이상해요.")
    for r, cap in enumerate(rows):
        if sum(1 for b in blocked if b[0] == r) >= cap:
            raise eng.BoardError(f"{r + 1}줄에 놓을 칸이 하나도 없어요.")
    puzzle = {"no": 0, "chapter": 0, "title": "", "target": target, "rows": rows, "need": need,
              "blocked": blocked, "tray": tray, "tip": "", "fixed": [], "diode": diode}
    sol = eng.solve(puzzle)
    if not sol:
        raise eng.BoardError("이 퍼즐은 풀 수 없어요. 건전지나 칸을 바꿔 보세요.")
    if sol[0] < 2:
        raise eng.BoardError("건전지 하나로 풀리면 너무 쉬워요. 조금 더 어렵게 만들어 봐요.")
    puzzle["min"] = sol[0]
    return puzzle


@app.post("/api/workshop/check")
@login_required
def workshop_check():
    try:
        pz = build_custom(request.get_json(silent=True) or {})
    except eng.BoardError as ex:
        return {"ok": False, "error": str(ex)}
    return {"ok": True, "min": pz["min"]}


@app.post("/api/workshop")
@login_required
def workshop_create():
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    if not (1 <= len(title) <= 20):
        return {"error": "퍼즐 이름은 1~20자로 적어주세요."}, 400
    try:
        pz = build_custom(data)
    except eng.BoardError as ex:
        return {"error": str(ex)}, 400
    db = get_db()
    since = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")
    if db.execute("SELECT COUNT(*) FROM vc_custom WHERE user_id = ? AND created_at >= ?", (uid(), since)).fetchone()[0] >= CUSTOM_PER_DAY:
        return {"error": f"하루에 {CUSTOM_PER_DAY}개까지 올릴 수 있어요."}, 400
    if db.execute("SELECT COUNT(*) FROM vc_custom WHERE user_id = ?", (uid(),)).fetchone()[0] >= CUSTOM_PER_USER:
        return {"error": f"퍼즐은 {CUSTOM_PER_USER}개까지 올릴 수 있어요. 예전 것을 지워 주세요."}, 400
    pz["title"] = title
    cur = db.execute("INSERT INTO vc_custom (user_id, title, puzzle, min) VALUES (?, ?, ?, ?)",
                     (uid(), title, json.dumps(pz), pz["min"]))
    bump(db, uid(), published=1)
    db.commit()
    xp = add_xp(db, uid(), 30)
    return {"id": cur.lastrowid, "min": pz["min"], "xp": xp, "achievements": check_achievements(db, uid())}, 201


@app.get("/api/workshop")
def workshop_list():
    sort = request.args.get("sort", "new")
    db = get_db()
    me_id = uid() or 0
    where, order, args = "c.hidden = 0", "c.id DESC", []
    if sort == "popular":
        order = "c.likes DESC, c.clears DESC, c.id DESC"
    elif sort == "mine":
        if not me_id:
            return jsonify({"items": []})
        where, args = "c.user_id = ?", [me_id]
    rows = db.execute(
        "SELECT c.id, c.user_id, c.title, c.puzzle, c.min, c.plays, c.clears, c.likes, c.hidden, u.nickname, "
        "  EXISTS(SELECT 1 FROM vc_custom_like l WHERE l.custom_id = c.id AND l.user_id = ?) AS liked, "
        "  (SELECT used FROM vc_custom_clear k WHERE k.custom_id = c.id AND k.user_id = ?) AS my_used "
        f"FROM vc_custom c JOIN user u ON u.id = c.user_id WHERE {where} ORDER BY {order} LIMIT 60",
        (me_id, me_id, *args)).fetchall()
    items = []
    for r in rows:
        pz = json.loads(r["puzzle"])
        items.append({
            "id": r["id"], "title": r["title"], "author": r["nickname"], "mine": r["user_id"] == me_id,
            "target": pz["target"], "rows": len(pz["rows"]), "need": pz["need"], "min": r["min"],
            "gadgets": len(pz["blocked"]) + len(pz["diode"]),
            "plays": r["plays"], "clears": r["clears"], "likes": r["likes"], "liked": bool(r["liked"]),
            "cleared": r["my_used"] is not None, "hidden": bool(r["hidden"]),
        })
    return jsonify({"items": items})


def _custom(db, cid):
    return db.execute("SELECT * FROM vc_custom WHERE id = ?", (cid,)).fetchone()


@app.post("/api/workshop/<int:cid>/like")
@login_required
def workshop_like(cid):
    db = get_db()
    c = _custom(db, cid)
    if not c or c["hidden"]:
        return {"error": "퍼즐을 찾을 수 없어요."}, 404
    if c["user_id"] == uid():
        return {"error": "내 퍼즐에는 좋아요를 누를 수 없어요."}, 400
    if db.execute("SELECT 1 FROM vc_custom_like WHERE user_id = ? AND custom_id = ?", (uid(), cid)).fetchone():
        db.execute("DELETE FROM vc_custom_like WHERE user_id = ? AND custom_id = ?", (uid(), cid))
        db.execute("UPDATE vc_custom SET likes = likes - 1 WHERE id = ?", (cid,))
        liked = False
    else:
        db.execute("INSERT INTO vc_custom_like (user_id, custom_id) VALUES (?, ?)", (uid(), cid))
        db.execute("UPDATE vc_custom SET likes = likes + 1 WHERE id = ?", (cid,))
        liked = True
    db.commit()
    return {"liked": liked, "likes": _custom(db, cid)["likes"]}


@app.post("/api/workshop/<int:cid>/report")
@login_required
def workshop_report(cid):
    """이상한 퍼즐 신고. 3명이 신고하면 목록에서 숨긴다."""
    db = get_db()
    c = _custom(db, cid)
    if not c:
        return {"error": "퍼즐을 찾을 수 없어요."}, 404
    if db.execute("INSERT OR IGNORE INTO vc_custom_report (user_id, custom_id) VALUES (?, ?)", (uid(), cid)).rowcount:
        db.execute("UPDATE vc_custom SET reports = reports + 1, hidden = CASE WHEN reports + 1 >= 3 THEN 1 ELSE hidden END WHERE id = ?", (cid,))
    db.commit()
    return {"ok": True}


@app.delete("/api/workshop/<int:cid>")
@login_required
def workshop_delete(cid):
    db = get_db()
    db.execute("DELETE FROM vc_custom WHERE id = ? AND user_id = ?", (cid, uid()))
    db.commit()
    return "", 204


@app.post("/api/play/custom")
@login_required
def play_custom():
    cid = (request.get_json(silent=True) or {}).get("id")
    db = get_db()
    c = _custom(db, cid) if isinstance(cid, int) else None
    if not c or (c["hidden"] and c["user_id"] != uid()):
        return {"error": "퍼즐을 찾을 수 없어요."}, 404
    pz = json.loads(c["puzzle"])
    if c["user_id"] != uid():
        db.execute("UPDATE vc_custom SET plays = plays + 1 WHERE id = ?", (cid,))
    author = db.execute("SELECT nickname FROM user WHERE id = ?", (c["user_id"],)).fetchone()["nickname"]
    token = _new_play(db, "custom", pz, stage_no=cid)
    return {"token": token, "puzzle": eng.public(pz), "author": author, "mine": c["user_id"] == uid()}


# ----- 상점 -----
@app.post("/api/shop/buy")
@login_required
def buy():
    data = request.get_json(silent=True) or {}
    item, qty = data.get("item"), data.get("qty", 1)
    if item not in PRICES or qty not in (1, 3):
        return {"error": "살 수 없는 물건이에요."}, 400
    price = PRICES[item] * qty - (PRICES[item] // 2 if qty == 3 else 0)   # 3개 묶음은 반 개 값 할인
    db = get_db()
    w = wallet(db, uid())
    if w["coins"] < price:
        return {"error": f"코인이 {price - w['coins']}개 모자라요."}, 400
    db.execute(f"UPDATE vc_wallet SET coins = coins - ?, {item} = {item} + ? WHERE user_id = ?", (price, qty, uid()))
    db.commit()
    return {"wallet": wallet(db, uid()), "price": price}


# ----- 순위 -----
def _daily_rank(db, day, user_id):
    rows = db.execute("SELECT user_id FROM vc_daily WHERE day = ? ORDER BY used, secs", (day,)).fetchall()
    for i, r in enumerate(rows):
        if r["user_id"] == user_id:
            return {"rank": i + 1, "total": len(rows)}
    return None


@app.get("/api/ranking")
def ranking():
    kind = request.args.get("kind", "rush")
    db = get_db()
    if kind == "rush":
        rows = db.execute(
            "SELECT u.id, u.nickname, MAX(r.score) AS score, MAX(r.solved) AS solved FROM vc_rush r "
            "JOIN user u ON u.id = r.user_id GROUP BY u.id ORDER BY score DESC LIMIT 50").fetchall()
        items = [{"uid": r["id"], "name": r["nickname"], "value": r["score"], "sub": f"{r['solved']}문제"} for r in rows]
    elif kind == "week":
        since = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")
        rows = db.execute(
            "SELECT u.id, u.nickname, MAX(r.score) AS score, MAX(r.solved) AS solved FROM vc_rush r "
            "JOIN user u ON u.id = r.user_id WHERE r.created_at >= ? GROUP BY u.id ORDER BY score DESC LIMIT 50",
            (since,)).fetchall()
        items = [{"uid": r["id"], "name": r["nickname"], "value": r["score"], "sub": f"{r['solved']}문제"} for r in rows]
    elif kind == "daily":
        day = kst_today().isoformat()
        rows = db.execute(
            "SELECT u.id, u.nickname, d.used, d.secs FROM vc_daily d JOIN user u ON u.id = d.user_id "
            "WHERE d.day = ? ORDER BY d.used, d.secs LIMIT 50", (day,)).fetchall()
        items = [{"uid": r["id"], "name": r["nickname"], "value": r["used"], "sub": f"{r['secs']}초"} for r in rows]
    elif kind == "level":
        rows = db.execute(
            "SELECT u.id, u.nickname, s.xp FROM vc_stats s JOIN user u ON u.id = s.user_id "
            "WHERE s.xp > 0 ORDER BY s.xp DESC LIMIT 50").fetchall()
        items = [{"uid": r["id"], "name": r["nickname"], "value": level_of(r["xp"])[0],
                  "sub": f"{title_of(level_of(r['xp'])[0])} · {r['xp']} XP"} for r in rows]
    elif kind == "stars":
        rows = db.execute(
            "SELECT u.id, u.nickname, SUM(p.stars) AS stars, COUNT(*) AS cleared FROM vc_progress p "
            "JOIN user u ON u.id = p.user_id GROUP BY u.id ORDER BY stars DESC, cleared DESC LIMIT 50").fetchall()
        items = [{"uid": r["id"], "name": r["nickname"], "value": r["stars"], "sub": f"{r['cleared']}스테이지"} for r in rows]
    else:
        return {"error": "없는 순위예요."}, 400
    rank = 0
    last = None
    for i, it in enumerate(items):
        key = (it["value"], it["sub"]) if kind in ("daily", "level") else it["value"]
        if key != last:
            rank, last = i + 1, key
        it["rank"] = rank
        it["me"] = it.pop("uid") == uid()
    return jsonify({"kind": kind, "items": items})


@app.get("/api/home")
def home():
    """첫 화면에 필요한 것들 한 번에."""
    out = {"today": kst_today().isoformat(), "total_stages": len(eng.STAGES), "max_stars": len(eng.STAGES) * 3}
    if uid():
        db = get_db()
        cleared = db.execute("SELECT COUNT(*), COALESCE(SUM(stars), 0) FROM vc_progress WHERE user_id = ?", (uid(),)).fetchone()
        out["cleared"], out["stars"] = cleared[0], cleared[1]
        done = {r["stage"] for r in db.execute("SELECT stage FROM vc_progress WHERE user_id = ?", (uid(),))}
        out["next_stage"] = next((s["no"] for s in eng.STAGES if s["no"] not in done), None)
        out["rush_best"] = db.execute("SELECT MAX(score) FROM vc_rush WHERE user_id = ?", (uid(),)).fetchone()[0] or 0
        d = db.execute("SELECT used, secs, stars FROM vc_daily WHERE user_id = ? AND day = ?", (uid(), out["today"])).fetchone()
        out["daily"] = dict(d) if d else None
        out["wallet"] = wallet(db, uid())
        out["profile"] = profile(db, uid())
        out["checkin"] = checkin_state(db, uid())
        out["missions"] = missions_state(db, uid())
        out["workshop_count"] = db.execute("SELECT COUNT(*) FROM vc_custom WHERE hidden = 0").fetchone()[0]
    return out
