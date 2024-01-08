/**
 * const mutex = new Mutex();
 *
 * function limitMe() {
 *   mutex.lock((unlock) => {
 *     asyncFn().then(unlock);
 *   });
 * }
 *
 * limitMe();
 * limitMe(); // <-- will wait for first call to finish & unlock
 *
 */
export class Mutex {
    private _queue: ((unlock: () => void) => void)[] = [];
    locked = false;

    lock(fn: (unlock: () => void) => void) {
        const unlock = () => {
            const nextFn = this._queue.shift();

            if (nextFn) nextFn(unlock);
            else this.locked = false;
        };

        if (!this.locked) {
            this.locked = true;
            fn(unlock);
        } else {
            this._queue.push(fn);
        }
    }
}
