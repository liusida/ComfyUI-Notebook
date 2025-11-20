import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const workflowStorePromise = (async function waitForWorkflowStore() {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  while (true) {
    const vueApp = document.querySelector('#vue-app')?.__vue_app__;
    const pinia = vueApp?.config?.globalProperties?.$pinia;
    const workflowStore = pinia?._s?.get('workflow');
    if (workflowStore) {
      return workflowStore;
    }
    await sleep(500);
  }
})();

async function ensureWorkflowLoaded(workflow) {
  try {
    if (typeof workflow?.load === 'function') {
      await workflow.load({ force: false });
    }
  } catch (error) {
    console.warn('[Notebook Variables] Failed to load workflow:', workflow?.path, error);
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
      console.warn('[Notebook Variables] Failed parsing workflow JSON:', workflow?.path, error);
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

app.registerExtension({
  name: "ComfyUI-Notebook.NotebookTabVariables",
  bottomPanelTabs: [
    {
      id: 'notebook-tab-variables',
      title: 'Notebook Global Variables',
      type: 'custom',
      targetPanel: 'terminal',
      render: (container) => {
        container.style.padding = '20px';
        container.style.height = '100%';
        container.style.overflowY = 'auto';

        const refreshButton = document.createElement('button');
        const clearButton = document.createElement('button');
        const clearTempButton = document.createElement('button');
        const copyAllButton = document.createElement('button');
        clearButton.textContent = '❌ Free All Memory';
        clearButton.style.marginLeft = '100px';
        clearTempButton.textContent = '🗑️ Clear Temp Files';
        clearTempButton.style.marginLeft = '100px';
        clearButton.onclick = async () => {
          try {
            const response = await api.fetchApi('/notebook/free', { method: 'POST' });
            const data = await response.json();
            console.log(data);
          } catch (error) {
            container.innerHTML = `<p>Error: ${error.message}</p>`;
          }
          refreshButton.onclick();
        };

        clearTempButton.onclick = async () => {
          try {
            const response = await api.fetchApi('/notebook/clear_temp_files', { method: 'POST' });
            const data = await response.json();
            console.log(data);
            const originalText = clearTempButton.textContent;
            clearTempButton.textContent = '✅ Cleared!';
            setTimeout(() => {
              clearTempButton.textContent = originalText;
            }, 2000);
          } catch (error) {
            alert(`Error: ${error.message}`);
          }
        };

        copyAllButton.textContent = '📋 Copy All Cells Code [Left to Right]';
        copyAllButton.style.marginLeft = '100px';
        copyAllButton.onclick = () => {
          try {
            // Get the current graph
            const graph = app.graph;
            if (!graph || !graph._nodes) {
              alert('No graph found');
              return;
            }

            // Find all NotebookCell nodes
            const notebookCells = graph._nodes.filter(node => node.comfyClass === 'NotebookCell');

            if (notebookCells.length === 0) {
              alert('No Notebook Cells found in the workflow');
              return;
            }

            // Sort cells by position: left to right, then top to bottom
            notebookCells.sort((a, b) => {
              const aX = a.pos ? a.pos[0] : 0;
              const bX = b.pos ? b.pos[0] : 0;
              if (aX !== bX) {
                return aX - bX; // Sort by X (left to right)
              }
              const aY = a.pos ? a.pos[1] : 0;
              const bY = b.pos ? b.pos[1] : 0;
              return aY - bY; // Then by Y (top to bottom)
            });

            // Extract code from each cell
            const allCode = notebookCells.map((node, index) => {
              // Skip disabled or bypassed nodes
              if (node.mode === 2 || node.mode === 4) { return ''; }

              const codeWidget = node.widgets?.find(w => w.name === 'code');
              if (codeWidget?.disabled) { return ''; }
              let cellName = node.getTitle ? node.getTitle() : node.title;
              if (cellName == "Notebook: Cell") { cellName = `${index + 1}`; }
              const code = codeWidget?.value || '';
              return `#### Cell: ${cellName} ####\n${code}`;
            }).join('\n\n');

            // Copy to clipboard
            navigator.clipboard.writeText(allCode).then(() => {
              // Show feedback
              const originalText = copyAllButton.textContent;
              copyAllButton.textContent = '✅ Copied!';
              setTimeout(() => {
                copyAllButton.textContent = originalText;
              }, 2000);
            }).catch(err => {
              console.error('Failed to copy:', err);
              alert('Failed to copy code to clipboard');
            });
          } catch (error) {
            console.error('Error copying code:', error);
            alert(`Error: ${error.message}`);
          }
        };

        refreshButton.textContent = '🔄 Refresh';
        const lastUpdatedLabel = document.createElement('span');
        lastUpdatedLabel.className = 'notebook-last-updated';
        lastUpdatedLabel.style.marginLeft = '16px';
        lastUpdatedLabel.style.fontSize = '12px';
        lastUpdatedLabel.textContent = '🕒 Last refreshed: never';

        const setLastUpdated = (text) => {
          lastUpdatedLabel.textContent = `🕒 Last refreshed: ${text}`;
        };

        const refresh = async () => {
          try {
            const response = await api.fetchApi('/notebook/list_variables', { method: 'GET' });
            const data = await response.json();
            const kernels = data?.kernels || {};


            let html = '';
            const workflowInfoMap = await buildWorkflowInfo();

            if (Object.keys(kernels).length === 0) {
              html = '<p>No active kernels found.</p>';
            } else {
              const sortedWorkflowIds = Object.keys(kernels).sort((a, b) => {
                const aInfo = workflowInfoMap.get(a);
                const bInfo = workflowInfoMap.get(b);
                if (aInfo?.isActive && !bInfo?.isActive) return -1;
                if (!aInfo?.isActive && bInfo?.isActive) return 1;
                return a.localeCompare(b);
              });

              sortedWorkflowIds.forEach(workflowId => {
                const vars = kernels[workflowId];
                const workflowInfo = workflowInfoMap.get(workflowId);
                const filename = workflowInfo?.filename || 'Unknown Workflow';
                const activeLabel = workflowInfo?.isActive ? '🟢' : '⚫';

                html += `<div class="notebook-workflow-header">`;
                html += `<div class="notebook-workflow-title">`;
                html += `<span class="notebook-workflow-status">${activeLabel}</span>`;
                html += `<span class="notebook-workflow-name">${filename}</span>`;
                html += `<span class="notebook-workflow-id">${workflowId}</span>`;
                html += `</div>`;
                html += `<button class="notebook-workflow-free-btn" data-workflow-id="${workflowId}">❌ Free Memory</button>`;
                html += `</div>`;
                html += '<table class="comfy-markdown-content"><tr><th>Name</th><th>Type</th><th>Value</th></tr>';
                Object.keys(vars).sort().forEach(name => {
                  const info = vars[name];
                  html += `<tr><td>${name}</td><td>${info.type || ''}</td><td>${info.repr || ''}</td></tr>`;
                });
                html += '</table><br/>';
              });
            }

            container.innerHTML = '<h2>Notebook Variables</h2>';
            let buttonRow = container.__nb_buttonRow;
            if (!buttonRow) {
              buttonRow = document.createElement('div');
              container.__nb_buttonRow = buttonRow;
            }
            buttonRow.innerHTML = '';
            buttonRow.appendChild(refreshButton);
            buttonRow.appendChild(clearButton);
            buttonRow.appendChild(clearTempButton);
            buttonRow.appendChild(copyAllButton);
            container.appendChild(buttonRow);
            if (!document.getElementById('notebook-tab-variables-style')) {
              const style = document.createElement('style');
              style.id = 'notebook-tab-variables-style';
              style.textContent = `
            .notebook-workflow-header {
              display: flex;
              align-items: center;
              gap: 40px;
              margin-top: 20px;
              flex-wrap: wrap;
            }
            .notebook-workflow-title {
              display: flex;
              align-items: baseline;
              gap: 6px;
              flex-wrap: wrap;
            }
            .notebook-workflow-id {
              font-size: 14px;
              color: #aaa;
            }
            .notebook-workflow-free-btn {
              font-size: 12px;
              padding: 3px 8px;
            }
          `;
              document.head.appendChild(style);
            }

            let contentWrapper = container.__nb_contentWrapper;
            if (!contentWrapper) {
              contentWrapper = document.createElement('div');
              container.__nb_contentWrapper = contentWrapper;
            }
            if (!html) {
              contentWrapper.innerHTML = '<p>No active kernels found.</p>';
            } else {
              contentWrapper.innerHTML = html;
              contentWrapper.querySelectorAll('.notebook-workflow-free-btn').forEach((btn) => {
                btn.addEventListener('click', async (event) => {
                  const workflowId = event.currentTarget.dataset.workflowId;
                  if (!workflowId) return;
                  btn.disabled = true;
                  const originalText = btn.textContent;
                  btn.textContent = 'Freeing...';
                  try {
                    const response = await api.fetchApi('/notebook/free', {
                      method: 'POST',
                      body: JSON.stringify({ workflow_id: workflowId }),
                      headers: { 'Content-Type': 'application/json' },
                    });
                    const result = await response.json();
                    if (result?.status === 'ok') {
                      btn.textContent = '✅ Freed';
                      await refresh();
                    } else {
                      btn.textContent = '⚠️ Error';
                      console.warn('Notebook free memory failed', result);
                    }
                  } catch (error) {
                    console.error('Notebook free memory error', error);
                    btn.textContent = '⚠️ Error';
                  } finally {
                    setTimeout(() => {
                      btn.textContent = originalText;
                      btn.disabled = false;
                    }, 2000);
                  }
                });
              });
            }
            container.appendChild(contentWrapper);
            container.appendChild(lastUpdatedLabel);
            setLastUpdated(new Date().toLocaleTimeString());
          } catch (error) {
            container.innerHTML = `<p>Error: ${error.message}</p>`;
            setLastUpdated('error');
          }
        };
        refreshButton.onclick = refresh;

        container.innerHTML = '<h2>Notebook Variables</h2><p>Click Refresh to load variables</p>';
        container.appendChild(refreshButton);
        container.appendChild(clearButton);
        container.appendChild(clearTempButton);
        container.appendChild(copyAllButton);
        refresh();
      },
      destroy: () => { }
    }
  ]
});