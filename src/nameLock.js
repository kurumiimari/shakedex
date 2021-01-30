const Address = require('hsd/lib/primitives/address.js');
const assertModule = require('assert');
const {coerceBuffer} = require('./conversions.js');
const rules = require('hsd/lib/covenants/rules.js');
const {createLockScript} = require('./script.js');
const secp256k1 = require('bcrypto/lib/secp256k1.js');
const networks = require('hsd/lib/protocol/networks.js');

const assert = assertModule.strict;

class NameLockTransfer {
  constructor(options) {
    const {
      name,
      transferTxHash,
      privateKey,
      broadcastAt,
    } = options;

    assert(rules.verifyName(name));
    assert(transferTxHash && typeof transferTxHash === 'string');

    this.name = name;
    this.transferTxHash = transferTxHash;
    this.privateKey = coerceBuffer(privateKey);
    this.broadcastAt = broadcastAt;
  }

  get lockScriptAddr() {
    const script = createLockScript(secp256k1.publicKeyCreate(this.privateKey));
    return new Address().fromScript(script);
  }

  get publicKey() {
    return secp256k1.publicKeyCreate(this.privateKey);
  }

  async getConfirmationDetails(context) {
    const info = await context.execNode('getblockchaininfo');
    const tx = await context.nodeClient.getTX(this.transferTxHash);
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
      transferTxHash: this.transferTxHash,
      privateKey: this.privateKey.toString('hex'),
      broadcastAt: this.broadcastAt,
    };
  }
}

exports.NameLockTransfer = NameLockTransfer;

class NameLockFinalize {
  constructor(options) {
    const {
      name,
      finalizeTxHash,
      finalizeOutputIdx,
      privateKey,
      broadcastAt,
    } = options;

    assert(rules.verifyName(name));
    assert(finalizeTxHash && typeof finalizeTxHash === 'string', 'Invalid finalize transaction hash.');
    assert(finalizeOutputIdx >= 0, 'Invalid finalize output index.');

    this.name = name;
    this.finalizeTxHash = finalizeTxHash;
    this.finalizeOutputIdx = finalizeOutputIdx;
    this.privateKey = coerceBuffer(privateKey);
    this.broadcastAt = broadcastAt;
  }

  get publicKey() {
    return secp256k1.publicKeyCreate(this.privateKey);
  }

  async getConfirmationDetails(context) {
    const tx = await context.nodeClient.getTX(this.finalizeTxHash);
    const included = tx.height > -1;
    return {
      confirmedAt: included ? tx.mtime * 1000 : null,
    };
  }

  toJSON() {
    return {
      name: this.name,
      finalizeTxHash: this.finalizeTxHash,
      finalizeOutputIdx: this.finalizeOutputIdx,
      privateKey: this.privateKey.toString('hex'),
      broadcastAt: this.broadcastAt,
    };
  }
}

exports.NameLockFinalize = NameLockFinalize;