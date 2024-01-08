import * as misc from './misc';

import { EventEmitter } from 'node:events';
import { QueryRecord } from './QueryRecord';
import { Query } from './Query';
import { TimerContainer } from './TimerContainer';
import { StateMachine } from './StateMachine';

import { RType } from './constants';
import { AAAARecord, ARecord, ResourceRecord, SRVRecord, TXTRecord } from './ResourceRecord';
import { NetworkInterface } from './NetworkInterface';
import { Packet } from './Packet';

export interface Service {
    fullname: string;
    name: string;
    type: { name: string, protocol: string };
    domain: string;
    host: string;
    port: number;
    addresses: string[];
    txt: Record<string, true | string>;
    txtRaw: Record<string, true | Buffer>;
}

/**
 * Service Resolver
 *
 * In order to actually use a service discovered on the network, you need to
 * know the address of the service, the port its on, and any TXT data.
 * ServiceResponder takes a description of a service and any initial known
 * records and tries to find the missing pieces.
 *
 * ServiceResolver is a state machine with 3 states: unresolved, resolved, and
 * stopped. The resolver will stay active as long as knowledge about the
 * service is needed. The resolve will check for updates as service records go
 * stale and will notify if records expire and the service goes down.
 *
 * @emits 'resovled'
 * @emits 'updated'
 * @emits 'down'
 */
export class ServiceResolver extends StateMachine {
    /**
     * @param fullname The string describing the service to resolve, such as 'Instance (2)._http._tcp.local.'
     * @param intf
     */
    constructor(fullname: string, intf: NetworkInterface) {
        super();

        this.fullname = fullname;
        this._interface = intf;

        const parts = misc.parse(fullname);
        this.instance = parts.instance;
        this.serviceType = parts.service;
        this.protocol = parts.protocol;

        this.tld = parts.tld;

        // e.g. _http._tcp.local.
        this.ptrname = misc.fqdn(this.serviceType, this.protocol, this.tld);

        // info required for resolution
        this.addresses = [];
        this.target = null;
        this.port = null;
        this.txt = null;
        this.txtRaw = null;
        this._batch = [];
    }

    fullname: string;
    private _interface: NetworkInterface;

    instance: string;
    serviceType: string;
    protocol: string;
    tld: string;
    ptrname: string;
    target: string;
    port: number;
    addresses: string[];
    txt: Record<string, true | string>;
    txtRaw: Record<string, true | Buffer>;
    private _batch: ResourceRecord[] = [];

    states = {
        unresolved: {
            enter: () => {
                // Give resolver 10s to query and resolve. If it can't find
                // all the records it needs in 10s then something is probably wrong

                this._timers.set('timeout', () => this.transition('stopped'), 10 * 1000);

                this._queryForMissing();
            },

            incomingRecords: (records) => {
                const wasUpdated = this._processRecords(records);

                if (this.isResolved())
                    this.transition('resolved');
                else if (wasUpdated)
                    this._queryForMissing();
            },

            reissue: (record) => {
                this._batchReissue(record);
            },

            exit: () => {
                this._cancelQueries();
                this._timers.clear('timeout');
            },
        },

        resolved: {
            enter: () => {
                // [debug]: Service is resolved;
                this.emit('resolved');
            },

            incomingRecords: (records) => {
                const wasUpdated = this._processRecords(records);

                if (!this.isResolved()) this.transition('unresolved');
                else if (wasUpdated) this.emit('updated');
            },

            reissue: (record) => {
                this._batchReissue(record);
            },

            exit: () => {
                this._cancelQueries();
            },
        },

        stopped: {
            enter: () => {
                // [debug]: Stopping resolver "${this.fullname}";

                this._cancelQueries();
                this._removeListeners();

                this.emit('down');

                // override this.transition, because resolver is down now
                // (shouldn't be a problem anyway, more for debugging)
                this.transition = () => {
                    // [debug]: Service is down! Can't transition.
                };
            },
        },
    };

    /**
     * offswitch used to communicate with & stop child queries instead of
     * holding onto a reference for each one
     */
    private _offswitch = new EventEmitter();
    private _timers = new TimerContainer();

    /**
     * Starts the resolver and parses optional starting records
     * @param {ResourceRecords[]} records
     */
    start(records?: ResourceRecord[]) {
        // [debug]: Starting resolver;

        this._addListeners();

        if (records) {
            // [debug.verbose]: Adding initial records: ${records}
            this._processRecords(records);
        }

        this.isResolved()
            ? this.transition('resolved')
            : this.transition('unresolved');
    }


    stop() {
        // [debug]: Stopping resolver;
        this.transition('stopped');
    }


    /**
     * Returns the service that has been resolved. Always returns the same obj
     * reference so they can be included in sets/maps or be compared however.
     *
     * addresses/txt/txtRaw are all cloned so any accidental changes to them
     * won't cause problems within the resolver.
     *
     * Ex: {
     *   fullname : 'Instance (2)._http._tcp.local.',
     *   name     : 'Instance (2)',
     *   type     : {name: 'http', protocol: 'tcp'},
     *   domain   : 'local',
     *   host     : 'target.local.',
     *   port     : 8888,
     *   addresses: ['192.168.1.1', '::1'],
     *   txt      : {key: 'value'},
     *   txtRaw   : {key: <Buffer 76 61 6c 75 65>},
     * }
     *
     * @return {object}
     */
    service() {
        // remove any leading underscores
        const serviceType = this.serviceType.replace(/^_/, '');
        const protocol = this.protocol.replace(/^_/, '');


        // Keep one consistent service object so it can be
        // compared by object reference or kept in a set/map.
        // Re-assign/update properties as needed.
        // Always return this same object.

        return this._service = Object.assign(this._service ?? {}, {
            fullname: this.fullname,
            name: this.instance,
            type: { name: serviceType, protocol },
            domain: this.tld,
            host: this.target,
            port: this.port,
            addresses: this.addresses.slice(),
            txt: (this.txt) ? Object.assign({}, this.txt) : {},
            txtRaw: (this.txtRaw) ? Object.assign({}, this.txtRaw) : {},
        });
    }

    private _service: Service = undefined;

    isResolved() {
        return !!this.addresses.length &&
            !!this.target &&
            !!this.port &&
            !!this.txtRaw;
    }


    /**
     * Listen to new answers coming to the interfaces. Do stuff when interface
     * caches report that a record needs to be refreshed or when it expires.
     * Stop on interface errors.
     */
    _addListeners() {
        this._interface.on('answer', this._onAnswerHandler = (packet: Packet) => this._onAnswer(packet));
        this._interface.once('error', this._onErrorHandler = err => this.transition('stopped', err));
        this._interface.cache.on('reissue', this._onReissueHandler = (record: ResourceRecord) => this._onReissue(record))
        this._interface.cache.on('expired', this._onExpiredHandler = (record: ResourceRecord) => this._onExpired(record));
    }

    private _onAnswerHandler;
    private _onErrorHandler;
    private _onReissueHandler;
    private _onExpiredHandler;

    _removeListeners() {
        if (this._onAnswerHandler) this._interface.off('answer', this._onAnswerHandler);
        if (this._onErrorHandler) this._interface.off('error', this._onErrorHandler);
        if (this._onReissueHandler) this._interface.cache.off('reissue', this._onReissueHandler);
        if (this._onExpiredHandler) this._interface.cache.off('expired', this._onExpiredHandler);
    }


    _onAnswer(packet: Packet) {
        this.handle('incomingRecords', [...packet.answers, ...packet.additionals]);
    }


    /**
     * As cached records go stale they need to be refreshed. The cache will ask
     * for updates to records as they reach 80% 85% 90% and 95% of their TTLs.
     * This listens to all reissue events from the cache and checks if the record
     * is relevant to this resolver. If it is, the fsm will handle it based on
     * what state its currently in.
     *
     * If the SRV record needs to be updated the PTR is queried too. Some dumb
     * responders seem more likely to answer the PTR question.
     */
    _onReissue(record: ResourceRecord) {
        const isRelevant = record.matches({ name: this.fullname }) ||
            record.matches({ name: this.ptrname, PTRDName: this.fullname }) ||
            record.matches({ name: this.target });

        const isSRV = record.matches({ rrtype: RType.SRV, name: this.fullname });

        if (isRelevant) {
            this.handle('reissue', record);
        }

        if (isSRV) {
            this.handle('reissue', { name: this.ptrname, rrtype: RType.PTR });
        }
    }


    /**
     * Check records as they expire from the cache. This how the resolver learns
     * that a service has died instead of from goodbye records with TTL=0's.
     * Goodbye's only tell the cache to purge the records in 1s and the resolver
     * should ignore those.
     */
    _onExpired(record: ResourceRecord) {
        // PTR/SRV: transition to stopped, service is down
        const isDown = record.matches({ rrtype: RType.SRV, name: this.fullname }) ||
            record.matches({ rrtype: RType.PTR, name: this.ptrname, PTRDName: this.fullname });

        // A/AAAA: remove address & transition to unresolved if none are left
        const isAddress = record.matches({ rrtype: RType.A, name: this.target }) ||
            record.matches({ rrtype: RType.AAAA, name: this.target });

        // TXT: remove txt & transition to unresolved
        const isTXT = record.matches({ rrtype: RType.TXT, name: this.fullname });

        if (isDown) {
            //debug('Service expired, resolver going down. (%s)', record);
            this.transition('stopped');
        }

        if (isAddress) {
            //debug('Address record expired, removing. (%s)', record);

            this.addresses = this.addresses.filter(add => add !== (record as ARecord | AAAARecord).address);
            if (!this.addresses.length) this.transition('unresolved');
        }

        if (isTXT) {
            //debug('TXT record expired, removing. (%s)', record);
            this.txt = null;
            this.txtRaw = null;
            this.transition('unresolved');
        }
    }


    /**
     * Checks incoming records for changes or updates. Returns true if anything
     * happened.
     *
     * @param  {ResourceRecord[]} incoming
     * @return {boolean}
     */
    _processRecords(incoming: ResourceRecord[]) {
        // reset changes flag before checking records
        this._changed = false;

        // Ignore TTL 0 records. Get expiration events from the caches instead
        const records = incoming.filter(record => record.ttl > 0);
        if (!records.length) return false;

        const findOne = params => records.find(record => record.matches(params));
        const findAll = params => records.filter(record => record.matches(params));

        // SRV/TXT before A/AAAA, since they contain the target for A/AAAA records
        const SRV = findOne({ rrtype: RType.SRV, name: this.fullname }) as SRVRecord;
        const TXT = findOne({ rrtype: RType.TXT, name: this.fullname }) as TXTRecord;

        if (SRV) this._processSRV(SRV);
        if (TXT) this._processTXT(TXT);

        if (!this.target) return this._changed;

        const As = findAll({ rrtype: RType.A, name: this.target }) as ARecord[];
        const AAAAs = findAll({ rrtype: RType.AAAA, name: this.target }) as AAAARecord[];

        if (As.length) As.forEach(A => this._processAddress(A));
        if (AAAAs.length) AAAAs.forEach(AAAA => this._processAddress(AAAA));

        return this._changed;
    }

    /**
     * dirty flag to track changes to service info. gets reset to false before
     * each incoming answer packet is checked. 
     */
    private _changed = false;

    _processSRV(record: SRVRecord) {
        if (this.port !== record.port) {
            this.port = record.port;
            this._changed = true;
        }

        // if the target changes the addresses are no longer valid
        if (this.target !== record.target) {
            this.target = record.target;
            this.addresses = [];
            this._changed = true;
        }
    }


    _processTXT(record: TXTRecord) {
        if (!misc.equals(this.txtRaw, record.txtRaw)) {
            this.txtRaw = record.txtRaw;
            this.txt = record.txt;
            this._changed = true;
        }
    }


    _processAddress(record: ARecord | AAAARecord) {
        if (this.addresses.indexOf(record.address) === -1) {
            this.addresses.push(record.address);
            this._changed = true;
        }
    }


    /**
     * Tries to get info that is missing and needed for the service to resolve.
     * Checks the interface caches first and then sends out queries for whatever
     * is still missing.
     */
    _queryForMissing() {
        // [debug]: Getting missing records;

        const questions = [];

        // get missing SRV
        if (!this.target) 
            questions.push({ name: this.fullname, qtype: RType.SRV });

        // get missing TXT
        if (!this.txtRaw) 
            questions.push({ name: this.fullname, qtype: RType.TXT });

        // get missing A/AAAA
        if (this.target && !this.addresses.length) {
            questions.push({ name: this.target, qtype: RType.A });
            questions.push({ name: this.target, qtype: RType.AAAA });
        }

        // check interface caches for answers first
        this._checkCache(questions);

        // send out queries for what is still unanswered
        // (_checkCache may have removed all/some questions from the list)
        if (questions.length) this._sendQueries(questions);
    }


    /**
     * Checks the cache for missing records. Tells the fsm to handle new records
     * if it finds anything
     */
    _checkCache(questions) {
        // [debug]: Checking cache for needed records;

        const answers = [];

        // check cache for answers to each question
        questions.forEach((question, index) => {
            const results = this._interface.cache.find(new QueryRecord(question));

            if (results && results.length) {
                // remove answered questions from list
                questions.splice(index, 1);
                answers.push(...results);
            }
        });

        // process any found records
        answers.length && this.handle('incomingRecords', answers);
    }


    /**
     * Sends queries out on each interface for needed records. Queries are
     * continuous, they keep asking until they get the records or until they
     * are stopped by the resolver with `this._cancelQueries()`.
     */
    _sendQueries(questions) {
        // [debug]: Sending queries for needed records;

        // stop any existing queries, they might be stale now
        this._cancelQueries();

        // no 'answer' event handler here because this resolver is already
        // listening to the interface 'answer' event
        this.createQuery()
            .ignoreCache(true)
            .add(questions)
            .start();
    }

    protected createQuery() {
        return new Query(this._interface, this._offswitch);
    }


    /**
     * Reissue events from the cache are slightly randomized for each record's TTL
     * (80-82%, 85-87% of the TTL, etc) so reissue queries are batched here to
     * prevent a bunch of outgoing queries from being sent back to back 10ms apart.
     */
    _batchReissue(record: ResourceRecord) {
        //debug('Batching record for reissue %s', record);

        this._batch.push(record);

        if (!this._timers.has('batch')) {
            this._timers.setLazy('batch', () => {
                this._sendReissueQuery(this._batch);
                this._batch = [];
            }, 1 * 1000);
        }
    }


    /**
     * Asks for updates to records. Only sends one query out (non-continuous).
     */
    _sendReissueQuery(records: ResourceRecord[]) {
        //debug('Reissuing query for cached records: %r', records);

        const questions = records.map(({ name, rrtype }) => ({ name, qtype: rrtype }));

        this.createQuery()
            .continuous(false) // only send query once, don't need repeats
            .ignoreCache(true) // ignore cache, trying to renew this record
            .add(questions)
            .start();
    }


    _cancelQueries() {
        // [debug]: Sending stop signal to active queries & canceling batched;
        this._offswitch.emit('stop');
        this._timers.clear('batch');
    }
}