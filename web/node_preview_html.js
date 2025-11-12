// Preview HTML - Renders HTML content including interactive visualizations
// Supports circuitsvis and other HTML-generating libraries
import { app } from "../../../scripts/app.js";
import { ComfyWidgets } from "../../../scripts/widgets.js";

/**
 * Helper function to inject HTML and execute script tags.
 * This is necessary because setting innerHTML doesn't execute <script> tags.
 * 
 * @param {HTMLElement} container - Container element to inject HTML into
 * @param {string} html - HTML string to inject
 */
function injectHTMLWithScripts(container, html) {
    if (!container || !(container instanceof HTMLElement)) {
        console.error('PreviewHTML: Invalid container element');
        return;
    }

    // Clear existing content
    container.innerHTML = html;

    // Find all script tags and re-execute them
    const scripts = Array.from(container.querySelectorAll('script'));

    scripts.forEach(oldScript => {
        const newScript = document.createElement('script');

        // Copy all attributes (including type="module", crossorigin, etc.)
        Array.from(oldScript.attributes).forEach(attr => {
            newScript.setAttribute(attr.name, attr.value);
        });

        // Copy inline code
        newScript.text = oldScript.text;

        // Replace the old script with new one to trigger execution
        // This works for both inline scripts and external scripts (via src attribute)
        if (oldScript.parentNode) {
            oldScript.parentNode.replaceChild(newScript, oldScript);
        }
    });
}

// Register the extension
app.registerExtension({
    name: "ComfyUI-Notebook.PreviewHTML",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== 'PreviewHTML') return;

        // Hook into onNodeCreated to add HTML container
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            if (onNodeCreated) onNodeCreated.apply(this, []);

            // Create a container div for HTML rendering
            const htmlContainer = document.createElement('div');
            htmlContainer.className = 'preview-html-container';
            htmlContainer.style.cssText = `
                margin-top: 8px;
                padding: 12px;
                border: 1px solid var(--border-color, #444);
                border-radius: 4px;
                background: var(--comfy-input-bg, #1e1e1e);
                min-height: 100px;
                max-height: 600px;
                overflow-y: auto;
                overflow-x: hidden;
            `;

            // Use addDOMWidget with proper parameters: name, type, element
            // The type 'html' is a custom type for our HTML preview widget
            try {
                if (this.addDOMWidget && typeof this.addDOMWidget === 'function') {
                    this.addDOMWidget('htmlPreview', 'html', htmlContainer, {
                        serializeValue: () => '', // Don't serialize the HTML content
                    });
                } else {
                    console.warn('PreviewHTML: addDOMWidget not available, using fallback');
                    // Fallback: try to find the node's DOM element and append
                    // Wait a bit for the node to be fully rendered
                    setTimeout(() => {
                        const nodeElement = this.graph?.canvas?.getNodeElement?.(this);
                        if (nodeElement) {
                            const contentArea = nodeElement.querySelector('.lg-node-widgets') ||
                                nodeElement.querySelector('.node-content') ||
                                nodeElement;
                            if (contentArea && contentArea.appendChild) {
                                contentArea.appendChild(htmlContainer);
                            }
                        }
                    }, 100);
                }
            } catch (error) {
                console.error('PreviewHTML: Error adding HTML container:', error);
            }

            // Store reference for later use
            this.htmlContainer = htmlContainer;
        };

        // Hook into onExecuted to update HTML content
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            if (onExecuted) onExecuted.apply(this, [message]);

            if (this.htmlContainer) {
                if (message.html && message.html[0]) {
                    // Inject HTML and execute scripts
                    injectHTMLWithScripts(this.htmlContainer, message.html[0]);
                } else {
                    // Show placeholder if no HTML content
                    this.htmlContainer.innerHTML = '<div style="padding: 10px; color: #888; text-align: center;">No HTML content to display</div>';
                }
            }
        };
    },
});