import { expect } from 'chai';
import sinon from 'sinon';

import { AAAARecord, ARecord, SRVRecord, TXTRecord } from './ResourceRecord';
import * as resolve from './resolve';

import * as Fake from './test/Fake';
import { DisposableInterface } from './DisposableInterface';

describe('resolve', function() {
  const intf = Fake.DisposableInterface();

  sinon.stub(DisposableInterface, 'isValidName')
    .returns(true)
    .withArgs('non-existant')
      .returns(false)
  ;

  const query = Fake.Query(); // does nothing
  const resolver = Fake.ServiceResolver(); // does nothing

  resolve.resolveMechanics.createInterface = () => intf;
  resolve.resolveMechanics.createQuery = () => query;
  resolve.resolveMechanics.createServiceResolver = () => <any>resolver;

  const A    = new ARecord({name: 'A', address: '1.1.1.1'});
  const AAAA = new AAAARecord({name: 'AAAA', address: 'FF::'});
  const TXT  = new TXTRecord({name: 'TXT', txt: {key: 'value'}});
  const SRV  = new SRVRecord({name: 'SRV', target: 'Target', port: 9999});

  beforeEach(() => sinon.resetHistory());

  describe('.resolve', function() {
    describe('should throw on invalid input', function() {
      it('name', function() {
        expect(() => (resolve as any).resolve()).to.throw(Error);
        expect(() => (resolve as any).resolve('')).to.throw(Error);
        expect(() => (resolve as any).resolve(999)).to.throw(Error);
      });

      it('qtype', function() {
        expect(() => (resolve as any).resolve('name')).to.throw(Error);
        expect(() => resolve.resolve('name', '')).to.throw(Error);
        expect(() => resolve.resolve('name', 'WHAT')).to.throw(Error);
        expect(() => resolve.resolve('name', 0)).to.throw(Error);
      });

      it('options', function() {
        const options = {interface: 'non-existant'};

        expect(() => resolve.resolve('name', 1, 'wrong' as any)).to.throw(Error);
        expect(() => resolve.resolve('name', 1, options)).to.throw(Error);
      });
    });

    it('should resolve answer and any related records', function(done) {
      resolve.resolve('record.name.', 'A').then((result) => {
        expect(result.answer).to.equal(A);
        expect(result.related).to.have.members([AAAA]);
        expect(intf.stop).to.have.been.called;
        done();
      });

      // need to let the interface stub's bind method resolve first
      setTimeout(() => query.emit('answer', A, [AAAA]), 10);
    });

    it('should reject with an error on timeout', function(done) {
      resolve.resolve('record.name', 'A').catch(() => done());

      setTimeout(() => query.emit('timeout'), 10);
    });
  });


  describe('.resolve4', function() {
    it('should resolve with an address', function(done) {
      resolve.resolve4('record.name.').then((result) => {
        expect(result).to.equal(A.address);
        done();
      });

      // need to let the stubs bind resolve first
      setTimeout(() => query.emit('answer', A, [AAAA]), 10);
    });

    it('should reject with an error on timeout', function(done) {
      resolve.resolve4('record.name.').catch(() => done());

      setTimeout(() => query.emit('timeout'), 10);
    });
  });


  describe('.resolve6', function() {
    it('should resolve with an address', function(done) {
      resolve.resolve6('record.name.').then((result) => {
        expect(result).to.equal(AAAA.address);
        done();
      });

      setTimeout(() => query.emit('answer', AAAA, [A]), 10);
    });

    it('should reject with an error on timeout', function(done) {
      resolve.resolve6('record.name.').catch(() => done());

      setTimeout(() => query.emit('timeout'), 10);
    });
  });


  describe('.resolveSRV', function() {
    it('should resolve with SRV info', function(done) {
      resolve.resolveSRV('record.name.').then((result) => {
        expect(result).to.eql({
          target: SRV.target,
          port  : SRV.port,
        });

        done();
      });

      setTimeout(() => query.emit('answer', SRV, [TXT]), 10);
    });

    it('should reject with an error on timeout', function(done) {
      resolve.resolveSRV('record.name.').catch(() => done());

      setTimeout(() => query.emit('timeout'), 10);
    });
  });


  describe('.resolveTXT', function() {
    it('should resolve with TXT info', function(done) {
      resolve.resolveTXT('record.name.').then((result) => {
        expect(result).to.eql({
          txt   : TXT.txt,
          txtRaw: TXT.txtRaw,
        });

        done();
      });

      // need to let the stubs bind resolve first
      setTimeout(() => query.emit('answer', TXT, [SRV]), 10);
    });

    it('should reject with an error on timeout', function(done) {
      resolve.resolveTXT('record.name.').catch(() => done());

      setTimeout(() => query.emit('timeout'), 10);
    });
  });


  describe('.resolveService', function() {
    describe('should throw on invalid input', function() {
      it('name', function() {
        expect(() => (resolve as any).resolveService()).to.throw(Error);
        expect(() => resolve.resolveService('')).to.throw(Error);
        expect(() => resolve.resolveService(999)).to.throw(Error);
      });

      it('options', function() {
        const options = {interface: 'non-existant'};

        expect(() => resolve.resolveService('name', 'wrong' as any)).to.throw(Error);
        expect(() => resolve.resolveService('name', options)).to.throw(Error);
      });
    });

    it('should reject with an error on timeouts', function(done) {
      const expected = {fake: 'service'};
      resolver.service.returns(expected);

      resolve.resolveService('service.name.').then((result) => {
        expect(result).to.equal(expected);
        expect(resolver.stop).to.have.been.called;
        expect(intf.stop).to.have.been.called;
        done();
      });

      setTimeout(() => resolver.emit('resolved'), 10);
    });

    it('should reject with an error on timeouts', function(done) {
      resolve.resolveService('service.name', {timeout: 10}).catch(() => done());
    });
  });

});
