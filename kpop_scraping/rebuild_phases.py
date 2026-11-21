"""Time, requests and maxlag waits of each phase of one collector run.

The nightly rebuild runs ``python main.py --facts --releases --release-rotate``. Its log used to
show only the total, so a slow night could not be told apart: a lagged
Wikidata, a large download or slow writes all looked the same. The CLI now
installs a :class:`PhaseLog` for the run and prints one line per phase at the
end, also when the run fails:

``listing``
    Category members and the WDQS release discovery.
``revisions``
    Requests that ask only for the current revision of pages or entities.
``download``
    Every other Wikimedia request: page extracts, entity documents, type
    checks, wikitext.
``extraction``
    The rest of the pipeline's own work: classification, fact candidates,
    validation.
``storage``
    Snapshot writes, database writes and commits, CSV reports.

Time goes to the innermost phase open at that moment, so a request made
while the fact pipeline runs counts as ``download`` and not as
``extraction``. The time a client spends waiting for ``maxlag`` to clear is
part of the phase of the request that waited, and the line also shows it
apart.

Modules report through the functions of this module. They do nothing while
no log is installed, so tests and the other CLIs pay nothing and see no
output. Importing the module starts nothing.
"""

from __future__ import annotations

import functools
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any, TypeVar

LISTING = "listing"
REVISIONS = "revisions"
DOWNLOAD = "download"
EXTRACTION = "extraction"
STORAGE = "storage"
PHASES = (LISTING, REVISIONS, DOWNLOAD, EXTRACTION, STORAGE)

_ACTIVE: ContextVar[PhaseLog | None] = ContextVar("rebuild_phase_log", default=None)

F = TypeVar("F", bound=Callable[..., Any])


@dataclass
class PhaseTotals:
    seconds: float = 0.0
    requests: int = 0
    maxlag_wait: float = 0.0


@dataclass
class ReuseTotals:
    """Items a kind of source served from stored snapshots or fetched again."""

    reused: int = 0
    fetched: int = 0


class PhaseLog:
    """Accumulate the wall time, requests and maxlag waits of each phase."""

    def __init__(self, clock: Callable[[], float] = time.perf_counter) -> None:
        self._clock = clock
        self.started = clock()
        self.totals = {name: PhaseTotals() for name in PHASES}
        self.reuse: dict[str, ReuseTotals] = {}
        self._stack: list[str] = []
        self._mark = self.started

    @contextmanager
    def phase(self, name: str) -> Iterator[None]:
        if name not in self.totals:
            raise ValueError(f"unknown rebuild phase {name!r}")
        self._switch()
        self._stack.append(name)
        try:
            yield
        finally:
            self._switch()
            self._stack.pop()

    def _switch(self) -> None:
        now = self._clock()
        if self._stack:
            self.totals[self._stack[-1]].seconds += now - self._mark
        self._mark = now

    @property
    def current(self) -> str | None:
        return self._stack[-1] if self._stack else None

    def count_request(self, phase: str) -> None:
        self.totals[phase].requests += 1

    def add_maxlag_wait(self, phase: str, seconds: float) -> None:
        self.totals[phase].maxlag_wait += seconds

    def count_reuse(self, kind: str, *, reused: int = 0, fetched: int = 0) -> None:
        totals = self.reuse.setdefault(kind, ReuseTotals())
        totals.reused += reused
        totals.fetched += fetched

    def report_lines(self) -> list[str]:
        """One line per phase, the reuse counts and the total, for the run's log."""
        self._switch()
        wall = self._clock() - self.started
        lines = []
        for name in PHASES:
            totals = self.totals[name]
            lines.append(
                f"Rebuild phase {name}: {totals.seconds:.1f}s, {totals.requests} requests, "
                f"{totals.maxlag_wait:.1f}s maxlag wait"
            )
        attributed = sum(totals.seconds for totals in self.totals.values())
        for kind in sorted(self.reuse):
            totals = self.reuse[kind]
            lines.append(
                f"Rebuild reuse {kind}: {totals.reused} reused from stored revisions, "
                f"{totals.fetched} fetched"
            )
        requests = sum(totals.requests for totals in self.totals.values())
        waited = sum(totals.maxlag_wait for totals in self.totals.values())
        lines.append(
            f"Rebuild total: {wall:.1f}s ({max(0.0, wall - attributed):.1f}s outside the phases), "
            f"{requests} requests, {waited:.1f}s maxlag wait"
        )
        return lines


@contextmanager
def install(log: PhaseLog) -> Iterator[PhaseLog]:
    """Make ``log`` receive the reports of the code run inside the block."""
    token = _ACTIVE.set(log)
    try:
        yield log
    finally:
        _ACTIVE.reset(token)


def active() -> PhaseLog | None:
    return _ACTIVE.get()


@contextmanager
def phase(name: str) -> Iterator[None]:
    """Attribute the block's time to ``name``; does nothing without a log."""
    log = _ACTIVE.get()
    if log is None:
        yield
        return
    with log.phase(name):
        yield


def timed(name: str) -> Callable[[F], F]:
    """Decorate a function so its calls count as phase ``name``."""

    def decorate(function: F) -> F:
        @functools.wraps(function)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            log = _ACTIVE.get()
            if log is None:
                return function(*args, **kwargs)
            with log.phase(name):
                return function(*args, **kwargs)

        return wrapper  # type: ignore[return-value]

    return decorate


def count_request(phase_name: str) -> None:
    log = _ACTIVE.get()
    if log is not None:
        log.count_request(phase_name)


def add_maxlag_wait(phase_name: str, seconds: float) -> None:
    log = _ACTIVE.get()
    if log is not None:
        log.add_maxlag_wait(phase_name, seconds)


def count_reuse(kind: str, *, reused: int = 0, fetched: int = 0) -> None:
    log = _ACTIVE.get()
    if log is not None:
        log.count_reuse(kind, reused=reused, fetched=fetched)
