// 测试洒水器：买→安装（无需犁地）→验证
import { WebSocket } from 'ws';

const TOKEN = process.argv[2];
if (!TOKEN) { console.error('用法: node _test-sprinkler.mjs <agentToken>'); process.exit(1); }

const WS = `ws://127.0.0.1:8080/agent?token=${TOKEN}`;
function send(ws, msg) { ws.send(JSON.stringify(msg)); }
function waitMsg(ws, predicate, timeout = 10000) {
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('timeout')), timeout);
    const handler = (data) => {
      const m = JSON.parse(data.toString());
      if (predicate(m)) { clearTimeout(timer); ws.off('message', handler); res(m); }
    };
    ws.on('message', handler);
  });
}
const isResult = (m) => m.t === 'result' || m.t === 'act_result';
const isState = (m) => m.t === 'state';

const ws = new WebSocket(WS);
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
console.log('✅ Connected');

const welcome = await waitMsg(ws, m => m.t === 'welcome' || m.t === 'created');
console.log('✅ Authenticated:', welcome.nick || welcome.uid);

// 1. Observe
send(ws, { t: 'observe' });
const s1 = await waitMsg(ws, isState);
console.log(`📍 Pos: (${s1.pos.x},${s1.pos.y})  grid: (${Math.floor(s1.pos.x/100)},${Math.floor(s1.pos.y/100)})`);
console.log(`💰 Coins: ${s1.coins}`);
console.log(`🎒 Backpack: ${s1.backpack?.map(b => b.name + 'x' + b.num).join(', ')}`);
console.log(`🚿 Sprinklers: ${JSON.stringify(s1.sprinklers)}`);

// 2. Buy 初级洒水器 (id=77, 200 coins)
console.log('\n🛒 Step 1: Buy 初级洒水器 (id=77)...');
send(ws, { t: 'act', action: 'buy', itemId: 77, count: 1 });
const buyRes = await waitMsg(ws, isResult);
console.log(`   ${buyRes.ok ? '✅' : '❌'} ${buyRes.msg || JSON.stringify(buyRes)}`);

if (!buyRes.ok) { console.log('❌ Buy failed'); ws.close(); process.exit(1); }

// Also buy a 中级洒水器 (id=78)
console.log('🛒 Buy 中级洒水器 (id=78)...');
send(ws, { t: 'act', action: 'buy', itemId: 78, count: 1 });
const buy2 = await waitMsg(ws, isResult);
console.log(`   ${buy2.ok ? '✅' : '❌'} ${buy2.msg || JSON.stringify(buy2)}`);

// 3. Observe to see tillable spots
send(ws, { t: 'observe' });
const s2 = await waitMsg(ws, isState);
console.log(`\n🎒 Backpack: ${s2.backpack?.map(b => b.name + 'x' + b.num).join(', ')}`);
console.log(`🟫 TillableNear: ${JSON.stringify(s2.tillableNear?.slice(0, 5))}`);
console.log(`🌱 PlotsNear: ${JSON.stringify(s2.plotsNear?.slice(0, 3))}`);

// 4. Move to a tillable spot via move_to, then till + place
if (s2.tillableNear && s2.tillableNear.length > 0) {
  const target = s2.tillableNear[0];
  console.log(`\n🚶 Step 2: Moving to (${target.px},${target.py}) via move_to...`);
  send(ws, { t: 'act', action: 'move_to', x: target.px, y: target.py });
  const moveRes = await waitMsg(ws, isResult, 25000);
  console.log(`   ${moveRes.ok ? '✅' : '❌'} ${moveRes.msg || JSON.stringify(moveRes)}`);
  
  // Wait for movement to complete
  await new Promise(r => setTimeout(r, 3000));

  // Observe new position
  send(ws, { t: 'observe' });
  const s3 = await waitMsg(ws, isState);
  console.log(`   📍 Now at: (${s3.pos.x},${s3.pos.y}) grid: (${Math.floor(s3.pos.x/100)},${Math.floor(s3.pos.y/100)})`);
  console.log(`   🟫 TillableNear: ${JSON.stringify(s3.tillableNear?.slice(0, 3))}`);
  
  // Till
  console.log(`\n🟫 Step 3: Till at (${target.gx},${target.gy})...`);
  send(ws, { t: 'act', action: 'till', x: target.gx, y: target.gy });
  const tillRes = await waitMsg(ws, isResult);
  console.log(`   ${tillRes.ok ? '✅' : '❌'} ${tillRes.msg}`);

  // Place sprinkler on the tilled plot
  console.log(`\n🚿 Step 4: Place 初级洒水器 at (${target.gx},${target.gy})...`);
  send(ws, { t: 'act', action: 'place', itemId: 77, x: target.gx, y: target.gy });
  const placeRes = await waitMsg(ws, isResult);
  console.log(`   ${placeRes.ok ? '✅' : '❌'} ${placeRes.msg}`);
  if (placeRes.placed) console.log(`   📋 ${JSON.stringify(placeRes.placed)}`);

  // Place 中级洒水器 at adjacent tilled spot
  if (s2.tillableNear[1]) {
    const t2 = s2.tillableNear[1];
    console.log(`\n🟫 Step 5: Till at (${t2.gx},${t2.gy})...`);
    send(ws, { t: 'act', action: 'till', x: t2.gx, y: t2.gy });
    await waitMsg(ws, isResult);
    
    // Walk there first
    send(ws, { t: 'act', action: 'move_to', x: t2.px, y: t2.py });
    await waitMsg(ws, isResult, 25000).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
    
    console.log(`🚿 Step 6: Place 中级洒水器 at (${t2.gx},${t2.gy})...`);
    send(ws, { t: 'act', action: 'place', itemId: 78, x: t2.gx, y: t2.gy });
    const place2 = await waitMsg(ws, isResult);
    console.log(`   ${place2.ok ? '✅' : '❌'} ${place2.msg}`);
  }

  // Final verify
  send(ws, { t: 'observe' });
  const sFinal = await waitMsg(ws, isState);
  console.log('\n📊 Final State:');
  console.log(`   💰 Coins: ${sFinal.coins}`);
  console.log(`   🎒 Backpack: ${sFinal.backpack?.map(b => b.name + 'x' + b.num).join(', ')}`);
  console.log(`   🚿 Sprinklers: ${JSON.stringify(sFinal.sprinklers, null, 2)}`);
  console.log(`   🌱 PlotsNear: ${JSON.stringify(sFinal.plotsNear?.slice(0, 3))}`);

  if (sFinal.sprinklers && sFinal.sprinklers.length >= 1) {
    console.log('\n🎉 SUCCESS: 洒水器系统测试通过！');
    sFinal.sprinklers.forEach((sp, i) => {
      const rangeLabel = { 1: '3x3', 2: '5x5', 3: '7x7' };
      console.log(`   洒水器 #${i+1}: (${sp.gx},${sp.gy}) Level=${sp.level} Range=${rangeLabel[sp.level]||sp.range}`);
    });
  } else {
    console.log('\n❌ FAILED: 洒水器未出现在状态中');
  }
} else {
  console.log('⚠️  附近没有可耕种土地');
}

ws.close();
process.exit(0);
