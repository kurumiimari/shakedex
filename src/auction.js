const { SwapProof } = require('./swapProof.js');
const { coerceAddress } = require('./conversions.js');
const { coerceBuffer } = require('./conversions.js');
const assert = require('assert').strict;
const readline = require('readline');

const CURRENT_PROTOCOL_VERSION = 2;
const MINIMUM_PROTOCOL_VERSION = 2;

function linearReductionStrategy(
  startTime,
  endTime,
  startPrice,
  endPrice,
  reductionTimeMs
) {
  const stepCount = Math.floor((endTime - startTime) / reductionTimeMs);
  const priceDecrement = Math.floor((startPrice - endPrice) / (stepCount - 1));
  let currStep = 0;

  return () => {
    if (currStep === stepCount) {
      return null;
    }

    const res = {
      price: startPrice - priceDecrement * currStep,
      lockTime: Math.floor((startTime + reductionTimeMs * currStep) / 1000),
    };
    currStep++;
    return res;
  };
}

linearReductionStrategy.strategyName = 'LINEAR';

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
      feeRate,
      feeAddr,
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
    assert(typeof feeRate === 'number' && feeRate >= 0 && feeRate <= 10000);
    if (feeRate > 0 && !feeAddr) {
      throw new Error('Must specify a fee address if feeRate > 0.');
    }

    if (typeof reductionStrategy === 'string') {
      let actualReductionStrategy;
      switch (reductionStrategy) {
        case linearReductionStrategy.strategyName:
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
    this.feeRate = feeRate;
    this.feeAddr = feeAddr ? coerceAddress(feeAddr) : null;
  }

  async createAuction(context, lockFinalize, paymentAddr = null) {
    paymentAddr =
      paymentAddr || (await context.wallet.createAddress('default')).address;

    const strategy = this.strategy();

    let info = strategy();
    const data = [];
    while (info) {
      const fee = Math.floor((this.feeRate / 10000) * info.price);
      const swapProof = new SwapProof({
        lockingTxHash: lockFinalize.finalizeTxHash,
        lockingOutputIdx: lockFinalize.finalizeOutputIdx,
        name: lockFinalize.name,
        publicKey: lockFinalize.publicKey,
        paymentAddr,
        price: info.price,
        lockTime: info.lockTime,
        feeAddr: this.feeAddr,
        fee,
      });
      await swapProof.sign(context, lockFinalize.privateKey);

      data.push({
        price: info.price,
        fee,
        lockTime: info.lockTime,
        signature: swapProof.signature,
      });
      info = strategy();
    }

    return new Auction({
      version: CURRENT_PROTOCOL_VERSION,
      name: lockFinalize.name,
      lockingTxHash: lockFinalize.finalizeTxHash,
      lockingOutputIdx: lockFinalize.finalizeOutputIdx,
      publicKey: lockFinalize.publicKey,
      paymentAddr,
      data,
      feeAddr: this.feeAddr,
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

  toJSON(context) {
    return {
      name: this.name,
      startTime: this.startTime,
      endTime: this.endTime,
      startPrice: this.startPrice,
      endPrice: this.endPrice,
      reductionTimeMS: this.reductionTimeMS,
      reductionStrategy: this.reductionStrategy.name,
      feeAddr: this.feeAddr ? this.feeAddr.toString(context.networkName) : null,
    };
  }
}

exports.AuctionFactory = AuctionFactory;

class Auction {
  constructor(options) {
    const {
      name,
      lockingTxHash,
      lockingOutputIdx,
      publicKey,
      paymentAddr,
      data,
      feeAddr,
    } = options;

    this.version = CURRENT_PROTOCOL_VERSION;
    this.name = name;
    this.lockingTxHash = coerceBuffer(lockingTxHash);
    this.lockingOutputIdx = lockingOutputIdx;
    this.publicKey = coerceBuffer(publicKey);
    this.paymentAddr = coerceAddress(paymentAddr);
    this.feeAddr = feeAddr ? coerceAddress(feeAddr) : null;

    this.data = [];
    for (const datum of data) {
      this.data.push({
        price: datum.price,
        lockTime: datum.lockTime,
        fee: datum.fee || 0,
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
      fee: datum.fee,
      feeAddr: this.feeAddr,
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
      version: this.version,
      name: this.name,
      lockingTxHash: this.lockingTxHash.toString('hex'),
      lockingOutputIdx: this.lockingOutputIdx,
      publicKey: this.publicKey.toString('hex'),
      paymentAddr: this.paymentAddr.toString(context.networkName),
      feeAddr: this.feeAddr ? this.feeAddr.toString(context.networkName) : null,
      data: this.data.map((d) => ({
        price: d.price,
        lockTime: d.lockTime,
        fee: d.fee,
        signature: d.signature.toString('hex'),
      })),
    };
  }

  async writeToStream(context, stream) {
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
    try {
      const proofJSON = JSON.parse(input);

      if (!proofJSON.version)
        throw new Error('Proof version missing.');

      if (typeof proofJSON.version !== 'number')
        throw new Error('Proof version must be a number.');

      if (proofJSON.version < MINIMUM_PROTOCOL_VERSION)
        throw new Error('Unsupported proof version.');

      return new Auction(proofJSON);
    } catch (e) {
      let message = e.message;
      if (e.name === 'SyntaxError')
        message = 'Proof file must be valid JSON.';

      throw new Error(`Invalid proof: ${message}`);
    }
  }
}

exports.Auction = Auction;
