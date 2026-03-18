import server
import types
import inspect
import os
import shutil
import subprocess
from pathlib import Path
from aiohttp import web
import logging


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
            "__doc__",
            "__loader__",
            "__name__",
            "__package__",
            "__spec__",
            "__file__",
            "__cached__",
        ]
        list_to_ignore.extend(_PRELOAD_MODULES.keys())

        for workflow_id, kernel in _NOTEBOOK_KERNELS.items():
            variables = {}
            for key, value in kernel.__dict__.items():
                try:
                    if key in list_to_ignore or isinstance(value, types.ModuleType) or inspect.isclass(value):
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

        return web.json_response({"status": "ok", "count": len(kernels), "kernels": kernels})

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

    @server.PromptServer.instance.routes.post("/notebook/reboot")
    async def reboot_server(request):
        """
        Restart the ComfyUI server.
        """
        try:
            import sys
            import os

            # Close stdout logging if available
            try:
                sys.stdout.close_log()
            except Exception:
                pass

            # If using CLI wrapper, create reboot marker file
            if "__COMFY_CLI_SESSION__" in os.environ:
                with open(os.path.join(os.environ["__COMFY_CLI_SESSION__"] + ".reboot"), "w"):
                    pass
                print("\nRestarting...\n\n")
                exit(0)

            # Legacy mode: use os.execv to replace current process
            print("\nRestarting ComfyUI...\n\n")

            sys_argv = sys.argv.copy()

            # Handle Windows standalone build flag
            if "--windows-standalone-build" in sys_argv:
                sys_argv.remove("--windows-standalone-build")

            # Build command to restart
            if sys_argv[0].endswith("__main__.py"):  # Python module mode
                module_name = os.path.basename(os.path.dirname(sys_argv[0]))
                cmds = [sys.executable, "-m", module_name] + sys_argv[1:]
            elif sys.platform.startswith("win32"):
                cmds = ['"' + sys.executable + '"', '"' + sys_argv[0] + '"'] + sys_argv[1:]
            else:
                cmds = [sys.executable] + sys_argv

            print(f"Command: {cmds}", flush=True)
            print("--------------------------------------------------------------------------\n")

            # Replace current process with new one (this restarts the server)
            os.execv(sys.executable, cmds)

        except Exception as e:
            return web.json_response({"status": "error", "message": str(e)}, status=500)

    def run_git_push():
        """
        Run git add/commit/push in the cloned repo under user/default.
        Uses whatever remote/SSH config that repo already has.
        """
        # Repo is checked out under the main ComfyUI workspace: /workspace/ComfyUI/user/default
        # __file__ is .../custom_nodes/ComfyUI-Notebook/notebook_apis.py
        # So go up two levels to the ComfyUI root, then into user/default
        repo_root = Path(__file__).resolve().parents[2] / "user" / "default"
        logging.info("[Notebook Git] Using repo root: %s", str(repo_root))

        ssh_key = "/workspace/.ssh/id_ed25519"
        git_ssh_command = f"ssh -i {ssh_key} -o StrictHostKeyChecking=no"

        def run(cmd, check=True, label=""):
            logging.info("[Notebook Git] Running %s: %s", label or "command", " ".join(cmd))
            env = os.environ.copy()
            env["GIT_SSH_COMMAND"] = git_ssh_command
            result = subprocess.run(
                cmd,
                cwd=repo_root,
                check=check,
                capture_output=True,
                text=True,
                env=env,
            )
            logging.info("[Notebook Git] %s exit code: %s", label or "command", result.returncode)
            if result.stdout:
                logging.info("[Notebook Git] %s stdout:\n%s", label or "command", result.stdout.strip())
            if result.stderr:
                logging.info("[Notebook Git] %s stderr:\n%s", label or "command", result.stderr.strip())
            return result

        try:
            add_result = run(["git", "add", "-A"], label="git add")

            diff_result = subprocess.run(
                ["git", "diff", "--cached", "--quiet"],
                cwd=repo_root,
            )
            logging.info("[Notebook Git] git diff --cached --quiet exit code: %s", diff_result.returncode)
            has_staged_changes = diff_result.returncode != 0

            commit_result = None
            if has_staged_changes:
                commit_message = os.environ.get(
                    "COMFY_NOTEBOOK_GIT_MESSAGE",
                    "ComfyUI-Notebook: auto-commit",
                )
                commit_result = run(["git", "commit", "-m", commit_message], label="git commit")
            else:
                logging.info("[Notebook Git] No new changes to commit, will still push existing commits.")

            # Determine current branch and push explicitly to origin
            branch_result = run(["git", "rev-parse", "--abbrev-ref", "HEAD"], label="git rev-parse")
            current_branch = branch_result.stdout.strip() or "HEAD"
            logging.info("[Notebook Git] Current branch resolved to: %s", current_branch)
            push_result = run(["git", "push", "origin", current_branch], label="git push")

            summary_parts = [
                part
                for part in [
                    add_result.stdout.strip(),
                    (commit_result.stdout.strip() if commit_result else ""),
                    push_result.stdout.strip(),
                ]
                if part
            ]
            summary = "\n".join(summary_parts) or "Git push completed"

            return {"status": "ok", "message": summary}
        except subprocess.CalledProcessError as e:
            logging.error("[Notebook Git] Git push failed: %s", e.stderr or str(e))
            return {
                "status": "error",
                "message": e.stderr or str(e),
            }
        except Exception as e:
            logging.exception("[Notebook Git] Unexpected git push error")
            return {
                "status": "error",
                "message": str(e),
            }

    @server.PromptServer.instance.routes.post("/notebook/git_push")
    async def notebook_git_push(request):
        """
        Add/commit/push changes in the user/default repo.
        """
        result = run_git_push()
        status = 200 if result.get("status") == "ok" else 500
        return web.json_response(result, status=status)
