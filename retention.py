from pathlib import Path
import os,re,tempfile,shutil,subprocess,time,urllib.request
mods={'server.py': [('import project_proxy', 'import calendar, logging\nimport project_proxy'), ('def state_for(', 'def anniversary(start, months):\n index = start.year * 12 + start.month - 1 + months\n year, month = divmod(index, 12)\n month += 1\n return start.replace(year=year, month=month, day=min(start.day, calendar.monthrange(year, month)[1]))\n\ndef order_section(row, current):\n if row[\'status\'] != \'completed\': return \'active\'\n try:\n  completed = datetime.fromisoformat(row[\'completed_at\']).astimezone(TZ)\n except (TypeError, ValueError):\n  return \'recent\'\n for months, section in ((48, \'expired\'), (12, \'archive\'), (1, \'history\')):\n  if current >= anniversary(completed, months): return section\n return \'recent\'\n\ndef purge_orders():\n with connect() as c:\n  c.execute(\'PRAGMA secure_delete=ON\')\n  c.execute(\'BEGIN IMMEDIATE\')\n  current = now()\n  expired = [(r[\'id\'],) for r in c.execute("SELECT id,status,completed_at FROM orders WHERE status=\'completed\'") if order_section(r,current)==\'expired\']\n  if expired:\n   for table in (\'events\',\'push_queue\'):\n    c.executemany(\'DELETE FROM \'+table+\' WHERE order_id=?\',expired)\n   c.executemany(\'DELETE FROM orders WHERE id=?\',expired)\n   c.commit()\n   c.execute(\'PRAGMA wal_checkpoint(TRUNCATE)\')\n\ndef retention_worker():\n while True:\n  try: purge_orders()\n  except sqlite3.Error: logging.exception(\'Order retention failed\')\n  time.sleep(3600)\n\ndef state_for('), (' ids={r', " rows=[r for r in rows if order_section(r,t)!='expired']\n ids={r"), ('[summary(r) for r in rows]', '[dict(summary(r),section=order_section(r,t)) for r in rows]'), ('init();push.start();', 'init();threading.Thread(target=retention_worker,daemon=True).start();push.start();')], 'public/app.js': [('function paintOrders(', 'function groupedOrders(orders,driver){\n const cards=rows=>rows.map(o=>card(o,driver)).join(\'\');\n let html=cards(orders.filter(o=>o.status!==\'completed\'));\n for(const [section,label] of [[\'recent\',\'Zrealizowane\'],[\'history\',\'Historia zamówień\'],[\'archive\',\'Archiwum zamówień\']]){\n  const rows=orders.filter(o=>o.status===\'completed\'&&(o.section||\'recent\')===section);\n  if(rows.length) html+=`<details class="panel"><summary>${label} (${rows.length})</summary>${cards(rows)}</details>`;\n }\n return html;\n}\nfunction paintOrders('), ("selected.map(o=>card(o,driver)).join('')", 'groupedOrders(selected,driver)'), ('Historia jest zawsze zachowana.', 'Zamówienia przechodzą do historii miesiąc po realizacji, do archiwum po roku, a po czterech latach są usuwane.')]}
root=Path('/opt/prohouse-orders')
updates={}
for name, changes in mods.items():
 p=root/name
 data=p.read_text()
 for old,new in changes:
  if data.count(old)!=1:raise SystemExit('Version mismatch: '+name+' '+old[:40])
  data=data.replace(old,new)
 updates[p]=data
p=root/'public/index.html'
data,n=re.subn(r'(/app[.]js)(?:[?]v=[^"]*)?"',r'\1?v=20261128-retention"',p.read_text())
assert n==1
updates[p]=data
compile(updates[root/'server.py'],'server.py','exec')
backup=Path(tempfile.mkdtemp(prefix='orders-retention-',dir='/opt/prohouse/backups'))
for p in updates:shutil.copy2(p,backup/p.name)
try:
 for p,data in updates.items():
  tmp=p.with_suffix('.retention.tmp')
  shutil.copy2(p,tmp)
  tmp.write_text(data)
  os.replace(tmp,p)
 subprocess.run(['systemctl','restart','prohouse-orders'],check=True)
 time.sleep(2)
 js=urllib.request.urlopen('http://127.0.0.1:3003/app.js',timeout=5).read()
 assert b'function groupedOrders' in js
 print('RETENTION DEPLOYED',backup)
except BaseException:
 for p in updates:shutil.copy2(backup/p.name,p)
 subprocess.run(['systemctl','restart','prohouse-orders'])
 raise
