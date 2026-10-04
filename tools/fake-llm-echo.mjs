// tools/fake-llm-echo.mjs —— 本地假 OpenAI 兼容端点（e2e 用；不接真模型、不落盘）
// 用途：把收到的 system prompt 里的【价目】段与反幻觉尾句回声，让测试能证明
//       「LLM 真的收到了权威规则」而不是只验证服务端拼出了字符串。
// 用法：node tools/fake-llm-echo.mjs [--port=8099]
// 消费方：tools/e2e-rules-injection.mjs（AF_FAKE_LLM 指向本端口）
import http from 'node:http';

const portArg = process.argv.indexOf('--port=');
const PORT = Number(portArg >= 0 ? process.argv[portArg + 1].split('=')[1] : process.env.AF_FAKE_LLM_PORT || 8099);

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    let sys = '';
    try {
      const j = JSON.parse(body || '{}');
      sys = (j.messages || []).find(m => m.role === 'system')?.content || '';
    } catch { /* 非 JSON 请求按空 system 处理 */ }
    const priceSeg = (sys.match(/【价目】[\s\S]{0,600}?(?=\n【|$)/) || [''])[0];
    const tail = sys.includes('以上资料未写明的，回答不知道。') ? 'HAS-TAIL' : 'NO-TAIL';
    console.log(`[fake-llm] 收到请求 system 长度=${sys.length} 尾句=${tail}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: `ECHO ${tail} | ${priceSeg.slice(0, 400)}` } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    }));
  });
});
server.listen(PORT, '127.0.0.1', () => console.log(`fake-llm-echo on ${PORT}`));