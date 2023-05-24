import { ApiPromise, Keyring, WsProvider } from '@polkadot/api'
import { KeyringPair } from '@polkadot/keyring/types'
import { cryptoWaitReady, blake2AsU8a, blake2AsHex } from '@polkadot/util-crypto'
import base64url from 'base64url'
import axios from 'axios'
import yargs from 'yargs'

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
  .option('tx', {
    alias: 't',
    description: 'The hex encoded call data that should be submitted',
    type: 'string',
    default: '0x00002c68656c6c6f20776f726c64', // system.remark('Hello World!')
    demandOption: true
  })
  .help()
  .parseSync()


async function main(): Promise<void> {
  const keyring = await setupKeyring()
  const { seed, tx, endpoint } = argv

  // Create DID authentication key from mnemonic seed phrase
  // This assumes that the DID was created using the Sporran wallet.
  // * key type: SR25519
  // * derivation path for authentication key: //did//0
  const authKey = keyring.addFromUri(seed + '//did//0')

  const keyId = keyIdFromPublicKey(didFromPublicKey(authKey), authKey)

  // Every submission to TXD is required to be signed by your DID.
  // We create a JWT token with the hash of the transaction
  const token = createJWS('/api/v1/submission', tx, keyId, authKey)

  // send an authenticated POST request to TXD with the transaction data
  // If TXD accepts the transaction, it will respond with an ID that can later be used to query the transaction status
  const res = await axios.post(`${endpoint}/api/v1/submission`, tx, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  })
  const id: string = res.data.id
  console.log('Transaction sent!')
  console.log(JSON.stringify(res.data, null, 2))

  // Poll the transaction status and exit when the transaction was finalized
  console.log('Waiting for transaction to be included...')
  while (true) { 
    // wait a second
    await new Promise(resolve => setTimeout(resolve, 1000))

    // create the token to authenticate the request
    const token = createJWS(`/api/v1/submission/${id}`, '', keyId, authKey)

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
function createJWS(path: string, body: string, kid: string, key: KeyringPair): string {
  const hash = blake2AsU8a(path + body, 256)
  const sig = key.sign(hash)
  const header: string = base64url(JSON.stringify({ kid }))
  const payload: string = base64url(Buffer.from(hash))
  const signature: string = base64url(Buffer.from(sig))
  return `${header}.${payload}.${signature}`
}

async function setupKeyring(): Promise<Keyring> {
  await cryptoWaitReady()
  const keyring = new Keyring({ type: 'sr25519' })
  keyring.setSS58Format(38)
  return keyring
}

/**
 * Calculates the DID URI for the given key.
 * 
 * WARNING: this function assumes that the keypair was used to create the DID. If
 * the authentication key was not changed.
 * @param keypair The key for which we calculate the DID URI
 * @returns the DID URI
 */
function didFromPublicKey(keypair: KeyringPair): string {
  return `did:kilt:${keypair.address}`
}

/**
 * Calculates the Key URI for the given key
 * @param didUri The DID URI to which the publickey belongs
 * @param keypair The key for which we calculate the Key URI
 * @returns 
 */
function keyIdFromPublicKey(didUri: string, keypair: KeyringPair): string {
  // The key identifier is a hash over the public key prefixed by the DID
  const authKeyHash = blake2AsHex(new Uint8Array([
    0x00 /* PublicVerificationKey */,
    0x01 /* Sr25519 */,
    ...keypair.publicKey
  ]), 256)
  return `did:kilt:${keypair.address}#${authKeyHash}`
}

// run the main function
main().catch(console.error).finally(() => process.exit())
