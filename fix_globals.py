import types

"""
Fixes memory leaks caused by functions/classes defined in notebook cells.
Functions have __globals__ pointing to the temporary module.__dict__, preventing
garbage collection of old module dicts and tensors. This recreates functions/classes
with __globals__ pointing to _NOTEBOOK_GLOBALS instead.
"""


def fix_function_globals(func, _NOTEBOOK_GLOBALS):
    """Recursively fix __globals__ for a function and its closure."""
    if not isinstance(func, types.FunctionType):
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
    """Fix __globals__ for all methods in a class."""
    if not isinstance(cls, type):
        return cls
    try:
        # Create new class dict with fixed methods
        new_dict = {}
        for key, value in cls.__dict__.items():
            if isinstance(
                value,
                (types.FunctionType, classmethod, staticmethod, property),
            ):
                if isinstance(value, types.FunctionType):
                    new_dict[key] = fix_function_globals(value, _NOTEBOOK_GLOBALS)
                elif isinstance(value, classmethod):
                    # classmethod wraps a function
                    new_dict[key] = classmethod(fix_function_globals(value.__func__, _NOTEBOOK_GLOBALS))
                elif isinstance(value, staticmethod):
                    # staticmethod wraps a function
                    new_dict[key] = staticmethod(fix_function_globals(value.__func__, _NOTEBOOK_GLOBALS))
                elif isinstance(value, property):
                    # property has fget, fset, fdel which are functions
                    fget = fix_function_globals(value.fget, _NOTEBOOK_GLOBALS) if value.fget else None
                    fset = fix_function_globals(value.fset, _NOTEBOOK_GLOBALS) if value.fset else None
                    fdel = fix_function_globals(value.fdel, _NOTEBOOK_GLOBALS) if value.fdel else None
                    new_dict[key] = property(fget, fset, fdel, value.__doc__)
                else:
                    new_dict[key] = value
            else:
                new_dict[key] = value

        # Recreate class with fixed methods
        return type(cls.__name__, cls.__bases__, new_dict)
    except Exception:
        return cls


def fix_value_globals(value, _NOTEBOOK_GLOBALS):
    """Fix __globals__ for any value that might have it."""
    if isinstance(value, types.FunctionType):
        return fix_function_globals(value, _NOTEBOOK_GLOBALS)
    # elif isinstance(value, type):
    #     return fix_class_globals(value, _NOTEBOOK_GLOBALS)
    elif isinstance(value, (list, tuple)):
        return type(value)(fix_value_globals(item, _NOTEBOOK_GLOBALS) for item in value)
    elif isinstance(value, dict):
        return {k: fix_value_globals(v, _NOTEBOOK_GLOBALS) for k, v in value.items()}
    elif isinstance(value, types.MethodType):
        # Bound method - fix the underlying function
        return types.MethodType(fix_function_globals(value.__func__, _NOTEBOOK_GLOBALS), value.__self__)
    else:
        return value
