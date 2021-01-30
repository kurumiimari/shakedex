const {linearReductionStrategy} = require('../src/auction.js');
const {assert} = require('chai');

describe('linearAuctionStrategy', () => {
  it('should generate prices and lock times linearly', () => {
    const ONE_DAY = 24 * 60 * 60 * 1000;
    const ONE_WEEK = 7 * ONE_DAY;

    const strategy = linearReductionStrategy(
      0,
      ONE_WEEK,
      1000000,
      500000,
      ONE_DAY,
    );

    const pricesLockTimes = [];
    let info = strategy();
    while (info) {
      pricesLockTimes.push(info);
      info = strategy();
    }

    assert.deepStrictEqual(pricesLockTimes, [
      {price: 1000000, lockTime: 0},
      {price: 928572, lockTime: 86400},
      {price: 857144, lockTime: 172800},
      {price: 785716, lockTime: 259200},
      {price: 714288, lockTime: 345600},
      {price: 642860, lockTime: 432000},
      {price: 571432, lockTime: 518400},
    ]);
  });
});