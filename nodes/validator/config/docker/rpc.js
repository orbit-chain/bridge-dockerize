const settings = require("./settings");

module.exports = {
    ETH_MAINNET_RPC: settings.Endpoints.Eth && settings.Endpoints.Eth.rpc,
    ETH_MAINNET_WS: settings.Endpoints.Eth && settings.Endpoints.Eth.socket,
    OCHAIN_RPC: settings.Endpoints.Orbit.rpc,
    OCHAIN_WS: settings.Endpoints.Orbit.socket,
};
