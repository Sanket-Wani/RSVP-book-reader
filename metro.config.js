// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Force Metro to resolve CJS builds of packages that ship ESM with import.meta
// (which Metro's web bundler does not transform).
config.resolver.unstable_conditionNames = ['require', 'react-native', 'default'];

module.exports = config;
