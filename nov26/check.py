from pathlib import Path
import subprocess
import sys
root=Path(__file__).resolve().parent
tests={'folders':'designer/check-folders.sql','office':'office/check-access.sql'}
for name in sys.argv[1:]:
    subprocess.run(['docker','exec','-i','supabase-db','psql','-qX','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],
                   input=(root/tests[name]).read_bytes(),check=True)
    print('OK',name,'(rollback)',flush=True)
