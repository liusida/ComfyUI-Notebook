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
                    "html",
                    optional=True,
                    tooltip="HTML content, circuitsvis RenderedHTML object, or any object with _repr_html_() or __html__() method",
                ),
            ],
            outputs=[
                io.String.Output(display_name="HTML"),
            ],
        )

    @classmethod
    def execute(cls, html=None) -> io.NodeOutput:
        """
        Extract HTML string from input and return it for frontend rendering.

        Supports:
        - Objects with _repr_html_() method (Jupyter-style)
        - Objects with __html__() method (alternative HTML representation)
        - Plain strings (assumed to be HTML)
        - Other objects (converted to string)
        """
        html_str = None

        # Handle case when input is not connected (optional=True)
        if html is None:
            html_str = "<div />"
        else:
            try:
                # Try _repr_html_() first (Jupyter/Colab style)
                if hasattr(html, "_repr_html_") and callable(html._repr_html_):
                    html_str = html._repr_html_()
                # Try __html__() as alternative
                elif hasattr(html, "__html__") and callable(html.__html__):
                    html_str = html.__html__()
                # If it's already a string, use it directly
                elif isinstance(html, str):
                    html_str = html
                # Fallback: convert to string
                else:
                    html_str = str(html)
            except Exception as e:
                # If extraction fails, show error message
                html_str = f'<div style="padding: 10px; color: #ff6b6b; background: #2d1b1b; border-radius: 4px;"><strong>Error extracting HTML:</strong> {str(e)}</div>'

        # Ensure we have a valid string
        if html_str is None:
            html_str = "<div />"

        # Return HTML in UI message for frontend rendering
        ui_output = {"html": (html_str,)}

        return io.NodeOutput(html_str, ui=ui_output)
