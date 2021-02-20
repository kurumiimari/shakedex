[![CircleCI](https://circleci.com/gh/kurumiimari/shakedex.svg?style=svg)](https://circleci.com/gh/kurumiimari/shakedex)
[![Discord](https://img.shields.io/discord/812809443326558217)](https://discord.gg/sDVEEsvjTJ)

# 🤝💰 shakedex 💰🤝

A decentralized exchange for Handshake names.

## How It Works

The underlying protocol is based on the [non-interactive name swap construction](https://github.com/handshake-org/HIPs/pull/3) created by [@tynes](https://github.com/tynes). It works like this:

1. Alice transfers one of her names to a locking script that prevents it from being spent anywhere except another transfer.
2. Alice crafts a presigned transaction that signs over the following inputs and outputs:
	- Input: Her `FINALIZE` output from the transfer in step 1.
	- Output: An output back to herself valued at whatever she wants to sell the name for.
3. Alice distributes the presigned transaction wherever she sees fit.
4. Bob takes the presigned transaction, adds an input to fund Alice's sale price, an output transferring the name to him, and a change output if necessary.
5. Bob signs the transaction and broadcasts it. He can now `FINALIZE` the transfer whenever he sees fit.

shakedex automates the above flow, and adds an auction layer on top. By creating a set of presigned transactions with decreasing sale prices but increasing lock times, shakedex creates a fully decentralized reverse-Dutch auction system that allows names to be bought and sold without intermediaries.

## Installation

To install shakedex:

```
npm i -g shakedex
```

For shakedex to work, you'll need a Handshake node running somewhere. You can use [Bob Wallet](https://github.com/kyokan/bob-wallet) (just remember to set your API key), or run [hsd](https://github.com/handshake-org/hsd) in a background process. Make sure to start your HSD node with `--index-tx`.

## Usage

> **⚠️ Warning:** Shakedex generates its own public/private keys to sign/redeem auction presigns. These keys are stored in `~/.shakedex`. Remember to back up this folder - without it, you risk losing funds.

`shakedex` has a command line interface. CLI usage is documented by running `shakedex --help`.

The workflow to create a swap is as follows:

### Selling a Name

**1. Transfer the name to the locking script.**

Run `shakedex transfer-lock <name>`. This will initiate the transfer to the locking script. You may be asked for your wallet passphrase.

Wait 48 hours for the transfer lockup to expire.

**2. Finalize the transfer to the locking script.**

Run `shakedex finalize-lock <name>`. Wait 15 minutes for the transaction to confirm.

**3. Generate Presigns**

Run `shakedex create-auction <name>`. This will walk you through the process of creating an auction. You will choose:

1. The starting price, which should be very high.
2. The ending price, which should be the lowest price you are willing to accept for the name.
3. The duration of the auction.
4. A location on disk to put the presigns.

This will output a file containing a set of newline-delimited JSONs. These JSONS are the "swap proofs" Bob will use to validate the auction. They are time-locked, so you can release them all at once.

**4. Distribute Presigns**

The CLI will offer to upload your presigns to [ShakeDex Web](https://www.shakedex.com), a website that displays Shakedex swap proofs.

You can also opload the presigns file wherever presign files are found.

### Buying a Name

**1. Download Presigns**

Download a presigns file from wherever presign files are found.

**2. Fulfill the Auction**

Run `shakedex fulfill-auction <path to presigns file>`. This will find the lowest non-timelocked price and fulfill it using funds from your wallet. You may be asked for your passphrase.

Wait 48 hours for the transfer lockup to expire.

**3. Finalize the Auction**

Run `shakedex finalize-auction <name>`. Wait 15 minutes for the transaction to confirm.

The auction is now complete!

### Viewing Auction/Fulfillment Info

You can see your list of active auctions by running `shakedex list-auctions`. The output looks something like this:

```
┌────────┬──────────────────┬─────────────────────┬─────────────────────┬─────────────────────┬─────────────────────┬─────────────┬───────────┬───────────────┐
│ Name   │ Status           │ Transfer Broadcast  │ Transfer Confirmed  │ Finalize Broadcast  │ Finalize Confirmed  │ Start Price │ End Price │ Current Price │
├────────┼──────────────────┼─────────────────────┼─────────────────────┼─────────────────────┼─────────────────────┼─────────────┼───────────┼───────────────┤
│ monk   │ AUCTION_LIVE     │ 2021-02-06 02:34:16 │ 2021-02-06 02:35:12 │ 2021-02-06 02:40:39 │ 2021-02-06 02:41:05 │ 100.000000  │ 1.000000  │ 95.875000     │
├────────┼──────────────────┼─────────────────────┼─────────────────────┼─────────────────────┼─────────────────────┼─────────────┼───────────┼───────────────┤
│ stonks │ FINALIZE_MEMPOOL │ 2021-02-06 03:40:40 │ 2021-02-06 03:42:30 │ 2021-02-06 03:42:41 │ -                   │ -           │ -         │ -             │
└────────┴──────────────────┴─────────────────────┴─────────────────────┴─────────────────────┴─────────────────────┴─────────────┴───────────┴───────────────┘

```

Similarly, you can see the list of names you have bought by running `shakedex list-fulfillments`. The output looks something like this:

```
┌──────┬────────────────────────────┬────────────┬─────────────────────┬─────────────────────┬─────────────────────┬─────────────────────┐
│ Name │ Status                     │ Price      │ Fulfill Broadcast   │ Fulfill Confirmed   │ Finalize Broadcast  │ Finalize Confirmed  │
├──────┼────────────────────────────┼────────────┼─────────────────────┼─────────────────────┼─────────────────────┼─────────────────────┤
│ honk │ FULFILL_FINALIZE_CONFIRMED │ 100.000000 │ 2021-02-06 02:42:26 │ 2021-02-06 02:50:51 │ 2021-02-06 02:51:50 │ 2021-02-06 02:51:54 │
└──────┴────────────────────────────┴────────────┴─────────────────────┴─────────────────────┴─────────────────────┴─────────────────────┘
```

## Errata

### FAQ

**How does the locking script work?**

Essentially, it uses Handshake's `OP_TYPE` opcode to return `OP_RETURN` whenever someon tries to spend a lockd name to a `RENEW`, `REVOKE`, or `UPDATE` output.

You can see the script working for yourself by checking out the [swap script tests](https://github.com/kurumiimari/shakedex/blob/master/test/swapService.test.js#L96).

**Can I cancel a name transferred to the locking script?**

Yes, but you will either need to wait for me to implement a feature for that in shakedex or figure out the right code to unlock the locking script on your own.

**Can I use hsd/Bob to manage the names I buy using shakedex?**

Yes, you can. Once the transfer has been `FINALIZE`d, the name can be managed using Bob, HSD, or any other wallet of your choice.

### Design Goals

1. The project should function both as a CLI tool and as a library.
2. The library should use Handshake's RPC/REST API rather than direct wallet/node DB access.
3. Minimize the amount of state stored on disk.

## Development Status

Alpha Software That Works On My Machine 💫
