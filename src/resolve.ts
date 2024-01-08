import { Query } from './Query';
import { Service, ServiceResolver } from './ServiceResolver';
import { DisposableInterface } from './DisposableInterface';
import { EventEmitter } from 'node:events';
import { ValidationError } from './ValidationError';
import { RType } from './constants';
import { AAAARecord, ARecord, ResourceRecord, SRVRecord, TXTRecord } from './ResourceRecord';

export const resolveMechanics = {
    createInterface: (name: string) => DisposableInterface.create(name),
    createQuery: (intf: DisposableInterface, killswitch: EventEmitter) => new Query(intf, killswitch),
    createServiceResolver: (name: string, intf: DisposableInterface) => new ServiceResolver(name, intf)
}

function runQuery(name: string, qtype: number, options: { timeout?: number, interface?: string } = {}) {
    // [debug]: Resolving ${name}, type: ${qtype};

    const timeout = options.timeout || 2000;
    const question = { name, qtype };

    const intf = resolveMechanics.createInterface(options.interface);
    const killswitch = new EventEmitter();

    return new Promise<{ answer: ResourceRecord, related: ResourceRecord[] }>((resolve, reject) => {
        function stop() {
            killswitch.emit('stop');
            intf.stop();
        }

        function sendQuery() { 
            resolveMechanics.createQuery(intf, killswitch)
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


export function resolve(name: string, type: string | number, options: { interface?: string } = {}) {
    let qtype: number;

    if (typeof name !== 'string') {
        throw new ValidationError(`Name must be a string, got ${typeof name}`);
    }

    if (!name.length) {
        throw new ValidationError("Name can't be empty");
    }

    if (typeof type === 'string') qtype = RType[type.toUpperCase()];
    if (Number.isInteger(type)) qtype = <number>type;

    if (!qtype || qtype <= 0 || qtype > 0xFFFF) {
        throw new ValidationError(`Unknown query type, got '${type}'`);
    }

    if (typeof options !== 'object') {
        throw new ValidationError(`Options must be an object, got ${typeof options}`);
    }

    if (options.interface && !DisposableInterface.isValidName(options.interface)) {
        throw new ValidationError(`Interface "${options.interface}" doesn't exist`);
    }

    if (!name.endsWith('.')) name += '.'; // make sure root label exists

    return runQuery(name, qtype, options);
}


export function resolve4(name, opts?) {
    return resolve(name, 'A', opts)
        .then(({ answer }) => (answer as ARecord).address);
}

export function resolve6(name, opts?) {
    return resolve(name, 'AAAA', opts)
        .then(({ answer }) => (answer as AAAARecord).address);
}

export function resolveSRV(name, opts?) {
    return resolve(name, 'SRV', opts)
        .then(({ answer }) => ({ target: (answer as SRVRecord).target, port: (answer as SRVRecord).port }));
}

export function resolveTXT(name, opts?) {
    return resolve(name, 'TXT', opts)
        .then(({ answer }) => ({ txt: (answer as TXTRecord).txt, txtRaw: (answer as TXTRecord).txtRaw }));
}


export function resolveService(name, options: { timeout?: number, interface?: string, name?: string } = {}) {
    // [debug]: Resolving service: ${name};

    const timeout = options.timeout || 2000;

    if (typeof name !== 'string') {
        throw new ValidationError(`Name must be a string, got ${typeof name}`);
    }

    if (!name.length) {
        throw new ValidationError("Name can't be empty");
    }

    if (typeof options !== 'object') {
        throw new ValidationError(`Options must be an object, got ${typeof options}`);
    }

    if (options.interface && !DisposableInterface.isValidName(options.interface)) {
        throw new ValidationError(`Interface "${options.interface}" doesn't exist`);
    }

    if (name.substr(-1) !== '.') name += '.'; // make sure root label exists

    const intf = resolveMechanics.createInterface(options.interface);
    const resolver = resolveMechanics.createServiceResolver(name, intf);

    function stop() {
        resolver.stop();
        intf.stop();
    }

    function startResolver() {
        return new Promise<Service>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('Resolve service timed out'));
                stop();
            }, timeout);

            resolver.once('resolved', () => {
                resolve(resolver.service());
                stop();
                clearTimeout(timer);
            });

            resolver.start();
        });
    }

    return intf.bind().then(startResolver);
}