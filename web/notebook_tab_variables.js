import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

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
        const copyAllButton = document.createElement('button');
        clearButton.textContent = '🗑️ Clear Variables and Free Memory';
        clearButton.style.marginLeft = '100px';
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
        refreshButton.onclick = async () => {
          try {
            const response = await api.fetchApi('/notebook/list_variables', { method: 'GET' });
            const data = await response.json();
            const vars = data?.variables || {};
            console.log(data);

            let html = '<table class="comfy-markdown-content"><tr><th>Name</th><th>Type</th><th>Value</th></tr>';
            Object.keys(vars).sort().forEach(name => {
              const info = vars[name];
              html += `<tr><td>${name}</td><td>${info.type || ''}</td><td>${info.repr || ''}</td></tr>`;
            });
            html += '</table>';

            container.innerHTML = '<h2>Notebook Variables</h2>' + html;
            container.appendChild(refreshButton);
            container.appendChild(clearButton);
            container.appendChild(copyAllButton);
          } catch (error) {
            container.innerHTML = `<p>Error: ${error.message}</p>`;
          }
        };

        container.innerHTML = '<h2>Notebook Variables</h2><p>Click Refresh to load variables</p>';
        container.appendChild(refreshButton);
        container.appendChild(clearButton);
        container.appendChild(copyAllButton);
        refreshButton.onclick();
      },
      destroy: () => { }
    }
  ]
});