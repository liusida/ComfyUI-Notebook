// Extension to make PreviewAny node bigger when created
import { app } from "../../../scripts/app.js";

app.registerExtension({
  name: "ComfyUI-Notebook.PreviewAnySize",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== 'PreviewAny') return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      if (onNodeCreated) onNodeCreated.apply(this, []);

      // Set a default minimum size for the node
      const MIN_WIDTH = 400;
      const MIN_HEIGHT = 200;
      const currentSize = this.size || this.computeSize?.() || [MIN_WIDTH, MIN_HEIGHT];
      const newWidth = Math.max(currentSize[0] || 0, MIN_WIDTH);
      const newHeight = Math.max(currentSize[1] || 0, MIN_HEIGHT);

      if (this.setSize) {
        this.setSize([newWidth, newHeight]);
      } else if (this.size) {
        this.size = [newWidth, newHeight];
      }
    };
  },
});
