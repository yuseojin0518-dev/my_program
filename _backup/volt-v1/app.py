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
            CREATE TABLE IF NOT EXISTS vc_daily (
                user_id INTEGER NOT NULL, day TEXT NOT NULL, used INTEGER NOT NULL,
                secs INTEGER NOT NULL, stars INTEGER NOT NULL,
                PRIMARY KEY (user_id, day)
            );
            """
        )


init_db()


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
    return {"id": uid(), "nickname": current_user.nickname, "wallet": wallet(db, uid()), "stars": total}


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
    return {"score": p["score"], "solved": p["solved"], "coins": coins, "best": best,
            "new_best": best == p["score"] and p["score"] > 0}


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

    if p["kind"] == "stage":
        db.execute("UPDATE vc_play SET status = 'done', score = ? WHERE id = ?", (used, p["id"]))
        out = {"win": True, "used": used, "min": puzzle["min"], "stars": stars, "secs": secs}
        if p["user_id"]:
            out.update(_save_stage(db, p["user_id"], p["stage_no"], used))
            out["wallet"] = wallet(db, p["user_id"])
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
        elif (used, secs) < (old["used"], old["secs"]):
            db.execute("UPDATE vc_daily SET used = ?, secs = ?, stars = MAX(stars, ?) WHERE user_id = ? AND day = ?",
                       (used, secs, stars, p["user_id"], p["day"]))
        db.commit()
        rank = _daily_rank(db, p["day"], p["user_id"])
        return {"win": True, "used": used, "min": puzzle["min"], "stars": stars, "secs": secs,
                "coins": coins, "rank": rank, "wallet": wallet(db, p["user_id"])}

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
    db.commit()
    out["wallet"] = wallet(db, uid())
    if p["kind"] == "rush":
        out.update(_rush_state(_get_play(db, token)))
    return out


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
        key = (it["value"], it["sub"]) if kind == "daily" else it["value"]
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
    return out
