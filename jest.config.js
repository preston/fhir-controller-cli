/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['@swc/jest', {
      jsc: {
        parser: {
          syntax: 'typescript',
        },
        target: 'es2024',
      },
      module: {
        type: 'es6',
      },
    }],
    '^.+\\.js$': ['@swc/jest', {
      jsc: {
        parser: {
          syntax: 'ecmascript',
        },
        target: 'es2024',
      },
      module: {
        type: 'es6',
      },
    }],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(stream-chain|stream-json)/)',
  ],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
