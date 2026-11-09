const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const cliRequire = createRequire(require.resolve('@webos-tools/cli/package.json'));
let failures = 0;
function check(name, fn) {
  try { fn(); console.log(name + ': passed'); }
  catch (error) { failures++; console.error(name + ': ' + error.message); }
}

check('Proxy trust rejects IPv4 outside a mapped IPv6 subnet', () => {
  const proxyaddr = cliRequire('proxy-addr');
  assert.equal(proxyaddr.compile('::ffff:10.0.0.0/8')('203.0.113.9'), false);
  assert.equal(proxyaddr.compile('::ffff:10.0.0.0/104')('10.1.2.3'), true);
  assert.equal(proxyaddr.compile('10.0.0.0/8')('203.0.113.9'), false);
});

check('Sprintf source and shipped bundle tolerate hostile numeric precision', () => {
  const source = cliRequire.resolve('sprintf-js');
  const dist = path.join(path.dirname(path.dirname(source)), 'dist/sprintf.min.js');
  for (const target of [source, dist]) {
    const { sprintf, vsprintf } = require(target);
    assert.equal(sprintf('%-6s %04d %.2f', 'TV', 7, 1.25), 'TV     0007 1.25');
    assert.equal(vsprintf('%s %d', ['TV', 7]), 'TV 7');
    assert.equal(sprintf('%.0s', 'text'), '');
    assert.equal(sprintf('%.0t', true), '');
    assert.equal(sprintf('%.0f', 1.75), '2');
    assert.equal(sprintf('%.0g', 1.75), '2');
    const child = spawnSync(process.execPath, ['-e', `
      const { sprintf } = require(${JSON.stringify(target)});
      setImmediate(() => {
        for (const type of ['e', 'f', 'g']) {
          for (const p of ['101', '1000000', '9'.repeat(10000)]) {
            const result = sprintf('%.' + p + type, 1.25);
            if (typeof result !== 'string' || result.length > 120) process.exit(2);
          }
        }
        if (sprintf('%.0g', 1) !== '1') process.exit(3);
      });
    `], { timeout: 5000, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr || String(child.error));
  }
});

check('Braces accepts normal patterns and bounds parsing and AST traversal', () => {
  const braces = cliRequire('braces');
  assert.deepEqual(braces.expand('file-{a,b}-{1..2}'), ['file-a-1', 'file-a-2', 'file-b-1', 'file-b-2']);
  assert.equal(braces.stringify(braces.parse('{a,b}'), { escapeInvalid: true }), '{a,b}');
  for (const [open, close] of [['{', '}'], ['(', ')']]) {
    const pattern = open.repeat(101) + 'a,b' + close.repeat(101);
    assert.throws(() => braces.parse(pattern), /depth/i);
    assert.throws(() => braces.parse(pattern, { maxDepth: 100000 }), /depth/i);
    const ast = braces.parse(open.repeat(20) + 'a,b' + close.repeat(20));
    for (const fn of ['compile', 'expand', 'stringify']) {
      assert.throws(() => braces[fn](ast, { maxDepth: 5 }), /depth/i);
    }
  }
});

check('Both minimatch generations bound hostile brace expansions', () => {
  const minimatchPaths = [
    cliRequire.resolve('minimatch', { paths: [path.dirname(cliRequire.resolve('fstream'))] }),
    cliRequire.resolve('minimatch', { paths: [path.dirname(cliRequire.resolve('rimraf'))] })
  ];
  assert.equal(new Set(minimatchPaths).size, 2, 'Exercise both installed minimatch generations');
  for (const target of minimatchPaths) {
    const child = spawnSync(process.execPath, ['-e', `
      const assert = require('node:assert/strict');
      const mm = require(${JSON.stringify(target)});
      assert.deepEqual(mm.braceExpand('file-{a,b}'), ['file-a', 'file-b']);
      mm.braceExpand('{' + '{a},'.repeat(7000) + 'b}');
      mm.braceExpand('{'.repeat(3200) + 'a,b' + '}'.repeat(3200));
      mm.braceExpand('{a}' + '}'.repeat(32000) + ',z}');
    `], { timeout: 5000, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr || String(child.error));
  }
});
process.exitCode = failures ? 1 : 0;
