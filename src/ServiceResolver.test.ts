import { expect } from 'chai';
import { jest } from '@jest/globals';
import sinon from 'sinon';
import _ from 'lodash';

import { Packet } from './Packet';
import { AAAARecord, ARecord, PTRRecord, SRVRecord, TXTRecord } from './ResourceRecord';
import { RType } from './constants';
import { ServiceResolver } from './ServiceResolver';

import * as Fake from './test-mocks';
import { Query } from './Query';

jest.useFakeTimers();

describe('ServiceResolver', () => {
  const fullname = 'Instance (2)._service._tcp.local.';
  const target = 'Target.local.';
  const type = '_service._tcp.local.';

  const PTR  = new PTRRecord({name: type, PTRDName: fullname});
  const SRV  = new SRVRecord({name: fullname, target: target, port: 8000});
  const TXT  = new TXTRecord({name: fullname});
  const AAAA = new AAAARecord({name: target, address: '::1'});
  const A    = new ARecord({name: target, address: '1.1.1.1'});

  function harness(name = fullname) {
    const networkInterface = Fake.NetworkInterface();
    const cache = Fake.ExpRecCollection();
    const query = Fake.Query();
    
    networkInterface.cache = cache;

    class ServiceResolverWithMocks extends ServiceResolver {
      protected createQuery(): Query {
        return query;
      }
    }

    return {
      networkInterface,
      query,
      cache,
      resolver: new ServiceResolverWithMocks(name, networkInterface)
    }
  }

  beforeEach(() => sinon.resetHistory());

  describe('#constructor()', () => {
    it('should parse fullname / make new FSM', () => {
      const { resolver } = harness();

      expect(resolver.instance).to.equal('Instance (2)');
      expect(resolver.serviceType).to.equal('_service');
      expect(resolver.protocol).to.equal('_tcp');
      expect(resolver.tld).to.equal('local');
      expect(resolver.transition).to.be.a('function');
    });
  });


  describe('#service()', () => {
    it('should return the same obj each time (updated props)', () => {
      const { resolver } = harness();

      expect(resolver.service()).to.equal(resolver.service());
    });

    it('should return the right stuff', () => {
      const { resolver } = harness();

      expect(resolver.service()).to.eql({
        fullname : fullname,
        name     : 'Instance (2)',
        type     : {name: 'service', protocol: 'tcp'},
        domain   : 'local',
        host     : null,
        port     : null,
        addresses: [],
        txt      : {},
        txtRaw   : {},
      });
    });

    it('should remove service type underscore only if needed', () => {
      const name = 'Instance (2).service._tcp.local.';
      const { resolver } = harness(name);

      expect(resolver.service().type).to.eql({name: 'service', protocol: 'tcp'});
    });

    it('should freeze address/txt/txtRaw so they can\'t be modified', () => {
      const { resolver } = harness();
      resolver.txt = {};
      resolver.txtRaw = {};

      const service = resolver.service();
      service.addresses.push('something');
      service.txt.key = 'added!';
      service.txtRaw.key = Buffer.from('added!');

      expect(service.addresses).to.not.eql(resolver.addresses);
      expect(service.txt).to.not.eql(resolver.txt);
      expect(service.txtRaw).to.not.eql(resolver.txtRaw);
    });
  });


  describe('#once()', () => {
    it('should add a listener that gets removed after one use', function(done) {
      const { resolver } = harness();

      // should only get called once (or mocha errs)
      resolver.once('event', (one, two) => {
        expect(one).to.equal(1);
        expect(two).to.equal(2);
        done();
      });

      resolver.emit('event', 1, 2);
      resolver.emit('event');
    });
  });


  describe('#_addListeners()', () => {
    it('should listen to networkInterface and networkInterface cache', function(done) {
      const { resolver, networkInterface, cache } = harness();
      const allCalled = _.after(4, done);

      sinon.stub(resolver, 'transition').callsFake(allCalled);
      sinon.stub(resolver, '_onAnswer' ).callsFake(allCalled);
      sinon.stub(resolver, '_onReissue').callsFake(allCalled);
      sinon.stub(resolver, '_onExpired').callsFake(allCalled);

      resolver._removeListeners();
      resolver._addListeners();

      networkInterface.emit('answer');
      networkInterface.emit('error');
      cache.emit('reissue');
      cache.emit('expired');
    });
  });


  describe('#_onReissue()', () => {

    it('should ignore irrelevant records', () => {
      const { resolver } = harness();
      sinon.spy(resolver, 'handle');

      const ignore = new ARecord({name: 'ignore!'});
      resolver._onReissue(ignore);

      expect(resolver.handle).to.not.have.been.called;
    });

    it('should pass relevant records to handle fn (name)', () => {
      const { resolver } = harness();
      sinon.spy(resolver, 'handle');
      
      resolver._onReissue(SRV);

      expect(resolver.handle).to.have.been.calledWith('reissue', SRV);
    });

    it('should pass relevant records to handle fn (target)', () => {
      const { resolver } = harness();
      sinon.spy(resolver, 'handle');
      
      resolver.target = 'Target.local.';
      resolver._onReissue(A);

      expect(resolver.handle).to.have.been.calledWith('reissue', A);
    });

    it('should pass relevant records to handle fn (PTR)', () => {
      const { resolver } = harness();
      sinon.spy(resolver, 'handle');
      
      resolver._onReissue(PTR);

      expect(resolver.handle).to.have.been.calledWith('reissue', PTR);
    });
  });


  describe('#_onExpired()', () => {
    it('should ignore irrelevant records', () => {
      const { resolver } = harness();
      sinon.stub(resolver, 'transition');

      const ignore = new ARecord({name: 'ignore!'});
      resolver._onExpired(ignore);

      expect(resolver.transition).to.not.have.been.called;
    });

    it('should stop if PTR or SRV expires', () => {
      const { resolver } = harness();
      sinon.stub(resolver, 'transition');

      resolver._onExpired(SRV);
      resolver._onExpired(PTR);

      expect(resolver.transition).to.have.been
        .calledTwice
        .calledWith('stopped');
    });

    it('should remove dying addresses and unresolve if needed', () => {
      const { resolver } = harness();
      sinon.stub(resolver, 'transition');

      resolver.target = 'Target.local.';
      resolver.addresses = ['1.1.1.1', '::1'];

      resolver._onExpired(A);

      expect(resolver.transition).to.not.have.been.called;
      expect(resolver.addresses).to.eql(['::1']);

      resolver._onExpired(AAAA);

      expect(resolver.transition).to.have.been.calledWith('unresolved');
      expect(resolver.addresses).to.be.empty;
    });

    it('should clear TXT data if TXT record dies', () => {
      const { resolver } = harness();
      sinon.stub(resolver, 'transition');

      resolver._onExpired(TXT);

      expect(resolver.transition).to.been.calledWith('unresolved');
    });
  });


  describe('#_processRecords()', () => {
    it('should handle SRV changes', () => {
      const { resolver } = harness();
      resolver.port = 9999;
      resolver.target = 'Target';
      resolver.addresses = ['1.1.1.1'];

      expect(resolver._processRecords([SRV])).to.be.true;
      expect(resolver.port).to.equal(8000);
      expect(resolver._processRecords([SRV])).to.be.false; // unchanged

      const change = new SRVRecord({
        name: fullname,
        target: 'changed.local.',
      });

      expect(resolver._processRecords([change])).to.be.true;
      expect(resolver.target).to.equal('changed.local.');
      expect(resolver.addresses).to.be.empty;
    });

    it('should handle address record changes', () => {
      const { resolver } = harness();
      resolver.target = target;
      resolver.addresses = ['1.1.1.1'];

      const more = new ARecord({name: target, address: '2.2.2.2'});

      resolver._processRecords([A]);
      expect(resolver.addresses).to.eql(['1.1.1.1']); // unchanged

      resolver._processRecords([AAAA, more]);
      expect(resolver.addresses).to.eql(['1.1.1.1', '2.2.2.2', '::1']);
    });

    it('should handle TXT record changes', () => {
      const { resolver } = harness();
      resolver.txt = {};
      resolver.txtRaw = {};

      const change = new TXTRecord({name: fullname, txt: {key: 'value'}});

      expect(resolver._processRecords([change])).to.be.true;
      expect(resolver.txt).to.eql(change.txt);
      expect(resolver.txtRaw).to.eql(change.txtRaw);

      expect(resolver._processRecords([change])).to.be.false; // unchanged
    });

    it('should ignore irrelevant records', () => {
      const { resolver } = harness();
      const ignore = new PTRRecord({name: 'ignore!'});

      expect(resolver._processRecords([ignore])).to.be.false;
    });

    it('should ignore TTL=0 goodbye records', () => {
      const { resolver } = harness();

      const goodbye = SRV.clone();
      goodbye.ttl = 0;

      expect(resolver._processRecords([goodbye])).to.be.false;
      expect(resolver.target).to.be.null;
    });
  });


  describe('#_queryForMissing()', () => {
    it('should get missing SRV/TXTs', () => {
      const { resolver, query } = harness();
      sinon.stub(resolver, 'handle');

      resolver.target = null;
      resolver._queryForMissing();

      expect(query.add).to.have.been.calledOnce;
      expect(query.add.firstCall.args[0]).to.have.lengthOf(2);
    });

    it('should get missing A/AAAAs', () => {
      const { resolver, query } = harness();
      sinon.stub(resolver, 'handle');
      
      resolver.target = 'Target.local.';
      resolver.txtRaw = {};
      resolver._queryForMissing();

      expect(query.add).to.have.been.calledOnce;
      expect(query.add.firstCall.args[0]).to.have.lengthOf(2);
    });

    it('should get missing TXT/A/AAAAs', () => {
      const { resolver, query } = harness();
      sinon.stub(resolver, 'handle');
      
      resolver.target = 'Target.local.';
      resolver._queryForMissing();

      expect(query.add).to.have.been.calledOnce;
      expect(query.add.firstCall.args[0]).to.have.lengthOf(3);
    });

    it('should check interface caches before sending queries', () => {
      const { resolver, query, networkInterface, cache } = harness();
      sinon.stub(resolver, 'handle');
      
      cache.find.returns([TXT]);

      resolver.target = 'Target.local.';
      resolver.addresses = ['1.1.1.1'];
      resolver._queryForMissing(); // <- will try to find TXT record

      expect(resolver.handle).to.have.been.calledWith('incomingRecords', [TXT]);
      expect(query.add).to.not.have.been.called;

      cache.find.resetBehavior();
    });
  });


  describe('Sanity checks:', () => {
    it('should resolve w/ all needed starting records', function(done) {
      const { resolver } = harness();

      resolver.once('resolved', () => {
        expect(resolver.addresses).to.eql(['1.1.1.1', '::1']);
        expect(resolver.target).to.equal(target);
        expect(resolver.port).to.equal(8000);
        expect(resolver.txt).to.eql({});
        expect(resolver.isResolved()).to.be.true;

        done();
      });

      expect(resolver.isResolved()).to.be.false;
      resolver.start([PTR, SRV, TXT, A, AAAA]);
    });


    it('should not need/ask for AAAA in this case', () => {
      const { resolver } = harness();
      const createQuery = sinon.spy(resolver as any, 'createQuery');

      resolver.start([SRV, TXT, A]);

      expect(createQuery).to.not.have.been.called;
    });


    it('should ask for address records', () => {
      const { resolver, query } = harness();
      resolver.start([PTR, SRV, TXT]);

      expect(query.add).to.have.been.calledWithMatch([
        {name: target, qtype: RType.A},
        {name: target, qtype: RType.AAAA},
      ]);
      resolver.stop();
    });


    it('should check networkInterface caches for answers first', () => {
      const { resolver, query, cache } = harness();

      cache.find.returns([A]);
      resolver.start([PTR, SRV, TXT]);

      expect(query.add).to.have.been.calledWithMatch([
        {name: target, qtype: RType.AAAA},
      ]);

      cache.find.resetBehavior();
    });


    it('should ask for SRV and ignore A/AAAAs (target unknown)', () => {
      const { resolver, query } = harness();
      
      resolver.start([TXT, A, AAAA]);

      expect(resolver.target).to.be.null;
      expect(resolver.addresses).to.be.empty;

      expect(query.add).to.have.been.calledWithMatch([
        {name: fullname, qtype: RType.SRV}
      ]);
      resolver.stop();
    });


    it('should resolve when needed answers come', function(done) {
      const { resolver, networkInterface } = harness();
      resolver.start([SRV, TXT]);
      resolver.on('resolved', done);

      const packet = new Packet();
      packet.setAnswers([A, AAAA]);

      networkInterface.emit('answer', packet);
    });


    it('should change queries if needed info changes', () => {
      const { resolver, query, networkInterface } = harness();

      resolver.start([SRV, TXT]); // unresolved

      const updated = new SRVRecord({
        name: fullname,
        target: 'Updated Target.local.',
        port: 8000,
      });

      const packet = new Packet();
      packet.setAnswers([updated]);

      networkInterface.emit('answer', packet);

      expect(query.add).to.have.been.calledWithMatch([
        {name: 'Updated Target.local.', qtype: RType.A},
        {name: 'Updated Target.local.', qtype: RType.AAAA},
      ]);
      resolver.stop();
    });


    it('should unresolve w/ incomplete changes (new SRV no A/AAAA)', () => {
      const { resolver, networkInterface } = harness();

      resolver.start([SRV, TXT, A, AAAA]); // is now resolved

      const updated = new SRVRecord({
        name: fullname,
        target: 'Updated Target.local.',
        port: 8000,
      });

      const packet = new Packet();
      packet.setAnswers([updated]);

      networkInterface.emit('answer', packet);

      expect(resolver.state).to.equal('unresolved');
      resolver.stop();
    });


    it('should notify when service info gets updated', function(done) {
      const { resolver, networkInterface } = harness();
      
      resolver.start([SRV, TXT, A, AAAA]); // is now resolved

      resolver.on('updated', () => {
        expect(resolver.port).to.equal(1111);
        done();
      });

      const updated = new SRVRecord({
        name: fullname,
        target: target,
        port: 1111, // <- new port
      });

      const packet = new Packet();
      packet.setAnswers([updated]);

      networkInterface.emit('answer', packet);
    });


    it('should query for updates as records get stale', () => {
      const { resolver, query, cache } = harness();

      resolver.start([SRV, TXT, A, AAAA]); // is now resolved

      cache.emit('reissue', SRV);
      cache.emit('reissue', TXT);
      cache.emit('reissue', A);

      // wait for batch timer
      jest.advanceTimersByTime(1000);

      expect(query.add).to.have.been.calledWithMatch([
        {name: fullname, qtype: RType.SRV},
        {name: type, qtype: RType.PTR},
        {name: fullname, qtype: RType.TXT},
        {name: target, qtype: RType.A},
      ]);
    });


    it('should query for reissue updates when unresolved too', () => {
      const { resolver, query, cache } = harness();

      resolver.start([SRV, TXT, A, AAAA]); // is now resolved

      cache.emit('expired', TXT);
      expect(resolver.isResolved()).to.be.false;

      cache.emit('reissue', SRV);
      cache.emit('reissue', A);

      // wait for batch timer
      jest.advanceTimersByTime(1000);

      expect(query.add).to.have.been.calledWithMatch([
        {name: fullname, qtype: RType.SRV},
        {name: type, qtype: RType.PTR},
        {name: target, qtype: RType.A},
      ]);
    });


    it('should go down if the SRV dies (notified from cache)', function(done) {
      const { resolver, cache } = harness();

      resolver.start([SRV, TXT, A, AAAA]); // is now resolved
      resolver.on('down', done);

      cache.emit('expired', SRV);
    });


    it('should go down if the SRV dies, even if unresolved', function(done) {
      const { resolver, cache } = harness();

      resolver.start();
      resolver.on('down', done);

      cache.emit('expired', SRV);
    });


    it('should ignore interface and cache events in stopped state', () => {
      const { resolver, networkInterface, cache } = harness();
      sinon.stub(resolver, '_onAnswer');
      sinon.stub(resolver, '_onReissue');
      resolver.stop();

      networkInterface.emit('answer');
      cache.emit('reissue');

      expect(resolver._onAnswer).to.not.have.been.called;
      expect(resolver._onReissue).to.not.have.been.called;
    });


    it('should fail and stop if it can\'t resolve within 10s', () => {
      const { resolver } = harness();

      resolver.start();
      expect(resolver.state).to.equal('unresolved');

      jest.advanceTimersByTime(10 * 1000);
      expect(resolver.state).to.equal('stopped');
    });


    it('stopped state should be terminal', () => {
      const { resolver } = harness();
      resolver.stop();
      resolver.start();

      expect(resolver.state).to.equal('stopped');
    });
  });

});
