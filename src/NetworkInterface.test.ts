import * as chai from 'chai';
import * as dgram from 'dgram';
import { expect } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import _ from 'lodash';

chai.use(sinonChai);

import { Packet } from './Packet';
import { PTRRecord, SRVRecord, TXTRecord } from './ResourceRecord';
import { QueryRecord } from './QueryRecord';
import { NetworkInterface } from './NetworkInterface';

import * as Fake from './test/Fake';
import { Platform } from './Platform';
import { Socket } from 'dgram';
import { jest } from '@jest/globals';

jest.useFakeTimers();

describe('NetworkInterface', function() {
  // interface addresses, same form as os.networkInterfaces() output
  const interfaceAddresses = {
    'Ethernet':
     [ { address: 'fe80::73b6:73b6:73b6:73b6',
         family: 'IPv6',
         internal: false },
       { address: '169.254.100.175',
         family: 'IPv4',
         internal: false } ],
    'Wi-Fi':
     [ { address: 'fe80::7b30:7b30:7b30:7b30',
         family: 'IPv6',
         internal: false },
       { address: '192.168.1.5',
         family: 'IPv4',
         internal: false } ],
    'Loopback':
     [ { address: '::1',
         family: 'IPv6',
         internal: true },
       { address: '127.0.0.1',
         family: 'IPv4',
         internal: true } ],
  };

  sinon.stub(Platform, 'getNetworkInterfaces').returns(<any>interfaceAddresses);

  beforeEach(function() {
    (NetworkInterface as any).active = {};
  });


  describe('::get()', function() {
    it('should make a new NetworkInterface for `any`', function() {
      const networkInterface = NetworkInterface.get();

      expect(networkInterface).to.be.instanceof(NetworkInterface);
    });

    it('should return existing interface', function() {
      const networkInterface  = NetworkInterface.get();
      const copy = NetworkInterface.get();

      expect(networkInterface).to.equal(copy); // same object
    });

    it('should make a new NetworkInterface using a given multicast interface name', function() {
      const networkInterface = NetworkInterface.get('Ethernet');
      const copy = NetworkInterface.get('Ethernet');

      expect(networkInterface).to.be.instanceof(NetworkInterface);
      expect(networkInterface).to.equal(copy); // same object
    });

    it('should make a new NetworkInterface using a given multicast IPv4 address', function() {
      const networkInterface = NetworkInterface.get('192.168.1.5');
      const copy = NetworkInterface.get('192.168.1.5');

      expect(networkInterface).to.be.instanceof(NetworkInterface);
      expect(networkInterface).to.equal(copy); // same object
    });

    it('should throw with a decent error msg on bad input', function() {
      const one = NetworkInterface.get.bind(null, 'bad input'); // unknown interface
      const two = NetworkInterface.get.bind(null, '111.222.333.444'); // unknown address

      expect(one).to.throw();
      expect(two).to.throw();
    });
  });


  describe('::getLoopback()', function() {
    it('should return the name of the loopback interface, if any', function() {
      expect(NetworkInterface.getLoopback()).to.equal('Loopback');
    });
  });


  describe('#constructor()', function() {
    it('should init with proper defaults', function() {
      const networkInterface = new NetworkInterface();

      expect((networkInterface as any)._usingMe).to.equal(0);
      expect((networkInterface as any)._isBound).to.equal(false);
      expect((networkInterface as any)._sockets).to.be.empty;
    });
  });


  describe('#bind()', function() {
    function stubBind(networkInterface: NetworkInterface, returnValue: Promise<void>) {
      sinon.stub(networkInterface as any, '_bindSocket').returns(returnValue);
    }

    it('should resolve when every socket is bound', function(done) {
      const networkInterface = new NetworkInterface();
      stubBind(networkInterface, Promise.resolve());

      networkInterface.bind().then(() => {
        expect((networkInterface as any)._isBound).to.be.true;
        expect((networkInterface as any)._usingMe).to.equal(1);
        done();
      });
    });

    it('should reject if binding fails', function(done) {
      const networkInterface = new NetworkInterface();
      stubBind(networkInterface, Promise.reject());

      networkInterface.bind().catch(() => {
        expect((networkInterface as any)._isBound).to.be.false;
        expect((networkInterface as any)._usingMe).to.equal(0);
        done();
      });
    });

    it('should resolve immediately if already bound', function(done) {
      const networkInterface = new NetworkInterface();
      stubBind(networkInterface, Promise.resolve());

      // bind twice, 2nd bind should be immediate with no re-bind
      networkInterface.bind()
        .then(() => {
          expect((networkInterface as any)._bindSocket).to.have.callCount(1);
          networkInterface.bind();
        })
        .then(() => {
          expect((networkInterface as any)._bindSocket).to.have.callCount(1);
          expect((networkInterface as any)._usingMe).to.equal(2);
          done();
        });
    });

    it('should prevent concurrent binds, only binding once', async () => {
      const networkInterface = new NetworkInterface();
      stubBind(networkInterface, Promise.resolve());

      await Promise.all([ 
        networkInterface.bind(),
        networkInterface.bind()
      ]);
      
      expect((networkInterface as any)._bindSocket).to.have.callCount(1);
      expect((networkInterface as any)._usingMe).to.equal(2);
      expect((networkInterface as any)._isBound).to.be.true;
    });

    it('should fail on both concurrents if binding fails', function(done) {
      const networkInterface = new NetworkInterface();
      stubBind(networkInterface, Promise.reject());

      const onFail = _.after(2, () => {
        expect((networkInterface as any)._usingMe).to.equal(0);
        expect((networkInterface as any)._isBound).to.be.false;
        done();
      });

      networkInterface.bind().catch(onFail);
      networkInterface.bind().catch(onFail);
    });
  });


  describe('#_bindSocket()', function() {

    function harness(name?: string, address?: string) {
      const socket = Fake.Socket();
      socket.address.returns(<any>{});

      class NetworkInterfaceWithMocks extends NetworkInterface {
        protected createSocket(type: dgram.SocketType): Socket {
          return socket;
        }
      }

      return {
        socket,
        networkInterface: new NetworkInterfaceWithMocks(name, address)
      }
    }

    function bindSocket(networkInterface: NetworkInterface): Promise<void> {
      let promise = (networkInterface as any)._bindSocket();
      jest.advanceTimersByTime(11);
      return promise;
    }

    function emitSocketListening(socket: dgram.Socket) {
      setTimeout(() => socket.emit('listening'), 10);
    }

    function emitSocketError(socket: dgram.Socket) {
      setTimeout(() => socket.emit('error'), 10);
    }

    function getSocket(networkInterface: NetworkInterface): dgram.Socket {
      return (networkInterface as any)._sockets[0];
    }

    beforeEach(() => sinon.resetHistory());

    it('should create IPv4 socket and resolve when bound', async () => {
      const { networkInterface, socket } = harness();
      const createSocket = sinon.spy(networkInterface as any, 'createSocket');

      emitSocketListening(socket);
      await bindSocket(networkInterface);

      expect(createSocket).to.have.been.calledWith('udp4');
    });

    it('should `setMulticastInterface` if needed', async () => {
      const { networkInterface, socket } = harness('Ethernet', '169.254.100.175');

      emitSocketListening(socket);
      await bindSocket(networkInterface);
      expect(socket.setMulticastInterface)
        .to.have.been.calledWith('169.254.100.175');
    });

    it('should reject if bind fails', async () => {
      const { networkInterface, socket } = harness();
      sinon.stub(networkInterface as any, '_onError');

      emitSocketError(socket);
      try {
        await bindSocket(networkInterface);
      } catch (e) {
        expect((networkInterface as any)._onError).to.not.have.been.called;
        expect((networkInterface as any)._sockets).to.be.empty;
        return;
      }

      throw new Error(`bindSocket() should have rejected`);
    });

    it('should _onError when socket closes unexpectedly', (done) => {
      const { networkInterface, socket } = harness();

      sinon.stub(networkInterface as any, '_onError').callsFake(() => done());

      emitSocketListening(socket);
      bindSocket(networkInterface).then(() => socket.emit('close'));
    });

    it('should _onError on socket errors', function(done) {
      const { networkInterface, socket } = harness();
      sinon.stub(networkInterface as any, '_onError').callsFake(() => done());
      emitSocketListening(socket);
      bindSocket(networkInterface).then(() => socket.emit('error'));
    });

    it('should _onMessage when socket receives a message', function(done) {
      const { networkInterface, socket } = harness();
      sinon.stub(networkInterface, '_onMessage').callsFake(() => done());

      bindSocket(networkInterface);
      socket.emit('message', 'fake msg', {fake: 'rinfo'});
    });
  });


  describe('#_addToCache()', function() {
    it('should add records to cache & flush unique records', () => {
      const networkInterface = new NetworkInterface();

      const unique = new TXTRecord({name: 'TXT'});
      const shared = new PTRRecord({name: 'PTR'});

      const packet = new Packet();
      packet.setAnswers([unique]);
      packet.setAdditionals([shared]);

      sinon.spy(networkInterface.cache, 'add');
      sinon.spy(networkInterface.cache, 'flushRelated');

      networkInterface._addToCache(packet);

      expect(networkInterface.cache.flushRelated).to.have.been
        .calledOnce
        .calledWith(unique);

      expect(networkInterface.cache.add).to.have.been
        .calledTwice
        .calledWith(unique)
        .calledWith(shared);
    });
  });


  describe('#_onMessage()', function() {
    const msg = (new Packet()).toBuffer();
    const rinfo: dgram.RemoteInfo = {
      address: '1.1.1.1', 
      port: 5353,
      family: 'IPv4',
      size: 0
    };

    const PacketConstructor = sinon.stub();
    let revert;

    function harness(packet: Packet) {
      class NetworkInterfaceWithMocks extends NetworkInterface {
        protected createPacket(msg: Buffer, origin: dgram.RemoteInfo): Packet {
          return packet;
        }
      }

      return {
        packet,
        networkInterface: new NetworkInterfaceWithMocks()
      }
    }

    afterEach(() => sinon.resetBehavior());

    it('should emit answer event on answer messages', done => {
      const { networkInterface, packet } = harness(
          new Packet()
            .setAnswers([new TXTRecord({name: 'TXT'})])
            .setResponseBit()
      );

      networkInterface.on('answer', (arg) => {
        expect(arg).to.equal(packet);
        done();
      });

      networkInterface._onMessage(msg, rinfo);
    });

    it('should emit probe event on probe messages', done => {
      const { networkInterface, packet } = harness(
        new Packet()
          .setQuestions([new QueryRecord({name: 'TXT'})])
          .setAuthorities([new TXTRecord({name: 'TXT'})])
      );

      PacketConstructor.returns(packet);

      networkInterface.on('probe', (arg) => {
        expect(arg).to.equal(packet);
        done();
      });

      networkInterface._onMessage(msg, rinfo);
    });

    it('should emit query event on query messages', function(done) {
      const { networkInterface, packet } = harness(
        new Packet()
          .setQuestions([new QueryRecord({name: 'TXT'})])
      );

      networkInterface.on('query', (arg) => {
        expect(arg).to.equal(packet);
        done();
      });

      networkInterface._onMessage(msg, rinfo);
    });

    it('should skip over packets that are invalid', function() {
      const invalidPacket = new Packet()
        .setQuestions([new QueryRecord({name: 'TXT'})]);

      sinon.stub(invalidPacket, 'isValid').returns(false);

      const { networkInterface } = harness(invalidPacket);

      sinon.stub(networkInterface, 'emit');
      networkInterface._onMessage(msg, rinfo);

      expect(networkInterface.emit).to.not.have.been.called;
    });
  });

  describe('#hasRecentlySent()', function() {
    it('should be true if recently sent / false if not', () => {
      const networkInterface = new NetworkInterface();
      const SRV  = new SRVRecord({name: 'SRV'});

      expect(networkInterface.hasRecentlySent(SRV)).to.be.false;
      (networkInterface as any)._history.add(SRV);
      expect(networkInterface.hasRecentlySent(SRV)).to.be.true;
      expect(networkInterface.hasRecentlySent(SRV, 5)).to.be.true;

      jest.advanceTimersByTime(10_000);
      expect(networkInterface.hasRecentlySent(SRV, 5)).to.be.false;
    });
  });

  describe('#send()', function() {
    const answer = new TXTRecord({name: 'Answer Record'});
    const question = new QueryRecord({name: 'Question Record'});
    const callback = sinon.stub();

    function harness() {
      const socket = Fake.Socket();
      socket.address.returns(<any>{family: 'IPv4'});

      const networkInterface = new NetworkInterface();
      (networkInterface as any)._sockets.push(socket);
      (networkInterface as any)._isBound = true;

      socket.send.yields();

      return { socket, networkInterface };
    }

    beforeEach(() => sinon.resetHistory());

    it('should do nothing if not bound yet', function() {
      const { networkInterface, socket } = harness();

      (networkInterface as any)._isBound = false;
      networkInterface.send(null, null, callback);

      expect(callback).to.have.been.called;
      expect(socket.send).to.not.have.been.called;
    });

    it('should do nothing if packet is empty', function() {
      const { networkInterface, socket } = harness();
      
      networkInterface.send(new Packet(), null, callback);

      expect(callback).to.have.been.called;
      expect(socket.send).to.not.have.been.called;
    });

    it('should do nothing if destination is not link local', function() {
      const { networkInterface, socket } = harness();
      
      const packet = new Packet();
      packet.setQuestions([question]);

      networkInterface.send(packet, {address: '7.7.7.7'}, callback);

      expect(socket.send).to.not.have.been.called;
    });

    it('should send packet to given destination', function() {
      const { networkInterface, socket } = harness();
      
      const packet = new Packet();
      packet.setQuestions([question]);

      const destination = {address: '192.168.1.10', port: 4321};

      networkInterface.send(packet, destination, callback);

      let callArgs = socket.send.firstCall.args as any[];
      expect(callArgs[3]).to.equal(destination.port);
      expect(callArgs[4]).to.equal(destination.address);
      expect(callback).to.have.been.called;
    });

    it('should not send packet to destination on wrong IPv socket', function() {
      const { networkInterface, socket } = harness();
      
      const packet = new Packet();
      packet.setQuestions([question]);

      networkInterface.send(packet, {address: '::1'}, callback);

      expect(socket.send).to.not.have.been.called;
    });

    it('should send packet to multicast address', function() {
      const { networkInterface, socket } = harness();
      
      const packet = new Packet();
      packet.setQuestions([question]);

      networkInterface.send(packet, null, callback);

      let callArgs = socket.send.firstCall.args as any[];
      expect(callArgs[3]).to.equal(5353);
      expect(callArgs[4]).to.equal('224.0.0.251');
    });

    it('should add outgoing answers to interface history', function() {
      const { networkInterface, socket } = harness();
      
      const packet = new Packet();
      packet.setAnswers([answer]);
      packet.setResponseBit();

      networkInterface.send(packet, null, callback);

      expect(networkInterface.hasRecentlySent(answer)).to.be.true;
    });

    it('should split packet and resend on EMSGSIZE', () => {
      const { networkInterface, socket } = harness();

      const err = new Error();
      err['code'] = 'EMSGSIZE';

      socket.send.onFirstCall().yields(err);

      const packet = new Packet();
      packet.setQuestions([question]);

      sinon.spy(networkInterface, 'send');
      
      networkInterface.send(packet);

      expect(networkInterface.send).to.have.callCount(3); // first call + 2 more for each half
    });

    it('should _onError for anything else', function(done) {
      const { networkInterface, socket } = harness();
      
      socket.send.yields(new Error());

      const packet = new Packet();
      packet.setQuestions([question]);

      networkInterface.on('error', () => done());
      networkInterface.send(packet);
    });
  });


  describe('#_onError()', function() {
    it('should shutdown and emit error', function() {
      const networkInterface = new NetworkInterface();
      sinon.stub(networkInterface, 'stop');
      sinon.stub(networkInterface, 'emit');

      const err = new Error();
      (networkInterface as any)._onError(err);

      expect(networkInterface.stop).to.have.been.called;
      expect(networkInterface.emit).to.have.been.calledWith('error', err);
    });
  });


  describe('#stopUsing()', function() {
    it('should only shutdown when no one is using it anymore', function() {
      const networkInterface = new NetworkInterface();
      (networkInterface as any)._usingMe = 2;

      sinon.stub(networkInterface, 'stop');

      networkInterface.stopUsing();
      expect(networkInterface.stop).to.not.have.been.called;

      networkInterface.stopUsing();
      expect(networkInterface.stop).to.have.been.called;
    });
  });


  describe('#stop()', function() {
    it('should remove all listeners from sockets before closing', function() {
      const networkInterface = new NetworkInterface();
      const socket = Fake.Socket();

      socket.close.callsFake(() => {
        socket.emit('close');
        return socket;
      });

      socket.on('close', () => {
        throw new Error('Should remove listeners first!');
      });

      (networkInterface as any)._sockets = [socket];
      networkInterface.stop();
    });

    it('should not throw on socket.close() calls', function() {
      const networkInterface = new NetworkInterface();
      const socket = Fake.Socket();

      socket.close.throws('Already closed!');

      (networkInterface as any)._sockets = [socket];
      networkInterface.stop();
    });
  });

});
