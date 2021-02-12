const {createLockScript} = require('./script.js');

const Address = require('hsd/lib/primitives/address.js');
const secp256k1 = require('bcrypto/lib/secp256k1.js');
const {SwapProof} = require('./swapProof.js');
const assertModule = require('assert');
const {SwapFinalize} = require('./swapFinalize.js');
const {SwapFulfillment} = require('./swapFulfillment.js');
const {NameLockTransfer, NameLockFinalize} = require('./nameLock.js');

const assert = assertModule.strict;

exports.transferNameLock = async function (
  context,
  name,
) {
  const privateKey = secp256k1.privateKeyGenerate();
  const publicKey = secp256k1.publicKeyCreate(privateKey);
  const lockScript = createLockScript(publicKey);
  const lockScriptAddr = new Address().fromScript(lockScript);
  const tx = await context.execWallet(
    'sendtransfer',
    name,
    lockScriptAddr.toString(context.networkName),
  );

  return new NameLockTransfer({
    name,
    transferTxHash: tx.hash,
    privateKey,
    broadcastAt: Date.now(),
  });
};

exports.finalizeNameLock = async function (
  context,
  transfer,
) {
  const tx = await context.execWallet(
    'sendfinalize',
    transfer.name,
  );
  return new NameLockFinalize({
    name: transfer.name,
    finalizeTxHash: tx.hash,
    finalizeOutputIdx: 0,
    privateKey: transfer.privateKey,
    broadcastAt: Date.now(),
  });
};

exports.proposeSwap = async function (
  context,
  lockFinalize,
  price,
  lockTime = 0,
  paymentAddr = null,
) {
  const {wallet} = context;
  paymentAddr = paymentAddr || (await wallet.createAddress('default')).address;
  const swapProof = new SwapProof({
    lockingTxHash: lockFinalize.finalizeTxHash,
    lockingOutputIdx: lockFinalize.finalizeOutputIdx,
    name: lockFinalize.name,
    publicKey: lockFinalize.publicKey,
    paymentAddr,
    price,
    lockTime,
  });
  await swapProof.sign(context, lockFinalize.privateKey);
  return swapProof;
};

exports.fulfillSwap = async function (
  context,
  swapProof,
) {
  assert(await swapProof.verify(context));

  const {wallet} = context;
  const nameRecipientAddr = (await wallet.createAddress('default')).address;
  const mtx = await swapProof.fulfill(
    context,
    nameRecipientAddr,
  );

  await context.execNode('sendrawtransaction', mtx.toHex());
  return new SwapFulfillment({
    name: swapProof.name,
    fulfillmentTxHash: mtx.toJSON().hash,
    lockingPublicKey: swapProof.publicKey,
    price: swapProof.price,
    broadcastAt: Date.now(),
  });
};

exports.finalizeSwap = async function (
  context,
  fulfillment,
) {
  const {nodeClient} = context;
  const mtx = await fulfillment.finalize(context);
  await nodeClient.execute('sendrawtransaction', [mtx.toHex()]);
  return new SwapFinalize({
    name: fulfillment.name,
    finalizeTxHash: mtx.toJSON().hash,
    broadcastAt: Date.now(),
  });
};