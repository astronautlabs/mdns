import { expect } from 'chai';
import sinon from 'sinon';
import _ from 'lodash';

import { Packet } from './Packet';
import { NSECRecord, PTRRecord, ResourceRecord, SRVRecord, TXTRecord } from './ResourceRecord';
import { QueryRecord } from './QueryRecord';
import { RType } from './constants';
import { Responder } from './Responder';
import { jest } from '@jest/globals';

import * as Fake from './test-mocks';
import { Probe } from './Probe';
import { GoodbyeResponse, MulticastResponse, UnicastResponse } from './Response';

jest.useFakeTimers();

describe('Responder constructor', () => {
  const networkInterface = Fake.NetworkInterface();

  const PTR = new PTRRecord({name: '_service._tcp.local.'});
  const SRV = new SRVRecord({name: 'Instance 1._service._tcp.local.'});
  const TXT = new TXTRecord({name: 'Bad!'});

  describe('#constructor()', () => {
    it('should parse instance name from records', () => {
      const records = [PTR, SRV];
      const responder = new Responder(networkInterface, records);

      expect(responder._fullname).to.equal('Instance 1._service._tcp.local.');
      expect(responder._instance).to.equal('Instance 1');
    });

    it('should throw if records have 0 unique instance names', () => {
      const records = [PTR];

      expect(() => new Responder(networkInterface, records)).to.throw(Error);
    });

    it('should throw if records have > 1 unique instance name', () => {
      const records = [PTR, SRV, TXT];

      expect(() => new Responder(networkInterface, records)).to.throw(Error);
    });

    it('should throw if parsing name from records fails', () => {
      const records = [TXT];

      expect(() => new Responder(networkInterface, records)).to.throw(Error);
    });

    it('should return a new Responder FSM', () => {
      const records = [SRV];

      expect((new Responder(networkInterface, records)).transition).to.be.a('function');
    });
  });
});


describe('Responder', () => {
  function harness(records: ResourceRecord[], bridgeable?: ResourceRecord[]) {
    const networkInterface = Fake.NetworkInterface();
    const cache = Fake.ExpRecCollection()
    const response = Fake.MulticastResponse();
    const unicast  = Fake.UnicastResponse();
    const goodbye  = Fake.Goodbye();
    const probe    = Fake.Probe();

    cache.hasConflictWith.returns(false);
    networkInterface.cache = cache;

    class ResponderWithMocks extends Responder {
      protected createProbe(): Probe { return probe; }
      protected createGoodbyeResponse(): GoodbyeResponse { return goodbye; }
      protected createMulticastResponse(): MulticastResponse { return response; }
      protected createUnicastResponse(): UnicastResponse { return unicast; }
    }

    return {
      networkInterface,
      cache,
      response,
      unicast,
      goodbye,
      probe,
      responder: new ResponderWithMocks(networkInterface, records, bridgeable)
    }
  }

  const service = '_http._tcp.local.';
  const fullname = 'Instance._http._tcp.local.';

  // records on interface 1
  const PTR_1  = new PTRRecord({name:  service, PTRDName: fullname});
  const SRV_1  = new SRVRecord({name:  fullname, target: '1'});
  const TXT_1  = new TXTRecord({name:  fullname});
  const NSEC_1 = new NSECRecord({name: fullname});

  // records on interface 2
  const PTR_2  = new PTRRecord({name:  service, PTRDName: fullname});
  const SRV_2  = new SRVRecord({name:  fullname, target: '2'});
  const TXT_2  = new TXTRecord({name:  fullname});
  const NSEC_2 = new NSECRecord({name: fullname});

  // test responder uses records for both networkInterface
  const records = [PTR_1, SRV_1, TXT_1, NSEC_1];
  const bridgeable = [PTR_1, SRV_1, TXT_1, NSEC_1, PTR_2, SRV_2, TXT_2, NSEC_2];

  afterEach(() => sinon.restore());

  describe('#start()', () => {
    it('should transition to probing state', () => {
      const { responder } = harness(records, bridgeable);
      responder.start();

      expect(responder.state).to.equal('probing');
      responder.stop();
    });
  });


  describe('#stop()', () => {
    it('should transition to stopped state', () => {
      const { responder } = harness(records, bridgeable);
      responder.stop();

      expect(responder.state).to.equal('stopped');
    });
  });


  describe('#goodbye()', () => {
    it('should do nothing if already stopped', () => {
      const { responder } = harness(records, bridgeable);
      const fn = sinon.stub();

      responder.stop();
      responder.goodbye(fn);

      expect(responder.state).to.equal('stopped');
      expect(fn).to.have.been.called;
    });
  });


  describe('#updateEach()', () => {
    it('should filter records and invoke update each', () => {
      const srv = new SRVRecord({name: fullname, target: 'old.target'});
      const { responder } = harness([srv]);

      sinon.stub(responder, 'handle');

      responder.updateEach(RType.SRV, (record) => {
        record.target = 'new.target';
      });

      expect(srv.target).to.equal('new.target');
      expect(responder.handle).to.have.been.calledWithMatch('update');
    });
  });


  describe('#getRecords()', () => {
    it('should return filtered records', () => {
      const { responder } = harness(records, bridgeable);

      expect(responder.getRecords()).to.eql(records);
    });
  });


  describe('#once()', () => {
    it('should add a listener that gets removed after one use', function(done) {
      const { responder } = harness(records, bridgeable);

      // should only get called once
      responder.once('event', done);

      responder.emit('event');
      responder.emit('event');
    });
  });


  describe('#_addListeners()', () => {
    it('should handle interface events', () => {
      const { responder, networkInterface } = harness(records, bridgeable);
      sinon.stub(responder, 'handle');
      sinon.stub(responder, 'transition');

      responder.start(); // <-- adds listeners

      networkInterface.emit('probe', 'fake probe obj');
      networkInterface.emit('error', 'fake error obj');

      expect(responder.handle).to.have.been
        .calledWith('probe', 'fake probe obj')
        .calledOn(responder);

      expect(responder.transition).to.have.been
        .calledWith('stopped', 'fake error obj')
        .calledOn(responder);
      responder.stop();
    });
  });


  describe('#_removeListeners()', () => {
    it('should remove all responder listeners from each interface', () => {
      const { responder, networkInterface } = harness(records, bridgeable);
      (responder as any)._addListeners();
      (responder as any)._removeListeners();

      expect(networkInterface.off).callCount(4);
    });
  });


  describe('#_stopActives()', () => {
    it('should send stop event on offswith', function(done) {
      const { responder } = harness(records, bridgeable);
      responder._offswitch.once('stop', done);

      responder._stopActives();
    });
  });


  describe('#_sendProbe()', () => {
    it('should filter unique records for each interface to send', () => {
      const { responder, probe } = harness(records, bridgeable);
      (responder as any)._sendProbe(_.noop, _.noop);

      expect(probe.add).to.have.been.calledWithMatch([SRV_1, TXT_1, NSEC_1]);
    });

    it('should onSuccess(true) if all records were found in cache', function(done) {
      const { responder, cache, probe } = harness(records, bridgeable);

      function onSuccess(wasCompletedEarly) {
        expect(wasCompletedEarly).to.be.true;
        done();
      }

      // alter stub behavior
      cache.has.returns(true);

      (responder as any)._sendProbe(onSuccess, _.noop);
      expect(probe.add).to.not.have.been.called;

      // reset stub behavior
      cache.has.resetBehavior();
    });

    it('should reject records in the intferfaces cache (conflict)', () => {
      const { responder, cache, probe } = harness(records, bridgeable);

      // alter stub behavior
      cache.hasConflictWith.withArgs(SRV_1).returns(true);

      (responder as any)._sendProbe(_.noop, _.noop);
      expect(probe.add).to.not.have.been.called;

      // reset stub behavior
      cache.hasConflictWith.withArgs(SRV_1).returns(false);
    });

    it('should call onSuccess with true if probing completed early', function(done) {
      const { responder, probe } = harness(records, bridgeable);

      function onSuccess(wasCompletedEarly) {
        expect(wasCompletedEarly).to.be.true;
        done();
      }

      (responder as any)._sendProbe(onSuccess, _.noop);
      probe.emit('complete', true);
    });

    it('should do onFail if any probe has a conflict', function(done) {
      const { responder, probe } = harness(records, bridgeable);

      (responder as any)._sendProbe(_.noop, done);
      probe.emit('conflict');
    });
  });


  describe('#_sendAnnouncement()', () => {
    it('should repeats should default to 1 or use given number', () => {
      const { responder, response } = harness(records, bridgeable);

      responder._sendAnnouncement();
      expect(response.repeat).to.have.been.calledWith(1);

      responder._sendAnnouncement(3);
      expect(response.repeat).to.have.been.calledWith(3);
    });
  });


  describe('#_sendGoodbye()', () => {
    it('should filter records by interface to send on', () => {
      const { responder, goodbye } = harness(records, bridgeable);

      responder._sendGoodbye(_.noop);

      expect(goodbye.add).to.have.been
        .calledWithMatch([PTR_1, SRV_1, TXT_1, NSEC_1]);
    });

    it('should remove records that shouldn\'t be goodbyed', () => {
      const { responder, goodbye } = harness(records, bridgeable);

      sinon.stub(SRV_1, 'canGoodbye').returns(false);

      responder._sendGoodbye(_.noop);

      expect(goodbye.add).to.have.been
        .calledWithMatch([PTR_1, TXT_1, NSEC_1]);
    });

    it('should do callback when all goodbyes have been sent', function(done) {
      const { responder, goodbye } = harness(records, bridgeable);

      responder._sendGoodbye(done);

      goodbye.emit('stopped');
    });
  });


  describe('#_rename()', () => {
    const { responder } = harness(records, bridgeable);

    it('should rename "Name" -> "Name (2)"', () => {
      const name = responder._rename('Name');
      expect(name).to.equal('Name (2)');
    });

    it('should rename "Name (2)" -> "Name (3)"', () => {
      const name = responder._rename('Name (2)');
      expect(name).to.equal('Name (3)');
    });
  });


  describe('#_onProbe()', () => {
    it('should do nothing with empty probe packets', () => {
      const { responder } = harness(records, bridgeable);
      const createMulticastResponse = sinon.spy(responder as any, 'createMulticastResponse');
      const createUnicastResponse = sinon.spy(responder as any, 'createUnicastResponse');

      responder._onProbe(new Packet());

      expect(createMulticastResponse).to.not.have.been.called;
      expect(createUnicastResponse).to.not.have.been.called;
    });

    it('should do nothing if no probes can be answered', () => {
      const { responder } = harness(records, bridgeable);
      const createMulticastResponse = sinon.spy(responder as any, 'createMulticastResponse');
      const createUnicastResponse = sinon.spy(responder as any, 'createUnicastResponse');
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: 'Some Other Record.local.'})
      ]);

      responder._onProbe(packet);

      expect(createMulticastResponse).to.not.have.been.called;
      expect(createUnicastResponse).to.not.have.been.called;
    });

    it('should send multicast if QM and answer sent recently', () => {
      const { responder, networkInterface, response } = harness(records, bridgeable);
      const createMulticastResponse = sinon.spy(responder as any, 'createMulticastResponse');
      const createUnicastResponse = sinon.spy(responder as any, 'createUnicastResponse');
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: fullname, qtype: RType.SRV})
      ]);

      networkInterface.hasRecentlySent.returns(true);
      responder._onProbe(packet);

      expect(createMulticastResponse).to.have.been.called;
      expect(response.defensive).to.have.been.called;
      expect(response.add).to.have.been.calledWithMatch([SRV_1]);

      expect(createUnicastResponse).to.not.have.been.called;
    });

    it('should send unicast if QU and answer sent recently', () => {
      const { responder, networkInterface, unicast } = harness(records, bridgeable);
      const createMulticastResponse = sinon.spy(responder as any, 'createMulticastResponse');
      const createUnicastResponse = sinon.spy(responder as any, 'createUnicastResponse');
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: fullname, qtype: RType.SRV, QU: true})
      ]);

      networkInterface.hasRecentlySent.returns(true);
      responder._onProbe(packet);

      expect(createMulticastResponse).to.not.have.been.called;

      expect(createUnicastResponse).to.have.been.called;
      expect(unicast.respondTo).to.have.been.calledWith(packet);
      expect(unicast.defensive).to.have.been.called;
      expect(unicast.add).to.have.been.calledWithMatch([SRV_1]);
    });

    it('should send multicast & unicast if needed', () => {
      const { responder, networkInterface, response, unicast } = harness(records, bridgeable);
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: fullname, qtype: RType.SRV}),
        new QueryRecord({name: service,  qtype: RType.PTR, QU: true})
      ]);

      networkInterface.hasRecentlySent.returns(true);
      responder._onProbe(packet);

      expect(response.add).to.have.been.calledWithMatch([SRV_1]);
      expect(unicast.add).to.have.been.calledWithMatch([PTR_1]);
    });

    it('should always send multicast if answer was not sent recently', () => {
      const { responder, networkInterface, response } = harness(records, bridgeable);
      const createUnicastResponse = sinon.spy(responder as any, 'createUnicastResponse');
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: fullname, qtype: RType.SRV, QU: true})
      ]);

      networkInterface.hasRecentlySent.returns(false);
      responder._onProbe(packet);

      expect(response.add).to.have.been.calledWithMatch([SRV_1]);
      expect(createUnicastResponse).to.not.have.been.called;
    });

    it('should send negative responses when needed', () => {
      const { responder, response } = harness(records, bridgeable);
      const createUnicastResponse = sinon.spy(responder as any, 'createUnicastResponse');
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: fullname, qtype: RType.AAAA})
      ]);

      responder._onProbe(packet);

      expect(response.add).to.have.been.calledWithMatch([NSEC_1]);
      expect(createUnicastResponse).to.not.have.been.called;
    });
  });


  describe('#_onQuery()', () => {
    it('should do nothing with empty query packets', () => {
      const { responder } = harness(records, bridgeable);
      const createMulticastResponse = sinon.spy(responder as any, 'createMulticastResponse');
      const createUnicastResponse = sinon.spy(responder as any, 'createUnicastResponse');
      responder._onQuery(new Packet());

      expect(createMulticastResponse).to.not.have.been.called;
      expect(createUnicastResponse).to.not.have.been.called;
    });

    it('should do nothing if no questions can be answered', () => {
      const { responder } = harness(records, bridgeable);
      const createMulticastResponse = sinon.spy(responder as any, 'createMulticastResponse');
      const createUnicastResponse = sinon.spy(responder as any, 'createUnicastResponse');
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: 'Some Other Record.local.'})
      ]);

      responder._onQuery(packet);

      expect(createMulticastResponse).to.not.have.been.called;
      expect(createUnicastResponse).to.not.have.been.called;
    });

    it('should send multicast if QM and answer sent recently', () => {
      const { responder, networkInterface, response } = harness(records, bridgeable);
      const createMulticastResponse = sinon.spy(responder as any, 'createMulticastResponse');
      const createUnicastResponse = sinon.spy(responder as any, 'createUnicastResponse');
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: fullname, qtype: RType.SRV})
      ]);

      networkInterface.hasRecentlySent.returns(true);
      responder._onQuery(packet);

      expect(createMulticastResponse).to.have.been.called;
      expect(response.add).to.have.been.calledWithMatch([SRV_1]);

      expect(createUnicastResponse).to.not.have.been.called;
    });

    it('should send unicast if QU and answer sent recently', () => {
      const { responder, networkInterface, unicast } = harness(records, bridgeable);
      const createMulticastResponse = sinon.spy(responder as any, 'createMulticastResponse');
      const createUnicastResponse = sinon.spy(responder as any, 'createUnicastResponse');
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: fullname, qtype: RType.SRV, QU: true})
      ]);

      networkInterface.hasRecentlySent.returns(true);
      responder._onQuery(packet);

      expect(createMulticastResponse).to.not.have.been.called;

      expect(createUnicastResponse).to.have.been.called;
      expect(unicast.respondTo).to.have.been.calledWith(packet);
      expect(unicast.add).to.have.been.calledWithMatch([SRV_1]);
    });

    it('should send moth unicast & multicast if needed', () => {
      const { responder, networkInterface, unicast, response } = harness(records, bridgeable);
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: fullname, qtype: RType.SRV}),
        new QueryRecord({name: service,  qtype: RType.PTR, QU: true}),
      ]);

      networkInterface.hasRecentlySent.returns(true);
      responder._onQuery(packet);

      expect(response.add).to.have.been.calledWithMatch([SRV_1]);
      expect(unicast.add).to.have.been.calledWithMatch([PTR_1]);
    });

    it('should always send multicast if answer was not sent recently', () => {
      const { responder, networkInterface, response } = harness(records, bridgeable);
      const createUnicastResponse = sinon.spy(responder as any, 'createUnicastResponse');
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: fullname, qtype: RType.SRV, QU: true})
      ]);

      networkInterface.hasRecentlySent.returns(false);
      responder._onQuery(packet);

      expect(response.add).to.have.been.calledWithMatch([SRV_1]);
      expect(createUnicastResponse).to.not.have.been.called;
    });

    it('should always send unicast if packet is from a legacy source', () => {
      const { responder, unicast } = harness(records, bridgeable);
      const createMulticastResponse = sinon.spy(responder as any, 'createMulticastResponse');
      const packet = new Packet();
      packet.origin.port = 8765; // non mDNS port

      packet.setQuestions([
        new QueryRecord({name: fullname, qtype: RType.SRV})
      ]);

      responder._onQuery(packet);

      expect(packet.isLegacy()).to.be.true;
      expect(createMulticastResponse).to.not.have.been.called;
      expect(unicast.add).to.have.been.calledWithMatch([SRV_1]);
    });

    it('should suppress answers in known list if ttl > 0.5 original', () => {
      const { responder } = harness(records, bridgeable);
      const createMulticastResponse = sinon.spy(responder as any, 'createMulticastResponse');
      const createUnicastResponse = sinon.spy(responder as any, 'createUnicastResponse');
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: fullname, qtype: RType.SRV})
      ]);

      packet.setAnswers([SRV_1]); // @ max default TTL

      responder._onQuery(packet);

      expect(createMulticastResponse).to.not.have.been.called;
      expect(createUnicastResponse).to.not.have.been.called;
    });

    it('should not suppress answers in known list if ttl < 0.5 original', () => {
      const { responder } = harness(records, bridgeable);
      const createMulticastResponse = sinon.spy(responder as any, 'createMulticastResponse');
      const createUnicastResponse = sinon.spy(responder as any, 'createUnicastResponse');
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: fullname, qtype: RType.SRV})
      ]);

      const clone = SRV_1.clone();
      clone.ttl = 1; // lowest possible TTL

      packet.setAnswers([clone]);

      responder._onQuery(packet);

      expect(createMulticastResponse).to.have.been.called;
      expect(createUnicastResponse).to.not.have.been.called;
    });

    it('should send negative responses when needed', () => {
      const { responder, response } = harness(records, bridgeable);
      const createUnicastResponse = sinon.spy(responder as any, 'createUnicastResponse');
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: fullname, qtype: RType.AAAA})
      ]);

      responder._onQuery(packet);

      expect(response.add).to.have.been.calledWithMatch([NSEC_1]);
      expect(createUnicastResponse).to.not.have.been.called;
    });
  });


  describe('#_onAnswer()', () => {
    const conflictingSRV = new SRVRecord({
      name: fullname,
      target: 'conflicting', // <- conflict
    });

    const differentPTR = new PTRRecord({
      name: service,
      PTRDName: 'different',
      isUnique: false, // <- can't be a conflict, just a different answer
    });

    it('should do nothing with empty answer packets', () => {
      const { responder } = harness(records, bridgeable);
      sinon.stub(responder, 'transition');
      sinon.stub(responder, '_sendAnnouncement');
      responder._onAnswer(new Packet());

      expect(responder._sendAnnouncement).to.not.have.been.called;
      expect(responder.transition).to.not.have.been.called;
    });

    it('should do nothing with non-conflicting answers', () => {
      const { responder } = harness(records, bridgeable);
      sinon.stub(responder, 'transition');
      sinon.stub(responder, '_sendAnnouncement');
      responder._onAnswer(new Packet());

      const packet = new Packet();
      packet.setAnswers([SRV_1, differentPTR]);

      responder._onAnswer(packet);

      expect(responder._sendAnnouncement).to.not.have.been.called;
      expect(responder.transition).to.not.have.been.called;
    });

    it('should transition to probing on conflciting answers', () => {
      const { responder } = harness(records, bridgeable);
      sinon.stub(responder, 'transition');
      sinon.stub(responder, '_sendAnnouncement');
      responder._onAnswer(new Packet());
      
      const packet = new Packet();
      packet.setAnswers([conflictingSRV]);

      responder._onAnswer(packet);

      expect(responder.transition).to.have.been.calledWith('probing');
    });

    it('should re-announce "conflicting" bridged records', () => {
      const { responder } = harness(records, bridgeable);
      sinon.stub(responder, 'transition');
      sinon.stub(responder, '_sendAnnouncement');
      responder._onAnswer(new Packet());
      
      const packet = new Packet();
      packet.setAnswers([SRV_2]); // SRV for interface 2

      responder._onAnswer(packet); // on interface 1

      expect(responder.transition).to.not.have.been.called;
      expect(responder._sendAnnouncement).to.have.been.called;
    });

    it("should re-announce records TTL=0'd by another responder", () => {
      const { responder } = harness(records, bridgeable);
      sinon.stub(responder, 'transition');
      sinon.stub(responder, '_sendAnnouncement');
      responder._onAnswer(new Packet());
      
      const goodbyeRecord = SRV_1.clone();
      goodbyeRecord.ttl = 0;

      const packet = new Packet();
      packet.setAnswers([goodbyeRecord]);

      responder._onAnswer(packet);

      expect(responder.transition).to.not.have.been.called;
      expect(responder._sendAnnouncement).to.have.been.called;
    });
  });


  describe('Sanity tests:', () => {
    it('should probe -> announce -> respond', () => {
      const { responder, probe } = harness(records, bridgeable);
      const createMulticastResponse = sinon.spy(responder as any, 'createMulticastResponse');
      const createProbe = sinon.spy(responder as any, 'createProbe');
      
      responder.start();

      // now sending probes
      expect(createProbe).to.have.been.called;

      // fake probes report complete:
      probe.emit('complete');

      // should be announcing:
      expect(createMulticastResponse).to.have.been.called;
      expect(responder.state).to.equal('responding');
      responder.stop();
    });


    it('should hold probes for 5s if too many conflicts', () => {
      const { responder, probe } = harness(records, bridgeable);
      const createProbe = sinon.spy(responder as any, 'createProbe');

      // add a bunch of conflicts
      _.times(25, () => responder._conflicts.increment());
      responder.start();

      // not called yet, waiting for timeout due to conflicts
      expect(createProbe).to.not.have.been.called;

      jest.advanceTimersByTime(6_000);

      // probe queue fired
      expect(createProbe).to.have.been.called;

      probe.emit('complete');
      expect(responder.state).to.equal('responding');
      responder.stop();
    });


    it('should reset conflict count after 15s', () => {
      const { responder } = harness(records, bridgeable);

      // add a bunch of conflicts
      _.times(25, () => responder._conflicts.increment());
      responder.start();

      jest.advanceTimersByTime(16_000);
      expect(responder._conflicts.count()).to.equal(0);
      responder.stop();
    });


    it('should automatically rename itself as conflicts are found', () => {
      const { responder, probe } = harness(records, bridgeable);
      responder.start();

      expect(responder._instance).to.equal('Instance');
      probe.emit('conflict'); // <- conflict!

      expect(responder._instance).to.equal('Instance (2)');
      probe.emit('conflict'); // <- again!

      expect(responder._instance).to.equal('Instance (3)');
      expect(responder._conflicts.count()).to.equal(2);

      probe.emit('complete'); // <- now successful
      expect(responder.state).to.equal('responding');

      expect(SRV_1.name).to.equal('Instance (3)' + '.' + service);
      expect(PTR_1.PTRDName).to.equal('Instance (3)' + '.' + service);
      responder.stop();
    });


    it('should skip announcing if all probes end early', () => {
      const { responder, probe } = harness(records, bridgeable);
      const createMulticastResponse = sinon.spy(responder as any, 'createMulticastResponse');

      responder.start();
      probe.emit('complete', true); // <- ended early

      expect(createMulticastResponse).to.not.have.been.called;
      responder.stop();
    });


    it('should stop probing and re-probe if records are updated', () => {
      const { responder, probe } = harness(records, bridgeable);
      const createProbe = sinon.spy(responder as any, 'createProbe');
      responder.start();

      expect(createProbe).to.have.been.called;
      expect(probe.start).to.have.been.calledOnce;

      responder.updateEach(RType.SRV, (record) => {
        record.target = 'Updated.local.';
      });

      expect(probe.start).to.have.been.calledTwice;
      responder.stop();
    });


    it("shouldn't send goodbyes if probing not complete", function(done) {
      const { responder, goodbye } = harness(records, bridgeable);

      responder.start();

      responder.goodbye(() => {
        expect(goodbye.start).to.not.have.been.called;
        done();
      });
      responder.stop();
    });


    it('should send goodbyes if probing complete', function(done) {
      const { responder, probe, goodbye } = harness(records, bridgeable);

      // put into responding state
      responder.start();
      probe.emit('complete');

      responder.goodbye(() => {
        expect(responder.state).to.equal('stopped');
        done();
      });

      goodbye.emit('stopped');
      responder.stop();
    });


    it('should announce record updates when in responding state', () => {
      const { responder, probe, response } = harness(records, bridgeable);

      // put into responding state
      responder.start();
      probe.emit('complete');

      responder.updateEach(RType.SRV, () => {});

      expect(response.add).to.have.been
        .calledWithMatch([PTR_1, SRV_1, TXT_1, NSEC_1]);
      responder.stop();
    });


    it('should answer probes', () => {
      const { responder, probe, networkInterface, response } = harness(records, bridgeable);

      // put into responding state
      responder.start();
      probe.emit('complete');

      // a conflicting probe
      const probePacket = new Packet();
      probePacket.setQuestions([ new QueryRecord({name: SRV_1.name}) ]);
      probePacket.setAnswers([ new SRVRecord({name: SRV_1.name}) ]);

      // now responding & answering queries
      networkInterface.emit('probe', probePacket);

      expect(response.add).to.have.been
        .calledWithMatch([SRV_1, TXT_1, NSEC_1]);
      responder.stop();
    });


    it('should answer queries', () => {
      const { responder, probe, networkInterface, response } = harness(records, bridgeable);

      // put into responding state (w/o announcing)
      responder.start();
      probe.emit('complete', true);

      const queryPacket = new Packet();
      queryPacket.setQuestions([ new QueryRecord({name: SRV_1.name}) ]);

      // now responding & answering queries
      networkInterface.emit('query', queryPacket);

      expect(response.add).to.have.been.calledWithMatch([SRV_1, TXT_1, NSEC_1]);
      responder.stop();
    });


    it('should rename/re-probe when a conflicting answer comes in', () => {
      const { responder, probe, networkInterface } = harness(records, bridgeable);

      // put into responding state
      responder.start();
      probe.emit('complete');

      // create a conflicting record/packet
      const conflict = new Packet();
      conflict.setAnswers([
        new SRVRecord({name: SRV_1.name, port: 3456})
      ]);

      // now responding & hearing other responder answers
      networkInterface.emit('answer', conflict);

      // conflict causes it to re-probe
      expect(responder.state).to.equal('probing');
      responder.stop();
    });


    it('stopped state should be terminal', () => {
      const { responder } = harness(records, bridgeable);

      responder.stop();
      responder.start();

      expect(responder.state).to.equal('stopped');
    });
  });
});