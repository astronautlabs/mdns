import { expect } from 'chai';
import sinon from 'sinon';

import { Packet } from './Packet';
import { QueryRecord } from './QueryRecord';
import { AAAARecord, ARecord, PTRRecord, ResourceRecord, SRVRecord, TXTRecord } from './ResourceRecord';
import { ExpiringRecordCollection } from './ExpiringRecordCollection';
import { Query } from './Query';

import * as Fake from './test/Fake';
import { jest } from '@jest/globals';

jest.useFakeTimers();

describe('Query', () => {
  // reset all stubbed functions after each test
  afterEach(() => sinon.resetHistory());

  describe('#add()', () => {
    it('should add to this._questions', () => {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();

      const query = new Query(networkInterface, offswitch);

      // single & multiple
      query.add({name: 'Record A'});
      query.add([{name: 'Record AAAA'}]);

      expect((query as any)._questions.size).to.equal(2);
    });
  });


  describe('#start()', () => {
    it('should check cache unless specifically told not to', () => {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();

      const query = new Query(networkInterface, offswitch);
      sinon.stub((query as any), '_checkCache');

      query.ignoreCache(true);
      query.start();
      expect((query as any)._checkCache).to.not.have.been.called;

      query.ignoreCache(false);
      query.start();
      expect((query as any)._checkCache).to.have.been.called;
    });

    it('should stop if it has no questions or were all answered', () => {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();
      
      const query = new Query(networkInterface, offswitch);
      sinon.stub((query as any), '_checkCache');
      sinon.stub(query, 'stop');

      query.start();

      expect(query.stop).to.have.been.called;
    });

    it('should add `answer` and `query` event listeners', () => {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();
      
      const query = new Query(networkInterface, offswitch);
      sinon.stub((query as any), '_checkCache');
      sinon.stub((query as any), '_onAnswer');
      sinon.stub((query as any), '_onQuery');

      query.add({name: 'Bogus Record'});
      query.start();

      networkInterface.emit('answer');
      networkInterface.emit('query');

      expect((query as any)._onAnswer).to.have.been.called;
      expect((query as any)._onQuery).to.have.been.called;
      query.stop();
    });

    it('should queue send for short delay & set timeout', () => {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();
      
      const query = new Query(networkInterface, offswitch);
      sinon.stub((query as any), '_checkCache');
      sinon.stub((query as any), '_send');
      sinon.stub((query as any), '_startTimer');

      query.add({name: 'Bogus Record'});
      query.setTimeout(120);
      query.start();

      expect((query as any)._startTimer).to.have.not.been.called;
      expect((query as any)._send).to.have.not.been.called;

      jest.advanceTimersByTime(120);

      expect((query as any)._startTimer).to.have.been.called;
      expect((query as any)._send).to.have.been.called;
    });
  });


  describe('#stop()', () => {
    it('should stop & remove listeners', () => {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();
      
      const query = new Query(networkInterface, offswitch);
      query.stop();

      expect(networkInterface.off).to.have.been.calledOnce;
    });

    it('should not do anything if already stopped', () => {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();
      
      const query = new Query(networkInterface, offswitch);

      query.stop();
      query.stop(); // <-- does nothing

      expect(networkInterface.off).to.have.been.calledOnce;
    });
  });


  describe('#_restart()', () => {
    it('should reset questions/answers and resend query', () => {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();
      
      const query = new Query(networkInterface, offswitch);
      sinon.stub((query as any), '_send');

      const answer = new AAAARecord({name: 'Record'});
      const packet = new Packet();
      packet.setAnswers([answer]);

      query.add([{name: answer.name}, {name: 'unknown'}]);
      query.start();

      networkInterface.emit('answer', packet);
      expect((query as any)._questions.size).to.equal(1);

      query._restart();
      expect((query as any)._questions.size).to.equal(2);
      expect((query as any)._send).to.have.been.called;
    });

    it('should not do anything if already stopped', () => {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();
      
      const query = new Query(networkInterface, offswitch);
      sinon.stub((query as any), '_send');

      query.stop();
      query._restart(); // <-- does nothing

      expect((query as any)._send).to.not.have.been.called;
    });
  });


  describe('#_send()', () => {
    it('should add known answers and send packet', () => {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();
      
      const query = new Query(networkInterface, offswitch);

      const packet = new Packet();
      packet.setQuestions(['fake']);

      sinon.stub((query as any), '_makePacket');
      sinon.stub((query as any), '_addKnownAnswers').returns(packet);

      (query as any)._send();

      expect(networkInterface.send).to.have.been.calledWith(packet);
    });

    it('should not send packets if they are empty', () => {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();
      
      const query = new Query(networkInterface, offswitch);
      sinon.stub((query as any), '_addKnownAnswers').returns(new Packet());

      (query as any)._send();

      expect(networkInterface.send).to.not.have.been.called;
    });

    it('should make next packet early and queue next send', () => {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();
      
      const query = new Query(networkInterface, offswitch);

      sinon.stub((query as any), '_makePacket');
      sinon.stub((query as any), '_addKnownAnswers').returns(new Packet());

      (query as any)._send();

      expect((query as any)._makePacket).to.have.been.called;
      expect((query as any)._next).to.equal(1000 * 2);
    });

    it('should not queue further sends for non-continuous queries', () => {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();
      
      const query = new Query(networkInterface, offswitch);

      sinon.stub((query as any), '_makePacket');
      sinon.stub((query as any), '_addKnownAnswers').returns(new Packet());

      query.continuous(false);
      (query as any)._send();

      expect((query as any)._makePacket).to.not.have.been.called;
    });
  });


  describe('#_addKnownAnswers()', () => {
    it('should only include answers > 50% TTL and set isUnique to false', () => {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();
      
      const query = new Query(networkInterface, offswitch);

      const answer = new SRVRecord({name: 'SRV'});
      sinon.stub((query as any)._knownAnswers, 'getAboveTTL').returns([answer]);

      const packet = (query as any)._addKnownAnswers(new Packet());

      expect(packet.answers).to.eql([answer]);
      expect(packet.answers[0].isUnique).to.be.false;
    });
  });


  describe('#_removeKnownAnswer()', () => {
    it('should remove answers from known list as they expire from cache', () => {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();
      
      const query = new Query(networkInterface, offswitch);

      const answer = new PTRRecord({name: 'PTR'});
      const packet = new Packet();
      packet.setAnswers([answer]);

      query.add({name: answer.name});
      query.start();

      networkInterface.emit('answer', packet);
      expect((query as any)._knownAnswers.size).to.equal(1);

      networkInterface.cache.emit('expired', answer);
      expect((query as any)._knownAnswers.size).to.equal(0);
      query.stop();
    });
  });


  describe('#_onAnswer()', () => {
    it('should check incoming records for answers to questions', function(done) {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();
      
      const query = new Query(networkInterface, offswitch);

      const answer = new AAAARecord({name: 'Record'}); // answsers
      const related = new ARecord({name: 'Related'});  // doesn't

      const packet = new Packet();
      packet.setAnswers([answer]);
      packet.setAdditionals([related]);

      query.on('answer', (record, others) => {
        expect(record).to.equal(answer);
        expect(others).to.eql([related]);
        done();
      });

      query.add({name: 'Record'});
      (query as any)._onAnswer(packet);
    });

    it('should remove unique answers from questions list', function(done) {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();
      
      const query = new Query(networkInterface, offswitch);

      const packet = new Packet();
      packet.setAnswers([ new AAAARecord({name: 'Unique'}) ]);

      query.on('answer', () => {
        expect((query as any)._knownAnswers.size).to.equal(0);
        expect((query as any)._questions.size).to.equal(0);
        done();
      });

      query.add({name: 'Unique'});
      (query as any)._onAnswer(packet);
    });

    it('should add shared records to known answer list instead', done => {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();
      
      const query = new Query(networkInterface, offswitch);

      const packet = new Packet();
      packet.setAnswers([ new PTRRecord({name: 'Shared'}) ]);

      query.on('answer', () => {
        expect((query as any)._knownAnswers.size).to.equal(1);
        expect((query as any)._questions.size).to.equal(1);
        done();
      });

      query.add({name: 'Shared'});
      (query as any)._onAnswer(packet);
    });

    it('should stop on first answer if query is non continuous', () => {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();
      
      const query = new Query(networkInterface, offswitch);
      sinon.stub(query, 'stop');

      const packet = new Packet();
      packet.setAnswers([ new PTRRecord({name: 'Not an answer'}) ]);

      query.continuous(false);
      query.add({name: 'Somthing'});
      (query as any)._onAnswer(packet);

      expect(query.stop).to.have.been.called;
    });

    it('should stop if all questions were answered', () => {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();
      
      const query = new Query(networkInterface, offswitch);
      sinon.stub(query, 'stop');

      (query as any)._onAnswer(new Packet());

      expect((query as any)._questions.size).to.equal(0);
      expect(query.stop).to.have.been.called;
    });

    it('should exit early if stopped', () => {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();
      
      const query = new Query(networkInterface, offswitch);
      sinon.stub(query, 'stop');

      (query as any)._isStopped = true;
      (query as any)._onAnswer(new Packet());

      expect(query.stop).to.not.have.been.called;
    });
  });


  describe('#_onQuery()', () => {
    it('should remove duplicate questions from outgoing packet', () => {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();
      
      const query = new Query(networkInterface, offswitch);
      const question = new QueryRecord({name: 'Question'});

      const incoming = new Packet();
      incoming.setQuestions([question]);

      (query as any)._queuedPacket = new Packet();
      (query as any)._queuedPacket.setQuestions([question]);

      (query as any)._onQuery(incoming);

      expect((query as any)._queuedPacket.questions).to.be.empty;
    });

    it('should ONLY remove duplicate questions and leave the others', () => {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();
      
      const query = new Query(networkInterface, offswitch);

      const question_A = new QueryRecord({name: 'Question A'});
      const question_B = new QueryRecord({name: 'Question B'});

      const packet = new Packet();
      packet.setQuestions([question_A]);

      (query as any)._queuedPacket = new Packet();
      (query as any)._queuedPacket.setQuestions([question_A, question_B]);

      (query as any)._onQuery(packet);

      expect((query as any)._queuedPacket.questions).to.eql([question_B]);
    });

    it('should not perform check if stopped', () => {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();
      
      const query = new Query(networkInterface, offswitch);
      const question = new QueryRecord({name: 'Question'});

      const incoming = new Packet();
      incoming.setQuestions([question]);

      (query as any)._queuedPacket = new Packet();
      (query as any)._queuedPacket.setQuestions([question]);

      query.stop();
      (query as any)._onQuery(incoming);

      expect((query as any)._queuedPacket.questions).to.not.be.empty;
    });

    it('should not do check if query came from the same interface', () => {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();
      
      const query = new Query(networkInterface, offswitch);
      const question = new QueryRecord({name: 'Question'});

      const incoming = new Packet();
      incoming.setQuestions([question]);
      sinon.stub(incoming, 'isLocal').returns(true);

      (query as any)._queuedPacket = new Packet();
      (query as any)._queuedPacket.setQuestions([question]);

      (query as any)._onQuery(incoming);

      expect((query as any)._queuedPacket.questions).to.not.be.empty;
    });

    it('should not perform check if packet has known answers', () => {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();
      
      const query = new Query(networkInterface, offswitch);
      const question = new QueryRecord({name: 'Record'});

      const incoming = new Packet();
      incoming.setQuestions([question]);
      incoming.setAnswers([ new AAAARecord({name: 'Record'}) ]);

      (query as any)._queuedPacket = new Packet();
      (query as any)._queuedPacket.setQuestions([question]);

      (query as any)._onQuery(incoming);

      expect((query as any)._queuedPacket.questions).to.not.be.empty;
    });
  });


  describe('#_checkCache()', () => {
    const PTR = new PTRRecord({name: 'shared'});
    const SRV = new SRVRecord({name: 'unique'});
    const TXT = new TXTRecord({name: 'not_in_cache'});

    function harness() {
      const networkInterface = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();
      networkInterface.cache.addEach([PTR, SRV]);

      return { networkInterface, offswitch };
    }

    it('should check interface cache for answers to questions', () => {
      const { networkInterface, offswitch } = harness();

      const query = new Query(networkInterface, offswitch);
      sinon.stub(query, 'emit');

      query.add([
        {name: 'shared', qtype: PTR.rrtype},
        {name: 'unique', qtype: SRV.rrtype},
      ]);

      (query as any)._checkCache();

      expect((query as any)._questions.size).to.equal(1);
      expect((query as any)._knownAnswers.size).to.equal(1);
      expect(query.emit).to.have.been
        .calledWith('answer', PTR)
        .calledWith('answer', SRV);
      query.stop();
    });

    it('should do nothing if no answers are found', () => {
      const { networkInterface, offswitch } = harness();
      
      const query = new Query(networkInterface, offswitch);
      sinon.stub(query, 'emit');

      query.add({name: 'not_in_cache', qtype: TXT.rrtype});
      (query as any)._checkCache();

      expect((query as any)._questions.size).to.equal(1);
      expect((query as any)._knownAnswers.size).to.equal(0);
      expect(query.emit).to.not.have.been.called;
    });
  });


  describe('#_startTimer()', () => {
    it('should timeout and stop query if not answered', () => {
      const networkInterface      = Fake.NetworkInterface();
      const offswitch = Fake.EventEmitter();
      networkInterface.cache = new ExpiringRecordCollection();
      
      const query = new Query(networkInterface, offswitch);
      sinon.stub(query, 'emit');

      query.setTimeout(2000);
      (query as any)._startTimer();

      jest.advanceTimersByTime(3000);

      expect(query.emit).to.have.been.calledWith('timeout');
      expect((query as any)._isStopped).to.be.true;
    });
  });

});
