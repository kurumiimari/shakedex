const path = require('path');
const level = require('level');
const fs = require('fs');
const inquirer = require('inquirer');
const {log} = require('./cli/util.js');

class LevelBackend {
  constructor(path) {
    this.path = path;
  }

  async open() {
    this.db = level(this.path);
  }

  async get(key) {
    try {
      return await this.db.get(key);
    } catch (e) {
      if (e.notFound) {
        return null;
      }

      throw e;
    }
  }

  async getJSON(key) {
    const raw = await this.get(key);
    if (raw === null) {
      return raw;
    }
    return JSON.parse(raw);
  }

  async put(key, value) {
    return this.db.put(key, value);
  }

  async putJSON(key, value) {
    return this.put(key, JSON.stringify(value));
  }

  iterPrefix(prefix, cb) {
    return new Promise((resolve, reject) => {
      const stream = this.db.createReadStream({
        gte: `${prefix}\x00`,
        lte: `${prefix}\xff`,
      });

      stream
        .on('data', (data) => cb(data.key, data.value))
        .on('error', reject)
        .on('end', resolve);
    });
  }

  batch() {
    return new LevelBatch(this.db);
  }
}

exports.LevelBackend = LevelBackend;

class LevelBatch {
  constructor(db) {
    this.db = db;
    this.ops = [];
  }

  put(key, value) {
    this.ops.push({
      type: 'put',
      key,
      value,
    });
    return this;
  }

  putJSON(key, value) {
    return this.put(key, JSON.stringify(value));
  }

  async commit() {
    return this.db.batch(this.ops);
  }
}

exports.LevelBatch = LevelBatch;

class DataStore {
  constructor(backend) {
    this.backend = backend;
  }

  async getOutboundNameVersion(name) {
    return (await this.backend.get(`names/outbound/list/${name}`)) || 0;
  }

  async getInboundNameVersion(name) {
    return (await this.backend.get(`names/inbound/list/${name}`)) || 0;
  }

  async getOutboundNameState(name, version = -1) {
    if (version === -1) {
      version = await this.getOutboundNameVersion(name);
    }
    if (version === null) {
      return null;
    }

    return this.backend.get(`names/outbound/state/${name}/${version}`);
  }

  async getInboundNameState(name, version = -1) {
    if (version === -1) {
      version = await this.getInboundNameVersion(name);
    }
    if (version === null) {
      return null;
    }

    return this.backend.get(`names/inbound/state/${name}/${version}`);
  }

  async putLockTransfer(lockTransfer) {
    const currVersion = await this.getOutboundNameVersion(lockTransfer.name);
    const newVersion = currVersion + 1;
    return this.backend
      .batch()
      .put(`names/outbound/list/${lockTransfer.name}`, newVersion)
      .put(
        `names/outbound/state/${lockTransfer.name}/${newVersion}`,
        'TRANSFER',
      )
      .putJSON(
        `names/locks/transfers/${lockTransfer.name}/${newVersion}`,
        lockTransfer.toJSON(),
      )
      .commit();
  }

  async getLockTransfer(name, version = -1) {
    if (version === -1) {
      version = await this.getOutboundNameVersion(name);
    }
    if (version === null) {
      return null;
    }

    return this.backend.getJSON(`names/locks/transfers/${name}/${version}`);
  }

  async putLockFinalize(lockFinalize) {
    const version = await this.getOutboundNameVersion(lockFinalize.name);
    return this.backend
      .batch()
      .put(`names/outbound/state/${lockFinalize.name}/${version}`, 'FINALIZE')
      .putJSON(
        `names/locks/finalizes/${lockFinalize.name}/${version}`,
        lockFinalize.toJSON(),
      )
      .commit();
  }

  async getLockFinalize(name, version = -1) {
    if (version === -1) {
      version = await this.getOutboundNameVersion(name);
    }
    if (version === null) {
      return null;
    }

    return this.backend.getJSON(`names/locks/finalizes/${name}/${version}`);
  }

  async putLockCancelTransfer(context, lockCancelTransfer) {
    const version = await this.getOutboundNameVersion(lockCancelTransfer.name);
    return this.backend
      .batch()
      .put(
        `names/outbound/state/${lockCancelTransfer.name}/${version}`,
        'CANCEL_TRANSFER',
      )
      .putJSON(
        `names/locks/cancelTransfers/${lockCancelTransfer.name}/${version}`,
        lockCancelTransfer.toJSON(context),
      )
      .commit();
  }

  async getLockCancelTransfer(name, version = -1) {
    if (version === -1) {
      version = await this.getOutboundNameVersion(name);
    }
    if (version === null) {
      return null;
    }

    return this.backend.getJSON(
      `names/locks/cancelTransfers/${name}/${version}`,
    );
  }

  async putLockCancelFinalize(lockCancelFinalize) {
    const version = await this.getOutboundNameVersion(lockCancelFinalize.name);
    return this.backend
      .batch()
      .put(
        `names/outbound/state/${lockCancelFinalize.name}/${version}`,
        'CANCEL_FINALIZE',
      )
      .putJSON(
        `names/locks/cancelFinalizes/${lockCancelFinalize.name}/${version}`,
        lockCancelFinalize.toJSON(),
      )
      .commit();
  }

  async getLockCancelFinalize(name, version = -1) {
    if (version === -1) {
      version = await this.getOutboundNameVersion(name);
    }
    if (version === null) {
      return null;
    }

    return this.backend.getJSON(
      `names/locks/cancelFinalizes/${name}/${version}`,
    );
  }

  async getAuction(name, version = -1) {
    if (version === -1) {
      version = await this.getOutboundNameVersion(name);
    }
    if (version === null) {
      return null;
    }

    return this.backend.getJSON(`names/auctions/${name}/${version}`);
  }

  async putAuction(context, auction) {
    const version = await this.getOutboundNameVersion(auction.name);
    return this.backend
      .batch()
      .put(`names/outbound/state/${auction.name}/${version}`, 'AUCTION')
      .putJSON(
        `names/auctions/${auction.name}/${version}`,
        auction.toJSON(context),
      )
      .commit();
  }

  async getSwapFill(name, version = -1) {
    if (version === -1) {
      version = await this.getInboundNameVersion(name);
    }
    if (version === null) {
      return null;
    }

    return this.backend.getJSON(`names/swaps/fills/${name}/${version}`);
  }

  async putSwapFill(fill) {
    const currVersion = await this.getInboundNameVersion(fill.name);
    const newVersion = currVersion + 1;
    return this.backend
      .batch()
      .put(`names/inbound/list/${fill.name}`, newVersion)
      .put(`names/inbound/state/${fill.name}/${newVersion}`, 'FILL')
      .putJSON(`names/swaps/fills/${fill.name}/${newVersion}`, fill.toJSON())
      .commit();
  }

  async getSwapFinalize(name, version = -1) {
    if (version === -1) {
      version = await this.getInboundNameVersion(name);
    }
    if (version === null) {
      return null;
    }

    return this.backend.getJSON(`names/swaps/finalizes/${name}/${version}`);
  }

  async putSwapFinalize(finalize) {
    const version = await this.getInboundNameVersion(finalize.name);
    return this.backend
      .batch()
      .put(`names/inbound/state/${finalize.name}/${version}`, 'FINALIZE')
      .putJSON(
        `names/swaps/finalizes/${finalize.name}/${version}`,
        finalize.toJSON(),
      )
      .commit();
  }

  async iterateOutboundNames(cb) {
    return this.backend.iterPrefix('names/outbound/list', cb);
  }

  async iterateInboundNames(cb) {
    return this.backend.iterPrefix('names/inbound/list', cb);
  }
}

exports.DataStore = DataStore;

const migrations = [
  'initial',
  'network_setup',
];

exports.migrate = async function (prefix) {
  let currMigration = path.join(prefix, 'migration');
  if (!fs.existsSync(currMigration)) {
    currMigration = 'initial';
  }

  return exports.executeMigrations(prefix, currMigration);
};

exports.executeMigrations = async function (prefix, currMigration) {
  let nextMigration = currMigration;

  switch (currMigration) {
    case migrations[0]: {
      const dbPath = path.join(prefix, 'shakedex.db');
      if (!fs.existsSync(dbPath)) {
        nextMigration = migrations[1];
        break;
      }

      const selectedNetwork = await inquirer.prompt([
        {
          type: 'list',
          name: 'value',
          message: 'In order to support multiple networks, shakedex needs to migrate your name database. Which network did you previously use shakedex with?',
          choices: ['main', 'simnet', 'regtest', 'testnet'],
        },
      ]);

      log(`Running migration ${migrations[0]}`);
      await fs.promises.rename(dbPath, path.join(prefix, `shakedex.${selectedNetwork.value}.db`));
      nextMigration = migrations[1];
      break;
    }
    default:
      return;
  }

  await exports.storeMigration(prefix, nextMigration);
  return exports.executeMigrations(prefix, nextMigration);
};

exports.storeMigration = async function (prefix, currMigration) {
  const migrationFile = path.join(prefix, 'migration');
  await fs.promises.writeFile(migrationFile, currMigration);
};

exports.createLevelStore = async function (prefix, networkName) {
  const dbPath = path.join(prefix, `shakedex.${networkName}.db`);
  const levelBackend = new LevelBackend(dbPath);
  await levelBackend.open();
  return new DataStore(levelBackend);
};
