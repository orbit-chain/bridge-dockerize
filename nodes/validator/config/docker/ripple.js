const settings = require("./settings");

module.exports = {
    ws: settings.Endpoints.Xrp && settings.Endpoints.Xrp.socket,
    host: settings.Endpoints.Xrp && settings.Endpoints.Xrp.rpc
};
