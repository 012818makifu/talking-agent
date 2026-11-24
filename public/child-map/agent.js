const agentForm = document.getElementById("agent");
const agentStatus = document.getElementById("agentStatus");
agentForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter || document.getElementById("interpret");
  const live = button.id === "liveQuery";
  const message = document.getElementById("situation").value.trim();
  if (button.disabled) return;
  if (live && !message) { agentStatus.textContent = "請先輸入情境。"; return; }
  button.disabled = true;
  agentStatus.textContent = "正在整理地點、學制與需求…";
  try {
    let f = {county:"新北市", town:"板橋區", age:"國小", need:["food"], status:[], time:"寒暑假"};
    if (live) {
    const response = await fetch("/api/child-map", {
      method: "POST", headers: { "Content-Type": "application/json", "x-map-password": document.getElementById("queryPassword").value },
      body: JSON.stringify({ message }), signal: AbortSignal.timeout(30000),
    });
    const data = await response.json();
    if (!response.ok || !data.filters) throw new Error(data.error || "AI 暫時無法連線。");
    f = data.filters;
    }
    const form = document.getElementById("qform");
    form.reset();
    document.getElementById("qres").replaceChildren();
    const county = document.getElementById("qc");
    county.value = String(f.county || "").replace(/台/g, "臺");
    if (!county.value) county.selectedIndex = 0;
    county.dispatchEvent(new Event("change"));
    const district = document.getElementById("qd");
    district.value = String(f.town || "").replace(/台/g, "臺");
    if (!district.value) district.selectedIndex = 0;
    const selections = { qa: [f.age], qs: f.status, qn: f.need, qt: [f.time] };
    const labels = [county.value, district.value].filter(Boolean);
    for (const input of form.querySelectorAll("input")) {
      const values = selections[input.name];
      input.checked = Boolean(input.value && Array.isArray(values) && values.includes(input.value));
      if (input.checked) labels.push(input.nextElementSibling.textContent);
    }
    agentStatus.textContent = labels.length
      ? (live ? "我讀到「" : "免費範例（預設結果）：「") + labels.join("、") + "」。請核對下方條件，再按「看看我可以用的資源」。"
      : "還讀不出查詢條件。可以補充孩子住哪裡、讀幾年級，或需要哪方面的幫助。";
    if (f.town && !district.value) agentStatus.textContent += " 行政區尚未確認，請手動選擇。";
  } catch (error) {
    agentStatus.textContent = (error.message || "無法連線") + " 可以直接使用下方五題。";
  } finally {
    button.disabled = false;
  }
});

fetch("/api/child-map").then(r => r.json()).then(({ video }) => {
  if (!video) return;
  const media = document.getElementById("media");
  media.querySelector("a").href = video;
  media.hidden = false;
}).catch(() => {});
