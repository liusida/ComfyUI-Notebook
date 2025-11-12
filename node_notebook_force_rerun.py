import time
from comfy_api.latest import io


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
        return time.time()

    @classmethod
    def execute(cls) -> io.NodeOutput:
        return io.NodeOutput(True)

