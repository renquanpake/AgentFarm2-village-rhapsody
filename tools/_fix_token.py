p = r'C:\Users\gyy18\AppData\Local\hermes\config.yaml'
s = open(p, encoding='utf-8').read()
s = s.replace('1d57b638c25c3deade3e5ec744c06949', 'd9e2355ee61b5817efc9900830083fbe')
open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('done')
