import { app } from "../../../scripts/app.js";

app.registerExtension({
  name: "ComfyUI-Notebook.GlobalStyles",
  async setup() {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.type = "text/css";
    link.href = "/extensions/ComfyUI-Notebook/notebook_global.css";
    document.head.appendChild(link);
  },
});
