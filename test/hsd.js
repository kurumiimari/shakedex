const { spawn } = require('child_process');
const path = require('path');
const { NodeClient, WalletClient } = require('hs-client');
const Network = require('hsd/lib/protocol/network.js');
const { Context, staticPassphraseGetter } = require('../src/context.js');
const { transferNameLock, finalizeNameLock } = require('../src/swapService.js');

const network = Network.get('regtest');
const hsdPath = path.resolve(
  path.join(__dirname, '..', 'node_modules', 'hsd', 'bin', 'hsd')
);

let hsd;
let nodeClient;
let walletClient;

const zeroAddr = 'rs1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqn6kda';

class HSD {
  constructor(host, apiKey) {
    this.hsd = null;
    this.host = host;
    this.apiKey = apiKey;
    this.nodeClient = new NodeClient({
      port: network.rpcPort,
      host: this.host,
      apiKey: this.apiKey,
    });

    this.walletClient = new WalletClient({
      port: network.walletPort,
      host: this.host,
      apiKey: this.apiKey,
    });
  }

  async verifyConnection() {
    console.log('Verifying connection.');
    for (let i = 0; i <= 3; i++) {
      if (i === 3) {
        throw new Error('failed to connect to HSD');
      }

      try {
        await this.nodeClient.getInfo();
        break;
      } catch (e) {
        console.error('Error connecting to HSD:', e);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    console.log('Connection OK.');
  }
}

class LocalHSD extends HSD {
  constructor() {
    super('127.0.0.1', 'test');
  }

  async start() {
    if (this.hsd) {
      return;
    }

    const hsd = spawn(hsdPath, [
      '--index-tx',
      '--index-address',
      '--network=regtest',
      `--api-key=${this.apiKey}`,
      '--log-level=debug',
    ]);
    hsd.stdout.on('data', (data) => {
      if (process.env.SILENCE_HSD) {
        return;
      }
      console.log(`[HSD STDOUT] ${data.toString().trim()}`);
    });
    hsd.stderr.on('data', (data) => {
      if (process.env.SILENCE_HSD) {
        return;
      }
      console.log(`[HSD STDERR] ${data.toString().trim()}`);
    });
    hsd.on('close', (code) => {
      if (code && code !== 143) {
        const err = new Error(`HSD exited with non-zero exit code ${code}.`);
        if (err) {
          this.stopAwaiter.reject(err);
        } else {
          throw err;
        }
      }

      this.stopAwaiter && this.stopAwaiter.resolve();
    });

    this.hsd = hsd;
    return this.verifyConnection();
  }

  stop() {
    const res = new Promise((resolve, reject) => {
      this.stopAwaiter = {
        resolve,
        reject,
      };
    });
    this.hsd.kill('SIGTERM');
    return res;
  }
}

class RemoteHSD extends HSD {
  constructor() {
    super(process.env.TEST_HSD_HOST, process.env.TEST_HSD_API_KEY);
  }

  start() {
    if (this.hsd) {
      return;
    }

    return this.verifyConnection();
  }

  async stop() {}
}

exports.startRegtest = async function () {
  if (hsd) {
    return;
  }

  if (process.env.TEST_HSD_HOST) {
    console.log('Starting remote HSD.');
    hsd = new RemoteHSD();
  } else {
    console.log('Starting local HSD.');
    hsd = new LocalHSD();
  }

  await hsd.start();
  nodeClient = hsd.nodeClient;
  walletClient = hsd.walletClient;
};

exports.stopRegtest = async function () {
  if (!hsd) {
    throw new Error('HSD is not running.');
  }

  console.log('Stopping HSD.');
  await hsd.stop();
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
  const wids = [
    `test-wallet-${Date.now()}-alice`,
    `test-wallet-${Date.now()}-bob`,
    `test-wallet-${Date.now()}-charlie`,
  ];
  for (const wid of wids) {
    await exports.createWallet(wid, 'password');
    const addr = await exports.generateAddress(wid);
    await exports.generateToAddress(addr.address, 10);
  }
  await exports.mine(10);

  const alice = new Context(
    'regtest',
    wids[0],
    hsd.apiKey,
    staticPassphraseGetter('password'),
    hsd.host
  );
  const bob = new Context(
    'regtest',
    wids[1],
    hsd.apiKey,
    staticPassphraseGetter('password'),
    hsd.host
  );
  const charlie = new Context(
    'regtest',
    wids[2],
    hsd.apiKey,
    staticPassphraseGetter('password'),
    hsd.host
  );

  return {
    alice,
    bob,
    charlie,
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

exports.buyName = async function (alice, name) {
  await exports.sendOpen(alice.walletId, name);
  await exports.mine(8);
  await exports.sendBid(alice.walletId, name, 1, 2);
  await exports.sendBid(alice.walletId, name, 4, 8);
  await exports.sendBid(alice.walletId, name, 8, 16);
  await exports.mine(10);
  await exports.sendReveal(alice.walletId, name);
  await exports.mine(10);
  await exports.sendUpdate(alice.walletId, name, {
    records: [
      {
        type: 'NS',
        ns: 'alice.com.',
      },
    ],
  });
  await exports.mine(1);
};

exports.setupSwap = async function () {
  const { alice, bob, charlie } = await exports.createAliceBob();
  const name = await exports.grindName();
  await exports.buyName(alice, name);
  const transferLock = await transferNameLock(alice, name);
  await exports.mine(10);
  const finalizeLock = await finalizeNameLock(alice, transferLock);
  await exports.mine(1);

  return {
    alice,
    bob,
    charlie,
    name,
    transferLock,
    finalizeLock,
  };
};
