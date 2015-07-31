/**
 * Module dependencies
 * https://github.com/balderdashy/sails/blob/master/lib/router/req.js
 */
var util = require('util');
var _ = require('lodash');
var MockRes = require('mock-res');


/**
 * Ensure that response object has a minimum set of reasonable defaults
 * Used primarily as a test fixture.
 *
 * @api private
 * @idempotent
 */

module.exports = function buildResponse(req, _res) {
  _res = _res || {};
  req = req || {};

  var res;

  // If `_res` appears to be a stream (duck-typing), then don't try
  // and turn it into a mock stream again.
  if (typeof _res === 'object' && _res.end) {
    res = _res;
  } else {
    res = new MockRes()
    delete res.statusCode;
  }


  // Ensure res.headers and res.locals exist.
  res = _.extend(res, {
    locals: {},
    headers: {},
    _headers: {},
    _headerNames: {}
  });
  res = _.extend(res, _res);

  // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
  // (1) Providing a callback function (`_clientCallback`)
  //
  if (res._clientCallback) {
    res.on('finish', function() {
      return res._clientCallback(res);
    });
    res.on('error', function(err) {
      err = err || new Error('Error on response stream');
      res.statusCode = 500;
      res.body = err;
      return res._clientCallback(res);
    });
  }

  // Track whether headers have been written
  // (TODO: pull all this into mock-res via a PR)

  // res.writeHead() is wrapped in closure by the `on-header` module,
  // but it still needs the underlying impl
  res.writeHead = function( /* statusCode, [reasonPhrase], headers */ ) {
    // console.log('\n\n• res.writeHead(%s)', Array.prototype.slice.call(arguments));
    var statusCode = +arguments[0];
    var reasonPhrase = (function() {
      if (arguments[2] && _.isString(arguments[1])) {
        return arguments[1];
      }
      return undefined;
    })();
    var newHeaders = (function() {
      if (arguments[2] && _.isObject(arguments[2])) {
        return arguments[2];
      }
      return arguments[1];
    })();

    if (!statusCode) {
      throw new Error('`statusCode` must be passed to res.writeHead().');
    }
    // Set status code
    res.statusCode = statusCode;

    // Ensure `._headers` have been merged into `.headers`
    _.extend(res.headers, res._headers);

    if (newHeaders) {
      if (!_.isObject(newHeaders)) {
        throw new Error('`headers` must be passed to res.writeHead() as an object. Got: ' + util.inspect(newHeaders, false, null));
      }
      // Set new headers
      _.extend(res.headers, newHeaders);
    }
  };


  // Wrap res.write() and res.end() to get them to call writeHead()
  var prevWrite = res.write;
  res.write = function() {
    res.writeHead(res.statusCode, _.extend(res._headers, res.headers));
    // console.log('res.write():: called writeHead with headers=',_.extend(res._headers,res.headers));
    //prevWrite.apply(res, Array.prototype.slice.call(arguments));
  };
  var prevEnd = res.end;
  res.end = function() {
    res.writeHead(res.statusCode, _.extend(res._headers, res.headers));
    // console.log('our res.end() was triggered');
    // console.log('res.end():: called writeHead with headers=',_.extend(res._headers,res.headers));
    prevEnd.apply(res, Array.prototype.slice.call(arguments));
  };

  // res.status()
  res.status = res.status || function status_shim(statusCode) {
    res.statusCode = statusCode;
    return res;
  };

  // res.send()
  res.send = res.send || function send_shim() {
        var args = normalizeResArgs(arguments);

        // Don't allow users to respond/redirect more than once per request
        // TODO: prbly move this check to our `res.writeHead()` impl
        try {
          onlyAllowOneResponse(res);
        } catch (e) {
          if (req._sails && req._sails.log && req._sails.log.error) {
            req._sails.log.error(e);
            return;
          }
          // TODO: use debug()
          console.error(e);
          return;
        }

        // Ensure charset is set
        res.charset = res.charset || 'utf-8';

        // Ensure headers are set
        _.extend(res.headers, res._headers);

        // Ensure statusCode is set
        // (override `this.statusCode` if `statusCode` argument specified)
        res.statusCode = args.statusCode || res.statusCode || 200;

        // if a `_clientCallback` was specified, we'll skip the streaming stuff for res.send().
        if (res._clientCallback) {

          // Hard-code `res.body` rather than writing to the stream.
          // (but don't include body if it is empty)
          if (args.other) {
            res.body = args.other;
          }

          // End the `res` stream
          res.end();
          return;
        }

        // End the `res` stream.
        res.end();
      };

  // res.json()
  res.json = res.json || function json_shim() {
        var args = normalizeResArgs(arguments);
        return res.send(args.other, args.statusCode || res.statusCode || 200);
      };

  // res.render()
  res.render = res.render || function render_shim(relativeViewPath, locals, cb) {
        if (_.isFunction(arguments[1])) {
          cb = arguments[1];
          locals = {};
        }

        // TODO:
        // Instead of this shim, turn `sails.renderView` into something like
        // `sails.hooks.views.render()`, and then call it.
        return res.send(501, 'Not implemented in core yet');
      };

  // res.redirect()
  res.redirect = res.redirect || function redirect_shim() {
        var args = normalizeResArgs(arguments);

        var address = args.other;

        // Set location header
        res.set('Location', address);

        // address = this.get('Location');
        return res.send(args.statusCode || res.statusCode || 302, 'Redirecting to ' + encodeURI(address));
      };



  /**
   * res.set( headerName, value )
   *
   * @param {[type]} headerName [description]
   * @param {[type]} value   [description]
   */
  res.set = function(headerName, value) {
    res.headers = res.headers || {};
    res.headers[headerName] = value;
    return value;
  };

  /**
   * res.get( headerName )
   *
   * @param  {[type]} headerName [description]
   * @return {[type]}            [description]
   */
  res.get = function(headerName) {
    return res.headers && res.headers[headerName];
  };



  return res;


};


/**
 * As long as one of them is a number (i.e. a status code),
 * allows a 2-nary method to be called with flip-flopped arguments:
 *    method( [statusCode|other], [statusCode|other] )
 *
 * This avoids confusing errors & provides Express 2.x backwards compat.
 *
 * E.g. usage in res.send():
 *    var args    = normalizeResArgs.apply(this, arguments),
 *      body    = args.other,
 *      statusCode  = args.statusCode;
 *
 * @api private
 */

function normalizeResArgs(args) {

  // Traditional usage:
  // `method( other [,statusCode] )`
  var isNumeric = function(x) {
    return (+x === x);
  };
  if (isNumeric(args[0])) {
    return {
      statusCode: args[0],
      other: args[1]
    };
  } else return {
    statusCode: args[1],
    other: args[0]
  };
}


/**
 * NOTE: ALL RESPONSES (INCLUDING REDIRECTS) ARE PREVENTED ONCE THE RESPONSE HAS BEEN SENT!!
 * Even though this is not strictly required with sockets, since res.redirect()
 * is an HTTP-oriented method from Express, it's important to maintain consistency.
 *
 * @api private
 */

function onlyAllowOneResponse(res) {
  if (res._virtualResponseStarted) {
    throw new Error('Cannot write to response more than once');
  }
  res._virtualResponseStarted = true;
}
