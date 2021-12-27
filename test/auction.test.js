const { proposeSwap } = require('../src/swapService.js');
const { setupSwap } = require('./hsd.js');
const { linearReductionStrategy, Auction } = require('../src/auction.js');
const { assert } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateAddress } = require('./hsd.js');
const { AuctionFactory } = require('../src/auction.js');

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
      { price: 833334, lockTime: 172800 },
      { price: 750001, lockTime: 259200 },
      { price: 666668, lockTime: 345600 },
      { price: 583335, lockTime: 432000 },
      { price: 500002, lockTime: 518400 },
    ]);
  });
});

describe('Auction', () => {
  let setupRes;
  let alice;

  beforeEach(async () => {
    setupRes = await setupSwap();
    alice = setupRes.alice;
  });

  describe('serialization', () => {
    let name;
    let feeAddr;
    let finalizeLock;
    let proposedSwap1;
    let proposedSwap2;
    let auction;

    const tmpdir = path.join(os.tmpdir(), `shakedex-${Date.now()}`);

    beforeEach(async () => {
      await fs.mkdirSync(tmpdir);

      alice = setupRes.alice;
      name = setupRes.name;
      feeAddr = (await generateAddress(setupRes.charlie.walletId)).address;
      finalizeLock = setupRes.finalizeLock;
      proposedSwap1 = await proposeSwap(
        alice,
        finalizeLock,
        1000,
        50,
        null,
        10,
        feeAddr
      );
      proposedSwap2 = await proposeSwap(
        alice,
        finalizeLock,
        100,
        100,
        null,
        20,
        feeAddr
      );
      auction = new Auction({
        name: finalizeLock.name,
        lockingTxHash: finalizeLock.finalizeTxHash,
        lockingOutputIdx: finalizeLock.finalizeOutputIdx,
        publicKey: finalizeLock.publicKey,
        paymentAddr: proposedSwap1.paymentAddr,
        feeAddr: proposedSwap1.feeAddr,
        data: [
          {
            price: proposedSwap1.price,
            lockTime: proposedSwap1.lockTime,
            signature: proposedSwap1.signature,
            fee: proposedSwap1.fee,
          },
          {
            price: proposedSwap2.price,
            lockTime: proposedSwap2.lockTime,
            signature: proposedSwap2.signature,
            fee: proposedSwap2.fee,
          },
        ],
      });
    });

    it('should write a valid proof file', async () => {
      const fileName = auction.fileName;
      const auctionPath = path.join(tmpdir, fileName);
      const stream = fs.createWriteStream(auctionPath);
      await auction.writeToStream(alice, stream);

      const data = (await fs.promises.readFile(auctionPath)).toString('utf-8');
      const auctionJSON = JSON.parse(data);
      assert.equal(auctionJSON.version, 2);
      const swap1JSON = proposedSwap1.toJSON(alice);
      const swap2JSON = proposedSwap2.toJSON(alice);

      assert.deepStrictEqual(auctionJSON, {
        version: 2,
        name,
        lockingTxHash: swap1JSON.lockingTxHash,
        lockingOutputIdx: swap1JSON.lockingOutputIdx,
        publicKey: swap1JSON.publicKey,
        paymentAddr: swap1JSON.paymentAddr,
        feeAddr,
        data: [
          {
            price: swap1JSON.price,
            lockTime: swap1JSON.lockTime,
            signature: swap1JSON.signature,
            fee: 10,
          },
          {
            price: swap2JSON.price,
            lockTime: swap2JSON.lockTime,
            signature: swap2JSON.signature,
            fee: 20,
          },
        ],
      });
    });
  });

  describe('deserialization', () => {
    it('should deserialize proof files with no fees defined', async () => {
      const stream = fs.readFileSync(
        path.join(__dirname, 'fixtures', 'proof_no_fee.json')
      );
      const auction = await Auction.fromStream(stream);

      assert.deepStrictEqual(auction.toJSON(alice), {
        version: 2,
        name: 'cliqy',
        lockingTxHash:
          'a5a9e2732cfb7156cdfda59a73d11ed1c871628281d467313fdf580695999e08',
        lockingOutputIdx: 0,
        publicKey:
          '03d9fcbcd355ce2927bf52d8cf04e1ea690626643febb5b63abad52c3ead977dc2',
        feeAddr: null,
        paymentAddr: 'rs1qq9vz9exhddh4qerptv6fyzmprgnsy804mhegrx',
        data: [
          {
            price: 1000,
            lockTime: 50,
            fee: 0,
            signature:
              'a32d46fcdb92b7e70f955b02697b3cefcc71d50ef1e7667072cf504f2e7aa00267576ee434204be011d57b0c080869b9375070182b9eba2b6e604970ffa2cb0784',
          },
          {
            price: 100,
            lockTime: 100,
            fee: 0,
            signature:
              '84d6602e30ec78b4c525b9ded1c3a41cc84e911fa20b2addbb970b60d384c1dd4ca68e57aacf6ba4e1bf6ba7d81e3d7d53cfcb9a10df9d5a91a0eeba4d0e8c3084',
          },
        ],
      });
    });

    it('should deserialize proof files with fees defined', async () => {
      const stream = fs.readFileSync(
        path.join(__dirname, 'fixtures', 'proof_with_fee.json')
      );
      const auction = await Auction.fromStream(stream);

      assert.deepStrictEqual(auction.toJSON(alice), {
        version: 2,
        name: 'cakcp',
        lockingTxHash:
          '0fe156590b5925919ccffb4f732b704d4e0ff37c78f15b24b65d39423559102f',
        lockingOutputIdx: 0,
        publicKey:
          '0203868609a14c8db6d30cbc38d2b07ec1ed545eb97a9eee9221d565a5e6769a00',
        paymentAddr: 'rs1q5aygjrhe6wt0qnhrshwpknfct7xflpa7792h67',
        feeAddr: 'rs1qrntg75vjhnl766uk2ylq0zl7u3n6rw8cw7ea8t',
        data: [
          {
            price: 1000,
            lockTime: 50,
            fee: 10,
            signature:
              'bbaff66341483fbc6d2857859a1aa80069036f7ee4b5a6d8ecf5809a284920101ec06f0a65c47f730529f4294e085655fdefeaca2b52a56658e0ac89d01b540f84',
          },
          {
            price: 100,
            lockTime: 100,
            fee: 20,
            signature:
              'e1061054798f50e9dcabf3e5bcef49a8a3aa382f8310937e42e272eb880c82995d0862f0daa2117673e016cb5cf0628b5be1f99ec588bc774c092386a0a89fa484',
          },
        ],
      });
    });

    it('should reject invalid proof: deprecated', async () => {
      const stream = fs.readFileSync(
        path.join(__dirname, 'fixtures', 'proof_with_fee-deprecated.txt')
      );
      let err;
      try {
        await Auction.fromStream(stream);
      } catch(e) {
        err = e;
      }
      assert(err);
      assert.strictEqual(
        err.message,
        'Invalid proof: Proof file must be valid JSON.'
      );
    });
      
    it('should reject invalid proof: deprecated', async () => {
      const stream = fs.readFileSync(
        path.join(__dirname, 'fixtures', 'proof_no_fee-deprecated.txt')
      );
      let err;
      try {
        await Auction.fromStream(stream);
      } catch(e) {
        err = e;
      }
      assert(err);
      assert.strictEqual(
        err.message,
        'Invalid proof: Proof file must be valid JSON.'
      );
    });

    it('should reject invalid proof: version string', async () => {
      const stream = {
        version: '1.0.0'
      }
      let err;
      try {
        await Auction.fromStream(JSON.stringify(stream));
      } catch(e) {
        err = e;
      }
      assert(err);
      assert.strictEqual(
        err.message,
        'Invalid proof: Proof version must be a number.'
      );
    });

    it('should reject invalid proof: no version', async () => {
      const stream = {
        SHAKEDEX_PROOF: 2
      }
      let err;
      try {
        await Auction.fromStream(JSON.stringify(stream));
      } catch(e) {
        err = e;
      }
      assert(err);
      assert.strictEqual(
        err.message,
        'Invalid proof: Proof version missing.'
      );
    });

    it('should reject invalid proof: unsupported', async () => {
      const stream = {
        version: 1
      }
      let err;
      try {
        await Auction.fromStream(JSON.stringify(stream));
      } catch(e) {
        err = e;
      }
      assert(err);
      assert.strictEqual(
        err.message,
        'Invalid proof: Unsupported proof version.'
      );
    });
  });
});

describe('AuctionFactory', () => {
  let alice;
  let feeAddr;
  let name;
  let finalizeLock;
  let auctionFactory;

  beforeEach(async () => {
    const setupRes = await setupSwap();
    const charlie = setupRes.charlie;
    alice = setupRes.alice;
    name = setupRes.name;
    finalizeLock = setupRes.finalizeLock;
    feeAddr = (await generateAddress(charlie.walletId)).address;

    auctionFactory = new AuctionFactory({
      name: 'test',
      reductionStrategy: 'LINEAR',
      startTime: Date.now(),
      endTime: Date.now() + 86400000,
      startPrice: 10000000,
      endPrice: 1000000,
      reductionTimeMS: 3600000,
      feeRate: 100,
      feeAddr,
    });
  });

  it('should generate auctions with valid fee rates', async () => {
    const auction = await auctionFactory.createAuction(alice, finalizeLock);
    const auctionJSON = auction.toJSON(alice);
    const finalizeLockJSON = finalizeLock.toJSON();

    assert.strictEqual(auctionJSON.name, name);
    assert.strictEqual(
      auctionJSON.lockingTxHash,
      finalizeLockJSON.finalizeTxHash
    );
    assert.strictEqual(
      auctionJSON.lockingOutputIdx,
      finalizeLockJSON.finalizeOutputIdx
    );
    assert.strictEqual(auctionJSON.publicKey, finalizeLockJSON.publicKey);
    for (const datum of auctionJSON.data) {
      assert.strictEqual(datum.fee, Math.floor(datum.price * 0.01));
    }
  });
});
