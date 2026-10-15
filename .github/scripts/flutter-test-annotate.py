#!/usr/bin/env python3
"""Transforme le rapport JSON de `flutter test --reporter json` en annotations GitHub (une par test échoué).

Les journaux bruts de la CI ne sont pas toujours lisibles depuis l'environnement de travail ; les annotations le sont.
Usage : flutter-test-annotate.py rapport.jsonl
"""
import json
import sys


def esc(text: str) -> str:
    return text.replace('%', '%25').replace('\r', '').replace('\n', '%0A')


def main(path: str) -> None:
    names: dict[int, str] = {}
    errors: dict[int, list[str]] = {}
    failed: list[int] = []
    with open(path, encoding='utf-8', errors='replace') as f:
        for line in f:
            line = line.strip()
            if not line.startswith('{'):
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            kind = ev.get('type')
            if kind == 'testStart':
                t = ev['test']
                names[t['id']] = t.get('name', '?')
            elif kind == 'error':
                stack = '\n'.join(
                    l for l in ev.get('stackTrace', '').splitlines() if '/apps/mobile/' in l or 'test/' in l
                )[:600]
                errors.setdefault(ev['testID'], []).append(f"{ev.get('error', '')[:1500]}\n{stack}")
            elif kind == 'testDone' and ev.get('result') != 'success' and not ev.get('hidden'):
                failed.append(ev['testID'])
    for tid in failed:
        detail = '\n---\n'.join(errors.get(tid, ['(aucun détail)']))
        title = esc(names.get(tid, '?'))[:200].replace(':', '%3A').replace(',', '%2C')
        print(f"::error title={title}::{esc(detail)[:3500]}")
    print(f'{len(failed)} test(s) en échec annoté(s).')


if __name__ == '__main__':
    main(sys.argv[1])
