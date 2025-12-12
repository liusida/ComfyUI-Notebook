import types

"""
Fixes memory leaks caused by functions/classes defined in notebook cells.
Functions have __globals__ pointing to the temporary module.__dict__, preventing
garbage collection of old module dicts and tensors. This recreates functions/classes
with __globals__ pointing to _NOTEBOOK_GLOBALS instead.
"""


def _is_notebook_cell_symbol(obj):
    """Return True for objects defined in temporary notebook cell modules."""
    mod = getattr(obj, "__module__", None)
    return isinstance(mod, str) and mod.startswith("notebook_cell_")


def fix_function_globals(func, _NOTEBOOK_GLOBALS):
    """Recursively fix __globals__ for a function and its closure."""
    if not isinstance(func, types.FunctionType):
        return func
    # Skip external/library functions to avoid breaking their dependencies
    if not _is_notebook_cell_symbol(func):
        return func
    try:
        # Note: We preserve the original closure cells as-is.
        # Closure cells contain variables from the enclosing scope, not functions.
        # If a closure cell contains a function, that function would have been
        # defined in an outer scope and its __globals__ would already be correct
        # (or would be fixed separately if it's in _NOTEBOOK_GLOBALS).
        # We don't need to modify closure cells here.

        # Recreate function with updated globals
        new_func = types.FunctionType(
            func.__code__,
            _NOTEBOOK_GLOBALS,  # This creates a circular reference, but that's fine
            func.__name__,
            func.__defaults__,
            func.__closure__,  # Preserve original closure
        )
        new_func.__dict__.update(func.__dict__)
        new_func.__annotations__ = getattr(func, "__annotations__", {})
        return new_func
    except Exception:
        return func


def fix_class_globals(cls, _NOTEBOOK_GLOBALS):
    """Fix __globals__ for all methods in a class without recreating it."""
    if not isinstance(cls, type):
        return cls
    # Skip external/library classes
    if not _is_notebook_cell_symbol(cls):
        return cls
    try:
        for key, value in list(cls.__dict__.items()):
            if isinstance(value, types.FunctionType):
                setattr(cls, key, fix_function_globals(value, _NOTEBOOK_GLOBALS))
            elif isinstance(value, classmethod):
                setattr(cls, key, classmethod(fix_function_globals(value.__func__, _NOTEBOOK_GLOBALS)))
            elif isinstance(value, staticmethod):
                setattr(cls, key, staticmethod(fix_function_globals(value.__func__, _NOTEBOOK_GLOBALS)))
            elif isinstance(value, property):
                fget = fix_function_globals(value.fget, _NOTEBOOK_GLOBALS) if value.fget else None
                fset = fix_function_globals(value.fset, _NOTEBOOK_GLOBALS) if value.fset else None
                fdel = fix_function_globals(value.fdel, _NOTEBOOK_GLOBALS) if value.fdel else None
                setattr(cls, key, property(fget, fset, fdel, value.__doc__))
        return cls
    except Exception:
        return cls


def fix_value_globals(value, _NOTEBOOK_GLOBALS):
    """Fix __globals__ for any value that might have it."""
    if isinstance(value, types.FunctionType):
        return fix_function_globals(value, _NOTEBOOK_GLOBALS)
    elif isinstance(value, type):
        return fix_class_globals(value, _NOTEBOOK_GLOBALS)
    elif isinstance(value, (list, tuple)):
        return type(value)(fix_value_globals(item, _NOTEBOOK_GLOBALS) for item in value)
    elif isinstance(value, dict):
        return {k: fix_value_globals(v, _NOTEBOOK_GLOBALS) for k, v in value.items()}
    elif isinstance(value, types.MethodType):
        # Bound method - fix the underlying function
        return types.MethodType(fix_function_globals(value.__func__, _NOTEBOOK_GLOBALS), value.__self__)
    else:
        return value
