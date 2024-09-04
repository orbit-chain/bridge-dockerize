// Object.assign polyfill
const BigNumber = require("bignumber.js");
const PREC = 32;

if (typeof Object.assign != 'function') {
    (function () {
        Object.assign = function (target) {
            'use strict';
            if (target === undefined || target === null) {
                throw new TypeError('Cannot convert undefined or null to object');
            }

            var output = Object(target);
            for (var index = 1; index < arguments.length; index++) {
                var source = arguments[index];
                if (source !== undefined && source !== null) {
                    for (var nextKey in source) {
                        if (source.hasOwnProperty(nextKey)) {
                            output[nextKey] = source[nextKey];
                        }
                    }
                }
            }
            return output;
        };
    })();
}

// String.repeat polyfill
if (!String.prototype.repeat) {
    String.prototype.repeat = function(count) {
        'use strict';
        if (this == null) {
            throw new TypeError('can\'t convert ' + this + ' to object');
        }
        var str = '' + this;
        count = +count;
        if (count != count) {
            count = 0;
        }
        if (count < 0) {
            throw new RangeError('repeat count must be non-negative');
        }
        if (count == Infinity) {
            throw new RangeError('repeat count must be less than infinity');
        }
        count = Math.floor(count);
        if (str.length == 0 || count == 0) {
            return '';
        }
        // Ensuring count is a 31-bit integer allows us to heavily optimize the
        // main part. But anyway, most current (August 2014) browsers can't handle
        // strings 1 << 28 chars or longer, so:
        if (str.length * count >= 1 << 28) {
            throw new RangeError('repeat count must not overflow maximum string size');
        }
        var rpt = '';
        for (var i = 0; i < count; i++) {
            rpt += str;
        }
        return rpt;
    }
}

String.prototype.dclean = function(){ // 불필요한 0 제거
    var v = this.toString();
    var dot = v.indexOf('.'); if(dot === -1) dot = v.length;
    var num = v.substr(0, dot), dec = v.substr(dot + 1);

    num = num.replace(/^0+/, '');
    if(num.length === 0) num = '0';

    dec = dec.replace(/0+$/, '');
    if(dec.length > 0) num += '.' + dec;

    return num;
}

String.prototype.dprec = function(d){ // 강제로 소수점 이하 d자리 출력
    var v = this.toString().dclean();
    var dot = v.indexOf('.'); if(dot === -1) dot = v.length;
    var num = v.substr(0, dot), dec = v.substr(dot + 1);

    if(dec.length > d) dec = dec.substr(0, d);
    else dec += '0'.repeat(d - dec.length);

    if(d > 0) num += '.' + dec;

    return num;
}

String.prototype.dmove = function(d){ // 10^d 곱함
    var v = this.toString().dclean();
    var dot = v.indexOf('.'); if(dot === -1) dot = v.length;
    var num = v.substr(0, dot), dec = v.substr(dot + 1);

    d -= dec.length; num += dec;
    var l = num.length;

    if(d > 0) num += '0'.repeat(d);
    else if(d < 0){
        d = -d;
        if(d < l) num = num.substr(0, l - d) + '.' + num.substr(l - d);
        else num = '0.' + '0'.repeat(d - l) + num;
    }
    return num.dclean();
}

function dton(v, w){
    v = v.dclean();
    var vt = v.indexOf('.'); if(vt === -1) vt = v.length;
    var vd = v.substr(vt + 1).length;

    w = w.dclean();
    var wt = w.indexOf('.'); if(wt === -1) wt = w.length;
    var wd = w.substr(wt + 1).length;

    var d = (vd > wd ? vd : wd);

    return { d : d, v : v.dmove(d), w : w.dmove(d) };
}

String.prototype.dcomp = function(w){
    var o = dton(this.toString(), w);
    var d = o.d, v = o.v; w = o.w;

    var vl = v.length, wl = w.length;

    return (vl > wl ? 1 : vl < wl ? -1 : v > w ? 1 : v < w ? -1 : 0);
}

String.prototype.dadd = function(w){
    var o = dton(this.toString(), w);
    var d = o.d, v = o.v; w = o.w;

    var vl = v.length, wl = w.length, l = (vl > wl ? vl : wl);

    v = v.split('').reverse().join('');
    w = w.split('').reverse().join('');

    var res = [], x = 0;

    for(var i = 0; i < l; i++){
        var vi = (i < vl ? v.charCodeAt(i) - 48 : 0);
        var wi = (i < wl ? w.charCodeAt(i) - 48 : 0);

        var r = vi + wi + x;
        if(r > 9){ x = 1; r -= 10; } else x = 0;

        res.push(r);
    }

    if(x > 0) res.push(x);

    return res.reverse().join('').dmove(-d);
}

String.prototype.dsub = function(v, prec = PREC) {
    const ba = new BigNumber(this);
    const bb = new BigNumber(String(v));
    return ba.minus(bb).toFixed(prec).dclean();
}

String.prototype.dmul = function(w){
    var o = dton(this.toString(), w);
    var d = o.d, v = o.v; w = o.w;

    var vl = v.length, wl = w.length, l = vl + wl - 1;

    v = v.split('').reverse().join('');
    w = w.split('').reverse().join('');

    var res = []; for(var i = 0; i < l; i++) res.push(0);

    for(var i = 0; i < vl; i++){
        for(var j = 0; j < wl; j++){
            var vi = v.charCodeAt(i) - 48;
            var wi = w.charCodeAt(j) - 48;

            res[i + j] += vi * wi;
        }
    }

    for(var i = 0; i < l; i++){
        if(res[i] < 10) continue;

        var x = Math.floor(res[i] / 10);

        if(i + 1 == l) res.push(x); else res[i + 1] += x;
        res[i] -= x * 10;
    }

    return res.reverse().join('').dmove(-2 * d);
}

String.prototype.ddiv = function(w, prec){
    prec = prec ? prec : 40

    if(w.dcomp('0') === 0){
        throw 'Error: Divide by zero';
    }

    var o = dton(this.toString(), w);
    var v = o.v; w = o.w;

    var res = '', d = 0;

    while(v.dcomp(w) >= 0){ w += '0'; d++; }

    for(var i = 1; i <= d; i++){
        w = w.slice(0, -1);

        var c = 0;
        while(v.dcomp(w) >= 0){ v = v.dsub(w); c++; }

        res += c;
    }

    res += '.';

    for(var i = 1; i <= prec; i++){
        v += '0';

        var c = 0;
        while(v.dcomp(w) >= 0){ v = v.dsub(w); c++; }

        res += c;
    }

    return res.dclean();
}
