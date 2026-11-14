"""Seeded orders over ranges too large to build, for the puzzle searches.

A generator that wants "every k-subset of these items, in an order the date's
seed decides" cannot list the subsets and shuffle them: 300 items give
C(300, 4) = 330 million quads. The helpers here draw the same kind of order one
element at a time. Memory grows with the number of draws, never with the size
of the range, so a search that stops after a few thousand draws pays for a few
thousand draws.

The order depends only on the ``random.Random`` passed in and on the order of
the items given, never on set or dict iteration, so a seed reproduces it in
any process whatever ``PYTHONHASHSEED`` is.
"""

from __future__ import annotations

import random
from math import comb
from typing import Iterator, Sequence, TypeVar

T = TypeVar("T")


def shuffled_indices(total: int, rng: random.Random) -> Iterator[int]:
    """Yield each integer of ``range(total)`` once, in an order drawn from ``rng``.

    This is the Fisher-Yates shuffle over a virtual array that starts as
    ``0, 1, ..., total - 1``. Only the swapped cells live in ``displaced``,
    and each draw removes the cell it reads, so after k draws the dict holds
    at most k entries. Every order has the same probability, as in
    ``random.shuffle``; the two do not produce the same order for a seed.
    """
    if total < 0:
        raise ValueError(f"total must be non-negative, got {total}")
    displaced: dict[int, int] = {}
    for position in range(total):
        pick = rng.randrange(position, total)
        current = displaced.pop(position, position)
        if pick == position:
            yield current
            continue
        yield displaced.get(pick, pick)
        displaced[pick] = current


def combination_at(rank: int, n: int, k: int) -> tuple[int, ...]:
    """Return the k-subset of ``range(n)`` with this rank, in ascending order.

    Ranks follow the combinatorial number system (colex order): the subset
    c_1 < ... < c_k has rank C(c_1, 1) + ... + C(c_k, k). Each rank in
    ``range(C(n, k))`` names one subset and each subset has one rank. Finding
    the subset walks the candidates down from n - 1 once, so it costs O(n + k)
    binomials.
    """
    if k < 0 or n < 0 or not 0 <= rank < comb(n, k):
        raise ValueError(f"rank {rank} is outside C({n}, {k})")
    positions: list[int] = []
    candidate = n - 1
    for size in range(k, 0, -1):
        while comb(candidate, size) > rank:
            candidate -= 1
        positions.append(candidate)
        rank -= comb(candidate, size)
        candidate -= 1
    positions.reverse()
    return tuple(positions)


def shuffled_combinations(
    items: Sequence[T], k: int, rng: random.Random
) -> Iterator[tuple[T, ...]]:
    """Yield every k-subset of ``items`` once, in an order drawn from ``rng``.

    Each subset keeps the order of ``items``, as ``itertools.combinations``
    does; give sorted items to get sorted tuples. Nothing is built ahead: the
    generator holds the swapped ranks of the draws made so far.
    """
    n = len(items)
    for rank in shuffled_indices(comb(n, k), rng):
        yield tuple(items[position] for position in combination_at(rank, n, k))
