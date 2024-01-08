// Periodically checks for sleep. The interval timer should fire within
// expected range. If it fires later than  expected, it's probably because
// it's coming back from sleep.

import { EventEmitter } from 'node:events';

export const sleep = new EventEmitter();
let interval: NodeJS.Timeout;

const frequency = 60 * 1000; // check for sleep once a minute
const fudge = 5 * 1000;

resetSleep();

export function resetSleep() {
    let last = Date.now();

    clearInterval(interval);
    interval = setInterval(function checkSleep() {

        const now = Date.now();
        const expected = last + frequency;
        last = now;

        if (now >= expected && now < (expected + fudge))
            sleep.emit('wake');
    }, frequency);

    // don't hold up the process
    interval.unref();
}