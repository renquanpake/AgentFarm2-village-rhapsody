import sqlite3, sys
sys.stdout.reconfigure(encoding='utf-8')
for db in [r'C:\Users\gyy18\AppData\Local\hermes\hermes-agent\clawchat\clawchat.sqlite',
           r'C:\Users\gyy18\AppData\Local\hermes\hermes-agent\clawchat\clawchat-custom.sqlite']:
    try:
        con = sqlite3.connect(db)
        tabs = [r[0] for r in con.execute("select name from sqlite_master where type='table'")]
        print(db.split('\\')[-1], '->', tabs)
        con.close()
    except Exception as e:
        print(db, 'ERR', e)
