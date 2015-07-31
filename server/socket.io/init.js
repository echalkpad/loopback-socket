module.exports = function(loopback, app) {
  var receiveIncomingRestIOMsg = require('./receive-incoming-rest-io-msg')(app);

  return function create(server) {
    var io = require('socket.io')(server);
    addToLoopback(io);
    io.on('connection', function(socket) {
      subscribeToRestEvents(socket);
    });
  }

  function subscribeToRestEvents(socket) {
    var httpMethods = [
      'get',
      'post',
      'put',
      'delete',
      'patch',
      'options',
      'head'
    ];

    httpMethods.forEach(function(httpMethod) {
      socket.on(httpMethod, function(reqCtx, cb) {
        receiveIncomingRestIOMsg({
          payload: reqCtx,
          socketIOClientCallback: cb,
          eventName: httpMethod,
          socket: socket
        });
      });
    });
  }

  function addToLoopback(io) {
    app.middleware('routes:before', function socketIO(req, res, next) {
      var loopbackContext = loopback.getCurrentContext();
      if (loopbackContext) {
        bindCustomMethodsToIO(io);
        loopbackContext.set('io', io);
      }
      next();
    });
  }

  function bindCustomMethodsToIO(io) {
    io.broadcast = broadcast;
  }

  function broadcast(roomName, eventName, data) {
    console.log('broadcast to ' + roomName);

    // If the 'eventName' is an object, assume the argument was omitted and
    // parse it as data instead.
    if (typeof eventName === 'object') {
      data = eventName;
      eventName = null;
    }

    if (!eventName) {
      eventName = 'message';
    }

    this.sockets.to(roomName).emit(eventName, data);
  }
};
