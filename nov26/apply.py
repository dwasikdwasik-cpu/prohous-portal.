"""Apply independently versioned workforce and designer UI changes."""
import subprocess
import sys
from pathlib import Path
root=Path(__file__).resolve().parent
def run(*parts):
    subprocess.run([sys.executable,str(root/parts[0]),*parts[1:]],check=True)
for part in sys.argv[1:]:
    if part=='ledger':run('ledger/install.py')
    elif part=='designer':run('designer/deploy.py');run('check.py','folders')
    else:raise ValueError('Nieznany moduł.')
