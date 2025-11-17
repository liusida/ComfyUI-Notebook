// Monaco Editor integration for notebook cells with syntax highlighting
import { app } from "../../../scripts/app.js";
import { ComfyWidgets } from "../../../scripts/widgets.js";

let monacoLoaded = false;
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
// Load Monaco Editor
function loadMonaco() {
    if (monacoLoaded || typeof monaco !== 'undefined') {
        return Promise.resolve();
    }

    monacoLoaded = true;
    console.log("Loading Monaco Editor...");

    return new Promise((resolve) => {
        // Load Monaco loader
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs/loader.min.js';
        script.onload = () => {
            require.config({
                paths: {
                    vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs'
                }
            });
            require(['vs/editor/editor.main'], () => {
                console.log("Monaco Editor loaded successfully");
                resolve();
            });
        };
        document.head.appendChild(script);
    });
}

// Apply Monaco Editor to textarea
async function applyMonaco(textarea) {
    await sleep(100);
    if (textarea.hasAttribute('data-monaco-applied')) {
        return;
    }

    if (typeof monaco === 'undefined') {
        setTimeout(() => applyMonaco(textarea), 100);
        return;
    }

    // console.log("Applying Monaco Editor to textarea");

    // Define custom theme with line number colors
    monaco.editor.defineTheme('notebook-theme', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
            'editorLineNumber.foreground': '#333333',  // Normal line number color
            'editorLineNumber.activeForeground': '#444444'  // Active line number color
        }
    });

    const originalValue = textarea.value;

    // Get the actual dimensions BEFORE hiding
    const rect = textarea.getBoundingClientRect();
    const originalStyle = window.getComputedStyle(textarea);
    const width = originalStyle.width;
    const height = originalStyle.height;

    // Hide the textarea
    textarea.style.position = 'absolute';
    textarea.style.opacity = '0';
    textarea.style.width = '1px';
    textarea.style.height = '1px';
    textarea.style.pointerEvents = 'none';
    textarea.setAttribute('data-monaco-applied', 'true');

    // Get the parent container
    const parentContainer = textarea.parentNode;

    // Create a container for Monaco
    const editorContainer = document.createElement('div');
    editorContainer.style.width = width;
    editorContainer.style.height = height;

    // Insert container after textarea
    parentContainer.insertBefore(editorContainer, textarea.nextSibling);
    // console.log("Editor container created");

    // Create Monaco Editor instance
    const editor = monaco.editor.create(editorContainer, {
        value: originalValue,
        language: 'python',
        theme: 'notebook-theme',
        automaticLayout: true,  // Enable automatic layout resizing
        fontSize: 13,
        fontFamily: 'Consolas, Monaco, "Courier New", monospace',
        lineNumbers: 'on',
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        tabSize: 4,
        insertSpaces: true,
        renderLineHighlight: 'all',
        lineHeight: 1.4,
        padding: { top: 8, bottom: 8 },
        lineDecorationsWidth: 0,
        glyphMargin: false,
        lineNumbersMinChars: 3,
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, function () {
        // Manually trigger the keypress on the hidden textarea
        const event = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            ctrlKey: true,
            bubbles: true,
            cancelable: true
        });
        window.dispatchEvent(event);
    });

    // console.log("Monaco Editor applied successfully");

    // Sync changes back to textarea
    editor.onDidChangeModelContent(() => {
        textarea.value = editor.getValue();
        const inputEvent = new Event('input', { bubbles: true });
        textarea.dispatchEvent(inputEvent);

        const changeEvent = new Event('change', { bubbles: true });
        textarea.dispatchEvent(changeEvent);
    });

    // Listen for external value changes
    const observer = new MutationObserver(() => {
        const newValue = textarea.value;
        if (newValue !== editor.getValue()) {
            editor.setValue(newValue);
        }
    });

    observer.observe(textarea, {
        attributes: true,
        attributeFilter: ['value']
    });

    // Watch for node resizing
    const resizeObserver = new ResizeObserver(() => {
        // Get current dimensions from the parent container
        editorContainer.style.width = parentContainer.style.width;
        editorContainer.style.height = parentContainer.style.height;
    });

    resizeObserver.observe(parentContainer);

    // Store reference
    textarea.editor = editor;
    textarea.editorContainer = editorContainer;
    textarea.resizeObserver = resizeObserver; // Store for cleanup if needed
}
// Setup extension
app.registerExtension({
    name: "ComfyUI.NotebookCell",

    async setup() {
        // console.log("NotebookCell extension setup");
        await loadMonaco();
    },

    async nodeCreated(node) {
        if (node.comfyClass !== 'NotebookCell') return;

        const widget = node.widgets?.find((w) => w.name === 'code' && (w.type === 'customtext' || w.type === 'MARKDOWN'));
        if (!widget) return;
        if (widget.options) widget.options.hideOnZoom = false;
        const ta = widget.inputEl || widget.element; // textarea element        

        const tryMount = () => {
            const wrapper = ta.closest('.dom-widget');
            if (!wrapper) return;
            applyMonaco(ta);
            if (!wrapper._nb_ro) {
                const ro = new ResizeObserver(() => {
                    if (app.canvas?.low_quality) return; // skip while zoomed out
                    // console.log("ResizeObserver triggered");
                    applyMonaco(ta);
                });
                ro.observe(wrapper);
                // console.log("ResizeObserver hooked up");
                wrapper._nb_ro = ro;
            }
            return true;
        }
        let tries = 10;
        const tick = () => {
            if (tryMount() || --tries <= 0) return;
            setTimeout(tick, 100 * (10 - tries));
        };
        tick();

        // Add click handler to retry applying Monaco if it's not applied
        ta.addEventListener('click', () => {
            if (!ta.editor || !ta.hasAttribute('data-monaco-applied')) {
                if (ta.hasAttribute('data-monaco-applied')) {
                    ta.removeAttribute('data-monaco-applied');
                }
                applyMonaco(ta);
            }
        });

        // Find Stdout output slot index
        const stdoutIndex = node.findOutputSlot('Stdout');

        // Store original onConnectionsChange if it exists
        const originalOnConnectionsChange = node.onConnectionsChange;

        // Listen for connection changes
        node.onConnectionsChange = (slotType, slotIndex, connected, link, slot) => {
            // Call original callback if it exists
            if (originalOnConnectionsChange) {
                originalOnConnectionsChange.call(node, slotType, slotIndex, connected, link, slot);
            }

            // Check if this is the Stdout output slot
            if (slotType === 2 && link.origin_slot === stdoutIndex) { // 2 = NodeSlotType.OUTPUT
                const outputWidget = node.widgets?.find((w) => w.name === 'No Preview');
                if (!outputWidget) return;

                if (connected) {
                    // When a link is connected, hide the widget
                    outputWidget.hidden = true;
                } else {
                    // When a link is disconnected, check if there are any remaining links
                    // Only show the widget if there are no remaining connections
                    const hasRemainingLinks = node.outputs &&
                        node.outputs[stdoutIndex] &&
                        node.outputs[stdoutIndex].links &&
                        node.outputs[stdoutIndex].links.length > 0;

                    outputWidget.hidden = hasRemainingLinks;
                }
            }
        };

        // Setup resize handle for output area
        setTimeout(() => {
            const outputWidget = node.widgets?.find((w) => w.name === 'No Preview');
            if (!outputWidget) return;
            const outputEl = outputWidget.element?.closest('.dom-widget');
            if (!outputEl) return;

            const handle = document.createElement('div');
            handle.className = 'notebook-resize-handle';
            handle.style.cssText = 'position:fixed;left:0;right:0;height:4px;cursor:ns-resize;z-index:1000;';
            let dragging = false, startY = 0, startH = 0;

            handle.addEventListener('mousedown', (e) => {
                dragging = true;
                startY = e.clientY;
                startH = node.outputHeight || 50;
                document.addEventListener('mousemove', move);
                document.addEventListener('mouseup', up);
                e.preventDefault();
            });

            function move(e) {
                if (!dragging) return;
                // Get canvas scale to adjust mouse movement
                const scale = app.canvas?.ds?.scale || 1;
                const deltaY = (startY - e.clientY) / scale;
                const h = Math.max(30, Math.min(300, startH + deltaY));
                node.outputHeight = h;
                outputWidget.options.getMinHeight = () => outputWidget.hidden ? 0 : h;
                outputWidget.options.getMaxHeight = () => outputWidget.hidden ? 0 : h;
                node.setSize([node.size[0], node.size[1]]);
                app.graph.setDirtyCanvas(true, false);
            }

            function up() {
                dragging = false;
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
            }

            const updatePos = () => {
                if (outputWidget.hidden) {
                    handle.style.display = 'none';
                    return;
                }
                handle.style.display = 'block';
                handle.style.backgroundColor = 'rgba(20,20,20,0.1)';
                // handle.style.backgroundColor = 'rgba(255,0,0,1)';
                const widgetStyle = window.getComputedStyle(outputEl);
                const rect = outputEl.getBoundingClientRect();

                // Check if element is actually visible/positioned
                if (rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.left === 0) {
                    // Element might not be positioned yet, hide handle
                    handle.style.display = 'none';
                    return;
                }

                handle.style.position = widgetStyle.position;
                handle.style.transformOrigin = widgetStyle.transformOrigin;
                handle.style.transform = widgetStyle.transform;
                handle.style.left = widgetStyle.left;
                handle.style.width = widgetStyle.width;
                handle.style.zIndex = widgetStyle.zIndex || '1';
                const scale = app.canvas?.ds?.scale || 1;
                handle.style.top = `${rect.top - 12 * scale}px`;
            };

            // Clean up handle when node is removed
            const originalOnRemoved = node.onRemoved;
            node.onRemoved = function () {
                document.querySelectorAll('.notebook-resize-handle').forEach(handle => {
                    // Check if handle is associated with this node (could add data-node-id attribute)
                    handle.remove();
                });
                if (originalOnRemoved) originalOnRemoved.apply(this, arguments);
            };

            document.body.appendChild(handle);
            new ResizeObserver(updatePos).observe(outputEl);

            // Watch for widget style changes (position updates)
            const styleObserver = new MutationObserver(updatePos);
            styleObserver.observe(outputEl, { attributes: true, attributeFilter: ['style'] });

            // Watch for canvas transform changes (pan/zoom)
            const canvas = app.canvas?.canvas;
            if (canvas) {
                const canvasObserver = new MutationObserver(updatePos);
                canvasObserver.observe(canvas, { attributes: true, attributeFilter: ['style'] });
            }

            updatePos();
        }, 200);
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== 'NotebookCell') return;

        // Initialize output height preference
        const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            if (originalOnNodeCreated) originalOnNodeCreated.apply(this, []);
            if (this.outputHeight === undefined) this.outputHeight = 50;
        };

        // Hook into onNodeCreated to add output widget
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            if (onNodeCreated) onNodeCreated.apply(this, []);

            // Make code widget flexible
            const codeWidget = this.widgets?.find((w) => w.name === 'code');
            if (codeWidget?.options) {
                codeWidget.options.getMaxHeight = () => undefined;
            }

            // Add output textarea widget
            const outputWidget = ComfyWidgets['STRING'](
                this,
                'No Preview',
                ['STRING', { multiline: true }],
                app
            ).widget;
            outputWidget.element.readOnly = true;
            outputWidget.serializeValue = () => ''; // Prevent serialization of the output widget
            const height = () => this.outputHeight || 50;
            outputWidget.options.getMinHeight = () => outputWidget.hidden ? 0 : height();
            outputWidget.options.getMaxHeight = () => outputWidget.hidden ? 0 : height();
        };

        // Hook into onExecuted to update output widget
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            if (onExecuted) onExecuted.apply(this, [message]);

            const outputWidget = this.widgets?.find((w) => w.name === 'No Preview');
            if (outputWidget && message.text && message.text[0]) {
                outputWidget.value = message.text[0];
            }
        };
    },
});

