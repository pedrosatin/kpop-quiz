"""Write GitHub Actions workflow commands (annotations) with escaped values.

The runner reads a command from any line of stdout or stderr that starts with
``::``. A command ends at the line break, its properties end at the first
``::`` and each property ends at the next ``,``. A message or title that
quotes text from Wikipedia, Wikidata, MusicBrainz or ``gh`` could otherwise
end the annotation early and start a command of its own on a new line.

The runner decodes the escapes below when it shows the annotation, so a
value without ``%``, CR, LF, ``:`` or ``,`` prints exactly as before. The
rules are the ones of ``@actions/core`` (``escapeData`` and
``escapeProperty``). Importing this module has no side effects; it only uses
the standard library, so ``scripts/`` can import it from the runner's
``python3``.
"""

from __future__ import annotations

import sys
from typing import TextIO


def escape_data(text: str) -> str:
    """Escape the message of a command: ``%``, CR and LF."""
    return text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def escape_property(text: str) -> str:
    """Escape a property value such as ``title``: the message escapes plus ``:`` and ``,``."""
    return escape_data(text).replace(":", "%3A").replace(",", "%2C")


def format_command(command: str, message: str, **properties: str | None) -> str:
    """Return one ``::command key=value,...::message`` line without its line break.

    Properties whose value is ``None`` are left out, so ``title=None`` gives
    ``::warning::message``.
    """
    listed = ",".join(
        f"{key}={escape_property(value)}" for key, value in properties.items() if value is not None
    )
    head = f"{command} {listed}" if listed else command
    return f"::{head}::{escape_data(message)}"


def warning(message: str, title: str | None = None, *, stream: TextIO | None = None) -> None:
    _write("warning", message, title, stream)


def error(message: str, title: str | None = None, *, stream: TextIO | None = None) -> None:
    _write("error", message, title, stream)


def notice(message: str, title: str | None = None, *, stream: TextIO | None = None) -> None:
    _write("notice", message, title, stream)


def _write(command: str, message: str, title: str | None, stream: TextIO | None) -> None:
    # Flushed at once: in GitHub Actions stdout is a pipe, so Python buffers
    # it, and a SIGTERM from a step or attempt timeout would drop the line.
    print(format_command(command, message, title=title), file=stream or sys.stdout, flush=True)
