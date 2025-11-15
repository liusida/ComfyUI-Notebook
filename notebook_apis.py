import server
import types
import inspect
import os
import shutil
from aiohttp import web


def register_routes(_NOTEBOOK_GLOBALS, _PRELOAD_MODULES):
    @server.PromptServer.instance.routes.post("/notebook/free")
    async def clear_notebook_namespace_and_free_memory(request):
        _NOTEBOOK_GLOBALS.clear()
        server.PromptServer.instance.prompt_queue.set_flag("unload_models", True)
        server.PromptServer.instance.prompt_queue.set_flag("free_memory", True)
        return web.json_response({"status": "ok"})

    @server.PromptServer.instance.routes.get("/notebook/list_variables")
    async def list_notebook_variables(request):

        variables = {}
        list_to_ignore = ["input", "input_2", "Result", "__builtins__"]
        list_to_ignore.extend(_PRELOAD_MODULES.keys())

        for key, value in _NOTEBOOK_GLOBALS.items():
            try:
                if (
                    key in list_to_ignore
                    or isinstance(value, types.ModuleType)
                    or inspect.isclass(value)
                ):
                    continue

                # Simple representation
                try:
                    repr_str = str(value)
                    if len(repr_str) > 50:
                        repr_str = repr_str[:50] + "... (truncated)"
                except Exception:
                    repr_str = "<unable to represent>"

                variables[key] = {"type": type(value).__name__, "repr": repr_str}
            except Exception as e:
                variables[key] = {
                    "type": type(value).__name__,
                    "repr": f"<error: {str(e)}>",
                }

        return web.json_response(
            {"status": "ok", "count": len(variables), "variables": variables}
        )

    @server.PromptServer.instance.routes.post("/notebook/clear_temp_files")
    async def clear_temp_files(request):
        temp_dir = os.path.join(os.path.dirname(__file__), "temp_notebook_cells")
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
            os.makedirs(temp_dir, exist_ok=True)
            return web.json_response({"status": "ok"})
        except Exception as e:
            return web.json_response({"status": "error", "message": str(e)}, status=500)
