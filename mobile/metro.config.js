const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const repositoryRoot = path.resolve(projectRoot, "..");
const config = getDefaultConfig(projectRoot);

// Phase 2 reuses the repository's pure Moniepoint parser core instead of
// maintaining a second mobile parser implementation.
config.watchFolders = [...(config.watchFolders ?? []), repositoryRoot];

module.exports = config;
