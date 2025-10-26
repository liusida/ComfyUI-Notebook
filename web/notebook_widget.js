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
    
    console.log("Applying Monaco Editor to textarea");
    
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
        theme: 'vs-dark',
        automaticLayout: true,  // Enable automatic layout resizing
        fontSize: 13,
        fontFamily: 'Consolas, Monaco, "Courier New", monospace',
        lineNumbers: 'off',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        tabSize: 4,
        insertSpaces: true,
        renderLineHighlight: 'all',
        lineHeight: 1.4,
        padding: { top: 8, bottom: 8 }
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
        console.log("NotebookCell extension setup");
        await loadMonaco();
    },
    
    async nodeCreated(node) {
        if (node.comfyClass !== 'NotebookCell') return;
        
        console.log("NotebookCell node created");
        
        // Wait for the UI to be fully rendered
        setTimeout(() => {
            const textareas = document.querySelectorAll('textarea.comfy-multiline-input[placeholder="code"]');
            
            textareas.forEach((textarea) => {
                if (!textarea.hasAttribute('data-monaco-applied')) {
                    applyMonaco(textarea);
                }
            });
        }, 100);
        
        // Periodic check for any textareas that might not have Monaco yet
        const checkInterval = setInterval(() => {
            // Wait for nodeElement to be found
            const textareas = document.querySelectorAll('textarea.comfy-multiline-input[placeholder="code"]');
            const unapplied = Array.from(textareas).filter(t => !t.hasAttribute('data-monaco-applied'));
            
            if (unapplied.length === 0) {
                clearInterval(checkInterval);
                return;
            }
            
            unapplied.forEach(textarea => {
                console.log("Found unapplied textarea, applying Monaco");
                applyMonaco(textarea);
            });
        }, 500);
        
        // Clear interval after 10 seconds
        setTimeout(() => clearInterval(checkInterval), 10000);
    }
});

