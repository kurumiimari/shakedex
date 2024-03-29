const Address = require('hsd/lib/primitives/address.js');
const assertModule = require('assert');
const { coerceBuffer } = require('./conversions.js');
const rules = require('hsd/lib/covenants/rules.js');
const { createLockScript } = require('./script.js');
const secp256k1 = require('bcrypto/lib/secp256k1.js');
const networks = require('hsd/lib/protocol/networks.js');
const { coerceAddress } = require('./conversions.js');

const assert = assertModule.strict;

class NameLockTransfer {
  constructor(options) {
    const {
      name,
      transferTxHash,
      transferOutputIdx,
      privateKey,
      broadcastAt,
    } = options;

    assert(rules.verifyName(name));
    assert(transferTxHash && typeof transferTxHash === 'string');

    this.name = name;
    this.transferTxHash = transferTxHash;
    this.transferOutputIdx = transferOutputIdx;
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
    const included = tx && tx.height > -1;
    return {
      confirmedAt: included ? tx.mtime : null,
      spendable: included ? info.blocks - tx.height > transferLockup : null,
      spendableIn: included
        ? Math.max(transferLockup - (info.blocks - tx.height), 0)
        : null,
    };
  }

  toJSON() {
    return {
      name: this.name,
      transferTxHash: this.transferTxHash,
      transferOutputIdx: this.transferOutputIdx,
      privateKey: this.privateKey.toString('hex'),
      publicKey: this.publicKey.toString('hex'),
      broadcastAt: this.broadcastAt,
      lockScriptAddr: this.lockScriptAddr,
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
    assert(
      finalizeTxHash && typeof finalizeTxHash === 'string',
      'Invalid finalize transaction hash.'
    );
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
    if (tx.height === -1) {
      return {
        confirmedAt: null,
      };
    }

    return {
      confirmedAt: tx.mtime,
    };
  }

  toJSON() {
    return {
      name: this.name,
      finalizeTxHash: this.finalizeTxHash,
      finalizeOutputIdx: this.finalizeOutputIdx,
      privateKey: this.privateKey.toString('hex'),
      publicKey: this.publicKey.toString('hex'),
      broadcastAt: this.broadcastAt,
    };
  }
}

exports.NameLockFinalize = NameLockFinalize;

class NameLockExternalTransfer {
  constructor(options) {
    const { name, privateKey, createdAt } = options;

    assert(rules.verifyName(name));
    this.name = name;
    this.privateKey = coerceBuffer(privateKey);
    this.createdAt = createdAt;
  }

  get lockScriptAddr() {
    const script = createLockScript(secp256k1.publicKeyCreate(this.privateKey));
    return new Address().fromScript(script);
  }

  get publicKey() {
    return secp256k1.publicKeyCreate(this.privateKey);
  }

  async getConfirmationDetails(context) {
    const lockAddrStr = this.lockScriptAddr.toString(context.networkName);
    const txs = await context.nodeClient.getTXByAddress(lockAddrStr);
    if (!txs.length) {
      return {
        status: 'WAITING',
      };
    }

    let foundTx = null;
    let foundTxIdx = -1;
    for (const tx of txs) {
      for (let i = 0; i < tx.outputs.length; i++) {
        const out = tx.outputs[i];
        if (out.address === lockAddrStr) {
          foundTx = tx;
          foundTxIdx = i;
          break;
        }
      }
    }

    if (!foundTx) {
      return {
        status: 'WAITING',
      };
    }

    return {
      confirmedAt: foundTx.mtime,
      finalizeTxHash: foundTx.hash,
      finalizeOutputIdx: foundTxIdx,
      status: 'CONFIRMED',
    };
  }

  toJSON() {
    return {
      name: this.name,
      privateKey: this.privateKey.toString('hex'),
      publicKey: this.publicKey.toString('hex'),
      lockScriptAddr: this.lockScriptAddr,
    };
  }
}

exports.NameLockExternalTransfer = NameLockExternalTransfer;

class NameLockCancelTransfer {
  constructor(options) {
    const {
      name,
      transferTxHash,
      transferOutputIdx,
      privateKey,
      cancelAddr,
      broadcastAt,
    } = options;

    assert(rules.verifyName(name));
    assert(transferOutputIdx >= 0);

    this.name = name;
    this.transferTxHash = coerceBuffer(transferTxHash);
    this.transferOutputIdx = transferOutputIdx;
    this.privateKey = coerceBuffer(privateKey);
    this.cancelAddr = coerceAddress(cancelAddr);
    this.broadcastAt = broadcastAt;
  }

  get publicKey() {
    return secp256k1.publicKeyCreate(this.privateKey);
  }

  async getConfirmationDetails(context) {
    const tx = await context.nodeClient.getTX(
      this.transferTxHash.toString('hex')
    );
    if (!tx || tx.height === -1) {
      return {
        confirmedAt: null,
        spendable: false,
        spendableIn: null,
      };
    }

    const info = await context.execNode('getblockchaininfo');
    const transferLockup = networks[context.networkName].names.transferLockup;
    return {
      confirmedAt: tx.mtime,
      spendable: info.blocks - tx.height > transferLockup,
      spendableIn: Math.max(transferLockup - (info.blocks - tx.height), 0),
    };
  }

  toJSON(context) {
    return {
      name: this.name,
      transferTxHash: this.transferTxHash.toString('hex'),
      transferOutputIdx: this.transferOutputIdx,
      privateKey: this.privateKey.toString('hex'),
      cancelAddr: this.cancelAddr.toString(context.network),
      broadcastAt: this.broadcastAt,
    };
  }
}

exports.NameLockCancelTransfer = NameLockCancelTransfer;

class NameLockCancelFinalize {
  constructor(options) {
    const { name, finalizeTxHash, finalizeOutputIdx, broadcastAt } = options;

    assert(rules.verifyName(name));
    assert(finalizeTxHash);
    assert(finalizeOutputIdx >= 0);

    this.name = name;
    this.finalizeTxHash = coerceBuffer(finalizeTxHash);
    this.finalizeOutputIdx = finalizeOutputIdx;
    this.broadcastAt = broadcastAt;
  }

  async getConfirmationDetails(context) {
    const tx = await context.nodeClient.getTX(
      this.finalizeTxHash.toString('hex')
    );
    if (!tx || tx.height === -1) {
      return {
        confirmedAt: null,
      };
    }

    return {
      confirmedAt: tx.mtime,
    };
  }

  toJSON() {
    return {
      name: this.name,
      finalizeTxHash: this.finalizeTxHash.toString('hex'),
      finalizeOutputIdx: this.finalizeOutputIdx,
      broadcastAt: this.broadcastAt,
    };
  }
}

exports.NameLockCancelFinalize = NameLockCancelFinalize;
