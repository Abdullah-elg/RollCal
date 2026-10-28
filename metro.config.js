// Sentry's Metro config: the Expo defaults plus debug IDs on the bundle, so
// crash reports can be matched to the source.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
