"""Exit codes of the collector CLI (``python main.py``).

``scripts/rebuild_database.py`` reads the code of each rebuild attempt and
repeats the attempt only after ``EXIT_TRANSIENT``. Every other failure goes
straight to the cached database, because running the same command again would
fail the same way.

The CLI decides between the two codes from the exception that ended the run:

* ``EXIT_TRANSIENT``: a ``MediaWikiError`` raised with ``transient=True``. The
  clients set it when they give up on a condition that passes with time: the
  network, ``maxlag``, HTTP 429 and 5xx, a ``Retry-After`` above their limit.
  A client that gives up after waiting out a budget raises the same way.
* ``EXIT_DETERMINISTIC``: any other handled failure, such as
  ``SnapshotIntegrityError``, a validation ``ValueError`` or a response the
  parser refuses.

The values come from ``sysexits.h`` (``EX_DATAERR`` and ``EX_TEMPFAIL``). They
stay clear of the codes other layers already use: 1 (uncaught exception or
``SystemExit`` with a message), 2 (argparse), 124 and 137 (``timeout(1)``),
137 and 143 (128 plus SIGKILL or SIGTERM).
"""

from __future__ import annotations

EXIT_OK = 0
EXIT_DETERMINISTIC = 65
EXIT_TRANSIENT = 75

# Codes with a meaning outside this CLI; no constant above may take one.
RESERVED_EXIT_CODES = frozenset({0, 1, 2, 124, 137, 143})
