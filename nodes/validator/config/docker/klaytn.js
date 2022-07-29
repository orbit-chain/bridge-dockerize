const settings = require("./settings");

module.exports = {
    KLAYTN_ISKAS: settings.Endpoints.Klaytn && settings.Endpoints.Klaytn.isKas,
    KLAYTN_RPC: settings.Endpoints.Klaytn && settings.Endpoints.Klaytn.rpc,
    KLAYTN_WS: settings.Endpoints.Klaytn && settings.Endpoints.Klaytn.socket,
    KLAYTN_KAS: settings.Endpoints.Klaytn && settings.Endpoints.Klaytn.Kas
};
