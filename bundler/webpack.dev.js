const { merge } = require("webpack-merge");
const commonConfiguration = require("./webpack.common.js");
const portFinderSync = require("portfinder-sync");

module.exports = merge(commonConfiguration, {
  mode: "development",
  devServer: {
    port: portFinderSync.getPort(8080),
    static: {
      directory: "./src",
    },
    compress: true,
    open: true,
    https: false,
  },
});
