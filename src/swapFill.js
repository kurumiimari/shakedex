const assertModule = require('assert');
const { coerceBuffer } = require('./conversions.js');
const networks = require('hsd/lib/protocol/networks.js');

const assert = assertModule.strict;

class SwapFill {
  constructor(options) {
    const {
      name,
      fulfillmentTxHash,
      lockingPublicKey,
      price,
      fee,
      broadcastAt,
    } = options;

    assert(name);
    assert(fulfillmentTxHash && typeof fulfillmentTxHash === 'string');
    assert(price);
    assert(broadcastAt);
    if (fee) {
      assert(typeof fee === 'number');
    }

    this.name = name;
    this.fulfillmentTxHash = fulfillmentTxHash;
    this.lockingPublicKey = coerceBuffer(lockingPublicKey);
    this.price = price;
    this.broadcastAt = broadcastAt;
    this.fee = fee || 0;
  }

  async getConfirmationDetails(context) {
    const info = await context.execNode('getblockchaininfo');
    const tx = await context.nodeClient.getTX(this.fulfillmentTxHash);
    const transferLockup = networks[context.networkName].names.transferLockup;
    const included = tx && tx.height > -1;
    return {
      confirmedAt: included ? tx.mtime: null,
      spendable: included ? info.blocks - tx.height > transferLockup : null,
      spendableIn: included
        ? Math.max(transferLockup - (info.blocks - tx.height), 0)
        : null,
    };
  }

  toJSON() {
    return {
      name: this.name,
      fulfillmentTxHash: this.fulfillmentTxHash,
      lockingPublicKey: this.lockingPublicKey.toString('hex'),
      price: this.price,
      fee: this.fee,
      broadcastAt: this.broadcastAt,
    };
  }
}

exports.SwapFill = SwapFill;
