const {proposeSwap} = require('./swapService.js');
const assert = require('assert').strict;

function linearReductionStrategy(
  startTime,
  endTime,
  startPrice,
  endPrice,
  reductionTimeMs,
) {
  const timeIncrement = Math.floor((endTime - startTime) / reductionTimeMs);
  const priceDecrement = Math.floor((startPrice - endPrice) / timeIncrement);
  let currIncrement = 0;

  return () => {
    if (currIncrement === timeIncrement) {
      return null;
    }

    const res = {
      price: startPrice - (priceDecrement * currIncrement),
      lockTime: Math.floor((startTime + (reductionTimeMs * currIncrement)) / 1000),
    };
    currIncrement++;
    return res;
  };
}

linearReductionStrategy.name = 'LINEAR';

exports.linearReductionStrategy = linearReductionStrategy;

class Auction {
  constructor(options) {
    const {
      name,
      startTime,
      endTime,
      startPrice,
      endPrice,
      reductionTimeMS,
    } = options;
    let {reductionStrategy} = options;

    assert(typeof startTime === 'number');
    assert(typeof endTime === 'number');
    assert(startTime > 0 && endTime > startTime);
    assert(typeof startPrice === 'number');
    assert(typeof endPrice === 'number');
    assert(endPrice > 0 && startPrice > endPrice);
    assert(typeof reductionTimeMS === 'number');
    assert(reductionTimeMS > 0);

    if (typeof reductionStrategy === 'string') {
      let actualReductionStrategy;
      switch (reductionStrategy) {
        case linearReductionStrategy.name:
          actualReductionStrategy = linearReductionStrategy;
          break;
        default:
          throw new Error('Invalid reduction strategy.');
      }
      reductionStrategy = actualReductionStrategy;
    } else {
      assert(reductionStrategy === linearReductionStrategy);
    }

    this.name = name;
    this.startTime = startTime;
    this.endTime = endTime;
    this.startPrice = startPrice;
    this.endPrice = endPrice;
    this.reductionTimeMS = reductionTimeMS;
    this.reductionStrategy = reductionStrategy;
  }

  async generateProposals(context, lockFinalize) {
    const strategy = this.strategy();

    const out = [];
    let info = strategy();
    while (info) {
      out.push(await proposeSwap(
        context,
        lockFinalize,
        info.price,
        info.lockTime,
      ));
      info = strategy();
    }

    return out;
  }

  priceFor(ts) {
    ts = Math.floor(ts / 1000);
    const strategy = this.strategy();

    let lastPrice = 0;
    let info = strategy();
    while (info) {
      if (info.lockTime > ts) {
        break;
      }
      lastPrice = info.price;
      info = strategy();
    }

    return lastPrice;
  }

  strategy() {
    return this.reductionStrategy(
      this.startTime,
      this.endTime,
      this.startPrice,
      this.endPrice,
      this.reductionTimeMS,
    );
  }

  toJSON() {
    return {
      name: this.name,
      startTime: this.startTime,
      endTime: this.endTime,
      startPrice: this.startPrice,
      endPrice: this.endPrice,
      reductionTimeMS: this.reductionTimeMS,
      reductionStrategy: this.reductionStrategy.name,
    };
  }
}

exports.Auction = Auction;