const assertModule = require('assert');
const {coerceBuffer} = require('./conversions.js');
const Output = require('hsd/lib/primitives/output.js');
const rules = require('hsd/lib/covenants/rules.js');
const Address = require('hsd/lib/primitives/address.js');
const Coin = require('hsd/lib/primitives/coin.js');
const MTX = require('hsd/lib/primitives/mtx.js');
const Witness = require('hsd/lib/script/witness.js');
const {fundMtx, getRenewalBlock, createRings} = require('./utils.js');
const {createLockScript} = require('./script.js');
const common = require('hsd/lib/script/common.js');
const networks = require('hsd/lib/protocol/networks.js');

const assert = assertModule.strict;
const {ALL} = common.hashType;


class SwapFulfillment {
  constructor(options) {
    const {name, fulfillmentTxHash, lockingPublicKey, price, broadcastAt} = options;

    assert(name);
    assert(fulfillmentTxHash && typeof fulfillmentTxHash === 'string');
    assert(price);
    assert(broadcastAt);

    this.name = name;
    this.fulfillmentTxHash = fulfillmentTxHash;
    this.lockingPublicKey = coerceBuffer(lockingPublicKey);
    this.price = price;
    this.broadcastAt = broadcastAt;
  }

  async finalize(context) {
    const {nodeClient} = context;
    const nameState = await context.execNode('getnameinfo', this.name);
    const renewalBlock = await getRenewalBlock(context);

    const tx = await nodeClient.getTX(this.fulfillmentTxHash);
    const transferOutputIdx = tx.outputs.findIndex(o => o.covenant.type === rules.types.TRANSFER);
    assert(transferOutputIdx > -1, 'No transfer output found.');
    const transferOutputCoinJSON = await nodeClient.getCoin(tx.hash, transferOutputIdx);
    const transferOutputCoin = new Coin().fromJSON(transferOutputCoinJSON);

    let flags = 0;
    if (nameState.weak) {
      flags = flags |= 1;
    }

    const finalizeOutput = new Output({
      covenant: {
        type: rules.types.FINALIZE,
        items: [],
      },
      value: transferOutputCoin.value,
      address: new Address({
        version: transferOutputCoin.covenant.items[2][0],
        hash: transferOutputCoin.covenant.items[3],
      }),
    });
    finalizeOutput.covenant.pushHash(rules.hashName(this.name));
    finalizeOutput.covenant.pushU32(nameState.info.height);
    finalizeOutput.covenant.push(Buffer.from(this.name, 'ascii'));
    finalizeOutput.covenant.pushU8(flags);
    finalizeOutput.covenant.pushU32(nameState.info.claimed);
    finalizeOutput.covenant.pushU32(nameState.info.renewals);
    finalizeOutput.covenant.pushHash(Buffer.from(renewalBlock, 'hex'));

    const lockScript = createLockScript(this.lockingPublicKey);
    const mtx = new MTX();
    mtx.addCoin(transferOutputCoin);
    mtx.addOutput(finalizeOutput);
    mtx.inputs[0].witness = new Witness([
      lockScript.encode(),
    ]);

    const transferInputClone = mtx.inputs[0].clone();
    await fundMtx(
      context,
      mtx,
      transferOutputCoin,
    );
    mtx.inputs[0].inject(transferInputClone);

    const rings = await createRings(context, mtx, 1);
    const signed = mtx.sign(rings, ALL);
    if (!signed) {
      throw new Error('Transaction failed to sign.');
    }

    return mtx;
  }

  async getConfirmationDetails(context) {
    const info = await context.execNode('getblockchaininfo');
    const tx = await context.nodeClient.getTX(this.fulfillmentTxHash);
    const transferLockup = networks[context.networkName].names.transferLockup;
    const included = tx.height > -1;
    return {
      confirmedAt: included ? tx.mtime * 1000 : null,
      spendable: included ? info.blocks - tx.height > transferLockup : null,
      spendableIn: included ? Math.max(transferLockup - (info.blocks - tx.height), 0) : null
    };
  }

  toJSON() {
    return {
      name: this.name,
      fulfillmentTxHash: this.fulfillmentTxHash,
      lockingPublicKey: this.lockingPublicKey.toString('hex'),
      price: this.price,
      broadcastAt: this.broadcastAt,
    };
  }
}

exports.SwapFulfillment = SwapFulfillment;