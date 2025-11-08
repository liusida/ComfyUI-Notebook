from typing_extensions import override
import io as io_module
import sys
import os
import torch
import numpy as np
from comfy_api.latest import ComfyExtension, io

# Set web directory for frontend extensions
WEB_DIRECTORY = os.path.join(os.path.dirname(__file__), "web")


# Global dictionary for sharing variables between notebook cells
_NOTEBOOK_GLOBALS = {}
_PRELOAD_MODULES = {}


class NotebookCell(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="NotebookCell",
            display_name="Notebook: Cell",
            category="notebook",
            is_output_node=True,
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
                    tooltip="Optional input from another cell. Access via 'input' variable.",
                ),
                io.AnyType.Input(
                    "input_2",
                    optional=True,
                    tooltip="Optional extra input. Access via 'input_2' variable.",
                ),
            ],
            outputs=[
                io.AnyType.Output(display_name="Result"),
                io.Image.Output(display_name="Plot"),
                io.String.Output(display_name="Stdout"),
            ],
        )

    @classmethod
    def execute(cls, code: str, input=None, input_2=None) -> io.NodeOutput:
        # Create a custom namespace with common imports
        _NOTEBOOK_GLOBALS.update(
            {
                "input": input,  # Make input available to the code
                "input_2": input_2,  # Make input available to the code
                "Result": None,  # Make Result available to the code
            }
        )
        _NOTEBOOK_GLOBALS.update(_PRELOAD_MODULES)

        # Capture stdout and stderr
        stdout_capture = io_module.StringIO()
        # Store original stdout/stderr
        old_stdout = sys.stdout

        class TeeOutput:
            """Write to both original stdout and capture buffer"""

            def __init__(self, original, capture):
                self.original = original
                self.capture = capture

            def write(self, text):
                self.original.write(text)
                self.capture.write(text)

            def flush(self):
                self.original.flush()
                self.capture.flush()

            def __getattr__(self, name):
                # Delegate any other attributes to original stdout
                return getattr(self.original, name)

        try:
            with torch.inference_mode(False):  # Counter ComfyUI's inference mode
                sys.stdout = TeeOutput(old_stdout, stdout_capture)
                compiled_code = compile(code, "<string>", "exec", flags=0)
                exec(compiled_code, _NOTEBOOK_GLOBALS)
        finally:
            # Restore stdout and stderr
            sys.stdout = old_stdout
        # Get captured output
        stdout_output = stdout_capture.getvalue()
        # Combine outputs
        all_output = ""
        if stdout_output:
            all_output += stdout_output

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
                    fig.savefig(buf, format="png", dpi=100, bbox_inches="tight")
                    buf.seek(0)
                    pil_image = PILImage.open(buf)
                    plt.close(fig)
                    plt.close("all")

                    img_array = (
                        np.array(pil_image.convert("RGB")).astype(np.float32) / 255.0
                    )
                    image_output = torch.from_numpy(img_array)[None,]

        except:
            pass

        # Create a default 1x1 pixel image if no image output
        if image_output is None:
            # Create a 1x1 white pixel image (RGB)
            image_output = torch.ones((1, 1, 1, 3), dtype=torch.float32)

        result = _NOTEBOOK_GLOBALS.get("Result", None)
        # # Display `Result`
        # if result is not None and str(result) != "None":
        #     all_output += "[Result]\n"
        #     all_output += str(result)

        # Clean up the output
        if not all_output:
            all_output = "[No output]"

        # Create UI output to display the results
        ui_output = {"text": (all_output,)}

        # return three slots: Result, Plot, Stdout
        return io.NodeOutput(result, image_output, all_output, ui=ui_output)


class NotebookForceRerun(io.ComfyNode):
    """
    A node that forces re-execution of downstream nodes, useful for debugging,
    generating random data, or when you want a node to run every time regardless
    of whether its other inputs have changed.
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="NotebookForceRerun",
            display_name="Notebook: Force Rerun",
            category="notebook",
            inputs=[],
            outputs=[
                io.AnyType.Output(display_name="Trigger"),
            ],
        )

    @classmethod
    def IS_CHANGED(cls):
        import time

        return time.time()

    @classmethod
    def execute(cls) -> io.NodeOutput:
        return io.NodeOutput(True)


class NotebookExtension(ComfyExtension):
    """
    Extension class that registers the Notebook nodes.
    """

    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [
            NotebookCell,
            NotebookForceRerun,
        ]


async def comfy_entrypoint() -> NotebookExtension:
    """
    ComfyUI entrypoint to load the notebook extension.
    This function is called by ComfyUI to discover and load the custom nodes.
    """

    try:
        import torch.nn as nn
        import torch.nn.functional as F
        import PIL.Image as Image

        _PRELOAD_MODULES.update(
            {
                "np": np,
                "numpy": np,
                "torch": torch,
                "nn": nn,
                "F": F,
                "Image": Image,
            }
        )

        import matplotlib
        import matplotlib.pyplot as plt

        matplotlib.use("Agg")  # Use non-interactive backend
        _PRELOAD_MODULES.update(
            {
                "matplotlib": matplotlib,
                "plt": plt,
            }
        )

        def custom_show(*args, **kwargs):
            """No-op like Jupyter notebook. Figure will be auto-captured at the end."""
            pass

        plt.show = custom_show
    except ImportError:
        pass

    # Register API routes after globals are defined
    from . import notebook_apis

    notebook_apis.register_routes(_NOTEBOOK_GLOBALS, _PRELOAD_MODULES)

    return NotebookExtension()
