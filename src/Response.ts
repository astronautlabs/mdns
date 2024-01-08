import { Packet } from './Packet';
import { EventEmitter } from 'node:events';
import { RecordCollection } from './RecordCollection';
import { TimerContainer } from './TimerContainer';
import { sleep } from './sleep';
import * as misc from './misc';
import { NetworkInterface } from './NetworkInterface';

import { RType } from './constants';
import { ResourceRecord } from './ResourceRecord';
import { QueryRecord } from './QueryRecord';
import { NetworkPort } from './NetworkPort';

const ONE_SECOND = 1000;

let counter = 0;
const uniqueId = () => `id#${++counter}`;

export class MulticastResponse extends EventEmitter {
    /**
     * Creates a new MulticastResponse
     * @class
     * @extends EventEmitter
     *
     * Sends out a multicast response of records on a given interface. Responses
     * can be set to repeat multiple times.
     *
     * @emits 'stopped'
     *
     * @param {NetworkInterface} intf - the interface the response will work on
     * @param {EventEmitter}     offswitch - emitter used to shut this response down
     */
    constructor(intf: NetworkInterface, offswitch: EventEmitter) {
        super();

        // id only used for figuring out logs
        this._id = uniqueId();
        // [debug]: Creating new response (${this._id});

        this._intf = intf;
        this._offswitch = offswitch;
        this._isStopped = false;

        // listen to answers on interface to suppress duplicate answers
        // stop on either the offswitch of an interface error
        intf.on('answer', this._onAnswerHandler = (packet: Packet) => this._onAnswer(packet))
        intf.once('error', this._onErrorHandler = () => this.stop());

        // waking from sleep should cause the response to stop too
        sleep.on('wake', this._onWakeHandler = () => this.stop());
        offswitch.once('stop', this._onStopHandler = () => this.stop());
    }

    private _onAnswerHandler;
    private _onErrorHandler;
    private _onWakeHandler;
    private _onStopHandler;
    
    _id: string;
    _intf: NetworkInterface;
    _offswitch: EventEmitter;
    _answers = new RecordCollection<ResourceRecord>();
    _isStopped: boolean = false;
    _repeats = 1;
    _delay = 0;
    _isDefensive = false;
    _next = ONE_SECOND;
    _queuedPacket: Packet;

    /**
     * repeat responses, first at 1s apart, then increasing by a factor of 2
     */
    _timers = new TimerContainer();

    /**
     * Adds records to be sent out.
     * @param {ResourceRecords|ResourceRecords[]} arg
     */
    add(arg: ResourceRecord | ResourceRecord[]) {
        const records = Array.isArray(arg) ? arg : [arg];

        // In any case where there may be multiple responses, like when all outgoing
        // records are non-unique (like PTRs) response should be delayed 20-120 ms.
        this._delay = records.some(record => !record.isUnique) ? misc.random(20, 120) : 0;
        this._answers.addEach(records);

        return this;
    };

    repeat(num) {
        this._repeats = num;
        return this;
    };

    /**
     * Some responses are 'defensive' in that they are responding to probes or
     * correcting some problem like an erroneous TTL=0.
     */
    defensive(bool) {
        this._isDefensive = !!bool;
        return this;
    };

    /**
     * Starts sending out records.
     */
    start() {
        // remove delay for defensive responses
        const delay = (this._isDefensive) ? 0 : this._delay;

        // prepare next outgoing packet in advance while listening to other answers
        // on the interface so duplicate answers in this packet can be suppressed.
        this._queuedPacket = this._makePacket();
        this._timers.setLazy('next-response', () => this._send(), delay);

        return this;
    };

    /**
     * Stops the response & cleans up after itself.
     * @emits 'stopped' event when done
     */
    stop() {
        if (this._isStopped) return;

        // [debug]: Response stopped (${this._id});
        this._isStopped = true;

        this._timers.clear();

        
        this._intf.off('answer', this._onAnswerHandler = (packet: Packet) => this._onAnswer(packet))
        this._intf.off('error', this._onErrorHandler = () => this.stop());
        this._offswitch.off('stop', this._onStopHandler = () => this.stop());
        sleep.off('wake', this._onWakeHandler = () => this.stop());

        this.emit('stopped');
    };

    /**
     * Sends the response packets.
     *
     * socket.send() has a callback to know when the response was actually sent.
     * Responses shut down after repeats run out.
     */
    _send() {
        this._repeats--;
        // [debug]: Sending response, ${this._repeats} repeats left (${this._id});

        const packet = this._suppressRecents(this._queuedPacket);

        // send packet, stop when all responses have been sent
        this._intf.send(packet, null, () => {
            if (this._repeats <= 0) this.stop();
        });

        // reschedule the next response if needed. the packet is prepared in advance
        // so incoming responses can be checked for duplicate answers.
        if (this._repeats > 0) {
            this._queuedPacket = this._makePacket();
            this._timers.setLazy('next-response', () => this._send(), this._next);

            // each successive response increases delay by a factor of 2
            this._next *= 2;
        }
    };

    /**
     * Create a response packet.
     * @return {Packet}
     */
    _makePacket() {
        const packet = new Packet();
        const additionals = new RecordCollection();

        this._answers.forEach(answer => {
            additionals.addEach(answer.additionals);
        });

        packet.setResponseBit();
        packet.setAnswers(this._answers.toArray());
        packet.setAdditionals(additionals.difference(this._answers).toArray());

        return packet;
    };

    /**
     * Removes recently sent records from the outgoing packet
     *
     * Check the interface to for each outbound record. Records are limited to
     * being sent to the multicast address once every 1s except for probe responses
     * (and other defensive responses) that can be sent every 250ms.
     *
     * @param  {Packet} packet - the outgoing packet
     * @return {Packet}
     */
    _suppressRecents(packet) {
        const range = (this._isDefensive) ? 0.25 : 1.0;

        const answers = packet.answers.filter(record =>
            !this._intf.hasRecentlySent(record, range));

        const suppressed = packet.answers.filter(a => !~answers.indexOf(a));

        if (suppressed.length) {
            // [debug]: Suppressing recently sent (${this._id}): ${suppressed}
            packet.setAnswers(answers);
        }

        return packet;
    };

    /**
     * Handles incoming answer (response) packets
     *
     * This is solely used to do duplicate answer suppression (7.4). If another
     * responder has sent the same answer as one this response is about to send,
     * this response can suppress that answer since someone else already sent it.
     * Modifies the next scheduled response packet only (this._queuedPacket).
     *
     * Note: this handle will receive this response's packets too
     *
     * @param {Packet} packet - the incoming probe packet
     */
    _onAnswer(packet) {
        if (this._isStopped) return;

        // prevent this response from accidentally suppressing itself
        // (ignore packets that came from this interface)
        if (packet.isLocal()) return;

        // ignore goodbyes in suppression check
        const incoming = packet.answers.filter(answer => answer.ttl !== 0);
        const outgoing = this._queuedPacket.answers;

        // suppress outgoing answers that also appear in incoming records
        const answers = (new RecordCollection(outgoing)).difference(incoming).toArray();
        const suppressed = outgoing.filter(out => !~answers.indexOf(out));

        if (suppressed.length) {
            // [debug]: Suppressing duplicate answers (${this._id}): ${suppressed}'
            this._queuedPacket.setAnswers(answers);
        }
    };
}

export class GoodbyeResponse extends MulticastResponse {
    /**
     * Creates a new GoodbyeResponse
     * @class
     * @extends MulticastResponse
     *
     * Sends out a multicast response of records that are now dead on an interface.
     * Goodbyes can be set to repeat multiple times.
     *
     * @emits 'stopped'
     *
     * @param {NetworkInterface} intf - the interface the response will work on
     * @param {EventEmitter}     offswitch - emitter used to shut this response down
     */
    constructor(intf: NetworkInterface, offswitch: EventEmitter) {
        super(intf, offswitch);
    }

    /**
     * Makes a goodbye packet
     * @return {Packet}
     */
    _makePacket() {
        const packet = new Packet();

        // Records getting goodbye'd need a TTL=0
        // Clones are used so original records (held elsewhere) don't get mutated
        const answers = this._answers.map((record) => {
            const clone = record.clone();
            clone.ttl = 0;
            return clone;
        });

        packet.setResponseBit();
        packet.setAnswers(answers);

        return packet;
    };

    // Don't suppress recents on goodbyes, return provided packet unchanged
    _suppressRecents = p => p;

    // Don't do answer suppression on goodbyes
    _onAnswer = () => { };
}

export class UnicastResponse extends EventEmitter {
    /**
     * Creates a new UnicastResponse
     * @class
     * @extends EventEmitter
     *
     * Sends out a unicast response to a destination. There are two types of
     * unicast responses here:
     *   - direct responses to QU questions (mDNS rules)
     *   - legacy responses (normal DNS packet rules)
     *
     * @emits 'stopped'
     *
     * @param {NetworkInterface} intf - the interface the response will work on
     * @param {EventEmitter}     offswitch - emitter used to shut this response down
     */
    constructor(intf: NetworkInterface, offswitch: EventEmitter) {
        super();

        // id only used for figuring out logs
        this._id = uniqueId();
        // [debug]: Creating a new unicast response (${this._id});

        this._intf = intf;
        this._offswitch = offswitch;

        // stops on offswitch event or interface errors
        intf.once('error', this._onErrorHandler = () => this.stop());
        offswitch.once('stop', this._onStopHandler = () => this.stop());
        sleep.on('wake', this._onWakeHandler = () => this.stop());
    }

    private _onErrorHandler;
    private _onStopHandler;
    private _onWakeHandler;

    _id: string;
    _intf: NetworkInterface;
    _offswitch: EventEmitter;
    _answers = new RecordCollection<ResourceRecord>();
    _timers = new TimerContainer();
    _delay = 0;
    _isDefensive = false;
    _destination: NetworkPort = null; // will be filled in respondTo() before it is used in start()
    _isLegacy = false;
    _headerID: number = null;
    _questions: QueryRecord[];
    _isStopped = false;

    /**
     * Adds records to be sent out.
     * @param {ResourceRecords|ResourceRecords[]} arg
     */
    add(arg) {
        const records = Array.isArray(arg) ? arg : [arg];

        // In any case where there may be multiple responses, like when all outgoing
        // records are non-unique (like PTRs) response should be delayed 20-120 ms.
        this._delay = records.some(record => !record.isUnique) ? misc.random(20, 120) : 0;
        this._answers.addEach(records);

        return this;
    };


    defensive(bool) {
        this._isDefensive = !!bool;
        return this;
    };


    /**
     * Sets destination info based on the query packet this response is addressing.
     * Legacy responses will have to keep the questions and the packet ID for later.
     *
     * @param {Packet} packet - query packet to respond to
     */
    respondTo(packet: Packet) {
        this._destination = { address: packet.origin.address, port: packet.origin.port };

        if (packet.isLegacy()) {
            // [debug]: preparing legacy response (${this._id});

            this._isLegacy = true;
            this._headerID = packet.header.ID;
            this._questions = packet.questions;

            this._questions.forEach((question) => {
                question.QU = false;
            });
        }

        return this;
    };


    /**
     * Sends response packet to destination. Stops when packet has been sent.
     * No delay for defensive or legacy responses.
     */
    start() {
        const packet = this._makePacket();
        const delay = (this._isDefensive || this._isLegacy) ? 0 : this._delay;

        this._timers.setLazy(() => {
            // [debug]: Sending unicast response (${this._id});

            this._intf.send(packet, this._destination, () => this.stop());
        }, delay);

        return this;
    };


    /**
     * Stops response and cleans up.
     * @emits 'stopped' event when done
     */
    stop() {
        if (this._isStopped) return;

        // [debug]: Unicast response stopped (${this._id});
        this._isStopped = true;

        this._timers.clear();

        this._intf.off('error', this._onErrorHandler);
        this._offswitch.off('stop', this._onStopHandler);
        sleep.off('wake', this._onWakeHandler);

        this.emit('stopped');
    };


    /**
     * Makes response packet. Legacy response packets need special treatment.
     * @return {Packet}
     */
    _makePacket() {
        const packet = new Packet();

        let answers = this._answers.toArray();
        let additionals = answers
            .reduce((result, answer) => result.concat(answer.additionals), [])
            .filter(add => !~answers.indexOf(add));

        additionals = [...new Set(additionals)];

        // Set TTL=10 on records for legacy responses. Use clones to prevent
        // altering the original record set.
        function legacyify(record) {
            const clone = record.clone();
            clone.isUnique = false;
            clone.ttl = 10;
            return clone;
        }

        if (this._isLegacy) {
            packet.header.ID = this._headerID;
            packet.setQuestions(this._questions);

            answers = answers
                .filter(record => record.rrtype !== RType.NSEC)
                .map(legacyify);

            additionals = additionals
                .filter(record => record.rrtype !== RType.NSEC)
                .map(legacyify);
        }

        packet.setResponseBit();
        packet.setAnswers(answers);
        packet.setAdditionals(additionals);

        return packet;
    };
}
