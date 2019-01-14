'use strict';

var Advertisement = require('./Advertisement');
var Browser = require('./Browser');
var ServiceType = require('./ServiceType');
var validate = require('./validate');
var resolve = require('./resolve');
var NetworkInterface = require('./NetworkInterface');

module.exports = {
  Advertisement: Advertisement,
  Browser: Browser,
  ServiceType: ServiceType,
  tcp: ServiceType.tcp,
  udp: ServiceType.udp,
  all: ServiceType.all,
  validate: validate,
  resolve: resolve.resolve,
  resolveA: resolve.resolveA,
  resolveAAAA: resolve.resolveAAAA,
  resolveSRV: resolve.resolveSRV,
  resolveTXT: resolve.resolveTXT,
  resolveService: resolve.resolveService
};