"""Interactive account and email configuration for the server owner."""
from getpass import getpass
import json
import os
from pathlib import Path
import smtplib
import ssl
import subprocess
import sys

os.chdir('/opt/prohouse-polecenia')
path = Path('.env')
config = dict(
    line.split('=', 1) for line in path.read_text().splitlines()
    if line and not line.startswith('#') and '=' in line
)
if '--smtp-only' not in sys.argv:
    passwords = {}
    for name in ('ADMIN_EMAIL', 'STAFF_EMAIL'):
        email = config[name]
        password = getpass(f'Nowe hasło do panelu ({email}, min. 12 znaków): ')
        if len(password) < 12 or password != getpass('Powtórz hasło: '):
            raise SystemExit('Hasła muszą być zgodne i mieć co najmniej 12 znaków.')
        passwords[email] = password
    if len(set(passwords.values())) != 2:
        raise SystemExit('Konta muszą mieć różne hasła.')
    update = """
    from contextlib import closing
    import json, secrets, sys
    from app import db, password
    with closing(db()) as connection, connection:
        for email, value in json.load(sys.stdin).items():
            salt = secrets.token_hex(16)
            cursor = connection.execute(
                'update users set salt=?,pw=? where email=?',
                (salt, password(value,salt), email))
            if cursor.rowcount != 1:
                raise SystemExit('Brak oczekiwanego konta.')
            connection.execute('delete from sessions where uid=(select id from users where email=?)', (email,))
    """
    subprocess.run(['docker','compose','exec','-T','panel','python','-c',update],
                   input=json.dumps(passwords), text=True, check=True)
    print('Hasła obu kont zapisane.')
host = input('Serwer SMTP [mail.prohous.pl]: ').strip() or 'mail.prohous.pl'
port = int(input('Port SMTP [465]: ').strip() or '465')
if port not in (465, 587):
    raise SystemExit('Wybierz port 465 (TLS) albo 587 (STARTTLS).')
default_sender = 'administrator@' + config['ADMIN_EMAIL'].split('@', 1)[1]
user = input(f'Adres skrzynki nadawcy SMTP [{default_sender}]: ').strip() or default_sender
if '@' not in user:
    raise SystemExit('Podaj pełny adres skrzynki ze znakiem @. Ponów poleceniem python3 /tmp/pol-setup.py --smtp-only.')
secret = getpass('Hasło do skrzynki SMTP: ')
if not all(v and not set(v).intersection("'\\\r\n") for v in (host, user, secret)):
    raise SystemExit('Pola SMTP muszą być pełne i bez apostrofu oraz odwrotnego ukośnika.')
context = ssl.create_default_context()
with (smtplib.SMTP_SSL(host, port, context=context, timeout=15)
      if port == 465 else smtplib.SMTP(host, port, timeout=15)) as smtp:
    if port == 587:
        smtp.starttls(context=context)
    smtp.login(user, secret)
print('Logowanie SMTP działa.')
smtp_config = dict(SMTP_HOST=host, SMTP_PORT=str(port), SMTP_FROM=user,
                   SMTP_USER=user, SMTP_PASSWORD=secret)
for key in smtp_config:
    config.pop(key, None)
temporary = path.with_name('.env.smtp-new')
with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as out:
    for key, value in config.items():
        out.write(f'{key}={value}\n')
    for key, value in smtp_config.items():
        out.write(f"{key}='{value}'\n")
temporary.replace(path)
subprocess.run(['docker','compose','up','-d','--build'],check=True)
print('Konta ustawione, proces wysyłki uruchomiony.')
