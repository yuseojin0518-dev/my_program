/* 과목별 공유 문서함: 끌어다 놓아 올리기, 태그·검색, 미리보기, 버전 관리 */
(function () {
  "use strict";
  const A = window.App, esc = A.esc, D = A.drawer;
  const TAGS = ["수행평가", "수업자료", "기출문제", "모둠과제", "기타"];
  const S = (A.docs = { sid: null, list: [], tag: "전체", q: "", view: localStorage.getItem("es.docView") || "list" });
  const PREVIEW = ["pdf", "png", "jpg", "jpeg", "gif", "webp", "txt", "md", "csv"];

  A.views.docs = {
    async load() {
      if (!A.route.sid) { if (A.subjectsStale || !A.subjects.length) await A.loadSubjects(); return; }
      if (!A.subject(A.route.sid)) await A.loadSubjects();
      if (!A.subject(A.route.sid)) throw new Error("과목을 찾을 수 없어요.");
      if (S.sid !== A.route.sid) { S.tag = "전체"; S.q = ""; }
      S.sid = A.route.sid;
      S.list = (await A.api("/api/docs?subject=" + S.sid)).docs;
    },
    render() {
      if (!A.route.sid) return A.subjectGrid("docs", "공유 문서함", "수업 유인물, 수행평가 안내문, 모둠 발표 자료를 과목별로 모아요.");
      const s = A.subject(S.sid);
      const count = (t) => S.list.filter((d) => t === "전체" || d.tag === t).length;
      const q = S.q.trim().toLowerCase();
      const list = S.list.filter((d) => (S.tag === "전체" || d.tag === S.tag) && (!q || (d.title + " " + (d.file ? d.file.name : "") + " " + d.uploadedBy.name).toLowerCase().includes(q)));
      return A.subjectHead("docs", s, A.canWrite() ? `<button class="btn primary" data-act="docUpload">⬆ 파일 올리기</button>` : "") +
        `<div class="doc-tools">
          <div class="tags" role="group" aria-label="태그">${["전체"].concat(TAGS).map((t) => `<button class="tagf ${S.tag === t ? "on" : ""}" data-act="docTag" data-v="${t}" aria-pressed="${S.tag === t}">#${t} <small>${count(t)}</small></button>`).join("")}</div>
          <div class="row gap"><input class="search" type="search" placeholder="🔍 파일 이름·올린 사람 검색" value="${esc(S.q)}" data-in="docQ" aria-label="문서 검색">
          <div class="seg sm" role="group" aria-label="보기">${[["list", "☰"], ["grid", "▦"]].map(([k, l]) => `<button class="${S.view === k ? "on" : ""}" data-act="docView" data-v="${k}" aria-label="${k === "list" ? "목록" : "바둑판"}으로 보기">${l}</button>`).join("")}</div></div>
        </div>
        ${A.canWrite() ? `<div class="drop" id="drop" data-act="docUpload" role="button" tabindex="0"><span>📂</span><b>여기에 파일을 끌어다 놓거나 눌러서 올리세요</b><small>PDF · 한글(HWP) · 워드 · PPT · 엑셀 · 사진 · ZIP · 10MB까지</small></div>` : ""}
        <div id="doc-list">${listHtml(list)}</div>`;
    },
    after() { bindDrop(); },
    onChanged(kind, id) {
      if (kind !== "docs" || !A.route.sid) return;
      A.views.docs.load().then(() => {
        if (A.route.tab === "docs") { const l = A.$("#doc-list"); if (l) A.renderMain(); }
        if (D.key === "doc:" + id) openDoc(id, true);
      });
    },
  };

  function listHtml(list) {
    if (!list.length) return `<div class="empty-state"><span>📁</span><p>${S.list.length ? "찾는 문서가 없어요." : "아직 올라온 문서가 없어요."}</p></div>`;
    if (S.view === "grid") return `<div class="doc-grid">${list.map((d) => `<button class="dg" data-act="docOpen" data-id="${d.id}">
        ${d.file && d.file.image ? `<img src="${esc(d.file.url)}" alt="" loading="lazy">` : `<span class="dg-ico">${A.fileIcon(d.file ? d.file.type : "")}</span>`}
        <b>${esc(d.title)}</b><small>#${esc(d.tag)} · ${esc(d.uploadedBy.name)} · ${A.ago(d.updatedAt)}</small>${A.canWrite() && A.isMine(d.createdBy) ? `<span class="dg-del" data-act="docDelId" data-id="${d.id}" data-t="${esc(d.title)}" role="button" tabindex="0" aria-label="${esc(d.title)} 지우기">🗑</span>` : ""}</button>`).join("")}</div>`;
    return `<div class="table" role="table" aria-label="문서 목록">
      <div class="tr th" role="row"><span role="columnheader">이름</span><span role="columnheader">태그</span><span role="columnheader">올린 사람</span><span role="columnheader">날짜</span><span role="columnheader">크기</span><span role="columnheader"></span></div>
      ${list.map((d) => `<div class="tr" role="row">
        <button class="td name" role="cell" data-act="docOpen" data-id="${d.id}"><span class="f-ico">${A.fileIcon(d.file ? d.file.type : "")}</span><span><b>${esc(d.title)}</b><small>${esc(d.file ? d.file.name : "")}${d.version > 1 ? ` · <span class="ver">v${d.version}</span>` : ""}${d.comments ? ` · 💬${d.comments}` : ""}</small></span></button>
        <span class="td" role="cell"><span class="tagb">#${esc(d.tag)}</span></span>
        <span class="td who" role="cell">${A.avatar(d.uploadedBy, "sm")}${esc(d.uploadedBy.name)}</span>
        <span class="td muted" role="cell">${A.ago(d.updatedAt)}</span>
        <span class="td muted" role="cell">${d.file ? A.size(d.file.size) : ""}</span>
        <span class="td act" role="cell">${d.file && PREVIEW.includes(d.file.type) ? `<button class="btn small" data-act="docOpen" data-id="${d.id}">미리보기</button>` : ""}${d.file ? `<a class="btn small" href="${esc(d.file.url)}?dl=1" download aria-label="${esc(d.title)} 받기">받기</a>` : ""}${A.canWrite() && A.isMine(d.createdBy) ? `<button class="btn small danger" data-act="docDelId" data-id="${d.id}" data-t="${esc(d.title)}" aria-label="${esc(d.title)} 지우기">🗑</button>` : ""}</span>
      </div>`).join("")}</div>`;
  }

  A.acts.docTag = (el) => { S.tag = el.dataset.v; A.renderMain(); };
  A.acts.docView = (el) => { S.view = el.dataset.v; localStorage.setItem("es.docView", S.view); A.renderMain(); };
  let qT = 0;
  A.inputs.docQ = (el) => {
    S.q = el.value; clearTimeout(qT);
    qT = setTimeout(() => {
      const q = S.q.trim().toLowerCase();
      const list = S.list.filter((d) => (S.tag === "전체" || d.tag === S.tag) && (!q || (d.title + " " + (d.file ? d.file.name : "") + " " + d.uploadedBy.name).toLowerCase().includes(q)));
      A.$("#doc-list").innerHTML = listHtml(list);
    }, 120);
  };

  // 끌어다 놓기
  function bindDrop() {
    const main = A.$("#main"), drop = A.$("#drop");
    if (!drop || main.dataset.dropBound) return;
    main.dataset.dropBound = "1";
    main.addEventListener("dragover", (ev) => { if (A.route.tab !== "docs" || !A.route.sid) return; ev.preventDefault(); const d = A.$("#drop"); if (d) d.classList.add("over"); });
    main.addEventListener("dragleave", (ev) => { if (ev.target === main || ev.target.id === "drop") { const d = A.$("#drop"); if (d) d.classList.remove("over"); } });
    main.addEventListener("drop", (ev) => {
      if (A.route.tab !== "docs" || !A.route.sid) return;
      ev.preventDefault();
      const d = A.$("#drop"); if (d) d.classList.remove("over");
      const files = Array.from(ev.dataTransfer.files || []);
      if (files.length && A.canWrite()) uploadModal(files);
    });
  }

  // 올리기 창
  A.acts.docUpload = () => uploadModal([]);
  function guessTag(name) {
    if (/수행|평가|채점|안내/.test(name)) return "수행평가";
    if (/기출|문제|시험|범위/.test(name)) return "기출문제";
    if (/모둠|조별|발표|역할/.test(name)) return "모둠과제";
    if (/유인물|학습지|자료|수업|양식/.test(name)) return "수업자료";
    return "기타";
  }
  function uploadModal(files) {
    A.upFiles = files.slice();
    A.modal(`<h2>파일 올리기</h2><p class="muted">${esc(A.subject(S.sid).name)} 문서함에 올라가요. 반 친구들 화면에 바로 보여요.</p>
      <label class="drop small" id="up-drop"><input type="file" multiple accept="${A.ACCEPT}" hidden data-ch="upPick"><span>📂</span><b>파일 고르기</b><small>또는 여기로 끌어다 놓기</small></label>
      <ul class="up-list" id="up-list"></ul>
      <div class="dlg-btns"><button class="btn" data-act="closeModal">취소</button><button class="btn primary" data-act="upGo" id="up-go">올리기</button></div>`, "wide");
    const box = A.$("#up-drop");
    box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("over"); });
    box.addEventListener("dragleave", () => box.classList.remove("over"));
    box.addEventListener("drop", (e) => { e.preventDefault(); box.classList.remove("over"); A.upFiles.push(...Array.from(e.dataTransfer.files || [])); paintUp(); });
    paintUp();
  }
  function paintUp() {
    const ul = A.$("#up-list"); if (!ul) return;
    ul.innerHTML = A.upFiles.map((f, i) => `<li><span class="f-ico">${A.fileIcon((f.name.split(".").pop() || "").toLowerCase())}</span>
      <span class="up-m"><input data-i="${i}" class="up-title" maxlength="60" value="${esc(f.name.replace(/\.[^.]+$/, ""))}" aria-label="제목"><small>${esc(f.name)} · ${A.size(f.size)}${f.size > 10485760 ? ' · <b class="err">10MB 넘음</b>' : ""}</small></span>
      <select class="up-tag" data-i="${i}" aria-label="태그">${TAGS.map((t) => `<option ${t === guessTag(f.name) ? "selected" : ""}>${t}</option>`).join("")}</select>
      <button class="icon-btn sm" data-act="upDel" data-i="${i}" aria-label="빼기">✕</button></li>`).join("");
    A.$("#up-go").disabled = !A.upFiles.length;
    A.$("#up-go").textContent = A.upFiles.length ? `${A.upFiles.length}개 올리기` : "올리기";
  }
  A.changes.upPick = (el) => { A.upFiles.push(...Array.from(el.files || [])); el.value = ""; paintUp(); };
  A.acts.upDel = (el) => { A.upFiles.splice(Number(el.dataset.i), 1); paintUp(); };
  A.acts.upGo = async (el) => {
    el.disabled = true;
    const titles = A.$$(".up-title").map((x) => x.value), tags = A.$$(".up-tag").map((x) => x.value);
    let ok = 0;
    for (let i = 0; i < A.upFiles.length; i++) {
      const f = A.upFiles[i];
      el.textContent = `올리는 중… (${i + 1}/${A.upFiles.length})`;
      if (f.size > 10485760) { A.toast(`${f.name}: 10MB까지 올릴 수 있어요.`, "err"); continue; }
      const fd = new FormData(); fd.append("subject", S.sid); fd.append("title", titles[i] || ""); fd.append("tag", tags[i] || "기타"); fd.append("file", f);
      try { await A.api("/api/docs", { method: "POST", form: fd }); ok++; } catch (e) { A.toast(`${f.name}: ${e.message}`, "err"); }
    }
    A.closeModal();
    if (ok) A.toast(`${ok}개를 올렸어요.`);
    await A.views.docs.load(); A.renderMain();
  };

  // 상세 (미리보기·버전)
  A.acts.docOpen = (el) => openDoc(Number(el.dataset.id));
  async function openDoc(id, refresh) {
    let d;
    try { [d] = await Promise.all([A.api("/api/docs/" + id), A.loadComments("doc:" + id)]); }
    catch (e) { if (refresh) { D.close(); A.toast("이 문서가 지워졌어요."); } else A.toast(e.message, "err"); return; }
    A.curDoc = d;
    const f = d.file;
    const preview = !f ? "" : f.image ? `<button class="pv img" data-act="lightbox" data-src="${esc(f.url)}"><img src="${esc(f.url)}" alt="${esc(d.title)}"></button>`
      : f.type === "pdf" ? `<iframe class="pv pdf" src="${esc(f.url)}" title="${esc(d.title)} 미리보기"></iframe>`
      : ["txt", "md", "csv"].includes(f.type) ? `<pre class="pv txt" id="pv-txt">불러오는 중…</pre>`
      : `<div class="pv none"><span>${A.fileIcon(f.type)}</span><p>${esc(f.type.toUpperCase())} 파일은 브라우저에서 미리 볼 수 없어요.<br>받아서 열어 주세요.</p></div>`;
    D.onChanged = async (kind, tid) => { if (kind === "comments" && tid === "doc:" + d.id) { await A.loadComments("doc:" + d.id); A.paintComments(); } };
    const render = () => `<div class="dr-top"><span class="tagb">#${esc(d.tag)}</span><span class="sp-f"></span>
        ${A.canWrite() && A.isMine(d.createdBy) ? `<button class="btn small danger" data-act="docDel">🗑 지우기</button>` : ""}<button class="icon-btn" data-act="closeDrawer" aria-label="닫기">✕</button></div>
      <h2 class="dr-title">${esc(d.title)}</h2>
      <p class="dr-date">${f ? `${A.fileIcon(f.type)} ${esc(f.name)} · ${A.size(f.size)} · ` : ""}v${d.version}</p>
      ${preview}
      <div class="row gap wrapr">${f ? `<a class="btn primary" href="${esc(f.url)}?dl=1" download>⬇ 받기</a>${PREVIEW.includes(f.type) ? `<a class="btn" href="${esc(f.url)}" target="_blank" rel="noopener">새 탭에서 열기</a>` : ""}` : ""}
        ${A.canWrite() ? `<label class="btn">⬆ 새 버전 올리기<input type="file" hidden accept="${A.ACCEPT}" data-ch="docVer"></label>` : ""}</div>
      ${A.canWrite() ? `<div class="fld inline"><span>태그</span><div class="tags">${TAGS.map((t) => `<button class="tagf ${t === d.tag ? "on" : ""}" data-act="docRetag" data-v="${t}">#${t}</button>`).join("")}</div></div>` : ""}
      <h3>버전 기록 ${d.versions.length}</h3>
      <ol class="vers">${d.versions.map((v, i) => `<li class="${i === 0 ? "cur" : ""}"><span class="vn">v${v.version}</span><span class="vm"><b>${esc(v.memo || (i === 0 ? "최신" : ""))}</b><small>${esc(v.uploadedBy.name)} · ${A.ago(v.createdAt)} · ${v.file ? A.size(v.file.size) : ""}</small></span>${v.file ? `<a class="btn small" href="${esc(v.file.url)}?dl=1" download>받기</a>` : ""}</li>`).join("")}</ol>
      ${A.commentsHtml()}`;
    if (D.key === "doc:" + id) { D.render = render; D.paint(); } else D.open("doc:" + id, render);
    if (f && ["txt", "md", "csv"].includes(f.type)) {
      fetch(f.url, { credentials: "same-origin" }).then((r) => r.text()).then((t) => { const el = A.$("#pv-txt"); if (el) el.textContent = t.slice(0, 20000); }).catch(() => {});
    }
  }
  A.changes.docVer = async (el) => {
    const f = el.files && el.files[0]; if (!f) return;
    const memo = prompt("무엇이 바뀌었나요? (선택)", "") || "";
    const fd = new FormData(); fd.append("file", f); fd.append("memo", memo);
    try { await A.api(`/api/docs/${A.curDoc.id}/versions`, { method: "POST", form: fd }); A.toast("새 버전을 올렸어요."); openDoc(A.curDoc.id, true); A.views.docs.load().then(() => A.renderMain()); }
    catch (e) { A.toast(e.message, "err"); }
  };
  A.acts.docRetag = async (el) => {
    try { await A.api("/api/docs/" + A.curDoc.id, { method: "PATCH", body: { tag: el.dataset.v, title: A.curDoc.title } }); openDoc(A.curDoc.id, true); A.views.docs.load().then(() => A.renderMain()); }
    catch (e) { A.toast(e.message, "err"); }
  };
  A.acts.docDelId = async (el, ev) => {
    ev.stopPropagation();
    if (!(await A.confirm(`'${el.dataset.t}' 문서를 지울까요?`, "모든 버전과 댓글이 함께 사라지고 되돌릴 수 없어요."))) return;
    try { await A.api("/api/docs/" + el.dataset.id, { method: "DELETE" }); if (A.drawer.key === "doc:" + el.dataset.id) A.drawer.close(); A.toast("문서를 지웠어요."); await A.views.docs.load(); A.renderMain(); }
    catch (e) { A.toast(e.message, "err"); }
  };
  A.acts.docDel = async () => {
    if (!(await A.confirm("이 문서를 지울까요?", "모든 버전이 함께 사라져요."))) return;
    try { await A.api("/api/docs/" + A.curDoc.id, { method: "DELETE" }); D.close(); A.toast("지웠어요."); A.views.docs.load().then(() => A.renderMain()); }
    catch (e) { A.toast(e.message, "err"); }
  };
})();
