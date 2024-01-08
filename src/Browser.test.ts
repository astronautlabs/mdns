import { expect } from 'chai';
import sinon from 'sinon';

import { ServiceType } from './ServiceType';
import { PTRRecord } from './ResourceRecord';
import { Browser } from './Browser';
import { NetworkInterface } from './NetworkInterface';
import { ServiceResolver } from './ServiceResolver';

import * as Fake from './test/Fake';

describe('Browser', function() {
  beforeEach(() => sinon.resetHistory());
  
  function harness(type: any, options?: { domain?: string; interface?: string; maintain?: boolean; resolve?: boolean; name?: string; }) {
    const intf = Fake.NetworkInterface();
    const query = Fake.Query();
    const resolver = Fake.ServiceResolver();

    class BrowserWithMocks extends Browser {
      protected createServiceResolver(name: string): ServiceResolver {
        return <any>resolver;
      }

      protected resolveNetworkInterface(name?: string): NetworkInterface {
        return intf;
      }

      protected createQuery() {
        return query;
      }
    }

    return {
      networkInterface: intf,
      query,
      resolver,
      browser: new BrowserWithMocks(type, options)
    }
  }

  describe('#constructor()', function() {
    it('should accept service param as a ServiceType (no throw)', function() {
      harness(new ServiceType('_http._tcp'));
    });

    it('should accept service param as an object (no throw)', function() {
      harness({name: '_http', protocol: '_tcp'});
    });

    it('should accept service param as a string (no throw)', function() {
      harness('_http._tcp');
    });

    it('should accept service param as an array (no throw)', function() {
      harness(['_http', '_tcp']);
    });

    it('should be ok with service enumerators (no throw)', function() {
      harness('_services._dns-sd._udp');
    });

    it('should throw on invalid service types', function() {
      expect(() => harness('gunna throw')).to.throw(Error);
    });

    it('should throw on multiple subtypes', function() {
      expect(() => harness(['_http', '_tcp', 'sub1', 'sub2'])).to.throw(Error);
    });
  });


  describe('#start()', function() {
    it('should return this', function() {
      const { browser } = harness('_http._tcp');
      sinon.stub(browser, '_startQuery');

      expect(browser.start()).to.equal(browser);
    });

    it('should bind interface & start queries', function(done) {
      const { browser, networkInterface } = harness('_http._tcp');

      sinon.stub(browser, '_startQuery').callsFake(() => {
        expect(networkInterface.bind).to.have.been.called;
        done();
      });

      browser.start();
    });

    it('should return early if already started', function(done) {
      const { browser } = harness('_http._tcp');
      sinon.stub(browser, '_startQuery');

      browser.start();
      browser.start(); // <-- does nothing

      // wait for promises
      setTimeout(() => {
        expect(browser._startQuery).to.have.been.calledOnce;
        done();
      }, 10);
    });

    it('should run _onError on startup errors', function(done) {
      const { browser } = harness('_http._tcp');
      sinon.stub(browser, '_startQuery').throws(new Error())

      browser.on('error', () => done());
      browser.start();
    });
  });


  describe('#stop()', function() {
    it('should remove listeners, stop resolvers, queries, & interfaces', function() {
      const { browser, networkInterface } = harness('_http._tcp');

      const resolver_1 = Fake.ServiceResolver();
      const resolver_2 = Fake.ServiceResolver();
      (browser as any)._resolvers['mock entry #1'] = resolver_1;
      (browser as any)._resolvers['mock entry #2'] = resolver_2;

      browser.stop();

      expect(resolver_1.stop).to.have.been.called;
      expect(resolver_2.stop).to.have.been.called;
      expect(networkInterface.stopUsing).to.have.been.called;
      expect(browser.list()).to.be.empty;
    });
  });


  describe('#list()', function() {
    it('should return services that are currently active', function() {
      const { browser } = harness('_http._tcp');
      const service = {};

      const resolved = Fake.ServiceResolver();
      resolved.isResolved.returns(false);
      resolved.service.returns(service);

      const unresolved = Fake.ServiceResolver();
      resolved.isResolved.returns(true);
      resolved.service.returns({});

      (browser as any)._resolvers['resolved service'] = resolved;
      (browser as any)._resolvers['unresolved service'] = unresolved;

      expect(browser.list()).to.eql([service]);
    });

    it('should return services types that are currently active', function() {
      const { browser } = harness('_services._dns-sd._udp');

      const recordName = '_http._tcp.local.';
      (browser as any)._serviceTypes[recordName] = {name: 'http', protocol: 'tcp'};

      expect(browser.list()).to.eql([{name: 'http', protocol: 'tcp'}]);
    });
  });


  describe('#_onError()', function() {
    it('should call stop and emit the error', function(done) {
      const { browser, networkInterface } = harness('_http._tcp');
      sinon.stub(browser, 'stop');

      browser.on('error', () => {
        expect(browser.stop).to.have.been.called;
        done();
      });

      browser.start();

      networkInterface.emit('error', new Error());
    });
  });


  describe('#_startQuery()', function() {
    it('should query for individual services', function() {
      const { browser, query } = harness('_http._tcp');

      browser._startQuery();

      expect(query.add).to.have.been.calledWithMatch({
        name: '_http._tcp.local.',
        qtype: 12,
      });
    });

    it('should query for service subtypes', function() {
      const { browser, query } = harness('_http._tcp,subtype');

      browser._startQuery();

      expect(query.add).to.have.been.calledWithMatch({
        name: 'subtype._sub._http._tcp.local.',
        qtype: 12,
      });
    });

    it('should query for available service types', function() {
      const { browser, query } = harness('_services._dns-sd._udp');

      browser._startQuery();

      expect(query.add).to.have.been.calledWithMatch({
        name: '_services._dns-sd._udp.local.',
        qtype: 12,
      });
    });
  });


  describe('#_addServiceType()', function() {
    const PTR = new PTRRecord({
      name: '_services._dns-sd._udp.local.',
      PTRDName: '_http._tcp.local.',
    });

    it('should add new service types', function(done) {
      const { browser, query } = harness('_services._dns-sd._udp')

      browser
        .on('serviceUp', (type) => {
          expect(browser.list()).to.not.be.empty;
          expect(browser.list()[0]).to.eql({name: 'http', protocol: 'tcp'});
          expect(type).eql({name: 'http', protocol: 'tcp'});
          done();
        })
        .start();

      // wait for promises to resolve first
      setTimeout(() => query.emit('answer', PTR), 10);
    });

    it('should ignore PTRs with TTL=0', function(done) {
      const { browser, query } = harness('_services._dns-sd._udp');
      const goodbye = PTR.clone();

      goodbye.ttl = 0;

      browser
        .on('serviceUp', () => { throw new Error('bad!'); })
        .start();

      // wait for promises to resolve first
      setTimeout(() => query.emit('answer', goodbye), 10);

      setTimeout(() => {
        expect(browser.list()).to.be.empty;
        done();
      }, 10);
    });

    it('should answer that have already been found', function(done) {
      const { browser, query } = harness('_services._dns-sd._udp')

      browser
        .start();

      // wait for promises to resolve first
      setTimeout(() => query.emit('answer', PTR), 10);
      setTimeout(() => query.emit('answer', PTR), 10); // <-- ignored

      setTimeout(() => {
        expect(browser.list()).to.have.lengthOf(1);
        done();
      }, 10);
    });

    it('should do nothing if already stopped', function(done) {
      const { browser, query } = harness('_services._dns-sd._udp');

      browser.start();
      browser.stop();

      // wait for promises to resolve first
      setTimeout(() => query.emit('answer', PTR), 10); // <-- ignored

      setTimeout(() => {
        expect(browser.list()).to.be.empty;
        done();
      }, 10);
    });
  });


  describe('#_addService()', function() {
    const PTR = new PTRRecord({
      name: '_http._tcp.local.',
      PTRDName: 'Instance._http._tcp.local',
    });

    it('should only emit instance names with resolve = false', function(done) {
      const { browser, query } = harness('_http._tcp', {resolve: false});

      browser
        .on('serviceUp', (name) => {
          expect(name).to.equal('Instance');
          done();
        })
        .start();

      // wait for promises to resolve first
      setTimeout(() => query.emit('answer', PTR), 10);
    });

    it('should not maintain resovers if maintain = false', function(done) {
      const { browser, resolver, query } = harness('_http._tcp', {maintain: false});

      browser
        .on('serviceUp', () => {
          expect(resolver.stop).to.have.been.called;
          done();
        })
        .start();

      // wait for promises to resolve first
      setTimeout(() => query.emit('answer', PTR), 10);
      setTimeout(() => resolver.emit('resolved'), 10);
    });

    it('should emit services when they are resolved/change/down', function(done) {
      const { browser, resolver, query } = harness('_http._tcp');
      let obj;
      
      resolver.service.returns({});
      browser
        .on('serviceUp', (service) => {
          expect(service).to.be.a('object');
          obj = service;
          resolver.emit('updated');
        })
        .on('serviceChanged', (service) => {
          expect(service).to.equal(obj);
          resolver.emit('down');
        })
        .on('serviceDown', (service) => {
          expect(service).to.equal(obj);
          done();
        })
        .start();

      // wait for promises to resolve first
      setTimeout(() => query.emit('answer', PTR), 10);
      setTimeout(() => resolver.emit('resolved'), 10);
    });

    it('should not emit serviceDown if service has never resovled', function(done) {
      const { browser, resolver, query } = harness('_http._tcp');

      browser
        .on('serviceUp', () => { throw new Error('bad'); })
        .start();

      // wait for promises to resolve first
      setTimeout(() => query.emit('answer', PTR), 10);
      setTimeout(() => resolver.emit('down'), 10);

      setTimeout(() => {
        expect(browser.list()).to.be.empty;
        done();
      }, 10);
    });

    it('should ignore already known instance answers', function(done) {
      const { browser, query, resolver } = harness('_http._tcp');
      const createServiceResolver = sinon.spy(browser as any, 'createServiceResolver')

      // done x2 would throw:
      browser.on('serviceUp', () => {
        expect(createServiceResolver).to.have.been.calledOnce;
        done();
      });

      browser.start();

      // wait for promises to resolve first
      setTimeout(() => query.emit('answer', PTR), 10);
      setTimeout(() => query.emit('answer', PTR), 10);
      setTimeout(() => resolver.emit('resolved'), 10);
    });

    it('should ignore answers with TTL=0', function(done) {
      const { browser, query } = harness('_http._tcp');
      browser.start();

      const goodbye = PTR.clone();
      goodbye.ttl = 0;
      const createServiceResolver = sinon.spy(browser as any, 'createServiceResolver');
      
      // wait for promises to resolve first
      setTimeout(() => query.emit('answer', goodbye), 10);

      setTimeout(() => {
        expect(createServiceResolver).to.not.have.been.called;
        done();
      }, 10);
    });

    it('should do nothing if already stopped', function(done) {
      const { browser, query } = harness('_http._tcp');
      browser.start();
      browser.stop();

      const createServiceResolver = sinon.spy(browser as any, 'createServiceResolver');

      // wait for promises to resolve first
      setTimeout(() => query.emit('answer', PTR), 10);

      setTimeout(() => {
        expect(createServiceResolver).to.not.have.been.called;
        done();
      }, 10);
    });
  });

});
