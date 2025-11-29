import { app } from "../../../scripts/app.js";

app.registerExtension({
  name: 'QueueSelectedNodesShortcut',
  keybindings: [
    {
      combo: { alt: true, key: 'Enter' },
      commandId: 'Comfy.QueueSelectedOutputNodes',
      targetElementId: 'graph-canvas-container'
    }
  ]
})