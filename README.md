TXD Client Examples
===================

This repository contains examples of using the TXD service for submitting transactions to the KILT blockchain.

# Requirements

To interact with TXD you will need access to the seed of a whitelisted DID. 
We will assume that you have that seed in a environment variable called `$SEED`.
Further we will assume that that DID was generated using sporran, so all key derivation paths are following the standard. 

# Examples

## NodeJS

The NodeJS examples are located in the `nodejs` folder.
To get started go to the folder and run `yarn install` to install the dependencies.

### Hello World

This example shows how to submit a simple transaction to TXD.
It takes the seed and optionally a hex encoded call as a command line parameter and submits that.
When you run it it will properly authenticate the request, submit it and watch the transaction until it is finalized.

To run first go into the `nodejs` folder and execute:

```bash
yarn run:minimal --seed "${SEED}"
```

If you want to build your own extrinsic and submit it instead of the hello-world remark, go to [polkadot.js.org/apps](https://polkadot.js.org/apps/?rpc=wss%3A%2F%2Fspiritnet.api.onfinality.io%2Fpublic-ws#/extrinsics) and assemble your own extrinsic.
Then you can submit it by running:

```bash
yarn run:minimal --seed "${SEED}" --tx "${ENCODED_CALL_DATA}"
```

### Create DID

This example shows how to assemble a DID creation extrinsic and submit it to TXD.
It shows how to work with non-trivial types and also how to retrieve the payment address.

To run first go into the `nodejs` folder and execute:

```bash
yarn run:create-did --seed "${SEED}"
```