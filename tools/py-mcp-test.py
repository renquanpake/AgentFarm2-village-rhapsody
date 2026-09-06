# 用 Python subprocess 模拟 hermes 的 stdio MCP spawn，看进程是否起来、交互是否成功
import subprocess, json, sys, time, os
sys.stdout.reconfigure(encoding='utf-8')

cmd = [r"C:\Program Files\nodejs\node.exe",
       r"D:\agent社区\AgentFarm2\tools\agent-mcp.mjs",
       "--token", "1d57b638c25c3deade3e5ec744c06949"]
env = dict(os.environ)
env["AF_MCP_DEBUG"] = "1"
p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
time.sleep(1.0)
print("poll:", p.poll())
if p.poll() is not None:
    print("stderr:", p.stderr.read().decode('utf-8', 'replace')[:500])
    sys.exit(1)

def send(obj):
    s = json.dumps(obj)
    p.stdin.write(f"Content-Length: {len(s.encode())}\r\n\r\n{s}".encode())
    p.stdin.flush()

send({"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"py-test","version":"0"}}})
time.sleep(1.0)
send({"jsonrpc":"2.0","method":"notifications/initialized"})
time.sleep(0.3)
send({"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}})
time.sleep(1.5)
# 读 stdout
import select
out = b""
while True:
    r, _, _ = select.select([p.stdout], [], [], 0.3)
    if not r: break
    chunk = os.read(p.stdout.fileno(), 65536)
    if not chunk: break
    out += chunk
print("stdout bytes:", len(out))
print(out.decode('utf-8', 'replace')[:600])
print("poll after:", p.poll())
p.kill()
