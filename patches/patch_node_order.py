# Run this patch to put NotebookCell and PreviewAny at the top of the node list

import comfyui_frontend_package, importlib.resources, json

with importlib.resources.as_file(
    importlib.resources.files(comfyui_frontend_package)
    / "static"
    / "assets"
    / "sorted-custom-node-map.json"
) as f:
    data = json.load(open(f, "r", encoding="utf-8"))
    json.dump(
        {
            "NotebookCell": 9999,
            "PreviewAny": 9998,
            **{
                k: v for k, v in data.items() if k not in ("NotebookCell", "PreviewAny")
            },
        },
        open(str(f), "w", encoding="utf-8"),
        indent=2,
        ensure_ascii=False,
    )

print("Patched node order successfully.")
