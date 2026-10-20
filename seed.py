"""체험 학급(춘천고 2학년 1반) 데이터. 처음 체험 로그인할 때 한 번만 만든다.
이름은 흔한 예시 이름이고, 첨부 파일(PDF·그림·글)은 여기서 직접 만든다.
"""
import io
import json
import os
from datetime import timedelta

FONT = "/usr/share/fonts/truetype/nanum/NanumGothic.ttf"
FONT_B = "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf"


class Blob:
    """save_upload 가 받는 업로드 파일 흉내."""

    def __init__(self, name, data):
        self.filename, self.data = name, data

    def save(self, path):
        with open(path, "wb") as f:
            f.write(self.data)


def pdf(title, lines):
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas

    if "Nanum" not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont("Nanum", FONT))
        pdfmetrics.registerFont(TTFont("NanumB", FONT_B if os.path.exists(FONT_B) else FONT))
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    c.setFillColorRGB(0.19, 0.51, 0.96)
    c.rect(0, h - 90, w, 90, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("NanumB", 20)
    c.drawString(50, h - 55, title)
    c.setFillColorRGB(0.1, 0.12, 0.16)
    y = h - 130
    for ln in lines:
        bold = ln.startswith("# ")
        c.setFont("NanumB" if bold else "Nanum", 14 if bold else 11.5)
        c.drawString(50, y, ln[2:] if bold else ln)
        y -= 26 if bold else 20
    c.setFont("Nanum", 9)
    c.setFillColorRGB(0.55, 0.58, 0.63)
    c.drawString(50, 40, "EduSpace 체험용 예시 자료 · 춘천고등학교 2학년 1반")
    c.save()
    return buf.getvalue()


def png(title, rows, color=(49, 130, 246), size=(900, 600)):
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", size, (248, 250, 252))
    d = ImageDraw.Draw(img)
    fb = ImageFont.truetype(FONT_B if os.path.exists(FONT_B) else FONT, 44)
    f = ImageFont.truetype(FONT, 30)
    d.rounded_rectangle([30, 30, size[0] - 30, 150], 28, fill=color)
    d.text((70, 62), title, font=fb, fill=(255, 255, 255))
    y = 190
    for r in rows:
        d.rounded_rectangle([50, y, size[0] - 50, y + 70], 18, fill=(255, 255, 255), outline=(229, 232, 235), width=2)
        d.text((80, y + 18), r, font=f, fill=(51, 61, 75))
        y += 88
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


def seed(c, scope, demo, now_iso, today, save, ensure_subjects):
    ensure_subjects(c, scope)
    t = now_iso()

    def user(name, role="student", color="#3182f6"):
        return c.execute("INSERT INTO es_users (name, role, office, school_code, school_name, grade, class_num, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                         (name, role, demo["office"], demo["code"], demo["name"], demo["grade"], demo["class"], color, t)).lastrowid

    teacher = user("담임 선생님", "teacher", "#15c47e")
    mj, sy, jh, he, yj = user("민준", color="#3182f6"), user("서연", color="#ec4899"), user("지호", color="#fe9800"), user("하은", color="#8b5cf6"), user("예준", color="#06b6d4")
    subj = {r["name"]: r["id"] for r in c.execute("SELECT id, name FROM es_subjects WHERE scope = ?", (scope,))}
    D = lambda k: (today + timedelta(days=k)).isoformat()  # noqa: E731

    def up(name, data, who):
        return save(Blob(name, data), scope, who)

    poster = up("반 단합대회 안내.png", png("2학년 1반 단합대회", ["장소: 학교 체육관 → 공지천 산책", "준비물: 반티, 물, 돗자리", "회비: 5,000원 (총무 하은)"], (21, 196, 126)), he)
    sci_pdf = up("통합과학 실험 보고서 양식.pdf", pdf("통합과학 실험 보고서 양식", ["# 1. 실험 제목", "산화 환원 반응 관찰", "# 2. 가설", "철 수세미를 황산구리 수용액에 넣으면 구리가 석출된다.", "# 3. 준비물", "철 수세미, 황산구리 수용액, 비커, 핀셋", "# 4. 결과와 해석 (사진 1장 이상)", "# 5. 제출: 클래스 공유 문서함 › 통합과학"]), teacher)
    math_pdf = up("미적분 수행평가 안내.pdf", pdf("수학 수행평가: 미적분 탐구 보고서", ["# 평가 개요", "주제: 우리 주변의 변화율 찾기 (속도, 인구, 기온 등)", "분량: A4 2쪽 이내 · 그래프 1개 이상", "# 채점 기준 (15점)", "· 주제의 적절성 4점  · 수학적 정확성 6점", "· 표현과 해석 3점  · 참고 자료 2점", "# 제출", "기한 내 문서함에 PDF로 올리기"]), teacher)
    math_txt = up("기말고사 범위와 기출 유형.txt", "2학기 기말고사 수학(미적분Ⅰ) 범위\n\n1. 함수의 극한과 연속\n2. 미분계수와 도함수\n3. 도함수의 활용 (접선, 증가·감소, 극대·극소)\n\n자주 나오는 유형\n- 합성함수 미분 (속미분 빠뜨리지 않기!)\n- 극값 조건으로 미정계수 구하기\n- 평균값 정리 증명형 서술\n".encode("utf-8"), mj)
    eng_v1 = up("영어 에세이 채점 기준표.pdf", pdf("English Essay Rubric v1", ["# Content (5)", "Clear thesis and 2+ supporting ideas", "# Organization (3)", "Intro - Body - Conclusion", "# Language (2)", "Grammar and vocabulary"]), teacher)
    eng_v2 = up("영어 에세이 채점 기준표.pdf", pdf("English Essay Rubric v2 (수정)", ["# Content (5)", "Clear thesis and 2+ supporting ideas", "# Organization (3)", "Intro - Body - Conclusion, 250~300 words", "# Language (2)", "Grammar and vocabulary", "# 변경: 분량 기준 추가 (250~300 words)"]), teacher)
    info_png = up("정보 프로젝트 모둠 역할.png", png("정보 프로젝트 모둠 역할", ["기획·발표: 서연", "프로그래밍: 지호, 예준", "디자인·자료 조사: 하은, 민준"], (99, 102, 241)), sy)
    idea_png = up("실험 아이디어 스케치.png", png("실험 아이디어", ["레몬 전지로 LED 켜기", "전극: 구리판 + 아연판", "레몬 개수 ↑ → 전압 ↑ ?"], (254, 152, 0), (900, 520)), jh)

    def ev(title, day, cat, who, desc="", end=None, images=(), atts=(), editor=None):
        return c.execute("INSERT INTO es_events (scope, title, description, date, end_date, category, images, attachments, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                         (scope, title, desc, D(day), D(end) if end is not None else None, cat, json.dumps(list(images)), json.dumps(list(atts)), who, editor or who, t, t)).lastrowid

    e1 = ev("통합과학 실험 보고서 제출", 3, "performance", teacher, "산화 환원 실험 보고서를 **문서함 › 통합과학**에 올려 주세요.\n- 사진 1장 이상\n- 결과 해석 꼭 쓰기", atts=[sci_pdf])
    ev("수학 수행평가 (미적분 탐구 보고서)", 6, "performance", teacher, "주제: 우리 주변의 변화율 찾기. 채점 기준은 첨부 파일을 보세요.", atts=[math_pdf], editor=mj)
    ev("영어 모둠 발표", 9, "assignment", sy, "Lesson 5 주제로 모둠별 3분 발표. 발표 순서는 당일 추첨!")
    e4 = ev("반 단합대회 🎉", 12, "event", he, "체육관에서 피구 → 공지천 산책. 반티 꼭 입고 오기!", images=[poster])
    ev("국어 독서 기록장 검사", -2, "assignment", teacher, "1학기에 읽은 책 3권 기록")
    ev("정보 프로젝트 중간 점검", 16, "assignment", sy, "모둠별 진행 상황 2분 발표", atts=[info_png])
    ev("한국사 신문 만들기", 19, "performance", teacher, "근현대사 사건 하나를 골라 A3 신문으로", end=21)
    ev("체육복 입는 날 (교내 체육대회 연습)", 1, "event", yj)

    def com(target, who, text):
        c.execute("INSERT INTO es_comments (scope, target, author_id, text, created_at) VALUES (?, ?, ?, ?, ?)", (scope, target, who, text, t))

    com(f"event:{e1}", jh, "보고서에 그래프도 넣어야 하나요?")
    com(f"event:{e1}", teacher, "그래프는 선택이에요. 사진은 꼭 넣어 주세요!")
    com(f"event:{e4}", mj, "피구 팀은 번호 홀짝으로 나누자 ㅎㅎ")
    com(f"event:{e4}", he, "회비는 금요일까지 저한테 주세요~")

    m, s, info, k = subj["수학"], subj["통합과학"], subj["정보"], subj["국어"]
    _ = (idea_png,)

    def doc(sid, title, tag, versions):
        did = c.execute("INSERT INTO es_docs (scope, subject_id, title, tag, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", (scope, sid, title, tag, versions[0][1], t, t)).lastrowid
        for i, (fid, who, memo) in enumerate(versions):
            c.execute("INSERT INTO es_doc_versions (doc_id, file_id, version, memo, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?)", (did, fid, i + 1, memo, who, t))
        return did

    doc(m, "미적분 수행평가 안내", "수행평가", [(math_pdf, teacher, "처음 올림")])
    doc(m, "기말고사 범위와 기출 유형", "기출문제", [(math_txt, mj, "처음 올림")])
    doc(subj["영어"], "영어 에세이 채점 기준표", "수행평가", [(eng_v1, teacher, "처음 올림"), (eng_v2, teacher, "분량 기준 추가")])
    doc(s, "실험 보고서 양식", "수업자료", [(sci_pdf, teacher, "처음 올림")])
    doc(info, "모둠 역할 분담", "모둠과제", [(info_png, sy, "처음 올림")])

    def note(sid, title, content, who, editor):
        c.execute("INSERT INTO es_notes (scope, subject_id, title, content, version, created_by, last_edited_by, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)",
                  (scope, sid, title, content, who, editor, t, t))

    note(m, "미적분 개념 정리 (같이 채워요)", "# 미분계수와 도함수\n\n## 미분계수\n- f'(a) = lim (f(a+h) − f(a)) / h  (h → 0)\n- 뜻: x = a 에서 **접선의 기울기**\n\n## 합성함수의 미분\n- {f(g(x))}' = f'(g(x)) · g'(x)\n- 속미분 빠뜨리지 않기!\n\n## 할 일\n- [x] 극한 정리\n- [ ] 도함수의 활용 정리 (지호)\n- [ ] 기출 3개 풀이 (서연)\n", mj, sy)
    note(subj["영어"], "Lesson 5 단어장", "# Lesson 5 Words\n\n- **resilient** 회복력 있는\n- **inevitable** 피할 수 없는\n- **perspective** 관점\n- **contribute** 기여하다\n", sy, he)
    note(info, "프로젝트 회의록", "# 1차 회의\n\n- 주제: 급식 메뉴 추천 챗봇\n- 다음 회의까지: 나이스 API 키 신청 (예준)\n\n# 2차 회의\n- 화면 그리기 (하은)\n", sy, yj)
    note(k, "독서 토론 준비", "# 『아몬드』 토론 질문\n\n1. 감정을 배우는 것은 가능할까?\n2. 곤이와 윤재의 우정이 바뀐 계기는?\n", he, he)
    c.commit()


def seed_ink(c, scope, now_iso):
    """손필기 예시: 수학 '접선 그래프' 필기 노트 (손으로 그린 듯 살짝 흔들리게)."""
    import math
    import random

    rnd = random.Random(5)
    t = now_iso()
    r = c.execute("SELECT id FROM es_subjects WHERE scope = ? AND name = '수학'", (scope,)).fetchone()
    users = {x["name"]: x["id"] for x in c.execute("SELECT id, name FROM es_users WHERE school_code = ? AND demo = 0", (scope.split("-")[1],))}
    if not r:
        return
    sid = r["id"]
    who = users.get("민준"), users.get("서연"), users.get("지호")
    nid = c.execute("INSERT INTO es_notes (scope, subject_id, title, content, version, created_by, last_edited_by, created_at, updated_at, ink_pages, ink_bg) VALUES (?, ?, ?, '', 0, ?, ?, ?, ?, 2, 'grid')",
                    (scope, sid, "✏️ 접선 그래프 손필기", who[0], who[1], t, t)).lastrowid

    def jitter(pts, amt=1.2):
        return [[round(x + rnd.uniform(-amt, amt), 1), round(y + rnd.uniform(-amt, amt), 1), round(p, 2)] for x, y, p in pts]

    def line(x0, y0, x1, y1, n=24):
        return [[x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, 0.45 + 0.35 * math.sin(math.pi * i / n)] for i in range(n + 1)]

    def add(points, color, width, tool="pen", author=None):
        c.execute("INSERT INTO es_ink (note_id, page, data, author_id, created_at) VALUES (?, 0, ?, ?, ?)",
                  (nid, json.dumps({"tool": tool, "color": color, "width": width, "pts": jitter(points) if tool == "pen" else points}), author, t))

    ox, oy, k = 470, 1000, 70  # 원점, 한 칸 크기
    add(line(130, oy, 880, oy), "#191f28", 3, author=who[0])           # x축
    add(line(ox, 1260, ox, 360), "#191f28", 3, author=who[0])          # y축
    add(line(865, oy - 14, 885, oy) + line(885, oy, 865, oy + 14, 6), "#191f28", 3, author=who[0])
    add(line(ox - 14, 375, ox, 355) + line(ox, 355, ox + 14, 375, 6), "#191f28", 3, author=who[0])
    para = [[ox + x * k, oy - x * x * k * 0.55, 0.55 + 0.3 * math.cos(x / 2)] for x in [i / 10 - 4 for i in range(81)]]
    add(para, "#3182f6", 4, author=who[0])                              # y = x² 비슷한 곡선
    a = 1.6
    ax, ay, slope = ox + a * k, oy - a * a * k * 0.55, -2 * a * 0.55     # 접선 (기울기 2a)
    add(line(ax - 260, ay - slope * 260, ax + 280, ay + slope * 280, 30), "#f04452", 3.2, author=who[1])
    circ = [[ax + 13 * math.cos(i / 12 * 2 * math.pi), ay + 13 * math.sin(i / 12 * 2 * math.pi), 0.7] for i in range(13)]
    add(circ, "#f04452", 3.5, author=who[1])                            # 접점 동그라미
    add([[110 + i * 30, 205, 0.5] for i in range(23)], "#ffe066", 26, "hl", who[2])    # 형광펜
    add([[600 + 40 * math.cos(i / 20 * 2 * math.pi) * 2.6, 600 + 40 * math.sin(i / 20 * 2 * math.pi), 0.6] for i in range(21)], "#15c47e", 2.6, author=who[2])
    c.commit()


def seed_classroom(c, scope, now_iso, today):
    """클래스룸 예시: 공지·과제·질문·자료, 친구들 제출물(제출·늦음·안 냄·채점 완료)."""
    from datetime import datetime, timedelta

    t = now_iso()
    users = {x["name"]: x["id"] for x in c.execute("SELECT id, name FROM es_users WHERE school_code = ? AND grade = ? AND class_num = ? AND demo = 0",
                                                   (scope.split("-")[1], int(scope.split("-")[2]), int(scope.split("-")[3])))}
    T = users.get("담임 선생님")
    st = [users.get(n) for n in ("민준", "서연", "지호", "하은", "예준")]
    subj = {r["name"]: r["id"] for r in c.execute("SELECT id, name FROM es_subjects WHERE scope = ?", (scope,))}
    files = {r["name"]: r["id"] for r in c.execute("SELECT id, name FROM es_files WHERE scope = ?", (scope,))}
    if not T or not all(st):
        return

    def at(days, hm="23:59"):
        return (today + timedelta(days=days)).isoformat() + "T" + hm

    def ts(days, hm="20:10"):
        return at(days, hm) + ":00"

    def post(sid, text, who, days, atts=()):
        return c.execute("INSERT INTO es_posts (scope, subject_id, text, attachments, author_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                         (scope, sid, text, json.dumps([files[a] for a in atts if a in files]), who, ts(days, "08:30"), ts(days, "08:30"))).lastrowid

    def cw(sid, kind, title, ins, topic, days_ago, due=None, points=None, atts=(), q=None):
        return c.execute("INSERT INTO es_cw (scope, subject_id, kind, topic, title, instructions, points, due, attachments, question, author_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                         (scope, sid, kind, topic, title, ins, points, due, json.dumps([files[a] for a in atts if a in files]), json.dumps(q) if q else "", T, ts(-days_ago, "09:00"), ts(-days_ago, "09:00"))).lastrowid

    def sub(cid, who, text="", atts=(), answer=None, sub_days=None, grade=None, returned=False):
        c.execute("INSERT INTO es_subs (scope, cw_id, student_id, text, attachments, answer, submitted_at, returned_at, grade, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                  (scope, cid, who, text, json.dumps([files[a] for a in atts if a in files]), json.dumps(answer) if answer is not None else "",
                   ts(sub_days) if sub_days is not None else None, ts(sub_days + 1, "09:00") if returned and sub_days is not None else (ts(0, "07:00") if returned else None), grade, t))

    def com(target, who, text, days=0):
        c.execute("INSERT INTO es_comments (scope, target, author_id, text, created_at) VALUES (?, ?, ?, ?, ?)", (scope, target, who, text, ts(days, "21:00")))

    # 수학
    m = subj["수학"]
    p1 = post(m, "📢 다음 주 월요일까지 미적분 탐구 보고서 주제를 정해 오세요. 주제가 겹치면 먼저 정한 사람이 우선이에요!", T, -2)
    com(f"post:{p1}", st[3], "춘천 기온 변화율로 해도 될까요?", -2)
    com(f"post:{p1}", T, "좋아요! 기상청 자료 출처만 꼭 써 주세요.", -1)
    post(m, "기말고사 범위 정리 자료 올렸어요. 수업 과제 › 자료에서 확인하세요.", T, -1, ["미적분 수행평가 안내.pdf"])
    a1 = cw(m, "assignment", "미적분 탐구 보고서", "우리 주변에서 '변화율'을 찾아 A4 2쪽 이내로 보고서를 써 주세요.\n- 그래프 1개 이상\n- 참고 자료 출처 쓰기\n- PDF로 올리기", "수행평가", 7, at(5), 15, ["미적분 수행평가 안내.pdf"])
    a2 = cw(m, "assignment", "도함수 활용 연습문제 1~20번", "교과서 p.82~85 문제를 풀고 사진으로 찍어 올려 주세요.", "과제", 9, at(-2, "22:00"), 10)
    q1 = cw(m, "question", "합성함수 미분, 얼마나 이해했나요?", "솔직하게 골라 주세요. 다음 수업 진도에 반영할게요.", "과제", 1, at(2), None, (),
            {"type": "choice", "options": ["완벽하게 이해했어요", "대충 알 것 같아요", "아직 헷갈려요", "전혀 모르겠어요"], "showAnswers": True})
    cw(m, "material", "기말고사 범위와 기출 유형", "범위: 함수의 극한 ~ 도함수의 활용", "자료", 3, None, None, ["기말고사 범위와 기출 유형.txt"])
    sub(a2, st[0], "다 풀었어요!", ["실험 아이디어 스케치.png"], sub_days=-3, grade=10, returned=True)
    sub(a2, st[1], "", ["정보 프로젝트 모둠 역할.png"], sub_days=-1, grade=8, returned=True)  # 늦게 냄
    sub(a2, st[3], "15번은 잘 모르겠어요", [], sub_days=-3)
    sub(a1, st[1], "주제: 코로나 이후 춘천 인구 변화율", ["미적분 수행평가 안내.pdf"], sub_days=-1)
    for i, who in enumerate(st[:4]):
        sub(q1, who, answer=[0, 1, 2, 1][i], sub_days=0)
    com(f"cw:{a1}", st[2], "2쪽 넘으면 감점인가요?", -1)
    com(f"cw:{a1}", T, "조금 넘는 건 괜찮아요. 핵심만 담아 주세요.", -1)
    # 통합과학
    s = subj["통합과학"]
    post(s, "🧪 실험 보고서 양식을 꼭 지켜 주세요. 사진은 직접 찍은 것만!", T, -3, ["통합과학 실험 보고서 양식.pdf"])
    a3 = cw(s, "assignment", "산화 환원 실험 보고서", "양식에 맞춰 작성하고 사진 1장 이상 넣어 주세요.", "실험", 5, at(3), 20, ["통합과학 실험 보고서 양식.pdf"])
    q2 = cw(s, "question", "철 수세미를 황산구리 수용액에 넣으면 어떤 변화가 생길까요?", "한두 문장으로 써 주세요.", "생각 열기", 2, at(1), 5, (), {"type": "short", "showAnswers": True})
    cw(s, "material", "실험 보고서 양식", "", "자료", 6, None, None, ["통합과학 실험 보고서 양식.pdf"])
    sub(a3, st[0], "", ["통합과학 실험 보고서 양식.pdf"], sub_days=-1)
    sub(q2, st[1], answer="철이 녹아 수용액 색이 옅어지고 수세미 겉에 붉은 구리가 생겨요.", sub_days=-1, grade=5, returned=True)
    sub(q2, st[4], answer="파란색이 옅어질 것 같아요.", sub_days=0)
    # 영어·국어
    e = subj["영어"]
    post(e, "Lesson 5 단어 시험은 다음 주 화요일이에요. Good luck! 🍀", T, -1)
    cw(e, "assignment", "My Role Model 에세이", "250~300 words. 채점 기준표를 참고하세요.", "수행평가", 4, at(8), 10, ["영어 에세이 채점 기준표.pdf"])
    k = subj["국어"]
    a4 = cw(k, "assignment", "독서 기록장 (1학기 3권)", "읽은 책 3권의 줄거리와 느낀 점", "수행평가", 12, at(-1), 10)
    sub(a4, st[3], "아몬드, 페인트, 시선으로부터", [], sub_days=-2, grade=9, returned=True)
    c.commit()
    _ = datetime
