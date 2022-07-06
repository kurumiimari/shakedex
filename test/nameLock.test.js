const { NameLockExternalTransfer } = require('../src/nameLock.js');
const { createAliceBob } = require('./hsd.js');
const { mine, grindName } = require('./hsd.js');
const secp256k1 = require('bcrypto/lib/secp256k1.js');
const { buyName } = require('./hsd.js');
const { assert } = require('chai');

describe('NameLockExternalTransfer', () => {
  let alice;
  let name;
  let extTransfer;

  beforeEach(async () => {
    alice = (await createAliceBob()).alice;
    name = await grindName();
    await buyName(alice, name);
    const privateKey = secp256k1.privateKeyGenerate();
    extTransfer = new NameLockExternalTransfer({
      name,
      privateKey,
      createdAt: Date.now(),
    });
  });

  describe('when the external transfer does not exist', () => {
    it('should return the correct confirmation status', async () => {
      const details = await extTransfer.getConfirmationDetails(alice);
      assert.deepStrictEqual(details, {
        status: 'WAITING',
      });
    });
  });

  describe('when the external transfer is finalized', () => {
    let finalizeTx;

    beforeEach(async () => {
      await alice.execWallet(
        'sendtransfer',
        name,
        extTransfer.lockScriptAddr.toString(alice.networkName)
      );
      await mine(10);
      finalizeTx = await alice.execWallet('sendfinalize', name);
      await mine(1);
    });

    it('should return the correct confirmation status', async () => {
      const details = await extTransfer.getConfirmationDetails(alice);
      assert.deepStrictEqual(details, {
        status: 'CONFIRMED',
        confirmedAt: finalizeTx.mtime,
        finalizeTxHash: finalizeTx.hash,
        finalizeOutputIdx: 0,
      });
    });
  });
});
