from comfy_api.latest import io


class PreviewHTML(io.ComfyNode):
    """
    A node that renders HTML content, including interactive visualizations
    from libraries like circuitsvis. Accepts HTML strings or objects with
    _repr_html_() or __html__() methods.
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="PreviewHTML",
            display_name="Preview HTML",
            category="notebook",
            is_output_node=True,
            inputs=[
                io.AnyType.Input(
                    "html_input",
                    tooltip="HTML content, circuitsvis RenderedHTML object, or any object with _repr_html_() or __html__() method",
                ),
            ],
            outputs=[
                io.String.Output(display_name="HTML"),
            ],
        )

    @classmethod
    def execute(cls, html_input) -> io.NodeOutput:
        """
        Extract HTML string from input and return it for frontend rendering.

        Supports:
        - Objects with _repr_html_() method (Jupyter-style)
        - Objects with __html__() method (alternative HTML representation)
        - Plain strings (assumed to be HTML)
        - Other objects (converted to string)
        """
        html_str = None

        try:
            # Try _repr_html_() first (Jupyter/Colab style)
            if hasattr(html_input, "_repr_html_") and callable(html_input._repr_html_):
                html_str = html_input._repr_html_()
            # Try __html__() as alternative
            elif hasattr(html_input, "__html__") and callable(html_input.__html__):
                html_str = html_input.__html__()
            # If it's already a string, use it directly
            elif isinstance(html_input, str):
                html_str = html_input
            # Fallback: convert to string
            else:
                html_str = str(html_input)
        except Exception as e:
            # If extraction fails, show error message
            html_str = f'<div style="padding: 10px; color: #ff6b6b; background: #2d1b1b; border-radius: 4px;"><strong>Error extracting HTML:</strong> {str(e)}</div>'

        # Ensure we have a valid string
        if html_str is None:
            html_str = '<div style="padding: 10px; color: #888;">No HTML content to display</div>'

        # Return HTML in UI message for frontend rendering
        ui_output = {"html": (html_str,)}

        return io.NodeOutput(html_str, ui=ui_output)
