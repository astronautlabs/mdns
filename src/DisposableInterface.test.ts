import { expect } from 'chai';
import sinon from 'sinon';

import { DisposableInterface as RealDisposableInterface } from './DisposableInterface';
import { SocketType, Socket } from 'dgram';
import { Platform } from './Platform';

import * as Fake from './test/Fake';

describe('DisposableInterface', function() {
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

  const wifi = interfaceAddresses['Wi-Fi'];
  const IPv6 = wifi[0];
  const IPv4 = wifi[1];

  sinon.stub(Platform, 'getNetworkInterfaces').returns(<any>interfaceAddresses);

  function harness(name?: any) {
    const socket = Fake.Socket();
    socket.address.returns(<any>{});
  
    class DisposableInterfaceWithMocks extends RealDisposableInterface {
      protected createSocket(type: SocketType): Socket {
        return socket;
      }
    }

    return {
      socket,
      networkInterface: DisposableInterfaceWithMocks.create(name)
    };
  }

  beforeEach(function() {
    sinon.resetHistory();
    // socket.resetHistory();
    // dgram.createSocket.resetHistory();
  });

  describe('::create()', function() {
    it('should make a new DisposableInterface on INADDR_ANY', function() {
      const { networkInterface } = harness();

      expect(networkInterface).to.be.instanceof(RealDisposableInterface);
      expect((networkInterface as any)._addresses).to.eql([{address: '0.0.0.0', family: 'IPv4'}]);
    });

    it('should return new interface from an interface name', function() {
      const { networkInterface } = harness('Wi-Fi');

      expect(networkInterface).to.be.instanceof(RealDisposableInterface);
      expect((networkInterface as any)._addresses).to.equal(wifi);
    });
  });


  describe('::isValidName()', function() {
    it('should be false for bad inputs: "", {}, []', function() {
      expect((RealDisposableInterface as any).isValidName()).to.be.false;
      expect(RealDisposableInterface.isValidName('')).to.be.false;
      expect(RealDisposableInterface.isValidName(<any>{})).to.be.false;
    });

    it('should be true for active interfaces', function() {
      expect(RealDisposableInterface.isValidName('Ethernet')).to.be.true;
      expect(RealDisposableInterface.isValidName('Wi-Fi')).to.be.true;
    });

    it('should be false for inactive/non-existent interfaces', function() {
      expect(RealDisposableInterface.isValidName('ScoobyDoo')).to.be.false;
    });
  });


  describe('#.bind()', function() {
    it('should bind a socket for each address', function(done) {
      const { networkInterface } = harness('Wi-Fi');
      sinon.stub(networkInterface as any, '_bindSocketWithAddress').returns(Promise.resolve());

      networkInterface.bind().then(done);
    });
  });


  describe('#_bindSocketWithAddress()', function() {
    it('should create IPv4 socket and resolve when bound', async () => {
      const { networkInterface, socket } = harness('Wi-Fi');
      const createSocket = sinon.spy(networkInterface as any, 'createSocket');

      setTimeout(() => socket.emit('listening'), 10);
      await (networkInterface as any)._bindSocketWithAddress(IPv4);
      expect(createSocket).to.have.been.calledWith('udp4');
    });

    it('should create IPv6 socket and resolve when bound', async () => {
      const { networkInterface, socket } = harness('Wi-Fi');
      const createSocket = sinon.spy(networkInterface as any, 'createSocket');

      setTimeout(() => socket.emit('listening'), 10);
      await (networkInterface as any)._bindSocketWithAddress(IPv6);
      
      expect(createSocket).to.have.been.calledWith('udp6');
    });

    it('should reject if bind fails', async () => {
      const { networkInterface, socket } = harness('Wi-Fi');

      setTimeout(() => {
        socket.on('error', () => {});
        socket.emit('error');
      }, 10);

      try {
        await (networkInterface as any)._bindSocketWithAddress(IPv4);
      } catch (e) {
        return;
      }

      throw new Error(`Expected bind to reject`);
    });

    it('should _onError when socket closes unexpectedly', function(done) {
      const { networkInterface, socket } = harness('Wi-Fi');
      sinon.stub(networkInterface as any, '_onError').callsFake(() => done());

      (networkInterface as any)._bindSocketWithAddress(IPv4).then(() => socket.emit('close'));

      socket.emit('listening');
    });

    it('should _onError on any other unexpected error', function(done) {
      const { networkInterface, socket } = harness('Wi-Fi');
      sinon.stub(networkInterface as any, '_onError').callsFake(() => done());

      (networkInterface as any)._bindSocketWithAddress(IPv4).then(() => socket.emit('error'));

      socket.emit('listening');
    });

    it('should _onMessage when socket receives a message', function(done) {
      const { networkInterface, socket } = harness('Wi-Fi');
      sinon.stub(networkInterface, '_onMessage').callsFake(() => done());

      (networkInterface as any)._bindSocketWithAddress(IPv4).then(() => {
        console.log(`EMIT MESSAG`);
        socket.emit('message')
      });

      socket.emit('listening');
    });
  });

});
