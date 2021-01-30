const path = require('path');
const level = require('level');
const {SwapFinalize} = require('./swapFinalize.js');
const {SwapFulfillment} = require('./swapFulfillment.js');
const {Auction} = require('./auction.js');
const {NameLockFinalize} = require('./nameLock.js');
const {NameLockTransfer} = require('./nameLock.js');

exports.createDB = async function (prefix) {
  const dbPath = path.join(prefix, 'shakedex.db');
  return level(dbPath);
};

exports.putLockTransfer = async function (db, lockTransfer) {
  return db.batch([
    {type: 'put', key: `names/list/${lockTransfer.name}`, value: 1},
    {type: 'put', key: `names/locks/transfers/${lockTransfer.name}`, value: JSON.stringify(lockTransfer.toJSON())},
  ]);
};

exports.putLockFinalize = async function (db, lockFinalize) {
  return db.put(`names/locks/finalizes/${lockFinalize.name}`, JSON.stringify(lockFinalize.toJSON()));
};

exports.putAuction = async function (db, auction) {
  return db.put(`names/auctions/${auction.name}`, JSON.stringify(auction.toJSON()));
};

exports.putSwapFulfillment = async function (db, fulfillment) {
  return db.batch([
    {type: 'put', key: `names/list/${fulfillment.name}`, value: 1},
    {type: 'put', key: `names/swaps/fulfillments/${fulfillment.name}`, value: JSON.stringify(fulfillment.toJSON())},
  ]);
};

exports.putSwapFinalize = async function (db, finalize) {
  return db.put(`names/swaps/finalizes/${finalize.name}`, JSON.stringify(finalize.toJSON()));
};

exports.getNames = async function (db) {
  const names = await new Promise((resolve, reject) => {
    const keys = [];

    const stream = db.createKeyStream({
      gte: `names/list/\x00`,
      lte: `names/list/\xff`,
    });

    stream.on('data', (data) => keys.push(data))
      .on('error', reject)
      .on('end', () => resolve(keys.map(k => {
        const splits = k.split('/');
        return splits[splits.length - 1];
      })));
  });

  const out = [];
  for (const name of names) {
    out.push(await getName(db, name));
  }

  return out;
};

async function getName(db, name) {
  const listedName = await getOrNull(db, `names/list/${name}`);
  if (!listedName) {
    return null;
  }

  const nameObj = {
    name,
  };
  const transfer = await getOrNull(db, `names/locks/transfers/${name}`);
  if (transfer) {
    nameObj.transfer = new NameLockTransfer(JSON.parse(transfer));
  }
  const finalize = await getOrNull(db, `names/locks/finalizes/${name}`);
  if (finalize) {
    nameObj.finalize = new NameLockFinalize(JSON.parse(finalize));
  }
  const auction = await getOrNull(db, `names/auctions/${name}`);
  if (auction) {
    nameObj.auction = new Auction(JSON.parse(auction));
  }
  const swapFulfillment = await getOrNull(db, `names/swaps/fulfillments/${name}`);
  if (swapFulfillment) {
    nameObj.swapFulfillment = new SwapFulfillment(JSON.parse(swapFulfillment));
  }
  const swapFinalize = await getOrNull(db, `names/swaps/finalizes/${name}`);
  if (swapFinalize) {
    nameObj.swapFinalize = new SwapFinalize(JSON.parse(swapFinalize));
  }
  return nameObj;
}

exports.getName = getName;

async function getOrNull(db, key) {
  try {
    return await db.get(key);
  } catch (e) {
    if (e.notFound) {
      return null;
    }

    throw e;
  }
}