const { SwapProof } = require('./swapProof.js');
const { coerceAddress } = require('./conversions.js');
const { coerceBuffer } = require('./conversions.js');
const assert = require('assert').strict;
const readline = require('readline');

function linearReductionStrategy(
  startTime,
  endTime,
  startPrice,
  endPrice,
  reductionTimeMs
) {
  const timeIncrement = Math.floor((endTime - startTime) / reductionTimeMs);
  const priceDecrement = Math.floor((startPrice - endPrice) / timeIncrement);
  let currIncrement = 0;

  return () => {
    if (currIncrement === timeIncrement) {
      return null;
    }

    const res = {
      price: startPrice - priceDecrement * currIncrement,
      lockTime: Math.floor(
        (startTime + reductionTimeMs * currIncrement) / 1000
      ),
    };
    currIncrement++;
    return res;
  };
}

linearReductionStrategy.name = 'LINEAR';

exports.linearReductionStrategy = linearReductionStrategy;

class AuctionFactory {
  constructor(options) {
    const {
      name,
      startTime,
      endTime,
      startPrice,
      endPrice,
      reductionTimeMS,
    } = options;
    let { reductionStrategy } = options;

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

  async createAuction(context, lockFinalize, paymentAddr = null) {
    paymentAddr =
      paymentAddr || (await context.wallet.createAddress('default')).address;

    const strategy = this.strategy();

    let info = strategy();
    const data = [];
    while (info) {
      const swapProof = new SwapProof({
        lockingTxHash: lockFinalize.finalizeTxHash,
        lockingOutputIdx: lockFinalize.finalizeOutputIdx,
        name: lockFinalize.name,
        publicKey: lockFinalize.publicKey,
        paymentAddr,
        price: info.price,
        lockTime: info.lockTime,
      });
      await swapProof.sign(context, lockFinalize.privateKey);

      data.push({
        price: info.price,
        lockTime: info.lockTime,
        signature: swapProof.signature,
      });
      info = strategy();
    }

    return new Auction({
      version: 'v1.0.0',
      name: lockFinalize.name,
      lockingTxHash: lockFinalize.finalizeTxHash,
      lockingOutputIdx: lockFinalize.finalizeOutputIdx,
      publicKey: lockFinalize.publicKey,
      paymentAddr,
      data,
    });
  }

  strategy() {
    return this.reductionStrategy(
      this.startTime,
      this.endTime,
      this.startPrice,
      this.endPrice,
      this.reductionTimeMS
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

exports.AuctionFactory = AuctionFactory;

class Auction {
  static MAGIC = 'SHAKEDEX_PROOF';

  constructor(options) {
    const {
      name,
      lockingTxHash,
      lockingOutputIdx,
      publicKey,
      paymentAddr,
      data,
    } = options;

    this.name = name;
    this.lockingTxHash = coerceBuffer(lockingTxHash);
    this.lockingOutputIdx = lockingOutputIdx;
    this.publicKey = coerceBuffer(publicKey);
    this.paymentAddr = coerceAddress(paymentAddr);

    this.data = [];
    for (const datum of data) {
      this.data.push({
        price: datum.price,
        lockTime: datum.lockTime,
        signature: coerceBuffer(datum.signature),
      });
    }

    this.data.sort((a, b) => b.price - a.price);
  }

  bestBidAt(ts) {
    let currentBid = null;
    for (let i = 0; i < this.data.length; i++) {
      const datum = this.data[i];
      if (datum.lockTime > ts) {
        break;
      }
      currentBid = [datum, i];
    }
    return currentBid;
  }

  toSwapProof(idx) {
    assert(idx < this.data.length);
    assert(idx >= 0);

    const datum = this.data[idx];

    return new SwapProof({
      lockingTxHash: this.lockingTxHash,
      lockingOutputIdx: this.lockingOutputIdx,
      name: this.name,
      publicKey: this.publicKey,
      paymentAddr: this.paymentAddr,
      price: datum.price,
      lockTime: datum.lockTime,
      signature: datum.signature,
    });
  }

  async verifyProofs(context, onProgress = () => null) {
    for (let i = 0; i < this.data.length; i++) {
      const proof = this.toSwapProof(i);
      const ok = await proof.verify(context);
      if (!ok) {
        return false;
      }
      onProgress(i + 1, this.data.length);
    }
    return true;
  }

  async isFulfilled(context) {
    const lockingCoin = await context.nodeClient.getCoin(
      this.lockingTxHash.toString('hex'),
      this.lockingOutputIdx
    );
    return !lockingCoin;
  }

  toJSON(context) {
    return {
      name: this.name,
      lockingTxHash: this.lockingTxHash.toString('hex'),
      lockingOutputIdx: this.lockingOutputIdx,
      publicKey: this.publicKey.toString('hex'),
      paymentAddr: this.paymentAddr.toString(context.networkName),
      data: this.data.map((d) => ({
        price: d.price,
        lockTime: d.lockTime,
        signature: d.signature.toString('hex'),
      })),
    };
  }

  async writeToStream(context, stream) {
    await new Promise((resolve, reject) =>
      stream.write(`${Auction.MAGIC}:1.0.0\n`, (err) => {
        if (err) {
          return reject(err);
        }
        resolve();
      })
    );
    await new Promise((resolve, reject) =>
      stream.write(JSON.stringify(this.toJSON(context)), (err) => {
        if (err) {
          return reject(err);
        }
        resolve();
      })
    );
  }

  static async fromStream(input) {
    const rl = readline.createInterface({
      input,
    });
    const lines = [];
    for await (const line of rl) {
      lines.push(line);
    }
    await rl.close();

    const firstLine = lines[0].trim();
    if (firstLine !== `${Auction.MAGIC}:1.0.0`) {
      throw new Error('Invalid proof file version.');
    }

    const proofJSON = JSON.parse(lines.slice(1).join('\n'));
    return new Auction(proofJSON);
  }
}

exports.Auction = Auction;
