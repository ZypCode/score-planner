/**
 * 穷举对拍：把 index.html 内联的求解器抽出来，与独立实现的暴力枚举逐例比对。
 * 运行：node test/verify.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/\/\*<SOLVER_START>\*\/([\s\S]*?)\/\*<SOLVER_END>\*\//);
if (!m) { console.error('未找到 SOLVER 代码块'); process.exit(1); }

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(m[1] + '\nthis.ScoreSolver = ScoreSolver;', sandbox);
const solveWave = sandbox.ScoreSolver.solveWave;

/**
 * 暴力枚举：把每个分数分配给偏移量 0..M 的某一关（M = 剩余关卡数，M 表示"超出全部关卡"）。
 * 按顺序累加判定通关，要求分配不能跳关（最大偏移 <= 实际通关数），
 * 目标函数：先最大化通关数，再最小化溢出。
 */
function brute(targets, li, carry, items) {
  const n = targets.length;
  const M = n - li;                 // 偏移 0..M-1 为剩余关卡，M 为"超出"
  const k = items.length;
  if (M <= 0) return { cleared: 0, overflow: 0 };
  let best = { cleared: 0, overflow: Infinity };
  const a = new Array(k).fill(0);
  const total = Math.pow(M + 1, k);

  for (let t = 0; t < total; t++) {
    let x = t;
    for (let i = 0; i < k; i++) { a[i] = x % (M + 1); x = Math.floor(x / (M + 1)); }

    const sums = new Array(M + 1).fill(0);
    let maxOff = 0;
    for (let i = 0; i < k; i++) { sums[a[i]] += items[i]; if (a[i] > maxOff) maxOff = a[i]; }

    let cleared = 0, ov = 0, acc = carry;
    for (let o = 0; o < M; o++) {
      acc += sums[o];
      if (acc >= targets[li + o]) { ov += acc - targets[li + o]; cleared++; acc = 0; }
      else break;
    }
    if (maxOff > cleared) continue;            // 跳关，非法
    if (cleared === M) ov += sums[M];          // 全部通关后剩下的分数只能浪费
    if (cleared > best.cleared || (cleared === best.cleared && ov < best.overflow)) {
      best = { cleared, overflow: ov };
    }
  }
  return best;
}

function rnd(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

let cases = 0, fails = 0;
const bad = [];

for (let iter = 0; iter < 4000; iter++) {
  const n = rnd(2, 6);
  const targets = [];
  let v = rnd(5, 30);
  for (let i = 0; i < n; i++) { targets.push(v); v += rnd(5, 40); }   // 递增
  const li = rnd(0, n - 1);
  const carry = rnd(0, Math.max(0, targets[li] - 1));
  const k = rnd(0, 5);
  const wave = [];
  for (let i = 0; i < k; i++) wave.push(rnd(1, Math.max(targets[li], 40)));

  const got = solveWave(targets, li, carry, wave);
  const exp = brute(targets, li, carry, wave);
  cases++;
  if (got.groups.length !== exp.cleared || Math.abs(got.overflow - exp.overflow) > 1e-9) {
    fails++;
    if (bad.length < 6) bad.push({ targets, li, carry, wave, got: { cleared: got.groups.length, overflow: got.overflow }, exp });
  }
}

// 强度轮：分数更多、剩余关卡更多、目标非严格递增
for (let iter = 0; iter < 1500; iter++) {
  const n = rnd(3, 7);
  const targets = [];
  for (let i = 0; i < n; i++) targets.push(rnd(5, 60));   // 允许非单调
  const li = rnd(0, Math.max(0, n - 3));                  // 留出 1~3 关
  const carry = rnd(0, Math.max(0, targets[li] - 1));
  const k = rnd(3, 6);
  const wave = [];
  for (let i = 0; i < k; i++) wave.push(rnd(1, 70));

  const got = solveWave(targets, li, carry, wave);
  const exp = brute(targets, li, carry, wave);
  cases++;
  if (got.groups.length !== exp.cleared || Math.abs(got.overflow - exp.overflow) > 1e-9) {
    fails++;
    if (bad.length < 6) bad.push({ targets, li, carry, wave, got: { cleared: got.groups.length, overflow: got.overflow }, exp });
  }
}

// 边界：分数刚好等于目标 / 全部溢出 / 单关
const edges = [
  { targets: [100], li: 0, carry: 0, wave: [100] },
  { targets: [100], li: 0, carry: 0, wave: [1, 2, 3] },
  { targets: [100, 50], li: 0, carry: 0, wave: [50, 50, 50] },
  { targets: [10, 20, 30], li: 0, carry: 5, wave: [5, 20, 10, 30] },
];
for (const e of edges) {
  const got = solveWave(e.targets, e.li, e.carry, e.wave);
  const exp = brute(e.targets, e.li, e.carry, e.wave);
  cases++;
  if (got.groups.length !== exp.cleared || Math.abs(got.overflow - exp.overflow) > 1e-9) {
    fails++; bad.push({ ...e, got: { cleared: got.groups.length, overflow: got.overflow }, exp });
  }
}

console.log(`对拍用例: ${cases}，不一致: ${fails}`);
if (fails) { console.log(JSON.stringify(bad, null, 2)); process.exit(1); }
console.log('全部一致 ✅');
