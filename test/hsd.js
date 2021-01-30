const {spawn} = require('child_process');
const path = require('path');
const {NodeClient, WalletClient} = require('hs-client');
const Network = require('hsd/lib/protocol/network.js');
const {Context, staticPassphraseGetter} = require('../src/context.js');
const {transferNameLock, finalizeNameLock} = require('../src/swapService.js');

const network = Network.get('regtest');
const hsdPath = path.resolve(path.join(__dirname, '..', 'node_modules', 'hsd', 'bin', 'hsd'));

let hsd;
let stopAwaiter;

const zeroAddr = 'rs1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqn6kda';

const nodeClient = new NodeClient({
  port: network.rpcPort,
  apiKey: 'test',
});

const walletClient = new WalletClient({
  port: network.walletPort,
  apiKey: 'test',
});

exports.startRegtest = async function () {
  if (hsd) {
    return;
  }

  hsd = spawn(hsdPath, ['--index-tx', '--network=regtest', '--api-key=test', '--log-level=debug']);
  hsd.stdout.on('data', (data) => console.log(`[HSD STDOUT] ${data.toString().trim()}`));
  hsd.stderr.on('data', (data) => console.log(`[HSD STDERR] ${data.toString().trim()}`));
  hsd.on('close', (code) => {
    if (code && code !== 143) {
      const err = new Error(`HSD exited with non-zero exit code ${code}.`);
      if (err) {
        stopAwaiter.reject(err);
      } else {
        throw err;
      }
    }

    stopAwaiter && stopAwaiter.resolve();
  });

  for (let i = 0; i <= 3; i++) {
    if (i === 3) {
      throw new Error('hsd did not start.');
    }

    try {
      await nodeClient.getInfo();
      break;
    } catch (e) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
};

exports.stopRegtest = async function () {
  if (!hsd) {
    throw new Error('HSD is not running.');
  }

  const res = new Promise((resolve, reject) => {
    stopAwaiter = {
      resolve,
      reject,
    };
  });
  hsd.kill('SIGTERM');
  return res;
};

exports.mine = async function (n) {
  await exports.generateToAddress(zeroAddr, n);
};

exports.createWallet = function (walletId, passphrase) {
  return walletClient.createWallet(walletId, {
    passphrase,
  });
};

exports.createAliceBob = async function () {
  const wids = [`test-wallet-${Date.now()}-alice`, `test-wallet-${Date.now()}-bob`];
  for (const wid of wids) {
    await exports.createWallet(wid, 'password');
    const addr = await exports.generateAddress(wid);
    await exports.generateToAddress(addr.address, 5);
  }
  await exports.mine(10);

  const alice = new Context(
    'regtest',
    wids[0],
    'test',
    staticPassphraseGetter('password'),
  );
  const bob = new Context(
    'regtest',
    wids[1],
    'test',
    staticPassphraseGetter('password'),
  );

  return {
    alice,
    bob,
  };
};

exports.grindName = function (len = 5) {
  return nodeClient.execute('grindname', [len]);
};

exports.selectWallet = function (walletId) {
  return walletClient.execute('selectwallet', [walletId]);
};

exports.generateToAddress = function (address, count = 1) {
  return nodeClient.execute('generatetoaddress', [count, address]);
};

exports.generateAddress = function (walletId) {
  const wallet = walletClient.wallet(walletId);
  return wallet.createAddress('default');
};

exports.sendOpen = async function (walletId, name) {
  await exports.selectWallet(walletId);
  return walletClient.execute('sendopen', [name]);
};

exports.sendBid = async function (walletId, name, amount, lockup) {
  await exports.selectWallet(walletId);
  return walletClient.execute('sendbid', [name, amount, lockup]);
};

exports.sendReveal = async function (walletId, name) {
  await exports.selectWallet(walletId);
  return walletClient.execute('sendreveal', [name]);
};

exports.sendUpdate = async function (walletId, name, data) {
  await exports.selectWallet(walletId);
  return walletClient.execute('sendupdate', [name, data]);
};

exports.sendTransfer = async function (walletId, name, recipient) {
  await exports.selectWallet(walletId);
  return walletClient.execute('sendtransfer', [name, recipient]);
};

exports.sendFinalize = async function (walletId, name) {
  await exports.selectWallet(walletId);
  return walletClient.execute('sendfinalize', [name]);
};

exports.setupSwap = async function () {
  const {alice, bob} = await exports.createAliceBob();
  const name = await exports.grindName();
  await exports.sendOpen(alice.walletId, name);
  await exports.mine(8);
  await exports.sendBid(alice.walletId, name, 1, 2);
  await exports.mine(10);
  await exports.sendReveal(alice.walletId, name);
  await exports.mine(10);
  await exports.sendUpdate(alice.walletId, name, {
    records: [{
      type: 'NS',
      ns: 'alice.com.',
    }],
  });
  await exports.mine(1);
  const transferLock = await transferNameLock(
    alice,
    name,
  );
  await exports.mine(10);
  const finalizeLock = await finalizeNameLock(alice, transferLock);
  await exports.mine(1);

  return {
    alice,
    bob,
    name,
    transferLock,
    finalizeLock,
  };
};