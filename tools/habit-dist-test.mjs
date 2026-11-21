// tools/habit-dist-test.mjs —— 人设习惯引擎活体分布验证
// 直接调用服务端真实习惯引擎（world/habits.ts 的 buildDailyHabits）：
//   - 用假大脑(echo)回放依赖的确定性硬约束：种子 = f(游戏日, 卡id)，现实时钟不参与。
//   - 因此无需拉起整台服务器即可在「同输入同输出」语义下量动词分布。
// 验证目标：
//   1) 渔夫人设(hobbies 含 渔业)的「钓鱼」当顶级动词比例，显著高于非渔夫。
//   2) 吝啬人设(俭>=4)且本身是赶集爱好者的「赶集交易」权重/占比，高于同级非吝啬交易者。
//      —— 七维修边规则对俭>=4 把 market 权重乘以 (1+0.05*s)，故必须在「已是交易者」
//         的子集里比，才能把维度效应从爱好主效应里剥离出来。
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const HABITS_URL = pathToFileURL(join(REPO, 'server/src/world/habits.ts')).href;

const { buildDailyHabits, loadPersonas } = await import(HABITS_URL);

const DATA_DIR = join(REPO, 'data');
const DAYS = 30;

const cards = loadPersonas(DATA_DIR);
if (!cards.length) { console.error('FAIL: no persona cards loaded from ' + DATA_DIR); process.exit(1); }

// 统计某组人设在所有游戏日的 ranked[0] 顶级动词里 verb 占比（%），以及某动词平均权重
function measure(list, verb) {
  let top1 = 0, wSum = 0, n = 0;
  for (const c of list) {
    for (let d = 1; d <= DAYS; d++) {
      const r = buildDailyHabits(c, d);
      n++;
      if (r.ranked[0].verb === verb) top1++;
      const mw = r.ranked.find(x => x.verb === verb);
      if (mw) wSum += mw.weight;
    }
  }
  return { top1Pct: (top1 / n * 100), meanW: wSum / n, samples: n };
}

const isFisher = c => c.hobbies.includes('渔业');
const isTrader = c => c.hobbies.includes('赶集');
const jian = c => (c.scores['俭'] || 0);

const fishers = cards.filter(isFisher);
const nonFishers = cards.filter(c => !isFisher(c));
const traders = cards.filter(isTrader);
const miserTraders = traders.filter(c => jian(c) >= 4); // 吝啬且本身是交易者
const baseTraders = traders.filter(c => jian(c) < 4);  // 同好交易但非吝啬

const fisherFish = measure(fishers, 'fish');
const nonFishFish = measure(nonFishers, 'fish');
const miserMarket = measure(miserTraders, 'market');
const baseMarket = measure(baseTraders, 'market');

const p1 = (a, b) => b === 0 ? a > 0 : a > b * 3;
const pass1 = p1(fisherFish.top1Pct, nonFishFish.top1Pct);
const pass2 = miserMarket.top1Pct > baseMarket.top1Pct + 10;

console.log('=== Habit Distribution Live Test (real engine: world/habits.ts) ===');
console.log(`cards=${cards.length} days=${DAYS} (deterministic seed=f(day,cardId))\n`);
console.log(`Group sizes: fishers=${fishers.length} nonFishers=${nonFishers.length} | ` +
            `traders=${traders.length} miserTraders=${miserTraders.length} baseTraders=${baseTraders.length}\n`);

console.log('--- Criterion 1: fishers fish >> non-fishers ---');
console.log(`  fisher    fish as #1: ${fisherFish.top1Pct.toFixed(1)}%  (mean fish weight ${fisherFish.meanW.toFixed(3)}, n=${fisherFish.samples})`);
console.log(`  non-fisher fish as #1: ${nonFishFish.top1Pct.toFixed(1)}%  (mean fish weight ${nonFishFish.meanW.toFixed(3)}, n=${nonFishFish.samples})`);
console.log(`  -> pass1 (fisher > nonFisher*3): ${pass1 ? 'YES' : 'NO'}\n`);

console.log('--- Criterion 2: miser-traders trade >> baseline traders ---');
console.log(`  miser-trader(俭>=4)    market as #1: ${miserMarket.top1Pct.toFixed(1)}%  (mean market weight ${miserMarket.meanW.toFixed(3)}, n=${miserMarket.samples})`);
console.log(`  base-trader(俭<4)      market as #1: ${baseMarket.top1Pct.toFixed(1)}%  (mean market weight ${baseMarket.meanW.toFixed(3)}, n=${baseMarket.samples})`);
console.log(`  -> pass2 (miserTop1 > baseTop1+10): ${pass2 ? 'YES' : 'NO'}\n`);

const ok = pass1 && pass2;
console.log(`Result: ${ok ? 'PASS' : 'FAIL'}`);
process.exit(ok ? 0 : 1);