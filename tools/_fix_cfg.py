p = r'C:\Users\gyy18\AppData\Local\hermes\config.yaml'
s = open(p, encoding='utf-8').read()
old = '    command: C:\\Program Files\\nodejs\\node.exe'
new = '    command: "C:\\Program Files\\nodejs\\node.exe"'
print('found:', old in s)
s = s.replace(old, new)
open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('done')
