const settings = require("./settings");

let obj = {};
if (settings.chainList.includes('heco')) {
    obj.HECO_RPC = settings.Endpoints.Heco.rpc;
    obj.HECO_WS = settings.Endpoints.Heco.socket;
}

module.exports = Object.assign({}, obj);
