import json
import os
import re
import sqlite3

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

DB_PATH = "app.db"

# ===== 데이터: 대계열, 교과목 -> 핵심 개념 =====
TRACKS = [
    {"id": "eng", "name": "공학", "emoji": "⚙️"},
    {"id": "med", "name": "의약·보건", "emoji": "🩺"},
    {"id": "sci", "name": "자연과학", "emoji": "🔬"},
    {"id": "soc", "name": "사회과학", "emoji": "🏛️"},
    {"id": "hum", "name": "인문·어학", "emoji": "📚"},
    {"id": "art", "name": "예체능", "emoji": "🎨"},
]

# 교과목별 교과서 핵심 개념 (태그로 제시)
SUBJECTS = {
    "확률과 통계": ["확률분포", "조건부확률", "통계적 추정", "정규분포", "표본조사", "경우의 수"],
    "미적분": ["극한", "미분계수", "적분", "변화율", "최적화", "급수"],
    "수학Ⅰ": ["지수함수", "로그함수", "삼각함수", "수열"],
    "정보": ["알고리즘", "자료구조", "데이터베이스", "네트워크", "인공지능", "프로그래밍"],
    "물리학Ⅰ": ["운동법칙", "에너지보존", "전자기력", "파동", "열역학"],
    "화학Ⅰ": ["원자구조", "화학결합", "몰농도", "산화환원", "화학반응속도"],
    "생명과학Ⅰ": ["세포", "유전", "항상성", "면역", "진화", "생태계"],
    "지구과학Ⅰ": ["판구조론", "대기순환", "별의 진화", "지구시스템"],
    "경제": ["수요와 공급", "시장실패", "국내총생산", "인플레이션", "기회비용"],
    "사회·문화": ["사회화", "일탈이론", "문화상대주의", "사회계층", "사회조사방법"],
    "생활과 윤리": ["생명윤리", "정보윤리", "환경윤리", "분배정의"],
    "한국지리": ["인구분포", "도시화", "지역개발", "기후"],
    "세계사": ["시민혁명", "산업혁명", "제국주의", "냉전"],
    "영어": ["독해전략", "에세이쓰기", "토론", "원서읽기"],
    "국어": ["비판적 읽기", "매체언어", "문학과 사회", "글쓰기"],
    "미술": ["조형요소", "미술사", "디자인", "색채"],
    "음악": ["화성학", "음악사", "국악", "작곡"],
    "체육": ["운동생리학", "스포츠과학", "건강관리"],
}

# 탐구 성향 -> 글쓰기 톤
STYLES = {
    "academic": "심화 학술형 (이론과 원리를 깊이 파고드는 학술적 톤)",
    "social": "실생활 적용·사회 기여형 (현실 문제 해결과 사회적 의미를 강조하는 톤)",
    "project": "실험·프로젝트형 (직접 실험·제작·데이터 분석을 강조하는 실천적 톤)",
}

# 계열별 실존 추천 도서 (제목, 저자). 저작권 걱정 없는 사실 정보(서지)만 사용.
# AI 키 없이도 진짜 책을 추천하기 위한 데이터.
BOOKS_BY_TRACK = {
    "공학": [
        ("코드 — 하드웨어와 소프트웨어에 숨어 있는 언어", "찰스 펫졸드"),
        ("미움받을 용기 없이 읽는 공학자의 사고법 『공학이란 무엇인가』", "성풍현 외"),
        ("How to: 황당한 질문에 대한 과학적 답변", "랜들 먼로"),
        ("세상을 바꾼 질문들 『떨림과 울림』", "김상욱"),
    ],
    "의약·보건": [
        ("아내를 모자로 착각한 남자", "올리버 색스"),
        ("질병이 바꾼 세계의 역사", "로날트 D. 게르슈테"),
        ("골든아워", "이국종"),
        ("면역에 관하여", "율라 비스"),
    ],
    "자연과학": [
        ("코스모스", "칼 세이건"),
        ("이기적 유전자", "리처드 도킨스"),
        ("떨림과 울림", "김상욱"),
        ("김상욱의 양자 공부", "김상욱"),
    ],
    "사회과학": [
        ("넛지", "리처드 탈러, 캐스 선스타인"),
        ("정의란 무엇인가", "마이클 샌델"),
        ("팩트풀니스", "한스 로슬링"),
        ("미래의 역사 『사피엔스』", "유발 하라리"),
    ],
    "인문·어학": [
        ("사피엔스", "유발 하라리"),
        ("총, 균, 쇠", "재레드 다이아몬드"),
        ("언어의 역사", "데이비드 크리스털"),
        ("데미안", "헤르만 헤세"),
    ],
    "예체능": [
        ("다른 방식으로 보기", "존 버거"),
        ("예술수업", "오종우"),
        ("미술이야 고마워 『서양미술사』", "E. H. 곰브리치"),
        ("음악의 기쁨", "롤랑 마뉘엘"),
    ],
}

# 특정 키워드에 딱 맞는 책 (키워드가 입력에 있으면 우선 추천)
BOOKS_BY_KEYWORD = {
    "인공지능": ("AI 지도책", "케이트 크로퍼드"),
    "알고리즘": ("알고리즘, 인생을 계산하다", "브라이언 크리스천"),
    "데이터": ("빅데이터 인간을 읽다 『대량살상 수학무기』", "캐시 오닐"),
    "빅데이터": ("대량살상 수학무기", "캐시 오닐"),
    "유전": ("유전자의 내밀한 역사", "싯다르타 무케르지"),
    "유전자 가위": ("크리스퍼가 온다", "제니퍼 다우드나"),
    "면역": ("면역에 관하여", "율라 비스"),
    "통계적 추정": ("벌거벗은 통계학", "찰스 윌런"),
    "확률분포": ("세상물정의 물리학 속 확률 『틀리지 않는 법』", "조던 엘렌버그"),
    "환경윤리": ("침묵의 봄", "레이첼 카슨"),
    "생명윤리": ("정의란 무엇인가", "마이클 샌델"),
    "경제": ("죽은 경제학자의 살아있는 아이디어", "토드 부크홀츠"),
    "수요와 공급": ("경제학 콘서트", "팀 하포드"),
}


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
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS result (
                id         INTEGER PRIMARY KEY,
                user_id    INTEGER NOT NULL,
                title      TEXT NOT NULL,
                payload    TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES user(id)
            )
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
    row = get_db().execute("SELECT * FROM user WHERE id = ?", (user_id,)).fetchone()
    return User(row) if row else None


# ----- 화면 -----
@app.get("/")
def index():
    return render_template("index.html")


# ----- 회원 API -----
@app.get("/me")
def me():
    base = {"ai_mode": ai_mode()}
    if current_user.is_authenticated:
        base.update(id=current_user.id, nickname=current_user.nickname)
    else:
        base["id"] = None
    return base


@app.post("/signup")
def signup():
    data = request.json or {}
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
    login_user(User(row))
    return {"nickname": nickname}, 201


@app.post("/login")
def login():
    data = request.json or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    row = get_db().execute(
        "SELECT * FROM user WHERE username = ?", (username,)
    ).fetchone()
    if row and bcrypt.check_password_hash(row["pw_hash"], password):
        login_user(User(row))
        return {"nickname": row["nickname"]}
    return {"error": "아이디나 비밀번호가 맞지 않아요."}, 401


@app.post("/logout")
@login_required
def logout():
    logout_user()
    return {"ok": True}


# ----- 데이터 API -----
@app.get("/meta")
def meta():
    """계열, 교과목 목록을 준다."""
    return jsonify({"tracks": TRACKS, "subjects": sorted(SUBJECTS.keys())})


@app.post("/keywords")
def keywords():
    """선택한 교과목들의 핵심 개념 태그를 모아 준다."""
    subs = (request.json or {}).get("subjects") or []
    seen = []
    for s in subs:
        for k in SUBJECTS.get(s, []):
            if k not in seen:
                seen.append(k)
    return jsonify({"keywords": seen})


# ----- AI 생성 -----
@app.post("/generate")
def generate():
    data = request.json or {}
    track = (data.get("track") or "").strip()
    major = (data.get("major") or "").strip()
    job = (data.get("job") or "").strip()
    subjects = data.get("subjects") or []
    kw = data.get("keywords") or []
    style = data.get("style") or "academic"

    if not major and not subjects:
        return {"error": "학과나 교과목을 하나 이상 입력해주세요."}, 400

    result = run_generate(track, major, job, subjects, kw, style)
    result["ai_mode"] = ai_mode()
    return jsonify(result)


def ai_mode():
    if os.environ.get("OPENAI_API_KEY"):
        return "openai"
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic"
    return "practice"


def _build_prompt(track, major, job, subjects, kw, style):
    tone = STYLES.get(style, STYLES["academic"])
    return (
        "너는 한국 고등학생의 학교생활기록부 '세부능력 및 특기사항(세특)'을 돕는 입시 전문가야.\n"
        f"- 희망 계열: {track}\n"
        f"- 희망 학과: {major}\n"
        f"- 희망 직업: {job}\n"
        f"- 관련 교과목: {', '.join(subjects)}\n"
        f"- 관심 키워드/교과 개념: {', '.join(kw)}\n"
        f"- 탐구 성향(톤): {tone}\n\n"
        "위 정보를 바탕으로 교과 역량이 돋보이는 탐구를 설계해줘. "
        "도서는 반드시 '진로/학과와의 연결'을 기준으로 고르고, 실험·활동은 고등학생이 "
        "학교나 집에서 실제로 할 수 있는 수준으로 구체적으로 제시해. "
        "반드시 아래 JSON 형식으로만 답해. 다른 말은 쓰지 마.\n"
        "{\n"
        '  "topic": "감각적이고 학술적인 탐구 주제 제목(한 문장)",\n'
        '  "appeal": "이 주제가 왜 해당 과목 세특에 유리한지 1문장",\n'
        '  "outline": ["1단계: 탐구 동기 및 배경", "2단계: 핵심 이론 탐색", "3단계: 데이터 분석 또는 적용", "4단계: 시사점 및 진로 연결"],\n'
        '  "books": [{"title":"실제 존재하는 추천 도서 제목", "why":"이 책이 왜 이 학생의 진로/학과에 딱 맞는지", "use":"이 책을 세특에 어떻게 녹일지 1문장"}],\n'
        '  "experiments": ["고등학생이 실제로 할 수 있는 구체적인 실험/활동 2~3개 (무엇을, 어떻게, 무엇을 측정/관찰하는지)"],\n'
        '  "sertuk_examples": ["학생부에 그대로 적을 수 있는 세특 문장 예시 2개 (교과 개념+탐구활동+진로연계가 드러나게, ~함/~음 체로)"],\n'
        '  "papers": ["관련 논문/자료를 찾는 키워드 팁 1~2개"],\n'
        '  "concepts": ["이 탐구에 등장하는 핵심 교과 개념 3~5개"]\n'
        "}\n"
        "books는 2권, outline의 각 항목과 experiments·sertuk_examples는 구체적인 내용으로 채워줘. "
        "outline의 각 단계는 '무엇을 어떻게 하는지'까지 2~3문장으로 자세히, experiments는 [준비]-[과정]-[정리] 흐름이 드러나게 "
        "단계별로 구체적으로, sertuk_examples는 교과 개념+탐구 과정+드러난 역량+진로 연계가 모두 담긴 2~3문장짜리 완결된 문장으로 써줘. "
        "도서 제목은 실제로 존재하는 책으로 추천해."
    )


def run_generate(track, major, job, subjects, kw, style):
    mode = ai_mode()
    try:
        if mode == "openai":
            return _gen_openai(track, major, job, subjects, kw, style)
        if mode == "anthropic":
            return _gen_anthropic(track, major, job, subjects, kw, style)
    except Exception as e:
        app.logger.warning("AI 생성 실패, 연습 모드로 대체: %s", e)
    return _gen_practice(track, major, job, subjects, kw, style)


def _parse_json(text):
    """AI가 준 텍스트에서 JSON만 뽑아 파싱."""
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        return json.loads(m.group(0))
    return json.loads(text)


def _gen_openai(track, major, job, subjects, kw, style):
    from openai import OpenAI

    client = OpenAI()
    resp = client.chat.completions.create(
        model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
        messages=[
            {"role": "system", "content": "너는 입시 세특 설계 전문가야. JSON으로만 답한다."},
            {"role": "user", "content": _build_prompt(track, major, job, subjects, kw, style)},
        ],
        response_format={"type": "json_object"},
        max_tokens=900,
    )
    return _normalize(_parse_json(resp.choices[0].message.content))


def _gen_anthropic(track, major, job, subjects, kw, style):
    import anthropic

    client = anthropic.Anthropic()
    resp = client.messages.create(
        model=os.environ.get("ANTHROPIC_MODEL", "claude-3-5-sonnet-latest"),
        max_tokens=900,
        messages=[{"role": "user", "content": _build_prompt(track, major, job, subjects, kw, style)}],
    )
    return _normalize(_parse_json(resp.content[0].text))


def _normalize(d):
    """AI 결과에서 필요한 키만 안전하게 정리."""
    def as_list(v):
        if isinstance(v, list):
            return [str(x) for x in v]
        if v:
            return [str(v)]
        return []

    def as_books(v):
        """도서를 {title, why, use} 형태로 통일."""
        out = []
        if not isinstance(v, list):
            v = [v] if v else []
        for item in v:
            if isinstance(item, dict):
                out.append({
                    "title": str(item.get("title", "")).strip(),
                    "why": str(item.get("why", "")).strip(),
                    "use": str(item.get("use", "")).strip(),
                })
            elif item:
                # 문자열이면 title에만 넣기
                out.append({"title": str(item).strip(), "why": "", "use": ""})
        return [b for b in out if b["title"]][:4]

    return {
        "topic": str(d.get("topic", "탐구 주제")),
        "appeal": str(d.get("appeal", "")),
        "outline": as_list(d.get("outline"))[:6],
        "books": as_books(d.get("books")),
        "experiments": as_list(d.get("experiments"))[:4],
        "sertuk_examples": as_list(d.get("sertuk_examples"))[:3],
        "papers": as_list(d.get("papers"))[:3],
        "concepts": as_list(d.get("concepts"))[:6],
    }


def _pick_books(track, major, job, kw, key):
    """실존 도서 데이터에서 입력에 맞는 책 2권을 고른다 (키 없이 진짜 책 추천)."""
    major_disp = major or (track or "희망 진로")
    job_disp = job or major_disp
    chosen = []
    used_titles = set()

    def add(title, author, why, use):
        if title in used_titles:
            return
        used_titles.add(title)
        chosen.append({"title": f"{title} ({author})", "why": why, "use": use})

    # 1) 키워드에 딱 맞는 책 우선
    for k in kw:
        if k in BOOKS_BY_KEYWORD and len(chosen) < 2:
            title, author = BOOKS_BY_KEYWORD[k]
            add(
                title, author,
                f"관심 키워드 '{k}'를 깊이 다뤄, {major_disp} 진로와 직접 연결되는 책이에요.",
                f"책에서 '{k}' 관련 내용을 교과 수업과 엮어 독후 탐구로 발전시킨 과정을 세특에 서술하기",
            )

    # 2) 계열 대표 교양서로 채우기
    track_books = BOOKS_BY_TRACK.get(track, [])
    for title, author in track_books:
        if len(chosen) >= 2:
            break
        add(
            title, author,
            f"{track or major_disp} 계열에서 널리 읽히는 교양서로, {job_disp}를 꿈꾸는 학생의 진로 동기를 보여주기 좋아요.",
            f"인상 깊은 장을 골라 '{key}' 탐구 주제와 연결 지은 생각을 세특에 녹이기",
        )

    # 3) 그래도 부족하면 검색 가이드로 보완
    while len(chosen) < 2:
        add(
            f"'{key}' 관련 교양서 (도서관·서점에서 '{key}'로 검색)",
            "직접 찾기",
            f"{major_disp} 진로와 '{key}' 개념을 잇는 기초 교양서를 직접 골라보세요.",
            "책을 읽고 생긴 질문을 탐구 주제로 발전시킨 과정을 세특에 서술하기",
        )
    return chosen[:2]


def _has_batchim(word):
    """단어 마지막 글자에 받침이 있는지 (한글 기준)."""
    if not word:
        return False
    ch = word.strip()[-1]
    if "가" <= ch <= "힣":
        return (ord(ch) - 0xAC00) % 28 != 0
    return False  # 한글이 아니면 받침 없음으로 간주 (영어 등)


def _wa_gwa(word):
    """받침 있으면 '과', 없으면 '와'."""
    return "과" if _has_batchim(word) else "와"


def _gen_practice(track, major, job, subjects, kw, style):
    """키 없이 쓰는 연습 모드. 입력을 조합해 그럴듯한 틀을 만든다."""
    subj = subjects[0] if subjects else (track or "교과")
    key = kw[0] if kw else (subjects[0] if subjects else "핵심 개념")
    key2 = kw[1] if len(kw) > 1 else "실생활 사례"
    major_disp = major or (track or "희망 진로")

    tone_word = {
        "academic": "심화 탐구",
        "social": "사회 기여 탐구",
        "project": "프로젝트형 탐구",
    }.get(style, "탐구")

    topic = f"{subj} 속 '{key}'의 원리 탐구: {major_disp} 관점에서의 {tone_word}"
    appeal = (
        f"{subj} 교과의 '{key}' 개념을 단순 암기가 아니라 {major_disp} 진로의 실제 문제와 연결해 분석하므로, "
        f"교과 이해도와 전공 적합성, 자기주도적 탐구 역량을 한 번에 보여줄 수 있어요. "
        f"특히 '{key}'를 {key2}{_wa_gwa(key2)} 엮어 탐구하면 융합적 사고력까지 드러납니다."
    )
    outline = [
        f"1단계 · 탐구 동기 및 배경: {subj} 수업에서 '{key}' 개념을 배우며 '{major_disp} 분야에서는 이게 어떻게 쓰일까?'라는 의문을 가지게 된 계기를 서술하고, "
        f"교과서 정의와 실제 사례의 차이를 질문으로 정리한다.",
        f"2단계 · 핵심 이론 탐색: '{key}'의 정의·원리·공식(또는 핵심 메커니즘)을 교과서와 추천 도서로 정리하고, "
        f"관련 개념인 '{key2}'{_wa_gwa(key2)}의 관계를 개념 지도로 그려 비교·분석한다.",
        f"3단계 · 데이터 분석 또는 적용: '{key}'가 {major_disp} 분야에서 실제로 적용된 사례를 2~3개 조사하거나, "
        f"직접 설문·실험·시뮬레이션으로 데이터를 모아 표·그래프로 시각화하고 경향성을 해석한다.",
        f"4단계 · 결론 및 진로 연계: 탐구로 알게 된 점과 한계를 정리하고, 이것이 {job or major_disp}(으)로서 갖추고 싶은 역량과 "
        f"어떻게 연결되는지, 앞으로 더 탐구하고 싶은 후속 질문은 무엇인지 밝힌다.",
    ]
    # 진로와 연결지은 추천 도서 (실존 도서에서 고름 + 왜 맞는지 + 세특 활용법)
    books = _pick_books(track, major, job, kw, key)
    # 구체적인 실험/활동 (준비 → 과정 → 결과 정리까지 단계별)
    experiments = [
        f"① '{key}' 데이터 수집·분석 활동 — [준비] {subj}에서 배운 '{key}' 관련 측정값이나 설문 문항을 설계한다. "
        f"[과정] 20~50개 표본의 데이터를 모아 엑셀·구글시트로 표와 그래프(막대·꺾은선)를 만든다. "
        f"[정리] 평균·분포 등 경향을 해석하고 '{major_disp}' 관점에서 의미를 1쪽 보고서로 정리한다.",
        f"② '{key}' 적용 사례 비교 탐구 — [준비] {major_disp} 분야에서 '{key}'가 쓰인 실제 사례 2~3개를 뉴스·논문·도서에서 찾는다. "
        f"[과정] 각 사례에서 '{key}'가 어떤 문제를 어떻게 해결했는지 공통점·차이점 표로 비교한다. "
        f"[정리] 가장 인상 깊은 사례를 골라 발표 자료를 만들고 친구들의 질문에 답한다.",
        f"③ '{key}' 모의 실험·시뮬레이션 — [준비] '{key}'의 원리를 확인할 수 있는 간단한 실험이나 파이썬·엑셀 시뮬레이션을 설계한다. "
        f"[과정] 변수를 바꿔가며 결과가 어떻게 달라지는지 반복 측정·기록한다. "
        f"[정리] 예상과 실제 결과의 차이를 분석하고 '{key2}' 개념으로 이유를 설명한다.",
    ]
    # 세특에 그대로 쓸 수 있는 문장 예시 (교과+탐구과정+역량+진로가 모두 드러나게)
    sertuk_examples = [
        f"{subj} 수업에서 '{key}' 개념을 배운 뒤 {major_disp} 분야에서의 활용에 호기심을 느껴, 관련 도서와 자료를 스스로 조사하여 "
        f"'{key}'의 원리를 '{key2}'{_wa_gwa(key2)} 연결해 개념 지도로 정리함. 자료를 표와 그래프로 시각화하고 경향을 논리적으로 해석하는 과정에서 "
        f"자기주도적 탐구 역량과 {major_disp}에 대한 전공 적합성을 보여줌.",
        f"'{key}'를 주제로 가설을 세우고 데이터를 수집·분석하는 탐구 활동을 수행함. 실험 결과가 예상과 다른 부분을 '{key2}' 개념으로 "
        f"설명하며 비판적 사고력을 발휘하였고, 탐구 결과를 {job or major_disp}이 되기 위해 더 공부하고 싶은 후속 질문으로 발전시켜 "
        f"지적 성장 가능성과 진로 성숙도를 드러냄.",
    ]
    papers = [
        f"RISS(riss.kr)·DBpia에서 '{key} {major_disp}' 또는 '{key} {key2}'로 검색해 요약(초록)만 읽어도 좋아요.",
        f"국가통계포털(KOSIS)이나 공공데이터포털에서 '{key}' 관련 실제 데이터를 받아 3단계 활동에 활용해보세요.",
    ]
    concepts = (kw[:5] if kw else []) or [key, key2]
    return {
        "topic": topic,
        "appeal": appeal,
        "outline": outline,
        "books": books,
        "experiments": experiments,
        "sertuk_examples": sertuk_examples,
        "papers": papers,
        "concepts": concepts,
        "_practice_note": "실제 추천 도서와 단계별 상세 설계를 담았어요. AI 키를 넣으면 네 입력에 더 꼭 맞게 다듬어줘요.",
    }


# ----- 결과 저장/목록 -----
@app.post("/results")
@login_required
def save_result():
    data = request.json or {}
    title = (data.get("title") or "제목 없는 탐구").strip()[:200]
    payload = data.get("payload")
    if not isinstance(payload, dict):
        return {"error": "저장할 내용이 없어요."}, 400
    db = get_db()
    cur = db.execute(
        "INSERT INTO result (user_id, title, payload) VALUES (?, ?, ?)",
        (current_user.id, title, json.dumps(payload, ensure_ascii=False)),
    )
    db.commit()
    return {"id": cur.lastrowid}, 201


@app.get("/results")
@login_required
def list_results():
    rows = get_db().execute(
        "SELECT id, title, created_at FROM result WHERE user_id = ? ORDER BY id DESC LIMIT 50",
        (current_user.id,),
    ).fetchall()
    return jsonify(
        [{"id": r["id"], "title": r["title"], "created_at": r["created_at"]} for r in rows]
    )


@app.get("/results/<int:rid>")
@login_required
def get_result(rid):
    row = get_db().execute(
        "SELECT title, payload FROM result WHERE id = ? AND user_id = ?",
        (rid, current_user.id),
    ).fetchone()
    if not row:
        return {"error": "찾을 수 없어요."}, 404
    return {"title": row["title"], "payload": json.loads(row["payload"])}


@app.delete("/results/<int:rid>")
@login_required
def delete_result(rid):
    db = get_db()
    db.execute("DELETE FROM result WHERE id = ? AND user_id = ?", (rid, current_user.id))
    db.commit()
    return "", 204
