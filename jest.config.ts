import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'CommonJS',
          moduleResolution: 'Node',
        },
      },
    ],
  },
  // chalk@5 and ora@8 are ESM-only; map to CommonJS stubs for Jest.
  // Strip .js extensions from relative imports so CJS resolution finds the .ts source.
  moduleNameMapper: {
    '^chalk$': '<rootDir>/tests/__mocks__/chalk.cjs',
    '^ora$': '<rootDir>/tests/__mocks__/ora.cjs',
    '^(\\.{1,2}/.+)\\.js$': '$1',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts'],
  coverageThreshold: {
    global: {
      lines: 80,
      functions: 80,
      branches: 75,
      statements: 80,
    },
  },
  coverageDirectory: 'coverage',
};

export default config;
