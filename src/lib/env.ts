/**
 * Centralized environment variable keys used throughout the application and scripts.
 */
export const ENV_KEYS = {
  S3_ENDPOINT: 'S3_ENDPOINT',
  S3_ACCESS_KEY_ID: 'S3_ACCESS_KEY_ID',
  S3_SECRET_ACCESS_KEY: 'S3_SECRET_ACCESS_KEY',
  S3_BUCKET: 'S3_BUCKET',
  VAULT_ROOT: 'VAULT_ROOT',
} as const;

/**
 * Accessor for environment variables with potential for validation or transformation.
 */
export const env = {
  get S3_ENDPOINT() {
    return process.env[ENV_KEYS.S3_ENDPOINT];
  },
  get S3_ACCESS_KEY_ID() {
    return process.env[ENV_KEYS.S3_ACCESS_KEY_ID];
  },
  get S3_SECRET_ACCESS_KEY() {
    return process.env[ENV_KEYS.S3_SECRET_ACCESS_KEY];
  },
  get S3_BUCKET() {
    return process.env[ENV_KEYS.S3_BUCKET];
  },
  get VAULT_ROOT() {
    return process.env[ENV_KEYS.VAULT_ROOT];
  },
};
