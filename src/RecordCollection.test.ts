import { expect } from 'chai';
import sinon from 'sinon';
import _ from 'lodash';

import { ARecord, ResourceRecord, SRVRecord } from './ResourceRecord';
import { RecordCollection } from './RecordCollection';


describe('RecordCollection', () => {
  const record_1 = new SRVRecord({name: '#1'});
  const record_2 = new SRVRecord({name: '#2'});
  const record_3 = new SRVRecord({name: '#3'});

  describe('#constructor()', () => {
    it('should init with correct properties', () => {
      const collection = new RecordCollection();

      expect(collection.size).to.equal(0);
      expect((collection as any)._records).to.eql({});
    });

    it('should call #addEach if given initial records', () => {
      sinon.spy(RecordCollection.prototype, 'addEach');
      const record = new SRVRecord({name: '#1'});
      const collection = new RecordCollection([record]);

      expect(collection.addEach).to.have.been.calledOnce;
    });
  });


  describe('#has()', () => {
    const collection = new RecordCollection([record_1]);

    it('should return true if has record', () => {
      expect(collection.has(record_1)).to.be.true;
    });

    it('should return false if it does not have record', () => {
      expect(collection.has(record_2)).to.be.false;
    });
  });


  describe('#hasEach()', () => {
    const collection = new RecordCollection([record_1, record_2]);

    it('should return true if has every record', () => {
      expect(collection.hasEach([record_1, record_2])).to.be.true;
    });

    it('should return false if it does not have any record', () => {
      expect(collection.hasEach([record_2, record_3])).to.be.false;
    });
  });


  describe('#hasAny()', () => {
    const collection = new RecordCollection([record_1, record_2]);

    it('should return true if it has any of the records', () => {
      expect(collection.hasAny([record_1, record_3])).to.be.true;
    });

    it('should return false if it does not have any records', () => {
      expect(collection.hasAny([record_3])).to.be.false;
    });
  });


  describe('#get()', () => {
    const duplicate = new SRVRecord({name: '#1'});
    const collection = new RecordCollection([record_1]);

    it('should return original record if collection has matching', () => {
      expect(collection.get(duplicate)).to.equal(record_1);
    });

    it('should return undefined if it does not have record', () => {
      expect(collection.get(record_3)).to.be.undefined;
    });
  });


  describe('#add()', () => {
    it('should add record and increment size', () => {
      const collection = new RecordCollection();
      collection.add(record_1);

      expect(collection.has(record_1)).to.be.true;
      expect(collection.size).to.equal(1);
    });

    it('should not increment size if record already added', () => {
      const collection = new RecordCollection([record_1]);
      collection.add(record_1);
      collection.add(record_1);

      expect(collection.has(record_1)).to.be.true;
      expect(collection.size).to.equal(1);
    });
  });


  describe('#addEach()', () => {
    it('should call #add for each record', () => {
      const collection = new RecordCollection();
      sinon.stub(collection, 'add');

      collection.addEach([record_1, record_1]);

      expect(collection.add).to.have.been
        .calledTwice
        .calledWith(record_1)
        .calledOn(collection);
    });
  });


  describe('#delete()', () => {
    const collection = new RecordCollection([record_1]);

    it('should return if collection does not have record', () => {
      collection.delete(record_2);

      expect(collection.size).to.equal(1);
    });

    it('should remove record and decrement size', () => {
      collection.delete(record_1);

      expect(collection.has(record_1)).to.be.false;
      expect(collection.size).to.equal(0);
    });
  });


  describe('#clear()', () => {
    it('should remove all record and reset size', () => {
      const collection = new RecordCollection([record_1, record_2]);

      collection.clear();

      expect((collection as any)._records).to.eql({});
      expect(collection.size).to.equal(0);
    });
  });


  describe('#toArray()', () => {
    it('should return array of its records', () => {
      const collection = new RecordCollection([record_1, record_2]);

      expect(collection.toArray()).to.eql([record_1, record_2]);
    });
  });

  describe('#filter()', () => {
    const collection = new RecordCollection([record_1, record_2]);

    it('should filter records using fn and return new collection', () => {
      const result = collection.filter(record => record.name === '#1');

      expect(result).to.eql(new RecordCollection([record_1]));
    });
  });


  describe('#reject()', () => {
    const collection = new RecordCollection([record_1, record_2]);

    it('should reject records using fn and return new collection', () => {
      const result = collection.reject(record => record.name === '#1');

      expect(result).to.eql(new RecordCollection([record_2]));
    });
  });


  describe('#map()', () => {
    const collection = new RecordCollection([record_1, record_2]);

    it('should map records using fn and return an array', () => {
      const result = collection.map(record => record.name);

      expect(result).to.eql(['#1', '#2']);
    });
  });


  describe('#reduce()', () => {
    const collection = new RecordCollection([record_1, record_2]);

    it('should reduce records using fn and return an array', () => {
      const result = collection.reduce((acc, record) => acc + record.name, '');

      expect(result).to.equal('#1#2');
    });
  });


  describe('#some()', () => {
    const collection = new RecordCollection([record_1, record_2]);

    it('should return true if some records match fn', () => {
      const result = collection.some(record => record.name === '#1');

      expect(result).to.true;
    });

    it('should return false if no records match fn', () => {
      const result = collection.some(record => record.name === '#3');

      expect(result).to.false;
    });
  });


  describe('#every()', () => {
    const collection = new RecordCollection([record_1, record_2]);

    it('should return true if every records match fn', () => {
      const result = collection.every(record => record instanceof ResourceRecord);

      expect(result).to.true;
    });

    it('should return false if no records match fn', () => {
      const result = collection.every(record => record.name === 'something');

      expect(result).to.false;
    });
  });


  describe('#equals()', () => {
    const collection = new RecordCollection([record_1, record_2]);

    it('should return true if equal to given array', () => {
      const values = [record_1, record_2];
      expect(collection.equals(values)).to.be.true;
    });

    it('should return false if not equal to given array', () => {
      const values = [record_1];
      expect(collection.equals(values)).to.be.false;
    });

    it('should return true if equal to given collection', () => {
      const values = new RecordCollection([record_1, record_2]);
      expect(collection.equals(values)).to.be.true;
    });

    it('should return false if not equal to given collection', () => {
      const values = new RecordCollection([record_1]);
      expect(collection.equals(values)).to.be.false;
    });
  });


  describe('#difference()', () => {
    const collection = new RecordCollection([record_1, record_2]);

    it('should return a new collection differenced with an array', () => {
      const values = [record_1];
      const difference = new RecordCollection([record_2]);

      expect(collection.difference(values)).to.eql(difference);
    });

    it('should return a new collection differenced with a collection', () => {
      const values = new RecordCollection([record_1]);
      const difference = new RecordCollection([record_2]);

      expect(collection.difference(values)).to.eql(difference);
    });
  });


  describe('#intersection()', () => {
    const collection = new RecordCollection([record_1, record_2]);

    it('should return a new collection intersected with an array', () => {
      const values = [record_1];
      const intersection = new RecordCollection([record_1]);

      expect(collection.intersection(values)).to.eql(intersection);
    });

    it('should return a new collection intersected with a collection', () => {
      const values = new RecordCollection([record_1]);
      const intersection = new RecordCollection([record_1]);

      expect(collection.intersection(values)).to.eql(intersection);
    });
  });


  describe('#getConflicts()', () => {
    const A_1 = new ARecord({name: 'A', address: '0.0.0.1'});
    const A_2 = new ARecord({name: 'A', address: '0.0.0.2'});
    const A_3 = new ARecord({name: 'A', address: '0.0.0.3'});
    const A_4 = new ARecord({name: 'A', address: '0.0.0.4'});

    const collection = new RecordCollection([A_1, A_2]);

    it('should return empty array if no conflicts were found', () => {
      expect(collection.getConflicts([A_1])).to.be.empty;
      expect(collection.getConflicts([A_1, A_2])).to.be.empty;
    });

    it('should return array of conflicting records', () => {
      const input = [A_3];
      const conflicts = [A_3];

      expect(collection.getConflicts(input)).to.eql(conflicts);
    });

    it('should ignore, when comparing, records that occur in both sets', () => {
      const input = [A_1, A_2, A_3, A_4];

      expect(collection.getConflicts(input)).to.be.empty;
    });
  });

});
