// cdp.mjs —— 极简 CDP 客户端（连 headless Chrome，执行页面 JS）
import WebSocket from 'ws';
const PORT = 9222;
async function getPageWs() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = list.find(p => p.type === 'page');
  if (!page) throw new Error('no page target');
  return page.webSocketDebuggerUrl;
}
export async function connect() {
  const url = await getPageWs();
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0;
  const pending = new Map();
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  return {
    eval(expression) {
      return new Promise((res) => {
        const mid = ++id;
        pending.set(mid, (m) => {
          if (m.result && m.result.exceptionDetails) res({ error: (m.result.exceptionDetails.exception || {}).description || 'js error' });
          else res(m.result ? m.result.result : { error: 'no result' });
        });
        ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
      });
    },
    send(method, params) {
      return new Promise((res) => {
        const mid = ++id;
        pending.set(mid, (m) => res(m.result || m));
        ws.send(JSON.stringify({ id: mid, method, params }));
      });
    },
    close() { try { ws.close(); } catch {} },
  };
}
