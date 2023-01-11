import dotenv from 'dotenv';
import pino from 'pino';

dotenv.config();

class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    pino().fatal(message);
    process.exit(1);
  }
}

const { env } = process;

const TXDBaseUrl = env.BASE_URI_TXD;

if (!TXDBaseUrl) {
  throw new ConfigurationError('No TXD URL provided');
}

const seedPhrase = env.SECRET_SEED_PHRASE;
if (!seedPhrase) {
  throw new ConfigurationError('No seed phrase provided');
}

const keyUri = env.DID_KEY_URI;

if (!keyUri) {
  throw new ConfigurationError('No DID key URI provided');
}

export const configuration = {
  TXDBaseUrl,
  seedPhrase,
  keyUri,
};
