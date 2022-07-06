const { assert } = require('chai');
const { setupSwap, mine } = require('./hsd.js');
const { Auction, AuctionFactory } = require('../src/auction.js');
const { fillSwap } = require('../src/swapService.js');

describe('Auction Timeline', () => {
  let alice, bob, name, transferLock, finalizeLock;
  let auction, auctionJSON;

  let now;
  const TEN_MINUTES = 60 * 60 * 10;

  async function mineTime(num, context) {
    // Manually adjust regtest "network time"
    // so block timestamps are always ten minutes apart.
    for (let i = 0; i < num; i++) {
      now += TEN_MINUTES;
      await context.execNode('setmocktime', now);
      await mine(1);
    }
  }

  before(async () => {
    // Setup wallets and prepare name for auction
    setup = await setupSwap();
    alice = setup.alice;
    bob = setup.bob;
    name = setup.bob;
    transferLock = setup.transferLock;
    finalizeLock = setup.finalizeLock;

    // Get timestamp from chain tip
    const hash = await alice.execNode('getbestblockhash');
    const header = await alice.execNode('getblockheader', hash);
    now = header.time;
  });

  it('Generate 20 ten-minute blocks to simulate real MTP', async () => {
      await mineTime(20, alice);
  });

  it('Alice generates the auction JSON', async () => {
    const auctionFactory = new AuctionFactory({
      name,
      reductionStrategy: 'LINEAR',
      startTime: now,
      endTime: now + (60 * 60 * 24),  // Run for one day
      startPrice: 144 * 1e6,          // 144 HNS
      endPrice: 1 * 1e6,              // 1 HNS
      reductionTime: 60 * 60 * 2,     // two hours
      feeRate: 0
    });
    const aliceAuction = await auctionFactory.createAuction(alice, finalizeLock);
    auctionJSON = JSON.stringify(aliceAuction.toJSON(alice));
  });

  it('Bob parses the JSON', async () => {
    auction = await Auction.fromStream(auctionJSON);
  });

  it('Bob verifies the JSON', async () => {
    const ok = await auction.verifyProofs(bob, () => {});
    assert(ok);
  });

  it('The auction has not started yet', async () => {
    const [bestBid, bestProofIdx] = await auction.bestBidAt(bob);
    assert.strictEqual(bestBid, null);
    assert.strictEqual(bestProofIdx, null);

    // Sanity check
    const mtp = await bob.getMTP();
    assert(mtp < auction.data[0].lockTime);
  });

  it('Filling any bid is currently invalid', async () => {
    // Mempool is empty
    const mempool = await bob.execNode('getrawmempool');
    assert.strictEqual(mempool.length, 0);

    for (let i = 0; i < auction.data.length; i++) {
      const proof = auction.toSwapProof(i);

      // This is Bob trying to cheat and fill a bid
      // before the auction even starts (before the
      // first bid's locktime has expired).
      await fillSwap(bob, proof);

      // Mempool is STILL empty because Bob's TX is invalid
      await new Promise(r => setTimeout(r, 200));
      const mempool = await bob.execNode('getrawmempool');
      assert.strictEqual(mempool.length, 0);
    }
  });

  it('Advance 5 blocks', async () => {
    await mineTime(5, alice);
  });

  it('The auction has now started: first bid is available', async () => {
    const [bestBid, bestProofIdx] = await auction.bestBidAt(bob);
    assert.strictEqual(bestBid.price, 144 * 1e6);
    assert.strictEqual(bestProofIdx, 0);
  });

  it('Advance 1 block', async () => {
    await mineTime(1, alice);
  });

  it('The auction has now started: first 6 bids are available', async () => {
    // with 6 blocks mined, the median time unlocks 6 bids
    // the best bid is at index 5
    const [bestBid, bestProofIdx] = await auction.bestBidAt(bob);
    assert.strictEqual(bestBid.price, 79 * 1e6);
    assert.strictEqual(bestProofIdx, 5);
  });

  it('Filling other bids is still currently invalid', async () => {
    // Mempool is empty
    const mempool = await bob.execNode('getrawmempool');
    assert.strictEqual(mempool.length, 0);

    for (let i = 6; i < auction.data.length; i++) {
      const proof = auction.toSwapProof(i);

      // This is Bob trying to cheat and fill a cheap bid
      // before its intended release time.
      await fillSwap(bob, proof);

      // Mempool is STILL empty because Bob's TX is invalid
      await new Promise(r => setTimeout(r, 200));
      const mempool = await bob.execNode('getrawmempool');
      assert.strictEqual(mempool.length, 0);
    }
  });

  it('Filling first bid is valid', async () => {
    const proof = auction.toSwapProof(0);
    await fillSwap(bob, proof);

    // This TX is inserted into mempool because it is valid
    await new Promise(r => setTimeout(r, 200));
    const mempool = await bob.execNode('getrawmempool');
    assert.strictEqual(mempool.length, 1);
  });
});
