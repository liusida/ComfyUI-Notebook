import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
app.registerExtension({
  name: "ComfyUI.NotebookCell-SwitchWorkflowCleanup",
  async setup() {
    const originalLoadGraphData = app.loadGraphData?.bind(app)
    if (!originalLoadGraphData) return

    app.loadGraphData = async (...args) => {
      // Clear current workflow’s notebook state first, then free models/caches
      console.log("loadGraphData", args)

      // Call your backend endpoint directly
      try {
        await api.fetchApi('/notebook/clear_ns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wf_key: null }) // null = clear all
        })
      } catch (e) {
        console.warn('Notebook namespace clear failed:', e)
      }



      const res = await api.fetchApi(`/free`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"unload_models": true, "free_memory": true}'
      });
      console.log("res", res)
      return originalLoadGraphData(...args);
    }
  }
})