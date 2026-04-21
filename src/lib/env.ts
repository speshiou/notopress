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
 * Metadata for each environment variable, including sensitivity.
 */
export interface EnvMetadata {
  key: string;
  isSensitive: boolean;
}

export const ENV_METADATA: Record<keyof typeof ENV_KEYS, EnvMetadata> = {
  S3_ENDPOINT: { key: ENV_KEYS.S3_ENDPOINT, isSensitive: false },
  S3_ACCESS_KEY_ID: { key: ENV_KEYS.S3_ACCESS_KEY_ID, isSensitive: true },
  S3_SECRET_ACCESS_KEY: { key: ENV_KEYS.S3_SECRET_ACCESS_KEY, isSensitive: true },
  S3_BUCKET: { key: ENV_KEYS.S3_BUCKET, isSensitive: false },
  VAULT_ROOT: { key: ENV_KEYS.VAULT_ROOT, isSensitive: false },
};

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
