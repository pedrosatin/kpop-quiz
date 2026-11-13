"""Stand-in for ``main.py``, used by ``tests/test_rebuild_database.py``.

Each run appends its process ID to the file named by ``FAKE_COLLECTOR_LOG``
and gets part of the way through a rebuild: it commits a row to the database
and writes a raw snapshot. Then it ends as ``FAKE_COLLECTOR_OUTCOMES`` says
for that run. The variable lists one outcome per run, separated by commas, and
the last one repeats:

* ``ok``: exits with ``EXIT_OK``.
* ``transient`` and ``deterministic``: exit with the code the real CLI uses.
* ``crash``: an uncaught exception, which Python turns into exit code 1.
* ``hang``: empties the table, starts a transaction large enough for SQLite
  to sync its rollback journal to disk, and never returns.
* ``hang-ignoring-sigterm``: the same, and SIGTERM does not stop it.
"""

from __future__ import annotations

import argparse
import os
import signal
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from kpop_scraping.exit_codes import EXIT_DETERMINISTIC, EXIT_OK, EXIT_TRANSIENT


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, required=True)
    args, _collector_flags = parser.parse_known_args()

    log = Path(os.environ["FAKE_COLLECTOR_LOG"])
    with log.open("a", encoding="utf-8") as handle:
        handle.write(f"{os.getpid()}\n")
    run = len(log.read_text(encoding="utf-8").splitlines())
    outcomes = os.environ["FAKE_COLLECTOR_OUTCOMES"].split(",")
    outcome = outcomes[min(run, len(outcomes)) - 1]
    if outcome == "hang-ignoring-sigterm":
        signal.signal(signal.SIGTERM, signal.SIG_IGN)

    connection = sqlite3.connect(args.database)
    connection.execute("CREATE TABLE IF NOT EXISTS facts (value TEXT)")
    connection.execute("INSERT INTO facts VALUES (?)", (f"attempt-{run}",))
    connection.commit()
    raw_dir = args.database.parent / "raw"
    raw_dir.mkdir(exist_ok=True)
    (raw_dir / f"attempt-{run}.json").write_text("{}", encoding="utf-8")

    if outcome.startswith("hang"):
        connection.execute("DELETE FROM facts")
        connection.commit()
        # A small page cache makes the open transaction spill, so the journal
        # on disk holds pages SQLite would roll back on the next open.
        connection.execute("PRAGMA cache_size = 5")
        connection.executemany(
            "INSERT INTO facts VALUES (?)", [("never committed " * 30,) for _ in range(2000)]
        )
        time.sleep(3600)
    connection.close()
    if outcome == "crash":
        raise OSError("disk is gone")
    print(f"Pipeline failed: fake {outcome}" if outcome != "ok" else "Collected 1 pages")
    return {"ok": EXIT_OK, "transient": EXIT_TRANSIENT, "deterministic": EXIT_DETERMINISTIC}[outcome]


if __name__ == "__main__":
    raise SystemExit(main())
