import { expect } from 'chai';
import sinon from 'sinon';

import { Packet } from './Packet';
import { AAAARecord, ARecord, NSECRecord, ResourceRecord, SRVRecord, TXTRecord } from './ResourceRecord';
import { Probe } from './Probe';

import * as Fake from './test-mocks';
import { jest } from '@jest/globals';

jest.useFakeTimers();

describe('Probe', function() {
  const intf      = Fake.NetworkInterface();
  const offswitch = Fake.EventEmitter();

  afterEach(() => sinon.resetHistory());

  describe('#add()', function() {
    it('should add to this._questions & this._authorities', function() {
      const probe = new Probe(intf, offswitch);

      // single records:
      probe.add(new ARecord({name: 'A'}));

      expect((probe as any)._questions.size).to.equal(1);
      expect((probe as any)._authorities.size).to.equal(1);

      // array of records:
      probe.add([ new AAAARecord({name: 'AAAA'}) ]);

      expect((probe as any)._questions.size).to.equal(2);
      expect((probe as any)._authorities.size).to.equal(2);
    });
  });


  describe('#start()', function() {
    it('should queue _send() after delay', () => {
      const probe = new Probe(intf, offswitch);
      sinon.stub(probe, '_send');

      probe.start();
      jest.advanceTimersByTime(250);

      expect(probe._send).to.have.been.called;
    });

    it('should do nothing if already stopped', () => {
      const probe = new Probe(intf, offswitch);
      sinon.stub(probe, '_send');

      probe.stop();
      probe.start();
      jest.advanceTimersByTime(250);

      expect(probe._send).to.not.have.been.called;
    });
  });


  describe('#_restart()', function() {
    it('should restart probing process', () => {
      const probe = new Probe(intf, offswitch);
      sinon.spy(probe, '_complete');

      probe._send(); // instead of probe.start() to skip initial 0-250ms delay

      jest.advanceTimersByTime(250);
      expect(intf.send).to.have.callCount(2);
      expect(probe._complete).to.not.have.been.called;

      jest.advanceTimersByTime(250);
      expect(intf.send).to.have.callCount(3);
      expect(probe._complete).to.not.have.been.called;

      // force a restart
      probe._restart();

      // probe restarted:
      expect(intf.send).to.have.callCount(4);
      expect(probe._complete).to.not.have.been.called;

      jest.advanceTimersByTime(250);
      expect(intf.send).to.have.callCount(5);
      expect(probe._complete).to.not.have.been.called;

      jest.advanceTimersByTime(250);
      expect(intf.send).to.have.callCount(6);
      expect(probe._complete).to.not.have.been.called;

      jest.advanceTimersByTime(250);
      expect(intf.send).to.not.have.callCount(7);
      expect(probe._complete).to.have.been.called;
    });
  });


  describe('#stop()', function() {
    it('should stop & remove listeners', function() {
      const probe = new Probe(intf, offswitch);

      probe.stop();

      expect(intf.off).to.have.been.calledThrice;
      expect(offswitch.off).to.have.been.calledOnce;
    });

    it('should not do anything if already stopped', function() {
      const probe = new Probe(intf, offswitch);

      probe.stop();
      probe.stop(); // <-- does nothing

      expect(intf.off).to.have.been.calledThrice;
      expect(offswitch.off).to.have.been.calledOnce;
    });
  });


  describe('#_send()', function() {
    it('should finish after 3 probes and 750ms', () => {
      const probe = new Probe(intf, offswitch);
      sinon.spy(probe, '_complete');

      probe._send();

      jest.advanceTimersByTime(250);
      expect(intf.send).to.have.callCount(2);
      expect(probe._complete).to.not.have.been.called;

      jest.advanceTimersByTime(250);
      expect(intf.send).to.have.callCount(3);
      expect(probe._complete).to.not.have.been.called;

      jest.advanceTimersByTime(250);
      expect(intf.send).to.not.have.callCount(4);
      expect(probe._complete).to.have.been.called;
    });
  });


  describe('#_onAnswer()', function() {
    const A = new TXTRecord({name: 'A'});
    const B = new TXTRecord({name: 'B'});
    const C = new TXTRecord({name: 'C'});
    const conflict = new TXTRecord({name: 'C', txt: {different: true}});

    it('should emit conflict if conflicting records are found', function(done) {
      const probe = new Probe(intf, offswitch);
      probe.add(C);
      probe.bridgeable([C]);

      const incomingPacket = new Packet();
      incomingPacket.setAnswers([conflict]);

      probe.on('conflict', done);

      probe._onAnswer(incomingPacket);
    });

    it('should ignore "conflicts" if packet was bridged', function() {
      const probe = new Probe(intf, offswitch);
      probe.add(C);
      probe.bridgeable([C, conflict]); // <-- in the set, on another interface

      const incomingPacket = new Packet();
      incomingPacket.setAnswers([conflict]);

      sinon.stub(probe, 'emit');
      probe._onAnswer(incomingPacket);

      expect(probe.emit).to.not.have.been.called;
    });

    it('should do nothing if no conflicting records were found', function() {
      const probe = new Probe(intf, offswitch);
      probe.add(A);
      probe.bridgeable([A]);

      const incomingPacket = new Packet();
      incomingPacket.setAnswers([B]);

      sinon.stub(probe, 'emit');
      probe._onAnswer(incomingPacket);

      expect(probe.emit).to.not.have.been.called;
    });

    it('should complete early if incoming records match ALL probes', function(done) {
      const probe = new Probe(intf, offswitch);
      probe.add([A, B]);
      probe.bridgeable([A, B]);

      const incomingPacket = new Packet();
      incomingPacket.setAnswers([A, B, C]);

      probe.on('complete', (isEarly) => {
        expect(isEarly).to.be.true;
        done();
      });

      probe._onAnswer(incomingPacket);
    });

    it('should NOT complete early if incoming does not match ALL probes', function() {
      const probe = new Probe(intf, offswitch);
      probe.add([A, B]);
      probe.bridgeable([A, B]);

      const incomingPacket = new Packet();
      incomingPacket.setAnswers([A, C]);

      sinon.stub(probe, 'emit');
      probe._onAnswer(incomingPacket);

      expect(probe.emit).to.not.have.been.called;
    });

    it('should do nothing if stopped', function() {
      const probe = new Probe(intf, offswitch);
      probe.add(C);
      probe.bridgeable([C]);
      probe.stop();

      const incomingPacket = new Packet();
      incomingPacket.setAnswers([conflict]);

      sinon.stub(probe, 'emit');
      probe._onAnswer(incomingPacket);

      expect(probe.emit).to.not.have.been.called;
    });
  });


  describe('#_onProbe()', function() {
    const A = new TXTRecord({name: 'A'}); // <-- uppercase
    const a = new TXTRecord({name: 'a'}); // <-- lowercase
    const B = new TXTRecord({name: 'B'});
    const C = new TXTRecord({name: 'C'});

    it('should group records by name, case insensitive', function() {
      const probe = new Probe(intf, offswitch);
      probe.add(a);

      const incomingPacket = new Packet();
      incomingPacket.setAuthorities([A]);

      sinon.stub(probe, '_recordsHaveConflict');
      probe._onProbe(incomingPacket);

      expect(probe._recordsHaveConflict).to.have.been.calledWith([a], [A]);
    });

    it('should sort rrtype before comparing records', function() {
      const probe = new Probe(intf, offswitch);
      sinon.stub(probe, '_recordsHaveConflict');

      // fake records w/ easy rrtypes
      const A1 = {name: 'A', rrtype: 1, hash: 'A1'};
      const A2 = {name: 'A', rrtype: 2, hash: 'A2'};
      const A3 = {name: 'A', rrtype: 3, hash: 'A3'};

      const incomingPacket = new Packet();
      incomingPacket.setAuthorities([A1, A3, A2]); // <-- order

      probe.add([A2, A1]);
      probe._onProbe(incomingPacket);

      expect(probe._recordsHaveConflict).to.have.been
        .calledWith([A1, A2], [A1, A2, A3]); // <-- sorted
    });

    it('should deal with multiple groups / multiple names', function() {
      const probe = new Probe(intf, offswitch);
      probe.add([A, B]);

      const incomingPacket = new Packet();
      incomingPacket.setAuthorities([A, B, C]);

      sinon.stub(probe, '_recordsHaveConflict');
      probe._onProbe(incomingPacket);

      expect(probe._recordsHaveConflict).to.have.been
        .calledTwice
        .calledWith([A], [A])  // <-- properly paired
        .calledWith([B], [B]);
    });

    it('should do restart when a probe conflict happens', () => {
      const probe = new Probe(intf, offswitch);
      probe.add([A, B]);

      const incomingPacket = new Packet();
      incomingPacket.setAuthorities([A, B, C]);

      sinon.stub(probe, '_restart');
      sinon.stub(probe, '_recordsHaveConflict').returns(true);
      probe._onProbe(incomingPacket);

      jest.advanceTimersByTime(1000);
      expect(probe._restart).to.have.been.called;
    });

    it('should return early if probe is stopped', function() {
      const probe = new Probe(intf, offswitch);
      probe.add(A);
      probe.stop();

      const incomingPacket = new Packet();
      incomingPacket.setAuthorities([A]);

      sinon.stub(probe, '_recordsHaveConflict');
      probe._onProbe(incomingPacket);

      expect(probe._recordsHaveConflict).to.not.have.been.called;
    });

    it('should return early if probe came from this machine', function() {
      const probe = new Probe(intf, offswitch);
      probe.add(A);

      const incomingPacket = new Packet();
      incomingPacket.setAuthorities([A]);
      sinon.stub(incomingPacket, 'isLocal').returns(true);

      sinon.stub(probe, '_recordsHaveConflict');
      probe._onProbe(incomingPacket);

      expect(probe._recordsHaveConflict).to.not.have.been.called;
    });
  });


  describe('#_recordsHaveConflict()', function() {
    const A1 = new TXTRecord({name: 'A', txt: {data: '1'}}); // <-- earlier
    const A2 = new TXTRecord({name: 'A', txt: {data: '2'}}); // <-- later
    const X  = new NSECRecord({name: 'X'});

    const probe = new Probe(intf, offswitch);

    it('should be true if incoming records list runs out second', function() {
      expect(probe._recordsHaveConflict([A1], [A1, X])).to.be.true;
    });

    it('should be false if incoming records list runs out first', function() {
      expect(probe._recordsHaveConflict([A1, X], [A1])).to.be.false;
    });

    it('should be true if incoming record is lexico earlier', function() {
      expect(probe._recordsHaveConflict([A1], [A2])).to.be.true;
    });

    it('should be false if incoming record is lexico later', function() {
      expect(probe._recordsHaveConflict([A2], [A1])).to.be.false;
    });

    it('should be false if incoming record is lexico equal', function() {
      expect(probe._recordsHaveConflict([X], [X])).to.be.false;
    });
  });


  describe('Sanity tests', function() {
    const A = new SRVRecord({name: 'SRV', target: 'A'});
    const B = new SRVRecord({name: 'SRV', target: 'B'});

    it('should stop on conflicting answer packet', () => {
      const probe = new Probe(intf, offswitch);
      sinon.spy(probe, 'emit');

      const incomingPacket = new Packet();
      incomingPacket.setAnswers([B]);

      probe.add(A);
      probe.bridgeable([A]);

      probe._send(); // instead of probe.start() to skip initial 0-250ms delay

      jest.advanceTimersByTime(250);
      expect(intf.send).to.have.callCount(2);

      jest.advanceTimersByTime(250);
      expect(intf.send).to.have.callCount(3);

      intf.emit('answer', incomingPacket);

      expect(probe.emit).to.have.been.calledWith('conflict');
    });

    it('should pause and continue with a rogue probe conflict', () => {
      const probe = new Probe(intf, offswitch);
      sinon.spy(probe, 'emit');

      const incomingPacket = new Packet();
      incomingPacket.setAuthorities([B]);

      probe.add(A);
      probe.bridgeable([A]);

      probe._send(); // instead of probe.start() to skip initial 0-250ms delay

      jest.advanceTimersByTime(250);
      expect(intf.send).to.have.callCount(2);

      intf.emit('probe', incomingPacket);

      // waits 1s before
      jest.advanceTimersByTime(1000);
      expect(intf.send).to.have.callCount(3);

      jest.advanceTimersByTime(250);
      expect(intf.send).to.have.callCount(4);

      jest.advanceTimersByTime(250);
      expect(intf.send).to.have.callCount(5);

      jest.advanceTimersByTime(250);
      expect(intf.send).to.not.have.callCount(6);
      expect(probe.emit).to.have.been.calledWith('complete');
    });
  });

});
