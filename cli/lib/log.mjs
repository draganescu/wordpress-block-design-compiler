// Tiny structured logger. Human-readable lines to stderr (so stdout stays clean
// for any machine-readable summary), with a verbose gate for per-call detail.

const COLORS = { dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', reset: '\x1b[0m' };

export class Logger {
    constructor({ verbose = false, color = process.stderr.isTTY } = {}) {
        this.verbose = verbose;
        this.color = color;
    }

    _c(name, text) {
        return this.color ? `${COLORS[name]}${text}${COLORS.reset}` : text;
    }

    _write(line) {
        process.stderr.write(`${line}\n`);
    }

    step(msg) { this._write(this._c('cyan', `▸ ${msg}`)); }
    info(msg) { this._write(`  ${msg}`); }
    ok(msg) { this._write(this._c('green', `  ✓ ${msg}`)); }
    warn(msg) { this._write(this._c('yellow', `  ! ${msg}`)); }
    error(msg) { this._write(this._c('red', `  ✗ ${msg}`)); }
    debug(msg) { if (this.verbose) this._write(this._c('dim', `    ${msg}`)); }
}

export default Logger;
