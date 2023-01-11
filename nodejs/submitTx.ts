import { setInterval } from 'timers/promises';
import { cryptoWaitReady } from '@polkadot/util-crypto';

import { Crypto } from '@kiltprotocol/utils';
// import got from 'got';
import axios from 'axios';
// import Boom from '@hapi/boom';

import { configuration } from './configuration';
import { logger } from './logger';
import { makeKeypair } from './keypair';

const tx = '0x00013048656c6c6f20576f726c6421';

function createJWS(endpoint: string, body = ''): string {
  const keypair = makeKeypair();
  const { keyUri } = configuration;

  const hash = Crypto.hash(endpoint + body, 256);

  const sig = keypair.sign(hash);
  const header = Buffer.from(JSON.stringify({ kid: keyUri })).toString('base64url');
  const payload = Buffer.from(hash).toString('base64url');
  const signature = Buffer.from(sig).toString('base64url');

  return `${header}.${payload}.${signature}`;
}

function makeHeaders(endpoint: string, body?: string) {
  return {
    Authorization: `Bearer ${createJWS(endpoint, body)}`,
  };
}

async function pollTxStatus(id: string) {
  const { TXDBaseUrl } = configuration;

  const endpoint = `/api/v1/submission/${id}`;
  const headers = makeHeaders(endpoint);

  const timeout = 2 * 60 * 1000;

  console.log('poll');
  for await (const startTime of setInterval(1000, Date.now())) {
    const data = (await axios.get(`${TXDBaseUrl}${endpoint}`, {
      headers,
    })) as {
      status: 'Pending' | 'InBlock' | 'Finalized' | 'Failed';
    };

    if (data.status === 'Pending') {
      const now = Date.now();
      if (now - startTime > timeout) {
        logger.error('Timeout, transaction pending too long');
        // throw Boom.gatewayTimeout();
      }
      logger.debug('Transaction pending');
    }

    if (data.status === 'InBlock') {
      logger.debug('Transaction in block');
    }

    if (data.status === 'Failed') {
      logger.error('Transaction failed');
      // throw Boom.badGateway();
    }

    if (data.status === 'Finalized') {
      logger.debug('Transaction finalized');
      break;
    }
  }
}

export async function submitTx(tx: string) {
  await cryptoWaitReady();

  const { TXDBaseUrl } = configuration;

  const endpoint = '/api/v1/submission';
  const headers = makeHeaders(endpoint, tx);

  const { id } = (await axios.post(`${TXDBaseUrl}${endpoint}`, tx, {
    headers,
  })) as { id: string };

  logger.debug('Transaction sent to TXD, polling status');
  await pollTxStatus(id);
}

submitTx(tx)
  .catch(console.error)
  .finally(() => process.exit());
