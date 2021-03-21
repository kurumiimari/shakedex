const { proposeSwap } = require('../src/swapService.js');
const { setupSwap } = require('./hsd.js');
const { linearReductionStrategy, Auction } = require('../src/auction.js');
const { assert } = require('chai');
const fs = require('fs');

describe('linearAuctionStrategy', () => {
  it('should generate prices and lock times linearly', () => {
    const ONE_DAY = 24 * 60 * 60 * 1000;
    const ONE_WEEK = 7 * ONE_DAY;

    const strategy = linearReductionStrategy(
      0,
      ONE_WEEK,
      1000000,
      500000,
      ONE_DAY
    );

    const pricesLockTimes = [];
    let info = strategy();
    while (info) {
      pricesLockTimes.push(info);
      info = strategy();
    }

    assert.deepStrictEqual(pricesLockTimes, [
      { price: 1000000, lockTime: 0 },
      { price: 916667, lockTime: 86400 },
      { price: 857144, lockTime: 172800 },
      { price: 750001, lockTime: 259200 },
      { price: 666668, lockTime: 345600 },
      { price: 583335, lockTime: 432000 },
      { price: 500002, lockTime: 518400 },
    ]);
  });
});

describe('Auction', () => {
  describe('serialization', () => {
    let alice;
    let name;
    let finalizeLock;
    let proposedSwap1;
    let proposedSwap2;
    let auction;

    beforeEach(async () => {
      const setupRes = await setupSwap();
      alice = setupRes.alice;
      name = setupRes.name;
      finalizeLock = setupRes.finalizeLock;
      proposedSwap1 = await proposeSwap(alice, finalizeLock, 1000, 50);
      proposedSwap2 = await proposeSwap(alice, finalizeLock, 100, 100);
      auction = new Auction({
        name: finalizeLock.name,
        lockingTxHash: finalizeLock.finalizeTxHash,
        lockingOutputIdx: finalizeLock.finalizeOutputIdx,
        publicKey: finalizeLock.publicKey,
        paymentAddr: proposedSwap1.paymentAddr,
        data: [
          {
            price: proposedSwap1.price,
            lockTime: proposedSwap1.lockTime,
            signature: proposedSwap1.signature,
          },
          {
            price: proposedSwap2.price,
            lockTime: proposedSwap2.lockTime,
            signature: proposedSwap2.signature,
          },
        ],
      });
    });

    it('should write a valid proof file', async () => {
      const auctionPath = `/tmp/proof-${Date.now()}`;
      const stream = fs.createWriteStream(auctionPath);
      await auction.writeToStream(alice, stream);

      const data = (await fs.promises.readFile(auctionPath)).toString('utf-8');
      const lines = data.split('\n');
      assert.equal(lines[0], 'SHAKEDEX_PROOF:1.0.0');
      const auctionJSON = JSON.parse(lines.slice(1).join('\n'));
      const swap1JSON = proposedSwap1.toJSON(alice);
      const swap2JSON = proposedSwap2.toJSON(alice);

      assert.deepStrictEqual(auctionJSON, {
        name,
        lockingTxHash: swap1JSON.lockingTxHash,
        lockingOutputIdx: swap1JSON.lockingOutputIdx,
        publicKey: swap1JSON.publicKey,
        paymentAddr: swap1JSON.paymentAddr,
        data: [
          {
            price: swap1JSON.price,
            lockTime: swap1JSON.lockTime,
            signature: swap1JSON.signature,
          },
          {
            price: swap2JSON.price,
            lockTime: swap2JSON.lockTime,
            signature: swap2JSON.signature,
          },
        ],
      });
    });
  });
});
