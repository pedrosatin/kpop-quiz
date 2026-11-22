"""Pytest hooks for the Python verification job.

Imports the Hypothesis profile so xdist workers and the controller share the
same derandomized seed and deadline as ``python -m unittest``.
"""

from __future__ import annotations

# Side effect: register and load the parser-ci profile when Hypothesis is in
# the environment (requirements-ci.txt). Harmless when it is absent.
try:
    import tests.hypothesis_profile  # noqa: F401
except ImportError:
    pass
