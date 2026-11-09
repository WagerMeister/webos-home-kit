'use strict';
var providers = {tailscale: require('./tailscale')};

exports.get = function(id) {
  if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(providers, id)) {
    throw Error('Unsupported connection provider');
  }
  return providers[id];
};

exports.list = function() { return Object.keys(providers).map(function(id) { return providers[id]; }); };
