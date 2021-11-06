'use strict';

const Advertisement = require('./Advertisement');
const Browser = require('./Browser');
const ServiceType = require('./ServiceType');
const validate = require('./validate');
const resolve = require('./resolve');
const NetworkInterface = require('./NetworkInterface');

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