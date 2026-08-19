"""Every name a cell uses must be defined by that cell or an EARLIER one.

Notebook cells share one namespace, so an import in cell 24 is visible in cell
34. What they do not share is order: a cell can only use what has already run.

That is exactly how a NameError shipped. Two edits to the generator matched
different cells - the import of loud_backend_logs landed in Stage 7 and the
call landed in Stage 5b, which runs first. Each cell read plausibly alone; only
running them in order showed it.
"""
import ast
import json
import pathlib
import sys

NB = pathlib.Path(
    r"C:\Users\abdul\.gemini\antigravity\scratch\Blvck-TTS - Pic n Video"
    r"\kaggle_director\Kaggle_Director_Qwen.ipynb")

# Names worth tracking: the ones the notebook imports from its own package and
# has actually got wrong.
TRACKED = {
    'loud_backend_logs', 'quiet_backend_logs', 'preload_cuda_libraries',
    'DirectorInference', 'plan_violations', 'archive_query_advice',
    'strip_thinking', 'get_json_schema', 'VideoPlan', 'get_cache_key',
}


def defined_by(tree):
    out = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                out.add(alias.asname or alias.name.split('.')[0])
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            out.add(node.name)
        elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            out.add(node.id)
        elif isinstance(node, ast.alias):
            out.add(alias.asname or alias.name.split('.')[0])
    return out


def main():
    nb = json.loads(NB.read_text(encoding='utf-8'))
    available = set()
    problems = []

    for i, cell in enumerate(nb['cells']):
        if cell['cell_type'] != 'code':
            continue
        src = ''.join(cell['source'])
        try:
            tree = ast.parse(src)
        except SyntaxError as exc:
            problems.append(f'cell {i}: does not parse - {exc}')
            continue

        # A module-writing cell embeds a file as a string; the names inside it
        # belong to that file, not to this namespace.
        if 'SRC = ' not in src:
            used = {n.id for n in ast.walk(tree)
                    if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)}
            mine = defined_by(tree)
            for name in sorted(used & TRACKED):
                if name not in mine and name not in available:
                    problems.append(
                        f'cell {i}: uses {name} before any cell defines it')

        available |= defined_by(tree)

    for line in problems:
        print('  FAIL  ' + line)
    print('\n' + ('EVERY NAME IS DEFINED BEFORE IT IS USED'
                  if not problems else f'FAILED ({len(problems)})'))
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
