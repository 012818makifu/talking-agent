(() => {
  const el = id => document.getElementById(id);
  const labels = { time: "提供時間", how: "取得方式", who: "服務對象", item: "服務內容" };
  const practice = { name: "練習用供餐站", time: "週一至週五供餐", how: "現場領取", who: "社區學童", item: "午餐一份" };
  const example = "暑假期間每週一、三、五供餐，須事先登記。";
  const keyFor = (county, district, name) => JSON.stringify([county, district, name]);
  const prefix = "child-map-review-v1:";
  const records = new Map();
  let published = {}, loaded = false;
  function read(key) {
    if (!records.has(key)) {
      let saved;
      try { saved = JSON.parse(localStorage.getItem(prefix + key)); } catch {}
      records.set(key, saved || published[key] || { fields: {}, notice: "" });
    }
    return records.get(key);
  }
  window.reviewedResource = (c, d, r) => ({ ...r, ...read(keyFor(c, d, r.name)).fields });
  const demo = () => el("updateMode").value === "demo";
  const key = () => demo() ? "practice" : keyFor(el("uc").value, el("ud").value, el("ur").value);
  let resourceList = [], pending = null, generation = 0;
  const cache = new Map();
  const normalize = text => text.trim().replace(/\s+/g, " ");
  const current = () => demo() ? { ...practice, ...read(key()).fields } : resourceList.find(r => r.name === el("ur").value);
  function append(parent, tag, text) {
    const node = document.createElement(tag);
    node.textContent = text;
    parent.append(node);
    return node;
  }
  function clearReview() {
    generation++;
    pending = null;
    el("approval").hidden = true;
    el("compare").disabled = false;
    el("reviewStatus").textContent = "";
  }
  function refresh() {
    clearReview();
    const r = current();
    const dl = el("currentFields");
    dl.replaceChildren();
    if (!r) return;
    for (const [field, label] of Object.entries(labels)) {
      append(dl, "dt", label);
      append(dl, "dd", r[field] || "未列出");
    }
    el("originalLink").hidden = !r.url;
    if (r.url) el("originalLink").href = r.url;
    el("notice").value = demo() ? example : read(key()).notice;
  }
  function loadResources() {
    resourceList = resourcesFor(el("uc").value, el("ud").value);
    el("ur").replaceChildren(...resourceList.map(r => new Option(r.name, r.name)));
    refresh();
  }
  function loadDistricts() {
    el("ud").replaceChildren(...TOWNS[el("uc").value].map(d => new Option(d, d)));
    loadResources();
  }
  fillCounties(el("uc"));
  el("uc").onchange = loadDistricts;
  el("ud").onchange = loadResources;
  el("ur").onchange = refresh;
  el("updateMode").onchange = () => {
    el("realResource").hidden = el("liveControls").hidden = demo();
    el("resetPractice").hidden = !demo();
    el("compare").textContent = demo() ? "免費示範比對" : "比對公告，有變更才送 Claude";
    if (demo()) refresh(); else loadDistricts();
  };
  el("openUpdates").onclick = () => {
    simpleCrumb(el("ucrumb"), "公告更新與審核");
    setView("updates");
  };
  el("notice").oninput = clearReview;
  el("resetPractice").onclick = () => {
    try { localStorage.removeItem(prefix + "practice"); } catch {}
    records.delete("practice");
    refresh();
  };
  el("discard").onclick = () => {
    clearReview();
    el("reviewStatus").textContent = "已取消，資源內容維持原版本。";
  };
  el("compare").onclick = async () => {
    clearReview();
    const version = generation;
    const r = current(), id = key(), notice = el("notice").value.trim();
    const previous = read(id).notice || (demo() ? "週一至週五供餐，現場領取。" : "");
    const status = el("reviewStatus");
    if (!r || !notice) { status.textContent = "請選擇資源並貼入新公告。"; return; }
    if (normalize(notice) === normalize(previous)) {
      status.textContent = "公告沒有變更，本次未呼叫 AI。"; return;
    }
    const fields = Object.fromEntries(Object.keys(labels).map(k => [k, r[k] || ""]));
    const cacheKey = JSON.stringify([id, fields, notice]);
    let changes = cache.get(cacheKey);
    el("compare").disabled = true;
    try {
      if (demo()) {
        if (notice !== example) throw new Error("免費示範使用固定公告。按「重設練習案例」即可重播。");
        changes = [
          { field:"time", value:"暑假期間每週一、三、五供餐", quote:"暑假期間每週一、三、五供餐" },
          { field:"how", value:"須事先登記後現場領取", quote:"須事先登記" }
        ].filter(c => c.value !== fields[c.field]);
      } else if (!changes) {
        status.textContent = "正在分析這一筆公告…";
        const res = await fetch("/api/child-map/review", {
          method:"POST", headers:{"Content-Type":"application/json","x-map-password":el("reviewPassword").value},
          body:JSON.stringify({ name:r.name, current:fields, previous, notice }), signal:AbortSignal.timeout(32000),
        });
        const data = await res.json();
        if (!res.ok || !Array.isArray(data.changes)) throw new Error(data.error || "分析未完成。");
        changes = data.changes;
        cache.set(cacheKey, changes);
      }
      if (version !== generation) return;
      pending = { id, notice, changes, base:read(id) };
      const list = el("suggestions");
      list.replaceChildren();
      for (const c of changes) {
        const article = append(list, "article", "");
        const label = append(article, "label", "");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox"; checkbox.value = c.field;
        label.append(checkbox, " 採用「" + labels[c.field] + "」的變更");
        append(article, "p", "原資料：" + (fields[c.field] || "未列出"));
        append(article, "p", "建議更新：" + c.value);
        append(article, "p", "公告原句：「" + c.quote + "」");
      }
      el("approval").hidden = false;
      status.textContent = (demo() ? "預設示範，未呼叫 AI。" : "公告比對完成。") + (changes.length ? "請核對原句，勾選要採用的欄位。" : "沒有欄位需要修改，可儲存這次審核。");
    } catch (e) {
      if (version === generation) status.textContent = e.message || "未能完成分析，請重試。";
    } finally {
      if (version === generation) el("compare").disabled = false;
    }
  };
  el("approve").onclick = () => {
    if (!pending || pending.id !== key() || pending.notice !== el("notice").value.trim()) return;
    const { id, notice, changes, base } = pending;
    const checked = new Set([...el("suggestions").querySelectorAll("input:checked")].map(i => i.value));
    const fields = {...base.fields};
    for (const c of changes) if (checked.has(c.field)) fields[c.field] = c.value;
    const next = {fields, notice};
    try {
      const stored = JSON.parse(localStorage.getItem(prefix + id));
      if (JSON.stringify(stored || published[id] || {fields:{},notice:""}) !== JSON.stringify(base)) {
        records.delete(id);
        if (demo()) refresh(); else loadResources();
        el("reviewStatus").textContent = "其他分頁已更新這筆資源，請重新核對。";
        return;
      }
      localStorage.setItem(prefix + id, JSON.stringify(next));
    } catch { el("reviewStatus").textContent = "瀏覽器無法儲存，請確認儲存空間或權限。"; return; }
    records.set(id, next);
    INDEX = null;
    if (demo()) refresh(); else {
      resourceList = resourcesFor(el("uc").value, el("ud").value);
      refresh();
    }
    el("reviewStatus").textContent = "已完成審核，採用 " + checked.size + " 項變更。再次比對相同公告可跳過 AI。";
  };
  window.addEventListener("storage", e => {
    if (e.key !== null && !e.key.startsWith(prefix)) return;
    records.clear(); INDEX = null;
    if (demo()) refresh(); else loadResources();
  });
  el("exportReview").onclick = () => {
    if (!loaded) { el("reviewStatus").textContent = "公開資料尚未載入，請重新整理後再匯出。"; return; }
    const combined = {...published};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix) && k !== prefix + "practice") {
        combined[k.slice(prefix.length)] = JSON.parse(localStorage.getItem(k));
      }
    }
    const file = new Blob([JSON.stringify(combined, null, 2)], {type:"application/json"});
    const url = URL.createObjectURL(file), link = document.createElement("a");
    link.href = url; link.download = "reviewed.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  fetch("./reviewed.json").then(async response => {
    if (!response.ok) return;
    published = await response.json();
    loaded = true; records.clear(); INDEX = null;
    if (!demo()) loadResources();
  }).catch(() => {});
  refresh();
})();
