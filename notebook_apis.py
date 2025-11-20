import server
import types
import inspect
import os
import shutil
from aiohttp import web


def register_routes(_NOTEBOOK_KERNELS, _PRELOAD_MODULES):
    @server.PromptServer.instance.routes.post("/notebook/free")
    async def clear_notebook_namespace_and_free_memory(request):
        try:
            payload = await request.json()
        except Exception:
            payload = {}

        workflow_id = payload.get("workflow_id")
        cleared = []

        if workflow_id and workflow_id in _NOTEBOOK_KERNELS:
            _NOTEBOOK_KERNELS.pop(workflow_id, None)
            cleared.append(workflow_id)
        else:
            cleared.extend(list(_NOTEBOOK_KERNELS.keys()))
            _NOTEBOOK_KERNELS.clear()

        server.PromptServer.instance.prompt_queue.set_flag("unload_models", True)
        server.PromptServer.instance.prompt_queue.set_flag("free_memory", True)

        return web.json_response(
            {
                "status": "ok",
                "cleared": cleared,
                "scope": "partial" if workflow_id else "all",
            }
        )

    @server.PromptServer.instance.routes.get("/notebook/list_variables")
    async def list_notebook_variables(request):

        kernels = {}
        list_to_ignore = [
            "input",
            "input_2",
            "Result",
            "__builtins__",
            "check_interrupt",
            "range",
            "enumerate",
            "next",
            "iter",
            "zip",
            "map",
            "filter",
        ]
        list_to_ignore.extend(_PRELOAD_MODULES.keys())

        for workflow_id, globals_dict in _NOTEBOOK_KERNELS.items():
            variables = {}
            for key, value in globals_dict.items():
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
            kernels[workflow_id] = variables

        return web.json_response(
            {"status": "ok", "count": len(kernels), "kernels": kernels}
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
