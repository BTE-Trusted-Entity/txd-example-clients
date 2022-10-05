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
    default: '0x00013048656c6c6f20576f726c6421', // system.remark('Hello World!')
    demandOption: true
  })
  .help()
  .parseSync()

async function main (): Promise<void> {
  await cryptoWaitReady()

  const {seed, tx, endpoint} = argv

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
