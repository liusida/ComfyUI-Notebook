import io as io_module
import sys
import torch
import numpy as np
import threading
from comfy_api.latest import io
from comfy_api_nodes.util._helpers import is_processing_interrupted
from comfy_api_nodes.util.common_exceptions import ProcessingInterrupted
import server


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


# Import globals from __init__.py
# These are defined in __init__.py and shared across notebook cells
# Access via sys.modules to avoid circular import issues
def _get_notebook_globals():
    """Get the shared globals from the parent package's __init__.py"""
    # Get the package name (e.g., 'custom_nodes.ComfyUI-Notebook')
    package_name = __package__
    if package_name:
        init_module = sys.modules.get(package_name)
        if init_module and hasattr(init_module, "_NOTEBOOK_KERNELS"):
            return init_module._NOTEBOOK_KERNELS, init_module._PRELOAD_MODULES
    # Fallback: create new dicts if import fails (shouldn't happen in normal usage)
    return {}, {}


# This Utils class can be accessed from the cells using the 'Notebook' object
class NotebookCellUtils:
    plots = []
    expected_plot_shape = None  # Store expected shape: (H, W, 3)

    @classmethod
    def clear_plots(cls):
        cls.plots = []
        cls.expected_plot_shape = None

    @classmethod
    def add_plot(cls):
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
                fig.savefig(buf, format="png", dpi=100)
                buf.seek(0)
                pil_image = PILImage.open(buf)
                plt.close(fig)
                plt.close("all")

                img_array = (
                    np.array(pil_image.convert("RGB")).astype(np.float32) / 255.0
                )
                if cls.expected_plot_shape is None:
                    cls.expected_plot_shape = img_array.shape
                else:
                    if cls.expected_plot_shape != img_array.shape:
                        raise ValueError(f"The figsize of all plots must be the same.")
                cls.plots.append(torch.from_numpy(img_array)[None,])

    @classmethod
    def get_plot_tensor(cls):
        return torch.cat(cls.plots, dim=0)


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
        try:
            workflow_id = cls.hidden.extra_pnginfo["workflow"]["id"]
        except:
            workflow_id = "0"

        _NOTEBOOK_KERNELS, _PRELOAD_MODULES = _get_notebook_globals()

        if workflow_id not in _NOTEBOOK_KERNELS:
            _NOTEBOOK_KERNELS[workflow_id] = {}
        _NOTEBOOK_GLOBALS = _NOTEBOOK_KERNELS[workflow_id]

        # Expose objects to the cells
        NotebookCellUtils.clear_plots()
        _NOTEBOOK_GLOBALS.update(
            {
                "input": input,
                "input_2": input_2,
                "Notebook": NotebookCellUtils,
                "Result": None,
            }
        )
        _NOTEBOOK_GLOBALS.update(_PRELOAD_MODULES)

        # Capture stdout and stderr
        stdout_capture = io_module.StringIO()
        # Store original stdout/stderr
        old_stdout = sys.stdout

        ####
        ## Old Method: compile and exec
        # try:
        #     with torch.inference_mode(False):  # Counter ComfyUI's inference mode
        #         sys.stdout = TeeOutput(old_stdout, stdout_capture)
        #         compiled_code = compile(code, "<string>", "exec", flags=0)
        #         exec(compiled_code, _NOTEBOOK_GLOBALS)
        # finally:
        #     # Restore stdout and stderr
        #     sys.stdout = old_stdout
        ####
        ##
        ## New Method: Temporary file
        # Create temporary file for debugging support
        import hashlib, os, importlib
        from datetime import datetime
        from comfy_execution.utils import get_executing_context

        temp_dir = os.path.join(os.path.dirname(__file__), "temp_notebook_cells")
        os.makedirs(temp_dir, exist_ok=True)

        code_hash = hashlib.md5(code.encode()).hexdigest()[:8]
        context = get_executing_context()
        prompt_id = context.prompt_id if context else "0"
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        try:
            cell_name = (
                cls.SCHEMA.display_name if cls.SCHEMA.display_name else "NotebookCell"
            )
        except:
            cell_name = "NotebookCell"

        safe_workflow_id = "".join(
            c if c.isalnum() or c in ("-", "_") else "_" for c in str(workflow_id)
        )
        node_id = context.node_id if context else "0"
        safe_node_id = "".join(
            c if c.isalnum() or c in ("-", "_") else "_" for c in str(node_id)
        )
        temp_file = os.path.join(
            temp_dir, f"workflow_{safe_workflow_id}_node_{safe_node_id}.py"
        )

        # Generate metadata header
        metadata = f"""####
# Auto-generated by ComfyUI-Notebook extension
# 
# Metadata:
#   Workflow ID: {workflow_id}
#   Node ID: {node_id}
#   Cell name: {cell_name}
#   Code hash: {code_hash}
#   Prompt ID: {prompt_id}
#   Generated at: {timestamp}
# 
# Purpose:
#   This file is created for debugging. Set breakpoints here and use
#   a debugger (VSCode/Cursor) to step through code execution.
#   Note: This file requires ComfyUI-Notebook context and cannot be
#   executed standalone.
####

"""

        with open(temp_file, "w", encoding="utf-8") as f:
            f.write(code)
            f.write(metadata)

        module_name = f"notebook_cell_{safe_workflow_id}_{safe_node_id}"
        try:
            sys.stdout = TeeOutput(old_stdout, stdout_capture)
            sys.modules.pop(module_name, None)
            spec = importlib.util.spec_from_file_location(module_name, temp_file)
            module = importlib.util.module_from_spec(spec)
            module.__dict__.update(_NOTEBOOK_GLOBALS)

            # Execute in a separate thread to allow interrupt checking
            execution_result = {"exception": None}
            execution_event = threading.Event()
            interrupt_flag = threading.Event()

            # Create interrupt check function
            def check_interrupt():
                if interrupt_flag.is_set():
                    raise ProcessingInterrupted("Code execution interrupted by user")

            # Wrap common built-in functions to check interrupts periodically
            _original_range = range
            _original_enumerate = enumerate
            _original_next = next
            _original_iter = iter
            _original_zip = zip
            _original_map = map
            _original_filter = filter

            def interrupt_checking_range(*args, **kwargs):
                check_interrupt()
                return _original_range(*args, **kwargs)

            def interrupt_checking_enumerate(iterable, start=0):
                check_interrupt()
                return _original_enumerate(iterable, start)

            def interrupt_checking_next(iterator, default=None):
                check_interrupt()
                return _original_next(iterator, default)

            def interrupt_checking_iter(obj, sentinel=None):
                check_interrupt()
                return _original_iter(obj, sentinel)

            def interrupt_checking_zip(*iterables, strict=False):
                check_interrupt()
                return _original_zip(*iterables, strict=strict)

            def interrupt_checking_map(func, *iterables):
                check_interrupt()
                return _original_map(func, *iterables)

            def interrupt_checking_filter(function, iterable):
                check_interrupt()
                return _original_filter(function, iterable)

            def execute_in_thread():
                try:
                    # Inject wrapped functions into module globals
                    module.__dict__["range"] = interrupt_checking_range
                    module.__dict__["enumerate"] = interrupt_checking_enumerate
                    module.__dict__["next"] = interrupt_checking_next
                    module.__dict__["iter"] = interrupt_checking_iter
                    module.__dict__["zip"] = interrupt_checking_zip
                    module.__dict__["map"] = interrupt_checking_map
                    module.__dict__["filter"] = interrupt_checking_filter
                    module.__dict__["check_interrupt"] = (
                        check_interrupt  # Also expose for manual checks
                    )

                    with torch.inference_mode(False):  # Counter ComfyUI's mode
                        spec.loader.exec_module(module)
                except Exception as e:
                    execution_result["exception"] = e
                finally:
                    execution_event.set()

            exec_thread = threading.Thread(target=execute_in_thread, daemon=True)
            exec_thread.start()

            last_output_length = 0
            # Monitor thread and check for interrupts
            while not execution_event.wait(timeout=0.1):
                # Sync stdout to GUI periodically
                current_output = stdout_capture.getvalue()
                display_node_id = None
                if len(current_output) > last_output_length:
                    try:
                        if server.PromptServer.instance and context:
                            display_node_id = (
                                cls.hidden.unique_id
                                if hasattr(cls.hidden, "unique_id")
                                else context.node_id
                            )
                            ui_output = {"text": (current_output,)}
                            server.PromptServer.instance.send_sync(
                                "executed",
                                {
                                    "node": context.node_id,
                                    "display_node": display_node_id,
                                    "output": ui_output,
                                    "prompt_id": context.prompt_id,
                                },
                                server.PromptServer.instance.client_id,
                            )
                    except Exception:
                        pass  # Ignore errors in UI updates
                    last_output_length = len(current_output)

                if is_processing_interrupted():
                    interrupt_flag.set()
                    ui_output = {
                        "text": (current_output + "\n[Execution interrupted by user]",)
                    }
                    server.PromptServer.instance.send_sync(
                        "executed",
                        {
                            "node": context.node_id,
                            "display_node": display_node_id,
                            "output": ui_output,
                            "prompt_id": context.prompt_id,
                        },
                        server.PromptServer.instance.client_id,
                    )
                    raise ProcessingInterrupted("Code execution interrupted by user")

            if execution_result["exception"]:
                raise execution_result["exception"]

            keys_to_exclude = {
                "__name__",
                "__file__",
                "__package__",
                "__loader__",
                "__spec__",
                "__doc__",
                "__dict__",
                "__module__",
                "__builtins__",
                "__cached__",
            }
            module_vars = {
                k: v for k, v in module.__dict__.items() if k not in keys_to_exclude
            }
            _NOTEBOOK_GLOBALS.update(module_vars)

        finally:
            # Restore stdout and stderr
            sys.stdout = old_stdout
            sys.modules.pop(module_name, None)

        # Get captured output
        stdout_output = stdout_capture.getvalue()
        # Combine outputs
        output_Stdout = ""
        if stdout_output:
            output_Stdout += stdout_output

        # Auto-capture matplotlib figures at the end (like Jupyter does)
        NotebookCellUtils.add_plot()
        # Create Plot output tensor
        if NotebookCellUtils.plots:
            output_Plot = NotebookCellUtils.get_plot_tensor()
        else:
            output_Plot = torch.ones((1, 1, 1, 3), dtype=torch.float32)

        output_Result = _NOTEBOOK_GLOBALS.get("Result", None)

        # Clean up the output
        if not output_Stdout:
            output_Stdout = "[No output]"

        # Create UI output to display the results
        ui_output = {"text": (output_Stdout,)}

        # return three slots: Result, Plot, Stdout
        return io.NodeOutput(output_Result, output_Plot, output_Stdout, ui=ui_output)
