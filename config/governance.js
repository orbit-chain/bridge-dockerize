const settings = require(`./${process.env.PROFILE}/${process.env.CHAIN}`);

module.exports = {
    chain: settings.bridge_address.governance.chain,
    address: settings.bridge_address.governance.address,
    bytes: settings.bridge_address.governance.bytes,
    id: settings.bridge_address.governance.id,
};
