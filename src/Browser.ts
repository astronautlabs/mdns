import * as misc from './misc';
import { ServiceType } from './ServiceType';
import { EventEmitter } from 'node:events';

import { ServiceResolver } from './ServiceResolver';
import { NetworkInterface } from './NetworkInterface';
import { Query } from './Query';

import { RType } from './constants';
import { PTRRecord, ResourceRecord } from './ResourceRecord';
const STATE = { STOPPED: 'stopped', STARTED: 'started' } as const;

/**
 * @emits 'serviceUp'
 * @emits 'serviceChanged'
 * @emits 'serviceDown'
 * @emits 'error'
 */
export class Browser extends EventEmitter {
    /**
     * Creates a new Browser
     * 
     * @param {ServiceType|Object|String|Array} type - the service to browse
     * @param {Object} [options]
     */
    constructor(type, options: { domain?: string, interface?: string, maintain?: boolean, resolve?: boolean, name?: string } = {}) {
        super();

        // convert argument ServiceType to validate it (might throw)
        const serviceType = (type instanceof ServiceType) ? type : new ServiceType(type);

        // can't search for multiple subtypes at the same time
        if (serviceType.subtypes.length > 1) {
            throw new Error('Too many subtypes. Can only browse one at a time.');
        }

        this._id = serviceType.toString();
        // [debug]: Creating new browser for "${this._id}";

        this._resolvers = {}; 
        this._protocol = serviceType.protocol;
        this._serviceName = serviceType.name;
        this._subtype = serviceType.subtypes[0];
        this._isWildcard = serviceType.isEnumerator;
        this._domain = options.domain || 'local.';
        this._maintain = ('maintain' in options) ? options.maintain : true;
        this._resolve = ('resolve' in options) ? options.resolve : true;
        this._interface = this.resolveNetworkInterface(options.interface);
        this._state = STATE.STOPPED;

        // emitter used to stop child queries instead of holding onto a reference
        // for each one
    }

    /**
     * active service resolvers (when browsing services)
     */
    private _resolvers: Record<string, ServiceResolver> = {};

    /**
     * active service types (when browsing service types)
     */
    private _serviceTypes: Record<string, { name: string, protocol: 'tcp' | 'udp' }> = {}; 
    private _id: string;
    private _protocol: '_tcp' | '_udp';
    private _serviceName: string;
    private _subtype: string;
    private _isWildcard: boolean;
    private _domain: string;
    private _maintain: boolean;
    private _resolve: boolean;
    private _interface: NetworkInterface;
    private _state: 'started' | 'stopped';
    private _offswitch = new EventEmitter();

    /**
     * Starts browser
     * @return {this}
     */
    start() {
        if (this._state === STATE.STARTED) {
            // [debug]: Browser already started!;
            return this;
        }

        // [debug]: Starting browser for "${this._id}";
        this._state = STATE.STARTED;

        // listen for fatal errors on interface
        this._interface.once('error', this._onErrorHandler = err => this._onError(err));

        this._interface.bind()
            .then(() => this._startQuery())
            .catch(err => this._onError(err));

        return this;
    };


    /**
     * Stops browser.
     *
     * Browser shutdown has to:
     *   - shut down all child service resolvers (they're no longer needed)
     *   - stop the ongoing browsing queries on all interfaces
     *   - remove all listeners since the browser is down
     *   - deregister from the interfaces so they can shut down if needed
     */
    stop() {
        // [debug]: Stopping browser for "${this._id}";

        if (this._onErrorHandler) this._interface.off('error', this._onErrorHandler);
        this._interface.stopUsing();

        // [debug]: Sending stop signal to active queries;
        this._offswitch.emit('stop');

        // because resolver.stop()'s will trigger serviceDown:
        this.removeAllListeners('serviceDown');
        Object.values(this._resolvers).forEach(resolver => resolver.stop());

        this._state = STATE.STOPPED;
        this._resolvers = {};
        this._serviceTypes = {};
    };


    /**
     * Get a list of currently available services
     * @return {Objects[]}
     */
    list() {
        // if browsing service types
        if ((this._isWildcard)) {
            return Object.values(this._serviceTypes);
        }

        return Object.values(this._resolvers)
            .filter(resolver => resolver.isResolved())
            .map(resolver => resolver.service());
    };

    _onErrorHandler: (err: Error) => void;

    /**
     * Error handler
     * @emits 'error'
     */
    _onError(err) {
        // [debug]: Error on "${this._id}", shutting down. Got: \n${err};

        this.stop();
        this.emit('error', err);
    };


    /**
     * Starts the query for either services (like each available printer)
     * or service types using enumerator (listing all mDNS service on a network).
     * Queries are sent out on each network interface the browser uses.
     */
    _startQuery() {
        let name = misc.fqdn(this._serviceName, this._protocol, this._domain);

        if (this._subtype) name = misc.fqdn(this._subtype, '_sub', name);

        const question = { name, qtype: RType.PTR };

        const answerHandler = (this._isWildcard)
            ? this._addServiceType.bind(this)
            : this._addService.bind(this);

        // start sending continuous, ongoing queries for services
        this.createQuery()
            .add(question)
            .on('answer', answerHandler)
            .start();
    };

    protected createQuery() {
        return new Query(this._interface, this._offswitch);
    }

    /**
     * Answer handler for service types. Adds type and alerts user.
     *
     * @emits 'serviceUp' with new service types
     * @param {ResourceRecord} answer
     */
    _addServiceType(answer) {
        const name = answer.PTRDName;

        if (this._state === STATE.STOPPED) return // debug.v('Already stopped, ignoring');
        if (answer.ttl === 0) return // debug.v('TTL=0, ignoring');
        if (this._serviceTypes[name]) return // debug.v('Already found, ignoring');

        // [debug]: Found new service type: "${name}";

        let { service, protocol } = misc.parse(name);

        // remove any leading underscores for users
        service = service.replace(/^_/, '');

        const serviceType = { name: service, protocol: <'tcp' | 'udp'>protocol.replace(/^_/, '') };

        this._serviceTypes[name] = serviceType;
        this.emit('serviceUp', serviceType);
    };

    /**
     * Answer handler for services.
     *
     * New found services cause a ServiceResolve to be created. The resolver
     * parse the additionals and query out for an records needed to fully
     * describe the service (hostname, IP, port, TXT).
     *
     * @emits 'serviceUp'      when a new service is found
     * @emits 'serviceChanged' when a resolved service changes data (IP, etc.)
     * @emits 'serviceDown'    when a resolved service goes down
     *
     * @param {ResourceRecord}   answer        - the record that has service data
     * @param {ResourceRecord[]} [additionals] - other records that might be related
     */
    _addService(answer: PTRRecord, additionals: ResourceRecord[]) {
        const name = answer.PTRDName;

        if (this._state === STATE.STOPPED) return // debug.v('Already stopped, ignoring');
        if (answer.ttl === 0) return // debug.v('TTL=0, ignoring');
        if (this._resolvers[name]) return // debug.v('Already found, ignoring');

        // [debug]: Found new service: "${name}";

        if (!this._resolve) {
            this.emit('serviceUp', misc.parse(name).instance);
            return;
        }

        const resolver = this.createServiceResolver(name);
        this._resolvers[name] = resolver;

        resolver.once('resolved', () => {
            // [debug]: Service up;

            // - stop resolvers that dont need to be maintained
            // - only emit 'serviceDown' events once services that have been resolved
            if (!this._maintain) {
                resolver.stop();
                this._resolvers[name] = null;
            } else {
                resolver.once('down', () => this.emit('serviceDown', resolver.service()));
            }

            this.emit('serviceUp', resolver.service());
        });

        resolver.on('updated', () => {
            // [debug]: Service updated;
            this.emit('serviceChanged', resolver.service());
        });

        resolver.once('down', () => {
            // [debug]: Service down;
            delete this._resolvers[name];
        });

        resolver.start(additionals);
    };

    protected createServiceResolver(name: string) {
        return new ServiceResolver(name, this._interface);
    }

    protected resolveNetworkInterface(name?: string) {
        return NetworkInterface.get(name);
    }
}