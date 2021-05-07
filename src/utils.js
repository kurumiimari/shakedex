const Coin = require('hsd/lib/primitives/coin.js');
const Keyring = require('hsd/lib/primitives/keyring.js');
const Output = require('hsd/lib/primitives/output.js');
const rules = require('hsd/lib/covenants/rules.js');
const Address = require('hsd/lib/primitives/address.js');
const Witness = require('hsd/lib/script/witness.js');
const MTX = require('hsd/lib/primitives/mtx.js');
const { createLockScript } = require('./script.js');
const common = require('hsd/lib/script/common.js');
const assert = require('assert').strict;

const { ALL } = common.hashType;

exports.fundMtx = async function (context, mtx, additionalCoin = null) {
  const { wallet, network } = context;
  const info = await context.execNode('getblockchaininfo');
  const feeRes = await context.execNode('estimatesmartfee', 10);
  const rate = Math.max(Number(feeRes.fee), 5000);

  const coinsJSON = await wallet.getCoins('default');
  const coins = coinsJSON.map((c) => new Coin().fromJSON(c));
  if (additionalCoin) {
    coins.push(additionalCoin);
  }
  const changeAddress = (await wallet.createChange('default')).address;
  await mtx.fund(coins, {
    rate,
    changeAddress,
    height: info.blocks,
    coinbaseMaturity: network.coinbaseMaturity,
  });
  return mtx;
};

exports.createRings = async function (context, mtx, startIdx = 0) {
  const { wallet } = context;
  const passphrase = await context.getPassphrase();
  const rings = [];
  for (let i = startIdx; i < mtx.inputs.length; i++) {
    const input = mtx.inputs[i];
    const prevout = mtx.view.getEntry(input.prevout).output;
    const address = prevout.address.toString(context.networkName);
    const privKeyWIF = await wallet.getWIF(address, passphrase);
    rings.push(
      new Keyring().fromSecret(privKeyWIF.privateKey, context.networkName)
    );
  }
  return rings;
};

exports.getRenewalBlock = async function (context) {
  const { network, nodeClient } = context;
  const info = await context.execNode('getblockchaininfo');
  let height = info.blocks - network.names.renewalMaturity * 2;
  if (height < 0) {
    height = 0;
  }

  const block = await nodeClient.getBlock(height);
  return block.hash;
};

exports.stringEnum = (items) =>
  items.reduce((acc, curr) => {
    acc[curr] = curr;
    return acc;
  }, {});

exports.createFinalize = async function (
  context,
  name,
  transferCoin,
  publicKey
) {
  assert(transferCoin instanceof Coin);
  const ns = (await context.execNode('getnameinfo', name)).info;
  const version = transferCoin.covenant.getU8(2);
  const hash = transferCoin.covenant.get(3);

  let flags = 0;
  if (ns.weak) {
    flags |= 1;
  }

  const output = new Output({
    covenant: {
      type: rules.types.FINALIZE,
      items: [],
    },
    value: transferCoin.value,
    address: new Address({
      version,
      hash,
    }),
  });

  output.covenant.pushHash(rules.hashName(name));
  output.covenant.pushU32(ns.height);
  output.covenant.push(Buffer.from(name, 'ascii'));
  output.covenant.pushU8(flags);
  output.covenant.pushU32(ns.claimed);
  output.covenant.pushU32(ns.renewals);
  output.covenant.pushHash(
    Buffer.from(await exports.getRenewalBlock(context), 'hex')
  );
  const mtx = new MTX();
  mtx.addCoin(transferCoin);
  mtx.outputs.push(output);

  const lockScript = createLockScript(publicKey);
  const transferInputClone = mtx.inputs[0].clone();
  await exports.fundMtx(context, mtx, transferCoin);
  mtx.inputs[0].inject(transferInputClone);
  mtx.inputs[0].witness = new Witness([lockScript.encode()]);

  const rings = await exports.createRings(context, mtx, 1);
  const signed = mtx.sign(rings, ALL);
  assert(signed, 'Transaction failed to sign.');

  return mtx;
};
