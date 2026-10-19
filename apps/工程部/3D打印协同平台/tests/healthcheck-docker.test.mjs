import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';

const sourceImage = process.env.PRINTLINK_HEALTH_TEST_DOCKER_IMAGE;
function docker(args, input) {
  const result = spawnSync('docker', args, {encoding: 'utf8', input, timeout: 30000, maxBuffer: 1024 * 1024});
  assert.equal(result.status, 0, `Owned Docker ${args[0]} fixture failed: ${result.error?.code || result.status}`);
  return result.stdout.trim();
}

test('Docker timing out a direct healthcheck leaves no accumulated Node processes',
  {skip: !sourceImage, timeout: 60000}, async t => {
    assert.equal(process.platform, 'linux');
    assert.match(sourceImage, /^[A-Za-z0-9][A-Za-z0-9._/:-]{0,200}$/);
    const image = `printlink-health-timeout:${randomBytes(8).toString('hex')}`;
    let container;
    t.after(() => {
      if (container) docker(['rm', '--force', container]);
      docker(['image', 'rm', image]);
    });
    // Deliberately let Docker's 1s deadline expire before the script's own 2s
    // timer. An exec-form check must kill the Node process even in this case.
    docker(['build', '--network=none', '--tag', image, '-'],
      `FROM ${sourceImage}\nHEALTHCHECK --interval=1s --timeout=1s --retries=1 CMD ["node", "ops/healthcheck.mjs"]\n`);
    container = docker(['run', '--detach', '--init', '--network=none', '--memory=768m',
      '--memory-swap=768m', '--restart=no', '--entrypoint', 'node', image, '-e',
      "require('node:http').createServer(()=>{}).listen(3100,'127.0.0.1')"]);
    assert.match(container, /^[a-f0-9]{64}$/);
    const before = JSON.parse(docker(['inspect', '--format',
      '{"test":{{json .Config.Healthcheck.Test}},"memory":{{.HostConfig.Memory}},"swap":{{.HostConfig.MemorySwap}}}', container]));
    assert.deepEqual(before.test, ['CMD', 'node', 'ops/healthcheck.mjs']);
    assert.equal(before.memory, 768 * 1024 * 1024);
    assert.equal(before.swap, before.memory);
    await new Promise(resolve => setTimeout(resolve, 8500));
    const state = JSON.parse(docker(['inspect', '--format',
      '{"health":{{json .State.Health.Status}},"failures":{{.State.Health.FailingStreak}},"oom":{{.State.OOMKilled}},"restarts":{{.RestartCount}}}', container]));
    assert.equal(state.health, 'unhealthy');
    assert.ok(state.failures >= 3);
    assert.equal(state.oom, false);
    assert.equal(state.restarts, 0);
    // Docker uses the PID column to filter host ps output to this container.
    const processes = docker(['top', container, '-eo', 'pid,args']).split('\n').slice(1)
      .map(line => line.replace(/^\s*\d+\s+/, ''));
    const probes = processes.filter(line => /(?:^|\/)node ops\/healthcheck\.mjs$/.test(line.trim()));
    // At most the single healthcheck currently running is present; all earlier
    // timed-out checks must have exited, while the synthetic listener survives.
    assert.ok(probes.length <= 1, `Unexpected healthcheck process count: ${probes.length}`);
    assert.equal(processes.filter(line => line.includes("createServer(()=>{})")).length, 1);
    t.diagnostic(JSON.stringify({directHealthcheck: true, completedFailures: state.failures,
      activeProbeCount: probes.length, memoryMiB: 768, oomKilled: state.oom, restarts: state.restarts}));
  });
