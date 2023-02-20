var querystring = require('querystring');
var libRequest = require('request');

class Request {
    constructor(host) {
        if (!host.startsWith("http://") && !host.startsWith("https://"))
            host = "http://" + host;
        this.host = host;
    }

    _generalErrorHandler(next, error, response, body) {
        if (!error && response.statusCode == 200) {
            if (body.error) {
                next(body.error);
                return true;
            }
            return false;
        } else {
            next(error);
            return true;
        }
    }

    rpc(method, params, id, callback) {
        var headers = {
            'content-type': 'application/json'
        };

        id = (id || '1').toString();
        var options = {
            url: this.host,
            method: 'POST',
            headers: headers,
            json: {
                "jsonrpc": "2.0",
                "id": id,
                "method": method,
                "params": params
            }
        };

        if (callback) {
            libRequest(options, function (error, response, body) {
                if (this._generalErrorHandler(callback, error, response, body)) {
                    return
                }
                callback(null, body.result);
            });
        } else {
            return new Promise((resolve, reject) => {
                libRequest(options, function (error, response, body) {
                    if (this._generalErrorHandler(reject, error, response, body)) {
                        return
                    }
                    resolve(body.result);
                });
            });
        }

    }

    httpPost(path, json, callback) {
        var headers = {
            'content-type': 'application/json',
            'User-Agent': 'ova-request/1.0'
        };
        var options = {
            url: this.host + path,
            method: 'POST',
            headers: headers,
            json: json
        };

        if (callback) {
            libRequest(options, (error, response, body) => {
                if (this._generalErrorHandler(callback, error, response, body)) {
                    return
                }
                callback(null, body);
            });
        } else {
            return new Promise((resolve, reject) => {
                libRequest(options, (error, response, body) => {
                    if (this._generalErrorHandler(reject, error, response, body)) {
                        console.log(path, json)
                        return
                    }
                    resolve(body);
                });
            });
        }
    }

    httpGet(path, callback) {
        var headers = {
            'User-Agent': 'ova-request/1.0'
        };
        var options = {
            url: this.host + path,
            headers: headers
        };
        if (callback) {
            libRequest.get(options, (error, response, body) => {
                if (this._generalErrorHandler(callback, error, response, body)) {
                    return
                }
                callback(null, body);
            });
        } else {
            return new Promise((resolve, reject) => {
                libRequest.get(options, (error, response, body) => {
                    if (this._generalErrorHandler(reject, error, response, body)) {
                        console.log(path, error)
                        return
                    }
                    resolve(body);
                });
            });
        }
    }

    monitor(title, message, key, error) {

        var form = {
            title: title,
            message: message,
            key: key,
            error: error
        };


        var formData = querystring.stringify(form);
        var contentLength = formData.length;

        libRequest({
            headers: {
                'Content-Length': contentLength,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            uri: this.host + 'api/direct',
            body: formData,
            method: 'POST'
        }, function (err, res, body) {
            if (err || !res || res.statusCode != 200 || !body) {
                logger.error('Monitor direct Error');
                logger.error(err);
                return;
            }
            try {
                var result = JSON.parse(body);
                if (result.result != "success") {
                    logger.error('Monitor body Error');
                    logger.error(body);
                }
            } catch (e) {
                logger.error('Monitor body Error');
                logger.error(body);
                return;
            }


        });
    }
}
module.exports = Request;