const MTX = require('hsd/lib/primitives/mtx.js');
const Output = require('hsd/lib/primitives/output.js');
const Coin = require('hsd/lib/primitives/coin.js');
const rules = require('hsd/lib/covenants/rules.js');
const Address = require('hsd/lib/primitives/address.js');
const { mine, sendUpdate, setupSwap } = require('./hsd.js');
const {
  proposeSwap,
  fillSwap,
  finalizeSwap,
} = require('../src/swapService.js');
const chai = require('chai');
const { getRenewalBlock } = require('../src/utils.js');
const { createLockScript } = require('../src/script.js');
const secp256k1 = require('bcrypto/lib/secp256k1.js');
const common = require('hsd/lib/script/common.js');
const Witness = require('hsd/lib/script/witness.js');
const { generateAddress } = require('./hsd.js');
const { finalizeNameLockCancel } = require('../src/swapService.js');
const { transferNameLockCancel } = require('../src/swapService.js');

const { assert } = chai;
const { SINGLEREVERSE, ANYONECANPAY } = common.hashType;

describe('Swap service', () => {
  let alice;
  let bob;
  let charlie;
  let name;
  let transferLock;
  let finalizeLock;
  let feeAddr;

  beforeEach(async () => {
    const setupRes = await setupSwap();
    alice = setupRes.alice;
    bob = setupRes.bob;
    charlie = setupRes.charlie;
    name = setupRes.name;
    transferLock = setupRes.transferLock;
    finalizeLock = setupRes.finalizeLock;
    feeAddr = (await generateAddress(charlie.walletId)).address;
  });

  for (const fee of [0, 10]) {
    describe(`end-to-end (${fee} fee)`, () => {
      let aliceStartBalance;
      let bobStartBalance;
      let charlieStartBalance;
      let swapProof;
      let fill;

      beforeEach(async () => {
        aliceStartBalance = await alice.wallet.getBalance('default');
        bobStartBalance = await bob.wallet.getBalance('default');
        charlieStartBalance = await charlie.wallet.getBalance('default');
        swapProof = await proposeSwap(
          alice,
          finalizeLock,
          10 * 1e6,
          0,
          null,
          fee * 1e6,
          feeAddr
        );
        fill = await fillSwap(bob, swapProof);
        await mine(10);
        await finalizeSwap(bob, fill);
        await mine(1);
      });

      it("should pay Alice from Bob's wallet", async () => {
        const aliceBalance = await alice.wallet.getBalance('default');
        const bobBalance = await bob.wallet.getBalance('default');
        assert.isAtLeast(
          aliceBalance.confirmed - aliceStartBalance.confirmed,
          9 * 1e6
        );
        assert.isAtMost(
          bobStartBalance.confirmed - bobBalance.confirmed - fee * 1e6,
          11 * 1e6
        );
      });

      it('should pay Charlie the necessary fee', async () => {
        const charlieBalance = await charlie.wallet.getBalance('default');

        assert.isAtLeast(
          charlieBalance.confirmed - charlieStartBalance.confirmed,
          fee * 1e6
        );
      });

      it('should transfer ownership of the name to Bob', async () => {
        await sendUpdate(bob.walletId, name, {
          records: [
            {
              type: 'NS',
              ns: 'bob.com.',
            },
          ],
        });
        await mine(1);
        const resource = await bob.wallet.getResource(name);
        assert.deepStrictEqual(resource.records, [
          {
            type: 'NS',
            ns: 'bob.com.',
          },
        ]);
        await assert.isRejected(
          sendUpdate(alice.walletId, name, {
            records: [
              {
                type: 'NS',
                ns: 'alice.com.',
              },
            ],
          })
        );
      });
    });
  }
});

describe('finalizeNameLock', () => {
  let alice;
  let name;
  let finalizeLock;

  async function attemptSpend(covenantFactory, ip) {
    const nameState = await alice.execNode('getnameinfo', name);
    const renewalBlock = Buffer.from(await getRenewalBlock(alice), 'hex');
    const coin = new Coin().fromJSON(
      await alice.nodeClient.getCoin(finalizeLock.finalizeTxHash, 0)
    );
    const output = new Output();
    output.value = coin.value;
    output.address = coin.address;

    await covenantFactory(output.covenant, nameState, renewalBlock);

    const mtx = new MTX();
    mtx.addCoin(coin);
    mtx.addOutput(output);
    const pubKey = secp256k1.publicKeyCreate(finalizeLock.privateKey);
    const lockScript = createLockScript(pubKey);
    const signature = mtx.signature(
      0,
      lockScript,
      coin.value,
      finalizeLock.privateKey,
      ANYONECANPAY | SINGLEREVERSE
    );
    const witness = new Witness([
      Buffer.from(signature, 'hex'),
      Buffer.from(lockScript.toHex(), 'hex'),
    ]);
    witness.compile();
    mtx.inputs[0].witness = witness;

    assert.throws(() => {
      mtx.checkInput(0, coin, ANYONECANPAY | SINGLEREVERSE);
    }, `EVAL_FALSE`);
  }

  beforeEach(async () => {
    const setupRes = await setupSwap();
    alice = setupRes.alice;
    name = setupRes.name;
    finalizeLock = setupRes.finalizeLock;
  });

  it('cannot be revoked', () => {
    return attemptSpend(async (cov, ns) => {
      cov.type = rules.types.REVOKE;
      cov.pushHash(rules.hashName(name));
      cov.pushU32(ns.info.height);
    }, 10);
  });

  it('cannot be renewed', async () => {
    return attemptSpend(async (cov, ns, renewalBlock) => {
      cov.type = rules.types.RENEW;
      cov.pushHash(rules.hashName(name));
      cov.pushU32(ns.info.height);
      cov.pushHash(renewalBlock);
    }, 16);
  });

  it('cannot be updated', () => {
    return attemptSpend(async (cov, ns) => {
      cov.type = rules.types.UPDATE;
      cov.pushHash(rules.hashName(name));
      cov.pushU32(ns.info.height);
      cov.push(Buffer.from('0000', 'hex'));
    }, 4);
  });
});

describe('proposeSwap', () => {
  let alice;
  let bob;
  let name;
  let proposedSwap;

  beforeEach(async () => {
    const setupRes = await setupSwap();
    alice = setupRes.alice;
    bob = setupRes.bob;
    name = setupRes.name;
    const finalizeLock = setupRes.finalizeLock;
    proposedSwap = await proposeSwap(alice, finalizeLock, 100);
  });

  it('should validate when correctly generated', () => {
    return assert.becomes(proposedSwap.verify(alice), true);
  });

  it('should be invalid when the name changes', () => {
    proposedSwap.name = 'bazfoo';
    return assert.becomes(proposedSwap.verify(alice), false);
  });

  it('should be invalid when the price changes', () => {
    proposedSwap.price = 0;
    return assert.becomes(proposedSwap.verify(alice), false);
  });

  it('should be invalid when the recipient address changes', () => {
    proposedSwap.paymentAddr = new Address();
    return assert.becomes(proposedSwap.verify(alice), false);
  });

  it('should be invalid when the locktime changes', () => {
    proposedSwap.lockTime = Math.floor(Date.now() / 1000);
    return assert.becomes(proposedSwap.verify(alice), false);
  });

  it('should be invalid if the coin is spent', async () => {
    await fillSwap(bob, proposedSwap);
    await mine(1);

    return assert.becomes(proposedSwap.verify(alice), false);
  });
});

describe('fillSwap', () => {
  let alice;
  let bob;
  let name;
  let proposedSwap;

  beforeEach(async () => {
    const setupRes = await setupSwap();
    alice = setupRes.alice;
    bob = setupRes.bob;
    name = setupRes.name;
    const finalizeLock = setupRes.finalizeLock;
    proposedSwap = await proposeSwap(alice, finalizeLock, 100);
  });

  it('should reject if the swap proof is invalid', () => {
    proposedSwap.price = 0;
    assert.isRejected(fillSwap(bob, proposedSwap));
  });
});

describe('transferNameLockCancel', () => {
  let alice;
  let name;
  let finalizeLock;
  let cancelAddr;

  beforeEach(async () => {
    const setupRes = await setupSwap();
    alice = setupRes.alice;
    name = setupRes.name;
    finalizeLock = setupRes.finalizeLock;
    cancelAddr = (await alice.wallet.createAddress('default')).address;
  });

  it('should successfully transfer the name from the locking script to cancelAddr', async () => {
    const res = (
      await transferNameLockCancel(alice, finalizeLock, cancelAddr)
    ).toJSON(alice);
    await mine(1);
    assert.isNotNull(
      await alice.nodeClient.getCoin(res.transferTxHash, res.transferOutputIdx)
    );
    assert.strictEqual(res.cancelAddr, cancelAddr);
  });
});

describe('finalizeNameLockCancel', () => {
  let alice;
  let name;
  let finalizeLock;
  let cancellationTransfer;

  beforeEach(async () => {
    const setupRes = await setupSwap();
    alice = setupRes.alice;
    name = setupRes.name;
    finalizeLock = setupRes.finalizeLock;
    const cancelAddr = (await alice.wallet.createAddress('default')).address;
    cancellationTransfer = await transferNameLockCancel(
      alice,
      finalizeLock,
      cancelAddr
    );
    await mine(11);
  });

  it('should successfully finalize the name from the locking script to cancelAddr', async () => {
    const res = await finalizeNameLockCancel(alice, cancellationTransfer);
    await mine(1);
    const tx = await alice.nodeClient.getTX(res.finalizeTxHash.toString('hex'));
    assert.notStrictEqual(tx.height, -1);
  });
});
