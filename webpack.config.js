/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');

/** @type {import('webpack').Configuration[]} */
module.exports = [
  // Extension host (Node.js context)
  {
    name: 'extension',
    target: 'node',
    mode: 'none',
    entry: './src/extension/extension.ts',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'extension.js',
      libraryTarget: 'commonjs2',
    },
    externals: {
      vscode: 'commonjs vscode',
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: 'ts-loader',
        },
      ],
    },
    devtool: 'nosources-source-map',
  },
  // Webview (browser context)
  {
    name: 'webview',
    target: 'web',
    mode: 'none',
    entry: './src/webview/index.tsx',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'webview.js',
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          use: 'ts-loader',
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader'],
        },
      ],
    },
    devtool: 'nosources-source-map',
  },
  // Local Boost runtime (Node.js CLI, runs outside VS Code)
  {
    name: 'local-boost-runtime',
    target: 'node',
    mode: 'none',
    entry: {
      'cli': './src/local-boost-runtime/cli.ts',
      'hooks/claude-pre-tool-use': './src/local-boost-runtime/hooks/claudePreToolUse.ts',
      'hooks/codex-pre-tool-use': './src/local-boost-runtime/hooks/codexPreToolUse.ts',
    },
    output: {
      path: path.resolve(__dirname, 'dist', 'local-boost-runtime'),
      filename: '[name].js',
      libraryTarget: 'commonjs2',
    },
    externals: {
      vscode: 'commonjs vscode',
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: 'ts-loader',
        },
      ],
    },
    optimization: {
      minimize: false,
    },
    devtool: 'nosources-source-map',
  },
];
