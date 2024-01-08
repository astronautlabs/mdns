import { expect } from 'chai';
import sinon from 'sinon';
import _ from 'lodash';

import { Packet } from './Packet';
import { ARecord, NSECRecord, PTRRecord, TXTRecord } from './ResourceRecord';
import { GoodbyeResponse, MulticastResponse, UnicastResponse } from './Response';

import * as Fake from './test-mocks';
import { jest } from '@jest/globals';

jest.useFakeTimers();

describe('MulticastResponse', () => {
  const intf      = Fake.NetworkInterface();
  const offswitch = Fake.EventEmitter();

  beforeEach(() => sinon.resetHistory());

  describe('#constructor()', () => {
    it('should attach listeners', () => {
      new MulticastResponse(intf, offswitch);

      expect(intf.on).to.have.been.called;
      expect(offswitch.on).to.have.been.called;
    });
  });


  describe('#add()', () => {
    it('should add to this._answers and add random delay', () => {
      const response = new MulticastResponse(intf, offswitch);

      // accept single records:
      response.add(new ARecord({name: 'Unique'}));
      expect(response._delay).to.equal(0);

      // accept array of records:
      response.add([ new PTRRecord({name: 'Shared'}) ]);
      expect(response._delay).to.be.within(20, 120);

      expect(response._answers.size).to.equal(2);
    });
  });

  describe('#start()', () => {
    it('should make packet and _send() after delay', () => {
      const response = new MulticastResponse(intf, offswitch);
      sinon.stub(response, '_send');

      response.start();
      jest.advanceTimersByTime(120); // <-- the longest random delay possible

      expect(response._send).to.have.been.called;
    });

    it('should ignore delay if defensive is set', () => {
      const response = new MulticastResponse(intf, offswitch);
      sinon.stub(response, '_send');

      response._delay = 100;
      response.defensive(true);

      response.start();
      jest.advanceTimersByTime(0);

      expect(response._send).to.have.been.called;
    });
  });


  describe('#stop()', () => {
    it('should stop & remove listeners', function(done) {
      const response = new MulticastResponse(intf, offswitch);

      response.on('stopped', () => {
        expect(intf.off).to.have.been.called;
        expect(offswitch.off).to.have.been.called;
        done();
      });

      response.stop();
    });

    it('should not do anything if already stopped', function(done) {
      const response = new MulticastResponse(intf, offswitch);

      response.on('stopped', done); // <-- more than once throws error

      response.stop();
      response.stop(); // <-- does nothing
    });
  });


  describe('#_send()', () => {
    it('should not reschedule if out of repeats', () => {
      const response = new MulticastResponse(intf, offswitch);
      sinon.stub(response, '_suppressRecents');

      response._send();

      expect(response._next).to.equal(1000);
    });

    it('should reschedule next response, doubling delay', () => {
      const response = new MulticastResponse(intf, offswitch);
      sinon.stub(response, '_suppressRecents');
      sinon.stub(response, '_makePacket');
      sinon.stub(response, 'stop');

      intf.send.yields();

      response.repeat(3);
      response._send();

      jest.advanceTimersByTime(1_000);
      expect(intf.send).to.have.callCount(2);
      expect(response.stop).to.not.have.been.called;

      jest.advanceTimersByTime(2_000);
      expect(intf.send).to.have.callCount(3);
      expect(response.stop).to.have.been.called;

      jest.advanceTimersByTime(4_000);
      expect(intf.send).to.not.have.callCount(4);
    });
  });


  describe('#_makePacket()', () => {
    it('should add additionals without repeating answers', () => {
      const response = new MulticastResponse(intf, offswitch);

      const A = new TXTRecord({name: 'A'});
      const B = new TXTRecord({name: 'B'});
      const C = new TXTRecord({name: 'C', additionals: [A]});
      const D = new TXTRecord({name: 'D', additionals: [B]});

      response.add([A, C, D]);

      const packet = response._makePacket();

      expect(packet.isAnswer()).to.be.true;
      expect(packet.answers).to.eql([A, C, D]);
      expect(packet.additionals).to.eql([B]); // <-- should not include A
    });
  });


  describe('#_suppressRecents()', () => {
    const response = new MulticastResponse(intf, offswitch);

    const A = new TXTRecord({name: 'A'});
    const B = new TXTRecord({name: 'B'});

    it('should suppress recently sent answers & additionals', () => {
      const packet = new Packet();
      packet.setAnswers([A, B]);

      intf.hasRecentlySent.withArgs(A).returns(false);
      intf.hasRecentlySent.withArgs(B).returns(true);

      const output = response._suppressRecents(packet);

      expect(output.answers).to.eql([A]); // <-- B suppressed
    });

    it('should do 250ms for defensive responses & 1s for others', () => {
      const packet = new Packet();
      packet.answers = [A];

      response.defensive(true);
      response._suppressRecents(packet);

      expect(intf.hasRecentlySent).to.have.been.calledWith(A, 0.250);

      response.defensive(false);
      response._suppressRecents(packet);

      expect(intf.hasRecentlySent).to.have.been.calledWith(A, 1);
    });
  });


  describe('#_onAnswer()', () => {
    const A = new TXTRecord({name: 'A'});
    const B = new TXTRecord({name: 'B'});

    it('should suppress queued answers found in incoming packet', () => {
      const response = new MulticastResponse(intf, offswitch);

      response._queuedPacket = new Packet();
      response._queuedPacket.setAnswers([A, B]);

      const packet = new Packet();
      packet.setAnswers([A]);

      response._onAnswer(packet);

      expect(response._queuedPacket.answers).to.eql([B]); // <-- A suppressed
    });

    it('should not suppress TTL=0 answers', () => {
      const response = new MulticastResponse(intf, offswitch);
      const dead = new TXTRecord({name: 'A', ttl: 0});

      response._queuedPacket = new Packet();
      response._queuedPacket.setAnswers([A, B]);

      const packet = new Packet();
      packet.setAnswers([dead]);

      expect(response._queuedPacket.answers).to.eql([A, B]); // <-- not suppressed
    });

    it('should exit if response is in stopped state', () => {
      const response = new MulticastResponse(intf, offswitch);
      response.stop();

      response._queuedPacket = new Packet();
      response._queuedPacket.setAnswers([A, B]);

      const packet = new Packet();
      packet.setAnswers([A]);

      response._onAnswer(packet);

      expect(response._queuedPacket.answers).to.eql([A, B]); // <-- not suppressed
    });

    it('should exit if incoming packet originated on same interface', () => {
      const response = new MulticastResponse(intf, offswitch);

      response._queuedPacket = new Packet();
      response._queuedPacket.setAnswers([A, B]);

      const packet = new Packet();
      packet.setAnswers([A]);
      sinon.stub(packet, 'isLocal').returns(true);

      response._onAnswer(packet);

      expect(response._queuedPacket.answers).to.eql([A, B]); // <-- not suppressed
    });
  });

});


describe('GoodbyeResponse', () => {
  const intf      = Fake.NetworkInterface();
  const offswitch = Fake.EventEmitter();

  beforeEach(() => sinon.resetHistory());

  describe('#constructor()', () => {
    it('should inherit from MulticastResponse', () => {
      const goodbye = new GoodbyeResponse(intf, offswitch);

      expect(goodbye).to.be.instanceof(MulticastResponse);
    });
  });


  describe('#_makePacket()', () => {
    it('should add clones to packet and TTL=0 them', () => {
      const goodbye = new GoodbyeResponse(intf, offswitch);

      const add = new NSECRecord({name: 'removed'});
      const answer = new TXTRecord({name: 'bye', additionals: add});
      goodbye.add(answer);

      const packet = goodbye._makePacket();

      expect(packet.isAnswer()).to.be.true;
      expect(packet.answers).to.have.lengthOf(1);
      expect(packet.answers[0]).to.not.equal(answer);
      expect(packet.answers[0].ttl).to.equal(0);
      expect(packet.additionals).to.be.empty;
    });
  });


  describe('#_suppressRecents()', () => {
    it('should do nothing', () => {
      const goodbye = new GoodbyeResponse(intf, offswitch);
      const packet = new Packet();

      expect(goodbye._suppressRecents(packet)).to.equal(packet);
    });
  });

});


describe('UnicastResponse', () => {
  const intf      = Fake.NetworkInterface();
  const offswitch = Fake.EventEmitter();

  beforeEach(() => sinon.resetHistory());

  describe('#add()', () => {
    it('should add to this._answers and add random delay', () => {
      const response = new UnicastResponse(intf, offswitch);

      // accept single records:
      response.add(new ARecord({name: 'Unique'}));
      expect(response._delay).to.equal(0);

      // accept array of records:
      response.add([ new PTRRecord({name: 'Shared'}) ]);
      expect(response._delay).to.be.within(20, 120);

      expect(response._answers.size).to.equal(2);
    });
  });


  describe('#start()', () => {
    it('should make packet and send after delay', () => {
      const response = new UnicastResponse(intf, offswitch);
      sinon.stub(response, '_makePacket');

      response._delay = 100;
      response.start();

      jest.advanceTimersByTime(100);

      expect(intf.send).to.have.been.called;
    });

    it('should ignore delay if defensive or legacy are set', () => {
      const response = new UnicastResponse(intf, offswitch);
      sinon.stub(response, '_makePacket');

      response.defensive(true);
      response.start();

      jest.advanceTimersByTime(0);

      expect(intf.send).to.have.been.called;
    });

    it('should stop after packet is sent', (done) => {
      const response = new UnicastResponse(intf, offswitch);
      sinon.stub(response, '_makePacket');
      intf.send.yields();

      response.on('stopped', () => done());

      response.defensive(true);
      response.start();
      jest.advanceTimersByTime(120);
    });
  });


  describe('#stop()', () => {
    it('should stop & remove listeners', function(done) {
      const response = new UnicastResponse(intf, offswitch);

      response.on('stopped', () => {
        expect(intf.off).to.have.been.called;
        expect(offswitch.off).to.have.been.called;
        done();
      });

      response.stop();
    });

    it('should not do anything if already stopped', () => {
      const response = new UnicastResponse(intf, offswitch);

      response.stop();
      response.stop(); // <-- does nothing

      expect(offswitch.off).to.not.have.been.calledTwice;
    });
  });


  describe('#_makePacket()', () => {
    const A = new TXTRecord({name: 'A'});
    const B = new TXTRecord({name: 'B'});
    const C = new TXTRecord({name: 'C', additionals: [A]});
    const D = new TXTRecord({name: 'D', additionals: [B]});
    const NSEC = new NSECRecord({name: 'NSEC'});

    it('should add additionals without repeating answers', () => {
      const response = new UnicastResponse(intf, offswitch);
      response.add([A, C, D]);

      const packet = response._makePacket();

      expect(packet.isAnswer()).to.be.true;
      expect(packet.answers).to.eql([A, C, D]);
      expect(packet.additionals).to.eql([B]);  // <-- A not included again
    });

    it('should make legacy packets', () => {
      const response = new UnicastResponse(intf, offswitch);
      response.add([A, NSEC]);

      const unicastQuery = new Packet();
      unicastQuery.origin.port = 2222; // <-- not 5353, so 'legacy'
      unicastQuery.header.ID = 123;

      response.respondTo(unicastQuery);

      const packet = response._makePacket();

      expect(packet.header.ID).to.equal(unicastQuery.header.ID);
      expect(packet.answers).to.have.lengthOf(1);
      expect(packet.answers[0]).to.not.equal(A);           // <-- clone
      expect(packet.answers[0].rrtype).to.equal(A.rrtype); // <-- NSEC removed
      expect(packet.answers[0].ttl).to.equal(10);          // <-- TTL adjusted
    });
  });

});
