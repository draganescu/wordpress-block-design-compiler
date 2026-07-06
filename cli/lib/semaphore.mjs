// A minimal counting semaphore. Bounds how many concurrent harness sessions
// (child `claude -p` processes) run at once, so "run multiple sessions" never
// becomes "fork-bomb the machine".

export class Semaphore {
    constructor(max = 1) {
        this.max = Math.max(1, max | 0);
        this.active = 0;
        this.queue = [];
    }

    async acquire() {
        if (this.active < this.max) {
            this.active++;
            return;
        }
        await new Promise((resolve) => this.queue.push(resolve));
        this.active++;
    }

    release() {
        this.active--;
        const next = this.queue.shift();
        if (next) next();
    }

    async run(fn) {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }
}

export default Semaphore;
