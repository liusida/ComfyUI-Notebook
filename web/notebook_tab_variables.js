import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const STYLE_ID = "notebook-tab-variables-stylesheet";

const workflowStorePromise = (async function waitForWorkflowStore() {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  while (true) {
    const vueApp = document.querySelector("#vue-app")?.__vue_app__;
    const pinia = vueApp?.config?.globalProperties?.$pinia;
    const workflowStore = pinia?._s?.get("workflow");
    if (workflowStore) {
      return workflowStore;
    }
    await sleep(500);
  }
})();

async function ensureWorkflowLoaded(workflow) {
  try {
    if (typeof workflow?.load === "function") {
      await workflow.load({ force: false });
    }
  } catch (error) {
    console.warn("[Notebook Variables] Failed to load workflow:", workflow?.path, error);
  }
}

async function buildWorkflowInfo() {
  const workflowStore = await workflowStorePromise;
  const activeWorkflow = workflowStore.activeWorkflow;
  const allWorkflows = [
    activeWorkflow,
    ...(workflowStore.openWorkflows || []),
    ...(workflowStore.workflows || []),
  ].filter(Boolean);

  const infoMap = new Map();
  for (const workflow of allWorkflows) {
    await ensureWorkflowLoaded(workflow);
    let data = null;
    try {
      if (workflow.changeTracker?.activeState) {
        data = workflow.changeTracker.activeState;
      } else if (workflow.content) {
        data = JSON.parse(workflow.content);
      } else if (workflow.originalContent) {
        data = JSON.parse(workflow.originalContent);
      }
    } catch (error) {
      console.warn("[Notebook Variables] Failed parsing workflow JSON:", workflow?.path, error);
    }

    const workflowId = data?.id ?? data?.workflow?.id;
    if (!workflowId) continue;
    const filename = workflow.filename || workflow.path || `Workflow ${workflowId}`;
    const isActive = workflow === activeWorkflow;
    if (!infoMap.has(workflowId)) {
      infoMap.set(workflowId, { filename, isActive });
    }
  }

  return infoMap;
}

function ensureStylesLoaded() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.type = "text/css";
  link.href = "/extensions/ComfyUI-Notebook/notebook_tab_variables.css";
  document.head.appendChild(link);
}

function createButton(label) {
  const button = document.createElement("button");
  button.textContent = label;
  return button;
}

function createPanel(container) {
  ensureStylesLoaded();
  container.innerHTML = "";
  container.className = "notebook-container";

  const title = document.createElement("h3");
  title.className = "notebook-title";
  title.textContent = "Notebook Control Panel";

  const buttonRow = document.createElement("div");
  buttonRow.className = "notebook-toolbar";

  const refreshButton = createButton("🔄 Refresh");
  const rebootButton = createButton("⚠️ Reboot Server");
  const clearTempButton = createButton("🗑️ Clear Temp Files");
  const copyAllButton = createButton("📋 Copy All Cells Code [Left to Right]");
  buttonRow.append(refreshButton, rebootButton, clearTempButton, copyAllButton);

  const content = document.createElement("div");
  content.className = "notebook-workflow-content";

  const lastUpdatedLabel = document.createElement("span");
  lastUpdatedLabel.className = "notebook-last-updated";
  lastUpdatedLabel.textContent = "🕒 Last refreshed: never";

  container.append(title, buttonRow, content, lastUpdatedLabel);

  return {
    container,
    buttonRow,
    refreshButton,
    rebootButton,
    clearTempButton,
    copyAllButton,
    content,
    lastUpdatedLabel,
  };
}

function renderWorkflows(content, kernels, workflowInfoMap, state) {
  content.innerHTML = "";
  const workflowIds = Object.keys(kernels);
  if (workflowIds.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No active kernels found.";
    content.appendChild(empty);
    return;
  }

  workflowIds
    .sort((a, b) => {
      const aInfo = workflowInfoMap.get(a);
      const bInfo = workflowInfoMap.get(b);
      if (aInfo?.isActive && !bInfo?.isActive) return -1;
      if (!aInfo?.isActive && bInfo?.isActive) return 1;
      return a.localeCompare(b);
    })
    .forEach((workflowId) => {
      const vars = kernels[workflowId];
      const info = workflowInfoMap.get(workflowId);

      const header = document.createElement("div");
      header.className = "notebook-workflow-header";

      const title = document.createElement("div");
      title.className = "notebook-workflow-title";
      const status = document.createElement("span");
      status.textContent = info?.isActive ? "🟢" : "⚫";
      const name = document.createElement("span");
      name.textContent = info?.filename || "Unknown Workflow";
      const id = document.createElement("span");
      id.className = "notebook-workflow-id";
      id.textContent = workflowId;
      title.append(status, name, id);

      const freeButton = createButton("❌ Free Memory");
      freeButton.className = "notebook-workflow-free-btn";
      freeButton.addEventListener("click", () => handleFreeWorkflow(workflowId, freeButton, state));

      header.append(title, freeButton);
      content.appendChild(header);

      const table = document.createElement("table");
      table.className = "comfy-markdown-content notebook-variables-table";
      const headerRow = document.createElement("tr");
      ["Name", "Type", "Value"].forEach((label) => {
        const th = document.createElement("th");
        th.textContent = label;
        headerRow.appendChild(th);
      });
      table.appendChild(headerRow);

      Object.keys(vars)
        .sort()
        .forEach((nameKey) => {
          const infoValue = vars[nameKey];
          const row = document.createElement("tr");
          const nameCell = document.createElement("td");
          nameCell.textContent = nameKey;
          const typeCell = document.createElement("td");
          typeCell.textContent = infoValue.type || "";
          const valueCell = document.createElement("td");
          valueCell.textContent = infoValue.repr || "";
          row.append(nameCell, typeCell, valueCell);
          table.appendChild(row);
        });

      content.appendChild(table);
    });
}

async function handleFreeWorkflow(workflowId, button, state) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Freeing...";
  try {
    const response = await api.fetchApi("/notebook/free", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow_id: workflowId }),
    });
    const result = await response.json();
    button.textContent = result?.status === "ok" ? "✅ Freed" : "⚠️ Error";
    await state.refresh();
  } catch (error) {
    console.error("[Notebook Variables] Failed to free workflow", workflowId, error);
    button.textContent = "⚠️ Error";
  } finally {
    setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
    }, 2000);
  }
}

async function handleReboot(state) {
  const button = state.rebootButton;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Rebooting...";

  try {
    // Fire and forget - server will restart and won't respond
    api.fetchApi("/notebook/reboot", { method: "POST" }).catch(() => {
      // Expected - server is restarting, connection will be lost
    });

    // Listen for the server to come back online
    const onReconnected = () => {
      api.removeEventListener('reconnected', onReconnected);
      button.textContent = "✅ Server Online";
      button.disabled = false;
      setTimeout(() => {
        button.textContent = originalText;
      }, 2000);
      state.refresh();
    };

    api.addEventListener('reconnected', onReconnected);

    // Fallback timeout in case reconnection takes too long
    setTimeout(() => {
      api.removeEventListener('reconnected', onReconnected);
      if (button.disabled) {
        button.textContent = originalText;
        button.disabled = false;
      }
    }, 60000); // 60 second timeout

  } catch (error) {
    console.error("[Notebook Variables] Failed to reboot server", error);
    button.textContent = originalText;
    button.disabled = false;
  }
}

async function handleClearTemp(state) {
  const button = state.clearTempButton;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Clearing...";
  try {
    await api.fetchApi("/notebook/clear_temp_files", { method: "POST" });
    console.info("[Notebook Variables] Temp files cleared.");
  } catch (error) {
    console.error("[Notebook Variables] Failed to clear temp files", error);
  } finally {
    button.textContent = originalText;
    button.disabled = false;
  }
}

function handleCopyAllCells(button) {
  try {
    const graph = app.graph;
    if (!graph || !graph._nodes) {
      alert("No graph found");
      return;
    }

    const notebookCells = graph._nodes.filter((node) => node.comfyClass === "NotebookCell");
    if (notebookCells.length === 0) {
      alert("No Notebook Cells found in the workflow");
      return;
    }

    notebookCells.sort((a, b) => {
      const aX = a.pos ? a.pos[0] : 0;
      const bX = b.pos ? b.pos[0] : 0;
      if (aX !== bX) {
        return aX - bX;
      }
      const aY = a.pos ? a.pos[1] : 0;
      const bY = b.pos ? b.pos[1] : 0;
      return aY - bY;
    });

    const allCode = notebookCells
      .map((node, index) => {
        if (node.mode === 2 || node.mode === 4) return "";
        const codeWidget = node.widgets?.find((w) => w.name === "code");
        if (codeWidget?.disabled) return "";
        let cellName = node.getTitle ? node.getTitle() : node.title;
        if (cellName === "Notebook: Cell") {
          cellName = `${index + 1}`;
        }
        const code = codeWidget?.value || "";
        return `#### Cell: ${cellName} ####\n${code}`;
      })
      .join("\n\n");

    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Copying...";
    navigator.clipboard
      .writeText(allCode)
      .then(() => {
        button.textContent = "✅ Copied!";
        setTimeout(() => {
          button.textContent = originalText;
          button.disabled = false;
        }, 1500);
      })
      .catch((err) => {
        console.error("Failed to copy:", err);
        button.textContent = "⚠️ Error";
        setTimeout(() => {
          button.textContent = originalText;
          button.disabled = false;
        }, 1500);
      });
  } catch (error) {
    console.error("Error copying code:", error);
    alert(`Error: ${error.message}`);
  }
}

app.registerExtension({
  name: "ComfyUI-Notebook.NotebookTabVariables",
  bottomPanelTabs: [
    {
      id: "notebook-tab-variables",
      title: "📓 Notebook",
      type: "custom",
      targetPanel: "terminal",
      render: (container) => {
        const state = container.__nbNotebookPanel ?? createPanel(container);
        container.__nbNotebookPanel = state;

        const setLastUpdated = (text) => {
          state.lastUpdatedLabel.textContent = `🕒 Last refreshed: ${text}`;
        };

        state.refresh = async () => {
          try {
            const response = await api.fetchApi("/notebook/list_variables", { method: "GET" });
            const data = await response.json();
            const workflowInfoMap = await buildWorkflowInfo();
            renderWorkflows(state.content, data?.kernels || {}, workflowInfoMap, state);
            setLastUpdated(new Date().toLocaleTimeString());
          } catch (error) {
            console.error("[Notebook Variables] Failed to load variables", error);
            setLastUpdated("error");
          }
        };

        state.refreshButton.onclick = () => state.refresh();
        state.rebootButton.onclick = () => handleReboot(state);
        state.clearTempButton.onclick = () => handleClearTemp(state);
        state.copyAllButton.onclick = () => handleCopyAllCells(state.copyAllButton);

        state.refresh();
      },
      destroy: () => { },
    },
  ],
});