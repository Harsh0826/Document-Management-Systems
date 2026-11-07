import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: '',
      JWT_SECRET: 'test-jwt-secret-test-jwt-secret-test-jwt-secret',
      FILE_URL_SECRET: 'test-file-secret-test-file-secret-test-file',
      STORAGE_DRIVER: 'local',
      LOCAL_STORAGE_DIR: './.data/test-storage',
      BCRYPT_ROUNDS: '4',
      RUN_JOBS: 'false',
      SEED_ADMIN_EMAIL: 'admin@test.local',
      SEED_ADMIN_PASSWORD: 'Admin@12345',
      SEED_DEMO_DATA: 'false',
    },
  },
});
