// Monaco Editor integration for notebook cells with syntax highlighting
import { app } from "../../../scripts/app.js";

let monacoLoaded = false;

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
function applyMonaco(textarea) {
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
    
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, function() {
        // Manually trigger the keypress on the hidden textarea
        const event = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            ctrlKey: true,
            bubbles: true,
            cancelable: true
        });
        textarea.dispatchEvent(event);
    });

    console.log("Monaco Editor applied successfully");
    
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
          setTimeout(tick, 100*(10-tries));
        };
        tick();
    }
});

