import { ValidationError } from './ValidationError';
import * as validate from './validate';

/**
 * Used by Advertisement and Browser to represent an mDNS service type, consisting of a service name, a protocol 
 * (typically TCP/UDP), and an optional set of subtypes.
 *
 * Name and protocol are always required, subtypes are optional.
 *
 * String descriptions: 
 * - `_http._tcp`
 * - `_http._tcp,mysubtype,anothersub`
 *
 * Object descriptions:
 * - ```ts
 *   {
 *     name:     '_http',
 *     protocol: '_tcp',
 *     subtypes: ['mysubtype', 'anothersub'],
 *   }
 *   ```
 *
 * Array descriptions:
 * - ```ts
 *   ['_http', '_tcp']
 *   ```
 * - ```ts
 *   ['_http', '_tcp', ['mysubtype', 'anothersub']]
 *   ```
 * - ```ts
 *   ['_http', '_tcp', 'mysubtype', 'anothersub']
 *   ```
 *
 * Validation is forgiving when the required leading underscores are missing (they will be
 * automatically added). Thus 'http.tcp' is considered the same as '_http._tcp'.
 */
export class ServiceType {
    /**
     * Construct a new ServiceType.
     * 
     * @param input Description of the service type. Can be a string (`_http._tcp`), 
     *              an array (`["_http", "_tcp"]`), or an object (`{ name: "_http", protocol: "_tcp"}`).
     *              See class documentation for more information.
     * @throws ValidationError The provided description is not valid
     */
    constructor(input: string | string[] | { name: string, protocol: string, subtypes?: string[] }) {
        if (typeof input === 'string') this._fromString(input);
        else if (Array.isArray(input)) this._fromArray(<[any, any, ...any]>input);
        else if (typeof input === 'object') this._fromObj(input);
        else {
            throw new ValidationError(`Argument must be string, obj, or array. got ${typeof input}`);
        }

        this._validate();
    }

    /**
     * Service name for this service descriptor (ie `_http`).
     */
    name: string = null;

    /**
     * Protocol for this service descriptor. Can be `_tcp` or `_udp`.
     */
    protocol: '_tcp' | '_udp' = null;

    /**
     * Subtypes for this service descriptor. Subtypes are used to differentiate the 
     * "role" of a specific service when the service name itself is too generic. For instance, if 
     * you are advertising an HTTP server, you can certainly advertise MyServer._http._tcp, but if 
     * that HTTP server is the administration interface of a printer, you may wish to advertise it 
     * with a subtype of "_printer", so that browsers can look for printer-specific HTTP services.
     * 
     * @see [RFC 6763 Section 7.1](https://datatracker.ietf.org/doc/html/rfc6763#section-7.1)
     */
    subtypes: string[] = [];

    /**
     * True if this is the special "service type enumerator" service type, which is used 
     * to enumerate the service types in use across an existing mDNS network.
     */
    isEnumerator = false;

    /**
     * Get the DNS name for this service type. For example "_http._tcp". If subtypes
     * are defined, the first subtype is returned ("_printer._sub._http._tcp"). 
     * 
     * If you instead would like a single string containing the service name, protocol,
     * and all subtypes, use `toString()`
     * 
     * @see `dnsNames` for all DNS names
     * @see `toString()` for a compact and complete description of this service type
     */
    get dnsName() {
        return this.dnsNames[0];
    }

    /**
     * Get all relevant DNS names for this service type. If there are no subtypes, an
     * array of one DNS name is returned (ie `_http._tcp`). If subtypes are defined,
     * one item per subtype is returned (ie `_printer._sub._http._tcp`).
     */
    get dnsNames() {
        if (this.subtypes.length === 0)
            return [`${this.name}.${this.protocol}`];

        return this.subtypes.map(subtype => `${subtype}._sub.${this.name}.${this.protocol}`);
    }

    /**
     * Create a new TCP protocol service type.
     * 
     * @example - ```ts
     *            ServiceType.tcp('_http')
     *            ```
     *          - ```ts
     *            ServiceType.tcp('_http', 'sub1', 'sub2')
     *            ```
     *          - ```ts
     *            ServiceType.tcp(['_http', 'sub1', 'sub2'])
     *            ```
     */
    static tcp(input: string | string[]) {
        let components = typeof input === 'string' ? input.split(',') : input;
        components.splice(1, 0, '_tcp');
        return new ServiceType(components);
    }

    /**
     * Create a new UDP protocol service type.
     * 
     * @example - ```ts
     *            ServiceType.tcp('_sleep-proxy')
     *            ```
     *          - ```ts
     *            ServiceType.tcp('_sleep-proxy,sub1,sub2')
     *            ```
     *          - ```ts
     *            ServiceType.tcp(['_sleep-proxy', 'sub1', 'sub2'])
     *            ```
     */
    static udp(input: string | string[]) {
        let components = typeof input === 'string' ? input.split(',') : input;
        components.splice(1, 0, '_udp');
        return new ServiceType(components);
    }

    /**
     * Creates a new service type enumerator. This special service type can be 
     * used to discover the service types in use by services present on the network.
     * 
     * @see [RFC 6763 section 9](https://datatracker.ietf.org/doc/html/rfc6763#section-9).
     */
    static all() {
        return new ServiceType('_services._dns-sd._udp');
    }

    /**
     * Parse a string into service parts
     * @example Inputs:
     *          - `_http._tcp`
     *          - `_http._tcp,mysubtype,anothersub`
     */
    private _fromString(str) {
        // trim off weird whitespace and extra trailing commas
        const parts = str.replace(/^[ ,]+|[ ,]+$/g, '').split(',').map(s => s.trim());

        this.name = parts[0].split('.').slice(0, -1).join('.');
        this.protocol = parts[0].split('.').slice(-1)[0];
        this.subtypes = parts.slice(1);
    }


    /**
     * Parse an array into service parts
     * @example Inputs:
     *          - `['_http', '_tcp', ['mysubtype', 'anothersub']]`
     *          - `['_http', '_tcp', 'mysubtype', 'anothersub']`
     */
    private _fromArray([name, protocol, ...subtypes]) {
        this._fromObj({
            name,
            protocol,
            subtypes: [].concat(...subtypes),
        });
    }


    /**
     * Parse an object into service parts
     * @example Input:
     *          ```ts
     *          {
     *            name:     '_http',
     *            protocol: '_tcp',
     *            subtypes: ['mysubtype', 'anothersub'],
     *          }
     *          ```
     */
    private _fromObj({ name, protocol, subtypes = [] }) {
        this.name = name;
        this.protocol = protocol;
        this.subtypes = (Array.isArray(subtypes)) ? subtypes : [subtypes];
    }


    /**
     * Validate service name, protocol, and subtype(s). 
     * 
     * @throws `ValidationError` If one or more components are invalid
     */
    private _validate() {
        if (typeof this.name !== 'string') {
            throw new ValidationError(`Service name must be a string, got ${typeof this.name}`);
        }

        if (!this.name) {
            throw new ValidationError(`Service name can't be empty`);
        }

        if (typeof this.protocol !== 'string') {
            throw new ValidationError(`Protocol must be a string, got ${typeof this.protocol}`);
        }

        if (!this.protocol) {
            throw new ValidationError("Protocol can't be empty");
        }

        // massage properties a little before validating
        // be lenient about underscores, add when missing
        if (!this.name.startsWith('_')) this.name = '_' + this.name;
        if (!this.protocol.startsWith('_')) this.protocol = <'_tcp' | '_udp'>('_' + this.protocol);

        // special case: check this service type is the service enumerator
        if (this.name === '_services._dns-sd' && this.protocol === '_udp') {
            this.isEnumerator = true;

            // enumerators shouldn't have subtypes
            this.subtypes = [];

            // skip validation for service enumerators, they would fail since
            // '_services._dns-sd' is getting shoehorned into this.name
            return;
        }

        validate.serviceName(this.name);
        validate.protocol(this.protocol);
        this.subtypes.forEach(subtype => validate.label(subtype, 'Subtype'));
    }

    /**
     * A string representation of the service. For example `_http._tcp,sub1,sub2`.
     * The output format can be fed into the ServiceType constructor if needed.
     */
    toString() {
        return (this.subtypes.length)
            ? this.name + '.' + this.protocol + ',' + this.subtypes.join(',')
            : this.name + '.' + this.protocol;
    }
}