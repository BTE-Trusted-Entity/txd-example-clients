import { ApiPromise, Keyring, WsProvider } from '@polkadot/api'
import { KeyringPair } from '@polkadot/keyring/types'
import { cryptoWaitReady, blake2AsU8a, blake2AsHex, mnemonicGenerate } from '@polkadot/util-crypto'
import { BTreeSet, Option, Vec } from '@polkadot/types-codec';

import base64url from 'base64url'
import axios from 'axios'
import yargs from 'yargs'

import { DidDidDetailsDidCreationDetails } from '@kiltprotocol/augment-api'

// define command line arguments
const argv = yargs
  .option('endpoint', {
    alias: 'e',
    description: 'The endpoint of the TXD',
    type: 'string',
    default: 'https://txd-stg.trusted-entity.io'
  })
  .option('seed', {
    alias: 's',
    description: 'The seed of the client DID account',
    type: 'string',
    demandOption: true
  })
  .help()
  .parseSync()

async function main (): Promise<void> {
  await cryptoWaitReady()

  const {seed, endpoint} = argv

  // Create DID authentication key from mnemonic seed phrase
  const keyring = new Keyring({ type: 'sr25519' })
  keyring.setSS58Format(38)
  const authKey = keyring.addFromUri(seed + '//did//0')

  // The key identifier is a hash over the public key prefixed by the DID
  const authKeyHash = blake2AsHex(new Uint8Array([
    0x00 /* PublicVerificationKey */,
    0x01 /* Sr25519 */,
    ...authKey.publicKey
  ]), 256)
  const kid = `did:kilt:${authKey.address}#${authKeyHash}`
  
  // connect to the node to get api object
  const provider = new WsProvider('wss://peregrine.kilt.io/parachain-public-ws')
  const api = await ApiPromise.create({ provider })

  // get metadata of the service to retrieve the payment address
  const meta = await axios.get(`${endpoint}/meta`)
  const paymentAddress = api.createType('AccountId32', meta.data.paymentAddress)

  // create mnemonic and keys for new DID -> save that in a non test case
  const newDidMnemonic = mnemonicGenerate(12);
  const newDidAuthKey = keyring.addFromUri(newDidMnemonic + '//did//0')
  const newDidAccountId = api.createType('AccountId32', newDidAuthKey.address)

  // create creation transaction
  const createDetails: DidDidDetailsDidCreationDetails = api.createType('DidDidDetailsDidCreationDetails', {
    did: newDidAccountId,
    submitter: paymentAddress,
    newAttestationKey: new Option(api.registry, 'DidDidDetailsDidVerificationKey', 
      api.createType('DidDidDetailsDidVerificationKey', {
        [newDidAuthKey.type]: newDidAuthKey.publicKey
      })
    ),
    newDelegationKey: new Option(api.registry, 'DidDidDetailsDidVerificationKey', 
      api.createType('DidDidDetailsDidVerificationKey', {
        [newDidAuthKey.type]: newDidAuthKey.publicKey
      })
    ),
    newServiceDetails: new Vec(api.registry, 'DidServiceEndpointsDidEndpoint', []),
    newKeyAgreementKeys: new BTreeSet(api.registry, 'DidDidDetailsDidEncryptionKey', []),
  })
  const signature = newDidAuthKey.sign(createDetails.toU8a())
  const tx = api.tx.did.create(createDetails, {Sr25519: signature}).method.toHex()

  // create the token to authenticate the request
  const token = createJWS('/api/v1/submission', tx, kid, authKey)

  // send a authenticated POST request to TXD with the transaction data
  const res = await axios.post(`${endpoint}/api/v1/submission`, tx, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  })
  const id: string = res.data.id
  console.log('Transaction sent!')
  console.log(JSON.stringify(res.data, null, 2))

  // poll status
  console.log('Waiting for transaction to be included...')
  while (true) {
    // wait a second
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // create the token to authenticate the request
    const token = createJWS(`/api/v1/submission/${id}`, '', kid, authKey)

    // send a authenticated GET request to TXD to get the status
    const res = await axios.get(`${endpoint}/api/v1/submission/${id}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    })
    console.log(`Transaction status: ${JSON.stringify(res.data, null, 2)}`)
    
    // stop polling the status once the transaction is finalized
    if (res.data.status === 'Finalized') {
      break
    }
  }
}

// createJWS creates a token with a signature over path and payload
function createJWS (path: string, body: string, kid: string, key: KeyringPair): string {
  const hash = blake2AsU8a(path + body, 256)
  const sig = key.sign(hash)
  const header: string = base64url(JSON.stringify({ kid }))
  const payload: string = base64url(Buffer.from(hash))
  const signature: string = base64url(Buffer.from(sig))
  return `${header}.${payload}.${signature}`
}

// run the main function
main().catch(console.error).finally(() => process.exit())
