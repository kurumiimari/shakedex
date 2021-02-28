const { createWallet, generateAddress } = require('./hsd.js');
const { createLockScript } = require('../src/script.js');
const chai = require('chai');
const { assert } = chai;

describe('script.js', () => {
  describe('createLockScript', () => {
    it('should create the correct lock script', async () => {
      const wid = `test-wallet-${Date.now()}`;
      await createWallet(wid, 'password');
      const address = await generateAddress(wid);
      const lockScript = createLockScript(
        Buffer.from(address.publicKey, 'hex')
      );
      assert.equal(
        lockScript.toString(),
        `OP_TYPE OP_9 OP_EQUAL OP_IF 0x21 0x${address.publicKey} OP_CHECKSIG OP_ELSE OP_TYPE OP_10 OP_EQUAL OP_ENDIF`
      );
    });
  });
});
