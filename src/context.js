const { NodeClient, WalletClient } = require('hs-client');
const Network = require('hsd/lib/protocol/network.js');
const passwordPrompt = require('password-prompt');

class Context {
  constructor(
    networkName,
    walletId,
    apiKey,
    passphraseGetter = noopPassphraseGetter,
    host = '127.0.0.1',
    nodeApiKey,
  ) {
    this.networkName = networkName;
    this.network = Network.get(networkName);
    this.walletId = walletId;
    this.nodeClient = new NodeClient({
      port: this.network.rpcPort,
      host,
      apiKey: nodeApiKey || apiKey,
    });
    this.walletClient = new WalletClient({
      port: this.network.walletPort,
      host,
      apiKey: apiKey,
    });
    this.wallet = this.walletClient.wallet(walletId);
    this.passphraseGetter = passphraseGetter;
  }

  getPassphrase = () => {
    return this.passphraseGetter();
  };

  execNode = (method, ...args) => {
    return this.nodeClient.execute(method, args);
  };

  execWallet = async (method, ...args) => {
    await this.walletClient.execute('selectwallet', [this.walletId]);
    return this.walletClient.execute(method, args);
  };

  unlockWallet = async () => {
    const pass = await this.getPassphrase();
    if (pass === null) {
      return;
    }
    await this.wallet.unlock(pass, 60);
  };
}

exports.Context = Context;

exports.staticPassphraseGetter = function (passphrase) {
  return () => new Promise((resolve) => resolve(passphrase));
};

function noopPassphraseGetter() {
  return new Promise((resolve) => resolve(null));
}

exports.promptPassphraseGetter = function (
  prefix = '>> Please enter your passphrase: '
) {
  return () => new Promise((resolve) => resolve(passwordPrompt(prefix)));
};
