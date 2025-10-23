const request = require('request');
const req = require("request-promise");
const config = require(ROOT + '/config');
const { VALIDATOR_MONITOR } = require(`${ROOT}/config/${process.env.PROFILE}/endpoints.js`);

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
    },
    validator: {
        post(path, params = {}) {
            if (!VALIDATOR_MONITOR || !VALIDATOR_MONITOR.ozys || !VALIDATOR_MONITOR.ozys.validator) {
                return new Promise((_, reject) => {
                    reject(new Error(`Validator Endpoint missing.`));
                });
            }
            let validator = VALIDATOR_MONITOR.ozys.validator;
            if (validator.endsWith('/')) {
                validator = validator.substring(0, validator.length-1);
            }
            if (path.startsWith('/')) {
                path = path.substring(1);
            }
            return req.post({
                headers: {'User-Agent': 'Request-Promise'},
                url: `${validator}/${path}`,
                body: params,
                json: true
            })
        }
    },
    orbit: {
        get(path, params = {}) {
            if (!VALIDATOR_MONITOR || !VALIDATOR_MONITOR.ozys || !VALIDATOR_MONITOR.ozys.orbit) {
                return new Promise((_, reject) => {
                    reject(new Error(`Orbit Endpoint missing.`));
                });
            }
            let orbit = VALIDATOR_MONITOR.ozys.orbit;
            if (orbit.endsWith('/')) {
                orbit = orbit.substring(0, orbit.length-1);
            }
            if (path.startsWith('/')) {
                path = path.substring(1);
            }
            return req.get(`${orbit}/${path}`, {
                qs: params,
                headers: {
                    'User-Agent': 'Request-Promise',
                },
                json: true,
            });
        },
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
