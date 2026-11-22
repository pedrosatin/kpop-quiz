"""Hypothesis profile used by the parser property tests.

Loaded by ``tests/test_parser_properties.py`` and by ``tests/conftest.py`` so
both ``python -m unittest`` and the CI pytest command share one seed and the
same example budget. ``derandomize=True`` fixes the sequence without an env
var; ``max_examples`` stays low enough that the suite grows by a few seconds.
"""

from __future__ import annotations

from datetime import timedelta

try:
    from hypothesis import HealthCheck, Phase, settings
except ImportError:  # pragma: no cover - optional CI dependency
    settings = None
else:
    # Normal parser calls on the adversarial shapes stay under ~10 ms of CPU.
    # The pre-fix TEMPLATE_NAME / ANY_INFOBOX patterns take ~0.9 s at size 400
    # and several seconds at size 800, so 500 ms catches them with room for a
    # loaded CI runner on the healthy path.
    settings.register_profile(
        "parser-ci",
        derandomize=True,
        database=None,
        max_examples=40,
        deadline=timedelta(milliseconds=500),
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
        phases=[Phase.explicit, Phase.reuse, Phase.generate, Phase.target],
    )
    settings.load_profile("parser-ci")
