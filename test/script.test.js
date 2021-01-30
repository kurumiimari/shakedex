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
      const lockScript = createLockScript(Buffer.from(address.publicKey, 'hex'));
      assert.equal(
        lockScript.toString(),
        `OP_TYPE OP_7 OP_EQUAL OP_IF OP_RETURN OP_ENDIF OP_TYPE OP_11 OP_EQUAL OP_IF OP_RETURN OP_ENDIF OP_TYPE OP_8 OP_EQUAL OP_IF OP_RETURN OP_ENDIF OP_TYPE OP_9 OP_EQUAL OP_IF 0x21 0x${address.publicKey} OP_CHECKSIGVERIFY OP_ENDIF OP_1`,
      );
    });
  });
});