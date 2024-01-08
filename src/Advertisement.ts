import * as os from 'os';

import * as misc from './misc';
import * as validate from './validate';
import { ServiceType } from './ServiceType';
import { EventEmitter } from 'node:events';
import { AAAARecord, ARecord, NSECRecord, PTRRecord, ResourceRecord, SRVRecord, TXTRecord } from './ResourceRecord';
import { QueryRecord } from './QueryRecord';
import { Packet } from './Packet';
import { sleep } from './sleep';

import { Responder } from './Responder';
import { NetworkInterface } from './NetworkInterface';

import { RType } from './constants';
import { Address } from './Address';
import { Platform } from './Platform';

const STATE = { STOPPED: 'stopped', STARTED: 'started' } as const;

/**
 * Options for the Advertisement constructor.
 */
export interface AdvertisementOptions {
    /**
     * The instance name to use. In a fully qualified domain, this is `Instance` in 
     * `Instance._service._protocol.local`. If the instance name is already in use on the 
     * local network, it will be automatically renamed (for instance "MyInstance" might become 
     * "MyInstance (1)" or "MyInstance (2)").
     */
    name?: string;

    /**
     * The hostname to use for the advertisement. When not provided, this is the OS' hostname.
     * Should not include `.local`. Your service will be advertised on this hostname via a 
     * SRV record, and the hostname resolution record itself will be automatically advertised 
     * based on the network interface in use (A/AAAA).
     */
    host?: string;

    /**
     * Optional TXT record key/value pairs to include with the service advertisement. These can 
     * be used to provide short metadata values that other clients can read and act on.
     */
    txt?: Record<any, any>;

    /**
     * Define zero or more subtypes for this advertisement. Subtypes are used to differentiate the 
     * "role" of a specific service when the service name itself is too generic. For instance, if 
     * you are advertising an HTTP server, you can certainly advertise MyServer._http._tcp, but if 
     * that HTTP server is the administration interface of a printer, you may wish to advertise it 
     * with a subtype of "_printer", so that browsers can look for printer-specific HTTP services.
     * 
     * Browsers can then use "_printer._sub._http._tcp" to find your service.
     */
    subtypes?: string[];

    /**
     * Which network interface you wish to advertise on. When left blank, all interfaces receive
     * the advertisement.
     */
    interface?: string;

    /**
     * Time To Live (TTL) to use for the hostname record (A/AAAA). Defaults to 120 seconds.
     */
    hostTTL?: number;

    /**
     * Time to Live (TTL) to use for the service record(s) (NSEC/SRV/TXT). Defaults to 120 seconds. 
     */
    serviceTTL?: number;
}

/**
 * Provides the ability to advertise a service over mDNS/DNS-SD for discovery by other devices.
 * - Use `start()` to advertise the service. Browsers will interpret this as `serviceUp`.
 * - Use `stop()` to end the advertisement. Browsers will interpret this as `serviceDown`.
 * - Listen for the `active` event to know when the service is visible to other clients. 
 * - Listen for the `instanceRenamed` event to know when a conflict occurs which will cause the 
 *   mDNS name of your advertised service to change to solve the conflict.
 * - Listen for the `stopped` event to know when this advertisement has been stopped.
 * - Listen for errors with the `error` event.
 */
export class Advertisement extends EventEmitter {
    /**
     * Creates a new Advertisement. You can then start the advertisement with `start()`.
     * 
     * @param type type of service to advertise
     * @param port The port to advertise. This should be the port that your service is available
     *             on the local host. 
     * @param options The options to use for the advertisement. Of particular note is the the `interface`
     *                option which should be used if your service is not listening on all interfaces.
     */
    constructor(type: string | any, port: number, options: AdvertisementOptions = {}) {
        super();

        // convert argument ServiceType to validate it (might throw)
        const serviceType = (!(type instanceof ServiceType))
            ? new ServiceType(type)
            : type;

        // validate other inputs (throws on invalid)
        validate.port(port);

        if (options.txt) validate.txt(options.txt);
        if (options.name) validate.label(options.name, 'Instance');
        if (options.host) validate.label(options.host, 'Hostname');

        this.serviceName = serviceType.name;
        this.protocol = serviceType.protocol;
        this.subtypes = (options.subtypes) ? options.subtypes : serviceType.subtypes;
        this.port = port;
        this._instanceName = options.name || misc.hostname();
        this._hostname = options.host || misc.hostname();
        this._txt = options.txt || {};

        this._tld = 'local';

        this._id = misc.fqdn(this._instanceName, this.serviceName, this.protocol, 'local');
        //console.log(`[debug]: Creating new advertisement for "${this._id}" on ${port}`);

        this._state = STATE.STOPPED;
        this._interface = this.resolveNetworkInterface(options.interface);
        this._hostTTL = options.hostTTL || this._hostTTL;
        this._serviceTTL = options.serviceTTL || this._serviceTTL;
    }

    get id() { return this._id; }

    /**
     * Retrieve the TXT record's key/value pairs. Use updateTxt() to change these.
     */
    get txt() { return Object.assign(this._txt); }

    /**
     * Retrieve the current instance name for this advertisement. This may differ from 
     * what was requested when the Advertisement was constructed if there were conflicts 
     * with other advertisements on the network.
     */
    get instanceName() { return this._instanceName; }

    /**
     * The hostname which this service advertisement points to. This value may differ
     * from the hostname requested when the Advertisement was constructed if there was 
     * a conflict with another device on the network.
     */
    get hostname() { return this._hostname; }

    /**
     * The top level domain for this advertisement. Generally this is always "local".
     */
    get tld() { return this._tld; }

    /**
     * The state of this advertisement. Is "started" if the advertisement is ongoing,
     * is "stopped" if the advertisement has been stopped, and is undefined if the 
     * advertisement has never been started or stopped.
     */
    get state() { return this._state; }

    /**
     * The Time To Live (TTL) for the automatically advertised hostname record. 
     * Defaults to 120 seconds. Can be changed when the Advertisement is constructed.
     */
    get hostTTL() { return this._hostTTL; }

    /**
     * The Time To Live (TTL) for the service records (NSEC/SRV/TXT).
     * Defaults to 120 seconds. Can be changed when the Advertisement is constructed.
     */
    get serviceTTL() { return this._serviceTTL; }

    /**
     * The service name for this advertisement. For example, this could be "_http" to 
     * advertise as an HTTP server using the conventional service name, or perhaps "_googlecast"
     * when implementing a Google Cast compatible device.
     */
    readonly serviceName: string;

    /**
     * The protocol for this advertisement. Typically this is "_tcp" or "_udp", but it could 
     * be something else.
     */
    readonly protocol: string;

    /**
     * The subtypes being advertised. Subtypes allow browsers to differentiate between servers that 
     * offer a particular kind of service based on what the service is for. For instance you might advertise
     * a printer's administration panel web server with the "_printer" subtype. Browsers can then find 
     * printer-specific web page services in the domain "_printer._sub._http._tcp".
     */
    readonly subtypes: string[];

    /**
     * The port that the advertised service is running on. 
     */
    readonly port: number;
    
    private _instanceName: string;
    private _hostname: string;
    private _tld: string;
    private _state: 'started' | 'stopped';
    private _hostTTL = 120;
    private _serviceTTL = 120;
    private _txt: Record<any, any>;
    private _id: string;
    private _interface: NetworkInterface;
    private _hostnameResponder: Responder = null;
    private _serviceResponder: Responder = null;
    private _defaultAddresses: Address[] = null;

    /**
     * Starts advertisement
     *
     * In order:
     *   - bind interface to multicast port
     *   - make records and advertise this.hostname
     *   - make records and advertise service
     *
     * If the given hostname is already taken by someone else (not including
     * bonjour/avahi on the same machine), the hostname is automatically renamed
     * following the pattern:
     * Name -> Name (2)
     *
     * Services aren't advertised until the hostname has been properly advertised
     * because a service needs a host. Service instance names (this.instanceName)
     * have to be unique and get renamed automatically the same way.
     *
     * @param {Function} [callback]
     * @return {this}
     */
    start(callback?: (err: Error, state: 'started' | 'stopped') => void) {
        if (this._state === STATE.STARTED) {
            //console.log(`[debug]: Advertisement already started!`);
            return this;
        }

        //console.log(`[debug]: Starting advertisement "${this._id}"`);
        this._state = STATE.STARTED;

        // restart probing process when waking from sleep
        sleep.on('wake', this._restartHandler = () => this._restart());

        // treat interface errors as fatal
        this._interface.once('error', this._onErrorHandler = err => this._onError(err));

        this._interface.bind()
            .then(() => this._getDefaultID())
            .then(() => this._advertiseHostname())
            .then(() => this._advertiseService())
            .catch(err => this._onError(err))
            .then(err => {
                if (callback) {
                    return callback(err, this._state);
                }
            });

        return this;
    };


    /**
     * Stops advertisement
     *
     * Advertisement can do either a clean stop or a forced stop. A clean stop will
     * send goodbye records out so others will know the service is going down. This
     * takes ~1s. Forced goodbyes shut everything down immediately w/o goodbyes.
     *
     * `this._shutdown()` will deregister the advertisement. If the advertisement was
     * the only thing using the interface it will shut down too.
     *
     * @emits 'stopped'
     *
     * @param forceImmediate When true, ends the advertisement immediately without sending a Goodbye message. 
     *                       This may cause the advertisement to remain active on browsers longer than desired,
     *                       but will cause all network activity to cease immediately. 
     * @param callback       Called when the stop is completed.
     */
    stop(forceImmediate = false, callback?: () => void) {
        //console.log(`[debug]: Stopping advertisement "${this._id}"...`);
        this._state = STATE.STOPPED;

        const shutdown = () => {
            this._hostnameResponder = null;
            this._serviceResponder = null;

            if (this._queryHandler) this._interface.off('query', this._queryHandler);
            if (this._onErrorHandler) this._interface.off('error', this._onErrorHandler);
            if (this._restartHandler) sleep.off('wake', this._restartHandler);
            
            this._interface.stopUsing();
            //console.log(`[debug]: Stopped.`);

            callback?.();
            this.emit('stopped');
        };

        // If doing a clean stop, responders need to send goodbyes before turning off
        // the interface. Depending on when the advertisment was stopped, it could
        // have one, two, or no active responders that need to send goodbyes
        let numResponders = 0;
        if (this._serviceResponder) numResponders++;
        if (this._hostnameResponder) numResponders++;

        const done = misc.after_n(shutdown, numResponders);

        // immediate shutdown (forced or if there aren't any active responders)
        // or wait for goodbyes on a clean shutdown
        if (forceImmediate || !numResponders) {
            this._serviceResponder && this._serviceResponder.stop();
            this._hostnameResponder && this._hostnameResponder.stop();
            shutdown();
        } else {
            this._serviceResponder && this._serviceResponder.goodbye(done);
            this._hostnameResponder && this._hostnameResponder.goodbye(done);
        }
    };


    /**
     * Replaces the advertisement's TXT record with the given key/pair values.
     * @param values The key/value pairs to use
     */
    updateTXT(values: Record<string, boolean | string | number>) {
        // validates txt first, will throw validation errors on bad input
        validate.txt(values);

        if (this._serviceResponder == null) {
            //console.log(`[debug] ServiceResponder not ready`);
            return;
        }

        this._txt = values;

        // make sure responder handles network requests in event loop before updating
        // (otherwise could have unintended record conflicts)
        setImmediate(() => {
            this._serviceResponder.updateEach(RType.TXT, (record) => {
                record.txtRaw = misc.makeRawTXT(values);
                record.txt = misc.makeReadableTXT(values);
            });
        });
    };

    private _onErrorHandler: (err: Error) => void;

    /**
     * Error handler. Does immediate shutdown without goodbyes.
     * @emits 'error'
     */
    private _onError(err) {
        //console.log(`Error on "${this._id}", shutting down. Got: \n${err}`);
        //console.log(`[debug]: Error on "${this._id}", shutting down. Got: \n${err}`);

        this.stop(true); // stop immediately
        this.emit('error', err);
        return err;
    };

    private _restartHandler: () => void;
    private _restart() {
        if (this._state !== STATE.STARTED)  {
            //console.log(`[debug]: Not yet started, skipping`);
            return 
        }

        //console.log(`[debug]: Waking from sleep, restarting "${this._id}"`);

        // stop responders if they exist
        this._serviceResponder && this._serviceResponder.stop();
        this._hostnameResponder && this._hostnameResponder.stop();

        this._hostnameResponder = null;
        this._serviceResponder = null;

        // need to check if active interface has changed
        this._getDefaultID()
            .then(() => this._advertiseHostname())
            .then(() => this._advertiseService())
            .catch(err => this._onError(err));
    };

    private _getDefaultID() {
        //console.log(`[debug]: Trying to find the default route (${this._id})`);

        return new Promise<void>((resolve, reject) => {
            let timeout = setTimeout(() => {
                //console.log(`[debug]: Timed out getting default route (${this._id})`);
                reject(new Error(`Timed out getting default route (${this._id})`));
            }, 500);

            const question = new QueryRecord({ name: misc.fqdn(this._hostname, this._tld) });
            const queryPacket = new Packet();
            queryPacket.setQuestions([question]);

            // try to listen for our own query

            this._interface.on('query', this._queryHandler = packet => {
                //console.log(`[debug]: While finding default route: Received query`);

                if (packet.isLocal() && packet.equals(queryPacket)) {
                    this._defaultAddresses = Object.values(Platform.getNetworkInterfaces()).find(intf =>
                        intf.some(({ address }) => address === packet.origin.address));

                    if (this._defaultAddresses) {
                        this._interface.off('query', this._queryHandler);
                        //console.log(`[debug]: Found default route`);
                        resolve();
                        clearTimeout(timeout);
                    }
                }
            });

            this._interface.send(queryPacket);
        });
    };

    private _queryHandler: (packet: Packet) => void;

    /**
     * Advertise the same hostname
     *
     * A new responder is created for this task. A responder is a state machine
     * that will talk to the network to do advertising. Its responsible for a
     * single record set from `_makeAddressRecords` and automatically renames
     * them if conflicts are found.
     *
     * Returns a promise that resolves when a hostname has been authoritatively
     * advertised. Rejects on fatal errors only.
     *
     * @return {Promise}
     */
    private _advertiseHostname() {
        const interfaces = Object.values(Platform.getNetworkInterfaces());
        const records = this._makeAddressRecords(this._defaultAddresses);
        const bridgeable = [].concat(...interfaces.map(i => this._makeAddressRecords(i)));

        //console.log(`Advertising hostname...`);
        return new Promise<void>((resolve, reject) => {
            const responder = this.createResponder(records, bridgeable);
            this._hostnameResponder = responder;

            responder.on('rename', this._onHostRename.bind(this));
            responder.once('probingComplete', () => {
                //console.log(`Finished advertising hostname.`);
                resolve()
            });
            responder.once('error', reject);

            responder.start();
        });
    };

    /**
     * Utility method to create a Responder instance. This can be overridden in subclasses.
     * Currently only used in tests.
     */
    protected createResponder(records: ResourceRecord[], bridgeable?: ResourceRecord[]) {
        return new Responder(this._interface, records, bridgeable);
    }


    /**
     * Handles rename events from the interface hostname responder.
     *
     * If a conflict was been found with a proposed hostname, the responder will
     * rename and probe again. This event fires *after* the rename but *before*
     * probing, so the name here isn't guaranteed yet.
     *
     * The hostname responder will update its A/AAAA record set with the new name
     * when it does the renaming. The service responder will need to update the
     * hostname in its SRV record.
     *
     * @emits 'hostRenamed'
     *
     * @param {String} hostname - the new current hostname
     */
    private _onHostRename(hostname) {
        //console.log(`[debug]: Hostname renamed to "${hostname}" on interface records`);

        const target = misc.fqdn(hostname, this._tld);
        this._hostname = hostname;

        if (this._serviceResponder) {
            this._serviceResponder.updateEach(RType.SRV, (record) => {
                record.target = target;
            });
        }

        this.emit('hostRenamed', target);
    };


    /**
     * Advertises the service
     *
     * A new responder is created for this task also. The responder will manage
     * the record set from `_makeServiceRecords` and automatically rename them
     * if conflicts are found.
     *
     * The responder will keeps advertising/responding until `advertisement.stop()`
     * tells it to stop.
     *
     * @emits 'instanceRenamed' when the service instance is renamed
     */
    private _advertiseService() {
        const records = this._makeServiceRecords();
        //console.log(`Advertising service:`);
        //console.dir(records);

        const responder = this.createResponder(records);
        this._serviceResponder = responder;

        responder.on('rename', (instance) => {
            //console.log(`[debug]: Service instance had to be renamed to "${instance}"`);
            this._id = misc.fqdn(instance, this.serviceName, this.protocol, 'local');
            this._instanceName = instance;
            this.emit('instanceRenamed', instance);
        });

        responder.once('probingComplete', () => {
            //console.log(`[debug]: Probed successfully, "${this._id}" now active`);
            this.emit('active');
        });

        responder.once('error', err => {
            //console.error(`[debug]: Error while advertising service:`);
            //console.error(err);
            this._onError(err);
        });
        responder.start();
    };


    /**
     * Make the A/AAAA records that will be used on an interface.
     *
     * Each interface will have its own A/AAAA records generated because the
     * IPv4/IPv6 addresses will be different on each interface.
     *
     * NSEC records are created to show which records are available with this name.
     * This lets others know if an AAAA doesn't exist, for example.
     * (See 8.2.4 Negative Responses or whatever)
     *
     * @param  {NetworkInterface} addresses
     * @return {ResourceRecords[]}
     */
    private _makeAddressRecords(addresses: Address[]) {
        const name = misc.fqdn(this._hostname, this._tld);

        const As = addresses
            .filter(({ family }) => family === 'IPv4')
            .map(({ address }) => new ARecord({ name, address, ttl: this._hostTTL }));

        const AAAAs = addresses
            .filter(({ family }) => family === 'IPv6')
            .filter(({ address }) => address.substr(0, 6).toLowerCase() === 'fe80::')
            .map(({ address }) => new AAAARecord({ name, address, ttl: this._hostTTL }));

        const types: number[] = [];
        if (As.length) types.push(RType.A);
        if (AAAAs.length) types.push(RType.AAAA);

        const NSEC = new NSECRecord({
            name: name,
            ttl: this._hostTTL,
            existing: types,
        });

        As.forEach((A) => {
            A.additionals = (AAAAs.length) ? [...AAAAs, NSEC] : [NSEC];
        });

        AAAAs.forEach((AAAA) => {
            AAAA.additionals = (As.length) ? [...As, NSEC] : [NSEC];
        });

        return [...As, ...AAAAs, NSEC];
    };


    /**
     * Make the SRV/TXT/PTR records that will be used on an interface.
     *
     * Each interface will have its own SRV/TXT/PTR records generated because
     * these records are dependent on the A/AAAA hostname records, which are
     * different for each hostname.
     *
     * NSEC records are created to show which records are available with this name.
     *
     * @return {ResourceRecords[]}
     */
    private _makeServiceRecords() {
        const records = [];
        const interfaceRecords = this._hostnameResponder.getRecords();

        // enumerator  : "_services._dns-sd._udp.local."
        // registration: "_http._tcp.local."
        // serviceName : "A web page._http._tcp.local."
        const enumerator = misc.fqdn('_services._dns-sd._udp', this._tld);
        const registration = misc.fqdn(this.serviceName, this.protocol, this._tld);
        const serviceName = misc.fqdn(this._instanceName, registration);

        const NSEC = new NSECRecord({
            name: serviceName,
            existing: [RType.SRV, RType.TXT],
            ttl: this._hostTTL,
        });

        const SRV = new SRVRecord({
            name: serviceName,
            target: misc.fqdn(this._hostname, this._tld),
            port: this.port,
            additionals: [NSEC, ...interfaceRecords],
            ttl: this._serviceTTL,
        });

        const TXT = new TXTRecord({
            name: serviceName,
            additionals: [NSEC],
            txt: this._txt,
            ttl: this._serviceTTL,
        });

        records.push(SRV);
        records.push(TXT);
        records.push(NSEC);

        records.push(new PTRRecord({
            name: registration,
            PTRDName: serviceName,
            additionals: [SRV, TXT, NSEC, ...interfaceRecords],
            ttl: this._serviceTTL,
        }));

        records.push(new PTRRecord({
            name: enumerator,
            PTRDName: registration,
            ttl: this._serviceTTL,
        }));

        // ex: "_printer.sub._http._tcp.local."
        this.subtypes.forEach((subType) => {
            records.push(new PTRRecord({
                name: misc.fqdn(subType, '_sub', registration),
                PTRDName: serviceName,
                additionals: [SRV, TXT, NSEC, ...interfaceRecords],
                ttl: this._serviceTTL,
            }));
        });

        return records;
    };

    /**
     * Acquire a NetworkInterface object for the given interface name (or the default network interface if none is 
     * provided). This is primarily used for testing.
     * @param name The name of the interface to acquire
     * @returns 
     */
    protected resolveNetworkInterface(name?: string) {
        return NetworkInterface.get(name);
    }
}
