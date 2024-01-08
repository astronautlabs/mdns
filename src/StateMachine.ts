import { EventEmitter } from 'node:events';

const has = (obj, prop) => prop in obj;

type StateMap = Record<string, Record<string, (...args) => void>>;

export class StateMachine extends EventEmitter {
    states: StateMap;
    state = '';
    prevState = '';

    /**
     * EventEmitter has a `domain` property. To ensure none of our classes attempt to 
     * use the `domain` as ServiceResolver did, we declare it here.
     * 
     * Incidentally, this is why this version of the library uses "tld" to refer to the
     * "local" part of an FQDN instead of "domain" like older versions did.
     */
    private domain: never;

    private invoke(state, eventName, ...args) {
        let func = this.states[state]?.[eventName];
        if (func !== undefined) {
            if (typeof func !== 'function')
                throw new Error(`Failed to invoke '${eventName}' on '${state}': Expected function, not '${typeof func}'`);

            func(...args);
        }
    }

    transition(to, ...args) {
        if (!this.states[to])
            throw new Error(`Can't transition, state ${to} doesn't exist!`);

        let from = this.state;
        
        //console.log(`[${this.constructor.name}] ${from ?? '<initial>'} -> ${to}`);

        this.prevState = this.state;
        this.state = to;

        this.invoke(this.prevState, 'exit');
        this.invoke(this.state, 'enter', ...args);
    }

    handle(eventName: string, ...args) {
        //console.log(`[${this.constructor.name}] event: ${eventName}`);
        this.invoke(this.state, eventName, ...args);
    }
}