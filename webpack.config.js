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
  // Particle Accelerator runtime (Node.js CLI, runs outside VS Code)
  {
    name: 'particle-accelerator-runtime',
    target: 'node',
    mode: 'none',
    entry: {
      'cli': './src/particle-accelerator-runtime/cli.ts',
      'hooks/claude-pre-tool-use': './src/particle-accelerator-runtime/hooks/claudePreToolUse.ts',
      'hooks/codex-pre-tool-use': './src/particle-accelerator-runtime/hooks/codexPreToolUse.ts',
    },
    output: {
      path: path.resolve(__dirname, 'dist', 'particle-accelerator-runtime'),
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
  // Super Particle Accelerator runtime (Node.js hooks, runs outside VS Code)
  {
    name: 'super-particle-accelerator-runtime',
    target: 'node',
    mode: 'none',
    entry: {
      'hooks/claude-spa': './src/super-particle-accelerator-runtime/hooks/claudeSuperParticleAccelerator.ts',
      'hooks/codex-spa': './src/super-particle-accelerator-runtime/hooks/codexSuperParticleAccelerator.ts',
    },
    output: {
      path: path.resolve(__dirname, 'dist', 'super-particle-accelerator-runtime'),
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
