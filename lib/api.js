const request = require('request');
const config = require(ROOT + '/config');

module.exports = {
    ethGasPrice: {
        request() {
            return new Promise((resolve, reject) => {
                let options = {
                    method: 'GET',
                    url: config.system.ethGasPriceApi
                };

                sendGetGasPrice(options, resolve, reject);
            })
        }
    },
    maticGasPrice: {
        request() {
            return new Promise((resolve, reject) => {
                let options = {
                    method: 'GET',
                    url: config.system.maticGasPriceApi
                };

                sendGetGasPrice(options, resolve, reject);
            })
        }
    }
};

function sendGetGasPrice(options, resolve, reject) {
    options.timeout = 1000 * 30;

    request(options, async (error, response, body) => {
        if (error) {
            logger.error('API call error: Request error. / req: ' + JSON.stringify(options) + ' / err: ' + JSON.stringify(error));
            return reject(error);
        }

        let json;
        try {
            if (typeof body === 'string' || body instanceof String)
                json = JSON.parse(body);
            else
                json = body;
        } catch (e) {
            logger.error('API call error: JSON Parse error. / req: ' + JSON.stringify(options) + ' / err: ' + e.message);
            return reject(e);
        }

        if (!json) {
            logger.error('API returns malformed json. / req: ' + JSON.stringify(options));
            return reject({message: 'API returns malformed json.'});
        } else if (!json.fast) {
            logger.error('API call error: API returns fail. / req: ' + JSON.stringify(options) + ' / err: ' + JSON.stringify(json));
            return reject({message: 'API returns fail. ' + JSON.stringify(json)});
        }

        resolve(json);
    });
}
