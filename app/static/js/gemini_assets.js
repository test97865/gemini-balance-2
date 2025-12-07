(() => {
  const state = { items: [], defaultLimit: 50 };

  const selectors = {
    baseUrl: document.getElementById("scanner-base-url"),
    apiKey: document.getElementById("scanner-api-key"),
    timeout: document.getElementById("scanner-timeout"),
    defaultLimit: document.getElementById("scanner-default-limit"),
    fetchLimit: document.getElementById("fetch-limit"),
    fetchType: document.getElementById("fetch-type"),
    configStatus: document.getElementById("config-status"),
    fetchStatus: document.getElementById("fetch-status"),
    deleteStatus: document.getElementById("delete-status"),
    testScanner: document.getElementById("test-scanner"),
    deleteTest: document.getElementById("delete-test"),
    saveConfig: document.getElementById("save-scanner-config"),
    fetchKeys: document.getElementById("fetch-keys"),
    deleteNow: document.getElementById("delete-now"),
    copyKeys: document.getElementById("copy-keys"),
    resultBody: document.getElementById("result-body"),
    resultCount: document.getElementById("result-count"),
    emptyRow: document.getElementById("empty-row"),
    deleteLimit: document.getElementById("delete-limit"),
  };

  const setStatusPill = (el, message, tone = "info") => {
    if (!el) return;
    el.classList.remove("hidden");
    el.textContent = message;
    const toneMap = {
      info: "bg-blue-50 text-blue-700",
      success: "bg-green-50 text-green-700",
      error: "bg-red-50 text-red-700",
    };
    el.className = `pill ${toneMap[tone] || toneMap.info}`;
  };

  const parseDate = (value) => {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  };

  const getStatusTone = (status) => {
    const normalized = (status || "").toLowerCase();
    if (normalized === "billable") return "bg-amber-50 text-amber-700";
    if (normalized === "effective" || normalized === "valid")
      return "bg-green-50 text-green-700";
    if (normalized === "pending") return "bg-gray-100 text-gray-700";
    if (normalized === "rate_limited" || normalized === "rate-limited")
      return "bg-yellow-50 text-yellow-700";
    if (normalized === "invalid" || normalized === "error")
      return "bg-red-50 text-red-700";
    return "bg-gray-100 text-gray-700";
  };

  const renderRows = () => {
    const { items } = state;
    const { resultBody, emptyRow, resultCount } = selectors;
    if (!resultBody) return;

    resultBody.innerHTML = "";
    if (!items.length) {
      if (emptyRow) {
        emptyRow.classList.remove("hidden");
        resultBody.appendChild(emptyRow);
      }
      if (resultCount) resultCount.textContent = "0 条";
      return;
    }

    if (emptyRow && emptyRow.parentElement === resultBody) {
      emptyRow.remove();
    }

    items.forEach((item) => {
      const tr = document.createElement("tr");
      tr.className = "table-row";
      tr.innerHTML = `
        <td class="px-4 py-3 font-mono text-sm text-gray-800 break-all">${item.key || ""}</td>
        <td class="px-4 py-3">
          <span class="pill bg-gray-100 text-gray-800">${item.key_type || "valid"}</span>
        </td>
        <td class="px-4 py-3">
          <span class="pill ${getStatusTone(item.recheck_status)}">${item.recheck_status || "unknown"}</span>
        </td>
        <td class="px-4 py-3 text-sm text-gray-700">${parseDate(item.last_verified_at)}</td>
        <td class="px-4 py-3 text-sm text-gray-600">
          ${item.url ? `<a class="text-primary-600 hover:text-primary-800 underline" href="${item.url}" target="_blank" rel="noreferrer">来源</a>` : "—"}
        </td>
      `;
      resultBody.appendChild(tr);
    });

    if (resultCount) {
      resultCount.textContent = `${items.length} 条`;
    }
  };

  const loadConfig = async () => {
    try {
      const response = await fetch("/api/scanner/config");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (selectors.baseUrl) selectors.baseUrl.value = data.base_url || "";
      if (selectors.timeout) selectors.timeout.value = data.timeout || 15;
      if (selectors.defaultLimit) {
        selectors.defaultLimit.value = data.default_limit || 50;
        selectors.fetchLimit.value = data.default_limit || 50;
        state.defaultLimit = data.default_limit || 50;
      }
      if (selectors.fetchType) selectors.fetchType.value = "valid";
      setStatusPill(
        selectors.configStatus,
        `已加载（${data.base_url || "未配置"}）`,
        "info"
      );
    } catch (error) {
      console.error("加载 scanner 配置失败", error);
      setStatusPill(selectors.configStatus, "配置加载失败", "error");
      showNotification("加载 scanner 配置失败，请检查登录状态", "error");
    }
  };

  const saveConfig = async () => {
    if (!selectors.baseUrl || !selectors.apiKey) return;
    const payload = {
      base_url: selectors.baseUrl.value.trim(),
      api_key: selectors.apiKey.value.trim(),
      timeout: Number(selectors.timeout?.value || 15),
      default_limit: Number(selectors.defaultLimit?.value || state.defaultLimit),
    };
    try {
      selectors.saveConfig?.classList.add("opacity-60", "pointer-events-none");
      const response = await fetch("/api/scanner/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `HTTP ${response.status}`);
      }
      showNotification("已保存 scanner 配置");
      setStatusPill(selectors.configStatus, "保存成功", "success");
      selectors.apiKey.value = "";
    } catch (error) {
      console.error("保存 scanner 配置失败", error);
      setStatusPill(selectors.configStatus, "保存失败", "error");
      showNotification("保存 scanner 配置失败", "error");
    } finally {
      selectors.saveConfig?.classList.remove("opacity-60", "pointer-events-none");
    }
  };

  const fetchKeys = async () => {
    const limit = Number(selectors.fetchLimit?.value || state.defaultLimit || 50);
    const type = selectors.fetchType?.value || "valid";
    try {
      selectors.fetchKeys?.classList.add("opacity-60", "pointer-events-none");
      setStatusPill(selectors.fetchStatus, "拉取中...", "info");
      const response = await fetch(
        `/api/scanner/key-assets?limit=${limit}&key_type=${type}`
      );
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `HTTP ${response.status}`);
      }
      const data = await response.json();
      state.items = data.items || [];
      renderRows();
      setStatusPill(
        selectors.fetchStatus,
        `获取成功：${state.items.length} 条`,
        "success"
      );
      showNotification(`获取成功：${state.items.length} 条`);
    } catch (error) {
      console.error("获取 keys 失败", error);
      setStatusPill(selectors.fetchStatus, "获取失败", "error");
      showNotification("获取失败，请检查配置或登录状态", "error");
    } finally {
      selectors.fetchKeys?.classList.remove("opacity-60", "pointer-events-none");
    }
  };

  const copyKeys = async () => {
    if (!state.items.length) {
      showNotification("没有可复制的 Key", "error");
      return;
    }
    const payload = state.items.map((item) => item.key).filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(payload);
      showNotification(`已复制 ${state.items.length} 条 Key`);
    } catch (error) {
      console.error("复制失败", error);
      showNotification("复制失败，请手动选择复制", "error");
    }
  };

  const testScanner = async (target) => {
    try {
      const res = await fetch("/api/scanner/ping");
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!data.connectivity) {
        const msg = data.message || "无法连接 scanner";
        setStatusPill(target, msg, "error");
        showNotification(msg, "error");
        return;
      }
      if (!data.auth) {
        const msg = data.message || "API Key 无效";
        setStatusPill(target, msg, "error");
        showNotification(msg, "error");
        return;
      }
      setStatusPill(target, "连接正常 / Key 有效", "success");
      showNotification("连接正常 / Key 有效");
    } catch (error) {
      console.error("测试连接失败", error);
      setStatusPill(target, "连接测试失败", "error");
      showNotification("连接测试失败", "error");
    }
  };

  const deleteInvalid = async () => {
    const limit = Number(selectors.deleteLimit?.value || 50);
    try {
      selectors.deleteNow?.classList.add("opacity-60", "pointer-events-none");
      const res = await fetch(`/api/scanner/delete-invalid?limit=${limit}`, {
        method: "POST",
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setStatusPill(
        selectors.deleteStatus,
        `已删除 ${data.deleted ?? 0} / ${data.requested ?? limit}`,
        "success"
      );
      showNotification(`已删除 ${data.deleted ?? 0} 条 invalid Key`);
    } catch (error) {
      console.error("删除 invalid Key 失败", error);
      setStatusPill(selectors.deleteStatus, "删除失败", "error");
      showNotification("删除失败，请检查连接或权限", "error");
    } finally {
      selectors.deleteNow?.classList.remove("opacity-60", "pointer-events-none");
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    loadConfig();
    selectors.saveConfig?.addEventListener("click", saveConfig);
    selectors.fetchKeys?.addEventListener("click", fetchKeys);
    selectors.copyKeys?.addEventListener("click", copyKeys);
    selectors.testScanner?.addEventListener("click", () => testScanner(selectors.configStatus));
    selectors.deleteTest?.addEventListener("click", () => testScanner(selectors.deleteStatus));
    selectors.deleteNow?.addEventListener("click", deleteInvalid);
  });
})();
