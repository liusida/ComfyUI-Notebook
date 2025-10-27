from typing_extensions import override
import io as io_module
import sys
import traceback
import json
import os

from comfy_api.latest import ComfyExtension, io

# Set web directory for frontend extensions
WEB_DIRECTORY = os.path.join(os.path.dirname(__file__), "web")


# Global dictionary for sharing variables between notebook cells
_NOTEBOOK_GLOBALS = {}


class NotebookCell(io.ComfyNode):
    """
    A Jupyter-notebook-style cell for executing Python code.
    
    Features:
    - Multiline textarea with syntax highlighting
    - Captures stdout/stderr output
    - Access to common libraries (numpy, torch, matplotlib, etc.)
    - Returns execution results as strings or images
    - Optional input to receive data from another cell
    - Dynamic variable previews
    """
    
    @classmethod
    def define_schema(cls) -> io.Schema:
        """
        Define the node schema with a multiline textarea for Python code.
        """
        return io.Schema(
            node_id="NotebookCell",
            display_name="Notebook Cell",
            category="notebook",
            inputs=[
                io.String.Input(
                    "code",
                    multiline=True,
                    default="",
                    tooltip="Python code to execute. Use 'input' for connected data, 'globals' for sharing between cells.",
                ),
                io.AnyType.Input(
                    "input",
                    optional=True,
                    tooltip="Optional input from another cell's output. Access via 'input' variable.",
                ),
            ],
            outputs=[
                io.AnyType.Output(display_name="Result"),
                io.Image.Output(display_name="Plot"),
                io.String.Output(display_name="Output"),
            ],
        )
    
    @classmethod
    def execute(cls, code: str, input=None) -> io.NodeOutput:
        """
        Execute the provided Python code and return the results.
        
        Args:
            code: The Python code to execute
            input: Optional input from connected nodes
            
        Returns:
            NodeOutput with captured stdout/stderr and execution results
        """
        if not code or not code.strip():
            return io.NodeOutput("")
        
        # Create a custom namespace with common imports
        namespace = {
            "__builtins__": __builtins__,
            "__name__": "__main__",
            "print": print,  # Will be overridden to capture output
            "input": input,  # Make input available to the code
            "globals": _NOTEBOOK_GLOBALS,  # Global variables shared between cells
        }
        
        # Add common libraries to namespace
        try:
            import numpy as np
            namespace["np"] = np
            namespace["numpy"] = np
        except ImportError:
            pass
        
        try:
            import torch
            namespace["torch"] = torch
        except ImportError:
            pass
        
        try:
            import PIL.Image as Image
            namespace["Image"] = Image
            namespace["PIL"] = __import__("PIL")
        except ImportError:
            pass
        
        try:
            import matplotlib
            matplotlib.use('Agg')  # Use non-interactive backend
            import matplotlib.pyplot as plt
            from io import BytesIO
            from PIL import Image
            
            # Make plt.show() a no-op like in Jupyter notebook
            def custom_show(*args, **kwargs):
                """No-op like Jupyter notebook. Figure will be auto-captured at the end."""
                pass

            plt.show = custom_show
            namespace["plt"] = plt
            namespace["matplotlib"] = matplotlib
            
        except ImportError:
            pass
        
        # Capture stdout and stderr
        stdout_capture = io_module.StringIO()
        stderr_capture = io_module.StringIO()
        
        # Store original stdout/stderr
        old_stdout = sys.stdout
        old_stderr = sys.stderr
        
        try:
            # Redirect stdout and stderr
            sys.stdout = stdout_capture
            sys.stderr = stderr_capture
            
            # Override print to capture to our stdout_capture
            def custom_print(*args, **kwargs):
                kwargs.setdefault('file', stdout_capture)
                __builtins__['print'](*args, **kwargs)
                old_stdout.write(' '.join(str(arg) for arg in args) + '\n')
            
            namespace['print'] = custom_print
            
            # Execute the code
            try:
                # Use compile to get better error messages
                compiled_code = compile(code, '<string>', 'exec', flags=0)
                exec(compiled_code, namespace)
                
                # Try to get the last expression result
                # If the code ends with an expression (not just a statement), store it
                lines = [line.strip() for line in code.strip().split('\n') if line.strip()]
                if lines:
                    last_line = lines[-1]
                    # Skip if it's a comment or a statement assignment or a print statement
                    if (not last_line.startswith('#') and 
                        not last_line.startswith('def ') and
                        not last_line.startswith('class ') and
                        not last_line.startswith('if ') and
                        not last_line.startswith('for ') and
                        not last_line.startswith('while ') and
                        not last_line.startswith('with ') and
                        not last_line.startswith('import ') and
                        not last_line.endswith(':') and
                        not last_line.startswith('print(')):
                        
                        # Try to evaluate the last line if it's an expression
                        try:
                            last_expr = compile(last_line, '<string>', 'eval')
                            last_result = eval(last_expr, namespace)
                            namespace['_result'] = last_result
                        except:
                            pass  # Last line is a statement, not an expression
                    
            except Exception as e:
                # Format error with traceback
                error_msg = ''.join(traceback.format_exception(type(e), e, e.__traceback__))
                stderr_capture.write(error_msg)
                
        finally:
            # Restore stdout and stderr
            sys.stdout = old_stdout
            sys.stderr = old_stderr
        
        # Get captured output
        stdout_output = stdout_capture.getvalue()
        stderr_output = stderr_capture.getvalue()
        
        # Combine outputs
        all_output = ""
        if stdout_output:
            all_output += stdout_output
        if stderr_output:
            if all_output:
                all_output += "\n"
            all_output += "[ERROR]\n" + stderr_output
        
        # Get result from namespace (only get once)
        result = namespace.get('_result', None)
        
        image_output = None
        # Auto-capture matplotlib figures at the end (like Jupyter does)
        try:
            import matplotlib.pyplot as plt
            from PIL import Image as PILImage
            from io import BytesIO
            
            # Check if there's a current figure with plots
            fig = plt.gcf()
            if fig.get_axes():
                # Check if figure has actual data
                has_data = False
                for ax in fig.get_axes():
                    if ax.lines or ax.patches or ax.collections or ax.images:
                        has_data = True
                        break
                
                if has_data:
                    buf = BytesIO()
                    fig.savefig(buf, format='png', dpi=100, bbox_inches='tight')
                    buf.seek(0)
                    pil_image = PILImage.open(buf)
                    plt.close(fig)
                    import torch
                    import numpy as np
                    img_array = np.array(pil_image.convert("RGB")).astype(np.float32) / 255.0
                    image_output = torch.from_numpy(img_array)[None,]

        except:
            pass
        
        # Create a default 1x1 pixel image if no image output
        if image_output is None:
            try:
                import torch
                # Create a 1x1 white pixel image (RGB)
                image_output = torch.ones((1, 1, 1, 3), dtype=torch.float32)
            except:
                pass
        
        # For non-dict results, display normally
        if result is not None and str(result) != 'None':
            try:
                all_output += str(result)
            except:
                all_output += repr(result)
        
        # Clean up the output
        if not all_output:
            all_output = "[No output]"
        
        # Create UI output to display the results
        ui_output = {"text": (all_output,)}
        
        # Return with image output (always provided now)
        return io.NodeOutput(result, image_output, all_output, ui=ui_output)


class NotebookExtension(ComfyExtension):
    """
    Extension class that registers the NotebookCell node.
    """
    
    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [
            NotebookCell,
        ]


async def comfy_entrypoint() -> NotebookExtension:
    """
    ComfyUI entrypoint to load the notebook extension.
    This function is called by ComfyUI to discover and load the custom nodes.
    """
    return NotebookExtension()

