/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');
const webpack = require('webpack');

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
    plugins: [
      // Suppress optional native addon warnings from ws (used by socket.io-client).
      // These are performance-only and not needed in the VS Code extension context.
      new webpack.IgnorePlugin({ resourceRegExp: /^bufferutil$/ }),
      new webpack.IgnorePlugin({ resourceRegExp: /^utf-8-validate$/ }),
    ],
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
];
