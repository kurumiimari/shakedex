const {LevelBackend} = require('./src/dataStore.js');
const {NameLockFinalize} = require('./src/nameLock.js');
const {DataStore} = require('./src/dataStore.js');

async function main() {
  const backend = new LevelBackend(`/Users/fernando.falci/.shakedex/shakedex.db`)
  await backend.open();
  const ds = new DataStore(backend);
  const transfer = await ds.getLockTransfer('236');

  const finalize = new NameLockFinalize({
    finalizeTxHash: 'b13f13fc399f87f0d855bc27d024126fd81a907880ea683b95c66effa05466c0',
    finalizeOutputIdx: 0,
    privateKey: transfer.privateKey,
    broadcastAt: Date.now(),
  });

  console.log(finalize.toJSON());

  // comment below in if everything looks kosher
  // await ds.putLockFinalize(finalize);
}

main().then(() => console.log('ok')).catch(console.error.bind(console));