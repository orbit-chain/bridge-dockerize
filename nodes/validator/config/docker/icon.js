const settings = require("./settings");

module.exports = {
    api: settings.Endpoints.Icon && settings.Endpoints.Icon.api,
    debug: settings.Endpoints.Icon && settings.Endpoints.Icon.debug,
    version: settings.Endpoints.Icon && settings.Endpoints.Icon.version,
    nid: settings.Endpoints.Icon && settings.Endpoints.Icon.nid
};
