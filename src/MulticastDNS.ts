import { Query } from './Query';
import { ServiceResolver } from './ServiceResolver';
import { DisposableInterface } from './DisposableInterface';
import { EventEmitter } from 'node:events';
import { ValidationError } from './ValidationError';
import { RType } from './constants';
import { AAAARecord, ARecord, ResourceRecord, SRVRecord, TXTRecord } from './ResourceRecord';
import { Service } from './Service';

export interface ResolverOptions {
    /**
     * Name identifying a network interface to use.
     */
    interface?: string;
}

export interface Answer<T extends ResourceRecord> {
    answer: T;
    related: ResourceRecord[];
}

/**
 * A simple interface for directly querying mDNS as if it were unicast DNS. 
 */
export class MulticastDNS {
    /**
     * Perform a simple mDNS query.
     * 
     * @param name DNS name of the desired record
     * @param recordType Type of record (such as "A", "SRV", "TXT", etc). Optionally you can use the resource type number.
     * @param options Options for this query
     * @returns 
     */
    static query<T extends ResourceRecord>(name: string, recordType: keyof typeof RType | number, options: ResolverOptions = {}): Promise<Answer<T>> {
        let qtype: number;
    
        if (typeof name !== 'string') {
            throw new ValidationError(`Name must be a string, got ${typeof name}`);
        }
    
        if (!name.length) {
            throw new ValidationError("Name can't be empty");
        }
    
        if (typeof recordType === 'string') qtype = RType[recordType.toUpperCase()];
        if (Number.isInteger(recordType)) qtype = <number>recordType;
    
        if (!qtype || qtype <= 0 || qtype > 0xFFFF) {
            throw new ValidationError(`Unknown query type, got '${recordType}'`);
        }
    
        if (typeof options !== 'object') {
            throw new ValidationError(`Options must be an object, got ${typeof options}`);
        }
    
        if (options.interface && !DisposableInterface.isValidName(options.interface)) {
            throw new ValidationError(`Interface "${options.interface}" doesn't exist`);
        }
    
        if (!name.endsWith('.')) name += '.'; // make sure root label exists
    
        return this.runQuery(name, qtype, options);
    }
    
    /**
     * Query mDNS for the given hostname looking for an A (IPv4 address) record.
     */
    static async A(name: string, opts?: ResolverOptions): Promise<string> {
        return (await this.query<ARecord>(name, 'A', opts)).answer?.address;
    }
    
    /**
     * Query mDNS for the given hostname looking for an AAAA (IPv6 address) record.
     */
    static async AAAA(name: string, opts?: ResolverOptions): Promise<string> {
        return (await this.query<AAAARecord>(name, 'AAAA', opts)).answer?.address;
    }
    
    /**
     * Query mDNS for the given hostname looking for an SRV (DNS service) record.
     */
    static async SRV(name: string, opts?: ResolverOptions) {
        let { target, port } = (await this.query<SRVRecord>(name, 'SRV', opts)).answer;
        return { target, port };
    }
    
    /**
     * Query mDNS for the given hostname looking for a TXT (text) record.
     */
    static async TXT(name, opts?) {
        let { txt, txtRaw } = (await this.query<TXTRecord>(name, 'TXT', opts)).answer;
        return { txt, txtRaw };
    }
    
    /**
     * Resolve the service by DNS name. This is internal as it will eventually be moved out 
     * of this class and into `Browser`.
     * @internal
     */
    static async resolveService(name: string, options: { timeout?: number, interface?: string } = {}) {
        // [debug]: Resolving service: ${name};
    
        if (typeof name !== 'string')
            throw new ValidationError(`Name must be a string, got ${typeof name}`);
    
        if (!name.length)
            throw new ValidationError("Name can't be empty");
    
        if (typeof options !== 'object')
            throw new ValidationError(`Options must be an object, got ${typeof options}`);
    
        if (options.interface && !DisposableInterface.isValidName(options.interface))
            throw new ValidationError(`Interface "${options.interface}" doesn't exist`);
    
        if (!name.endsWith('.')) 
            name += '.';
    
        const intf = this.createInterface(options.interface);
        await intf.bind();

        return new Promise<Service>((resolve, reject) => {
            const resolver = this.createServiceResolver(name, intf);

            function stop() {
                resolver.stop();
                intf.stop();
            }

            const timer = setTimeout(() => {
                reject(new Error('Resolve service timed out'));
                stop();
            }, options.timeout || 2000);

            resolver.once('resolved', () => {
                resolve(resolver.service());
                stop();
                clearTimeout(timer);
            });

            resolver.start();
        });
    }

    private static runQuery<T extends ResourceRecord>(
        name: string, 
        qtype: number, 
        options: { timeout?: number, interface?: string } = {}
    ): Promise<Answer<T>> {
        // [debug]: Resolving ${name}, type: ${qtype};
    
        const timeout = options.timeout || 2000;
        const question = { name, qtype };
    
        const intf = this.createInterface(options.interface);
        const killswitch = new EventEmitter();

        killswitch.setMaxListeners(50);

        return new Promise<Answer<T>>((resolve, reject) => {
            function stop() {
                killswitch.emit('stop');
                intf.stop();
            }
    
            const sendQuery = () => { 
                this.createQuery(intf, killswitch)
                    .continuous(false)
                    .setTimeout(timeout)
                    .add(question)
                    .once('answer', (answer, related) => {
                        stop();
                        resolve({ answer, related });
                    })
                    .once('timeout', () => {
                        stop();
                        reject(new Error('Resolve query timed out'));
                    })
                    .start();
            }
    
            intf.bind()
                .then(sendQuery)
                .catch(reject);
        });
    }
    
    /** @internal */ static createInterface = (name: string) => DisposableInterface.create(name);
    /** @internal */ static createQuery = (intf: DisposableInterface, killswitch: EventEmitter) => new Query(intf, killswitch);
    /** @internal */ static createServiceResolver = (name: string, intf: DisposableInterface) => new ServiceResolver(name, intf);
}

