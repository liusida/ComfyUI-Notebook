from typing_extensions import override
import os
import torch
import numpy as np
from comfy_api.latest import ComfyExtension, io
from .node_notebook_cell import NotebookCell
from .node_preview_html import PreviewHTML
from .node_notebook_force_rerun import NotebookForceRerun

# Set web directory for frontend extensions
WEB_DIRECTORY = os.path.join(os.path.dirname(__file__), "web")


# Global dictionary for sharing variables between notebook cells
_NOTEBOOK_GLOBALS = {}
_PRELOAD_MODULES = {}


class NotebookExtension(ComfyExtension):
    """
    Extension class that registers the Notebook nodes.
    """

    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [
            NotebookCell,
            NotebookForceRerun,
            PreviewHTML,
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
