const Coin = require('hsd/lib/primitives/coin.js');
const Keyring = require('hsd/lib/primitives/keyring.js');

exports.fundMtx = async function(
  context,
  mtx,
  additionalCoin = null,
) {
  const {wallet, network} = context;
  const info = await context.execNode('getblockchaininfo');
  const feeRes = await context.execNode('estimatesmartfee', 10);
  const rate = Math.max(Number(feeRes.fee), 5000);

  const coinsJSON = await wallet.getCoins('default');
  const coins = coinsJSON.map(c => new Coin().fromJSON(c));
  const unlockedCoins = coins.filter(c => info.blocks - c.height > network.coinbaseMaturity);
  if (additionalCoin) {
    unlockedCoins.push(additionalCoin);
  }
  const changeAddress = (await wallet.createChange('default')).address;
  await mtx.fund(unlockedCoins, {
    rate,
    changeAddress,
  });
  return mtx;
}

exports.createRings = async function(
  context,
  mtx,
  startIdx = 0,
) {
  const {wallet} = context;
  const passphrase = await context.getPassphrase();
  const rings = [];
  for (let i = startIdx; i < mtx.inputs.length; i++) {
    const input = mtx.inputs[i];
    const prevout = mtx.view.getEntry(input.prevout).output;
    const address = prevout.address.toString(context.networkName);
    const privKeyWIF = await wallet.getWIF(address, passphrase);
    rings.push(new Keyring().fromSecret(privKeyWIF.privateKey, context.networkName));
  }
  return rings;
}

exports.getRenewalBlock = async function(
  context,
) {
  const {network, nodeClient} = context;
  const info = await context.execNode('getblockchaininfo');
  let height = info.blocks - network.names.renewalMaturity * 2;
  if (height < 0) {
    height = 0;
  }

  const block = await nodeClient.getBlock(height);
  return block.hash;
}