"""Bounded connected placement and assignment enumeration for fixed clue slots."""
from __future__ import annotations

from .crossword_cli import normalize


class BudgetExhausted(ValueError):
    pass


def positions(entry):
    dr, dc = (0, 1) if entry['direction'] == 'across' else (1, 0)
    return [(entry['row'] + i * dr, entry['col'] + i * dc)
            for i in range(len(entry['answer']))]


def geometry(entries: list[dict], *, complete=True) -> dict:
    cells, owners = {}, {}
    declared = set()
    for i, e in enumerate(entries):
        coords = positions(e)
        if not coords or e['direction'] not in ('across', 'down'):
            raise ValueError('invalid slot')
        slot = (e['row'], e['col'], e['direction'], len(coords))
        if slot in declared:
            raise ValueError('duplicate slot')
        declared.add(slot)
        for coord, ch in zip(coords, e['answer']):
            if coord in cells and (cells[coord] != ch or any(
                    entries[j]['direction'] == e['direction'] for j in owners[coord])):
                raise ValueError('invalid crossing')
            cells[coord] = ch
            owners.setdefault(coord, []).append(i)
    rs, cs = [r for r, _ in cells], [c for _, c in cells]
    if max(rs) - min(rs) >= 9 or max(cs) - min(cs) >= 9:
        raise ValueError('board bounds')
    # Every maximal horizontal/vertical run of 2+ cells must be a declared slot.
    for r, c in cells:
        for direction, dr, dc in [('across', 0, 1), ('down', 1, 0)]:
            if (r - dr, c - dc) in cells:
                continue
            length = 1
            while (r + length * dr, c + length * dc) in cells:
                length += 1
            if length > 1 and (r, c, direction, length) not in declared:
                raise ValueError('undeclared run or adjacency')
    reached = {0}
    for _ in entries:
        for ids in owners.values():
            if reached.intersection(ids):
                reached.update(ids)
    if complete and len(reached) != len(entries):
        raise ValueError('disconnected slots')
    return cells


def canonical_board(entries):
    cells = geometry(entries)
    top, left = min(r for r, _ in cells), min(c for _, c in cells)
    result = [dict(e, row=e['row'] - top, col=e['col'] - left) for e in entries]
    result.sort(key=lambda e: (e['row'], e['col'], e['direction']))
    starts = sorted({(e['row'], e['col']) for e in result})
    for e in result:
        e['number'] = starts.index((e['row'], e['col'])) + 1
    cells = geometry(result)
    return {'rows': max(r for r, _ in cells) + 1, 'cols': max(c for _, c in cells) + 1,
            'entries': result, 'vocabulary': sorted(e['qid'] for e in result),
            'cells': [{'row': r, 'col': c, 'answer': ch} for (r, c), ch in sorted(cells.items())]}


def count_assignments(entries, domains, node_limit=10000):
    """Count up to two assignments, never label an interrupted proof complete.

    Each domain contains (QID, canonical normalized answer) pairs for that clue.
    Stored solution letters constrain only lengths; crossings constrain letters.
    """
    if type(node_limit) is not int or node_limit < 1:
        raise ValueError('invalid proof budget')
    coords = [positions(e) for e in entries]
    if len(domains) != len(entries):
        raise ValueError('domain count')
    options = [sorted(set((q, w) for q, w in domain if len(w) == len(coords[i])))
               for i, domain in enumerate(domains)]
    if len(options) != len(entries):
        raise ValueError('domain count')
    order = sorted(range(len(entries)), key=lambda i: (len(options[i]), i))
    solutions, nodes = 0, 0

    def visit(depth, filled, used):
        nonlocal solutions, nodes
        nodes += 1
        if nodes > node_limit:
            raise BudgetExhausted('assignment proof budget exhausted')
        if depth == len(order):
            solutions += 1
            return
        i = order[depth]
        for qid, word in options[i]:
            if qid in used or any(p in filled and filled[p] != ch for p, ch in zip(coords[i], word)):
                continue
            visit(depth + 1, {**filled, **dict(zip(coords[i], word))}, used | {qid})
            if solutions == 2:
                return
    visit(0, {}, set())
    return {'solutions': solutions, 'complete': True, 'nodes': nodes}


def connected_count(groups):
    unseen = set(groups)
    largest = 0
    letters = {q: set(normalize(g['canonical_name'])) for q, g in groups.items()}
    while unseen:
        reached, pending = set(), [min(unseen)]
        while pending:
            q = pending.pop()
            if q in reached:
                continue
            reached.add(q)
            pending.extend(r for r in sorted(unseen - reached) if letters[q] & letters[r])
        unseen -= reached
        largest = max(largest, len(reached))
    return largest


def place(groups, rng, target, node_limit):
    """One greedy randomized attempt; every added slot crosses the existing board."""
    qids = sorted(groups)
    rng.shuffle(qids)
    first = qids.pop()
    entries = [dict(qid=first, answer=normalize(groups[first]['canonical_name']), row=0, col=0,
                    direction=rng.choice(['across', 'down']))]
    nodes = 0
    while len(entries) < target:
        candidates = [q for q in qids if q not in {e['qid'] for e in entries}]
        rng.shuffle(candidates)
        added = False
        used_names = set()
        for e in entries:
            used_names.update({normalize(n) for n in [groups[e['qid']]['canonical_name'], *groups[e['qid']]['aliases']]})
        for qid in candidates:
            names = {normalize(n) for n in [groups[qid]['canonical_name'], *groups[qid]['aliases']]} - {''}
            if names & used_names:
                continue
            answer = normalize(groups[qid]['canonical_name'])
            proposals = set()
            for e in entries:
                direction = 'down' if e['direction'] == 'across' else 'across'
                for pos, ch in zip(positions(e), e['answer']):
                    for i, other in enumerate(answer):
                        if ch == other:
                            proposals.add((pos[0] - (i if direction == 'down' else 0),
                                           pos[1] - (i if direction == 'across' else 0), direction))
            proposals = sorted(proposals)
            rng.shuffle(proposals)
            for row, col, direction in proposals:
                nodes += 1
                if nodes > node_limit:
                    raise BudgetExhausted('placement budget exhausted')
                proposed = dict(qid=qid, answer=answer, row=row, col=col, direction=direction)
                try:
                    geometry(entries + [proposed])
                except ValueError:
                    continue
                entries.append(proposed)
                added = True
                break
            if added:
                break
        if not added:
            raise ValueError('no compatible placement')
    return entries
