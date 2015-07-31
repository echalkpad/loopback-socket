var loopback = require('loopback');

module.exports = function(Orders) {
  Orders.observe('access', function access(ctx, next) {
    console.log('orders model access hook');

    var loopbackCtx = loopback.getCurrentContext();
    var io = loopbackCtx.get('io');
    io.broadcast('test room', 'test', {some: 'payload'});
    next();
  });
};
