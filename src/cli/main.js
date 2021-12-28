const {program} = require('commander');
const pkg = require('../../package.json');
const {transferNameLock} = require('../swapService.js');
const {Context, promptPassphraseGetter} = require('../context.js');
const Table = require('cli-table3');
const {finalizeNameLock} = require('../swapService.js');
const inquirer = require('inquirer');
const fs = require('fs');
const {log, die} = require('./util.js');
const {postAuction} = require('../swapService.js');
const {staticPassphraseGetter} = require('../context.js');
const {SwapFinalize} = require('../swapFinalize.js');
const {SwapFill} = require('../swapFill.js');
const {NameLockCancelFinalize} = require('../nameLock.js');
const {finalizeNameLockCancel} = require('../swapService.js');
const {NameLockCancelTransfer} = require('../nameLock.js');
const {transferNameLockCancel} = require('../swapService.js');
const {linearReductionStrategy} = require('../auction.js');
const {AuctionFactory, Auction} = require('../auction.js');
const {NameLockTransfer, NameLockFinalize} = require('../nameLock.js');
const {createLevelStore, migrate} = require('../dataStore.js');
const {finalizeSwap} = require('../swapService.js');
const {fillSwap} = require('../swapService.js');
const {format} = require('date-fns');
const Network = require('hsd/lib/protocol/network.js');
const {NameLockExternalTransfer} = require('../nameLock.js');
const {createNameLockExternal} = require('../swapService.js');
const {getPostFeeInfo} = require('../swapService.js');
const {backupDb} = require('../backup.js');

const DEFAULT_FEE_INFO = {
  rate: 0,
  addr: null,
};

program
  .version(pkg.version)
  .option(
    '-p, --prefix <prefix>',
    'Prefix directory to write the database to.',
    `${process.env.HOME}/.shakedex`,
  )
  .option(
    '-n, --network <network>',
    'Handshake network to connect to.',
    'regtest',
  )
  .option('-w, --wallet-id <walletId>', 'Handshake wallet ID.', 'primary')
  .option('-a, --api-key <apiKey>', 'Handshake wallet API key.')
  .option(
    '--shakedex-web-host <shakedexWebHost>',
    'Shakedex web hostname.',
    'https://api.shakedex.com',
  )
  .option('--no-passphrase', 'Disable prompts for the wallet passphrase.');

program
  .command('create-external-lock <name>')
  .description(
    'Creates an address to directly finalize a name transfer to.',
  )
  .action(createExternalLock);

program
  .command('external-lock-details <name>')
  .description(
    'Prints details about an external lock.',
  )
  .action(viewExternalLock);


program
  .command('transfer-lock <name>')
  .description(
    'Posts a name lock transaction, which when finalized allows the name to be auctioned.',
  )
  .action(transferLock);

program
  .command('finalize-lock <name>')
  .description(
    'Finalizes a name lock transaction, which allows the name to be auctioned.',
  )
  .action(finalizeLock);

program
  .command('transfer-lock-cancel <name>')
  .description(
    'Begins cancelling a name lock by transferring it back to the sender.',
  )
  .action(transferLockCancel);

program
  .command('finalize-lock-cancel <name>')
  .description('Cancels a name lock by finalizing it back to the sender.')
  .action(finalizeLockCancel);

program
  .command('create-auction <name>')
  .description('Creates auction presigns.')
  .action(createAuction);

program
  .command('publish-auction <auctionFile>')
  .description('Uploads an auction file to Shakedex Web.')
  .action(publishAuction);

program
  .command('list-auctions')
  .description('Prints all of your auctions and their statuses.')
  .action(listAuctions);

program
  .command('auction-details <name>')
  .description('Prints details of a specific name auction.')
  .action(auctionDetails);

program
  .command('fill-auction <auctionPath>')
  .description('Fills an auction.')
  .action(fillAuction);

program
  .command('finalize-auction <name>')
  .description('Finalizes an auction that has been previously fulfilled.')
  .action(finalizeAuction);

program
  .command('list-fills')
  .description('Prints all of your fills and their statuses.')
  .action(listFills);

program
  .command('backup <outFile>')
  .description('Backs up the shakedex internal DB.')
  .action(backup);

program.parse(process.argv);

function setupPrefix(prefix) {
  if (fs.existsSync(prefix)) {
    return;
  }
  fs.mkdirSync(prefix);
}

function getContext(opts) {
  return new Context(
    opts.network,
    opts.walletId,
    opts.apiKey,
    opts.passphrase ? promptPassphraseGetter() : staticPassphraseGetter(null),
  );
}

async function setupCLI() {
  const opts = program.opts();

  let out = {};
  try {
    setupPrefix(opts.prefix);
  } catch (e) {
    console.error('An error occurred. Stack trace:');
    console.error(e);
    console.error();
    console.error(
      `Please report this as an issue by visiting ${pkg.bugs.url}/new.`,
    );
    throw e;
  }

  try {
    Network.get(opts.network);
  } catch (e) {
    die(`Invalid network ${opts.network}.`);
    return;
  }

  out.context = getContext(opts);

  await migrate(opts.prefix);

  out.db = await createLevelStore(opts.prefix, opts.network);
  out.opts = opts;
  return out;
}

async function confirm(message, shouldDie = true) {
  const answers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message,
    },
  ]);

  if (shouldDie && !answers.confirmed) {
    die('Cancelled.');
  }

  return answers.confirmed;
}

async function createExternalLock(name) {
  const {db, context} = await setupCLI();

  await confirm(
    `This command will create an address for a third party to transfer your name to.`,
  );

  log('Creating external locking addr.');
  const lock = await createNameLockExternal(context, name);
  await db.putLockExternalTransfer(lock);
  log('Locking address successfully created. Give the following address to whoever holds your name:');
  log(lock.lockScriptAddr.toString(context.networkName));
}

async function viewExternalLock(name) {
  const {db, context} = await setupCLI();

  const extLockJSON = await db.getLockExternalTransfer(name);
  if (!extLockJSON) {
    throw new Error(
      `Lock info for ${name} was not found.`,
    );
  }
  const extTransfer = new NameLockExternalTransfer(extLockJSON);
  const confirmation = await extTransfer.getConfirmationDetails(context);

  const table = new Table();
  table.push(
    {
      Name: extTransfer.name,
    },
    {
      'Locking Address': extTransfer.lockScriptAddr.toString(context.networkName),
    },
    {
      'Confirmed At': confirmation.confirmedAt
        ? format(new Date(confirmation.confirmedAt), 'MM/dd/yyyy HH:MM:SS')
        : '-',
    },
    {
      'Finalize TX Hash': confirmation.confirmedAt ? confirmation.finalizeTxHash : '-',
    },
    {
      'Finalize Output Idx': confirmation.confirmedAt ? confirmation.finalizeOutputIdx : '-',
    },
  );
  process.stdout.write(table.toString());
  process.stdout.write('\n');
}

async function transferLock(name) {
  const {db, context} = await setupCLI();

  await confirm(
    `Your name ${name} will be transferred to a locking script. ` +
    'This can be undone, but requires additional on-chain transactions. Do you wish to continue?',
  );

  log('Performing locking script transfer.');
  const lockTransfer = await transferNameLock(context, name);
  await db.putLockTransfer(lockTransfer);
  log(
    `Name transferred to locking script with transaction hash ${lockTransfer.transferTxHash.toString(
      'hex',
    )}.`,
  );
  log('Please wait at least 15 minutes for your transaction to be confirmed.');
}

async function finalizeLock(name) {
  const {db, context} = await setupCLI();

  await confirm(
    `Your transfer of ${name} to the locking script will be finalized. ` +
    'This can be undone, but requires additional on-chain transactions. Do you wish to continue?',
  );

  const nameState = await db.getOutboundNameState(name);
  if (nameState === null) {
    die(`Name ${name} not found.`);
  }
  if (nameState !== 'TRANSFER') {
    die(`Name ${name} is not in the TRANSFER state.`);
  }

  const transferJSON = await db.getLockTransfer(name);
  if (!transferJSON) {
    throw new Error(
      `Name transfer for ${name} was not found. This implies database corruption; please file an issue.`,
    );
  }
  const transfer = new NameLockTransfer(transferJSON);
  const confirmed = await transfer.getConfirmationDetails(context);
  if (!confirmed.confirmedAt) {
    die(
      `The transaction transferring ${name} to the locking script is unconfirmed. Please try again later.`,
    );
  }
  if (!confirmed.spendable) {
    die(
      `The transfer of ${name} to the locking script is in the lockup period. Please try again in ${confirmed.spendableIn} blocks.`,
    );
  }

  log('Finalizing locking script transfer.');
  const lockFinalize = await finalizeNameLock(context, transfer);
  await db.putLockFinalize(lockFinalize);
  log(
    `Name finalized to locking script with transaction hash ${lockFinalize.finalizeTxHash}.`,
  );
  log('Please wait at least 15 minutes for your transaction to be confirmed.');
}

async function transferLockCancel(name) {
  await confirm(
    `Your transfer of ${name} to the locking script will be cancelled. You will need to finalize this ` +
    'transfer to regain ownership of the name. Do you wish to continue?',
  );

  const {db, context} = await setupCLI();

  const nameState = await db.getOutboundNameState(name);
  if (nameState === null) {
    die(`Name ${name} not found.`);
  }
  if (nameState !== 'FINALIZE' && nameState !== 'AUCTION') {
    die(`Name ${name} is not in the FINALIZE or AUCTION state.`);
  }
  if (nameState === 'AUCTION') {
    await confirm(
      'WARNING! Your auction is already live. If someone redeems one of your pre-signed auction ' +
      'transactions, your name name will be irrevocably transferred to them. Do you understand this?',
    );
  }

  const finalizeJSON = await db.getLockFinalize(name);
  const finalize = new NameLockFinalize(finalizeJSON);
  const transferCancel = await transferNameLockCancel(context, finalize);
  await db.putLockCancelTransfer(context, transferCancel);
  log(
    `Name lock transferred back to seller with transaction hash ${transferCancel.transferTxHash.toString(
      'hex',
    )}.`,
  );
  log('Please wait 15 minutes for your transaction to be confirmed.');
}

async function finalizeLockCancel(name) {
  const {db, context} = await setupCLI();

  const nameState = await db.getOutboundNameState(name);
  if (nameState !== 'CANCEL_TRANSFER') {
    die(`Name $[name} is not in the CANCEL_TRANSFER state.`);
  }

  const transferJSON = await db.getLockCancelTransfer(name);
  const transfer = new NameLockCancelTransfer(transferJSON);
  const finalize = await finalizeNameLockCancel(context, transfer);
  await db.putLockCancelFinalize(finalize);
  log(
    `Name lock finalized back to seller with transaction hash ${finalize.finalizeTxHash.toString(
      'hex',
    )}.`,
  );
  log('Please wait 15 minutes for your transaction to be confirmed.');
}

async function createAuction(name) {
  const {db, opts, context} = await setupCLI();
  const shakedexWebHost = opts.shakedexWebHost;

  const nameState = await db.getOutboundNameState(name);
  if (nameState === null) {
    die(`Name ${name} not found.`);
  }
  if (nameState !== 'EXTERNAL_TRANSFER' && nameState !== 'FINALIZE' && nameState !== 'AUCTION') {
    die(`Name ${name} is not in the EXTERNAL_TRANSFER, FINALIZE, or AUCTION state.`);
  }

  if (nameState === 'AUCTION') {
    const overwriteOkAnswer = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwriteOk',
        message: `You have already created an auction for ${name}. Do you want to overwrite it?`,
        default: true,
      },
    ]);

    if (!overwriteOkAnswer.overwriteOk) {
      die('Aborted.');
    }
  }

  let finalize;
  if (nameState === 'EXTERNAL_TRANSFER') {
    const extTransferJSON = await db.getLockExternalTransfer(name);
    const extTransfer = new NameLockExternalTransfer(extTransferJSON);
    const confirmation = await extTransfer.getConfirmationDetails(context);
    if (!confirmation.confirmedAt) {
      die(
        `The transaction finalizing ${name} to the locking script is unconfirmed. Please try again later.`,
      );
    }
    finalize = new NameLockFinalize({
      name: extTransfer.name,
      finalizeTxHash: confirmation.finalizeTxHash,
      finalizeOutputIdx: confirmation.finalizeOutputIdx,
      privateKey: extTransfer.privateKey,
      broadcastAt: confirmation.confirmedAt * 1000,
    });
  } else {
    const finalizeJSON = await db.getLockFinalize(name);
    finalize = new NameLockFinalize(finalizeJSON);
    const confirmation = await finalize.getConfirmationDetails(context);
    if (!confirmation.confirmedAt) {
      die(
        `The transaction finalizing ${name} to the locking script is unconfirmed. Please try again later.`,
      );
    }
  }

  const {outPath, auction, shouldPost} = await promptAuctionParameters(
    db,
    context,
    finalize,
    shakedexWebHost,
  );

  const stream = fs.createWriteStream(outPath);
  await auction.writeToStream(context, stream);

  if (shouldPost) {
    try {
      await postAuction(context, auction, shakedexWebHost);
    } catch (e) {
      log('An error occurred posting your proof to Shakedex Web:');
      log(e.message);
      log(e.stack);
      log(`You can still find your proof in ${outPath}.`);
    }
  }

  await db.putAuction(context, auction);

  log(`Your auction has been successfully written to ${outPath}.`);
}

async function publishAuction(auctionFile) {
  const exists = fs.existsSync(auctionFile);
  if (!exists) {
    die(`Auction file not found.`);
  }

  const {opts, context} = await setupCLI();
  const readStream = await fs.readFileSync(auctionFile);
  const auction = await Auction.fromStream(readStream);

  try {
    await postAuction(context, auction, opts.shakedexWebHost);
  } catch (e) {
    log('An error occurred posting your proof to Shakedex Web:');
    log(e.message);
    log(e.stack);
    return;
  }

  log(`Your auction for ${auction.name} was successfully posted to ${opts.shakedexWebHost}.`);
  log(`Link: https://${opts.shakedexWebHost}/a/${auction.name}`);
}

async function promptAuctionParameters(db, context, finalize, shakedexWebHost) {
  const {name} = finalize;

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'duration',
      message: 'How long should the auction last?',
      choices: ['1 day', '3 days', '5 days', '7 days', '14 days'],
    },
    {
      type: 'list',
      name: 'decrementInterval',
      message: 'How often would you like the price to decrease?',
      choices: ['Every 15 minutes', 'Every 30 minutes', 'Hourly', 'Daily'],
    },
    {
      type: 'input',
      name: 'startPrice',
      message:
        'What price would you like to start the auction at? This should be a high price. Expressed in whole HNS.',
      validate: (value) => {
        const valid = !isNaN(Number(value)) && Number(value) > 0;
        if (valid) {
          return true;
        }
        return `Invalid start price.`;
      },
    },
    {
      type: 'input',
      name: 'endPrice',
      message:
        'What price would you like to end the auction at? This is the lowest price you will accept for the name. Expressed in whole HNS.',
      validate: (value) => {
        const valid = !isNaN(Number(value)) && Number(value) > 0;
        if (valid) {
          return true;
        }
        return `Invalid end price.`;
      },
    },
    {
      type: 'input',
      name: 'outPath',
      message: 'Where would you like to store your auction presigns?',
    },
    {
      type: 'confirm',
      name: 'shouldPost',
      message: `Would you like to publish your auction to Shakedex Web at ${shakedexWebHost}?`,
      default: true,
    },
  ]);

  const durationDays = Number(answers.duration.split(' ')[0]);
  const decrementInterval = answers.decrementInterval;
  const startPrice = Number(answers.startPrice);
  const endPrice = Number(answers.endPrice);
  if (startPrice < endPrice) {
    die('Your start price cannot be less than your end price.');
  }

  let reductionTime;
  switch (decrementInterval) {
    case 'Every 15 minutes':
      reductionTime = 15 * 60;
      break;
    case 'Every 30 minutes':
      reductionTime = 30 * 60;
      break;
    case 'Hourly':
      reductionTime = 60 * 60;
      break;
    case 'Daily':
      reductionTime = 24 * 60 * 60;
  }

  let outPath = answers.outPath;
  if (answers.outPath[0] === '~') {
    outPath = outPath.replace('~', process.env.HOME);
  }

  let feeInfo = DEFAULT_FEE_INFO;
  let shouldPost = answers.shouldPost;

  if (shouldPost) {
    try {
      feeInfo = await getPostFeeInfo(context, shakedexWebHost);
    } catch (e) {
      log('An error occurred while getting fee info; not posting to Shakedex Web.');
    }

    if (feeInfo.rate !== 0) {
      const feeOk = await confirm(
        `The ShakeDex Web host at ${shakedexWebHost} charges a fee of ${feeInfo.rate / 100}%. Is this OK? ` +
        `Buyers will pay this fee. If you decline, your auction's presigns will still be generated with ` +
        `a fee of zero. They will not be uploaded to the auction site.`,
        false,
      );

      if (!feeOk) {
        feeInfo = DEFAULT_FEE_INFO;
        shouldPost = false;
      }
    }
  }

  const mtp = await context.getMTP();
  const auctionFactory = new AuctionFactory({
    name,
    startTime: mtp,
    endTime: mtp + durationDays * 24 * 60 * 60,
    startPrice: startPrice * 1e6,
    endPrice: endPrice * 1e6,
    reductionTime,
    reductionStrategy: linearReductionStrategy,
    feeRate: feeInfo.rate,
    feeAddr: feeInfo.addr,
  });

  const auction = await auctionFactory.createAuction(context, finalize);

  log(`Please confirm your auction's pricing parameters below.`);
  const table = new Table({
    head: ['Price', 'Fee', 'Unlocks At'],
  });
  for (const datum of auction.data) {
    table.push([
      (datum.price / 1e6).toFixed(6),
      (datum.fee / 1e6).toFixed(6),
      format(new Date(datum.lockTime * 1000), 'MM/dd/yyyy HH:MM:SS'),
    ]);
  }

  process.stdout.write(table.toString());
  process.stdout.write('\n');

  const paramsOkAnswer = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'paramsOk',
      message: 'Do these auction pricing parameters look ok?',
      default: true,
    },
  ]);

  if (!paramsOkAnswer.paramsOk) {
    return promptAuctionParameters(db, context, finalize, shakedexWebHost);
  }

  return {outPath, auction, shouldPost};
}

async function listAuctions() {
  const {db, context} = await setupCLI();

  const table = new Table({
    head: [
      'Name',
      'Status',
      'Confirmed',
      'Lockup',
      'Broadcast At',
      'Confirmed At',
    ],
  });

  const names = [];
  await db.iterateOutboundNames((key, value) => {
    const keySplits = key.split('/');
    const name = keySplits[keySplits.length - 1];
    const version = Number(value);
    names.push([name, version]);
  });

  for (const [name, version] of names) {
    const state = await db.getOutboundNameState(name, version);

    switch (state) {
      case 'EXTERNAL_TRANSFER': {
        const transfer = new NameLockExternalTransfer(
          await db.getLockExternalTransfer(name, version),
        );
        const confirmation = await transfer.getConfirmationDetails(context);
        table.push([
          name,
          `EXTERNAL_TRANSFER_${confirmation.status}`,
          confirmation.status === 'CONFIRMED' ? 'YES' : 'NO',
          'N/A',
          'N/A',
          confirmation.confirmedAt
            ? format(new Date(confirmation.confirmedAt), 'MM/dd/yyyy HH:MM:SS')
            : '-',
        ]);
        break;
      }
      case 'TRANSFER': {
        const transfer = new NameLockTransfer(
          await db.getLockTransfer(name, version),
        );
        const confirmation = await transfer.getConfirmationDetails(context);
        table.push([
          name,
          state,
          confirmation.confirmedAt ? 'YES' : 'NO',
          confirmation.confirmedAt
            ? confirmation.spendable
            ? '0 BLOCKS'
            : `${confirmation.spendableIn} BLOCKS`
            : '-',
          format(new Date(transfer.broadcastAt), 'MM/dd/yyyy HH:MM:SS'),
          confirmation.confirmedAt
            ? format(new Date(confirmation.confirmedAt), 'MM/dd/yyyy HH:MM:SS')
            : '-',
        ]);
        break;
      }
      case 'FINALIZE': {
        const finalize = new NameLockFinalize(
          await db.getLockFinalize(name, version),
        );
        const confirmation = await finalize.getConfirmationDetails(context);
        table.push([
          name,
          state,
          confirmation.confirmedAt ? 'YES' : 'NO',
          '-',
          format(new Date(finalize.broadcastAt), 'MM/dd/yyyy HH:MM:SS'),
          confirmation.confirmedAt
            ? format(new Date(confirmation.confirmedAt), 'MM/dd/yyyy HH:MM:SS')
            : '-',
        ]);
        break;
      }
      case 'AUCTION': {
        const auction = new Auction(await db.getAuction(name, version));
        const isFulfilled = await auction.isFulfilled(context);
        table.push([
          name,
          isFulfilled ? 'AUCTION_FILLED' : 'AUCTION_LIVE',
          isFulfilled ? 'YES' : 'NO',
          '-',
          '-',
          '-',
        ]);
        break;
      }
      case 'CANCEL_TRANSFER': {
        const cancelTransfer = new NameLockCancelTransfer(
          await db.getLockCancelTransfer(name, version),
        );
        const confirmation = await cancelTransfer.getConfirmationDetails(
          context,
        );
        table.push([
          name,
          state,
          confirmation.confirmedAt ? 'YES' : 'NO',
          confirmation.confirmedAt
            ? confirmation.spendable
            ? '0 BLOCKS'
            : `${confirmation.spendableIn} BLOCKS`
            : '-',
          format(new Date(cancelTransfer.broadcastAt), 'MM/dd/yyyy HH:MM:SS'),
          confirmation.confirmedAt
            ? format(new Date(confirmation.confirmedAt), 'MM/dd/yyyy HH:MM:SS')
            : '-',
        ]);
        break;
      }
      case 'CANCEL_FINALIZE': {
        const cancelFinalize = new NameLockCancelFinalize(
          await db.getLockCancelFinalize(name, version),
        );
        const confirmation = await cancelFinalize.getConfirmationDetails(
          context,
        );
        table.push([
          name,
          state,
          confirmation.confirmedAt ? 'YES' : 'NO',
          '-',
          format(new Date(cancelFinalize.broadcastAt), 'MM/dd/yyyy HH:MM:SS'),
          confirmation.confirmedAt
            ? format(new Date(confirmation.confirmedAt), 'MM/dd/yyyy HH:MM:SS')
            : '-',
        ]);
        break;
      }
    }
  }

  process.stdout.write(table.toString());
  process.stdout.write('\n');
}

async function auctionDetails(name) {
  const {db, context} = await setupCLI();
  const status = await db.getOutboundNameState(name);
  if (status !== 'AUCTION') {
    die(
      `Name ${name} is not in the AUCTION state. Run shakedex list-outbound-names to view this name.`,
    );
  }

  const auctionJSON = await db.getAuction(name);
  if (!auctionJSON) {
    throw new Error(
      `Auction for ${name} was not found. This implies database corruption; please file an issue.`,
    );
  }
  const auction = new Auction(auctionJSON);
  const isFulfilled = await auction.isFulfilled(context);

  log('Basic info:');
  const infoTable = new Table();
  infoTable.push(
    {Name: name},
    {'Locking TX Hash': auction.lockingTxHash.toString('hex')},
    {'Locking Output Idx': auction.lockingOutputIdx},
    {
      'First Bid Unlocks At': format(
        new Date(auction.data[0].lockTime * 1000),
        'MM/dd/yyyy HH:MM:SS',
      ),
    },
    {
      'Last Bid Unlocks At': format(
        new Date(auction.data[auction.data.length - 1].lockTime * 1000),
        'MM/dd/yyyy HH:MM:SS',
      ),
    },
    {'Starting Bid': (auction.data[0].price / 1e6).toFixed(6)},
    {
      'Ending Bid': (auction.data[auction.data.length - 1].price / 1e6).toFixed(
        6,
      ),
    },
    {'Fulfilled?': isFulfilled ? 'YES' : 'NO'},
  );
  process.stdout.write(infoTable.toString());
  process.stdout.write('\n');

  log('Bid schedule:');
  const bidsTable = new Table(['Bid', 'Unlocks At']);
  for (const datum of auction.data) {
    bidsTable.push([
      (datum.price / 1e6).toFixed(6),
      format(new Date(datum.lockTime * 1000), 'MM/dd/yyyy HH:MM:SS'),
    ]);
  }
  process.stdout.write(bidsTable.toString());
  process.stdout.write('\n');
}

async function fillAuction(auctionPath) {
  const exists = fs.existsSync(auctionPath);
  if (!exists) {
    die(`Proposals file not found.`);
  }

  const {db, context} = await setupCLI();
  const readStream = await fs.readFileSync(auctionPath);
  const auction = await Auction.fromStream(readStream);

  log('Verifying swap proofs.');
  const ok = await auction.verifyProofs(context, (curr, total) => {
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
    process.stdout.write(`>> Verified proof ${curr}.`);
  });
  process.stdout.clearLine();
  process.stdout.cursorTo(0);
  if (!ok) {
    die('Auction contains invalid swap proofs.');
  }
  log('All swap proofs in auction are valid.');

  log('Calculating best price.');

  const [bestBid, bestProofIdx] = await auction.bestBidAt(context);

  if (!bestBid)
    die('No proofs are mature yet, auction has not started.');

  const table = new Table();
  table.push(
    {
      Name: bestBid.name,
    },
    {
      Price: `${(bestBid.price / 1e6).toFixed(6)} HNS`,
    },
    {
      Fee: `${(bestBid.fee / 1e6).toFixed(6)}`,
    },
  );
  process.stdout.write(table.toString());
  process.stdout.write('\n');

  await confirm(
    'Are you sure you want to fill the auction above? This action is not reversible. You are responsible for all blockchain fees.',
  );

  const fill = await fillSwap(context, auction.toSwapProof(bestProofIdx));
  await db.putSwapFill(fill);
  log(`Fulfilled auction with transaction hash ${fill.fulfillmentTxHash}.`);
  log(`Please wait 15 minutes for the blockchain to confirm the transaction.`);
}

async function finalizeAuction(name) {
  const {db, context} = await setupCLI();
  const status = await db.getInboundNameState(name);
  if (status !== 'FILL') {
    die(`Name ${name} is not in the FILL state.`);
  }

  const fillJSON = await db.getSwapFill(name);
  if (!fillJSON) {
    throw new Error(
      `Fill fo ${name} was not found. This implies database corruption; please file an issue.`,
    );
  }
  const fill = new SwapFill(fillJSON);
  const confirmed = await fill.getConfirmationDetails(context);
  if (!confirmed.confirmedAt) {
    die(
      `The transaction filling the ${name} auction is unconfirmed. Please try again later.`,
    );
  }
  if (!confirmed.spendable) {
    die(
      `The fill transferring ${name} to the buyer is in the lockup period. Please try again in ${confirmed.spendableIn} blocks.`,
    );
  }

  const finalize = await finalizeSwap(context, fill);
  await db.putSwapFinalize(finalize);
}

async function listFills() {
  const {db, context} = await setupCLI();

  const table = new Table({
    head: [
      'Name',
      'Status',
      'Confirmed',
      'Lockup',
      'Price',
      'Fee',
      'Broadcast At',
      'Confirmed At',
    ],
  });

  const names = [];
  await db.iterateInboundNames((key, value) => {
    const keySplits = key.split('/');
    const name = keySplits[keySplits.length - 1];
    const version = Number(value);
    names.push([name, version]);
  });

  for (const [name, version] of names) {
    const state = await db.getInboundNameState(name, version);

    switch (state) {
      case 'FILL': {
        const fill = new SwapFill(await db.getSwapFill(name, version));
        const confirmation = await fill.getConfirmationDetails(context);
        table.push([
          fill.name,
          'FILL',
          confirmation.confirmedAt ? 'YES' : 'NO',
          confirmation.confirmedAt
            ? confirmation.spendable
            ? '0 BLOCKS'
            : `${confirmation.spendableIn} BLOCKS`
            : '-',
          (fill.price / 1e6).toFixed(6),
          (fill.fee / 1e6).toFixed(6),
          format(new Date(fill.broadcastAt), 'MM/dd/yyyy HH:MM:SS'),
          confirmation.confirmedAt
            ? format(new Date(confirmation.confirmedAt * 1000), 'MM/dd/yyyy HH:MM:SS')
            : '-',
        ]);
        break;
      }
      case 'FINALIZE': {
        const fill = new SwapFill(await db.getSwapFill(name, version));
        const finalize = new SwapFinalize(
          await db.getSwapFinalize(name, version),
        );
        const confirmation = await fill.getConfirmationDetails(context);
        table.push([
          finalize.name,
          'FINALIZE',
          confirmation.confirmedAt ? 'YES' : 'NO',
          '-',
          (fill.price / 1e6).toFixed(6),
          (fill.fee / 1e6).toFixed(6),
          format(new Date(finalize.broadcastAt), 'MM/dd/yyyy HH:MM:SS'),
          confirmation.confirmedAt
            ? format(new Date(confirmation.confirmedAt), 'MM/dd/yyyy HH:MM:SS')
            : '-',
        ]);
        break;
      }
    }
  }
  process.stdout.write(table.toString());
  process.stdout.write('\n');
}

async function backup(outFile) {
  const {prefix} = program.opts();
  log(`Backing up database in ${prefix}.`);
  await backupDb(prefix, outFile);
  log('Done.');
}