import * as chai from 'chai';
import { expect } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import 'sinon-chai';
chai.use(sinonChai);
import { PTRRecord, SRVRecord, TXTRecord } from './ResourceRecord';
import { jest } from '@jest/globals';

import { ExpiringRecordCollection } from './ExpiringRecordCollection';

jest.useFakeTimers();

describe('ExpiringRecordCollection', function() {
  // SRV_1 & SRV_2 are related (same name, type) and will have the same namehash
  // PTR is a shared, non-unique record type
  const SRV_1 = new SRVRecord({name: 'SRV', target: 'something', ttl: 10});
  const SRV_2 = new SRVRecord({name: 'SRV', target: 'different', ttl: 20});
  const TXT   = new TXTRecord({name: 'TXT', ttl: 10});
  const PTR   = new PTRRecord({name: 'PTR', ttl: 10});

  describe('#has()', () => {
    it('should return true if collection already has record and no time has past', () => {
      const collection = new ExpiringRecordCollection([TXT]);
      expect(collection.has(TXT)).to.be.true;
    });

    it('should return false if it does not have record', () => {
      const collection = new ExpiringRecordCollection([TXT]);
      expect(collection.has(TXT)).to.be.true;
      jest.advanceTimersByTime(5000);
      expect(collection.has(PTR)).to.be.false;
    });
  });


  describe('#add()', function() {
    it('should add record and #_schedule timers', function() {
      const collection = new ExpiringRecordCollection();
      sinon.stub(collection, '_schedule');

      collection.add(PTR);

      expect(collection.size).to.equal(1);
      expect(collection._schedule).to.have.been.calledOnce;
    });

    it('should updating existing record', function() {
      const collection = new ExpiringRecordCollection();
      sinon.stub(collection, '_schedule');

      collection.add(PTR);
      collection.add(PTR);

      expect(collection.size).to.equal(1);
    });

    it('should setToExpire instead of adding if TTL=0', function() {
      const zero = new SRVRecord({name: 'TTL=0', ttl: 0});
      const collection = new ExpiringRecordCollection();
      sinon.stub(collection, 'setToExpire');

      collection.add(zero);

      expect(collection.size).to.equal(0);
      expect(collection.setToExpire).to.have.been.calledOnce;
    });
  });


  describe('#addEach()', function() {
    it('should add each record', () => {
      const collection = new ExpiringRecordCollection();
      collection.addEach([TXT, PTR]);

      expect(collection.has(TXT)).to.be.true;
      expect(collection.has(PTR)).to.be.true;
    });
  });


  describe('#hasAddedWithin()', function() {
    it('should be false if record does not exist yet', () => {
      const collection = new ExpiringRecordCollection([PTR]);
      jest.advanceTimersByTime(5000);
      expect(collection.hasAddedWithin(TXT, 1)).to.be.false;
    });

    it('should be true if has been added in range', () => {
      const collection = new ExpiringRecordCollection([PTR]);
      jest.advanceTimersByTime(5000);

      expect(collection.hasAddedWithin(PTR, 6)).to.be.true;
    });

    it('should be false if hasn\'t been added in range', () => {
      const collection = new ExpiringRecordCollection([PTR]);
      jest.advanceTimersByTime(5000);

      expect(collection.hasAddedWithin(PTR, 4)).to.be.false;
    });
  });


  describe('#get()', function() {
    it('should return undefined if record does not exist', () => {
      const collection = new ExpiringRecordCollection([PTR]);
      jest.advanceTimersByTime(3000);
      expect(collection.get(TXT)).to.be.undefined;
    });

    it('should return clone of record with adjusted TTL', () => {
      const collection = new ExpiringRecordCollection([PTR]);
      jest.advanceTimersByTime(3000);

      const clone = collection.get(PTR);

      expect(clone).to.not.equal(PTR);
      expect(clone.ttl).to.equal(7);
    });
  });


  describe('#delete()', function() {
    it('should remove record', function() {
      const collection = new ExpiringRecordCollection([TXT]);
      collection.delete(TXT);

      expect(collection.size).to.equal(0);
    });

    it('should remove record id from related group set', () => {
      const collection = new ExpiringRecordCollection([SRV_1, SRV_2]);
      collection.delete(SRV_1);
      jest.advanceTimersByTime(3000);

      expect(collection.size).to.equal(1);
      expect((collection as any)._related[SRV_1.namehash].size).to.equal(1);
    });

    it('should do nothing if collection does not have record', function() {
      const collection = new ExpiringRecordCollection();
      collection.delete(SRV_1);

      expect(collection.size).to.equal(0);
    });

    it('should emit "expired" event with record', function(done) {
      const collection = new ExpiringRecordCollection([PTR]);

      collection.on('expired', (result) => {
        expect(result).to.equal(PTR);
        done();
      });

      collection.delete(PTR);
    });
  });


  describe('#clear()', function() {
    it('should clear all timers and records', function() {
      const collection = new ExpiringRecordCollection([TXT, PTR]);
      collection.clear();

      expect(collection.size).to.equal(0);
    });
  });


  describe('#setToExpire()', function() {
    it('should clear timers and delete in 1s', () => {
      const collection = new ExpiringRecordCollection([PTR]);

      collection.setToExpire(PTR);
      jest.advanceTimersByTime(3000);

      expect(collection.size).to.equal(0);
    });

    it('should do nothing if it does not have the record', () => {
      const collection = new ExpiringRecordCollection([PTR]);

      collection.setToExpire(TXT);
      jest.advanceTimersByTime(1000);

      expect(collection.size).to.equal(1);
    });

    it('should not clear existing delete timers', () => {
      const collection = new ExpiringRecordCollection([PTR]);

      collection.setToExpire(PTR);

      jest.advanceTimersByTime(500);
      collection.setToExpire(PTR); // should NOT reset timer to 1s
      jest.advanceTimersByTime(500); // delete should have fired
      expect(collection.size).to.equal(0);
    });
  });


  describe('#flushRelated()', function() {
    it('should expire related records added > 1s ago', () => {
      const collection = new ExpiringRecordCollection([SRV_1, TXT, PTR]);
      sinon.stub(collection, 'setToExpire');

      jest.advanceTimersByTime(2000);
      collection.flushRelated(SRV_2);

      expect(collection.setToExpire).to.have.been.calledWith(SRV_1);
    });

    it('should not expire records added < 1s ago', () => {
      const collection = new ExpiringRecordCollection([SRV_1, TXT, PTR]);
      sinon.stub(collection, 'setToExpire');

      jest.advanceTimersByTime(500);
      collection.flushRelated(SRV_2);

      expect(collection.setToExpire).to.not.have.been.called;
    });

    it('should a record should not flush itself', () => {
      const collection = new ExpiringRecordCollection([SRV_1, TXT, PTR]);
      sinon.stub(collection, 'setToExpire');

      jest.advanceTimersByTime(2000);
      collection.flushRelated(TXT);

      expect(collection.setToExpire).to.not.have.been.called;
    });

    it('should *not* flush with non-unique records', () => {
      const collection = new ExpiringRecordCollection([SRV_1, TXT, PTR]);
      sinon.stub(collection, 'setToExpire');

      collection.flushRelated(PTR);

      expect(collection.setToExpire).to.not.have.been.called;
    });
  });


  describe('#toArray()', function() {
    it('should return array of its records', () => {
      let expiringRecordCollection = new ExpiringRecordCollection([TXT]);
      expect(expiringRecordCollection.toArray()).to.eql([TXT]);
      jest.advanceTimersByTime(10_000);
    });
  });


  describe('#hasConflictWith()', () => {

    it('should return true if collection has a conflicting record', function() {
      const collection = new ExpiringRecordCollection([SRV_1]);
      expect(collection.hasConflictWith(SRV_2)).to.be.true;
    });

    it('should return false if collection has no conflicting records', function() {
      const collection = new ExpiringRecordCollection([SRV_1]);
      expect(collection.hasConflictWith(TXT)).to.be.false;
    });

    it('should not let a record to conflict with itself', function() {
      const collection = new ExpiringRecordCollection([SRV_1]);
      expect(collection.hasConflictWith(SRV_1)).to.be.false;
    });

    it('should always return false when given non-unique a record', function() {
      const collection = new ExpiringRecordCollection([SRV_1]);
      expect(collection.hasConflictWith(PTR)).to.be.false;
    });
  });


  describe('#_getRelatedRecords()', function() {
    it('should return an array of records with the same name', () => {
      const collection = new ExpiringRecordCollection([PTR]);
      expect(collection._getRelatedRecords(PTR.namehash)).to.eql([PTR]);
      jest.advanceTimersByTime(5_000);
    });

    it('should return an empty array if no related records exist', () => {
      const collection = new ExpiringRecordCollection([PTR]);
      expect(collection._getRelatedRecords('???')).to.eql([]);
      jest.advanceTimersByTime(5_000);
    });
  });


  describe('#_filterTTL()', function() {
    it('should only return records with TTLs > cutoff', () => {
      const collection = new ExpiringRecordCollection([SRV_1]);

      jest.advanceTimersByTime(8_000);
      const results = collection._filterTTL([SRV_1, SRV_2], 0.50);

      expect(results).to.have.lengthOf(1);
      expect(results[0].hash).to.equal(SRV_2.hash);
    });

    it('should return an array of clones', () => {
      const collection = new ExpiringRecordCollection([SRV_1]);
      const results = collection._filterTTL([SRV_1], 0.50);

      expect(results).to.not.equal([SRV_1]);
      jest.advanceTimersByTime(5_000);
    });

    it('should subtract elapsed TTL for records', () => {
      const collection = new ExpiringRecordCollection([SRV_1]);

      jest.advanceTimersByTime(4_000);
      const results = collection._filterTTL([SRV_1], 0.50);

      expect(results).to.have.lengthOf(1);
      expect(results[0].ttl).to.equal(6);
    });
  });


  describe('#_schedule()', function() {
    it('should schedule expiration and reissue timers', () => {
      const collection = new ExpiringRecordCollection([PTR]);
      sinon.stub(collection, 'emit');

      jest.advanceTimersByTime(10_000);

      expect(collection.emit).to.have.been
        .callCount(5)
        .calledWith('reissue', PTR)
        .calledWith('expired', PTR);
    });
  });

});
