/**
 * The oldest host stack @nest-my-admin/core supports: the lower bounds of its peer ranges.
 * `bun run compat` runs the core suite on it; pack:smoke's CommonJS consumer installs it.
 */
export const OLDEST_SUPPORTED: Readonly<Record<string, string>> = {
  '@nestjs/common': '11.0.0',
  '@nestjs/core': '11.0.0',
  '@nestjs/platform-express': '11.0.0',
  '@nestjs/testing': '11.0.0',
  '@nestjs/typeorm': '11.0.0',
  typeorm: '0.3.20',
};
