/* 校内 / 商业两个提交表单共用。页面通过 window.FORM_CONFIG 提供差异。 */
(function () {
  const cfg = window.FORM_CONFIG;
  const $ = (id) => document.getElementById(id);

  let cycles = [];
  let files = [];

  const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function chipHtml(list) {
    return list.map((t, i) =>
      '<input type="radio" name="type" id="t' + i + '" value="' + esc(t) + '"' + (i === 0 ? " checked" : "") + '><label for="t' + i + '">' + esc(t) + "</label>"
    ).join("");
  }

  function cycleOf(type) {
    return cycles.find(c => c.type === type) || null;
  }

  function daysLeft() {
    const v = $("deadline").value;
    if (!v) return null;
    const t = new Date(v + "T23:59:59");
    if (isNaN(t.getTime())) return null;
    return (t.getTime() - Date.now()) / 86400000;
  }

  function updateHint() {
    const box = $("cycleHint");
    const type = document.querySelector('input[name=type]:checked')?.value;
    const item = cycleOf(type);
    const left = daysLeft();

    if (!item) { box.className = "hintbox"; return; }

    if (!item.days) {
      box.className = "hintbox show info";
      box.innerHTML = "「" + esc(item.label) + "」的工期需要按具体内容商谈，我们会联系你确认。";
      return;
    }

    if (left === null) {
      box.className = "hintbox show info";
      box.innerHTML = "「" + esc(item.label) + "」建议至少预留 <b>" + esc(item.text) + "</b>（" + item.days + " 天）。填了期望日期后，这里会提醒时间是否够。";
      return;
    }

    const shownDays = Math.max(0, Math.ceil(left));
    if (left < item.days) {
      box.className = "hintbox show warn";
      const short = Math.max(1, Math.round(item.days - left));
      box.innerHTML = "⚠ 距期望日期只剩 <b>" + shownDays + " 天</b>，「" + esc(item.label) + "」一般需要 <b>" + esc(item.text) + "</b>，少了约 " + short + " 天。仍然可以提交，系统会自动标记为<b>加急</b>，我们会优先处理。";
    } else {
      box.className = "hintbox show ok";
      box.innerHTML = "✓ 时间充裕：距期望日期 " + shownDays + " 天，「" + esc(item.label) + "」一般需要 " + esc(item.text) + "。";
    }
  }

  function renderFiles() {
    $("filelist").innerHTML = files.map((f, i) =>
      '<li><span class="nm">' + esc(f.name) + '</span><span class="sz">' + fmtSize(f.size) + '</span><button type="button" class="rm" data-i="' + i + '">×</button></li>'
    ).join("");
    $("filelist").querySelectorAll(".rm").forEach(b => b.onclick = () => { files.splice(+b.dataset.i, 1); renderFiles(); });
  }

  function addFiles(list) {
    for (const f of list) {
      if (files.length >= 6) { alert("最多上传 6 个文件"); break; }
      if (f.size > 25 * 1024 * 1024) { alert(f.name + " 超过 25MB，已跳过"); continue; }
      if (files.some(x => x.name === f.name && x.size === f.size)) continue;
      files.push(f);
    }
    renderFiles();
  }

  function showErr(m) {
    const err = $("err");
    err.textContent = m;
    err.style.display = "block";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function init() {
    try {
      const data = await fetch("/api/cycles").then(r => r.json());
      cycles = data.items || [];
    } catch { cycles = []; }

    const types = cfg.types && cfg.types.length ? cfg.types : cycles.map(c => c.type);
    $("typeChips").innerHTML = chipHtml(types);

    document.querySelectorAll('input[name=type]').forEach(r => r.onchange = updateHint);
    $("deadline").onchange = updateHint;
    updateHint();

    const fileInput = $("file");
    const drop = $("drop");
    fileInput.onchange = () => { addFiles(fileInput.files); fileInput.value = ""; };
    drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); addFiles(e.dataTransfer.files); };

    $("form").onsubmit = async (e) => {
      e.preventDefault();
      $("err").style.display = "none";
      const btn = $("submit");
      const fd = new FormData();
      fd.append("channel", cfg.channel);
      for (const el of $("form").querySelectorAll("[name]")) {
        if (el.type === "radio") { if (el.checked) fd.append(el.name, el.value); }
        else if (el.type === "file") { /* 单独处理 */ }
        else fd.append(el.name, el.value);
      }
      for (const f of files) fd.append("files", f);

      btn.disabled = true;
      btn.textContent = "提交中…";
      try {
        const r = await fetch("/api/orders", { method: "POST", body: fd });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "提交失败");
        $("form").style.display = "none";
        $("done").style.display = "";
        $("orderId").textContent = data.order.id;
        if (data.order.urgent) $("urgentNote").style.display = "block";
        window.scrollTo({ top: 0 });
      } catch (ex) {
        showErr(ex.message);
      } finally {
        btn.disabled = false;
        btn.textContent = "提交需求";
      }
    };

    $("again").onclick = () => {
      $("form").reset();
      files = [];
      renderFiles();
      $("done").style.display = "none";
      $("form").style.display = "";
      $("orderId").textContent = "—";
      $("urgentNote").style.display = "none";
      updateHint();
      window.scrollTo({ top: 0 });
    };
  }

  init();
})();
