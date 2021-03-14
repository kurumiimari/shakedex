const os = require('os');
const fs = require('fs');
const path = require('path');
const { migrate } = require('../src/dataStore.js');
const { assert } = require('chai');

describe('Data migrations', () => {
  describe('on a clean shakedex install', () => {
    let tmpdir;

    beforeEach(async () => {
      tmpdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'shakedex-'));
      await migrate(tmpdir);
    });

    it('should skip to network_setup', async () => {
      const migration = await fs.promises.readFile(
        path.join(tmpdir, 'migration')
      );
      assert.strictEqual(migration.toString('utf-8'), 'network_setup');
    });
  });

  describe('on a shakedex install with an existing shakedex.db folder', () => {
    let stdin;
    let tmpdir;

    beforeEach(async () => {
      stdin = require('mock-stdin').stdin();
      tmpdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'shakedex-'));
      await fs.promises.mkdir(path.join(tmpdir, 'shakedex.db'));

      process.nextTick(() => {
        stdin.send('\n');
      });

      await migrate(tmpdir);
    });

    afterEach(() => {
      stdin.restore();
    });

    it('should create the correct network-namespaced DB', async () => {
      const newDir = fs.existsSync(path.join(tmpdir, 'shakedex.main.db'));
      const oldDir = fs.existsSync(path.join(tmpdir, 'shakedex.db'));
      assert.isTrue(newDir);
      assert.isFalse(oldDir);
    });

    it('should end at network_setup', async () => {
      const migration = await fs.promises.readFile(
        path.join(tmpdir, 'migration')
      );
      assert.strictEqual(migration.toString('utf-8'), 'network_setup');
    });
  });
});
