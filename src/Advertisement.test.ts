import * as os from 'os';
import { expect } from 'chai';
import sinon from 'sinon';

import { ServiceType } from './ServiceType';
import { AAAARecord, ARecord, NSECRecord, PTRRecord, ResourceRecord, SRVRecord, TXTRecord } from './ResourceRecord';
import { Packet } from './Packet';
import { AdvertisementOptions, Advertisement as RealAdvertisement } from './Advertisement';

import * as Fake from './test-mocks';
import { NetworkInterface } from './NetworkInterface';
import { Responder } from './Responder';
import { sleep } from './sleep';
import { Platform } from './Platform';

const INTERFACES: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
  'Ethernet':
    [ { address: 'fe80::73b6:73b6:73b6:73b6',
        family: 'IPv6',
        cidr: 'fdd3:7382:7990:15c:c561:3467:40f:9e8e/128',
        mac: '34:60:f9:38:0f:7b',
        netmask: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
        scopeid: 0,
        internal: false },
      { address: '169.254.100.175',
        family: 'IPv4',
        cidr: '192.168.86.32/24',
        mac: '34:60:f9:38:0f:7b',
        netmask: '255.255.255.0',
        internal: false } ],
  'Wi-Fi':
    [ { address: 'fe80::7b30:7b30:7b30:7b30',
        family: 'IPv6',
        cidr: 'fdd3:7382:7990:15c:c561:3467:40f:9e8e/128',
        mac: '34:60:f9:38:0f:7b',
        netmask: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
        scopeid: 0,
        internal: false },
      { address: '192.168.1.5',
        family: 'IPv4',
        cidr: '192.168.86.32/24',
        mac: '34:60:f9:38:0f:7b',
        netmask: '255.255.255.0',
        internal: false } ],
  'Loopback':
    [ { address: '::1',
        family: 'IPv6',
        cidr: 'fdd3:7382:7990:15c:c561:3467:40f:9e8e/128',
        mac: '34:60:f9:38:0f:7b',
        netmask: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
        scopeid: 0,
        internal: true },
      { address: '127.0.0.1',
        family: 'IPv4',
        cidr: '192.168.86.32/24',
        mac: '34:60:f9:38:0f:7b',
        netmask: '255.255.255.0',
        internal: true } ],
};

sinon.stub(Platform, 'getNetworkInterfaces').returns(INTERFACES);

describe('Advertisement', () => {
  beforeEach(() => {
    sinon.resetHistory();
    sleep.removeAllListeners();
  });

  function harness(type: any, port: number, options?: AdvertisementOptions) {
    // interface addresses, same form as os.networkInterfaces() output
    const networkInterface = Fake.NetworkInterface();
    const responder = Fake.Responder();
    
    class Advertisement extends RealAdvertisement {
      protected resolveNetworkInterface(name?: string): NetworkInterface {
        return networkInterface;
      }

      protected createResponder(records: ResourceRecord[], bridgeable: ResourceRecord[]): Responder {
        return <any>responder;
      }
    }

    return {
      networkInterface,
      responder,
      ad: new Advertisement(type, port, options)
    }
  }

  describe('#constructor()', () => {
    it('should accept service param as a ServiceType (no throw)', () => {
      harness(new ServiceType('_http._tcp'), 1234);
    });

    it('should accept service param as an object (no throw)', () => {
      harness({name: '_http', protocol: '_tcp'}, 1234);
    });

    it('should accept service param as a string (no throw)', () => {
      harness('_http._tcp', 1234);
    });

    it('should accept service param as an array (no throw)', () => {
      harness(['_http', '_tcp'], 1234);
    });

    it('should throw on invalid service types', () => {
      expect(() => harness('gunna throw', 1234)).to.throw(Error);
    });

    it('should throw on missing/invalid ports', () => {
      expect(() => harness('_http._tcp', undefined)).to.throw(Error);
      expect(() => harness('_http._tcp', 'Port 1000000' as any)).to.throw(Error);
    });

    it('should throw on invalid TXT data', () => {
      expect(() => harness('_http._tcp', 1234, { txt: <any>'invalid'})).to.throw(Error);
    });

    it('should throw on invalid instance names', () => {
      expect(() => harness('_http._tcp', 1234, { name: <any>123 })).to.throw(Error);
    });

    it('should throw on invalid hostnames', () => {
      expect(() => harness('_http._tcp', 1234, { host: <any>123 })).to.throw(Error);
    });
  });


  describe('#start()', () => {
    it('should bind interfaces & start advertising', function(done) {
      const { ad, networkInterface } = harness('_http._tcp', 1234);

      sinon.stub(ad as any, '_getDefaultID').returns(Promise.resolve());
      sinon.stub(ad as any, '_advertiseHostname').returns(Promise.resolve());

      sinon.stub(ad as any, '_advertiseService').callsFake(() => {
        expect(networkInterface.bind).to.have.been.called;
        done();
      });

      ad.start();
    });

    it('should return early if already started', function(done) {
      const { ad } = harness('_http._tcp', 1234);

      sinon.stub(ad as any, '_getDefaultID');
      sinon.stub(ad as any, '_advertiseHostname');
      sinon.stub(ad as any, '_advertiseService');

      ad.start();
      ad.start(); // <-- does nothing

      // wait for promises
      setTimeout(() => {
        expect((ad as any)._getDefaultID).to.have.been.calledOnce
        done();
      }, 10);
    });

    it('should run _onError if something breaks in the chain', function(done) {
      const { ad } = harness('_http._tcp', 1234);
      
      sinon.stub((ad as any), '_getDefaultID').returns(Promise.reject());

      ad.on('error', () => done());
      ad.start();
    });
  });


  describe('#stop()', () => {
    it('should remove interface listeners and deregister', function(done) {
      const { ad, networkInterface } = harness('_http._tcp', 1234);

      ad.on('stopped', () => {
        //expect(networkInterface.removeListenersCreatedBy).to.have.been.calledWith(ad);
        expect(networkInterface.stopUsing).to.have.been.called;
        done();
      });

      ad.stop();
    });

    it('should allow both responders to goodbye on clean stops', function(done) {
      const { ad, responder } = harness('_http._tcp', 1234);

      (ad as any)._hostnameResponder = responder;
      (ad as any)._serviceResponder  = responder;

      ad.on('stopped', () => {
        expect(responder.goodbye).to.have.been.calledTwice;
        done();
      });

      ad.stop();
    });

    it('should allow one responder to goodbye (if ad only has 1)', function(done) {
      const { ad, responder } = harness('_http._tcp', 1234);

      (ad as any)._hostnameResponder = responder;
      (ad as any)._serviceResponder  = null;

      ad.on('stopped', () => {
        expect(responder.goodbye).to.have.been.called;
        done();
      });

      ad.stop();
    });

    it('should stop immediately with stop(true)', function(done) {
      const { ad, responder } = harness('_http._tcp', 1234);

      (ad as any)._hostnameResponder = responder;
      (ad as any)._serviceResponder  = responder;

      ad.on('stopped', () => {
        expect(responder.stop).to.have.been.calledTwice;
        done();
      });

      ad.stop(true);
    });
  });


  describe('#updateTXT()', () => {
    it('should validate TXTs before updating', () => {
      const { ad, responder } = harness('_http._tcp', 1234);

      (ad as any)._serviceResponder = responder;

      expect(() => ad.updateTXT('Not a valid TXT object' as any)).to.throw(Error);
      expect(() => ad.updateTXT({a: 'valid TXT object'})).to.not.throw(Error);
    });

    it('should update record\'s txt and txtRaw ', function(done) {
      const { ad } = harness('_http._tcp', 1234);

      const TXT = new TXTRecord({name: 'TXT', txt: {}});

      (ad as any)._serviceResponder = Fake.Responder();
      (ad as any)._serviceResponder.updateEach.yields(TXT);

      ad.updateTXT({a: 'valid TXT object'});

      setImmediate(() => {
        expect(TXT.txtRaw).to.not.be.empty;
        expect(TXT.txt).to.not.be.empty;
        done();
      });
    });
  });


  describe('#_restart()', () => {
    it('should stop/recreate responders when waking from sleep', function(done) {
      
      const { ad, responder } = harness('_http._tcp', 1234);
      
      // one call of _advertiseService for start, another for the restart
      let count = 0;
      const complete = () => { (++count === 2) && done(); };
      
      (ad as any)._serviceResponder = responder;
      (ad as any)._hostnameResponder = responder;

      sinon.stub((ad as any), '_getDefaultID').returns(Promise.resolve());
      sinon.stub((ad as any), '_advertiseHostname').returns(Promise.resolve());
      sinon.stub((ad as any), '_advertiseService').callsFake(() => complete());

      ad.start();
      sleep.emit('wake');

      expect(responder.stop).to.have.been.calledTwice;
    });
  });


  describe('#_getDefaultID()', () => {
    it('should set the default interface addresses based on answer', function(done) {
      const { ad, networkInterface } = harness('_http._tcp', 1234);

      const packet = new Packet();
      packet.origin.address = '169.254.100.175';

      sinon.stub(packet, 'isLocal').returns(true);
      sinon.stub(packet, 'equals').returns(true);

      (ad as any)._getDefaultID().then(() => {
        expect((ad as any)._defaultAddresses).to.equal(INTERFACES['Ethernet']);
        done();
      });

      networkInterface.emit('query', packet);
    });

    it('should err out after 500ms with no answer', function(done) {
      const { ad, networkInterface } = harness('_http._tcp', 1234);

      const packet_1 = new Packet();
      sinon.stub(packet_1, 'isLocal').returns(false);
      sinon.stub(packet_1, 'equals').returns(false);

      const packet_2 = new Packet();
      packet_2.origin.address = 'somehing.wrong';

      sinon.stub(packet_2, 'isLocal').returns(true);
      sinon.stub(packet_2, 'equals').returns(true);

      (ad as any)._getDefaultID().catch(() => done());

      networkInterface.emit('query', packet_1);
      networkInterface.emit('query', packet_2);
    });
  });


  describe('#_advertiseHostname()', () => {
    it('should start a Responder w/ the right records & interfaces', function(done) {
      const { ad, responder } = harness('_http._tcp', 1234);

      const createResponder = sinon.mock().returns(responder);
      (ad as any).createResponder = createResponder;

      (ad as any)._defaultAddresses = [];

      const A = new ARecord({name: 'A'});
      const AAAA = new AAAARecord({name: 'AAAA', address: 'FE80::'});

      const makeRecords = sinon.stub((ad as any), '_makeAddressRecords');
      makeRecords.returns([AAAA]);
      makeRecords.withArgs((ad as any)._defaultAddresses).returns([A]);

      (ad as any)._advertiseHostname().then(() => done());

      const expected = [AAAA, AAAA, AAAA]; // one per interfacae

      expect(createResponder).to.have.been
        .calledWith([A], expected);

      responder.emit('probingComplete'); // <-- gets created with ^
    });

    it('should handle rename events with _onHostRename', () => {
      const { ad, responder } = harness('_http._tcp', 1234);

      sinon.stub((ad as any), '_makeAddressRecords');
      sinon.stub((ad as any), '_onHostRename');

      (ad as any)._advertiseHostname();
      responder.emit('rename');

      expect((ad as any)._onHostRename).to.have.been.called;
    });
  });


  describe('#_onHostRename()', () => {
    it('should update ad.hostname and emit the new target', () => {
      const { ad } = harness('_http._tcp', 1234, { host: 'Host' });

      (ad as any)._onHostRename('Host (2)');

      ad.on('hostRenamed', (name) => {
        expect(name).to.equal('Host (2).local.');
        expect(ad.hostname).to.equal('Host (2)');
      });
    });

    it('should update the service responders SRV targets', () => {
      const { ad } = harness('_http._tcp', 1234, { host: 'Host' });

      const SRV = new SRVRecord({name: 'SRV', target: 'Host'});

      const serviceResponder = Fake.Responder();
      serviceResponder.updateEach.yields(SRV);
      (ad as any)._serviceResponder = <any>serviceResponder;
      (ad as any)._onHostRename('Host (2)');

      expect(SRV.target).to.be.equal('Host (2).local.');
    });
  });


  describe('#_advertiseService()', () => {
    it('should start a Responder w/ the right records & interfaces', () => {
      const { ad, responder } = harness('_http._tcp', 1234);

      const createResponder = sinon.mock().returns(responder);
      (ad as any).createResponder = createResponder;

      const SRV = new SRVRecord({name: 'SRV'});
      sinon.stub((ad as any), '_makeServiceRecords').returns([SRV]);

      (ad as any)._advertiseService();

      expect(createResponder).to.have.been.calledWith([SRV]);
    });

    it('should listen to responder probingComplete event', function(done) {
      const { ad, responder } = harness('_http._tcp', 1234);

      const createResponder = sinon.mock().returns(responder);
      (ad as any).createResponder = createResponder;

      sinon.stub((ad as any), '_makeServiceRecords').returns([]);

      ad.on('active', done);

      (ad as any)._advertiseService();

      expect(createResponder).to.have.been.calledWith([]);
      responder.emit('probingComplete'); // <-- gets created with ^
    });

    it('should listen to responder rename event', () => {
      const { ad, responder } = harness('_http._tcp', 1234, { name: 'Instance' });

      sinon.stub((ad as any), '_makeServiceRecords').returns([]);

      ad.on('instanceRenamed', function(instance) {
        expect(instance).to.equal('Instance (2)');
        expect(ad.instanceName).to.equal('Instance (2)');
      });

      (ad as any)._advertiseService();

      responder.emit('rename', 'Instance (2)');
    });
  });


  describe('#_makeAddressRecords()', () => {
    const IPv4s = [{family: 'IPv4' as const, address: '123.123.123.123'}];
    const IPv6s = [{family: 'IPv6' as const, address: '::1'},
                   {family: 'IPv6' as const, address: 'FE80::TEST'}];

    it('should return A/NSEC with IPv4 only interfaces', () => {
      const { ad } = harness('_http._tcp', 1234);
      const records = (ad as any)._makeAddressRecords(IPv4s);

      expect(records).to.have.lengthOf(2);
      expect(records[0]).to.be.instanceOf(ARecord);
      expect(records[1]).to.be.instanceOf(NSECRecord);
      expect((records[1] as NSECRecord).existing).to.eql([1]);
    });

    it('should return AAAA/NSEC with IPv6 only interfaces', () => {
      const { ad } = harness('_http._tcp', 1234);
      const records = (ad as any)._makeAddressRecords(IPv6s);

      expect(records).to.have.lengthOf(2);
      expect(records[0]).to.be.instanceOf(AAAARecord); // <-- only one
      expect(records[1]).to.be.instanceOf(NSECRecord);
      expect((records[1] as NSECRecord).existing).to.eql([28]);
    });

    it('should return A/AAAA/NSEC with IPv4/IPv6 interfaces', () => {
      const { ad } = harness('_http._tcp', 1234);
      const both  = [...IPv4s, ...IPv6s];
      const records = (ad as any)._makeAddressRecords(both);

      expect(records).to.have.lengthOf(3);
      expect(records[0]).to.be.instanceOf(ARecord);
      expect(records[1]).to.be.instanceOf(AAAARecord); // <-- only one
      expect(records[2]).to.be.instanceOf(NSECRecord);
      expect((records[2] as NSECRecord).existing).to.eql([1, 28]);
    });
  });


  describe('#_makeServiceRecords()', () => {
    it('should make SRV/TXT/PTR records', () => {
      const { ad } = harness('_http._tcp', 1234, { name: 'Instance', subtypes: ['_printer'] });

      const hostnameResponder = Fake.Responder();;
      (ad as any)._hostnameResponder = <any>hostnameResponder;
      hostnameResponder.getRecords.returns([]);

      const records = (ad as any)._makeServiceRecords();

      expect(records).to.have.lengthOf(6);

      expect(records[0]).to.be.instanceOf(SRVRecord);
      expect(records[0].name).to.equal('Instance._http._tcp.local.');

      expect(records[1]).to.be.instanceOf(TXTRecord);
      expect(records[1].name).to.equal('Instance._http._tcp.local.');

      expect(records[2]).to.be.instanceOf(NSECRecord);
      expect(records[2].name).to.equal('Instance._http._tcp.local.');

      expect(records[3]).to.be.instanceOf(PTRRecord);
      expect(records[3].name).to.equal('_http._tcp.local.');

      expect(records[4]).to.be.instanceOf(PTRRecord);
      expect(records[4].name).to.equal('_services._dns-sd._udp.local.');

      expect(records[5]).to.be.instanceOf(PTRRecord);
      expect(records[5].name).to.equal('_printer._sub._http._tcp.local.');
    });
  });
});
