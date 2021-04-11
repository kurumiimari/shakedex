const { createLockScript } = require('./script.js');

const secp256k1 = require('bcrypto/lib/secp256k1.js');
const { SwapProof } = require('./swapProof.js');
const assertModule = require('assert');
const { SwapFinalize } = require('./swapFinalize.js');
const { SwapFill } = require('./swapFill.js');
const { NameLockTransfer, NameLockFinalize } = require('./nameLock.js');
const rules = require('hsd/lib/covenants/rules.js');
const Address = require('hsd/lib/primitives/address.js');
const Coin = require('hsd/lib/primitives/coin.js');
const Witness = require('hsd/lib/script/witness.js');
const Output = require('hsd/lib/primitives/output.js');
const { coerceAddress } = require('./conversions.js');
const MTX = require('hsd/lib/primitives/mtx.js');
const { createRings } = require('./utils.js');
const { fundMtx } = require('./utils.js');
const common = require('hsd/lib/script/common.js');
const { coerceCoin } = require('./conversions.js');
const { NameLockCancelFinalize } = require('./nameLock.js');
const { createFinalize } = require('./utils.js');
const { NameLockCancelTransfer } = require('./nameLock.js');
const fetch = require('node-fetch');
const { NameLockExternalTransfer } = require('./nameLock.js');

const assert = assertModule.strict;
const { ALL, ANYONECANPAY, SINGLE } = common.hashType;

exports.createNameLockExternal = async function (context, name) {
  const privateKey = secp256k1.privateKeyGenerate();
  return new NameLockExternalTransfer({
    name,
    privateKey,
    createdAt: Date.now(),
  });
};

exports.transferNameLock = async function (context, name) {
  const privateKey = secp256k1.privateKeyGenerate();
  const publicKey = secp256k1.publicKeyCreate(privateKey);
  const lockScript = createLockScript(publicKey);
  const lockScriptAddr = new Address().fromScript(lockScript);
  await context.unlockWallet();
  const tx = await context.execWallet(
    'sendtransfer',
    name,
    lockScriptAddr.toString(context.networkName)
  );

  return new NameLockTransfer({
    name,
    transferTxHash: tx.hash,
    privateKey,
    broadcastAt: Date.now(),
  });
};

exports.finalizeNameLock = async function (context, transfer) {
  await context.unlockWallet();
  const tx = await context.execWallet('sendfinalize', transfer.name);
  return new NameLockFinalize({
    name: transfer.name,
    finalizeTxHash: tx.hash,
    finalizeOutputIdx: 0,
    privateKey: transfer.privateKey,
    broadcastAt: Date.now(),
  });
};

exports.transferNameLockCancel = async function (
  context,
  lockFinalize,
  cancelAddr
) {
  const { wallet, nodeClient } = context;
  await context.unlockWallet();
  cancelAddr = cancelAddr || (await wallet.createAddress('default')).address;
  cancelAddr = coerceAddress(cancelAddr);
  const lockScript = createLockScript(lockFinalize.publicKey);
  const lockScriptAddr = new Address().fromScript(lockScript);

  const nameState = await context.execNode('getnameinfo', lockFinalize.name);
  const lockFinalizeCoinJSON = await nodeClient.getCoin(
    lockFinalize.finalizeTxHash,
    lockFinalize.finalizeOutputIdx
  );
  const lockFinalizeCoin = new Coin().fromJSON(lockFinalizeCoinJSON);
  const transferOutput = new Output({
    covenant: {
      type: rules.types.TRANSFER,
      items: [],
    },
    value: lockFinalizeCoin.value,
    address: lockScriptAddr,
  });
  transferOutput.covenant.pushHash(rules.hashName(lockFinalize.name));
  transferOutput.covenant.pushU32(nameState.info.height);
  transferOutput.covenant.pushU8(cancelAddr.version);
  transferOutput.covenant.push(cancelAddr.hash);

  const mtx = new MTX();
  mtx.addCoin(lockFinalizeCoin);
  mtx.addOutput(transferOutput);

  const transferInputClone = mtx.inputs[0].clone();
  await fundMtx(context, mtx, lockFinalizeCoin);
  mtx.inputs[0].inject(transferInputClone);

  const signature = await mtx.signature(
    0,
    lockScript,
    lockFinalizeCoin.value,
    lockFinalize.privateKey,
    ANYONECANPAY | SINGLE
  );
  const witness = new Witness([signature, lockScript.encode()]);
  witness.compile();
  mtx.inputs[0].witness = witness;
  mtx.checkInput(0, lockFinalizeCoin, ANYONECANPAY | SINGLE);

  const rings = await createRings(context, mtx, 1);
  const signed = mtx.sign(rings, ALL);
  if (!signed) {
    throw new Error('Transaction failed to sign.');
  }

  await context.execNode('sendrawtransaction', mtx.toHex());

  return new NameLockCancelTransfer({
    name: lockFinalize.name,
    transferTxHash: mtx.toJSON().hash,
    transferOutputIdx: 0,
    privateKey: lockFinalize.privateKey,
    cancelAddr,
    broadcastAt: Date.now(),
  });
};

exports.finalizeNameLockCancel = async function (context, lockCancelTransfer) {
  const { nodeClient } = context;
  await context.unlockWallet();
  const transferCoinJSON = await nodeClient.getCoin(
    lockCancelTransfer.transferTxHash.toString('hex'),
    lockCancelTransfer.transferOutputIdx
  );
  assert(transferCoinJSON, 'Transfer not found.');
  assert(transferCoinJSON.height > -1, 'Transfer not confirmed.');
  const transferCoin = coerceCoin(transferCoinJSON);

  const mtx = await createFinalize(
    context,
    lockCancelTransfer.name,
    transferCoin,
    lockCancelTransfer.publicKey
  );
  await context.execNode('sendrawtransaction', mtx.toHex());

  return new NameLockCancelFinalize({
    name: lockCancelTransfer.name,
    finalizeTxHash: mtx.toJSON().hash,
    finalizeOutputIdx: 0,
    broadcastAt: Date.now(),
  });
};

exports.proposeSwap = async function (
  context,
  lockFinalize,
  price,
  lockTime = 0,
  paymentAddr = null,
  fee = 0,
  feeAddr = null
) {
  const { wallet } = context;
  paymentAddr = paymentAddr || (await wallet.createAddress('default')).address;
  const swapProof = new SwapProof({
    lockingTxHash: lockFinalize.finalizeTxHash,
    lockingOutputIdx: lockFinalize.finalizeOutputIdx,
    name: lockFinalize.name,
    publicKey: lockFinalize.publicKey,
    paymentAddr,
    price,
    lockTime,
    fee,
    feeAddr,
  });
  await swapProof.sign(context, lockFinalize.privateKey);
  return swapProof;
};

exports.fillSwap = async function (context, swapProof) {
  assert(await swapProof.verify(context));

  const { wallet } = context;
  const nameRecipientAddr = (await wallet.createAddress('default')).address;
  const mtx = await swapProof.fill(context, nameRecipientAddr);

  await context.execNode('sendrawtransaction', mtx.toHex());
  return new SwapFill({
    name: swapProof.name,
    fulfillmentTxHash: mtx.toJSON().hash,
    lockingPublicKey: swapProof.publicKey,
    price: swapProof.price,
    fee: swapProof.fee,
    broadcastAt: Date.now(),
  });
};

exports.finalizeSwap = async function (context, fulfillment) {
  const { nodeClient } = context;
  await context.unlockWallet();
  const tx = await nodeClient.getTX(fulfillment.fulfillmentTxHash);
  assert(tx, 'Transaction not found.');
  assert(tx.height > -1, 'Transaction is not confirmed.');
  const transferOutputIdx = tx.outputs.findIndex(
    (o) => o.covenant.type === rules.types.TRANSFER
  );
  assert(transferOutputIdx > -1, 'No transfer output found.');
  const transferCoinJSON = await nodeClient.getCoin(tx.hash, transferOutputIdx);
  assert(transferCoinJSON, 'Transfer coin not found.');
  const transferCoin = coerceCoin(transferCoinJSON);

  const mtx = await createFinalize(
    context,
    fulfillment.name,
    transferCoin,
    fulfillment.lockingPublicKey
  );
  await context.execNode('sendrawtransaction', mtx.toHex());

  return new SwapFinalize({
    name: fulfillment.name,
    finalizeTxHash: mtx.toJSON().hash,
    broadcastAt: Date.now(),
  });
};

exports.getPostFeeInfo = async function (
  context,
  shakedexWebHost = 'https://api.shakedex.com'
) {
  const res = await fetch(`${shakedexWebHost}/api/v1/fee_info`);
  if (res.status === 404) {
    return {
      rate: 0,
      addr: null,
    };
  }
  if (!res.ok) {
    throw new Error('Error getting ShakeDex Web fee rate.');
  }

  return res.json();
};

exports.postAuction = async function (
  context,
  auction,
  shakedexWebHost = 'https://api.shakedex.com'
) {
  const res = await fetch(`${shakedexWebHost}/api/v1/auctions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      auction: auction.toJSON(context),
    }),
  });
  if (!res.ok) {
    throw new Error(`Error uploading presigns to ShakeDex web: ${res.status}`);
  }

  return res.json();
};
