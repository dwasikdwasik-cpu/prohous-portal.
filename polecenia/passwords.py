"""Interactive account and email configuration for the server owner."""
from getpass import getpass
import json
import os
from pathlib import Path
import smtplib
import ssl
import subprocess
import sys
import textwrap

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
        while True:
            password = getpass(f'Nowe hasło do panelu ({email}, min. 12 znaków): ')
            if len(password) < 12 or password in passwords.values():
                print('Użyj innego hasła o długości co najmniej 12 znaków.')
                continue
            if password == getpass('Powtórz hasło: '):
                passwords[email] = password
                break
            print('Hasła się różnią. Wpisz hasło ponownie.')
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
    subprocess.run(['docker','compose','exec','-T','panel','python','-c',textwrap.dedent(update)],
                   input=json.dumps(passwords), text=True, check=True)
    print('Hasła obu kont zapisane.')
domain = config['ADMIN_EMAIL'].split('@', 1)[1]
host, port = 'mail.' + domain, 465
user = 'administrator@' + domain
context = ssl.create_default_context()
for attempt in range(3):
    secret = getpass(f'Hasło do skrzynki pocztowej {user}: ')
    if not secret or any(char in secret for char in ("'", chr(92), chr(13), chr(10))):
        print('Wprowadź hasło bez apostrofu i odwrotnego ukośnika.')
        continue
    try:
        with smtplib.SMTP_SSL(host, port, context=context, timeout=15) as smtp:
            smtp.login(user, secret)
    except smtplib.SMTPAuthenticationError:
        print('Skrzynka odrzuciła logowanie.')
    else:
        break
else:
    raise SystemExit('Hasła panelu są zapisane. Aby ponowić pocztę, uruchom konfigurator z opcją --smtp-only.')
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
