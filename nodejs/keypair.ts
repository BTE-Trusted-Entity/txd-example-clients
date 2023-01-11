import { Crypto } from '@kiltprotocol/utils';

import { configuration } from './configuration';

export function makeKeypair() {
  const { seedPhrase } = configuration;
  return Crypto.makeKeypairFromUri(seedPhrase + '//did//0', 'sr25519');
}
