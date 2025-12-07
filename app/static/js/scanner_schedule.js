(() => {
  const el = (id) => document.getElementById(id);

  const loadSchedule = async () => {
    try {
      const res = await fetch("/api/scanner/schedule");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      el("reverify-enabled").checked = !!data.reverify_enabled;
      el("reverify-time").value = data.reverify_time || "02:30";
      el("reverify-count").value = data.reverify_count || 50;
      el("reverify-statuses").value = (data.reverify_statuses || []).join(",");

      el("sync-enabled").checked = !!data.sync_enabled;
      el("sync-time").value = data.sync_time || "03:00";
      el("sync-limit").value = data.sync_limit || 100;
      el("sync-type").value = data.sync_type || "valid";
      el("delete-enabled").checked = !!data.delete_enabled;
      el("delete-time").value = data.delete_time || "04:00";
      el("delete-limit").value = data.delete_limit || 50;
    } catch (error) {
      console.error("加载定时配置失败", error);
      showNotification("加载定时配置失败，请检查登录状态", "error");
    }
  };

  const saveSchedule = async () => {
    const payload = {
      reverify_enabled: el("reverify-enabled").checked,
      reverify_time: el("reverify-time").value.trim(),
      reverify_count: Number(el("reverify-count").value || 50),
      reverify_statuses: (el("reverify-statuses").value || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      sync_enabled: el("sync-enabled").checked,
      sync_time: el("sync-time").value.trim(),
      sync_limit: Number(el("sync-limit").value || 100),
      sync_type: el("sync-type").value || "valid",
      delete_enabled: el("delete-enabled").checked,
      delete_time: el("delete-time").value.trim(),
      delete_limit: Number(el("delete-limit").value || 50),
    };
    try {
      const res = await fetch("/api/scanner/schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail || `HTTP ${res.status}`);
      }
      showNotification("定时配置已保存");
    } catch (error) {
      console.error("保存定时配置失败", error);
      showNotification("保存定时配置失败", "error");
    }
  };

  const triggerReverify = async () => {
    const payload = {
      count: Number(el("reverify-count").value || 50),
      statuses: (el("reverify-statuses").value || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
    if (!payload.statuses.length) delete payload.statuses;
    try {
      const res = await fetch("/api/scanner/reverify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      showNotification(`已触发复验：checked=${data.checked ?? payload.count}`);
    } catch (error) {
      console.error("触发复验失败", error);
      showNotification("触发复验失败", "error");
    }
  };

  const triggerSync = async () => {
    const limit = Number(el("sync-limit").value || 100);
    const type = el("sync-type").value || "valid";
    try {
      const res = await fetch(
        `/api/scanner/sync-now?limit=${limit}&key_type=${type}`,
        { method: "POST" }
      );
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const synced = data.synced ?? data.total ?? 0;
      showNotification(`已同步 ${synced} 条 Key`);
    } catch (error) {
      console.error("触发同步失败", error);
      showNotification("触发同步失败", "error");
    }
  };

  const triggerDelete = async () => {
    const limit = Number(el("delete-limit").value || 50);
    try {
      const res = await fetch(`/api/scanner/delete-invalid?limit=${limit}`, {
        method: "POST",
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      showNotification(`已删除 ${data.deleted ?? 0} 条 invalid Key`);
    } catch (error) {
      console.error("触发删除失败", error);
      showNotification("触发删除失败", "error");
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    loadSchedule();
    el("save-schedule")?.addEventListener("click", saveSchedule);
    el("trigger-reverify")?.addEventListener("click", triggerReverify);
    el("trigger-sync")?.addEventListener("click", triggerSync);
    el("trigger-delete")?.addEventListener("click", triggerDelete);
  });
})();
