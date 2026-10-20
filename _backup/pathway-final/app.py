"""Pathway — 진로 목표에서 오늘 할 공부까지 이어 주는 학업 내비게이션 (서버).

계산(등급·역산·최적 배분·계획표·조합 탐색)은 static/engine.js 가 화면에서 바로 한다.
서버는 아래만 맡는다.
  - 회원·로그인, 내 데이터(한 덩어리 JSON) 저장과 버전 확인
  - 나이스(NEIS) 교육정보 개방 포털: 학교 찾기, 학사일정, 시간표 과목 (캐시 포함)
  - 사용자 검증용 익명 사용 기록과 설문
"""
import json
import os
import re
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import requests
from flask import Flask, g, jsonify, render_template, request
from flask_bcrypt import Bcrypt
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_login import LoginManager, UserMixin, current_user, login_required, login_user, logout_user

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:
    pass

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-change-me")
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024
app.config["REMEMBER_COOKIE_DURATION"] = timedelta(days=60)
bcrypt = Bcrypt(app)
login_manager = LoginManager(app)

DB_PATH = os.environ.get("PW_DB", "app.db")  # 시험할 때만 다른 파일을 쓴다
KST = ZoneInfo("Asia/Seoul")
NEIS_KEY = os.environ.get("NEIS_API_KEY", "").strip()
NEIS_URL = "https://open.neis.go.kr/hub/"
NEIS_OFFLINE = os.environ.get("PW_NEIS_OFFLINE") == "1"  # 시험용: 바깥 요청 안 함
ADMINS = {x.strip() for x in os.environ.get("ADMIN_USERNAMES", "").split(",") if x.strip()}
STATE_MAX = 1_500_000  # 내 데이터 최대 크기(글자)

limiter = Limiter(get_remote_address, app=app, default_limits=[], storage_uri="memory://")
if os.environ.get("PW_TESTING") == "1":
    limiter.enabled = False


@login_manager.unauthorized_handler
def unauthorized():
    return {"error": "로그인이 필요해요."}, 401


@app.errorhandler(429)
def too_many(e):
    return {"error": "요청이 너무 많아요. 잠시 뒤에 다시 해 주세요."}, 429


@app.errorhandler(413)
def too_big(e):
    return {"error": "데이터가 너무 커요."}, 413


# ───────────────────────── DB ─────────────────────────
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


SCHEMA = """
CREATE TABLE IF NOT EXISTS pw_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pw_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pw_states (
  user_id INTEGER PRIMARY KEY REFERENCES pw_users(id),
  data TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pw_neis_cache (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  fetched_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS pw_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  value REAL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pw_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  user_id INTEGER,
  rating INTEGER NOT NULL,
  before_min INTEGER,
  helpful TEXT,
  comment TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pw_metrics_kind ON pw_metrics(kind);
"""


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.executescript(SCHEMA)
    db.commit()
    db.close()


init_db()


def now_kst():
    return datetime.now(KST)


def now_iso():
    return now_kst().isoformat(timespec="seconds")


# ───────────────────────── 회원 ─────────────────────────
class User(UserMixin):
    def __init__(self, row):
        self.id = row["id"]
        self.username = row["username"]
        self.nickname = row["nickname"]


@login_manager.user_loader
def load_user(user_id):
    row = get_db().execute("SELECT * FROM pw_users WHERE id = ?", (user_id,)).fetchone()
    return User(row) if row else None


def need_json():
    """상태를 바꾸는 요청은 JSON으로만 받는다 (다른 사이트의 폼으로 몰래 보내는 것을 막는다)."""
    if not request.is_json:
        return {"error": "JSON으로 보내 주세요."}, 415
    return None


def body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


USERNAME_RE = re.compile(r"^[a-z0-9_]{3,20}$")


def clean_text(s, n):
    s = str(s or "").strip()
    s = re.sub(r"[\x00-\x1f\x7f]", "", s)
    return s[:n]


def validate_state(state):
    if not isinstance(state, dict):
        return "데이터 모양이 이상해요."
    if state.get("v") != 1:
        return "데이터 버전이 맞지 않아요."
    if not isinstance(state.get("terms", []), list) or not isinstance(state.get("log", []), list):
        return "데이터 모양이 이상해요."
    raw = json.dumps(state, ensure_ascii=False)
    if len(raw) > STATE_MAX:
        return "데이터가 너무 커요."
    return None


def me_json():
    if not current_user.is_authenticated:
        return {"user": None}
    return {"user": {"username": current_user.username, "nickname": current_user.nickname, "admin": current_user.username in ADMINS}}


def asset_version():
    """화면 파일이 바뀌면 브라우저가 새로 받도록 붙이는 번호."""
    folder = os.path.join(app.root_path, "static")
    try:
        return str(int(max(os.path.getmtime(os.path.join(folder, f)) for f in os.listdir(folder) if f.endswith((".js", ".css")))))
    except ValueError:
        return "1"


@app.get("/")
def index():
    return render_template("index.html", v=asset_version())


@app.get("/sw.js")
def service_worker():
    """서비스 워커는 사이트 전체(/)를 맡아야 해서 맨 위 주소로 준다."""
    resp = app.send_static_file("sw.js")
    resp.headers["Cache-Control"] = "no-cache"
    resp.headers["Service-Worker-Allowed"] = "/"
    return resp


@app.get("/me")
def me():
    return me_json()


@app.post("/signup")
@limiter.limit("10 per hour")
def signup():
    bad = need_json()
    if bad:
        return bad
    d = body()
    username = clean_text(d.get("username"), 20).lower()
    password = str(d.get("password") or "")
    nickname = clean_text(d.get("nickname"), 12) or username
    if not USERNAME_RE.match(username):
        return {"error": "아이디는 영어 소문자·숫자·_ 로 3~20자예요."}, 400
    if len(password) < 6 or len(password) > 72:
        return {"error": "비밀번호는 6~72자로 해 주세요."}, 400
    db = get_db()
    if db.execute("SELECT 1 FROM pw_users WHERE username = ?", (username,)).fetchone():
        return {"error": "이미 있는 아이디예요."}, 409
    pw_hash = bcrypt.generate_password_hash(password).decode()
    cur = db.execute(
        "INSERT INTO pw_users (username, pw_hash, nickname, created_at) VALUES (?, ?, ?, ?)",
        (username, pw_hash, nickname, now_iso()),
    )
    uid = cur.lastrowid
    # 손님일 때 쓰던 데이터를 옮겨 준다
    state = d.get("state")
    if state is not None and validate_state(state) is None:
        db.execute(
            "INSERT INTO pw_states (user_id, data, version, updated_at) VALUES (?, ?, 1, ?)",
            (uid, json.dumps(state, ensure_ascii=False), now_iso()),
        )
    db.commit()
    row = db.execute("SELECT * FROM pw_users WHERE id = ?", (uid,)).fetchone()
    login_user(User(row), remember=True)
    return me_json()


@app.post("/login")
@limiter.limit("20 per 10 minutes")
def login():
    bad = need_json()
    if bad:
        return bad
    d = body()
    username = clean_text(d.get("username"), 20).lower()
    password = str(d.get("password") or "")
    row = get_db().execute("SELECT * FROM pw_users WHERE username = ?", (username,)).fetchone()
    if not row or not bcrypt.check_password_hash(row["pw_hash"], password):
        return {"error": "아이디나 비밀번호가 맞지 않아요."}, 401
    login_user(User(row), remember=True)
    return me_json()


@app.post("/logout")
def logout():
    logout_user()
    return {"ok": True}


# ───────────────────────── 내 데이터 ─────────────────────────
@app.get("/api/state")
@login_required
def get_state():
    row = get_db().execute("SELECT data, version, updated_at FROM pw_states WHERE user_id = ?", (current_user.id,)).fetchone()
    if not row:
        return {"state": None, "version": 0}
    return {"state": json.loads(row["data"]), "version": row["version"], "updatedAt": row["updated_at"]}


@app.put("/api/state")
@login_required
def put_state():
    bad = need_json()
    if bad:
        return bad
    d = body()
    state = d.get("state")
    err = validate_state(state)
    if err:
        return {"error": err}, 400
    try:
        base = int(d.get("version", 0))
    except (TypeError, ValueError):
        base = 0
    db = get_db()
    row = db.execute("SELECT version FROM pw_states WHERE user_id = ?", (current_user.id,)).fetchone()
    cur = row["version"] if row else 0
    # 다른 기기에서 먼저 저장했으면 덮어쓰지 않고 알려 준다 (force면 덮어씀)
    if base != cur and not d.get("force"):
        full = db.execute("SELECT data FROM pw_states WHERE user_id = ?", (current_user.id,)).fetchone()
        return {"error": "다른 기기에서 먼저 저장했어요.", "version": cur, "state": json.loads(full["data"]) if full else None}, 409
    raw = json.dumps(state, ensure_ascii=False)
    if row:
        db.execute("UPDATE pw_states SET data = ?, version = ?, updated_at = ? WHERE user_id = ?", (raw, cur + 1, now_iso(), current_user.id))
    else:
        db.execute("INSERT INTO pw_states (user_id, data, version, updated_at) VALUES (?, ?, ?, ?)", (current_user.id, raw, cur + 1, now_iso()))
    db.commit()
    return {"ok": True, "version": cur + 1}


# ───────────────────────── 나이스(NEIS) ─────────────────────────
CACHE_SEC = 12 * 3600


def cache_get(key, max_age=CACHE_SEC):
    row = get_db().execute("SELECT data, fetched_at FROM pw_neis_cache WHERE key = ?", (key,)).fetchone()
    if row and time.time() - row["fetched_at"] < max_age:
        return json.loads(row["data"])
    return None


def cache_put(key, data):
    db = get_db()
    db.execute("INSERT OR REPLACE INTO pw_neis_cache (key, data, fetched_at) VALUES (?, ?, ?)", (key, json.dumps(data, ensure_ascii=False), time.time()))
    db.commit()


class NeisError(Exception):
    pass


def neis_call(service, params, size=100):
    """나이스 API 한 번 부르기. (rows, 전체 개수). 인증키가 없으면 한 번에 5건까지만 준다."""
    if NEIS_OFFLINE:
        raise NeisError("offline")
    p = {"Type": "json", "pIndex": 1, "pSize": size}
    if NEIS_KEY:
        p["KEY"] = NEIS_KEY
    p.update(params)
    try:
        r = requests.get(NEIS_URL + service, params=p, timeout=8)
        r.raise_for_status()
        data = r.json()
    except Exception as e:  # 연결 실패·이상한 응답
        raise NeisError(str(e)) from e
    if service not in data:
        res = data.get("RESULT", {})
        if res.get("CODE") == "INFO-200":  # 해당하는 자료 없음
            return [], 0
        raise NeisError(res.get("MESSAGE") or "나이스 응답 오류")
    head, body_ = data[service][0]["head"], data[service][1]
    total = head[0].get("list_total_count", 0)
    return body_.get("row", []), total


def ymd(d):
    return d.strftime("%Y%m%d")


def parse_ymd(s):
    return datetime.strptime(s, "%Y%m%d").date()


def fetch_schedule_rows(office, school, start, end):
    """기간의 학사일정을 모두 가져온다. 인증키가 없어 5건씩 잘리면 기간을 반씩 나눠 다시 부른다."""
    out = []

    def one(a, b):
        rows, total = neis_call("SchoolSchedule", {"ATPT_OFCDC_SC_CODE": office, "SD_SCHUL_CODE": school, "AA_FROM_YMD": ymd(a), "AA_TO_YMD": ymd(b)}, 1000 if NEIS_KEY else 100)
        return rows, total

    windows = []
    d = start
    step = 60 if NEIS_KEY else 4
    while d <= end:
        windows.append((d, min(end, d + timedelta(days=step - 1))))
        d += timedelta(days=step)
    with ThreadPoolExecutor(max_workers=6) as ex:
        results = list(ex.map(lambda w: (w, one(*w)), windows))
    retry = []
    for (a, b), (rows, total) in results:
        if len(rows) < total and a < b:
            # 잘렸으면 하루씩 다시
            k = a
            while k <= b:
                retry.append((k, k))
                k += timedelta(days=1)
        else:
            out.extend(rows)
    if retry:
        with ThreadPoolExecutor(max_workers=6) as ex:
            for rows, _ in ex.map(lambda w: one(*w), retry):
                out.extend(rows)
    return out


EXAM_RE = re.compile(r"(고사|중간고사|기말고사|지필)")
MOCK_RE = re.compile(r"(학력평가|모의|수능|대학수학능력)")
GRADE_FIELD = {1: "ONE_GRADE_EVENT_YN", 2: "TW_GRADE_EVENT_YN", 3: "THREE_GRADE_EVENT_YN"}


def classify(row):
    name = row.get("EVENT_NM") or ""
    sub = row.get("SBTR_DD_SC_NM") or ""
    if "휴업일" in name and "토요" in name:
        return None  # 토요휴업일은 어차피 주말
    if MOCK_RE.search(name) and "휴업" not in name:
        return "mock"
    if EXAM_RE.search(name):
        return "exam"
    if sub in ("휴업일", "공휴일") or "방학" in name or "휴업" in name or "공휴일" in name:
        return "holiday"
    return "event"


def build_events(rows, grade):
    field = GRADE_FIELD.get(grade)
    seen = set()
    events = []
    for r in rows:
        if field and r.get(field) == "N":
            continue
        t = classify(r)
        if not t:
            continue
        try:
            dd = parse_ymd(r["AA_YMD"]).isoformat()
        except Exception:
            continue
        key = (dd, r.get("EVENT_NM"))
        if key in seen:
            continue
        seen.add(key)
        events.append({"date": dd, "name": r.get("EVENT_NM", ""), "type": t})
    events.sort(key=lambda e: (e["date"], e["name"]))
    return events


def exam_periods(events):
    """이어진 시험 날짜를 한 기간으로 묶는다 (주말·공휴일 사이는 이어진 것으로 본다)."""
    periods = []
    for e in [x for x in events if x["type"] == "exam"]:
        d = date.fromisoformat(e["date"])
        if periods and (d - date.fromisoformat(periods[-1]["end"])).days <= 3 and periods[-1]["name"] == e["name"]:
            periods[-1]["end"] = e["date"]
            periods[-1]["days"].append(e["date"])
        else:
            periods.append({"name": e["name"], "start": e["date"], "end": e["date"], "days": [e["date"]]})
    return periods


CODE_RE = re.compile(r"^[A-Z0-9]{2,10}$")


def school_args():
    office = (request.args.get("office") or "").strip().upper()
    school = (request.args.get("school") or "").strip()
    if not CODE_RE.match(office) or not CODE_RE.match(school):
        return None
    return office, school


@app.get("/api/neis/schools")
@limiter.limit("60 per minute")
def neis_schools():
    q = clean_text(request.args.get("q"), 30)
    if len(q) < 2:
        return {"schools": []}
    key = "schools:" + q
    hit = cache_get(key, 7 * 86400)
    if hit is not None:
        return {"schools": hit, "cached": True}
    try:
        rows, _ = neis_call("schoolInfo", {"SCHUL_NM": q}, 20)
    except NeisError as e:
        return {"error": "나이스에 연결하지 못했어요. 학교 없이 시작하고 시험 날짜를 직접 넣어도 돼요.", "detail": str(e)[:120]}, 502
    out = [
        {"office": r["ATPT_OFCDC_SC_CODE"], "code": r["SD_SCHUL_CODE"], "name": r["SCHUL_NM"], "region": r.get("LCTN_SC_NM", ""), "address": (r.get("ORG_RDNMA") or "")[:60]}
        for r in rows
        if "고등학교" in (r.get("SCHUL_KND_SC_NM") or "")
    ]
    if out:
        cache_put(key, out)
    return {"schools": out}


@app.get("/api/neis/schedule")
@limiter.limit("30 per minute")
def neis_schedule():
    sa = school_args()
    if not sa:
        return {"error": "학교 코드가 이상해요."}, 400
    office, school = sa
    try:
        grade = int(request.args.get("grade", 0))
    except ValueError:
        grade = 0
    today = now_kst().date()
    try:
        start = date.fromisoformat(request.args.get("from")) if request.args.get("from") else today - timedelta(days=30)
        end = date.fromisoformat(request.args.get("to")) if request.args.get("to") else today + timedelta(days=120)
    except ValueError:
        return {"error": "날짜가 이상해요."}, 400
    if (end - start).days > 200 or end < start:
        return {"error": "기간은 200일까지예요."}, 400
    key = f"sched:{office}:{school}:{start}:{end}"
    rows = cache_get(key)
    cached = rows is not None
    if rows is None:
        try:
            rows = fetch_schedule_rows(office, school, start, end)
        except NeisError as e:
            return {"error": "학사일정을 가져오지 못했어요. 시험 날짜를 직접 넣을 수 있어요.", "detail": str(e)[:120]}, 502
        cache_put(key, rows)
    events = build_events(rows, grade)
    return {"events": events, "exams": exam_periods(events), "cached": cached, "source": "neis", "fetchedAt": now_iso()}


SKIP_SUBJECT = re.compile(r"(자율|동아리|진로활동|봉사|창체|창의적|스포츠클럽|학교스포츠|자습|방과후|조회|종례|행사|고사|시험|휴일|휴업|공휴|한글날|개천절|성탄|삼일절|현충일|광복절|어린이날|추석|설날|연휴|대체|방학|재량|자기주도)")


def clean_subject(name):
    name = re.sub(r"^\[[^\]]*\]\s*", "", name or "").strip()
    name = re.sub(r"\s+", " ", name)
    return name


@app.get("/api/neis/subjects")
@limiter.limit("20 per minute")
def neis_subjects():
    """우리 반 최근 시간표에서 과목 이름을 모은다 (인증키가 없으면 하루 5교시까지만 보여서 여러 날을 합친다)."""
    sa = school_args()
    if not sa:
        return {"error": "학교 코드가 이상해요."}, 400
    office, school = sa
    grade = clean_text(request.args.get("grade"), 1)
    cls = clean_text(request.args.get("class"), 2)
    if not grade.isdigit() or not cls.isdigit():
        return {"error": "학년·반을 숫자로 넣어 주세요."}, 400
    key = f"subj:{office}:{school}:{grade}:{cls}:{now_kst().date().isoformat()}"
    hit = cache_get(key)
    if hit is not None:
        return {"subjects": hit, "cached": True}
    days = []
    d = now_kst().date()
    while len(days) < 10:
        d -= timedelta(days=1)
        if d.weekday() < 5:
            days.append(d)

    def one(day):
        try:
            rows, _ = neis_call("hisTimetable", {"ATPT_OFCDC_SC_CODE": office, "SD_SCHUL_CODE": school, "GRADE": grade, "CLASS_NM": cls, "ALL_TI_YMD": ymd(day)}, 100)
            return rows
        except NeisError:
            return None

    with ThreadPoolExecutor(max_workers=6) as ex:
        results = list(ex.map(one, days))
    if all(r is None for r in results):
        return {"error": "시간표를 가져오지 못했어요. 과목을 직접 골라 주세요."}, 502
    count = {}
    for rows in results:
        for r in rows or []:
            n = clean_subject(r.get("ITRT_CNTNT"))
            if not n or SKIP_SUBJECT.search(n):
                continue
            count[n] = count.get(n, 0) + 1
    out = [{"name": k, "count": v} for k, v in sorted(count.items(), key=lambda kv: -kv[1])]
    cache_put(key, out)
    return {"subjects": out, "partial": not NEIS_KEY}


def neis_all(service, params, max_pages=6):
    """여러 쪽을 모두 가져온다 (인증키가 없으면 한 쪽에 5건뿐이라 쪽을 넘긴다)."""
    out, seen, total = [], set(), 0
    size = 100 if NEIS_KEY else 5
    for page in range(1, max_pages + 1):
        p = dict(params)
        p["pIndex"] = page
        rows, total = neis_call(service, p, size)
        new = [r for r in rows if json.dumps(r, sort_keys=True) not in seen]
        if not new:  # 인증키가 없으면 다음 쪽도 같은 5건을 준다
            break
        for r in new:
            seen.add(json.dumps(r, sort_keys=True))
        out.extend(new)
        if len(out) >= total:
            break
    return out, total


ALLERGY_RE = re.compile(r"\s*\([0-9.\s]+\)")


def clean_dish(s):
    s = ALLERGY_RE.sub("", s or "")
    s = re.sub(r"[*#]", "", s)
    return s.strip()


def day_arg(name="date"):
    try:
        return date.fromisoformat(request.args.get(name)) if request.args.get(name) else now_kst().date()
    except ValueError:
        return None


@app.get("/api/neis/meal")
@limiter.limit("30 per minute")
def neis_meal():
    """그날부터 일주일 급식 (메뉴 이름만, 알레르기 번호는 뺀다)."""
    sa = school_args()
    d = day_arg()
    if not sa or not d:
        return {"error": "학교 코드나 날짜가 이상해요."}, 400
    office, school = sa
    key = f"meal:{office}:{school}:{d}"
    hit = cache_get(key)
    if hit is not None:
        return {"meals": hit, "cached": True}
    try:
        rows, _ = neis_all("mealServiceDietInfo", {"ATPT_OFCDC_SC_CODE": office, "SD_SCHUL_CODE": school, "MLSV_FROM_YMD": ymd(d), "MLSV_TO_YMD": ymd(d + timedelta(days=6))})
    except NeisError:
        return {"error": "급식 정보를 가져오지 못했어요."}, 502
    meals = []
    for r in rows:
        try:
            dd = parse_ymd(r["MLSV_YMD"]).isoformat()
        except Exception:
            continue
        dishes = [clean_dish(x) for x in re.split(r"<br\s*/?>", r.get("DDISH_NM") or "")]
        meals.append({"date": dd, "kind": r.get("MMEAL_SC_NM", ""), "dishes": [x for x in dishes if x][:12], "cal": (r.get("CAL_INFO") or "").replace(" Kcal", "kcal")})
    meals.sort(key=lambda m: (m["date"], m["kind"]))
    cache_put(key, meals)
    return {"meals": meals}


@app.get("/api/neis/timetable")
@limiter.limit("30 per minute")
def neis_timetable():
    """우리 반 그날 시간표 (교시 순서)."""
    sa = school_args()
    d = day_arg()
    grade = clean_text(request.args.get("grade"), 1)
    cls = clean_text(request.args.get("class"), 2)
    if not sa or not d or not grade.isdigit() or not cls.isdigit():
        return {"error": "학교·학년·반을 확인해 주세요."}, 400
    office, school = sa
    key = f"tt:{office}:{school}:{grade}:{cls}:{d}"
    hit = cache_get(key)
    if hit is not None:
        return dict(hit, cached=True)
    try:
        rows, total = neis_all("hisTimetable", {"ATPT_OFCDC_SC_CODE": office, "SD_SCHUL_CODE": school, "GRADE": grade, "CLASS_NM": cls, "ALL_TI_YMD": ymd(d)}, 3)
    except NeisError:
        return {"error": "시간표를 가져오지 못했어요."}, 502
    seen = {}
    for r in rows:
        try:
            k = int(r.get("PERIO") or 0)
        except ValueError:
            continue
        seen[k] = clean_subject(r.get("ITRT_CNTNT"))
    periods = [{"period": k, "name": v} for k, v in sorted(seen.items()) if v]
    partial = total > len(rows)
    cache_put(key, {"periods": periods, "partial": partial})
    return {"periods": periods, "partial": partial}


# ───────────────────────── 사용자 검증 (익명 기록·설문) ─────────────────────────
METRIC_KINDS = {"onboard_ms", "plan_build", "replan", "demo_start", "sim_use", "course_search", "task_done", "result_input", "visit"}
CLIENT_RE = re.compile(r"^[A-Za-z0-9_-]{6,40}$")


@app.post("/api/metrics")
@limiter.limit("120 per minute")
def metrics():
    bad = need_json()
    if bad:
        return bad
    d = body()
    kind = d.get("kind")
    cid = str(d.get("clientId") or "")
    if kind not in METRIC_KINDS or not CLIENT_RE.match(cid):
        return {"error": "잘못된 기록이에요."}, 400
    try:
        value = float(d.get("value")) if d.get("value") is not None else None
    except (TypeError, ValueError):
        value = None
    if value is not None and not (0 <= value <= 1e9):
        value = None
    db = get_db()
    db.execute("INSERT INTO pw_metrics (client_id, kind, value, created_at) VALUES (?, ?, ?, ?)", (cid, kind, value, now_iso()))
    db.commit()
    return {"ok": True}


HELPFUL = {"역산", "최적 배분", "근거 설명", "자동 재조정", "선택과목 추천", "학사일정 연동", "시뮬레이터", "리포트"}


@app.post("/api/feedback")
@limiter.limit("10 per hour")
def feedback():
    bad = need_json()
    if bad:
        return bad
    d = body()
    cid = str(d.get("clientId") or "")
    if not CLIENT_RE.match(cid):
        return {"error": "잘못된 요청이에요."}, 400
    try:
        rating = int(d.get("rating"))
    except (TypeError, ValueError):
        rating = 0
    if not 1 <= rating <= 5:
        return {"error": "별점은 1~5예요."}, 400
    try:
        before = int(d.get("beforeMin")) if d.get("beforeMin") not in (None, "") else None
    except (TypeError, ValueError):
        before = None
    if before is not None and not 0 <= before <= 600:
        before = None
    helpful = [h for h in (d.get("helpful") or []) if h in HELPFUL][:8]
    comment = clean_text(d.get("comment"), 500)
    db = get_db()
    db.execute(
        "INSERT INTO pw_feedback (client_id, user_id, rating, before_min, helpful, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (cid, current_user.id if current_user.is_authenticated else None, rating, before, ",".join(helpful), comment, now_iso()),
    )
    db.commit()
    return {"ok": True}


def median(xs):
    xs = sorted(xs)
    if not xs:
        return None
    m = len(xs) // 2
    return xs[m] if len(xs) % 2 else (xs[m - 1] + xs[m]) / 2


@app.get("/api/feedback/summary")
def feedback_summary():
    """발표용 숫자: 몇 명이 썼는지, 첫 계획까지 걸린 시간, 별점, 예전에 계획 세우던 시간. 글은 관리자만."""
    db = get_db()
    users = db.execute("SELECT COUNT(DISTINCT client_id) c FROM pw_metrics").fetchone()["c"]
    onboard = [r["value"] for r in db.execute("SELECT MIN(value) value FROM pw_metrics WHERE kind = 'onboard_ms' AND value IS NOT NULL GROUP BY client_id")]
    counts = {r["kind"]: r["c"] for r in db.execute("SELECT kind, COUNT(*) c FROM pw_metrics GROUP BY kind")}
    fb = db.execute("SELECT rating, before_min, helpful, comment, created_at FROM pw_feedback ORDER BY id DESC").fetchall()
    helpful = {}
    for r in fb:
        for h in (r["helpful"] or "").split(","):
            if h:
                helpful[h] = helpful.get(h, 0) + 1
    out = {
        "users": users,
        "onboardMedianSec": round(median(onboard) / 1000, 1) if onboard else None,
        "onboardCount": len(onboard),
        "counts": counts,
        "feedbackCount": len(fb),
        "ratingAvg": round(sum(r["rating"] for r in fb) / len(fb), 2) if fb else None,
        "beforeMedianMin": median([r["before_min"] for r in fb if r["before_min"] is not None]),
        "helpful": sorted(helpful.items(), key=lambda kv: -kv[1]),
    }
    if current_user.is_authenticated and current_user.username in ADMINS:
        out["comments"] = [{"rating": r["rating"], "comment": r["comment"], "at": r["created_at"]} for r in fb if r["comment"]][:100]
    return out


@app.get("/api/time")
def server_time():
    """한국 날짜 (화면의 '오늘'을 맞추는 데 쓴다)."""
    n = now_kst()
    return {"today": n.date().isoformat(), "now": n.isoformat(timespec="seconds")}
