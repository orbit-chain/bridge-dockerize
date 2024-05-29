const RippleAPI = require('ripple-lib').RippleAPI;
const config = require(ROOT + '/config');
const info = config.info.xrp;
const api = new RippleAPI({ server: info.ENDPOINT.socket, connectionTimeout: 60000 });

module.exports = api;
module.exports.getSequence = async address => {
  let accountInfo = await api.getAccountInfo(address).catch(e => {
      logger.xrp.error('getSequence error: ' + e.message);
  });

  if(!accountInfo)
      return;

  return accountInfo.sequence;
};

module.exports.getVaultInfos = async address => {
  const obj = await api.getAccountObjects(address).catch(e => {
    logger.xrp.error('getSequence error: ' + e.message);
  });
  if (!obj || obj.account_objects.length !== 1) {
    return;
  }
  return obj.account_objects[0];
}

module.exports.getBalance = async address => {
    let accountInfo = await api.getAccountInfo(address).catch(e => {
        logger.xrp.error('getSequence error: ' + e.message);
    });

    if(!accountInfo)
        return;

    return accountInfo.xrpBalance * 10 ** 6;
};
