(() => {
  const els = {
    deleteLimit: document.getElementById("delete-limit"),
    deleteNow: document.getElementById("delete-now"),
    testBtn: document.getElementById("test-connection"),
    status: document.getElementById("delete-status"),
  };

  const setStatus = (message, tone = "info") => {
    const toneMap = {
      info: "bg-blue-50 text-blue-700",
      success: "bg-green-50 text-green-700",
      error: "bg-red-50 text-red-700",
    };
    if (!els.status) return;
    els.status.className = `pill ${toneMap[tone] || toneMap.info}`;
    els.status.textContent = message;
    els.status.classList.remove("hidden");
  };

  const pingScanner = async () => {
    try {
      const res = await fetch("/api/scanner/ping");
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!data.connectivity) {
        const msg = data.message || "无法连接 scanner";
        setStatus(msg, "error");
        showNotification(msg, "error");
        return;
      }
      if (!data.auth) {
        const msg = data.message || "API Key 无效";
        setStatus(msg, "error");
        showNotification(msg, "error");
        return;
      }
      setStatus("连接正常 / Key 有效", "success");
      showNotification("连接正常 / Key 有效");
    } catch (error) {
      console.error("Ping scanner failed", error);
      setStatus("连接测试失败", "error");
      showNotification("连接测试失败", "error");
    }
  };

  const deleteNow = async () => {
    const limit = Number(els.deleteLimit?.value || 50);
    try {
      els.deleteNow?.classList.add("opacity-60", "pointer-events-none");
      const res = await fetch(`/api/scanner/delete-invalid?limit=${limit}`, {
        method: "POST",
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setStatus(`已删除 ${data.deleted ?? 0} / ${data.requested ?? limit}`, "success");
      showNotification(`已删除 ${data.deleted ?? 0} 条 invalid Key`);
    } catch (error) {
      console.error("Delete invalid failed", error);
      setStatus("删除失败", "error");
      showNotification("删除失败，请检查连接/API Key", "error");
    } finally {
      els.deleteNow?.classList.remove("opacity-60", "pointer-events-none");
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    els.testBtn?.addEventListener("click", pingScanner);
    els.deleteNow?.addEventListener("click", deleteNow);
  });
})();
