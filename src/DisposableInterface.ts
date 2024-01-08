import * as dgram from 'node:dgram';

import { NetworkInterface } from './NetworkInterface';
import { Address } from './Address';
import { Platform } from './Platform';

/**
 * Creates a network interface obj using some ephemeral port like 51254
 * @class
 * @extends NetworkInterface
 *
 * Used for dnssd.resolve() functions where you only need to send a query
 * packet, get an answer, and shut down. (Sending packets from port 5353
 * would indicate a fully compliant responder). Packets sent by these interface
 * objects will be treated as 'legacy' queries by other responders.
 */
export class DisposableInterface extends NetworkInterface {
    constructor(name, addresses: Address[]) {
        // [debug]: Creating new DisposableInterface on ${name}:;
        super(name);

        this._addresses = addresses;
    }

    private _addresses: Address[];

    /**
     * Creates/returns DisposableInterfaces from a name or names of interfaces.
     * Always returns an array of em.
     * @static
     *
     * Ex:
     * > const interfaces = DisposableInterface.createEach('eth0');
     * > const interfaces = DisposableInterface.createEach(['eth0', 'wlan0']);
     *
     * @param  {string|string[]} args
     * @return {DisposableInterface[]}
     */
    static create(name?: string): DisposableInterface {
        return name
            ? new this(name, Platform.getNetworkInterfaces()[name])
            : new this('INADDR_ANY', [
                { address: '0.0.0.0', family: 'IPv4' },
                // {address: '::', family: 'IPv6'},
            ]);
    }

    /**
     * Checks if the name is an interface that exists in Platform.getNetworkInterfaces()
     */
    static isValidName(name: string) {
        if (!name || typeof name !== 'string') 
            return false;
        
        return !!~Object.keys(Platform.getNetworkInterfaces()).indexOf(name);
    }


    bind() {
        return Promise.all(this._addresses.map(addr => this._bindSocketWithAddress(addr)))
            .then(() => {
                // [debug]: Interface ${this._id} now bound;
                this._isBound = true;
            });
    }

    protected createSocket(type: dgram.SocketType) {
        return dgram.createSocket({ type });
    }

    private _bindSocketWithAddress(address: Address) {
        let isPending = true;

        const promise = new Promise<void>((resolve, reject) => {
            const socketType = (address.family === 'IPv6') ? 'udp6' : 'udp4';
            const socket = this.createSocket(socketType);

            socket.on('error', (err) => {
                console.error(`DisposableInterface: Socket error:`);
                console.error(err);

                if (isPending) reject(err);
                else this._onError(err);
            });

            socket.on('close', () => {
                this._onError(new Error('Socket closed unexpectedly'));
            });

            socket.on('message', this._onMessage.bind(this));

            socket.on('listening', () => {
                const sinfo = socket.address();
                // [debug]: ${this._id} listening on ${sinfo.address}:${sinfo.port};

                this._sockets.push(socket);
                resolve();
            });

            socket.bind({ address: address.address });
        });

        return promise.then(() => {
            isPending = false;
        });
    }
}