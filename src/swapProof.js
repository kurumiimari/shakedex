const assertModule = require('assert');
const {coerceBuffer, coerceAddress} = require('./conversions.js');
const Coin = require('hsd/lib/primitives/coin.js');
const MTX = require('hsd/lib/primitives/mtx.js');
const rules = require('hsd/lib/covenants/rules.js');
const Output = require('hsd/lib/primitives/output.js');
const Witness = require('hsd/lib/script/witness.js');
const {createLockScript} = require('./script.js');
const common = require('hsd/lib/script/common.js');
const {fundMtx, createRings} = require('./utils.js');
const readline = require('readline');
const fs = require('fs');

const assert = assertModule.strict;
const {SINGLEREVERSE, ANYONECANPAY, ALL} = common.hashType;

class SwapProof {
  constructor(options) {
    const {
      lockingTxHash,
      lockingOutputIdx,
      name,
      publicKey,
      paymentAddr,
      price,
      lockTime,
      signature,
    } = options;
    assert(typeof lockingOutputIdx === 'number' && lockingOutputIdx >= 0, 'Invalid funding output index.');
    assert(rules.verifyName(name));
    assert(typeof price === 'number' && price > 0, 'Invalid price.');
    assert(typeof lockTime === 'number' && lockTime >= 0, 'Invalid lock time.');

    this.lockingTxHash = coerceBuffer(lockingTxHash);
    this.lockingOutputIdx = lockingOutputIdx;
    this.name = name;
    this.paymentAddr = coerceAddress(paymentAddr);
    this.publicKey = coerceBuffer(publicKey);
    this.price = price;
    this.lockTime = lockTime;
    this.signature = signature ? coerceBuffer(signature) : null;
  }

  async toMTX(context) {
    const {nodeClient} = context;
    const lockScriptCoinJSON = await nodeClient.getCoin(
      this.lockingTxHash.toString('hex'),
      this.lockingOutputIdx,
    );
    const lockScriptCoin = new Coin().fromJSON(lockScriptCoinJSON);
    assert(lockScriptCoin.covenant.type === rules.types.FINALIZE);
    assert(lockScriptCoin.covenant.items[2].toString('ascii') === this.name);

    const mtx = new MTX();
    mtx.addCoin(lockScriptCoin);
    mtx.addOutput(new Output({
      covenant: {
        type: rules.types.TRANSFER,
        items: [],
      },
    }));
    mtx.addOutput(new Output({
      address: this.paymentAddr,
      value: this.price,
    }));

    mtx.locktime = this.lockTime;

    const lockScript = createLockScript(this.publicKey);
    if (this.signature) {
      const witness = new Witness([
        this.signature,
        lockScript.encode(),
      ]);
      witness.compile();
      mtx.inputs[0].witness = witness;
    }
    this._lockScriptCoin = lockScriptCoin;
    this._lockScript = lockScript;
    return mtx;
  }

  async verify(context) {
    const {nodeClient} = context;
    assert(this.signature, 'Swap proof is not signed.');

    const coin = await nodeClient.getCoin(
      this.lockingTxHash.toString('hex'),
      this.lockingOutputIdx,
    );
    if (!coin) {
      return false;
    }

    if (coin.covenant.type !== rules.types.FINALIZE) {
      return false;
    }
    if (Buffer.from(coin.covenant.items[2], 'hex').toString('ascii') !== this.name) {
      return false;
    }


    const mtx = await this.toMTX(context);

    try {
      mtx.checkInput(0, this._lockScriptCoin, ANYONECANPAY | SINGLEREVERSE);
    } catch (e) {
      console.error(e);
      return false;
    }

    return true;
  }

  async sign(context, privateKey) {
    privateKey = coerceBuffer(privateKey);
    const mtx = await this.toMTX(context);
    this.signature = mtx.signature(0, this._lockScript, this._lockScriptCoin.value, privateKey, ANYONECANPAY | SINGLEREVERSE);
    assert(await this.verify(context));
  }

  async fulfill(
    context,
    nameRecipientAddr,
  ) {
    nameRecipientAddr = coerceAddress(nameRecipientAddr);
    const nameState = await context.execNode('getnameinfo', this.name);
    const mtx = await this.toMTX(context);
    const transferOutput = mtx.outputs[0];
    transferOutput.address = this._lockScriptCoin.address;
    transferOutput.covenant.pushHash(rules.hashName(this.name));
    transferOutput.covenant.pushU32(nameState.info.height);
    transferOutput.covenant.pushU8(nameRecipientAddr.version);
    transferOutput.covenant.push(nameRecipientAddr.hash);

    const lockScriptInputClone = mtx.inputs[0].clone();
    await fundMtx(
      context,
      mtx,
      this._lockScriptCoin,
    );
    mtx.inputs[0].inject(lockScriptInputClone);
    const outputs = mtx.outputs;
    if (outputs.length === 3) {
      mtx.outputs = [outputs[0], outputs[2], outputs[1]];
    }

    // sanity check
    mtx.checkInput(0, this._lockScriptCoin, ANYONECANPAY | SINGLEREVERSE);

    const rings = await createRings(context, mtx, 1);
    const signed = mtx.sign(rings, ALL);
    if (!signed) {
      throw new Error('Transaction failed to sign.');
    }

    return mtx;
  }

  toJSON(context) {
    return {
      name: this.name,
      lockingTxHash: this.lockingTxHash.toString('hex'),
      lockingOutputIdx: this.lockingOutputIdx,
      publicKey: this.publicKey.toString('hex'),
      paymentAddr: this.paymentAddr.toString(context.networkName),
      price: this.price,
      lockTime: this.lockTime,
      signature: this.signature ? this.signature.toString('hex') : null,
    };
  }
}

exports.SwapProof = SwapProof;

const VALID_PROOF_MAGIC = 'SHAKEDEX_PROOF';

async function writeProofStream(stream, proofs, context) {
  const first = proofs[0].toJSON(context);
  const outProof = {
    name: first.name,
    lockingTxHash: first.lockingTxHash,
    lockingOutputIdx: first.lockingOutputIdx,
    publicKey: first.publicKey,
    paymentAddr: first.paymentAddr,
    data: [{
      price: first.price,
      lockTime: first.lockTime,
      signature: first.signature,
    }],
  };
  for (let i = 1; i < proofs.length; i++) {
    const proof = proofs[i].toJSON(context);
    outProof.data.push({
      price: proof.price,
      lockTime: proof.lockTime,
      signature: proof.signature,
    });
  }
  await new Promise((resolve, reject) => stream.write(`${VALID_PROOF_MAGIC}:1.0.0\n`, (err) => {
    if (err) {
      return reject(err);
    }
    resolve();
  }));
  await new Promise((resolve, reject) => stream.write(JSON.stringify(outProof), (err) => {
    if (err) {
      return reject(err);
    }
    resolve();
  }));
}

exports.writeProofStream = writeProofStream;

async function writeProofFile(outPath, proofs, context) {
  const stream = fs.createWriteStream(outPath);
  await writeProofStream(stream, proofs, context);
  await new Promise((resolve, reject) => stream.close((err) => {
    if (err) {
      return reject(err);
    }
    resolve();
  }));
}

exports.writeProofFile = writeProofFile;

async function readProofFile(proofFile) {
  const input = fs.createReadStream(proofFile);
  const rl = readline.createInterface({
    input,
  });
  const proofLines = [];
  for await (const line of rl) {
    proofLines.push(line);
  }
  await rl.close();

  const firstLine = proofLines[0].trim();
  if (!firstLine.startsWith(VALID_PROOF_MAGIC)) {
    return readProofFile_Unversioned(rl);
  }

  const proofJSON = JSON.parse(proofLines.slice(1).join('\n'));
  const splits = firstLine.split(':');
  switch (splits[1]) {
    case '1.0.0':
      return readProofFile1_0_0(proofJSON);
    default:
      throw new Error('Invalid proof file version.');
  }
}

exports.readProofFile = readProofFile;

async function readProofFile_Unversioned(rl) {
  let lastName = null;
  const proofs = [];
  for await (const line of rl) {
    const data = JSON.parse(line.trim());
    if (!lastName) {
      lastName = data.name;
    }
    if (data.name !== lastName) {
      throw new Error('Proof file cannot contain multiple names.');
    }
    proofs.push(new SwapProof(data));
  }
  return proofs;
}

async function readProofFile1_0_0(proofJSON) {
  const {name, lockingTxHash, lockingOutputIdx, publicKey, paymentAddr} = proofJSON;
  const proofs = [];
  for (const datum of proofJSON.data) {
    proofs.push(new SwapProof({
      name,
      lockingTxHash,
      lockingOutputIdx,
      publicKey,
      paymentAddr,
      price: datum.price,
      lockTime: datum.lockTime,
      signature: datum.signature,
    }));
  }
  return proofs;
}