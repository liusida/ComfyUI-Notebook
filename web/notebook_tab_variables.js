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

        const refreshButton = document.createElement('button');
        const clearButton = document.createElement('button');
        clearButton.textContent = 'Clear Variables and Free Memory';
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
        refreshButton.textContent = 'Refresh';
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
          } catch (error) {
            container.innerHTML = `<p>Error: ${error.message}</p>`;
          }
        };

        container.innerHTML = '<h2>Notebook Variables</h2><p>Click Refresh to load variables</p>';
        container.appendChild(refreshButton);
        refreshButton.onclick();
      },
      destroy: () => { }
    }
  ]
});