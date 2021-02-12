const {writeProofFile} = require('../src/swapProof.js');
const {proposeSwap} = require('../src/swapService.js');
const {setupSwap} = require('./hsd.js');
const {assert} = require('chai');
const fs = require('fs');

describe('writeProofFile', () => {
  let alice;
  let name;
  let proposedSwap1;
  let proposedSwap2;

  beforeEach(async () => {
    const setupRes = await setupSwap();
    alice = setupRes.alice;
    name = setupRes.name;
    const finalizeLock = setupRes.finalizeLock;
    proposedSwap1 = await proposeSwap(
      alice,
      finalizeLock,
      1000,
      50,
    );
    proposedSwap2 = await proposeSwap(
      alice,
      finalizeLock,
      100,
      100,
    );
  });

  it('should write a valid proof file', async () => {
    const proofPath = `/tmp/proof-${Date.now()}`;
    await writeProofFile(proofPath, [
      proposedSwap1,
      proposedSwap2,
    ], alice);

    const data = (await fs.promises.readFile(proofPath)).toString('utf-8');
    const lines = data.split('\n');
    assert.equal(lines[0], 'SHAKEDEX_PROOF:1.0.0');
    const jsonProof = JSON.parse(lines.slice(1).join('\n'));
    const swap1JSON = proposedSwap1.toJSON(alice);
    const swap2JSON = proposedSwap2.toJSON(alice);
    assert.deepStrictEqual(jsonProof, {
      name,
      lockingTxHash: swap1JSON.lockingTxHash,
      lockingOutputIdx: swap1JSON.lockingOutputIdx,
      publicKey: swap1JSON.publicKey,
      paymentAddr: swap1JSON.paymentAddr,
      data: [
        {
          price: swap1JSON.price,
          lockTime: swap1JSON.lockTime,
          signature: swap1JSON.signature,
        },
        {
          price: swap2JSON.price,
          lockTime: swap2JSON.lockTime,
          signature: swap2JSON.signature,
        },
      ],
    });
  });
});